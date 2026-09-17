'use strict';

const crypto = require('node:crypto');

const SCHEMAS = Object.freeze({
  REQUEST: 'dhpk.dispatch.request.v2',
  RECEIPT: 'dhpk.dispatch.receipt.v2',
  HOST_PROFILE: 'dhpk.host.profile.v1',
  HOST_PROFILES: 'dhpk.host.profiles.v1',
  CATALOG: 'dhpk.model.catalog.v2',
  ACCESS_POLICY: 'dhpk.host.access-policy.v1',
});

// Provider is the model vendor.  A Host/Target-Agent is a separate dimension
// in the v2 catalog; in particular, Cursor is not a Provider and
// `cursor-native` is not a model identity.
const PROVIDERS = Object.freeze(['anthropic', 'openai', 'google', 'xai', 'cursor']);
const LEGACY_PROVIDERS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor-native']);
const HOSTS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor']);
// Long names are the canonical Target-Agent identities.  Short names are
// input aliases only; keeping the canonical value stable prevents a Host name
// or a Provider name from being mistaken for an execution route.
const TARGET_AGENTS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor']);
const ROUTES = Object.freeze(['native', 'headless-cli']);
const EFFORT_BINDINGS = Object.freeze(['parameter', 'embedded', 'unsupported']);
const CANONICAL_ROLES = Object.freeze(['planner', 'reasoner', 'worker', 'reviewer']);
const AUTHORITIES = Object.freeze(['read-only', 'workspace-write']);
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'max']);
const TRANSPORTS = Object.freeze(['native-runtime', 'local-cli', 'app-server']);
const CAPABILITY_STATUSES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'BLOCKED', 'NOT_RUN']);
const SUPPORT_STATUSES = Object.freeze(['SUPPORTED', 'UNSUPPORTED']);
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
  // Legacy Role aliases translate only Role and authority.  A provider-bound
  // alias must not silently constrain the canonical target; explicit target
  // selection remains an input-edge concern.
  'codex-fast-worker': Object.freeze({ role: 'worker', authority: 'workspace-write' }),
  'codex-deep-reasoner': Object.freeze({ role: 'reasoner', authority: 'read-only' }),
  'agy-fast-worker': Object.freeze({ role: 'worker', authority: 'workspace-write' }),
});

// Policy-facing names are deliberately a thin alias layer.  They describe a
// Role and its authority ceiling only; target Agent/Provider selection stays
// in the Host profile or an explicit request target.
const ROLE_ALIASES = Object.freeze({
  orchestrator: Object.freeze({ role: 'planner', authority: 'read-only' }),
  'spec-miner': Object.freeze({ role: 'planner', authority: 'read-only' }),
  architect: Object.freeze({ role: 'reasoner', authority: 'read-only' }),
  'deep-reasoner': Object.freeze({ role: 'reasoner', authority: 'read-only' }),
  'codex-reasoner': Object.freeze({ role: 'reasoner', authority: 'read-only' }),
  'fast-worker': Object.freeze({ role: 'worker', authority: 'workspace-write' }),
  'codex-worker': Object.freeze({ role: 'worker', authority: 'workspace-write' }),
  'agy-worker': Object.freeze({ role: 'worker', authority: 'workspace-write' }),
  'doc-reviewer': Object.freeze({ role: 'reviewer', authority: 'read-only' }),
  'code-reviewer': Object.freeze({ role: 'reviewer', authority: 'read-only' }),
  'security-reviewer': Object.freeze({ role: 'reviewer', authority: 'read-only' }),
  ...LEGACY_ROLE_ALIASES,
});

const LEGACY_SCHEMAS = Object.freeze([
  'dhpk.cli.context.v1',
  'dhpk.cli.request.v1',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;

const TARGET_AGENT_ALIASES = Object.freeze({
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex-cli',
  'codex-cli': 'codex-cli',
  agy: 'agy',
  cursor: 'cursor',
});
const LEGACY_VENDOR_MAP = Object.freeze({
  'claude-code': 'anthropic',
  'codex-cli': 'openai',
  agy: 'google',
  'cursor-native': 'xai',
});

function canonicalTargetAgent(value, label = 'target_agent') {
  requiredString(value, label);
  const canonical = TARGET_AGENT_ALIASES[value];
  if (!canonical) throw new TypeError(`${label} must identify a supported Target Agent`);
  return canonical;
}

function translatedTargetAgent(value, label = 'target_agent') {
  // `native` and `cursor-native` were route/provider spellings, not Agent
  // identities.  They are accepted only at an input compatibility boundary;
  // canonical catalog rows and normalized output always carry `cursor`.
  if (value === 'native' || value === 'cursor-native') return 'cursor';
  return canonicalTargetAgent(value, label);
}

function canonicalProvider(value, label = 'provider') {
  requiredString(value, label);
  if (LEGACY_VENDOR_MAP[value]) return LEGACY_VENDOR_MAP[value];
  return oneOf(value, PROVIDERS, label);
}

const PRICING_SENTINELS = Object.freeze(['unknown', 'subscription-included', 'not-published']);

function pricingValue(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a non-negative number or pricing sentinel`);
    return value;
  }
  requiredString(value, label);
  if (!PRICING_SENTINELS.includes(value)) {
    throw new TypeError(`${label} must be a non-negative number or pricing sentinel`);
  }
  return value;
}

function normalizePricing(value, label) {
  const pricing = requiredRecord(value, label);
  requiredString(pricing.unit, `${label}.unit`);
  const input = pricingValue(pricing.input, `${label}.input`);
  const output = pricingValue(pricing.output, `${label}.output`);
  requiredString(pricing.currency, `${label}.currency`);
  requiredString(pricing.source_url, `${label}.source_url`);
  isoTimestamp(pricing.observed_at, `${label}.observed_at`);
  return { unit: pricing.unit, input, output, currency: pricing.currency, source_url: pricing.source_url, observed_at: pricing.observed_at };
}

function routeForTarget({ targetAgent, host, transport } = {}) {
  const agent = canonicalTargetAgent(targetAgent, 'target_agent');
  if (transport === 'native-runtime' && ((host === 'cursor' && agent === 'cursor') ||
    (host === 'claude-code' && agent === 'claude-code') || (host === 'codex-cli' && agent === 'codex-cli') ||
    (host === 'agy' && agent === 'agy'))) return 'native';
  return 'headless-cli';
}

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
  const nativeProvider = canonicalProvider(profile.native_provider, 'host_profile.native_provider');
  identifier(profile.native_model, 'host_profile.native_model');
  oneOf(profile.native_transport, TRANSPORTS, 'host_profile.native_transport');
  const nativeTargetAgent = translatedTargetAgent(
    profile.native_target_agent || profile.native_agent || ({ 'claude-code': 'claude-code', 'codex-cli': 'codex-cli', agy: 'agy', cursor: 'cursor' }[profile.host] || profile.host),
    'host_profile.native_target_agent',
  );
  const nativeRoute = profile.native_route === undefined
    ? routeForTarget({ targetAgent: nativeTargetAgent, host: profile.host, transport: profile.native_transport })
    : oneOf(profile.native_route, ROUTES, 'host_profile.native_route');
  const allowed = uniqueStrings(profile.allowed_providers, 'host_profile.allowed_providers');
  allowed.forEach((provider) => canonicalProvider(provider, 'host_profile.allowed_providers entry'));
  const normalizedAllowed = [...new Set(allowed.map((provider) => canonicalProvider(provider, 'host_profile.allowed_providers entry')))];
  if (!normalizedAllowed.includes(nativeProvider)) throw new TypeError('host_profile.allowed_providers must include native_provider');

  const access = requiredRecord(profile.access, 'host_profile.access');
  for (const provider of normalizedAllowed) {
    const entry = requiredRecord(access[provider] || access[Object.entries(LEGACY_VENDOR_MAP).find(([, vendor]) => vendor === provider)?.[0]], `host_profile.access.${provider}`);
    oneOf(entry.status, CAPABILITY_STATUSES, `host_profile.access.${provider}.status`);
    boundedEvidence(entry.evidence, `host_profile.access.${provider}.evidence`);
  }
  const quotaPools = requiredRecord(profile.quota_pools, 'host_profile.quota_pools');
  const limits = requiredRecord(profile.concurrency_limits, 'host_profile.concurrency_limits');
  const normalizedQuotaPools = {};
  for (const provider of normalizedAllowed) {
    const pool = quotaPools[provider] || quotaPools[Object.entries(LEGACY_VENDOR_MAP).find(([, vendor]) => vendor === provider)?.[0]];
    requiredString(pool, `host_profile.quota_pools.${provider}`);
    nonNegativeInteger(limits[pool], `host_profile.concurrency_limits.${pool}`);
    normalizedQuotaPools[provider] = pool;
  }
  isoTimestamp(profile.observed_at, 'host_profile.observed_at');

  const normalizePair = (pair, label) => {
    const value = requiredRecord(pair, label);
    const targetAgent = translatedTargetAgent(value.target_agent || value.targetAgent || value.agent || nativeTargetAgent, `${label}.target_agent`);
    const provider = canonicalProvider(value.provider, `${label}.provider`);
    if (!normalizedAllowed.includes(provider)) throw new TypeError(`${label}.provider must be allowed by the Host profile`);
    const modelId = identifier(value.model_id || value.model, `${label}.model_id`);
    const effort = oneOf(value.effort, EFFORTS, `${label}.effort`);
    const transport = value.transport === undefined
      ? (targetAgent === nativeTargetAgent && provider === nativeProvider ? profile.native_transport : 'local-cli')
      : oneOf(value.transport, TRANSPORTS, `${label}.transport`);
    const route = value.route === undefined ? routeForTarget({ targetAgent, host: profile.host, transport }) : oneOf(value.route, ROUTES, `${label}.route`);
    if (label.includes('.role_defaults.') && route !== 'native') throw new TypeError(`${label}.route must be native for a Host/Role default`);
    return { target_agent: targetAgent, provider, model_id: modelId, effort, route, transport };
  };
  const roleDefaultsInput = profile.role_defaults === undefined ? {} : requiredRecord(profile.role_defaults, 'host_profile.role_defaults');
  const roleFallbacksInput = profile.role_fallbacks === undefined ? {} : requiredRecord(profile.role_fallbacks, 'host_profile.role_fallbacks');
  const roleDefaults = {};
  const roleFallbacks = {};
  for (const role of CANONICAL_ROLES) {
    if (roleDefaultsInput[role] !== undefined) roleDefaults[role] = normalizePair(roleDefaultsInput[role], `host_profile.role_defaults.${role}`);
    if (roleFallbacksInput[role] !== undefined) {
      if (!Array.isArray(roleFallbacksInput[role])) throw new TypeError(`host_profile.role_fallbacks.${role} must be an array`);
      roleFallbacks[role] = roleFallbacksInput[role].map((pair, index) => normalizePair(pair, `host_profile.role_fallbacks.${role}[${index}]`));
    }
    if (!roleDefaults[role]) roleDefaults[role] = {
      target_agent: nativeTargetAgent,
      provider: nativeProvider,
      model_id: profile.native_model,
      effort: role === 'worker' ? 'medium' : 'high',
      route: nativeRoute,
      transport: profile.native_transport,
    };
  }

  return freeze({
    schema: SCHEMAS.HOST_PROFILE,
    version: profile.version,
    host: profile.host,
    native_target_agent: nativeTargetAgent,
    native_provider: nativeProvider,
    native_model: profile.native_model,
    native_transport: profile.native_transport,
    native_route: nativeRoute,
    allowed_providers: normalizedAllowed,
    access: Object.fromEntries(normalizedAllowed.map((provider) => [provider, access[provider] || access[Object.entries(LEGACY_VENDOR_MAP).find(([, vendor]) => vendor === provider)?.[0]]])),
    quota_pools: normalizedQuotaPools,
    concurrency_limits: profile.concurrency_limits,
    observed_at: profile.observed_at,
    role_defaults: roleDefaults,
    role_fallbacks: Object.fromEntries(CANONICAL_ROLES.map((role) => [role, roleFallbacks[role] || []])),
  });
}

function createProviderModelCatalog(input) {
  const catalog = requiredRecord(input, 'provider_model_catalog');
  if (catalog.schema !== SCHEMAS.CATALOG) throw new TypeError(`provider_model_catalog.schema must be ${SCHEMAS.CATALOG}`);
  requiredString(catalog.version, 'provider_model_catalog.version');
  isoTimestamp(catalog.observed_at, 'provider_model_catalog.observed_at');
  const roleAliasesInput = catalog.role_aliases === undefined ? ROLE_ALIASES : requiredRecord(catalog.role_aliases, 'provider_model_catalog.role_aliases');
  const roleAliases = {};
  for (const [alias, rawAlias] of Object.entries(roleAliasesInput)) {
    identifier(alias, `provider_model_catalog.role_aliases.${alias}`);
    const aliasValue = requiredRecord(rawAlias, `provider_model_catalog.role_aliases.${alias}`);
    if (Object.keys(aliasValue).some((key) => !['role', 'authority'].includes(key))) throw new TypeError(`provider_model_catalog.role_aliases.${alias} must not pin a Provider`);
    roleAliases[alias] = { role: oneOf(aliasValue.role, CANONICAL_ROLES, `provider_model_catalog.role_aliases.${alias}.role`), authority: oneOf(aliasValue.authority, AUTHORITIES, `provider_model_catalog.role_aliases.${alias}.authority`) };
  }
  const modelsInput = requiredRecord(catalog.models, 'provider_model_catalog.models');
  const models = {};
  for (const [key, rawModel] of Object.entries(modelsInput)) {
    const model = requiredRecord(rawModel, `provider_model_catalog.models.${key}`);
    if (!PROVIDERS.includes(model.provider)) throw new TypeError(`provider_model_catalog.models.${key}.provider must be a canonical vendor Provider`);
    const provider = model.provider;
    const modelId = identifier(model.model_id || model.id, `provider_model_catalog.models.${key}.model_id`);
    if (modelId === 'cursor-default') throw new TypeError('cursor-default is a forbidden placeholder model');
    if (key !== `${provider}/${modelId}`) throw new TypeError(`model key ${key} must be ${provider}/${modelId}`);
    requiredString(model.display_name, `${key}.display_name`);
    const pricing = model.pricing === undefined ? undefined : normalizePricing(model.pricing, `${key}.pricing`);
    models[key] = {
      provider,
      model_id: modelId,
      display_name: model.display_name,
      ...(pricing === undefined ? {} : { pricing }),
    };
  }
  const routesInput = catalog.routes;
  if (!Array.isArray(routesInput) || routesInput.length === 0) throw new TypeError('provider_model_catalog.routes must be non-empty');
  const seenIdentities = new Set();
  const seenAliases = new Map();
  const routes = routesInput.map((rawRoute, index) => {
    const route = requiredRecord(rawRoute, `provider_model_catalog.routes[${index}]`);
    const host = oneOf(route.host, HOSTS, `routes[${index}].host`);
    if (!TARGET_AGENTS.includes(route.target_agent)) throw new TypeError(`routes[${index}].target_agent must be a canonical Target Agent`);
    const targetAgent = route.target_agent;
    if (!PROVIDERS.includes(route.provider)) throw new TypeError(`routes[${index}].provider must be a canonical vendor Provider`);
    const provider = route.provider;
    const modelId = identifier(route.model_id || route.model, `routes[${index}].model_id`);
    if (modelId === 'cursor-default') throw new TypeError('cursor-default is a forbidden placeholder model');
    const modelKey = `${provider}/${modelId}`;
    if (!models[modelKey]) throw new TypeError(`routes[${index}] references missing model ${modelKey}`);
    const routeName = oneOf(route.route, ROUTES, `routes[${index}].route`);
    const transport = oneOf(route.transport, TRANSPORTS, `routes[${index}].transport`);
    const roles = uniqueStrings(route.roles, `routes[${index}].roles`);
    roles.forEach((role) => oneOf(role, CANONICAL_ROLES, `routes[${index}].roles entry`));
    const rawEfforts = route.efforts === undefined
      ? (route.effort === undefined ? [] : [route.effort])
      : route.efforts;
    const efforts = uniqueStrings(rawEfforts, `routes[${index}].efforts`);
    efforts.forEach((effort) => oneOf(effort, EFFORTS, `routes[${index}].efforts entry`));
    const authorities = uniqueStrings(route.authorities, `routes[${index}].authorities`);
    authorities.forEach((authority) => oneOf(authority, AUTHORITIES, `routes[${index}].authorities entry`));
    const effortBinding = oneOf(route.effort_binding, EFFORT_BINDINGS, `routes[${index}].effort_binding`);
    if (effortBinding !== 'unsupported' && efforts.length === 0) {
      throw new TypeError(`routes[${index}] requires at least one effort for ${effortBinding} effort_binding`);
    }
    if (effortBinding === 'unsupported' && efforts.length > 0) {
      throw new TypeError(`routes[${index}] unsupported effort_binding cannot declare efforts`);
    }
    if (effortBinding === 'embedded' && efforts.length !== 1) {
      throw new TypeError(`routes[${index}] embedded effort_binding requires one flat row per effort`);
    }
    const aliases = route.invocation_aliases === undefined ? [] : uniqueStrings(route.invocation_aliases, `routes[${index}].invocation_aliases`);
    aliases.forEach((alias) => {
      if (seenAliases.has(alias)) throw new TypeError(`duplicate invocation alias ${alias} on routes[${index}] and ${seenAliases.get(alias)}`);
      seenAliases.set(alias, index);
    });
    const identity = [host, targetAgent, provider, modelId, routeName, transport, efforts.join(',')].join('|');
    if (seenIdentities.has(identity)) throw new TypeError(`duplicate route identity ${identity}`);
    seenIdentities.add(identity);
    requiredString(route.source, `routes[${index}].source`);
    const observedAt = route.observed_at || catalog.observed_at;
    isoTimestamp(observedAt, `routes[${index}].observed_at`);
    const parameterMapping = route.parameter_mapping === undefined ? {} : requiredRecord(route.parameter_mapping, `routes[${index}].parameter_mapping`);
    return {
      host,
      target_agent: targetAgent,
      provider,
      model_id: modelId,
      invocation_aliases: aliases,
      route: routeName,
      transport,
      roles,
      efforts,
      authorities,
      effort_binding: effortBinding,
      parameter_mapping: parameterMapping,
      source: route.source,
      observed_at: observedAt,
    };
  });

  // Keep a non-authoritative compatibility index for older resolver code.  It
  // is non-enumerable so v2's single source of truth remains models + routes.
  const providerIndex = {};
  for (const route of routes) {
    const model = models[`${route.provider}/${route.model_id}`];
    const entry = providerIndex[route.provider] || (providerIndex[route.provider] = new Map());
    const existing = entry.get(route.model_id) || {
      id: route.model_id,
      display_name: model.display_name,
      roles: [],
      efforts: [],
      transports: [],
      authorities: [],
      effort_mapping: {},
    };
    for (const field of ['roles', 'efforts', 'authorities']) existing[field] = [...new Set([...existing[field], ...route[field]])];
    existing.transports = [...new Set([...existing.transports, route.transport])];
    Object.assign(existing.effort_mapping, route.parameter_mapping && route.parameter_mapping.effort || {});
    entry.set(route.model_id, existing);
  }
  const compatibilityProviders = Object.entries(providerIndex).map(([provider, entries]) => ({ provider, models: [...entries.values()] }));
  const output = {
    schema: SCHEMAS.CATALOG,
    version: catalog.version,
    observed_at: catalog.observed_at,
    role_aliases: roleAliases,
    models,
    routes,
  };
  Object.defineProperty(output, 'providers', { value: compatibilityProviders, enumerable: false, writable: false });
  return deepFreeze(output);
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
  if (Object.prototype.hasOwnProperty.call(target, 'route')) {
    throw new TypeError('target.route is selected from the catalog and is not accepted at the request boundary');
  }
  if (Object.keys(target).some((key) => !['target_agent', 'targetAgent', 'agent', 'provider', 'model_id', 'model', 'transport'].includes(key))) {
    throw new TypeError('target contains unsupported fields');
  }
  const rawTargetAgent = target.target_agent || target.targetAgent || target.agent;
  const legacyProvider = target.provider !== undefined && LEGACY_PROVIDERS.includes(target.provider)
    ? target.provider
    : null;
  const targetAgent = rawTargetAgent || (legacyProvider === 'claude-code' ? 'claude-code'
    : legacyProvider === 'codex-cli' ? 'codex-cli'
      : legacyProvider === 'agy' ? 'agy'
        : legacyProvider === 'cursor-native' ? 'cursor' : undefined);
  const model = target.model_id || target.model;
  if (model !== undefined && model !== null) requiredString(model, 'target.model_id');
  if (targetAgent !== undefined) translatedTargetAgent(targetAgent, 'target.target_agent');
  if (target.provider !== undefined) canonicalProvider(target.provider, 'target.provider');
  if (model !== undefined && model !== null && !target.provider && !targetAgent) throw new TypeError('target.model_id requires a Target-Agent or Provider-scoped target');
  if (target.transport !== undefined) oneOf(target.transport, TRANSPORTS, 'target.transport');
  return {
    ...(targetAgent === undefined ? {} : { target_agent: translatedTargetAgent(targetAgent, 'target.target_agent') }),
    ...(target.provider === undefined ? {} : { provider: canonicalProvider(target.provider, 'target.provider') }),
    ...(model === undefined ? {} : { model_id: model }),
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
    ...(request.effort === undefined || request.effort === null ? {} : { effort: oneOf(request.effort, EFFORTS, 'effort') }),
    fallback: normalizeFallback(request.fallback),
    parallelism: normalizeParallelism(request.parallelism),
  };
  return freeze(normalized);
}

function createExecutionTarget(input) {
  const target = requiredRecord(input, 'execution target');
  const legacyProvider = LEGACY_PROVIDERS.includes(target.provider) ? target.provider : null;
  const targetAgent = translatedTargetAgent(target.target_agent || target.targetAgent || target.agent
    || (legacyProvider === 'claude-code' ? 'claude-code'
      : legacyProvider === 'codex-cli' ? 'codex-cli'
        : legacyProvider === 'agy' ? 'agy'
          : legacyProvider === 'cursor-native' ? 'cursor' : undefined), 'execution target.target_agent');
  const canonical = canonicalProvider(target.provider || ({ 'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', cursor: 'cursor' }[targetAgent]), 'execution target.provider');
  const provider = canonical;
  const model = target.model_id || target.model;
  const modelId = model === undefined || model === null ? 'unknown' : requiredString(model, 'execution target.model_id');
  const effort = oneOf(target.effort, EFFORTS, 'execution target.effort');
  const transport = oneOf(target.transport, TRANSPORTS, 'execution target.transport');
  const route = target.route === undefined
    ? routeForTarget({ targetAgent, host: target.host, transport })
    : oneOf(target.route, ROUTES, 'execution target.route');
  return freeze({
    target_agent: targetAgent,
    provider,
    model_id: modelId,
    model: modelId,
    effort,
    route,
    transport,
    native: target.native === true,
    identity: `${targetAgent}/${modelId}`,
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
  const fallbackKeys = new Set(['target_agent', 'provider', 'model_id', 'model', 'route', 'transport', 'status', 'reason', 'failure_class', 'side_effects']);
  const normalizedFallbackHistory = [];
  for (const entry of fallbackHistory) {
    if (Object.keys(entry).some((key) => !fallbackKeys.has(key))) throw new TypeError('receipt.fallback_history contains unsupported evidence');
    const normalizedEntry = {};
    if (entry.provider !== undefined) normalizedEntry.provider = canonicalProvider(entry.provider, 'receipt.fallback_history.provider');
    if (entry.target_agent !== undefined) normalizedEntry.target_agent = translatedTargetAgent(entry.target_agent, 'receipt.fallback_history.target_agent');
    if (entry.model_id !== undefined) normalizedEntry.model_id = requiredString(entry.model_id, 'receipt.fallback_history.model_id');
    else if (entry.model !== undefined) normalizedEntry.model_id = requiredString(entry.model, 'receipt.fallback_history.model');
    if (entry.route !== undefined) oneOf(entry.route, ROUTES, 'receipt.fallback_history.route');
    if (entry.transport !== undefined) oneOf(entry.transport, TRANSPORTS, 'receipt.fallback_history.transport');
    if (entry.status !== undefined) requiredString(entry.status, 'receipt.fallback_history.status');
    if (entry.reason !== undefined) boundedEvidence(entry.reason, 'receipt.fallback_history.reason');
    if (entry.failure_class !== undefined) requiredString(entry.failure_class, 'receipt.fallback_history.failure_class');
    if (entry.side_effects !== undefined) oneOf(entry.side_effects, SIDE_EFFECT_STATES, 'receipt.fallback_history.side_effects');
    if (entry.route !== undefined) normalizedEntry.route = entry.route;
    if (entry.transport !== undefined) normalizedEntry.transport = entry.transport;
    if (entry.status !== undefined) normalizedEntry.status = entry.status;
    if (entry.reason !== undefined) normalizedEntry.reason = entry.reason;
    if (entry.failure_class !== undefined) normalizedEntry.failure_class = entry.failure_class;
    if (entry.side_effects !== undefined) normalizedEntry.side_effects = entry.side_effects;
    normalizedFallbackHistory.push(normalizedEntry);
  }
  const rawCapabilityEvidence = receipt.capability_evidence === undefined ? null : requiredRecord(receipt.capability_evidence, 'receipt.capability_evidence');
  if (rawCapabilityEvidence && Object.keys(rawCapabilityEvidence).some((key) => !['status', 'evidence', 'source', 'provider', 'target_agent', 'model_id', 'model', 'route', 'effort', 'transport', 'observed_at', 'client_version', 'role', 'authority'].includes(key))) {
    throw new TypeError('receipt.capability_evidence contains unsupported evidence');
  }
  let capabilityEvidence = null;
  if (rawCapabilityEvidence) {
    capabilityEvidence = {};
    if (rawCapabilityEvidence.status !== undefined) {
      capabilityEvidence.status = oneOf(rawCapabilityEvidence.status, CAPABILITY_STATUSES, 'receipt.capability_evidence.status');
    }
    for (const key of ['evidence', 'source', 'observed_at']) {
      if (rawCapabilityEvidence[key] !== undefined) {
        if (key === 'observed_at') isoTimestamp(rawCapabilityEvidence[key], `receipt.capability_evidence.${key}`);
        else boundedEvidence(rawCapabilityEvidence[key], `receipt.capability_evidence.${key}`);
        capabilityEvidence[key] = rawCapabilityEvidence[key];
      }
    }
    if (rawCapabilityEvidence.client_version !== undefined) {
      boundedEvidence(rawCapabilityEvidence.client_version, 'receipt.capability_evidence.client_version');
      capabilityEvidence.client_version = rawCapabilityEvidence.client_version;
    }
    if (rawCapabilityEvidence.provider !== undefined) capabilityEvidence.provider = canonicalProvider(rawCapabilityEvidence.provider, 'receipt.capability_evidence.provider');
    if (rawCapabilityEvidence.target_agent !== undefined) capabilityEvidence.target_agent = translatedTargetAgent(rawCapabilityEvidence.target_agent, 'receipt.capability_evidence.target_agent');
    if (rawCapabilityEvidence.model_id !== undefined) capabilityEvidence.model_id = requiredString(rawCapabilityEvidence.model_id, 'receipt.capability_evidence.model_id');
    else if (rawCapabilityEvidence.model !== undefined) capabilityEvidence.model_id = requiredString(rawCapabilityEvidence.model, 'receipt.capability_evidence.model');
    if (rawCapabilityEvidence.role !== undefined) capabilityEvidence.role = oneOf(rawCapabilityEvidence.role, CANONICAL_ROLES, 'receipt.capability_evidence.role');
    if (rawCapabilityEvidence.authority !== undefined) capabilityEvidence.authority = oneOf(rawCapabilityEvidence.authority, AUTHORITIES, 'receipt.capability_evidence.authority');
    if (rawCapabilityEvidence.route !== undefined) capabilityEvidence.route = oneOf(rawCapabilityEvidence.route, ROUTES, 'receipt.capability_evidence.route');
    if (rawCapabilityEvidence.effort !== undefined) capabilityEvidence.effort = oneOf(rawCapabilityEvidence.effort, EFFORTS, 'receipt.capability_evidence.effort');
    if (rawCapabilityEvidence.transport !== undefined) capabilityEvidence.transport = oneOf(rawCapabilityEvidence.transport, TRANSPORTS, 'receipt.capability_evidence.transport');
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
  const map = { claude: 'claude-code', codex: 'codex-cli', agy: 'agy', 'cursor-native': 'cursor-native', native: 'cursor-native' };
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
  let mapping = ROLE_ALIASES[requestedAlias] || LEGACY_ROLE_ALIASES[requestedAlias];
  if (!mapping && CANONICAL_ROLES.includes(requestedAlias)) mapping = { role: requestedAlias };
  if (!mapping && requestedAlias === 'codex-bridge') {
    if (!AUTHORITIES.includes(legacy.mode)) throw new TypeError('codex-bridge requires an explicit read-only or workspace-write mode');
    mapping = legacy.mode === 'read-only'
      ? { role: 'reviewer', authority: 'read-only' }
      : { role: 'worker', authority: 'workspace-write' };
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
        ? `legacy Role alias ${requestedAlias} translated to ${mapping.role}; send an explicit target when a specific Agent is required`
        : null,
    },
  });
}

module.exports = Object.freeze({
  AUTHORITIES,
  CANONICAL_ROLES,
  CAPABILITY_STATUSES,
  SUPPORT_STATUSES,
  EFFORT_BINDINGS,
  EFFORTS,
  HOSTS,
  LEGACY_ROLE_ALIASES,
  ROLE_ALIASES,
  LEGACY_PROVIDERS,
  PRICING_SENTINELS,
  PROVIDERS,
  ROUTES,
  TARGET_AGENTS,
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
