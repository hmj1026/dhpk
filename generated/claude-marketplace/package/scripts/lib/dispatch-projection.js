'use strict';

const crypto = require('node:crypto');
const {
  AUTHORITIES,
  CANONICAL_ROLES,
  EFFORTS,
  SCHEMAS,
  TRANSPORTS,
} = require('./dispatch-contract');

const PROJECTION_SCHEMA = 'dhpk.dispatch.projection.v1';
const SURFACES = Object.freeze(['claude-core', 'agent-plugin', 'cursor-plugin', 'cursor-sync', 'codex-native', 'codex-sync', 'agy-plugin']);
const LEGACY_ALIASES = Object.freeze(['codex-fast-worker', 'codex-deep-reasoner', 'agy-fast-worker', 'codex-bridge']);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildDispatchProjection({ surface, catalog, hostProfiles, source = 'scripts/lib/dispatch-contract.js' } = {}) {
  if (!SURFACES.includes(surface)) throw new TypeError(`unsupported dispatch projection surface: ${surface}`);
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.providers)) throw new TypeError('catalog is required');
  if (!hostProfiles || typeof hostProfiles !== 'object' || !Array.isArray(hostProfiles.profiles)) throw new TypeError('hostProfiles are required');
  const roles = CANONICAL_ROLES.map((role) => ({
    role,
    authority: role === 'worker' ? 'workspace-write' : 'read-only',
    efforts: [...EFFORTS],
    transports: [...TRANSPORTS],
    target: 'Host Profile native Provider/Model unless explicitly constrained',
  }));
  const projection = {
    schema: PROJECTION_SCHEMA,
    surface,
    source,
    contract: {
      request: SCHEMAS.REQUEST,
      receipt: SCHEMAS.RECEIPT,
      authorities: [...AUTHORITIES],
      roles,
    },
    catalog: { schema: catalog.schema, version: catalog.version },
    hosts: hostProfiles.profiles.map((profile) => ({
      host: profile.host,
      native_provider: profile.native_provider,
      native_model: profile.native_model,
      native_transport: profile.native_transport,
      profile_version: profile.version,
    })).sort((left, right) => left.host.localeCompare(right.host)),
    fallback: {
      default: 'current Host Profile native target',
      eligible: 'confirmed availability failure before side effects',
      reconciliation: 'side effect or lifecycle uncertainty',
    },
    compatibility: {
      aliases: [...LEGACY_ALIASES],
      translation: 'input-edge only; canonical Role and Provider-scoped target remain authoritative',
    },
  };
  return Object.freeze({ ...projection, fingerprint: digest(projection) });
}

function validateDispatchProjection(projection) {
  const errors = [];
  if (!projection || projection.schema !== PROJECTION_SCHEMA) errors.push(`projection schema must be ${PROJECTION_SCHEMA}`);
  if (!projection || !SURFACES.includes(projection.surface)) errors.push('projection surface must be a supported configured surface');
  if (!projection || !projection.contract || projection.contract.request !== SCHEMAS.REQUEST) errors.push('projection must reference the canonical request schema');
  if (!projection || !projection.contract || projection.contract.receipt !== SCHEMAS.RECEIPT) errors.push('projection must reference the canonical receipt schema');
  if (!projection || !Array.isArray(projection.contract && projection.contract.roles)) errors.push('projection must declare canonical roles');
  else {
    const roles = projection.contract.roles.map((entry) => entry.role);
    if (JSON.stringify(roles) !== JSON.stringify([...CANONICAL_ROLES])) errors.push('projection role order must be canonical and Provider-neutral');
    if (projection.contract.roles.some((entry) => !CANONICAL_ROLES.includes(entry.role))) errors.push('projection contains a Provider-bound Role');
  }
  if (!projection || !projection.fingerprint || !/^[a-f0-9]{64}$/.test(projection.fingerprint)) errors.push('projection fingerprint must be SHA-256');
  return Object.freeze({ ok: errors.length === 0, errors });
}

function parityShape(projection) {
  const { surface: _surface, fingerprint: _fingerprint, ...shape } = projection;
  return JSON.stringify(shape);
}

function validateDispatchProjectionSet(projections) {
  const errors = [];
  if (!Array.isArray(projections) || projections.length === 0) {
    return Object.freeze({ ok: false, errors: ['projection set must be a non-empty array'], surfaces: [] });
  }
  const seen = new Set();
  const shapes = [];
  for (const projection of projections) {
    const validation = validateDispatchProjection(projection);
    errors.push(...validation.errors);
    if (projection && seen.has(projection.surface)) errors.push(`projection surface is duplicated: ${projection.surface}`);
    if (projection && SURFACES.includes(projection.surface)) {
      seen.add(projection.surface);
      shapes.push({ surface: projection.surface, shape: parityShape(projection) });
    }
  }
  const expected = shapes[0] && shapes[0].shape;
  for (const entry of shapes) {
    if (expected !== entry.shape) errors.push(`projection contract drift on surface ${entry.surface}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors, surfaces: [...seen].sort() });
}

module.exports = Object.freeze({ PROJECTION_SCHEMA, SURFACES, buildDispatchProjection, validateDispatchProjection, validateDispatchProjectionSet });
