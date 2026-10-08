'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseInvocation } = require('./invocation');
const { prepareDispatch } = require('./dispatch');
const { validateTaskGraph, nodeTaskDigest } = require('./task-graph');
const { runTaskGraph } = require('./graph-runner');
const { cloneTaskValue, freezeTaskValue } = require('./task-contract');
const {
  exactWorkerTarget,
  createAuthorizationLedgerBuilder,
  askForProviderScope,
  capabilityRefreshScope,
} = require('./provider-permissions');
const { evaluateTargetPolicy, selectCapabilityEvidence } = require('./target-policy');
const { withWriterLease } = require('../references/execution-bundle/scripts/lib/dispatch-writer-lease');
const { executeSchedule } = require('../references/execution-bundle/scripts/lib/dispatch-scheduler');

const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'cursor']);
const AGENT_FOR_PROVIDER = Object.freeze({
  anthropic: 'claude-code', openai: 'codex-cli', google: 'agy', cursor: 'cursor',
});
const PROVIDER_FOR_AGENT = Object.freeze({
  'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', cursor: 'cursor',
});
const EXECUTION_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED', 'TIMEOUT']);
const ACCEPTANCE_STATUSES = new Set(['PASSED', 'FAILED', 'NOT_RUN', 'BLOCKED', 'RECONCILIATION_REQUIRED']);

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
const canonicalProvider = (value) => typeof value === 'string' && PROVIDERS.has(value) ? value : null;
const canonicalAgent = (value) => typeof value === 'string'
  ? ({ claude: 'claude-code', codex: 'codex-cli' }[value] || value)
  : null;

function makeReport({ status = 'BLOCKED', parser, executionStatus = 'NOT_RUN', acceptanceStatus = 'NOT_RUN',
  requested = null, resolved = null, observed = null, blockers = [], executionEvidence = null, acceptanceEvidence = null } = {}) {
  return Object.freeze({
    status,
    parser,
    execution: Object.freeze({ status: executionStatus, ...(executionEvidence ? { evidence: executionEvidence } : {}) }),
    acceptance: Object.freeze({ status: acceptanceStatus, ...(acceptanceEvidence ? { evidence: acceptanceEvidence } : {}) }),
    targets: Object.freeze({ requested, resolved, observed }),
    blockers: Object.freeze([...blockers]),
  });
}

function reportTarget(target) {
  if (!isRecord(target)) return null;
  const keys = ['target_agent', 'provider', 'model_id', 'model', 'effort', 'route', 'transport'];
  return Object.freeze(Object.fromEntries(keys
    .filter((key) => target[key] !== undefined && target[key] !== null)
    .map((key) => [key, target[key]])));
}

function validateTask(value) {
  if (!isRecord(value)) return { task: null, missing: ['task'] };
  let copiedAcceptance;
  let copiedConstraints;
  try {
    copiedAcceptance = cloneTaskValue(value.acceptance);
    copiedConstraints = cloneTaskValue(value.constraints);
  } catch (_) {
    return { task: null, missing: ['plain-data task constraints'] };
  }
  const missing = [];
  if (typeof value.goal !== 'string' || value.goal.trim() === '') missing.push('goal');
  if (!Array.isArray(copiedAcceptance) || copiedAcceptance.length === 0
      || copiedAcceptance.some((item) => typeof item !== 'string' || item.trim() === '')) missing.push('acceptance');
  if (!isRecord(copiedConstraints)) missing.push('constraints');
  if (missing.length > 0) return { task: null, missing };

  const task = {
    goal: value.goal,
    acceptance: [...copiedAcceptance],
    constraints: { ...copiedConstraints },
  };
  if (Object.prototype.hasOwnProperty.call(task.constraints, 'provider')
      && !canonicalProvider(task.constraints.provider)) {
    return { task: null, missing: ['a canonical task Provider constraint'] };
  }
  const authority = task.constraints.authority === undefined ? 'read-only' : task.constraints.authority;
  if (!['read-only', 'workspace-write'].includes(authority)) {
    return { task: null, missing: ['a valid task authority constraint'] };
  }
  const assignedFiles = task.constraints.assigned_files;
  if (authority === 'workspace-write'
      && (!Array.isArray(assignedFiles) || assignedFiles.length === 0)) {
    return { task: null, missing: ['a non-empty write scope assigned_files constraint'] };
  }
  if (assignedFiles !== undefined && (!Array.isArray(assignedFiles) || assignedFiles.some((file) => (
    typeof file !== 'string' || file.trim() === '' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')
  )))) {
    return { task: null, missing: ['safe relative assigned_files constraints'] };
  }
  if (Object.prototype.hasOwnProperty.call(task.constraints, 'strict_target')) {
    const strict = task.constraints.strict_target;
    if (!isRecord(strict) || !canonicalProvider(strict.provider)
      || !['claude-code', 'codex-cli', 'agy', 'cursor'].includes(canonicalAgent(strict.target_agent))
      || typeof strict.model_id !== 'string' || strict.model_id.trim() === ''
      || (strict.effort !== undefined && !['low', 'medium', 'high', 'max', 'xhigh', 'ultra'].includes(strict.effort))) {
      return { task: null, missing: ['a valid strict_target constraint'] };
    }
    task.constraints.strict_target = Object.freeze({
      provider: canonicalProvider(strict.provider),
      target_agent: canonicalAgent(strict.target_agent),
      model_id: strict.model_id,
      ...(strict.effort === undefined ? {} : { effort: strict.effort }),
    });
  }
  if (!verifyPromptEvidence(task.constraints.prompt_evidence)) {
    return { task: null, missing: ['Host-supplied prompt evidence'] };
  }
  task.constraints.authority = authority;
  task.constraints.assigned_files = assignedFiles ? Object.freeze([...assignedFiles]) : Object.freeze([]);
  return { task: freezeTaskValue(task), missing: [] };
}

function verifyPromptEvidence(evidence) {
  if (!isRecord(evidence) || typeof evidence.path !== 'string' || !path.isAbsolute(evidence.path)
      || !Number.isSafeInteger(evidence.dev) || evidence.dev < 0
      || !Number.isSafeInteger(evidence.ino) || evidence.ino < 0
      || !/^[a-f0-9]{64}$/.test(evidence.sha256 || '')) return false;
  try {
    const stat = fs.lstatSync(evidence.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== evidence.dev || stat.ino !== evidence.ino) return false;
    return crypto.createHash('sha256').update(fs.readFileSync(evidence.path)).digest('hex') === evidence.sha256;
  } catch (_) {
    return false;
  }
}

function selectedTarget(decision) {
  if (!isRecord(decision) || !isRecord(decision.target)) return null;
  const input = decision.target;
  const agent = canonicalAgent(input.target_agent || input.targetAgent);
  const provider = canonicalProvider(input.provider);
  const model = input.model_id || input.model;
  if (!provider || !model || typeof model !== 'string' || model.trim() === '' || input.route !== undefined) return null;
  const targetAgent = agent || AGENT_FOR_PROVIDER[provider];
  if (!targetAgent) return null;
  return {
    target: {
      target_agent: targetAgent,
      provider,
      model_id: model,
      ...(input.transport ? { transport: input.transport } : {}),
    },
    provider,
    effort: input.effort || null,
  };
}

function explicitTarget(options) {
  if (!options.workerTarget) return null;
  const alias = options.workerTarget.provider;
  const provider = ({ claude: 'anthropic', codex: 'openai', agy: 'google' })[alias] || null;
  const agent = ({ claude: 'claude-code', codex: 'codex-cli', agy: 'agy' })[alias];
  if (!provider || !agent || !options.workerTarget.model) return null;
  return { provider, target_agent: agent, model_id: options.workerTarget.model, effort: options.workerTarget.effort };
}

function targetMatches(actual, expected) {
  return Boolean(actual && expected
    && actual.provider === expected.provider
    && actual.target.target_agent === expected.target_agent
    && actual.target.model_id === expected.model_id
    && (!expected.effort || actual.effort === expected.effort));
}

function observedTargetIssue(observed, resolved, strictRequested) {
  if (!isRecord(observed)) return null;
  for (const key of ['provider', 'target_agent']) {
    if (observed[key] !== undefined && observed[key] !== resolved[key]) {
      return `observed ${key} ${observed[key]} does not match resolved ${key} ${resolved[key]}`;
    }
  }
  const requestedModel = strictRequested && strictRequested.model_id;
  if (requestedModel && observed.model_id !== undefined && observed.model_id !== requestedModel) {
    return `observed model ${observed.model_id} does not match strict requested model ${requestedModel}`;
  }
  if (strictRequested && strictRequested.effort && observed.effort !== undefined && observed.effort !== strictRequested.effort) {
    return `observed effort ${observed.effort} does not match strict requested effort ${strictRequested.effort}`;
  }
  return null;
}

function profileWithinScope(profile, allowedProviders) {
  const allowed = new Set(allowedProviders);
  const original = Array.isArray(profile.allowed_providers) ? profile.allowed_providers : [];
  const narrowed = original.filter((provider) => allowed.has(canonicalProvider(provider)));
  const access = Object.fromEntries(Object.entries(profile.access || {})
    .filter(([provider]) => allowed.has(canonicalProvider(provider))));
  const pairAllowed = (pair) => allowed.has(canonicalProvider(pair.provider) || PROVIDER_FOR_AGENT[canonicalAgent(pair.target_agent)]);
  const roleDefaults = Object.fromEntries(Object.entries(profile.role_defaults || {})
    .filter(([, pair]) => pairAllowed(pair)));
  const roleFallbacks = Object.fromEntries(Object.entries(profile.role_fallbacks || {})
    .map(([role, pairs]) => [role, pairs.filter(pairAllowed)]));
  return { ...profile, allowed_providers: narrowed, access, role_defaults: roleDefaults, role_fallbacks: roleFallbacks };
}

function taskIdentity(task) {
  const digest = task.constraints.prompt_evidence.sha256;
  return { digest, taskId: `flow-drive-${digest.slice(0, 16)}` };
}

function dispatchRequest(task, workdir, capabilities, target, effort, authorizedProviders, capabilityEvidence, executionBinding, strictTarget, role = 'worker') {
  const { digest, taskId } = taskIdentity(task);
  const hostProfile = profileWithinScope(capabilities.host_profile, authorizedProviders);
  const defaultEffort = hostProfile.role_defaults && hostProfile.role_defaults[role]
    && hostProfile.role_defaults[role].effort;

  return {
    change: { confirmed: true, change_id: taskId },
    request: {
      schema: 'dhpk.dispatch.request.v2',
      host_profile: hostProfile,
      task_id: taskId,
      attempt_id: `flow-drive-attempt-${crypto.randomUUID()}`,
      role,
      authority: task.constraints.authority,
      task: { description_digest: digest },
      scope: {
        workdir,
        assigned_files: [...task.constraints.assigned_files],
        prompt_evidence: { ...task.constraints.prompt_evidence },
      },
      target: target.target,
      ...(effort || (!capabilityEvidence && defaultEffort) ? { effort: effort || defaultEffort } : {}),
      ...(capabilityEvidence ? { capability_evidence: capabilityEvidence } : {}),
      ...(executionBinding ? { execution_binding: executionBinding } : {}),
      ...(strictTarget ? { strict_target: true } : {}),
      fallback: { allow: false, retry_budget: 0 },
      parallelism: { dependencies: [], max_concurrency: 1 },
    },
    catalog: capabilities.catalog,
  };
}

async function runFlowDrive(argv = [], { host, workdir = process.cwd(), authorizationEvidence } = {}) {
  const invocation = parseInvocation(argv);
  const notices = [...invocation.notices];
  const parserReport = () => Object.freeze({
    status: invocation.status,
    notices: Object.freeze([...notices]),
    ...(invocation.diagnostics.length ? { diagnostics: Object.freeze([...invocation.diagnostics]) } : {}),
  });
  let parser = parserReport();
  if (invocation.status !== 'ready') {
    return makeReport({ parser, blockers: invocation.diagnostics });
  }
  if (!host || typeof host.resolveTask !== 'function' || typeof host.getCapabilities !== 'function'
      || typeof host.coordinate !== 'function' || typeof host.execute !== 'function' || typeof host.verify !== 'function') {
    return makeReport({ parser, blockers: ['Host does not implement the Flow Drive runner contract'] });
  }

  const legacyOptions = [];
  if (invocation.options.plan.enabled) legacyOptions.push('--plan');
  if (invocation.options.reasoner) legacyOptions.push('--reasoner');
  if (invocation.options.architect === true) legacyOptions.push('--architect');
  if (legacyOptions.length > 0) {
    notices.push(`${legacyOptions.join(', ')} remain supported by the legacy Flow Drive path; the native single-task runner does not execute those extra roles.`);
    parser = parserReport();
    return makeReport({ parser, blockers: [`unsupported advanced selection: ${legacyOptions.join(', ')}`] });
  }
  if (invocation.options.architect === false) {
    notices.push('--no-architect is retained as a compatibility option; the native single-task runner does not start an architecture pass.');
    parser = parserReport();
  }
  if (invocation.options.crossProvider) {
    notices.push('--cross-provider opens a Provider-scope question when the Host supports it; the flag alone grants nothing.');
    parser = parserReport();
  }

  let resolvedTask;
  try {
    const validation = validateTask(await host.resolveTask(invocation.taskInput, { workdir }));
    if (!validation.task) {
      const missing = validation.missing.map((field) => `task ${field} is missing`);
      return makeReport({ parser, blockers: missing });
    }
    resolvedTask = validation.task;
  } catch (_) {
    return makeReport({ parser, blockers: ['Host could not resolve the task input'] });
  }

  let capabilities;
  const sessionId = `flow-drive-session-${crypto.randomUUID()}`;
  const bindingId = `flow-drive-binding-${crypto.randomUUID()}`;
  try {
    capabilities = await host.getCapabilities({
      workdir, session_id: sessionId, binding_id: bindingId,
      allow_external_probe: false,
      authorized_providers: Object.freeze([]),
      authorized_targets: Object.freeze([]),
    });
  } catch (_) {
    return makeReport({ parser, blockers: ['Host capability evidence is unavailable'] });
  }
  if (!isRecord(capabilities) || !isRecord(capabilities.host_profile) || !isRecord(capabilities.catalog)) {
    return makeReport({ parser, blockers: ['Host capabilities must provide a host_profile and catalog'] });
  }
  try {
    capabilities = freezeTaskValue(cloneTaskValue(capabilities));
  } catch (_) {
    return makeReport({ parser, blockers: ['Host capabilities must contain plain data'] });
  }
  const currentProvider = canonicalProvider(capabilities.host_profile.native_provider);
  if (!currentProvider) return makeReport({ parser, blockers: ['the current Provider is unknown'] });
  const currentHost = capabilities.host_profile.host;
  let hostAllowedProviders = Object.freeze(Array.isArray(capabilities.host_profile.allowed_providers)
    ? [...new Set(capabilities.host_profile.allowed_providers.map(canonicalProvider).filter(Boolean))]
    : [currentProvider]);
  const initialHostAccess = capabilities.host_profile.access || {};
  const hostPermitsScopedQuery = (provider) => {
    const access = initialHostAccess[provider];
    // UNAVAILABLE may be stale or route-specific; explicit permission blocks stay binding.
    return Boolean(access && ['AVAILABLE', 'NOT_RUN', 'UNAVAILABLE'].includes(String(access.status || '').toUpperCase()));
  };

  const cliTarget = exactWorkerTarget(invocation);
  const ledgerBuilder = createAuthorizationLedgerBuilder(currentProvider, authorizationEvidence, cliTarget);
  if (invocation.options.crossProvider) await askForProviderScope(host, capabilities, currentProvider, ledgerBuilder);
  const authorizationLedger = ledgerBuilder.snapshot();
  const refreshForSelectedTargets = async (targets) => {
    const refreshScope = capabilityRefreshScope(
      authorizationLedger,
      resolvedTask.constraints,
      targets.filter((target) => hostAllowedProviders.includes(target.provider)
        && hostPermitsScopedQuery(target.provider)),
    );
    if (refreshScope.authorized_targets.length === 0) return;
    try {
      const refreshed = await host.getCapabilities({
        workdir,
        session_id: sessionId,
        binding_id: bindingId,
        allow_external_probe: true,
        authorized_providers: Object.freeze([]),
        authorized_targets: Object.freeze(refreshScope.authorized_targets.map((target) => Object.freeze({ ...target }))),
      });
      if (isRecord(refreshed) && isRecord(refreshed.host_profile) && isRecord(refreshed.catalog)
          && refreshed.host_profile.host === currentHost
          && canonicalProvider(refreshed.host_profile.native_provider) === currentProvider) {
        const refreshedSnapshot = cloneTaskValue(refreshed);
        const refreshedAllowedProviders = Array.isArray(refreshedSnapshot.host_profile.allowed_providers)
          ? refreshedSnapshot.host_profile.allowed_providers.map(canonicalProvider).filter(Boolean)
          : hostAllowedProviders;
        hostAllowedProviders = Object.freeze(hostAllowedProviders.filter((provider) => refreshedAllowedProviders.includes(provider)));
        const mergedCapabilities = cloneTaskValue(capabilities);
        mergedCapabilities.host_profile.allowed_providers = [...hostAllowedProviders];
        const refreshedAccess = isRecord(refreshedSnapshot.host_profile.access) ? refreshedSnapshot.host_profile.access : {};
        for (const target of refreshScope.authorized_targets) {
          if (isRecord(refreshedAccess[target.provider])) {
            mergedCapabilities.host_profile.access[target.provider] = refreshedAccess[target.provider];
          }
        }
        const evidenceRecords = [
          ...(Array.isArray(mergedCapabilities.capability_evidence_records) ? mergedCapabilities.capability_evidence_records : []),
          ...(mergedCapabilities.capability_evidence ? [mergedCapabilities.capability_evidence] : []),
          ...(Array.isArray(refreshedSnapshot.capability_evidence_records) ? refreshedSnapshot.capability_evidence_records : []),
          ...(refreshedSnapshot.capability_evidence ? [refreshedSnapshot.capability_evidence] : []),
        ];
        if (evidenceRecords.length > 0) mergedCapabilities.capability_evidence_records = evidenceRecords;
        capabilities = freezeTaskValue(mergedCapabilities);
      } else {
        notices.push('Host scoped capability refresh was invalid; external targets remain unavailable.');
        parser = parserReport();
      }
    } catch (_) {
      notices.push('Host scoped capability evidence is unavailable; external targets remain unavailable.');
      parser = parserReport();
    }
  };

  let decision;
  try {
    decision = await host.coordinate(resolvedTask, {
      invocation, capabilities, workdir,
      authorization_ledger: authorizationLedger,
      allow_external_probe: false,
    });
  } catch (_) {
    return makeReport({ parser, blockers: ['Host could not coordinate the task'] });
  }
  if (decision && decision.mode === 'coordinated') {
    let graph;
    try { graph = validateTaskGraph(decision, resolvedTask.constraints); } catch (error) {
      return makeReport({ parser, acceptanceStatus: 'BLOCKED', blockers: [error.message] });
    }
    const evaluateGraphPolicies = () => graph.nodes.map((node) => {
      const target = selectedTarget({ target: node.target });
      return {
        node,
        policy: evaluateTargetPolicy({
          target,
          role: node.role,
          authority: node.authority,
          constraints: resolvedTask.constraints,
          invocation,
          ledger: authorizationLedger,
          hostAllowedProviders,
        }),
      };
    });
    let graphPolicies = evaluateGraphPolicies();
    if (graph.nodes.every((node) => node.role === 'worker') && graphPolicies.every((entry) => !entry.policy.allowed)) {
      return makeReport({
        status: 'BLOCKED',
        parser,
        acceptanceStatus: 'BLOCKED',
        blockers: graphPolicies.map(({ node, policy }) => `${node.id}: ${policy.reason}`),
      });
    }
    await refreshForSelectedTargets(graphPolicies.filter(({ policy }) => policy.allowed)
      .map(({ node, policy }) => ({ ...policy.target, role: node.role, authority: node.authority })));
    graphPolicies = evaluateGraphPolicies();
    if (graph.nodes.every((node) => node.role === 'worker') && graphPolicies.every((entry) => !entry.policy.allowed)) {
      return makeReport({
        status: 'BLOCKED',
        parser,
        acceptanceStatus: 'BLOCKED',
        blockers: graphPolicies.map(({ node, policy }) => `${node.id}: ${policy.reason}`),
      });
    }
    const graphResult = await runTaskGraph({
      graph, resolvedTask, capabilities, decision, host, invocation, workdir, sessionId, bindingId,
      currentProvider, authorizationLedger, taskIdentity, nodeTaskDigest, selectedTarget, dispatchRequest, prepareDispatch, withWriterLease, executeSchedule,
      verifyPromptEvidence, observedTargetIssue,
    });
    return makeReport({
      status: 'REPORTED',
      parser,
      executionStatus: graphResult.failed.length ? 'FAILED' : 'SUCCEEDED',
      acceptanceStatus: graphResult.failed.length ? 'BLOCKED' : 'PASSED',
      blockers: graphResult.failed.map((result) => `${result.id}: ${result.reason || result.status}`),
      acceptanceEvidence: graphResult.parentVerification && graphResult.parentVerification.evidence,
      executionEvidence: JSON.stringify(graphResult.results.map((result) => ({ id: result.id, status: result.status, ...(result.reason ? { reason: result.reason } : {}) }))),
    });
  }
  const requested = reportTarget(decision && decision.target);
  const selection = selectedTarget(decision);
  if (!selection) return makeReport({ parser, requested, blockers: ['Host coordination did not select a valid target'] });

  const exact = explicitTarget(invocation.options);
  if (invocation.options.workerTarget && !exact) {
    return makeReport({ parser, requested, blockers: ['the explicit worker target is invalid'] });
  }
  const workerAlias = invocation.options.worker;
  if (exact && workerAlias !== 'auto') {
    const exactBackend = ({ 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' })[exact.target_agent];
    if (workerAlias !== exactBackend) {
      notices.push('--worker-target takes precedence over --worker, matching the existing dispatch contract.');
      parser = parserReport();
    }
  }
  const strictConstraint = resolvedTask.constraints.strict_target || null;
  const policy = evaluateTargetPolicy({
    target: selection,
    role: 'worker',
    authority: resolvedTask.constraints.authority,
    constraints: resolvedTask.constraints,
    invocation,
    ledger: authorizationLedger,
    hostAllowedProviders,
  });
  if (!policy.allowed) return makeReport({ parser, requested, blockers: [policy.reason] });

  await refreshForSelectedTargets([{ ...policy.target, role: 'worker', authority: resolvedTask.constraints.authority }]);
  const refreshedPolicy = evaluateTargetPolicy({
    target: selection,
    role: 'worker',
    authority: resolvedTask.constraints.authority,
    constraints: resolvedTask.constraints,
    invocation,
    ledger: authorizationLedger,
    hostAllowedProviders,
  });
  if (!refreshedPolicy.allowed) return makeReport({ parser, requested, blockers: [refreshedPolicy.reason] });

  const authorizedProviders = [...new Set([
    ...authorizationLedger.providers,
    ...authorizationLedger.targets.map((grant) => grant.provider),
  ])];
  const evidenceSelection = selectCapabilityEvidence(
    capabilities, selection, 'worker', resolvedTask.constraints.authority, { session_id: sessionId, binding_id: bindingId },
  );
  if (evidenceSelection.status === 'blocked') {
    return makeReport({ parser, requested, blockers: [evidenceSelection.reason] });
  }
  const { taskId } = taskIdentity(resolvedTask);
  let prepared;
  try {
    prepared = prepareDispatch({
      ...dispatchRequest(resolvedTask, path.resolve(workdir), capabilities, selection, selection.effort, authorizedProviders, evidenceSelection.evidence, { session_id: sessionId, binding_id: bindingId }, Boolean(exact || strictConstraint)),
      change: { confirmed: true, change_id: taskId },
    });
  } catch (_) {
    return makeReport({ parser, requested, blockers: ['the selected target failed dispatch validation'] });
  }
  if (prepared.resolution.status !== 'RESOLVED') {
    return makeReport({ parser, requested, blockers: [prepared.resolution.reason || `dispatch target is ${prepared.resolution.status}`] });
  }

  const resolved = reportTarget(prepared.resolution.target);
  const context = {
    invocation, capabilities, decision, resolution: prepared.resolution, workdir,
    execution_binding: { session_id: sessionId, binding_id: bindingId },
    authorization_ledger: authorizationLedger,
  };
  let outcome;
  let verification;
  let scopeIssue = null;
  let observedIssue = null;
  try {
    const run = async () => {
      let scopeBefore = null;
      let executionStarted = false;
      let result;
      let accepted;
      if (resolvedTask.constraints.authority === 'workspace-write') {
        if (typeof host.inspectScope !== 'function') throw new Error('writer scope inspection is required');
        scopeBefore = await host.inspectScope(resolvedTask, { phase: 'pre', workdir });
      }
      try {
        const evidence = resolvedTask.constraints.prompt_evidence;
        if (!verifyPromptEvidence(evidence)) throw new Error('prompt evidence changed before execution');
        executionStarted = true;
        result = await host.execute(prepared.resolution.target, resolvedTask, context);
        if (isRecord(result) && EXECUTION_STATUSES.has(result.status)) {
          accepted = await host.verify(resolvedTask, result, context);
          observedIssue = observedTargetIssue(result.observed_target, prepared.resolution.target, exact || strictConstraint);
        }
      } finally {
        if (executionStarted && resolvedTask.constraints.authority === 'workspace-write') {
          try {
            const scopeAfter = await host.inspectScope(resolvedTask, { phase: 'post', workdir, baseline: scopeBefore, outcome: result || null });
            if (!scopeAfter || scopeAfter.within_scope !== true || scopeAfter.wip_preserved !== true) {
              scopeIssue = 'writer scope inspection did not prove assigned changes and WIP preservation';
            }
          } catch (_) {
            scopeIssue = 'writer scope inspection failed after execution';
          }
        }
      }
      return { result, verification: accepted };
    };
    const completed = resolvedTask.constraints.authority === 'workspace-write' ? withWriterLease(run) : run();
    const result = await completed;
    outcome = result.result;
    verification = result.verification;
  } catch (_) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: 'FAILED', requested, resolved,
      blockers: ['Host executor failed before returning an outcome', ...(scopeIssue ? [scopeIssue] : [])] });
  }
  if (!isRecord(outcome) || !EXECUTION_STATUSES.has(outcome.status)) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: 'BLOCKED', requested, resolved,
      blockers: ['Host executor returned an invalid outcome', ...(scopeIssue ? [scopeIssue] : [])] });
  }

  if (!verification) return makeReport({ status: 'REPORTED', parser, executionStatus: outcome.status, requested, resolved,
    observed: reportTarget(outcome.observed_target), blockers: ['Host acceptance verification failed to return a result', ...(scopeIssue ? [scopeIssue] : [])] });
  if (!isRecord(verification) || !ACCEPTANCE_STATUSES.has(verification.status)) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: outcome.status, requested, resolved,
      observed: reportTarget(outcome.observed_target), blockers: ['Host returned an invalid acceptance result', ...(scopeIssue ? [scopeIssue] : [])] });
  }

  const accepted = verification.status === 'PASSED';
  const acceptanceStatus = accepted && outcome.status === 'SUCCEEDED'
      && typeof verification.evidence === 'string' && verification.evidence.trim() !== ''
      && !observedIssue && !scopeIssue
    ? 'PASSED'
    : accepted ? 'BLOCKED' : verification.status;
  const blockers = [];
  if (verification.status === 'BLOCKED') blockers.push('acceptance remains blocked');
  if (accepted && acceptanceStatus === 'BLOCKED') {
    blockers.push('acceptance requires successful execution and non-empty verification evidence');
  }
  if (observedIssue) blockers.push(observedIssue);
  if (scopeIssue) blockers.push(scopeIssue);

  return makeReport({
    status: 'REPORTED',
    parser,
    executionStatus: outcome.status,
    acceptanceStatus,
    requested,
    resolved,
    observed: reportTarget(outcome.observed_target),
    executionEvidence: typeof outcome.evidence === 'string' ? outcome.evidence : null,
    acceptanceEvidence: typeof verification.evidence === 'string' ? verification.evidence : null,
    blockers,
  });
}

module.exports = Object.freeze({ runFlowDrive });
