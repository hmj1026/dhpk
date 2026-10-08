'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const SKILL_ROOT = path.resolve(__dirname, '..');
const EXECUTION_BUNDLE_ROOT = path.join(SKILL_ROOT, 'references', 'execution-bundle');
const bundleModule = (relativePath) => require(path.join(EXECUTION_BUNDLE_ROOT, relativePath));

const { createDispatchRequest } = bundleModule(path.join('scripts', 'lib', 'dispatch-contract'));
const { createFlowHandoff } = bundleModule(path.join('scripts', 'lib', 'flow-handoff-contract'));
const { resolveTarget } = bundleModule(path.join('scripts', 'lib', 'dispatch-engine'));
const { VALID_BACKENDS, resolveDispatchPlan } = bundleModule(path.join('scripts', 'lib', 'native-dispatch-policy'));
const DEFAULT_CATALOG = require(path.join(EXECUTION_BUNDLE_ROOT, 'manifests', 'provider-model-catalog.json'));
const HOST_PROFILES = require(path.join(EXECUTION_BUNDLE_ROOT, 'manifests', 'host-profiles.json'));
const { resolveConfig } = require(path.join(SKILL_ROOT, 'references', 'cli-dispatch', 'scripts', 'cli-role-resolver'));

const INVOCATION_SCHEMA = 'dhpk.flow-drive-invocation.v1';
const REQUEST_SCHEMA = 'dhpk.dispatch.request.v2';
const SHA256 = /^[a-f0-9]{64}$/;
const BACKEND_FOR_AGENT = Object.freeze({ 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' });
const PROVIDER_FOR_BACKEND = Object.freeze({ claude: 'anthropic', codex: 'openai', agy: 'google' });

const ROLE_AUTHORITY = Object.freeze({
  planner: 'read-only',
  reasoner: 'read-only',
  worker: 'workspace-write',
  reviewer: 'read-only',
});

function requireConfirmedChange(change) {
  if (!change || typeof change !== 'object' || change.confirmed !== true) {
    throw new Error('flow-drive requires a confirmed change before dispatch');
  }
  if (typeof change.change_id !== 'string' || change.change_id.trim() === '') {
    throw new Error('confirmed change requires change_id');
  }
  return change;
}

function bundledHostProfile(request) {
  if (request && request.host_profile) return request.host_profile;
  const host = request && (request.host || request.hostProfile);
  const profiles = HOST_PROFILES && Array.isArray(HOST_PROFILES.profiles) ? HOST_PROFILES.profiles : [];
  const profile = profiles.find((candidate) => candidate && candidate.host === host);
  if (!profile) {
    throw new Error(`flow-drive has no bundled Host profile for '${host || 'unspecified'}'; supply an explicit current profile`);
  }
  return profile;
}

function prepareDispatch({ change, request, catalog, preferenceOrder } = {}) {
  requireConfirmedChange(change);
  if (!request || typeof request !== 'object') throw new TypeError('dispatch request is required');
  const normalized = createDispatchRequest({
    ...request,
    host_profile: bundledHostProfile(request),
    role: request.role || 'worker',
    authority: request.authority || ROLE_AUTHORITY[request.role || 'worker'],
  });
  const resolution = resolveTarget(normalized, { catalog: catalog || DEFAULT_CATALOG, preferenceOrder });
  const handoff = createFlowHandoff({
    handoff_id: `flow-drive-${normalized.task_id}-${normalized.attempt_id}`,
    owner: 'flow-drive',
    host: normalized.host_profile.host,
    disposition: resolution.status === 'RESOLVED' ? 'ready' : 'blocked',
    target: resolution.target ? {
      provider: resolution.target.provider,
      ...(resolution.target.model === null ? {} : { model: resolution.target.model }),
      role: normalized.role,
      ...(resolution.target.effort === null ? {} : { effort: resolution.target.effort }),
      transport: resolution.target.transport,
    } : null,
    evidence: [{
      kind: 'dispatch-resolution',
      state: resolution.status === 'RESOLVED' ? 'available' : 'unavailable',
      detail: resolution.reason || 'Dispatch target resolved by the common engine',
    }],
    next_action: resolution.status === 'RESOLVED' ? 'execute the resolved target' : 'repair the blocked dispatch evidence',
  });
  return Object.freeze({ change_id: change.change_id, request: normalized, resolution, handoff });
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a JSON object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireAbsolutePath(value, label) {
  requireString(value, label);
  if (!path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return value;
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validatePacket(packet, promptEvidence) {
  requireRecord(packet, 'dispatch packet');
  const change = requireConfirmedChange(packet.change);
  const invocation = requireRecord(packet.invocation, 'invocation');
  if (invocation.schema !== INVOCATION_SCHEMA) throw new TypeError(`invocation.schema must be ${INVOCATION_SCHEMA}`);
  if (invocation.status !== 'ready') {
    const detail = Array.isArray(invocation.diagnostics) ? invocation.diagnostics.join('; ') : '';
    throw new Error(`flow-drive invocation is not parser-ready${detail ? `: ${detail}` : ''}`);
  }
  if (invocation.changeId !== change.change_id) throw new Error('invocation changeId must match the confirmed change_id');
  if (packet.role !== 'worker' && packet.role !== 'reasoner') throw new TypeError('role must be worker or reasoner');

  const hostProfile = requireRecord(packet.host_profile, 'host_profile');
  requireString(hostProfile.host, 'host_profile.host');
  requireString(packet.task_id, 'task_id');
  requireString(packet.attempt_id, 'attempt_id');
  const workdir = requireAbsolutePath(packet.workdir, 'workdir');
  const prompt = requireAbsolutePath(packet.prompt, 'prompt');
  if (!isWithin(workdir, prompt)) throw new TypeError('prompt must be contained by workdir');

  const scope = requireRecord(packet.scope, 'scope');
  const expectedScopeKeys = ['artifact_root', 'context_path', 'receipt_path', 'assigned_files', 'report_only', 'runtime_path'].sort();
  if (JSON.stringify(Object.keys(scope).sort()) !== JSON.stringify(expectedScopeKeys)) {
    throw new TypeError(`scope must contain exactly: ${expectedScopeKeys.join(', ')}`);
  }
  for (const key of ['artifact_root', 'context_path', 'receipt_path']) requireAbsolutePath(scope[key], `scope.${key}`);
  if (!isWithin(workdir, scope.artifact_root)
      || !isWithin(scope.artifact_root, scope.context_path) || !isWithin(scope.artifact_root, scope.receipt_path)
      || path.dirname(scope.context_path) !== path.resolve(scope.artifact_root)
      || path.dirname(scope.receipt_path) !== path.resolve(scope.artifact_root)) {
    throw new TypeError('scope artifact, context, and receipt paths must be explicitly contained by workdir and artifact_root');
  }
  if (!Array.isArray(scope.assigned_files) || scope.assigned_files.length === 0
      || scope.assigned_files.some((file) => typeof file !== 'string' || file.trim() === ''
        || path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) {
    throw new TypeError('scope.assigned_files must contain explicit safe relative paths');
  }
  if (typeof scope.report_only !== 'boolean') throw new TypeError('scope.report_only must be boolean');
  requireString(scope.runtime_path, 'scope.runtime_path');
  if (scope.runtime_path.split(path.delimiter).some((entry) => !path.isAbsolute(entry))) {
    throw new TypeError('scope.runtime_path must contain only absolute entries');
  }

  const config = requireRecord(packet.config, 'config');
  if (Object.keys(config).some((key) => !/^[a-z][a-z0-9_]*$/.test(key))) {
    throw new TypeError('config contains an invalid key');
  }
  const options = requireRecord(invocation.options, 'invocation.options');
  if (!['claude', 'codex', 'agy', 'auto'].includes(options.worker)) throw new TypeError('invocation.options.worker is invalid');
  if (typeof options.crossProvider !== 'boolean') throw new TypeError('invocation.options.crossProvider must be boolean');
  if (options.workerTarget !== null && options.workerTarget !== undefined) {
    requireRecord(options.workerTarget, 'invocation.options.workerTarget');
    if (!['claude', 'codex', 'agy'].includes(options.workerTarget.provider)) throw new TypeError('invocation worker target provider is invalid');
  }
  if (options.reasoner !== null && options.reasoner !== undefined) {
    requireRecord(options.reasoner, 'invocation.options.reasoner');
    if (!['claude', 'codex'].includes(options.reasoner.backend)) throw new TypeError('invocation reasoner backend is invalid');
  }

  requireRecord(promptEvidence, 'prompt evidence');
  if (promptEvidence.path !== prompt || !Number.isSafeInteger(promptEvidence.dev) || promptEvidence.dev < 0
      || !Number.isSafeInteger(promptEvidence.ino) || promptEvidence.ino < 0 || !SHA256.test(promptEvidence.sha256 || '')) {
    throw new TypeError('prompt evidence must identify the packet prompt with device, inode, and lowercase SHA-256');
  }
  if (packet.role === 'worker' && options.reasoner) {
    const result = requireRecord(packet.reasoner_result, 'reasoner_result');
    if (result.status !== 'READY_FOR_DISPATCH' || typeof result.evidence !== 'string' || result.evidence.trim() === '') {
      throw new Error('worker dispatch is blocked until the requested reasoner has READY_FOR_DISPATCH evidence');
    }
  }
  return { change, invocation, options, hostProfile, config, scope, workdir, prompt };
}

function resolvedCodexConfig(config, role, modelOverride, effortOverride) {
  const effectiveRole = role === 'worker' ? 'codex-worker' : 'codex-reasoner';
  const resolved = resolveConfig({ effectiveRole, config });
  const model = modelOverride === null || modelOverride === undefined ? resolved.model.value : modelOverride;
  const effort = effortOverride === null || effortOverride === undefined ? resolved.effort.value : effortOverride;
  const timeout = resolved.timeout_secs.value;
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error(`${effectiveRole} model must resolve from the invocation or configured role settings`);
  }
  if (typeof effort !== 'string' || effort.trim() === '') {
    throw new Error(`${effectiveRole} effort must resolve from the invocation or configured role settings`);
  }
  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new Error(`${effectiveRole} timeout must resolve to a non-negative integer before dispatch`);
  }
  return Object.freeze({ effectiveRole, model, effort, timeout });
}

function profilePair(profile, role, backend) {
  const defaults = profile.role_defaults && profile.role_defaults[role];
  const fallbacks = profile.role_fallbacks && profile.role_fallbacks[role];
  const pairs = [defaults, ...(Array.isArray(fallbacks) ? fallbacks : [])].filter(Boolean);
  return pairs.find((pair) => (BACKEND_FOR_AGENT[pair.target_agent]
    || Object.keys(PROVIDER_FOR_BACKEND).find((candidate) => PROVIDER_FOR_BACKEND[candidate] === pair.provider)) === backend) || null;
}

function profileCandidate(profile, role, backend, { model, effort, includeEffort = true } = {}) {
  const pair = profilePair(profile, role, backend);
  if (!pair) throw new Error(`Host profile has no ${backend} ${role} target for dispatch resolution`);
  return {
    target_agent: pair.target_agent,
    provider: pair.provider,
    ...(model || pair.model_id ? { model_id: model || pair.model_id } : {}),
    ...(includeEffort && (effort || pair.effort) ? { effort: effort || pair.effort } : {}),
    ...(pair.transport ? { transport: pair.transport } : {}),
  };
}

function configuredBackendOrder(config) {
  const value = config.fast_worker_backend_order;
  if (value === undefined) return [...VALID_BACKENDS];
  const order = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(',').map((backend) => backend.trim()).filter(Boolean) : null;
  if (!order || order.length === 0 || order.some((backend) => !VALID_BACKENDS.includes(backend))) {
    throw new TypeError('fast_worker_backend_order must list claude, codex, or agy');
  }
  return [...new Set(order)];
}

function configuredCrossProvider(config) {
  const value = config.cross_provider === undefined ? config.fast_worker_cross_provider : config.cross_provider;
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new TypeError('cross_provider config must be boolean');
}

function nativeBackend(profile) {
  const backend = BACKEND_FOR_AGENT[profile.native_target_agent]
    || Object.keys(PROVIDER_FOR_BACKEND).find((candidate) => PROVIDER_FOR_BACKEND[candidate] === profile.native_provider);
  if (!backend) throw new Error(`Host profile native target is not supported by Flow Drive dispatch policy`);
  return backend;
}

function baseRequest(packet, promptEvidence, role) {
  return {
    schema: REQUEST_SCHEMA,
    host_profile: packet.host_profile,
    task_id: packet.task_id,
    attempt_id: packet.attempt_id,
    role,
    authority: ROLE_AUTHORITY[role],
    task: { description_digest: promptEvidence.sha256 },
    scope: {
      workdir: packet.workdir,
      assigned_files: packet.scope.assigned_files,
      prompt_evidence: {
        path: promptEvidence.path,
        dev: promptEvidence.dev,
        ino: promptEvidence.ino,
        sha256: promptEvidence.sha256,
      },
    },
    fallback: { allow: false, retry_budget: 0 },
    parallelism: { dependencies: [], max_concurrency: 1 },
  };
}

function prepareInvocationDispatch(packet, promptEvidence) {
  const validated = validatePacket(packet, promptEvidence);
  const { change, invocation, options, hostProfile, config } = validated;
  const role = packet.role;
  const request = baseRequest(packet, promptEvidence, role);
  let preferenceOrder;
  let codexConfig = null;
  let prepared;

  const targetIsNative = (backend) => hostProfile.native_provider === PROVIDER_FOR_BACKEND[backend]
    && hostProfile.native_target_agent === Object.keys(BACKEND_FOR_AGENT).find((agent) => BACKEND_FOR_AGENT[agent] === backend);
  const codexTarget = (modelOverride, effortOverride) => {
    codexConfig = resolvedCodexConfig(config, role, modelOverride, effortOverride);
    return {
      target_agent: 'codex-cli',
      provider: 'openai',
      model_id: codexConfig.model,
      transport: 'local-cli',
    };
  };

  if (role === 'reasoner') {
    if (!options.reasoner) throw new Error('reasoner dispatch requires a parsed --reasoner selection');
    if (options.reasoner.backend === 'codex' && !targetIsNative('codex')) {
      request.target = codexTarget(options.reasoner.model, options.reasoner.effort);
      request.effort = codexConfig.effort;
    } else {
      const backend = options.reasoner.backend;
      const pair = profilePair(hostProfile, 'reasoner', backend);
      if (!pair) throw new Error(`Host profile has no ${backend} reasoner target`);
      request.target = profileCandidate(hostProfile, 'reasoner', backend, { model: options.reasoner.model, includeEffort: false });
      request.effort = pair.effort;
    }
  } else if (options.workerTarget) {
    const backend = options.workerTarget.provider;
    if (hostProfile.host === 'claude-code' && backend === 'agy') {
      throw new Error('AGY worker selection is unavailable on the Claude Code host');
    }
    if (backend === 'codex' && !targetIsNative('codex')) {
      request.target = codexTarget(options.workerTarget.model, options.workerTarget.effort);
      request.effort = codexConfig.effort;
    } else {
      const pair = profilePair(hostProfile, 'worker', backend);
      if (!pair) throw new Error(`Host profile has no ${backend} worker target`);
      request.target = profileCandidate(hostProfile, 'worker', backend, { model: options.workerTarget.model, includeEffort: false });
      request.effort = pair.effort;
    }
  } else {
    const configuredBackend = config.fast_worker_backend;
    if (configuredBackend !== undefined && !['auto', ...VALID_BACKENDS].includes(configuredBackend)) {
      throw new TypeError('fast_worker_backend must be auto, claude, codex, or agy');
    }
    const requestedBackend = options.worker === 'auto'
      ? configuredBackend || 'auto'
      : options.worker;
    const plan = resolveDispatchPlan({
      role: 'worker',
      requestedBackend,
      configuredOrder: configuredBackendOrder(config),
      nativeBackend: nativeBackend(hostProfile),
      crossProvider: options.crossProvider || configuredCrossProvider(config),
    });
    preferenceOrder = [];
    for (const backend of plan.candidates) {
      let candidate;
      if (backend === 'codex' && !targetIsNative('codex')) {
        codexConfig = resolvedCodexConfig(config, role, null, null);
        candidate = {
          target_agent: 'codex-cli',
          provider: 'openai',
          model_id: codexConfig.model,
          effort: codexConfig.effort,
          transport: 'local-cli',
        };
      } else {
        const pair = profilePair(hostProfile, 'worker', backend);
        if (!pair) throw new Error(`Host profile has no ${backend} worker target for dispatch resolution`);
        candidate = profileCandidate(hostProfile, 'worker', backend);
      }
      preferenceOrder = [...preferenceOrder, candidate];
      prepared = prepareDispatch({ change, request, preferenceOrder });
      if (prepared.resolution.status === 'RESOLVED') break;
    }
  }

  if (request.target && !request.effort) {
    const targetAgent = request.target.target_agent;
    const backend = BACKEND_FOR_AGENT[targetAgent];
    const pair = profilePair(hostProfile, role, backend);
    request.effort = pair && pair.effort;
  }

  if (!prepared) prepared = prepareDispatch({ change, request, preferenceOrder });
  let boundConfig = config;
  const resolvedTarget = prepared.resolution.target;
  if (prepared.resolution.status === 'RESOLVED' && resolvedTarget
      && resolvedTarget.target_agent === 'codex-cli'
      && resolvedTarget.provider === 'openai'
      && resolvedTarget.route === 'headless-cli'
      && resolvedTarget.transport === 'local-cli') {
    if (!codexConfig) codexConfig = resolvedCodexConfig(config, role, resolvedTarget.model_id, resolvedTarget.effort);
    const prefix = role === 'worker' ? 'codex_worker' : 'codex_reasoner';
    boundConfig = Object.freeze({
      ...config,
      [`${prefix}_model`]: resolvedTarget.model_id,
      [`${prefix}_effort`]: resolvedTarget.effort,
    });
  }
  return Object.freeze({ ...prepared, config: boundConfig });
}

module.exports = Object.freeze({ ROLE_AUTHORITY, prepareDispatch, prepareInvocationDispatch, requireConfirmedChange });
