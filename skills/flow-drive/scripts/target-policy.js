'use strict';

const { targetGrantMatches } = require('./provider-permissions');

const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'cursor']);
const AGENT_FOR_ALIAS = Object.freeze({ claude: 'claude-code', codex: 'codex-cli', agy: 'agy' });
const BACKEND_FOR_AGENT = Object.freeze({ 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' });

const canonicalProvider = (value) => typeof value === 'string' && PROVIDERS.has(value) ? value : null;
const canonicalAgent = (value) => typeof value === 'string' ? (AGENT_FOR_ALIAS[value] || value) : null;

function flattenTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const body = target.target && typeof target.target === 'object' ? target.target : target;
  const provider = canonicalProvider(target.provider || body.provider);
  const targetAgent = canonicalAgent(body.target_agent || body.targetAgent);
  const modelId = body.model_id || body.model;
  if (!provider || !targetAgent || typeof modelId !== 'string' || modelId.trim() === '') return null;
  return {
    provider,
    target_agent: targetAgent,
    model_id: modelId,
    effort: target.effort || body.effort || null,
    ...(body.route ? { route: body.route } : {}),
    ...(body.transport ? { transport: body.transport } : {}),
  };
}

function sameTarget(actual, expected) {
  return Boolean(actual && expected
    && actual.provider === expected.provider
    && actual.target_agent === expected.target_agent
    && actual.model_id === expected.model_id
    && (!expected.effort || actual.effort === expected.effort));
}

function evaluateTargetPolicy({ target, role, authority, constraints = {}, invocation, ledger, hostAllowedProviders }) {
  const selected = flattenTarget(target);
  if (!selected) return { allowed: false, reason: 'target is invalid' };
  const hostAllowed = Array.isArray(hostAllowedProviders)
    ? hostAllowedProviders
    : (ledger && ledger.current_provider ? [ledger.current_provider] : []);
  if (!hostAllowed.includes(selected.provider)) {
    return { allowed: false, reason: 'target Provider is outside the Host allowed-provider policy' };
  }

  const taskProvider = Object.prototype.hasOwnProperty.call(constraints, 'provider')
    ? canonicalProvider(constraints.provider)
    : null;
  if (taskProvider && selected.provider !== taskProvider) {
    return { allowed: false, reason: 'selected Provider conflicts with the task constraint' };
  }

  const strict = constraints.strict_target;
  if (strict && (selected.provider !== strict.provider
    || selected.target_agent !== canonicalAgent(strict.target_agent)
    || selected.model_id !== strict.model_id
    || (strict.effort !== undefined && selected.effort !== strict.effort))) {
    return { allowed: false, reason: 'Host selection does not match the strict task target' };
  }

  if (role === 'worker') {
    const options = invocation && invocation.options || {};
    const exact = options.workerTarget;
    if (exact) {
      const provider = ({ claude: 'anthropic', codex: 'openai', agy: 'google' })[exact.provider];
      const agent = ({ claude: 'claude-code', codex: 'codex-cli', agy: 'agy' })[exact.provider];
      const requested = provider && agent ? {
        provider, target_agent: agent, model_id: exact.model, effort: exact.effort,
      } : null;
      if (!sameTarget(selected, requested)) return { allowed: false, reason: 'Host selection does not match the explicit worker target' };
    } else if (options.worker && options.worker !== 'auto') {
      const backend = BACKEND_FOR_AGENT[selected.target_agent];
      if (backend !== options.worker) return { allowed: false, reason: 'Host selection does not match the legacy worker selector' };
    }
  }

  const broadProviderGrant = ledger && ledger.providers.includes(selected.provider);
  const exactTargetGrant = ledger && targetGrantMatches(ledger, selected, role);
  if (!broadProviderGrant && !exactTargetGrant) {
    return { allowed: false, target: selected, reason: 'target Provider is not authorized for this task' };
  }
  return { allowed: true, target: selected, authority };
}

function relevantEvidence(evidence, target, role, authority) {
  return Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && evidence.provider === target.provider
    && canonicalAgent(evidence.target_agent) === target.target_agent
    && evidence.role === role
    && evidence.authority === authority);
}

function stableRecord(value) {
  if (Array.isArray(value)) return value.map(stableRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableRecord(value[key]);
    return result;
  }, {});
}

function distinctRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = JSON.stringify(stableRecord(record));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectCapabilityEvidence(capabilities, targetValue, role, authority, binding = {}) {
  const target = flattenTarget(targetValue);
  if (!target) return { status: 'none', evidence: null };
  const plural = Array.isArray(capabilities && capabilities.capability_evidence_records)
    ? capabilities.capability_evidence_records
    : [];
  const singular = capabilities && capabilities.capability_evidence;
  const candidates = [...plural, ...(singular ? [singular] : [])]
    .filter((record) => relevantEvidence(record, target, role, authority));
  if (candidates.length === 0) return { status: 'none', evidence: null };

  if (plural.length === 0 && singular && relevantEvidence(singular, target, role, authority)) {
    // Preserve legacy evidence unchanged; Dispatch Engine validates its host,
    // session, binding, model, route, and transport instead of catalog fallback.
    return { status: 'selected', evidence: singular };
  }

  const host = capabilities && capabilities.host_profile && capabilities.host_profile.host;
  const currentBinding = candidates.filter((record) => record.host === host
    && record.session_id === binding.session_id
    && record.binding_id === binding.binding_id);
  const preferredBase = currentBinding.length ? currentBinding : candidates;
  const exactModel = preferredBase.filter((record) => record.model_id === target.model_id);
  const preferred = distinctRecords(exactModel.length ? exactModel : preferredBase);
  if (preferred.length > 1) {
    return { status: 'blocked', evidence: null, reason: 'Host returned contradictory capability evidence for this target and role' };
  }
  return { status: 'selected', evidence: preferred[0] };
}

module.exports = Object.freeze({ flattenTarget, evaluateTargetPolicy, selectCapabilityEvidence });
