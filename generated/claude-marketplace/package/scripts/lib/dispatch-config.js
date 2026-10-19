'use strict';

const { resolveTarget } = require('./dispatch-engine');
const { createHostProfile, createProviderModelCatalog, PROVIDERS, SUPPORT_STATUSES } = require('./dispatch-contract');
const DEFAULT_CATALOG = require('../../manifests/provider-model-catalog.json');
const DEFAULT_HOST_PROFILES = require('../../manifests/host-profiles.json');

const DEFAULTS = Object.freeze({
  orchestration_dispatch: 'on',
  worker_target: null,
  reasoner_target: null,
  planner_target: null,
  reviewer_target: null,
  preference_order: [],
  fallback_allow: true,
});

const LEGACY_KEYS = Object.freeze({
  worker_target: ['fast_worker_backend', 'fast_worker_model', 'codex_worker_model', 'codex_fast_worker_model', 'agy_worker_model', 'agy_fast_worker_model'],
  reasoner_target: ['deep_reasoner_model', 'codex_reasoner_model'],
  planner_target: ['planner_model'],
  reviewer_target: ['reviewer_model', 'codex_reviewer_model'],
});
const LEGACY_REMOVAL_VERSION = 'unscheduled';
const LEGACY_KEY_AGENTS = Object.freeze({
  fast_worker_model: 'claude-code',
  deep_reasoner_model: 'claude-code',
  planner_model: 'claude-code',
  reviewer_model: 'claude-code',
  codex_worker_model: 'codex-cli',
  codex_fast_worker_model: 'codex-cli',
  codex_reasoner_model: 'codex-cli',
  codex_reviewer_model: 'codex-cli',
  agy_worker_model: 'agy',
  agy_fast_worker_model: 'agy',
});
const LEGACY_EFFORT_KEYS = Object.freeze({
  fast_worker_model: ['fast_worker_effort'],
  deep_reasoner_model: ['deep_reasoner_effort'],
  planner_model: ['planner_effort'],
  reviewer_model: ['reviewer_effort'],
  codex_worker_model: ['codex_worker_effort', 'codex_fast_worker_effort'],
  codex_fast_worker_model: ['codex_worker_effort', 'codex_fast_worker_effort'],
  codex_reasoner_model: ['codex_reasoner_effort'],
  codex_reviewer_model: ['codex_reviewer_effort'],
  agy_worker_model: [],
  agy_fast_worker_model: [],
});
const PROVIDER_ALIASES = Object.freeze({
  'claude-code': 'anthropic',
  'codex-cli': 'openai',
  agy: 'google',
  'cursor-native': 'xai',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalProvider(value) {
  if (value === undefined || value === null) return value;
  return PROVIDER_ALIASES[value] || value;
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
    const targetAgent = value.target_agent || value.targetAgent || value.agent;
    const modelId = value.model_id || value.modelId || value.model;
    if (targetAgent) {
      if (!['claude', 'codex', 'agy', 'cursor', 'claude-code', 'codex-cli'].includes(targetAgent)) {
        throw new TypeError(`${label}.target_agent must identify a supported Target Agent`);
      }
      const canonicalAgent = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex-cli', 'codex-cli': 'codex-cli' }[targetAgent] || targetAgent;
      if (typeof modelId !== 'string' || !modelId) throw new TypeError(`${label}.model_id is required`);
      return {
        target_agent: canonicalAgent,
        model_id: modelId,
        ...(value.provider === undefined ? {} : { provider: value.provider }),
        ...(value.effort === undefined ? {} : { effort: value.effort }),
        ...(value.transport === undefined ? {} : { transport: value.transport }),
      };
    }
    if (typeof value.provider !== 'string' || !value.provider) throw new TypeError(`${label}.target_agent is required`);
    return { provider: value.provider, ...(modelId === undefined ? {} : { model_id: modelId }), ...(value.effort === undefined ? {} : { effort: value.effort }), ...(value.transport === undefined ? {} : { transport: value.transport }) };
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be an Agent/Model target`);
  const match = value.match(/^([^/]+)(?:\/([^:]+))?(?::([^:]+))?$/);
  if (!match || !match[2]) throw new TypeError(`${label} must use agent/model[:effort] syntax`);
  const aliases = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex-cli', 'codex-cli': 'codex-cli', agy: 'agy', cursor: 'cursor', native: 'cursor', 'cursor-native': 'cursor' };
  const providers = { anthropic: 'claude-code', openai: 'codex-cli', google: 'agy', xai: 'cursor' };
  const rawAgent = match[1];
  const targetAgent = aliases[rawAgent] || rawAgent;
  const legacyProvider = providers[rawAgent];
  if (!['claude', 'codex', 'agy', 'cursor', 'claude-code', 'codex-cli'].includes(targetAgent) && !legacyProvider) {
    throw new TypeError(`${label} must identify a supported Target Agent`);
  }
  const result = legacyProvider
    ? { target_agent: legacyProvider, model_id: match[2], provider: rawAgent }
    : { target_agent: targetAgent, model_id: match[2] };
  if (match[3]) result.effort = match[3];
  return result;
}

function layerValue(layers, canonical, legacyKeys) {
  for (const [name, layer] of layers) {
    if (!isRecord(layer)) continue;
    if (Object.prototype.hasOwnProperty.call(layer, canonical)) return { value: layer[canonical], source: `${name}.${canonical}`, legacy: false };
    for (const key of legacyKeys) {
      if (Object.prototype.hasOwnProperty.call(layer, key)) return { value: layer[key], source: `${name}.${key}`, legacy: true };
    }
  }
  return { value: undefined, source: undefined, legacy: false };
}

function firstPresent(values, keys) {
  for (const key of keys || []) {
    if (isRecord(values) && Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined && values[key] !== '') {
      return values[key];
    }
  }
  return undefined;
}

function hostedModelIds(hostProfiles = DEFAULT_HOST_PROFILES) {
  const ids = new Set();
  for (const profile of hostProfiles.profiles || []) {
    if (profile.native_model) ids.add(profile.native_model);
    for (const roleDefault of Object.values(profile.role_defaults || {})) {
      if (roleDefault && roleDefault.model_id) ids.add(roleDefault.model_id);
    }
  }
  return ids;
}

function resolveCatalogModel(raw, catalog = DEFAULT_CATALOG, hostProfiles = DEFAULT_HOST_PROFILES) {
  if (typeof raw !== 'string' || raw === '') return null;
  const models = Object.values(catalog.models || {});
  const exact = models.filter((model) => model.model_id === raw);
  if (exact.length === 1) return exact[0];
  const named = models.filter((model) => model.display_name === raw);
  if (named.length === 1) return named[0];
  const aliased = models.filter((model) => model.model_id.startsWith(raw) && model.model_id !== raw && /^[.-]?\d/.test(model.model_id.slice(raw.length)));
  if (aliased.length === 1) return aliased[0];
  if (aliased.length > 1) {
    const hosted = hostedModelIds(hostProfiles);
    const preferred = aliased.filter((model) => hosted.has(model.model_id));
    if (preferred.length === 1) return preferred[0];
  }
  return null;
}

function translateLegacyTarget({ role, sourceKey, value, layerValues }) {
  if (typeof value === 'string' && !value.includes('/') && sourceKey && sourceKey.includes('backend')) {
    const legacyProvider = { claude: 'claude-code', codex: 'codex-cli', agy: 'agy', native: 'cursor-native' }[value];
    if (legacyProvider) {
      const modelKeys = legacyProvider === 'codex-cli'
        ? (role === 'reasoner' ? ['codex_reasoner_model'] : ['codex_worker_model', 'codex_fast_worker_model'])
        : legacyProvider === 'agy'
          ? ['agy_worker_model', 'agy_fast_worker_model']
          : [role === 'worker' ? 'fast_worker_model' : role === 'reasoner' ? 'deep_reasoner_model' : `${role}_model`];
      const effortKeys = legacyProvider === 'codex-cli'
        ? (role === 'reasoner' ? ['codex_reasoner_effort'] : ['codex_worker_effort', 'codex_fast_worker_effort'])
        : [role === 'worker' ? 'fast_worker_effort' : role === 'reasoner' ? 'deep_reasoner_effort' : `${role}_effort`];
      const rawModel = firstPresent(layerValues, modelKeys);
      const identity = rawModel === undefined ? null : resolveCatalogModel(rawModel);
      const modelId = identity ? identity.model_id : rawModel;
      const effort = firstPresent(layerValues, effortKeys);
      return {
        provider: legacyProvider,
        ...(modelId === undefined ? {} : { model: modelId }),
        ...(effort === undefined ? {} : { effort }),
      };
    }
  }
  if (typeof value === 'string' && !value.includes('/') && LEGACY_KEY_AGENTS[sourceKey]) {
    const identity = resolveCatalogModel(value);
    if (!identity) {
      throw new TypeError(`${sourceKey} value ${JSON.stringify(value)} is not a Catalog model ID or published alias; migrate to agent/model[:effort]`);
    }
    const effort = firstPresent(layerValues, LEGACY_EFFORT_KEYS[sourceKey]);
    return {
      target_agent: LEGACY_KEY_AGENTS[sourceKey],
      model_id: identity.model_id,
      provider: identity.provider,
      ...(effort === undefined ? {} : { effort }),
    };
  }
  return value;
}

function resolveDispatchConfig({ project = {}, global = {}, environment = {} } = {}) {
  const layers = [['project', project], ['global', global], ['environment', environment]];
  const diagnostics = [];
  for (const [layerName, values] of layers) {
    for (const suffix of ['model', 'effort']) {
      const key = `codex_deep_reasoner_${suffix}`;
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        diagnostics.push({ field: 'reasoner_target', status: 'BLOCKED', source: `${layerName}.${key}`,
          reason: `retired config ${key} in 0.66.2; use codex_reasoner_${suffix}; rollback 0.66.1` });
      }
    }
    for (const key of ['architect_model', 'architect_effort']) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        diagnostics.push({
          field: key,
          status: 'UNSUPPORTED',
          source: `${layerName}.${key}`,
          reason: `${key} has no dispatch effect; it is not mapped onto reasoner_target and dispatch is unaffected`,
        });
      }
    }
  }
  const result = { ...DEFAULTS, source: {}, legacy_sources: [] };
  const switchValue = layerValue(layers, 'orchestration_dispatch', []);
  try {
    result.orchestration_dispatch = switchValue.value === undefined ? DEFAULTS.orchestration_dispatch : (switchValue.value === 'on' || switchValue.value === true ? 'on' : switchValue.value === 'off' || switchValue.value === false ? 'off' : (() => { throw new TypeError('orchestration_dispatch must be on or off'); })());
  } catch (error) { diagnostics.push({ field: 'orchestration_dispatch', status: 'BLOCKED', reason: error.message }); }
  result.source.orchestration_dispatch = switchValue.source || 'default';

  for (const role of ['worker', 'reasoner', 'planner', 'reviewer']) {
    const canonical = `${role}_target`;
    const selected = layerValue(layers, canonical, LEGACY_KEYS[canonical]);
    try {
      let targetValue = selected.value;
      if (selected.legacy) {
        const sourceParts = selected.source.split('.');
        const layer = layers.find(([name]) => name === sourceParts[0]);
        targetValue = translateLegacyTarget({
          role,
          sourceKey: sourceParts[1],
          value: targetValue,
          layerValues: layer ? layer[1] : {},
        });
      }
      result[canonical] = targetValue === undefined ? null : parseTarget(targetValue, canonical);
      result.source[canonical] = selected.source || 'default';
      if (selected.legacy) result.legacy_sources.push({ field: canonical, source: selected.source, diagnostic: 'legacy target input translated at compatibility boundary', removal_version: LEGACY_REMOVAL_VERSION });
      if (typeof targetValue === 'string' && /^(?:native|cursor-native|anthropic|openai|google|xai)\//.test(targetValue)) {
        result.legacy_sources.push({ field: canonical, source: selected.source || `${canonical}`, diagnostic: 'legacy provider/route target spelling translated at input boundary', removal_version: LEGACY_REMOVAL_VERSION });
      }
    } catch (error) {
      diagnostics.push({ field: canonical, status: 'BLOCKED', reason: error.message, source: selected.source });
    }
  }

  const order = layerValue(layers, 'preference_order', ['fast_worker_backend_order']);
  try {
    result.preference_order = order.value === undefined || order.value === '' ? [] : (Array.isArray(order.value) ? order.value : String(order.value).split(',')).map((item) => parseTarget(String(item).trim(), 'preference_order')).filter(Boolean);
    result.source.preference_order = order.source || 'default';
    if (order.legacy) result.legacy_sources.push({ field: 'preference_order', source: order.source, diagnostic: 'legacy backend order translated at compatibility boundary', removal_version: LEGACY_REMOVAL_VERSION });
  } catch (error) { diagnostics.push({ field: 'preference_order', status: 'BLOCKED', reason: error.message, source: order.source }); }

  const fallback = layerValue(layers, 'fallback_allow', ['fast_worker_fallback']);
  try {
    result.fallback_allow = fallback.value === undefined ? DEFAULTS.fallback_allow : fallback.value === 'none' ? false : fallback.value === 'claude' ? true : parseBoolean(fallback.value, 'fallback_allow');
    result.source.fallback_allow = fallback.source || 'default';
    if (fallback.legacy) result.legacy_sources.push({ field: 'fallback_allow', source: fallback.source, diagnostic: 'legacy fallback input translated at compatibility boundary', removal_version: LEGACY_REMOVAL_VERSION });
  } catch (error) { diagnostics.push({ field: 'fallback_allow', status: 'BLOCKED', reason: error.message, source: fallback.source }); }
  return Object.freeze({ ...result, source: Object.freeze(result.source), legacy_sources: Object.freeze(result.legacy_sources), diagnostics: Object.freeze(diagnostics) });
}

function diagnoseDispatchConfig({ config, catalog, hostProfile, role = 'worker', authority = 'workspace-write', effort = 'high', task, scope } = {}) {
  if (!config || !isRecord(config)) throw new TypeError('config is required');
  const selected = config[`${role}_target`];
  const catalogData = createProviderModelCatalog(catalog);
  const profile = hostProfile ? createHostProfile(hostProfile) : null;
  if (!selected) return Object.freeze({ catalog_support: 'NOT_RUN', host_access: 'NOT_RUN', runtime: 'NOT_RUN', fallback: config.fallback_allow ? 'allowed' : 'disabled', source: 'automatic-native-resolution' });
  if (!profile) throw new TypeError('hostProfile is required for an explicit target diagnostic');
  const normalizedAgent = selected.target_agent || selected.targetAgent || selected.agent;
  const canonicalAgent = ({ claude: 'claude-code', codex: 'codex-cli' }[normalizedAgent] || normalizedAgent);
  const provider = canonicalProvider(selected.provider)
    || ({ 'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', cursor: 'cursor' }[canonicalAgent]);
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
    fallback: config.fallback_allow ? 'allowed' : 'disabled',
    source: config.source[`${role}_target`] || 'default',
    ...(catalogSupport === SUPPORT_STATUSES[1] ? {
      reason: `unsupported Host/Role/model/effort combination for ${canonicalAgent}/${modelId}:${selectedEffort} on ${profile.host}; migrate to a Catalog route using agent/model[:effort]`,
    } : {}),
  });
}

function createDispatchConfigReport({ config } = {}) {
  if (!config || !isRecord(config)) throw new TypeError('config is required');
  const targets = Object.fromEntries(['worker', 'reasoner', 'planner', 'reviewer'].map((role) => [role, config[`${role}_target`] || null]));
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
      fallback: config.fallback_allow === true ? 'allowed' : 'disabled',
    },
    diagnostics: config.diagnostics || [],
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

module.exports = Object.freeze({ APPLY_ROLE_CONFIG: applyDispatchConfig, DEFAULTS, LEGACY_KEYS, LEGACY_REMOVAL_VERSION, applyDispatchConfig, createDispatchConfigReport, diagnoseDispatchConfig, parseTarget, resolveDispatchConfig });
