'use strict';

const path = require('node:path');
const { createNodeTask } = require('./task-contract');
const { executeAttempt } = require('./attempt-executor');
const { exactWorkerTarget } = require('./provider-permissions');
const { evaluateTargetPolicy, selectCapabilityEvidence } = require('./target-policy');

function validConclusion(result) {
  let cursor = result;
  let conclusion = null;
  for (let depth = 0; cursor && depth < 4; depth += 1) {
    if (cursor.conclusion) { conclusion = cursor.conclusion; break; }
    cursor = cursor.outcome;
  }
  return Boolean(result && (result.status === 'SUCCEEDED' || result.outcome && result.outcome.status === 'SUCCEEDED') && conclusion
    && conclusion.status === 'READY_FOR_DISPATCH'
    && ['source_evidence', 'root_cause', 'repair', 'verification'].every((key) => typeof conclusion[key] === 'string' && conclusion[key].trim() !== ''));
}

function sameIdentity(left, right) {
  return left && right && typeof left.agent_id === 'string' && typeof left.session_id === 'string'
    && left.agent_id === right.agent_id;
}

async function runTaskGraph({ graph, resolvedTask, capabilities, decision, host, invocation, workdir, sessionId, bindingId,
  currentProvider, authorizationLedger, taskIdentity, nodeTaskDigest, selectedTarget, dispatchRequest, prepareDispatch, executeSchedule, verifyPromptEvidence, observedTargetIssue, recoveryState, validateRecoveryCandidate }) {
  const outcomes = new Map();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const currentDigest = resolvedTask.constraints.prompt_evidence.sha256;
  const strict = resolvedTask.constraints.strict_target;
  const explicit = exactWorkerTarget(invocation);
  const authorizedProviders = [...new Set([
    ...authorizationLedger.providers,
    ...authorizationLedger.targets.map((grant) => grant.provider),
  ])];

  const executeNode = async (node, { request, writerLease } = {}) => {
    const target = selectedTarget({ target: node.target });
    if (!target) return { id: node.id, status: 'BLOCKED', reason: `node ${node.id} has no valid target` };
    const policy = evaluateTargetPolicy({
      target,
      role: node.role,
      authority: node.authority,
      constraints: resolvedTask.constraints,
      invocation,
      ledger: authorizationLedger,
      hostAllowedProviders: capabilities.host_profile.allowed_providers,
    });
    if (!policy.allowed) return { id: node.id, status: 'BLOCKED', reason: policy.reason };
    const nodeTask = createNodeTask(resolvedTask, node);
    const currentTaskDigest = nodeTaskDigest(node, nodeTask, workdir);
    const evidenceSelection = selectCapabilityEvidence(
      capabilities, target, node.role, node.authority, { session_id: sessionId, binding_id: bindingId },
    );
    if (evidenceSelection.status === 'blocked') {
      return { id: node.id, status: 'BLOCKED', reason: evidenceSelection.reason };
    }
    let prepared;
    try {
      prepared = prepareDispatch({
        request, catalog: capabilities.catalog,
        change: { confirmed: true, change_id: taskIdentity(resolvedTask).taskId },
      });
    } catch (error) { return { id: node.id, status: 'BLOCKED', reason: error.message }; }
    if (prepared.resolution.status !== 'RESOLVED') return { id: node.id, status: 'BLOCKED', reason: prepared.resolution.reason || 'node dispatch blocked' };
    const nodeContext = { invocation, capabilities, decision, resolution: prepared.resolution, workdir, node, execution_binding: { session_id: sessionId, binding_id: bindingId }, authorization_ledger: authorizationLedger };
    let scopeBefore = null;
    // A fresh prerequisite has new evidence even without known file effects.
    // Reuse can propagate only through independently validated reused inputs.
    const dependencyChanged = node.dependencies.some((id) => outcomes.get(id)?.reused !== true);
    if (node.reuse && !dependencyChanged) {
      try {
        if (typeof host.inspectScope === 'function') scopeBefore = await host.inspectScope(nodeTask, { phase: 'pre', node, workdir });
        const reusable = typeof host.verifyReuse === 'function' && node.reuse.prompt_sha256 === currentDigest
          && node.reuse.task_digest === currentTaskDigest
          && scopeBefore && typeof scopeBefore.identity === 'string' && node.reuse.baseline_identity === scopeBefore.identity;
        if (reusable) {
          const reuse = await host.verifyReuse(node.reuse, { node, task: nodeTask, current_prompt_sha256: currentDigest, current_task_digest: currentTaskDigest, current_scope_baseline: scopeBefore.identity, workdir });
          if (reuse && reuse.status === 'PASSED' && typeof reuse.evidence === 'string' && reuse.evidence.trim() !== '') {
            if (node.role === 'reviewer' && node.independent_of) {
              const sources = node.independent_of.map((dependency) => outcomes.get(dependency)?.outcome?.executor_identity);
              if (!reuse.executor_identity || typeof reuse.executor_identity.agent_id !== 'string' || typeof reuse.executor_identity.session_id !== 'string'
                || sources.some((source) => !source || typeof source.agent_id !== 'string' || typeof source.session_id !== 'string' || sameIdentity(reuse.executor_identity, source))) return { id: node.id, status: 'BLOCKED', reason: 'reviewer independence was not observed' };
            }
            return { id: node.id, status: 'SUCCEEDED', reused: true, outcome: { status: 'SUCCEEDED', conclusion: reuse.conclusion, executor_identity: reuse.executor_identity }, verification: reuse };
          }
        }
      } catch (_) { return { id: node.id, status: 'BLOCKED', reason: 'reuse inspection failed' }; }
    }
    const completed = await executeAttempt({ task: nodeTask, prepared, host, context: nodeContext,
      recoveryState, writerLease, verifyPromptEvidence, observedTargetIssue,
      strictTarget: (node.role === 'worker' && explicit) || strict, validateCandidate: validateRecoveryCandidate });
    if (node.role === 'reviewer' && node.independent_of && completed.status === 'SUCCEEDED') {
      const observed = completed.outcome.executor_identity;
      const sources = node.independent_of.map((dependency) => outcomes.get(dependency)?.outcome?.executor_identity);
      if (!observed || typeof observed.agent_id !== 'string' || typeof observed.session_id !== 'string'
          || sources.some((source) => !source || typeof source.agent_id !== 'string' || typeof source.session_id !== 'string' || sameIdentity(observed, source))) {
        return { id: node.id, ...completed, status: 'BLOCKED', reason: 'reviewer independence was not observed' };
      }
    }
    return { id: node.id, ...completed };
  };

  const requests = graph.nodes.map((node) => {
    const target = selectedTarget({ target: node.target });
    const nodeTask = createNodeTask(resolvedTask, node);
    const evidenceSelection = selectCapabilityEvidence(
      capabilities, target, node.role, node.authority, { session_id: sessionId, binding_id: bindingId },
    );
    const packet = dispatchRequest(nodeTask, path.resolve(workdir), capabilities,
      target || { target: { target_agent: 'cursor', provider: currentProvider, model_id: capabilities.host_profile.native_model }, effort: null },
      node.effort || target && target.effort, authorizedProviders,
      evidenceSelection.status === 'selected' ? evidenceSelection.evidence : null,
      { session_id: sessionId, binding_id: bindingId }, Boolean(strict || (node.role === 'worker' && explicit)), node.role);
    return { ...packet.request, task_id: node.id, parallelism: { dependencies: [...node.dependencies], max_concurrency: graph.nodes.length } };
  });
  const scheduled = await executeSchedule(requests, {
    catalog: capabilities.catalog, fallback: false, singleWriter: true, retainOutcomes: true, managedLifecycle: true,
    beforeDispatch: async (request, resolution, completed) => {
      const node = nodeById.get(request.task_id);
      if (node.authority === 'workspace-write' && node.decision_state !== 'CLEAR') {
        const dependencies = Array.isArray(node.reasoner_dependencies) ? node.reasoner_dependencies : [];
        if (node.decision_state !== 'REASONER_REQUIRED' || dependencies.length === 0 || !dependencies.every((id) => {
          const result = completed.get(id);
          // scheduler retains the complete prior dispatch result for semantic gates
          return result && result.status === 'SUCCEEDED' && validConclusion(result.outcome);
        })) return false;
      }
      return resolution.status === 'RESOLVED';
    },
    dispatch: async (request, dispatchContext) => {
      const result = await executeNode(nodeById.get(request.task_id), { request, writerLease: dispatchContext.writer_lease });
      outcomes.set(request.task_id, result);
      return result;
    },
  });
  const results = scheduled.results.map((result) => ({ id: result.task_id, status: result.status, reason: result.reason || result.outcome && result.outcome.reason, outcome: result.outcome, attempts: result.outcome && result.outcome.attempts }));
  const failed = results.filter((result) => result.status !== 'SUCCEEDED');
  let parentVerification = null;
  if (failed.length === 0) {
    try { parentVerification = await host.verify(resolvedTask, { status: 'SUCCEEDED', nodes: results }, { invocation, capabilities, decision, workdir, graph: true }); } catch (_) { parentVerification = null; }
  }
  const parentPassed = parentVerification && parentVerification.status === 'PASSED' && typeof parentVerification.evidence === 'string' && parentVerification.evidence.trim() !== '';
  if (!parentPassed && failed.length === 0) failed.push({ id: 'parent', reason: 'parent acceptance verification did not pass' });
  return { failed, results, parentVerification };
}

module.exports = Object.freeze({ runTaskGraph });
