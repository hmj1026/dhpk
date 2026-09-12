'use strict';

const crypto = require('node:crypto');

const SCHEMAS = Object.freeze({
  REQUEST: 'dhpk.dispatch.request.v2',
  RECEIPT: 'dhpk.dispatch.receipt.v2',
  HOST_PROFILE: 'dhpk.host.profile.v1',
  HOST_PROFILES: 'dhpk.host.profiles.v1',
  CATALOG: 'dhpk.provider.model-catalog.v1',
  ACCESS_POLICY: 'dhpk.host.access-policy.v1',
});

const PROVIDERS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor-native']);
const HOSTS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor']);
const CANONICAL_ROLES = Object.freeze(['planner', 'reasoner', 'worker', 'reviewer']);
const AUTHORITIES = Object.freeze(['read-only', 'workspace-write']);
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'max']);
const TRANSPORTS = Object.freeze(['native-runtime', 'local-cli', 'app-server']);
const CAPABILITY_STATUSES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'BLOCKED', 'NOT_RUN']);
const TERMINAL_STATUSES = Object.freeze(['SUCCEEDED', 'FAILED', 'BLOCKED', 'TIMEOUT']);
const VERIFICATION_STATES = Object.freeze(['PASSED', 'FAILED', 'NOT_RUN', 'BLOCKED', 'RECONCILIATION_REQUIRED']);
const SIDE_EFFECT_STATES = Object.freeze(['none', 'observed', 'unknown']);
const MAX_AUTHORITY = Object.freeze({
  planner: 'read-only',
  reasoner: 'read-only',
  worker: 'workspace-write',
  reviewer: 'read-only',
});

const LEGACY_ROLE_ALIASES = Object.freeze({
  'codex-fast-worker': Object.freeze({ role: 'worker', provider: 'codex-cli', authority: 'workspace-write' }),
  'codex-deep-reasoner': Object.freeze({ role: 'reasoner', provider: 'codex-cli', authority: 'read-only' }),
  'agy-fast-worker': Object.freeze({ role: 'worker', provider: 'agy', authority: 'workspace-write' }),
});

const LEGACY_SCHEMAS = Object.freeze([
  'dhpk.cli.context.v1',
  'dhpk.cli.request.v1',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function freeze(value) {
  return deepFreeze(clone(value));
}

function requiredRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function boundedEvidence(value, label) {
  requiredString(value, label);
  if (value.length > 512 || /(?:bearer\s+|api[_-]?key|access[_-]?token|client[_-]?secret|password|-----begin)/i.test(value)) {
    throw new TypeError(`${label} must be concise non-secret evidence`);
  }
  return value;
}

function identifier(value, label) {
  requiredString(value, label);
  if (!IDENTIFIER.test(value)) throw new TypeError(`${label} must be a lexical identifier`);
  return value;
}

function oneOf(value, values, label) {
  if (!values.includes(value)) throw new TypeError(`${label} must be one of ${values.join(', ')}`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return [...new Set(value)];
}

function isoTimestamp(value, label) {
  requiredString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp`);
  return value;
}

function validatePromptEvidence(value) {
  const evidence = requiredRecord(value, 'scope.prompt_evidence');
  if (Object.keys(evidence).sort().join(',') !== 'dev,ino,path,sha256') {
    throw new TypeError('scope.prompt_evidence must contain exactly path, dev, ino, and sha256');
  }
  requiredString(evidence.path, 'scope.prompt_evidence.path');
  nonNegativeInteger(evidence.dev, 'scope.prompt_evidence.dev');
  nonNegativeInteger(evidence.ino, 'scope.prompt_evidence.ino');
  if (typeof evidence.sha256 !== 'string' || !SHA256.test(evidence.sha256)) {
    throw new TypeError('scope.prompt_evidence.sha256 must be lowercase SHA-256');
  }
  return {
    path: evidence.path,
    dev: evidence.dev,
    ino: evidence.ino,
    sha256: evidence.sha256,
  };
}

function createHostProfile(input) {
  const profile = requiredRecord(input, 'host_profile');
  if (profile.schema !== SCHEMAS.HOST_PROFILE) throw new TypeError(`host_profile.schema must be ${SCHEMAS.HOST_PROFILE}`);
  requiredString(profile.version, 'host_profile.version');
  oneOf(profile.host, HOSTS, 'host_profile.host');
  oneOf(profile.native_provider, PROVIDERS, 'host_profile.native_provider');
  requiredString(profile.native_model, 'host_profile.native_model');
  oneOf(profile.native_transport, TRANSPORTS, 'host_profile.native_transport');
  const allowed = uniqueStrings(profile.allowed_providers, 'host_profile.allowed_providers');
  allowed.forEach((provider) => oneOf(provider, PROVIDERS, 'host_profile.allowed_providers entry'));
  if (!allowed.includes(profile.native_provider)) throw new TypeError('host_profile.allowed_providers must include native_provider');

  const access = requiredRecord(profile.access, 'host_profile.access');
  for (const provider of allowed) {
    const entry = requiredRecord(access[provider], `host_profile.access.${provider}`);
    oneOf(entry.status, CAPABILITY_STATUSES, `host_profile.access.${provider}.status`);
    boundedEvidence(entry.evidence, `host_profile.access.${provider}.evidence`);
  }
  const quotaPools = requiredRecord(profile.quota_pools, 'host_profile.quota_pools');
  const limits = requiredRecord(profile.concurrency_limits, 'host_profile.concurrency_limits');
  for (const provider of allowed) {
    requiredString(quotaPools[provider], `host_profile.quota_pools.${provider}`);
    nonNegativeInteger(limits[quotaPools[provider]], `host_profile.concurrency_limits.${quotaPools[provider]}`);
  }
  isoTimestamp(profile.observed_at, 'host_profile.observed_at');

  return freeze({
    schema: SCHEMAS.HOST_PROFILE,
    version: profile.version,
    host: profile.host,
    native_provider: profile.native_provider,
    native_model: profile.native_model,
    native_transport: profile.native_transport,
    allowed_providers: allowed,
    access: profile.access,
    quota_pools: profile.quota_pools,
    concurrency_limits: profile.concurrency_limits,
    observed_at: profile.observed_at,
  });
}

function createProviderModelCatalog(input) {
  const catalog = requiredRecord(input, 'provider_model_catalog');
  if (catalog.schema !== SCHEMAS.CATALOG) throw new TypeError(`provider_model_catalog.schema must be ${SCHEMAS.CATALOG}`);
  requiredString(catalog.version, 'provider_model_catalog.version');
  isoTimestamp(catalog.observed_at, 'provider_model_catalog.observed_at');
  if (!Array.isArray(catalog.providers) || catalog.providers.length === 0) {
    throw new TypeError('provider_model_catalog.providers must be non-empty');
  }
  const providers = catalog.providers.map((entry) => {
    const provider = requiredRecord(entry, 'provider_model_catalog provider');
    oneOf(provider.provider, PROVIDERS, 'provider_model_catalog provider.provider');
    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      throw new TypeError(`provider ${provider.provider} must declare models`);
    }
    const models = provider.models.map((model) => {
      requiredRecord(model, `${provider.provider} model`);
      identifier(model.id, `${provider.provider} model.id`);
      requiredString(model.display_name, `${provider.provider}/${model.id} display_name`);
      const roles = uniqueStrings(model.roles, `${provider.provider}/${model.id} roles`);
      roles.forEach((role) => oneOf(role, CANONICAL_ROLES, 'model.roles entry'));
      const efforts = uniqueStrings(model.efforts, `${provider.provider}/${model.id} efforts`);
      efforts.forEach((effort) => oneOf(effort, EFFORTS, 'model.efforts entry'));
      const transports = uniqueStrings(model.transports, `${provider.provider}/${model.id} transports`);
      transports.forEach((transport) => oneOf(transport, TRANSPORTS, 'model.transports entry'));
      const authorities = uniqueStrings(model.authorities, `${provider.provider}/${model.id} authorities`);
      authorities.forEach((authority) => oneOf(authority, AUTHORITIES, 'model.authorities entry'));
      const effortMapping = model.effort_mapping === undefined ? {} : requiredRecord(model.effort_mapping, 'model.effort_mapping');
      for (const effort of efforts) requiredString(effortMapping[effort], `model.effort_mapping.${effort}`);
      return {
        id: model.id,
        display_name: model.display_name,
        roles,
        efforts,
        transports,
        authorities,
        effort_mapping: effortMapping,
      };
    });
    if (new Set(models.map((model) => model.id)).size !== models.length) {
      throw new TypeError(`provider ${provider.provider} contains duplicate model ids`);
    }
    return { provider: provider.provider, models };
  });
  if (new Set(providers.map((entry) => entry.provider)).size !== providers.length) {
    throw new TypeError('provider_model_catalog contains duplicate Providers');
  }
  return freeze({
    schema: SCHEMAS.CATALOG,
    version: catalog.version,
    observed_at: catalog.observed_at,
    providers,
  });
}

function createHostProfileSet(input) {
  const set = requiredRecord(input, 'host_profiles');
  if (set.schema !== SCHEMAS.HOST_PROFILES) throw new TypeError(`host_profiles.schema must be ${SCHEMAS.HOST_PROFILES}`);
  requiredString(set.version, 'host_profiles.version');
  isoTimestamp(set.observed_at, 'host_profiles.observed_at');
  if (!Array.isArray(set.profiles) || set.profiles.length === 0) throw new TypeError('host_profiles.profiles must be non-empty');
  const profiles = set.profiles.map(createHostProfile);
  const hosts = profiles.map((profile) => profile.host);
  if (new Set(hosts).size !== hosts.length) throw new TypeError('host_profiles must contain one profile per Host');
  return freeze({
    schema: SCHEMAS.HOST_PROFILES,
    version: set.version,
    observed_at: set.observed_at,
    profiles,
  });
}

function normalizeTarget(value) {
  if (value === undefined || value === null) return null;
  const target = requiredRecord(value, 'target');
  if (Object.keys(target).some((key) => !['provider', 'model', 'transport'].includes(key))) {
    throw new TypeError('target contains unsupported fields');
  }
  if (target.model !== undefined && target.model !== null) requiredString(target.model, 'target.model');
  if (target.model !== undefined && target.model !== null && !target.provider) {
    throw new TypeError('target.model requires a Provider-scoped target.provider');
  }
  if (target.provider !== undefined) oneOf(target.provider, PROVIDERS, 'target.provider');
  if (target.transport !== undefined) oneOf(target.transport, TRANSPORTS, 'target.transport');
  if (target.provider === undefined && target.transport !== undefined) {
    throw new TypeError('target.transport requires target.provider');
  }
  return {
    ...(target.provider === undefined ? {} : { provider: target.provider }),
    ...(target.model === undefined ? {} : { model: target.model }),
    ...(target.transport === undefined ? {} : { transport: target.transport }),
  };
}

function normalizeScope(value) {
  const scope = requiredRecord(value, 'scope');
  requiredString(scope.workdir, 'scope.workdir');
  if (!Array.isArray(scope.assigned_files) || scope.assigned_files.some((file) => (
    typeof file !== 'string' || file.trim() === '' || file.startsWith('/') || file.split(/[\\/]/).includes('..')
  ))) {
    throw new TypeError('scope.assigned_files must contain safe relative paths');
  }
  return {
    workdir: scope.workdir,
    assigned_files: [...scope.assigned_files],
    prompt_evidence: validatePromptEvidence(scope.prompt_evidence),
  };
}

function normalizeFallback(value) {
  const fallback = value === undefined ? {} : requiredRecord(value, 'fallback');
  if (fallback.allow !== undefined && typeof fallback.allow !== 'boolean') throw new TypeError('fallback.allow must be boolean');
  const retryBudget = fallback.retry_budget === undefined ? 0 : fallback.retry_budget;
  nonNegativeInteger(retryBudget, 'fallback.retry_budget');
  return { allow: fallback.allow === true, retry_budget: retryBudget };
}

function normalizeParallelism(value) {
  const parallelism = value === undefined ? {} : requiredRecord(value, 'parallelism');
  const dependencies = parallelism.dependencies === undefined ? [] : uniqueStrings(parallelism.dependencies, 'parallelism.dependencies');
  const maxConcurrency = parallelism.max_concurrency === undefined ? 1 : parallelism.max_concurrency;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) throw new TypeError('parallelism.max_concurrency must be a positive integer');
  return { dependencies, max_concurrency: maxConcurrency };
}

function normalizeTask(value) {
  const task = requiredRecord(value, 'task');
  if (typeof task.description_digest !== 'string' || !SHA256.test(task.description_digest)) {
    throw new TypeError('task.description_digest must be lowercase SHA-256');
  }
  return {
    description_digest: task.description_digest,
    ...(task.work_item_id === undefined ? {} : { work_item_id: identifier(task.work_item_id, 'task.work_item_id') }),
  };
}

function createDispatchRequest(input) {
  const request = requiredRecord(input, 'dispatch request');
  if (request.schema !== SCHEMAS.REQUEST) throw new TypeError(`dispatch request.schema must be ${SCHEMAS.REQUEST}`);
  const role = oneOf(request.role, CANONICAL_ROLES, 'role');
  const authority = oneOf(request.authority, AUTHORITIES, 'authority');
  if (MAX_AUTHORITY[role] === 'read-only' && authority !== 'read-only') {
    throw new TypeError(`${role} cannot use workspace-write authority`);
  }
  requiredString(request.task_id, 'task_id');
  requiredString(request.attempt_id, 'attempt_id');
  const hostProfile = createHostProfile(request.host_profile);
  const target = normalizeTarget(request.target);
  const normalized = {
    schema: SCHEMAS.REQUEST,
    host_profile: hostProfile,
    task_id: request.task_id,
    attempt_id: request.attempt_id,
    role,
    authority,
    task: normalizeTask(request.task),
    scope: normalizeScope(request.scope),
    ...(target === null ? {} : { target }),
    effort: oneOf(request.effort, EFFORTS, 'effort'),
    fallback: normalizeFallback(request.fallback),
    parallelism: normalizeParallelism(request.parallelism),
  };
  return freeze(normalized);
}

function createExecutionTarget(input) {
  const target = requiredRecord(input, 'execution target');
  const provider = oneOf(target.provider, PROVIDERS, 'execution target.provider');
  const model = target.model === undefined || target.model === null ? 'unknown' : requiredString(target.model, 'execution target.model');
  const effort = oneOf(target.effort, EFFORTS, 'execution target.effort');
  const transport = oneOf(target.transport, TRANSPORTS, 'execution target.transport');
  return freeze({
    provider,
    model,
    effort,
    transport,
    native: target.native === true,
    identity: `${provider}/${model}`,
  });
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createDispatchReceipt(input) {
  const receipt = requiredRecord(input, 'dispatch receipt');
  const request = createDispatchRequest(receipt.request);
  const status = oneOf(receipt.status, TERMINAL_STATUSES, 'receipt.status');
  const target = receipt.target === null || receipt.target === undefined ? null : createExecutionTarget(receipt.target);
  const failureClass = receipt.failure_class === undefined || receipt.failure_class === null
    ? null : requiredString(receipt.failure_class, 'receipt.failure_class');
  const sideEffects = oneOf(receipt.side_effects === undefined ? 'none' : receipt.side_effects, SIDE_EFFECT_STATES, 'receipt.side_effects');
  const verification = oneOf(receipt.verification === undefined ? 'NOT_RUN' : receipt.verification, VERIFICATION_STATES, 'receipt.verification');
  const fallbackHistory = receipt.fallback_history === undefined ? [] : receipt.fallback_history;
  if (!Array.isArray(fallbackHistory) || fallbackHistory.some((entry) => !isRecord(entry))) throw new TypeError('receipt.fallback_history must be an array of records');
  const fallbackKeys = new Set(['provider', 'model', 'transport', 'status', 'reason', 'failure_class', 'side_effects']);
  const normalizedFallbackHistory = [];
  for (const entry of fallbackHistory) {
    if (Object.keys(entry).some((key) => !fallbackKeys.has(key))) throw new TypeError('receipt.fallback_history contains unsupported evidence');
    if (entry.provider !== undefined) oneOf(entry.provider, PROVIDERS, 'receipt.fallback_history.provider');
    if (entry.model !== undefined) requiredString(entry.model, 'receipt.fallback_history.model');
    if (entry.transport !== undefined) oneOf(entry.transport, TRANSPORTS, 'receipt.fallback_history.transport');
    if (entry.status !== undefined) requiredString(entry.status, 'receipt.fallback_history.status');
    if (entry.reason !== undefined) boundedEvidence(entry.reason, 'receipt.fallback_history.reason');
    if (entry.failure_class !== undefined) requiredString(entry.failure_class, 'receipt.fallback_history.failure_class');
    if (entry.side_effects !== undefined) oneOf(entry.side_effects, SIDE_EFFECT_STATES, 'receipt.fallback_history.side_effects');
    normalizedFallbackHistory.push(Object.fromEntries(Object.entries(entry).filter(([key]) => fallbackKeys.has(key))));
  }
  const capabilityEvidence = receipt.capability_evidence === undefined ? null : requiredRecord(receipt.capability_evidence, 'receipt.capability_evidence');
  if (capabilityEvidence && Object.keys(capabilityEvidence).some((key) => !['status', 'evidence', 'source', 'provider', 'model', 'transport', 'observed_at'].includes(key))) {
    throw new TypeError('receipt.capability_evidence contains unsupported evidence');
  }
  if (capabilityEvidence) {
    if (capabilityEvidence.status !== undefined) oneOf(capabilityEvidence.status, CAPABILITY_STATUSES, 'receipt.capability_evidence.status');
    for (const key of ['evidence', 'source', 'observed_at']) {
      if (capabilityEvidence[key] !== undefined) boundedEvidence(capabilityEvidence[key], `receipt.capability_evidence.${key}`);
    }
    if (capabilityEvidence.provider !== undefined) oneOf(capabilityEvidence.provider, PROVIDERS, 'receipt.capability_evidence.provider');
    if (capabilityEvidence.transport !== undefined) oneOf(capabilityEvidence.transport, TRANSPORTS, 'receipt.capability_evidence.transport');
  }
  requiredString(receipt.receipt_id, 'receipt.receipt_id');
  const output = {
    schema: SCHEMAS.RECEIPT,
    receipt_id: receipt.receipt_id,
    task_id: request.task_id,
    attempt_id: request.attempt_id,
    host: request.host_profile.host,
    requested_role: request.role,
    authority: request.authority,
    requested_target: request.target || null,
    resolved_target: target,
    effort: request.effort,
    transport: target ? target.transport : null,
    status,
    failure_class: failureClass,
    side_effects: sideEffects,
    verification,
    fallback_history: normalizedFallbackHistory,
    scope: {
      assigned_files: [...request.scope.assigned_files],
      assigned_files_digest: digest(request.scope.assigned_files),
      prompt_evidence: {
        dev: request.scope.prompt_evidence.dev,
        ino: request.scope.prompt_evidence.ino,
        sha256: request.scope.prompt_evidence.sha256,
      },
    },
    assigned_files_digest: digest(request.scope.assigned_files),
    catalog_version: receipt.catalog_version === undefined ? null : requiredString(receipt.catalog_version, 'receipt.catalog_version'),
    host_profile_version: request.host_profile.version,
    adapter_version: receipt.adapter_version === undefined ? null : requiredString(receipt.adapter_version, 'receipt.adapter_version'),
    capability_evidence: capabilityEvidence,
    resolution_source: receipt.resolution_source === undefined ? 'dispatch-engine' : requiredString(receipt.resolution_source, 'receipt.resolution_source'),
  };
  return freeze(output);
}

function legacyProvider(value) {
  if (value === undefined || value === null || value === 'auto') return undefined;
  const map = { claude: 'claude-code', codex: 'codex-cli', agy: 'agy' };
  if (!map[value]) throw new TypeError(`unknown legacy backend: ${value}`);
  return map[value];
}

function legacyTransport(provider) {
  return provider === 'claude-code' || provider === 'cursor-native' ? 'native-runtime' : 'local-cli';
}

function normalizeLegacyTransport(value, provider) {
  if (value === undefined || value === null) return legacyTransport(provider);
  const map = { 'codex-exec': 'local-cli', 'agy-print': 'local-cli', native: 'native-runtime' };
  return map[value] || value;
}

function translateLegacyRequest(input) {
  const legacy = requiredRecord(input, 'legacy request');
  oneOf(legacy.schema, LEGACY_SCHEMAS, 'legacy request.schema');
  const requestedAlias = legacy.requested_role || legacy.role;
  requiredString(requestedAlias, 'legacy requested role');
  let mapping = LEGACY_ROLE_ALIASES[requestedAlias];
  if (!mapping && CANONICAL_ROLES.includes(requestedAlias)) mapping = { role: requestedAlias };
  if (!mapping && requestedAlias === 'codex-bridge') {
    if (!AUTHORITIES.includes(legacy.mode)) throw new TypeError('codex-bridge requires an explicit read-only or workspace-write mode');
    mapping = legacy.mode === 'read-only'
      ? { role: 'reviewer', provider: 'codex-cli', authority: 'read-only' }
      : { role: 'worker', provider: 'codex-cli', authority: 'workspace-write' };
  }
  if (!mapping) throw new TypeError(`unknown legacy role: ${requestedAlias}`);
  const authority = mapping.authority || legacy.authority || legacy.mode || MAX_AUTHORITY[mapping.role];
  if (legacy.mode !== undefined && legacy.mode !== authority) throw new TypeError(`legacy role ${requestedAlias} conflicts with authority ${legacy.mode}`);
  const provider = mapping.provider || legacyProvider(legacy.backend || legacy.execution_provider || legacy.provider);
  const model = legacy.requested_model || legacy.model;
  const target = provider === undefined ? undefined : {
    provider,
    ...(model === undefined ? {} : { model }),
    transport: normalizeLegacyTransport(legacy.transport, provider),
  };
  const request = createDispatchRequest({
    schema: SCHEMAS.REQUEST,
    host_profile: legacy.host_profile,
    task_id: legacy.task_id,
    attempt_id: legacy.attempt_id,
    role: mapping.role,
    authority,
    task: legacy.task,
    scope: legacy.scope,
    ...(target === undefined ? {} : { target }),
    effort: legacy.effort || 'medium',
    fallback: legacy.fallback,
    parallelism: legacy.parallelism,
  });
  return freeze({
    request,
    compatibility: {
      source_schema: legacy.schema,
      requested_alias: requestedAlias,
      canonical_role: mapping.role,
      provider_constraint: mapping.provider || null,
      deprecated: !CANONICAL_ROLES.includes(requestedAlias),
      diagnostic: !CANONICAL_ROLES.includes(requestedAlias)
        ? `legacy Role alias ${requestedAlias} translated to ${mapping.role}`
        : null,
    },
  });
}

module.exports = Object.freeze({
  AUTHORITIES,
  CANONICAL_ROLES,
  CAPABILITY_STATUSES,
  EFFORTS,
  HOSTS,
  LEGACY_ROLE_ALIASES,
  PROVIDERS,
  SCHEMAS,
  SIDE_EFFECT_STATES,
  TERMINAL_STATUSES,
  TRANSPORTS,
  VERIFICATION_STATES,
  createDispatchReceipt,
  createDispatchRequest,
  createExecutionTarget,
  createHostProfile,
  createHostProfileSet,
  createProviderModelCatalog,
  translateLegacyRequest,
});
