'use strict';

const { resolveTarget } = require('./dispatch-engine');
const {
  AGENT_PROVIDER,
  createHostProfile,
  createProviderModelCatalog,
  PROVIDERS,
  SUPPORT_STATUSES,
  agentForAlias,
  agentForVendor,
  vendorFor,
} = require('./dispatch-contract');
const DEFAULT_CATALOG = require('../../manifests/provider-model-catalog.json');

const DEFAULTS = Object.freeze({
  orchestration_dispatch: 'on',
  worker_target: null,
  reasoner_target: null,
  planner_target: null,
  reviewer_target: null,
  preference_order: [],
  fallback_allow: true,
});

// Removed in 0.69.0. Keys are diagnosed only: a value found under one of them is
// never translated or applied. Value is the replacement key named in the diagnostic.
const REMOVED_IN_VERSION = '0.69.0';
const REMOVED_KEYS = Object.freeze({
  fast_worker_backend: 'worker_target',
  fast_worker_backend_order: 'preference_order',
  fast_worker_fallback: 'fallback_allow',
  fast_worker_model: 'worker_target',
  fast_worker_effort: 'worker_target',
  deep_reasoner_model: 'reasoner_target',
  deep_reasoner_effort: 'reasoner_target',
  planner_model: 'planner_target',
  planner_effort: 'planner_target',
  reviewer_model: 'reviewer_target',
  reviewer_effort: 'reviewer_target',
  codex_worker_model: 'worker_target',
  codex_fast_worker_model: 'worker_target',
  codex_worker_effort: 'worker_target',
  codex_fast_worker_effort: 'worker_target',
  agy_worker_model: 'worker_target',
  agy_fast_worker_model: 'worker_target',
  codex_reasoner_model: 'reasoner_target',
  codex_reasoner_effort: 'reasoner_target',
  codex_deep_reasoner_model: 'reasoner_target',
  codex_deep_reasoner_effort: 'reasoner_target',
  codex_reviewer_model: 'reviewer_target',
  codex_reviewer_effort: 'reviewer_target',
  codex_fast_worker_timeout_secs: 'codex_worker_timeout_secs',
  codex_deep_reasoner_timeout_secs: 'codex_reasoner_timeout_secs',
  codex_bridge_timeout_secs: 'codex_reviewer_timeout_secs',
  architect_model: 'reasoner_target',
  architect_effort: 'reasoner_target',
});
const LEGACY_REMOVAL_VERSION = '0.67.0';
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalProvider(value) {
  if (value === undefined || value === null) return value;
  return vendorFor(value);
}

function fallbackDiagnostic(allow) {
  return allow === true
    ? 'only UNAVAILABLE candidates advance; NOT_RUN and BLOCKED do not fall back'
    : 'disabled';
}

function parseBoolean(value, label) {
  if (value === true || value === 'true' || value === '1' || value === 'on') return true;
  if (value === false || value === 'false' || value === '0' || value === 'off') return false;
  throw new TypeError(`${label} must be boolean`);
}

function parseTarget(value, label) {
  if (value === null || value === undefined || value === '' || value === 'auto') return null;
  if (isRecord(value)) {
    if (Object.prototype.hasOwnProperty.call(value, 'route')) {
      throw new TypeError(`${label}.route is selected from the catalog and is not accepted at the config boundary`);
    }
    const rawAgent = value.target_agent || value.targetAgent || value.agent;
    const modelId = value.model_id || value.modelId || value.model;
    const legacyCursorProvider = value.provider === 'cursor-native' || value.provider === 'native';
    const provider = legacyCursorProvider ? undefined : value.provider;
    if (rawAgent) {
      if (agentForAlias(rawAgent) === undefined) {
        throw new TypeError(`${label}.target_agent must identify a supported Target Agent`);
      }
      if (typeof modelId !== 'string' || !modelId) throw new TypeError(`${label}.model_id is required`);
      return {
        target_agent: agentForAlias(rawAgent),
        model_id: modelId,
        ...(provider === undefined ? {} : { provider }),
        ...(value.effort === undefined ? {} : { effort: value.effort }),
        ...(value.transport === undefined ? {} : { transport: value.transport }),
      };
    }
    if (legacyCursorProvider) {
      if (typeof modelId !== 'string' || !modelId) throw new TypeError(`${label}.model_id is required`);
      return {
        target_agent: 'cursor',
        model_id: modelId,
        ...(value.effort === undefined ? {} : { effort: value.effort }),
        ...(value.transport === undefined ? {} : { transport: value.transport }),
      };
    }
    if (typeof provider !== 'string' || !provider) throw new TypeError(`${label}.target_agent is required`);
    return { provider, ...(modelId === undefined ? {} : { model_id: modelId }), ...(value.effort === undefined ? {} : { effort: value.effort }), ...(value.transport === undefined ? {} : { transport: value.transport }) };
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be an Agent/Model target`);
  const match = value.match(/^([^/]+)(?:\/([^:]+))?(?::([^:]+))?$/);
  if (!match || !match[2]) throw new TypeError(`${label} must use agent/model[:effort] syntax`);
  const rawAgent = match[1];
  const targetAgent = agentForAlias(rawAgent) || rawAgent;
  const legacyProvider = agentForVendor(rawAgent);
  if (!Object.prototype.hasOwnProperty.call(AGENT_PROVIDER, targetAgent) && !legacyProvider) {
    throw new TypeError(`${label} must identify a supported Target Agent`);
  }
  const result = legacyProvider
    ? { target_agent: legacyProvider, model_id: match[2], provider: rawAgent }
    : { target_agent: targetAgent, model_id: match[2] };
  if (match[3]) result.effort = match[3];
  return result;
}

function layerValue(layers, canonical) {
  for (const [name, layer] of layers) {
    if (!isRecord(layer)) continue;
    if (Object.prototype.hasOwnProperty.call(layer, canonical)) return { value: layer[canonical], source: `${name}.${canonical}` };
  }
  return { value: undefined, source: undefined };
}

function removedKeyDiagnostics(layers) {
  const found = [];
  for (const [layer, values] of layers) {
    if (!isRecord(values)) continue;
    for (const [key, replacement] of Object.entries(REMOVED_KEYS)) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      found.push({
        field: key,
        status: 'BLOCKED',
        layer,
        key,
        replacement,
        source: `${layer}.${key}`,
        reason: `removed in ${REMOVED_IN_VERSION}; use ${replacement}`,
      });
    }
  }
  return found;
}

function resolveDispatchConfig({ project = {}, global = {}, environment = {} } = {}) {
  const layers = [['project', project], ['global', global], ['environment', environment]];
  const diagnostics = removedKeyDiagnostics(layers);
  const result = { ...DEFAULTS, source: {}, legacy_sources: [] };
  const switchValue = layerValue(layers, 'orchestration_dispatch');
  try {
    result.orchestration_dispatch = switchValue.value === undefined ? DEFAULTS.orchestration_dispatch : (switchValue.value === 'on' || switchValue.value === true ? 'on' : switchValue.value === 'off' || switchValue.value === false ? 'off' : (() => { throw new TypeError('orchestration_dispatch must be on or off'); })());
  } catch (error) { diagnostics.push({ field: 'orchestration_dispatch', status: 'BLOCKED', reason: error.message }); }
  result.source.orchestration_dispatch = switchValue.source || 'default';

  for (const role of ['worker', 'reasoner', 'planner', 'reviewer']) {
    const canonical = `${role}_target`;
    const selected = layerValue(layers, canonical);
    try {
      const targetValue = selected.value;
      result[canonical] = targetValue === undefined ? null : parseTarget(targetValue, canonical);
      result.source[canonical] = selected.source || 'default';
      const legacyCursorObject = isRecord(targetValue) && (
        ['native', 'cursor-native'].includes(targetValue.target_agent || targetValue.targetAgent || targetValue.agent)
        || ['native', 'cursor-native'].includes(targetValue.provider)
      );
      if ((typeof targetValue === 'string' && /^(?:native|cursor-native|anthropic|openai|google|xai)\//.test(targetValue)) || legacyCursorObject) {
        result.legacy_sources.push({ field: canonical, source: selected.source || `${canonical}`, diagnostic: 'legacy provider/route target spelling translated at input boundary', removal_version: LEGACY_REMOVAL_VERSION });
      }
    } catch (error) {
      diagnostics.push({ field: canonical, status: 'BLOCKED', reason: error.message, source: selected.source });
    }
  }

  const order = layerValue(layers, 'preference_order');
  try {
    result.preference_order = order.value === undefined || order.value === '' ? [] : (Array.isArray(order.value) ? order.value : String(order.value).split(',')).map((item) => parseTarget(String(item).trim(), 'preference_order')).filter(Boolean);
    result.source.preference_order = order.source || 'default';
  } catch (error) { diagnostics.push({ field: 'preference_order', status: 'BLOCKED', reason: error.message, source: order.source }); }

  const fallback = layerValue(layers, 'fallback_allow');
  try {
    result.fallback_allow = fallback.value === undefined ? DEFAULTS.fallback_allow : fallback.value === 'none' ? false : fallback.value === 'claude' ? true : parseBoolean(fallback.value, 'fallback_allow');
    result.source.fallback_allow = fallback.source || 'default';
  } catch (error) { diagnostics.push({ field: 'fallback_allow', status: 'BLOCKED', reason: error.message, source: fallback.source }); }
  return Object.freeze({ ...result, source: Object.freeze(result.source), legacy_sources: Object.freeze(result.legacy_sources), diagnostics: Object.freeze(diagnostics) });
}

function diagnoseDispatchConfig({ config, catalog, hostProfile, role = 'worker', authority = 'workspace-write', effort = 'high', task, scope } = {}) {
  if (!config || !isRecord(config)) throw new TypeError('config is required');
  const selected = config[`${role}_target`];
  const catalogData = createProviderModelCatalog(catalog);
  const profile = hostProfile ? createHostProfile(hostProfile) : null;
  if (!selected) return Object.freeze({ catalog_support: 'NOT_RUN', host_access: 'NOT_RUN', runtime: 'NOT_RUN', fallback: fallbackDiagnostic(config.fallback_allow === true), source: 'automatic-native-resolution' });
  if (!profile) throw new TypeError('hostProfile is required for an explicit target diagnostic');
  const normalizedAgent = selected.target_agent || selected.targetAgent || selected.agent;
  const canonicalAgent = agentForAlias(normalizedAgent) || normalizedAgent;
  const provider = canonicalProvider(selected.provider) || AGENT_PROVIDER[canonicalAgent];
  const modelId = selected.model_id || selected.model;
  const selectedEffort = selected.effort || effort;
  const catalogSupport = catalogData.routes.some((route) => route.host === profile.host
    && route.provider === provider
    && (!canonicalAgent || route.target_agent === canonicalAgent)
    && (!modelId || route.model_id === modelId)
    && route.roles.includes(role) && route.efforts.includes(selectedEffort) && route.authorities.includes(authority))
    ? SUPPORT_STATUSES[0] : SUPPORT_STATUSES[1];
  const hostAccess = profile && profile.access[provider] ? profile.access[provider].status : 'BLOCKED';
  let runtime = 'NOT_RUN';
  if (task && scope && profile) {
    const resolution = resolveTarget({ ...task, host_profile: profile, role, authority, effort: selectedEffort, target: selected, scope }, { catalog: catalogData });
    runtime = resolution.status === 'RESOLVED' ? 'AVAILABLE' : resolution.status;
  }
  return Object.freeze({
    catalog_support: catalogSupport,
    host_access: hostAccess,
    runtime,
    fallback: fallbackDiagnostic(config.fallback_allow === true),
    source: config.source[`${role}_target`] || 'default',
    ...(catalogSupport === SUPPORT_STATUSES[1] ? {
      reason: `unsupported Host/Role/model/effort combination for ${canonicalAgent}/${modelId}:${selectedEffort} on ${profile.host}; migrate to a Catalog route using agent/model[:effort]`,
    } : {}),
  });
}

const REPORT_ROLES = Object.freeze(['planner', 'reasoner', 'worker', 'reviewer']);
function publicTargetFields(target) {
  if (!target || !isRecord(target)) return null;
  const out = {};
  for (const key of ['target_agent', 'provider', 'model_id', 'effort', 'route']) {
    if (target[key] !== undefined && target[key] !== null) out[key] = target[key];
  }
  return Object.keys(out).length ? Object.freeze(out) : null;
}

function coveredInputsReport(coveredInputs) {
  if (!isRecord(coveredInputs)) {
    return Object.freeze({ declared: false, complete: false });
  }
  const layers = Array.isArray(coveredInputs.layers) ? coveredInputs.layers.slice() : [];
  return Object.freeze({
    declared: true,
    complete: coveredInputs.complete === true,
    layers: Object.freeze(layers),
    project: coveredInputs.project === true,
    global: coveredInputs.global === true,
    environment: coveredInputs.environment === true,
    ...(typeof coveredInputs.scope === 'string' ? { scope: coveredInputs.scope } : {}),
    ...(Array.isArray(coveredInputs.unreadable) && coveredInputs.unreadable.length > 0
      ? { unreadable: Object.freeze(coveredInputs.unreadable.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
  });
}

function blockedRoleDiagnostic(diagnostics, role) {
  return (diagnostics || []).find((entry) => entry.field === `${role}_target` && entry.status === 'BLOCKED') || null;
}

function diagnoseRoleStatus({ config, catalog, hostProfile, role, selected }) {
  const fallback = fallbackDiagnostic(config.fallback_allow === true);
  const empty = Object.freeze({
    catalog_support: 'NOT_RUN',
    host_access: 'NOT_RUN',
    runtime: 'NOT_RUN',
    fallback,
  });
  if (!selected || !hostProfile) return empty;
  try {
    const result = diagnoseDispatchConfig({
      config: { ...config, [`${role}_target`]: selected },
      catalog,
      hostProfile,
      role,
      authority: role === 'worker' ? 'workspace-write' : 'read-only',
      effort: selected.effort || 'high',
    });
    return Object.freeze({
      catalog_support: result.catalog_support,
      host_access: result.host_access,
      runtime: 'NOT_RUN',
      fallback,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  } catch {
    return empty;
  }
}

function enrichExplicitTarget(selected, profile, catalogData, role) {
  const targetAgent = selected.target_agent;
  const provider = canonicalProvider(selected.provider) || AGENT_PROVIDER[targetAgent];
  const modelId = selected.model_id;
  const effort = selected.effort;
  const fields = {
    ...(targetAgent ? { target_agent: targetAgent } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { model_id: modelId } : {}),
    ...(effort ? { effort } : {}),
  };
  if (profile && catalogData && Array.isArray(catalogData.routes)) {
    const match = catalogData.routes.find((route) => route.host === profile.host
      && route.provider === provider
      && (!targetAgent || route.target_agent === targetAgent)
      && (!modelId || route.model_id === modelId)
      && route.roles.includes(role)
      && (!effort || route.efforts.includes(effort)));
    if (match && match.route) fields.route = match.route;
  }
  return publicTargetFields(fields);
}

function createDispatchConfigReport({ config, hostProfile, catalog, coveredInputs } = {}) {
  if (!config || !isRecord(config)) throw new TypeError('config is required');
  const targets = Object.fromEntries(REPORT_ROLES.map((role) => [role, config[`${role}_target`] || null]));
  const diagnostics = config.diagnostics || [];
  const profile = hostProfile ? createHostProfile(hostProfile) : null;
  const catalogInput = catalog || DEFAULT_CATALOG;
  let catalogData = null;
  try {
    catalogData = createProviderModelCatalog(catalogInput);
  } catch {
    catalogData = null;
  }

  const roles = {};
  for (const role of REPORT_ROLES) {
    const canonical = `${role}_target`;
    const blocked = blockedRoleDiagnostic(diagnostics, role);
    const selected = config[canonical] || null;
    const configuredSource = (config.source && config.source[canonical])
      || (blocked && blocked.source)
      || 'default';
    const configuredTarget = blocked ? null : (selected ? publicTargetFields(selected) : 'auto');
    const defaultPair = profile && profile.role_defaults ? profile.role_defaults[role] : null;
    const defaultSource = defaultPair ? `host_profile.role_defaults.${role}` : null;
    let effectiveTarget = null;
    let effectiveSource = null;
    if (blocked) {
      effectiveTarget = null;
      effectiveSource = null;
    } else if (selected) {
      effectiveTarget = enrichExplicitTarget(selected, profile, catalogData, role);
      effectiveSource = configuredSource;
    } else if (defaultPair) {
      effectiveTarget = publicTargetFields(defaultPair);
      effectiveSource = defaultSource;
    }
    const fallbackCandidates = profile && Array.isArray(profile.role_fallbacks[role])
      ? profile.role_fallbacks[role].map((pair) => publicTargetFields(pair)).filter(Boolean)
      : [];
    roles[role] = Object.freeze({
      configured_target: configuredTarget,
      configured_source: configuredSource,
      effective_target: effectiveTarget,
      effective_source: effectiveSource,
      default_source: defaultSource,
      status: diagnoseRoleStatus({
        config,
        catalog: catalogInput,
        hostProfile: profile,
        role,
        selected: blocked ? null : (selected || defaultPair),
      }),
      fallback: Object.freeze({
        allow: config.fallback_allow === true,
        kind: 'candidate_policy',
        selected: false,
        executed: false,
        candidates: Object.freeze(fallbackCandidates),
      }),
    });
  }

  const report = {
    schema: 'dhpk.dispatch.config-report.v1',
    orchestration_dispatch: config.orchestration_dispatch,
    targets,
    sources: config.source || {},
    legacy_sources: config.legacy_sources || [],
    status: {
      catalog_support: 'NOT_RUN',
      host_access: 'NOT_RUN',
      runtime: 'NOT_RUN',
      fallback: fallbackDiagnostic(config.fallback_allow === true),
    },
    diagnostics,
    covered_inputs: coveredInputsReport(coveredInputs),
    host: profile
      ? Object.freeze({ id: profile.host, status: 'known', execution: 'not executed' })
      : Object.freeze({ id: null, status: 'unresolved', execution: 'not executed' }),
    roles: Object.freeze(roles),
  };
  return Object.freeze(report);
}

function applyDispatchConfig({ config, role = 'worker', request } = {}) {
  if (!config || !isRecord(config)) throw new TypeError('config is required');
  if (!isRecord(request)) throw new TypeError('request is required');
  const selected = config[`${role}_target`];
  const target = selected && isRecord(selected)
    ? Object.fromEntries(Object.entries(selected).filter(([key]) => !['effort', 'model'].includes(key)))
    : null;
  const fallback = isRecord(request.fallback) ? request.fallback : { retry_budget: 0 };
  return Object.freeze({
    ...request,
    ...(target && (target.target_agent || target.provider) ? { target } : {}),
    ...(selected && selected.effort ? { effort: selected.effort } : {}),
    fallback: {
      ...fallback,
      ...(fallback.allow === undefined ? { allow: config.fallback_allow === true } : {}),
    },
  });
}

const ROLE_CONFIG = Object.freeze({
  'codex-worker': Object.freeze({ role: 'worker', agent: 'codex-cli', prefix: 'codex_worker' }),
  'codex-reasoner': Object.freeze({ role: 'reasoner', agent: 'codex-cli', prefix: 'codex_reasoner' }),
  'codex-reviewer': Object.freeze({ role: 'reviewer', agent: 'codex-cli', prefix: 'codex_reviewer' }),
  'agy-worker': Object.freeze({ role: 'worker', agent: 'agy', prefix: 'agy_worker' }),
  worker: Object.freeze({ role: 'worker', agent: 'codex-cli', prefix: 'codex_worker' }),
  planner: Object.freeze({ role: 'planner', agent: null, prefix: 'planner' }),
  reasoner: Object.freeze({ role: 'reasoner', agent: null, prefix: 'reasoner' }),
  reviewer: Object.freeze({ role: 'reviewer', agent: null, prefix: 'reviewer' }),
});

function roleConfigEntry(value, source) {
  return value === undefined || value === null || value === ''
    ? { value: undefined, source: undefined }
    : { value, source };
}

// Per-Role model, effort, and timeout from a flat config object. Model and effort come
// from the canonical `<role>_target` when it names the Role's Target Agent; the timeout
// comes from `<prefix>_timeout_secs`. Removed keys are never read.
function resolveRoleConfig({ role, config = {} } = {}) {
  const entry = Object.prototype.hasOwnProperty.call(ROLE_CONFIG, role) ? ROLE_CONFIG[role] : null;
  if (!entry) return Object.freeze({ status: 'BLOCKED', reason: `unknown role: ${role}` });
  const targetKey = `${entry.role}_target`;
  let target = null;
  try {
    target = isRecord(config) ? parseTarget(config[targetKey], targetKey) : null;
  } catch (error) {
    return Object.freeze({ status: 'BLOCKED', reason: error.message });
  }
  const applies = target && (entry.agent === null || target.target_agent === entry.agent);
  const timeoutKey = `${entry.prefix}_timeout_secs`;
  return Object.freeze({
    model: roleConfigEntry(applies ? target.model_id : undefined, targetKey),
    effort: roleConfigEntry(applies ? target.effort : undefined, targetKey),
    timeout_secs: roleConfigEntry(isRecord(config) ? config[timeoutKey] : undefined, timeoutKey),
  });
}

// Fail-closed reader for callers that take a single flat config: every removed
// key present is reported with its replacement, never silently ignored.
function removedKeyReasons(config) {
  if (!isRecord(config)) return [];
  return Object.entries(REMOVED_KEYS)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(config, key))
    .map(([key, replacement]) => `removed config key ${key} in ${REMOVED_IN_VERSION}; use ${replacement}`);
}

module.exports = Object.freeze({
  APPLY_ROLE_CONFIG: applyDispatchConfig,
  DEFAULTS,
  LEGACY_REMOVAL_VERSION,
  REMOVED_KEYS,
  applyDispatchConfig,
  createDispatchConfigReport,
  diagnoseDispatchConfig,
  parseTarget,
  removedKeyReasons,
  resolveDispatchConfig,
  resolveRoleConfig,
});
