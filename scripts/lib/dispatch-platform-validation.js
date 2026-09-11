'use strict';

const {
  CAPABILITY_STATUSES,
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

function catalogSupport(catalog, target) {
  const provider = catalog.providers.find((entry) => entry.provider === target.provider);
  if (!provider) return 'UNAVAILABLE';
  const model = provider.models.find((entry) => entry.id === target.model);
  if (!model) return 'UNAVAILABLE';
  if (!model.efforts.includes(target.effort) || !model.transports.includes(target.transport)) return 'UNAVAILABLE';
  return 'AVAILABLE';
}

function validateDispatchPlatformEvidence({ hostProfile, catalog, target, probe = null, receipt = null } = {}) {
  const profile = createHostProfile(hostProfile);
  const catalogData = createProviderModelCatalog(catalog);
  const normalizedTarget = createExecutionTarget(target);
  const access = profile.access[normalizedTarget.provider];
  const runtime = probe === null ? 'NOT_RUN' : status(probe.status, 'probe.status');
  const verification = receipt === null
    ? 'NOT_RUN'
    : (VERIFICATION_STATES.includes(receipt.verification) ? receipt.verification : 'BLOCKED');
  return Object.freeze({
    schema: VALIDATION_SCHEMA,
    host: profile.host,
    target: normalizedTarget,
    status: Object.freeze({
      catalog_support: catalogSupport(catalogData, normalizedTarget),
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
      || result.status.catalog_support !== 'AVAILABLE') ? 'INCOMPLETE' : 'EVIDENCE_RECORDED',
  });
}

module.exports = Object.freeze({ VALIDATION_SCHEMA, validateDispatchPlatformEvidence, validateDispatchSurfaceSet });
