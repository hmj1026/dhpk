'use strict';

const { resolveTarget } = require('./dispatch-engine');
const { createProviderModelCatalog } = require('./dispatch-contract');

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
  worker_target: ['fast_worker_backend', 'fast_worker_model', 'codex_fast_worker_model', 'agy_fast_worker_model'],
  reasoner_target: ['deep_reasoner_model', 'codex_reasoner_model', 'codex_deep_reasoner_model'],
  planner_target: ['planner_model'],
  reviewer_target: ['reviewer_model'],
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBoolean(value, label) {
  if (value === true || value === 'true' || value === '1' || value === 'on') return true;
  if (value === false || value === 'false' || value === '0' || value === 'off') return false;
  throw new TypeError(`${label} must be boolean`);
}

function parseTarget(value, label) {
  if (value === null || value === undefined || value === '' || value === 'auto') return null;
  if (isRecord(value)) {
    if (typeof value.provider !== 'string' || !value.provider) throw new TypeError(`${label}.provider is required`);
    return { provider: value.provider, ...(value.model === undefined ? {} : { model: value.model }), ...(value.effort === undefined ? {} : { effort: value.effort }), ...(value.transport === undefined ? {} : { transport: value.transport }) };
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be a Provider/Model target`);
  const match = value.match(/^([^/]+)(?:\/([^:]+))?(?::([^:]+))?$/);
  if (!match) throw new TypeError(`${label} must use provider/model[:effort] syntax`);
  const aliases = { claude: 'claude-code', codex: 'codex-cli', agy: 'agy', native: 'cursor-native' };
  if (!aliases[match[1]] && !['claude-code', 'codex-cli', 'agy', 'cursor-native'].includes(match[1])) throw new TypeError(`${label} must identify a supported Provider`);
  return {
    provider: aliases[match[1]] || match[1],
    ...(match[2] ? { model: match[2] } : {}),
    ...(match[3] ? { effort: match[3] } : {}),
  };
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

function resolveDispatchConfig({ project = {}, global = {}, environment = {} } = {}) {
  const layers = [['project', project], ['global', global], ['environment', environment]];
  const diagnostics = [];
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
      if (selected.legacy && typeof targetValue === 'string' && !targetValue.includes('/')) {
        const sourceParts = selected.source.split('.');
        const layer = layers.find(([name]) => name === sourceParts[0]);
        const sourceKey = sourceParts[1];
        const legacyProvider = { claude: 'claude-code', codex: 'codex-cli', agy: 'agy', native: 'cursor-native' }[targetValue];
        if (sourceKey && sourceKey.includes('backend') && layer && legacyProvider) {
          const values = layer[1];
          const modelKey = legacyProvider === 'codex-cli' ? (role === 'reasoner' ? 'codex_reasoner_model' : 'codex_fast_worker_model') : legacyProvider === 'agy' ? 'agy_fast_worker_model' : `${role}_model`;
          const effortKey = legacyProvider === 'codex-cli' ? (role === 'reasoner' ? 'codex_reasoner_effort' : 'codex_fast_worker_effort') : `${role}_effort`;
          targetValue = {
            provider: legacyProvider,
            ...(values[modelKey] === undefined ? {} : { model: values[modelKey] }),
            ...(values[effortKey] === undefined ? {} : { effort: values[effortKey] }),
          };
        }
      }
      result[canonical] = targetValue === undefined ? null : parseTarget(targetValue, canonical);
      result.source[canonical] = selected.source || 'default';
      if (selected.legacy) result.legacy_sources.push({ field: canonical, source: selected.source, diagnostic: 'legacy target input translated at compatibility boundary' });
    } catch (error) {
      diagnostics.push({ field: canonical, status: 'BLOCKED', reason: error.message, source: selected.source });
    }
  }

  const order = layerValue(layers, 'preference_order', ['fast_worker_backend_order']);
  try {
    result.preference_order = order.value === undefined || order.value === '' ? [] : (Array.isArray(order.value) ? order.value : String(order.value).split(',')).map((item) => parseTarget(String(item).trim(), 'preference_order')).filter(Boolean);
    result.source.preference_order = order.source || 'default';
    if (order.legacy) result.legacy_sources.push({ field: 'preference_order', source: order.source, diagnostic: 'legacy backend order translated at compatibility boundary' });
  } catch (error) { diagnostics.push({ field: 'preference_order', status: 'BLOCKED', reason: error.message, source: order.source }); }

  const fallback = layerValue(layers, 'fallback_allow', ['fast_worker_fallback']);
  try {
    result.fallback_allow = fallback.value === undefined ? DEFAULTS.fallback_allow : fallback.value === 'none' ? false : fallback.value === 'claude' ? true : parseBoolean(fallback.value, 'fallback_allow');
    result.source.fallback_allow = fallback.source || 'default';
    if (fallback.legacy) result.legacy_sources.push({ field: 'fallback_allow', source: fallback.source, diagnostic: 'legacy fallback input translated at compatibility boundary' });
  } catch (error) { diagnostics.push({ field: 'fallback_allow', status: 'BLOCKED', reason: error.message, source: fallback.source }); }
  return Object.freeze({ ...result, source: Object.freeze(result.source), legacy_sources: Object.freeze(result.legacy_sources), diagnostics: Object.freeze(diagnostics) });
}

function diagnoseDispatchConfig({ config, catalog, hostProfile, role = 'worker', authority = 'workspace-write', effort = 'high', task, scope } = {}) {
  if (!config || !isRecord(config)) throw new TypeError('config is required');
  const selected = config[`${role}_target`];
  const catalogData = createProviderModelCatalog(catalog);
  if (!selected) return Object.freeze({ catalog_support: 'NOT_RUN', host_access: 'NOT_RUN', runtime: 'NOT_RUN', fallback: config.fallback_allow ? 'allowed' : 'disabled', source: 'automatic-native-resolution' });
  const providerEntry = catalogData.providers.find((entry) => entry.provider === selected.provider);
  const catalogSupport = providerEntry && providerEntry.models.some((model) => (!selected.model || model.id === selected.model) && model.roles.includes(role) && model.efforts.includes(effort) && model.authorities.includes(authority)) ? 'AVAILABLE' : 'UNAVAILABLE';
  const hostAccess = hostProfile && hostProfile.access[selected.provider] ? hostProfile.access[selected.provider].status : 'BLOCKED';
  let runtime = hostAccess;
  if (task && scope && hostProfile) {
    const resolution = resolveTarget({ ...task, host_profile: hostProfile, role, authority, effort, target: selected, scope }, { catalog: catalogData });
    runtime = resolution.status === 'RESOLVED' ? 'AVAILABLE' : resolution.status;
  }
  return Object.freeze({ catalog_support: catalogSupport, host_access: hostAccess, runtime, fallback: config.fallback_allow ? 'allowed' : 'disabled', source: config.source[`${role}_target`] || 'default' });
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
    ? Object.fromEntries(Object.entries(selected).filter(([key]) => key !== 'effort'))
    : null;
  const fallback = isRecord(request.fallback) ? request.fallback : { retry_budget: 0 };
  return Object.freeze({
    ...request,
    ...(target && target.provider ? { target } : {}),
    ...(selected && selected.effort ? { effort: selected.effort } : {}),
    fallback: {
      ...fallback,
      ...(fallback.allow === undefined ? { allow: config.fallback_allow === true } : {}),
    },
  });
}

module.exports = Object.freeze({ APPLY_ROLE_CONFIG: applyDispatchConfig, DEFAULTS, LEGACY_KEYS, applyDispatchConfig, createDispatchConfigReport, diagnoseDispatchConfig, parseTarget, resolveDispatchConfig });
