'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseInvocation } = require('./invocation');
const { prepareDispatch } = require('./dispatch');

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
  const missing = [];
  if (typeof value.goal !== 'string' || value.goal.trim() === '') missing.push('goal');
  if (!Array.isArray(value.acceptance) || value.acceptance.length === 0
      || value.acceptance.some((item) => typeof item !== 'string' || item.trim() === '')) missing.push('acceptance');
  if (!isRecord(value.constraints)) missing.push('constraints');
  if (missing.length > 0) return { task: null, missing };

  const task = {
    goal: value.goal,
    acceptance: [...value.acceptance],
    constraints: { ...value.constraints },
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
  task.acceptance = Object.freeze([...task.acceptance]);
  task.constraints = Object.freeze(task.constraints);
  return { task: Object.freeze(task), missing: [] };
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

function dispatchRequest(task, workdir, capabilities, target, effort, authorizedProviders, capabilityEvidence, executionBinding, strictTarget) {
  const { digest, taskId } = taskIdentity(task);
  const hostProfile = profileWithinScope(capabilities.host_profile, authorizedProviders);
  const defaultEffort = hostProfile.role_defaults && hostProfile.role_defaults.worker
    && hostProfile.role_defaults.worker.effort;

  return {
    change: { confirmed: true, change_id: taskId },
    request: {
      schema: 'dhpk.dispatch.request.v2',
      host_profile: hostProfile,
      task_id: taskId,
      attempt_id: `flow-drive-attempt-${crypto.randomUUID()}`,
      role: 'worker',
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

async function runFlowDrive(argv = [], { host, workdir = process.cwd() } = {}) {
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
    notices.push('--cross-provider is accepted, but this runner has no Provider question yet; the flag alone does not authorize another Provider.');
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
    capabilities = await host.getCapabilities({ workdir, session_id: sessionId, binding_id: bindingId });
  } catch (_) {
    return makeReport({ parser, blockers: ['Host capability evidence is unavailable'] });
  }
  if (!isRecord(capabilities) || !isRecord(capabilities.host_profile) || !isRecord(capabilities.catalog)) {
    return makeReport({ parser, blockers: ['Host capabilities must provide a host_profile and catalog'] });
  }
  const currentProvider = canonicalProvider(capabilities.host_profile.native_provider);
  if (!currentProvider) return makeReport({ parser, blockers: ['the current Provider is unknown'] });

  let decision;
  try {
    decision = await host.coordinate(resolvedTask, { invocation, capabilities, workdir });
  } catch (_) {
    return makeReport({ parser, blockers: ['Host could not coordinate the task'] });
  }
  const requested = reportTarget(decision && decision.target);
  const selection = selectedTarget(decision);
  if (!selection) return makeReport({ parser, requested, blockers: ['Host coordination did not select a valid target'] });

  const exact = explicitTarget(invocation.options);
  if (invocation.options.workerTarget && !exact) {
    return makeReport({ parser, requested, blockers: ['the explicit worker target is invalid'] });
  }
  if (exact && !targetMatches(selection, exact)) {
    return makeReport({ parser, requested, blockers: ['Host selection does not match the explicit worker target'] });
  }
  const workerAlias = invocation.options.worker;
  if (workerAlias !== 'auto' && !exact) {
    const selectedBackend = ({ 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' })[selection.target.target_agent];
    if (workerAlias !== selectedBackend) {
      return makeReport({ parser, requested, blockers: ['Host selection does not match the legacy worker selector'] });
    }
  }
  if (exact && workerAlias !== 'auto') {
    const exactBackend = ({ 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' })[exact.target_agent];
    if (workerAlias !== exactBackend) {
      notices.push('--worker-target takes precedence over --worker, matching the existing dispatch contract.');
      parser = parserReport();
    }
  }
  const taskProvider = Object.prototype.hasOwnProperty.call(resolvedTask.constraints, 'provider')
    ? canonicalProvider(resolvedTask.constraints.provider)
    : null;
  if (taskProvider && selection.provider !== taskProvider) {
    return makeReport({ parser, requested, blockers: ['selected Provider conflicts with the task constraint'] });
  }
  const strictConstraint = resolvedTask.constraints.strict_target || null;
  if (strictConstraint && (selection.provider !== strictConstraint.provider
    || selection.target.target_agent !== strictConstraint.target_agent
    || selection.target.model_id !== strictConstraint.model_id
    || (strictConstraint.effort !== undefined && selection.effort !== strictConstraint.effort))) {
    return makeReport({ parser, requested, blockers: ['Host selection does not match the strict task target'] });
  }
  // --cross-provider opens a later Host interaction; the flag itself does not widen this set.
  const authorizedProviders = [currentProvider, ...(exact ? [exact.provider] : [])];
  const { taskId } = taskIdentity(resolvedTask);
  let prepared;
  try {
    prepared = prepareDispatch({
      ...dispatchRequest(resolvedTask, path.resolve(workdir), capabilities, selection, selection.effort, authorizedProviders, capabilities.capability_evidence, { session_id: sessionId, binding_id: bindingId }, Boolean(exact || strictConstraint)),
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
  };
  let outcome;
  try {
    outcome = await host.execute(prepared.resolution.target, resolvedTask, context);
  } catch (_) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: 'FAILED', requested, resolved,
      blockers: ['Host executor failed before returning an outcome'] });
  }
  if (!isRecord(outcome) || !EXECUTION_STATUSES.has(outcome.status)) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: 'BLOCKED', requested, resolved,
      blockers: ['Host executor returned an invalid outcome'] });
  }

  let verification;
  try {
    verification = await host.verify(resolvedTask, outcome, context);
  } catch (_) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: outcome.status, requested, resolved,
      observed: reportTarget(outcome.observed_target), blockers: ['Host acceptance verification failed to return a result'] });
  }
  if (!isRecord(verification) || !ACCEPTANCE_STATUSES.has(verification.status)) {
    return makeReport({ status: 'REPORTED', parser, executionStatus: outcome.status, requested, resolved,
      observed: reportTarget(outcome.observed_target), blockers: ['Host returned an invalid acceptance result'] });
  }

  const accepted = verification.status === 'PASSED';
  const observedIssue = observedTargetIssue(outcome.observed_target, prepared.resolution.target, exact || strictConstraint);
  const acceptanceStatus = accepted && outcome.status === 'SUCCEEDED'
      && typeof verification.evidence === 'string' && verification.evidence.trim() !== ''
      && !observedIssue
    ? 'PASSED'
    : accepted ? 'BLOCKED' : verification.status;
  const blockers = [];
  if (verification.status === 'BLOCKED') blockers.push('acceptance remains blocked');
  if (accepted && acceptanceStatus === 'BLOCKED') {
    blockers.push('acceptance requires successful execution and non-empty verification evidence');
  }
  if (observedIssue) blockers.push(observedIssue);

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
