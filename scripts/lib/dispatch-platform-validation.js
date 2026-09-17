'use strict';

const {
  CAPABILITY_STATUSES,
  SUPPORT_STATUSES,
  createExecutionTarget,
  createHostProfile,
  createProviderModelCatalog,
  VERIFICATION_STATES,
} = require('./dispatch-contract');

const VALIDATION_SCHEMA = 'dhpk.dispatch.platform-validation.v1';

function status(value, label) {
  if (!CAPABILITY_STATUSES.includes(value)) throw new TypeError(`${label} must be an explicit capability status`);
  return value;
}

function catalogSupport(catalog, target, host) {
  const routes = Array.isArray(catalog.routes) ? catalog.routes : [];
  const provider = ({ 'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', 'cursor-native': 'xai' }[target.provider] || target.provider);
  const modelId = target.model_id || target.model;
  const route = routes.find((entry) => {
    const agent = !target.target_agent || entry.target_agent === target.target_agent
      || ({ claude: 'claude-code', codex: 'codex-cli' }[target.target_agent] || target.target_agent) === entry.target_agent;
    return agent && (!host || entry.host === host) && entry.provider === provider && entry.model_id === modelId
      && entry.transport === target.transport && (!target.route || entry.route === target.route)
      && entry.efforts.includes(target.effort);
  });
  return route ? SUPPORT_STATUSES[0] : SUPPORT_STATUSES[1];
}

function validateDispatchPlatformEvidence({ hostProfile, catalog, target, probe = null, receipt = null } = {}) {
  const profile = createHostProfile(hostProfile);
  const catalogData = createProviderModelCatalog(catalog);
  const normalizedTarget = createExecutionTarget(target);
  const accessProvider = ({ 'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', 'cursor-native': 'xai' }[normalizedTarget.provider] || normalizedTarget.provider);
  const access = profile.access[accessProvider];
  const runtime = probe === null ? 'NOT_RUN' : status(probe.status, 'probe.status');
  const verification = receipt === null
    ? 'NOT_RUN'
    : (VERIFICATION_STATES.includes(receipt.verification) ? receipt.verification : 'BLOCKED');
  return Object.freeze({
    schema: VALIDATION_SCHEMA,
    host: profile.host,
    target: normalizedTarget,
    status: Object.freeze({
      catalog_support: catalogSupport(catalogData, normalizedTarget, profile.host),
      host_access: access ? status(access.status, `host_profile.access.${normalizedTarget.provider}.status`) : 'BLOCKED',
      runtime,
      terminal: receipt && typeof receipt.status === 'string' ? receipt.status : 'NOT_RUN',
      verification,
    }),
    evidence: Object.freeze({
      catalog_version: catalogData.version,
      host_profile_version: profile.version,
      host_access: access ? access.evidence : 'Host profile has no access evidence',
      probe: probe && probe.evidence ? probe.evidence : 'runtime probe not run',
      receipt_id: receipt && receipt.receipt_id ? receipt.receipt_id : null,
    }),
  });
}

function validateDispatchSurfaceSet(entries) {
  if (!Array.isArray(entries)) throw new TypeError('dispatch surface evidence must be an array');
  const results = entries.map((entry) => validateDispatchPlatformEvidence(entry));
  return Object.freeze({
    schema: VALIDATION_SCHEMA,
    surfaces: Object.freeze(results),
    verdict: results.some((result) => ['BLOCKED', 'UNAVAILABLE'].includes(result.status.host_access)
      || result.status.catalog_support !== 'SUPPORTED') ? 'INCOMPLETE' : 'EVIDENCE_RECORDED',
  });
}

module.exports = Object.freeze({ VALIDATION_SCHEMA, validateDispatchPlatformEvidence, validateDispatchSurfaceSet });
