'use strict';

const crypto = require('node:crypto');
const { createDispatchRequest, createDispatchReceipt } = require('../references/execution-bundle/scripts/lib/dispatch-contract');
const { decideFallback, FAILURE_CLASSES } = require('../references/execution-bundle/scripts/lib/dispatch-engine');
const { withWriterLease } = require('../references/execution-bundle/scripts/lib/dispatch-writer-lease');
const { deriveCompletionLedger } = require('../references/execution-bundle/scripts/lib/partial-writer-handoff');
const { captureScope, scopeDiff, validateAssignedPaths } = require('./scope-baseline');
const { cloneAndFreezeTaskValue } = require('./task-contract');

function createRecoveryState(options) {
  if (options === undefined) return null;
  if (!options || !Number.isSafeInteger(options.retryBudget) || options.retryBudget < 0
      || (options.executionTimeoutMs !== undefined && (!Number.isSafeInteger(options.executionTimeoutMs) || options.executionTimeoutMs < 1))
      || (options.controlTimeoutMs !== undefined && (!Number.isSafeInteger(options.controlTimeoutMs) || options.controlTimeoutMs < 1))) {
    throw new TypeError('recovery requires nonnegative retryBudget and positive deadline integers');
  }
  return { remaining: options.retryBudget, executionTimeoutMs: options.executionTimeoutMs,
    controlTimeoutMs: options.controlTimeoutMs || 5000 };
}

async function bounded(fn, milliseconds) {
  const pending = Promise.resolve().then(fn);
  if (milliseconds === undefined) return pending;
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('control deadline exceeded')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function failureClass(outcome) {
  if (outcome && ['TIMEOUT', 'INTERRUPTED'].includes(outcome.status)) return FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION;
  if (Object.values(FAILURE_CLASSES).includes(outcome && outcome.failure_class)) return outcome.failure_class;
  return FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE;
}

function matching(proof, request) {
  return proof && proof.task_id === request.task_id && proof.attempt_id === request.attempt_id;
}

function reconcileProof(proof, request, baseline, diff) {
  const lists = ['attributable_changes', 'unconfirmed', 'remaining', 'out_of_scope'];
  if (!baseline || typeof baseline.identity !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(baseline.identity)
      || !matching(proof, request) || proof.status !== 'PASSED' || proof.baseline_id !== baseline.identity
      || proof.scope_contained !== true || proof.wip_preserved !== true || proof.diff_verified !== true
      || lists.some((key) => !Array.isArray(proof[key])) || proof.out_of_scope.length || diff.out_of_scope.length) return null;
  const assigned = request.scope.assigned_files;
  if (lists.some((key) => new Set(proof[key]).size !== proof[key].length || proof[key].some((file) => typeof file !== 'string' || !assigned.includes(file)))
      || diff.changed.some((file) => !proof.attributable_changes.includes(file))
      || proof.attributable_changes.some((file) => !diff.changed.includes(file))) return null;
  const ledger = deriveCompletionLedger({ assignedFiles: assigned, changedFiles: diff.changed,
    attributableFiles: proof.attributable_changes, reportedFiles: [] });
  return cloneAndFreezeTaskValue({ status: 'PASSED', task_id: request.task_id, attempt_id: request.attempt_id,
    baseline_id: baseline.identity, scope_contained: true, wip_preserved: true, diff_verified: true,
    attributable_changes: [...proof.attributable_changes], unconfirmed: [...proof.unconfirmed],
    remaining: [...proof.remaining], out_of_scope: [], completion_ledger: ledger });
}

async function executeAttempt({ task, prepared, host, context, recoveryState, writerLease,
  verifyPromptEvidence, observedTargetIssue, strictTarget, validateCandidate }) {
  const writer = task.constraints.authority === 'workspace-write';
  const run = async (owner) => {
    let activeTask = task;
    let activePrepared = prepared;
    const attempts = [];
    let retainedEffects = 'none';
    const finish = (status, outcome, verification, reason, reconciliation) => ({ status, outcome, verification,
      attempts: Object.freeze([...attempts]), reason, reconciliation: reconciliation || null,
      recovery_state: recoveryState ? { remaining_budget: recoveryState.remaining,
        status: status === 'SUCCEEDED' ? 'COMPLETE' : reconciliation ? 'RECONCILED' : 'STOPPED' } : null });
    for (;;) {
      const request = createDispatchRequest({ ...activePrepared.request,
        fallback: { allow: Boolean(recoveryState), retry_budget: recoveryState ? recoveryState.remaining : 0 } });
      const resolution = Object.freeze({ ...activePrepared.resolution, request });
      const attemptContext = { ...context, request, resolution };
      let baseline = null;
      let physicalBefore = null;
      let outcome = null;
      let verification = null;
      let scopeIssue = null;
      let observedIssue = null;
      let reconciliation = null;
      let diff = null;
      let interrupted = false;
      let unknownLifecycle = false;
      let stopped = false;
      let launched = false;
      const control = (fn) => bounded(fn, recoveryState ? recoveryState.controlTimeoutMs : 5000);
      try {
        try {
          if (writer) {
            if (typeof host.inspectScope !== 'function') return finish('BLOCKED', null, null, 'writer scope inspection is required');
            baseline = await control(() => host.inspectScope(activeTask, { ...attemptContext, phase: 'pre', node: context.node }));
            validateAssignedPaths(context.workdir, request.scope.assigned_files);
            try {
              physicalBefore = captureScope(context.workdir);
            } catch (error) { if (recoveryState) throw error; }
          }
          if (!verifyPromptEvidence(activeTask.constraints.prompt_evidence)) return finish('BLOCKED', null, null, 'prompt evidence changed before execution');
        } catch (_) { return finish('BLOCKED', null, null, 'pre-execution scope evidence is unavailable'); }

        // The owner remains active through every post-launch hook. A deadline
        // stops waiting but cannot release ownership of an unconfirmed writer.
        try {
          launched = true;
          unknownLifecycle = true;
          const pending = () => Promise.resolve().then(() => host.execute(resolution.target, activeTask, attemptContext))
            .catch(() => { unknownLifecycle = true; return { status: 'FAILED', failure_class: FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE, side_effects: 'unknown' }; });
          try { outcome = await bounded(pending, recoveryState && recoveryState.executionTimeoutMs || undefined); }
          catch (_) { outcome = { status: 'TIMEOUT', failure_class: FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION, side_effects: 'unknown' }; }
          if (!outcome || typeof outcome !== 'object' || !['SUCCEEDED', 'FAILED', 'BLOCKED', 'TIMEOUT', 'INTERRUPTED'].includes(outcome.status)) {
            unknownLifecycle = true;
            outcome = { status: 'BLOCKED', failure_class: FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE, side_effects: 'unknown' };
          } else if (!['TIMEOUT', 'INTERRUPTED'].includes(outcome.status) && outcome.side_effects !== 'unknown') {
            unknownLifecycle = false;
          }
          interrupted = failureClass(outcome) === FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION && outcome.status !== 'SUCCEEDED';
          if (interrupted || unknownLifecycle) {
            try {
              const proof = await control(() => typeof host.stop === 'function' ? host.stop(activeTask, attemptContext) : null);
              stopped = matching(proof, request) && proof.status === 'STOPPED';
            } catch (_) { stopped = false; }
          }
          try { verification = await control(() => host.verify(activeTask, outcome, attemptContext)); }
          catch (_) { verification = null; if (!recoveryState) outcome = { ...outcome, status: 'FAILED' }; }
          observedIssue = observedTargetIssue(outcome.observed_target, resolution.target, strictTarget);
        } finally {
          if (writer) {
            try {
              const post = await control(() => host.inspectScope(activeTask, { ...attemptContext, phase: 'post', baseline, outcome }));
              if (!post || post.within_scope !== true || post.wip_preserved !== true) scopeIssue = 'writer scope inspection did not prove assigned changes and WIP preservation';
              if (physicalBefore && (recoveryState || interrupted || unknownLifecycle)) {
                diff = scopeDiff(physicalBefore, captureScope(context.workdir), request.scope.assigned_files);
                if (diff.out_of_scope.length) scopeIssue = 'writer changed files outside assigned scope';
              }
            } catch (_) { scopeIssue = 'writer scope inspection failed after execution'; }
          }
        }
        const acceptedEvidence = verification && verification.status === 'PASSED'
          && typeof verification.evidence === 'string' && verification.evidence.trim() !== '';
        const failedClass = outcome.status === 'SUCCEEDED' && acceptedEvidence ? null : failureClass(outcome);
        let effects = ['none', 'observed', 'unknown'].includes(outcome.side_effects) ? outcome.side_effects : 'unknown';
        if (diff && diff.changed.length) effects = 'observed';
        if (effects === 'observed') retainedEffects = 'observed';
        else if (effects === 'unknown' && retainedEffects !== 'observed') retainedEffects = 'unknown';
        const passed = outcome.status === 'SUCCEEDED' && verification && verification.status === 'PASSED'
          && typeof verification.evidence === 'string' && verification.evidence.trim() !== '' && !scopeIssue && !observedIssue;
        if ((interrupted || unknownLifecycle) && (!writer || stopped) && !scopeIssue && (!writer || diff)) {
          try {
            const proof = await control(() => typeof host.reconcile === 'function'
              ? host.reconcile(activeTask, { ...attemptContext, baseline, outcome }) : null);
            reconciliation = reconcileProof(proof, request, baseline || {}, diff || { changed: [], out_of_scope: [] });
          } catch (_) { reconciliation = null; }
        } else if (recoveryState && failedClass === FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE && !scopeIssue && (!writer || diff)) {
          const assigned = request.scope.assigned_files;
          const changed = diff ? diff.changed : [];
          reconciliation = cloneAndFreezeTaskValue({ status: 'PASSED', task_id: request.task_id, attempt_id: request.attempt_id,
            baseline_id: baseline && baseline.identity || 'read-only', scope_contained: true, wip_preserved: true, diff_verified: true,
            attributable_changes: changed, unconfirmed: changed, remaining: assigned.filter((file) => !changed.includes(file)), out_of_scope: [],
            completion_ledger: deriveCompletionLedger({ assignedFiles: assigned, changedFiles: changed }) });
        }
        // Ownership safety precedes receipts and other fallible presentation.
        if (writer && (interrupted || unknownLifecycle) && (!stopped || !reconciliation || scopeIssue) && owner) owner.suspend();
        const receipt = createDispatchReceipt({ receipt_id: `receipt-${request.attempt_id}`, request, target: resolution.target,
          allow_unknown_effort: resolution.target.effort === null,
          ...(resolution.capability && resolution.capability.kind === 'host-executable-capability' ? { capability_evidence: resolution.capability } : {}),
          status: outcome.status === 'INTERRUPTED' ? 'TIMEOUT' : outcome.status,
          failure_class: failedClass, side_effects: effects, verification: passed ? 'PASSED' : interrupted ? 'RECONCILIATION_REQUIRED' : 'BLOCKED' });
        attempts.push(cloneAndFreezeTaskValue({ receipt, observed_target: outcome.observed_target ? {
          provider: outcome.observed_target.provider || null, target_agent: outcome.observed_target.target_agent || null,
          model_id: outcome.observed_target.model_id || null, effort: outcome.observed_target.effort || null,
        } : null, remaining_budget: recoveryState ? recoveryState.remaining : 0,
        side_effects: retainedEffects, ...(reconciliation ? { reconciliation } : {}) }));
        if (writer && (interrupted || unknownLifecycle) && (!stopped || !reconciliation || scopeIssue)) {
          return finish('BLOCKED', outcome, verification, 'RECONCILIATION_REQUIRED: old writer stop and scope evidence are incomplete');
        }
        if (passed) return finish('SUCCEEDED', outcome, verification);
        if (recoveryState && writer && scopeIssue && owner) owner.suspend();
        if (scopeIssue || observedIssue) return finish('BLOCKED', outcome, verification, scopeIssue || observedIssue);
        if (!recoveryState || recoveryState.remaining === 0 || !failedClass
            || [FAILURE_CLASSES.SAFETY_OR_USER_DENIAL, FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT].includes(failedClass)
            || (request.strict_target && [FAILURE_CLASSES.CLI_UNAVAILABLE, FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE].includes(failedClass))
            || typeof host.recover !== 'function') return finish('FAILED', outcome, verification, verification && verification.status === 'PASSED'
              ? 'acceptance requires successful execution and non-empty verification evidence'
              : failedClass || 'acceptance remains blocked', reconciliation);
        let selection;
        try { selection = await control(() => host.recover(activeTask, { ...attemptContext, failure_class: failedClass,
          receipt, reconciliation, remaining_budget: recoveryState.remaining })); }
        catch (_) { return finish('BLOCKED', outcome, verification, 'recovery control did not return a decision', reconciliation); }
        if (!selection || !['substitute', 'repair', 'resume'].includes(selection.action)) return finish('BLOCKED', outcome, verification, 'recovery stopped', reconciliation);
        let candidate;
        try { candidate = await control(() => validateCandidate(selection.target, activeTask, request, reconciliation)); }
        catch (_) { candidate = null; }
        if (!candidate) return finish('BLOCKED', outcome, verification, 'recovery target is unauthorized or unavailable', reconciliation);
        const decision = decideFallback({ request, resolution, failureClass: failedClass, sideEffects: effects,
          catalog: context.capabilities.catalog, candidate_request: candidate.request, reconciliation, recovery_action: selection.action });
        if (decision.status !== 'FALLBACK') return finish('BLOCKED', outcome, verification, decision.reason, reconciliation);
        if (recoveryState.remaining <= 0) return finish('BLOCKED', outcome, verification, 'shared recovery retry budget is exhausted', reconciliation);
        recoveryState.remaining -= 1;
        const nextRequest = createDispatchRequest({ ...decision.next_request, attempt_id: `flow-drive-attempt-${crypto.randomUUID()}`,
          fallback: { allow: true, retry_budget: recoveryState.remaining } });
        activeTask = cloneAndFreezeTaskValue({ ...activeTask, constraints: { ...activeTask.constraints, assigned_files: [...nextRequest.scope.assigned_files] } });
        activePrepared = { ...candidate, request: nextRequest, resolution: { ...decision.resolution, request: nextRequest } };
        context = { ...context, verified_completed: reconciliation && reconciliation.completion_ledger.confirmed || [] };
      } catch (_) {
        return finish('BLOCKED', outcome, verification, `${interrupted || unknownLifecycle ? 'RECONCILIATION_REQUIRED: ' : ''}post-execution evidence is unavailable`);
      } finally {
        if (writer && launched && (interrupted || unknownLifecycle) && (!stopped || !reconciliation || scopeIssue) && owner) owner.suspend();
      }
    }
  };
  try { return await (writer && !writerLease ? withWriterLease(run) : run(writerLease)); }
  catch (_) { return { status: 'BLOCKED', reason: 'RECONCILIATION_REQUIRED: writer ownership is unavailable', attempts: [] }; }
}

module.exports = Object.freeze({ createRecoveryState, executeAttempt });
