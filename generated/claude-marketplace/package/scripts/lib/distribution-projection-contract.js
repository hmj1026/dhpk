'use strict';

// Pure contracts for the distribution projection pipeline.  This module owns
// normalization, immutable DTO construction, fingerprints, and stable errors;
// it deliberately has no filesystem, process, or consumer dependencies.

const crypto = require('node:crypto');
const {
  USAGE_SCHEMA,
  normalizeSkillUsage,
  resolveInventoryRevision,
  usageFingerprint: fingerprintSkillUsage,
} = require('./skill-usage');

const CONTRACT_SCHEMA = 'dhpk.distribution-projection-contract.v1';
const PROVENANCE_SCHEMA = 'dhpk.skill-provenance.v1';
const VERIFICATION_STAGES = Object.freeze(['structural', 'package', 'consumer-runtime']);
const VERDICTS = Object.freeze([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'BLOCKED',
  'UNAVAILABLE',
]);
const SYMLINK_POLICIES = Object.freeze([
  'forbid',
  'contained-relative',
  'declared-source-relative',
]);

const EXTERNAL_SKILL_PACKAGE_FIELDS = Object.freeze([
  'id',
  'owner',
  'repository',
  'policy',
  'license_review',
  'stable_ids',
]);

// The ownership ledger is an additive contract.  Keep extraction permissive so
// old callers that do not know about it continue to compile exactly as before;
// the inventory validator remains responsible for rejecting malformed rows.
function externalSkillPackagesInput(input) {
  if (Array.isArray(input)) return { present: true, value: input };
  if (!input || typeof input !== 'object') return { present: false, value: undefined };

  const candidates = [
    input,
    input.inventory,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    if (Object.prototype.hasOwnProperty.call(candidate, 'external_skill_packages')) {
      return { present: true, value: candidate.external_skill_packages };
    }
    if (Object.prototype.hasOwnProperty.call(candidate, 'externalSkillPackages')) {
      return { present: true, value: candidate.externalSkillPackages };
    }
  }
  return { present: false, value: undefined };
}

function normalizeExternalSkillPackages(input) {
  const source = externalSkillPackagesInput(input);
  if (!source.present || !Array.isArray(source.value)) return [];

  return source.value
    .map((entry) => {
      const row = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
      const stableIds = Array.isArray(row.stable_ids)
        ? [...row.stable_ids].sort()
        : Array.isArray(row.stableIds)
          ? [...row.stableIds].sort()
          : [];
      return {
        id: row.id,
        owner: row.owner,
        repository: row.repository,
        policy: row.policy,
        license_review: Object.prototype.hasOwnProperty.call(row, 'license_review')
          ? row.license_review
          : row.licenseReview,
        stable_ids: stableIds,
      };
    })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function externalSkillPackagesFingerprint(input) {
  return fingerprint(normalizeExternalSkillPackages(input));
}

function clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

function freeze(value) {
  if (Buffer.isBuffer(value)) return value;
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function canonicalize(value) {
  return JSON.stringify(clone(value));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
}

function projectionError(code, operation, message, details = {}) {
  return freeze({
    code,
    operation,
    stage: details.stage,
    stableIds: Array.isArray(details.stableIds) ? [...details.stableIds].sort() : [],
    paths: Array.isArray(details.paths) ? [...details.paths].sort() : [],
    message,
    details: details.details === undefined ? undefined : clone(details.details),
  });
}

function result(value, error) {
  return value === undefined
    ? freeze({ ok: false, error })
    : freeze({ ok: true, value: freeze(value) });
}

function usageSkillForEntry(entry, stableId, usage) {
  const skillId = entry.skillId || entry.skill_id || entry.sourceId || entry.source_id || stableId;
  return {
    id: skillId,
    name: entry.publicName || entry.public_name || entry.name || skillId,
    invocation_class: entry.invocationClass || entry.invocation_class || usage.invocation_class,
    lifecycle: entry.lifecycle,
    surfaces: entry.surfaces,
  };
}

function normalizeUsageIdentity(entry, stableId) {
  if (entry.usage === undefined && entry.usageContract === undefined && entry.usage_contract === undefined) {
    return null;
  }
  const usage = entry.usage !== undefined
    ? entry.usage
    : entry.usageContract !== undefined ? entry.usageContract : entry.usage_contract;
  const skill = usageSkillForEntry(entry, stableId, usage || {});
  const normalized = normalizeSkillUsage({ skill, usage });
  const computedFingerprint = fingerprintSkillUsage({ skill, usage });
  const declaredFingerprint = entry.usageFingerprint || entry.usage_fingerprint;
  if (declaredFingerprint !== undefined && declaredFingerprint !== computedFingerprint) {
    return {
      error: projectionError(
        'USAGE_FINGERPRINT_MISMATCH',
        'compile',
        `usage fingerprint for '${stableId}' does not match its normalized usage contract`,
        { stableIds: [entry.skillId || entry.skill_id || stableId] },
      ),
    };
  }
  return {
    usage: normalized,
    usageFingerprint: computedFingerprint,
    skillId: skill.id,
    publicName: skill.name,
    invocationClass: normalized.invocation_class,
  };
}

function normalizeProvenance(entry, identity, context = {}) {
  const source = entry.canonicalSource || entry.canonical_source || entry.source || null;
  const sourceFingerprint = entry.sourceFingerprint || entry.source_fingerprint || null;
  const transform = entry.transform || { id: 'identity', version: '1' };
  const lifecycle = entry.lifecycle === undefined ? null : entry.lifecycle;
  const retirementState = entry.retirementState || entry.retirement_state
    || (lifecycle === 'deprecated' ? 'retired' : lifecycle === 'retired' ? 'retired' : 'active');
  const externalLedger = context.externalSkillPackagesFingerprint;
  const explicit = entry.provenance && typeof entry.provenance === 'object' && !Array.isArray(entry.provenance)
    ? entry.provenance
    : {};
  return {
    schema: PROVENANCE_SCHEMA,
    inventoryRevision: explicit.inventoryRevision || explicit.inventory_revision || context.inventoryRevision || null,
    canonicalSource: explicit.canonicalSource || explicit.canonical_source || source,
    sourceFingerprint: explicit.sourceFingerprint || explicit.source_fingerprint || sourceFingerprint,
    owner: explicit.owner || entry.sourceOwner || entry.source_owner || entry.owner || null,
    transform: explicit.transform || transform,
    lifecycle: explicit.lifecycle === undefined ? lifecycle : explicit.lifecycle,
    retirementState: explicit.retirementState || explicit.retirement_state || retirementState,
    publicName: explicit.publicName || explicit.public_name || identity.publicName || null,
    invocationClass: explicit.invocationClass || explicit.invocation_class || identity.invocationClass || null,
    ...(externalLedger !== undefined
      ? { externalSkillPackagesFingerprint: externalLedger }
      : (explicit.externalSkillPackagesFingerprint !== undefined
        ? { externalSkillPackagesFingerprint: explicit.externalSkillPackagesFingerprint }
        : (explicit.external_skill_packages_fingerprint !== undefined
          ? { externalSkillPackagesFingerprint: explicit.external_skill_packages_fingerprint }
          : {}))),
  };
}

// Build the metadata carried by a surface output for one inventory skill. This
// is intentionally a presentation-only adapter: the normalized usage object
// and its fingerprint are copied from inventory, while the caller supplies the
// output transform used by that surface.
function skillProjectionMetadata(skill, { transform = null, inventoryRevision = null, owner = null, externalSkillPackagesFingerprint: externalLedger } = {}) {
  if (!skill || typeof skill !== 'object' || skill.usage === undefined || skill.usage === null) return {};
  const usageInput = { skill, usage: skill.usage };
  const normalized = normalizeSkillUsage(usageInput);
  const identity = {
    skillId: skill.id,
    publicName: skill.name || skill.publicName || skill.id,
    invocationClass: normalized.invocation_class,
  };
  const entry = {
    ...skill,
    skillId: skill.id,
    publicName: identity.publicName,
    invocationClass: identity.invocationClass,
    canonicalSource: skill.path,
    sourceFingerprint: skill.source_fingerprint || skill.sourceFingerprint || null,
    owner: owner || skill.owner || null,
    transform: transform || { id: 'identity', version: '1' },
  };
  return {
    ...identity,
    lifecycle: skill.lifecycle === undefined ? null : skill.lifecycle,
    usageSchema: USAGE_SCHEMA,
    usage: normalized,
    usageFingerprint: fingerprintSkillUsage(usageInput),
    provenance: normalizeProvenance(entry, identity, {
      inventoryRevision,
      ...(externalLedger !== undefined ? { externalSkillPackagesFingerprint: externalLedger } : {}),
    }),
  };
}

function normalizeEntry(entry, index, context = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { error: projectionError('INVALID_ENTRY', 'compile', `projection entry ${index} must be an object`) };
  }
  const stableId = entry.stableId || entry.id;
  const source = entry.source || entry.path;
  const destination = entry.destination || entry.path;
  if (typeof stableId !== 'string' || stableId.trim() === '') {
    return { error: projectionError('INVALID_ENTRY', 'compile', `projection entry ${index} requires a stable id`) };
  }
  if (typeof source !== 'string' || source.trim() === '') {
    return { error: projectionError('INVALID_ENTRY', 'compile', `projection entry ${stableId} requires a source path`, { stableIds: [stableId] }) };
  }
  if (typeof destination !== 'string' || destination.trim() === '') {
    return { error: projectionError('INVALID_ENTRY', 'compile', `projection entry ${stableId} requires a destination path`, { stableIds: [stableId] }) };
  }
  const symlinkPolicy = entry.symlinkPolicy || 'forbid';
  if (!SYMLINK_POLICIES.includes(symlinkPolicy)) {
    return { error: projectionError('INVALID_SYMLINK_POLICY', 'compile', `unsupported symlink policy '${symlinkPolicy}'`, { stableIds: [stableId] }) };
  }
  const mode = entry.mode === undefined || entry.mode === null ? null : entry.mode;
  if (mode !== null && (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)) {
    return { error: projectionError('INVALID_MODE', 'compile', `projection entry ${stableId} requires a valid file mode`, { stableIds: [stableId] }) };
  }
  const usageIdentity = normalizeUsageIdentity(entry, stableId);
  if (usageIdentity && usageIdentity.error) return usageIdentity;
  const value = {
      stableId,
      source,
      sourceFingerprint: entry.sourceFingerprint || null,
      destination,
      owner: entry.owner || stableId,
      transform: entry.transform || { id: 'identity', version: '1' },
      expectedFingerprint: entry.expectedFingerprint || null,
      mode,
      symlink: {
        policy: symlinkPolicy,
        target: entry.symlinkTarget || null,
      },
  };
  if (usageIdentity) {
    value.skillId = usageIdentity.skillId;
    value.publicName = usageIdentity.publicName;
    value.invocationClass = usageIdentity.invocationClass;
    value.lifecycle = entry.lifecycle === undefined ? null : entry.lifecycle;
    value.usage = usageIdentity.usage;
    value.usageSchema = USAGE_SCHEMA;
    value.usageFingerprint = usageIdentity.usageFingerprint;
    value.provenance = normalizeProvenance(entry, usageIdentity, context);
  } else if (entry.skillId || entry.skill_id || entry.publicName || entry.public_name || entry.name
      || entry.provenance || entry.usageFingerprint || entry.usage_fingerprint) {
    value.skillId = entry.skillId || entry.skill_id || entry.sourceId || entry.source_id || stableId;
    value.publicName = entry.publicName || entry.public_name || entry.name || value.skillId;
    if (entry.invocationClass || entry.invocation_class) value.invocationClass = entry.invocationClass || entry.invocation_class;
    if (entry.lifecycle !== undefined) value.lifecycle = entry.lifecycle;
    if (entry.provenance) value.provenance = clone(entry.provenance);
  }
  return {
    value,
  };
}

function createDistributionPlan(input = {}) {
  const surface = input.surface;
  if (typeof surface !== 'string' || surface.trim() === '') {
    return result(undefined, projectionError('INVALID_INPUT', 'compile', 'target surface is required'));
  }
  if (!Array.isArray(input.entries)) {
    return result(undefined, projectionError('INVALID_INPUT', 'compile', 'entries must be an array'));
  }
  const profileSelection = input.profileSelection === undefined
    ? (input.selection === undefined ? null : input.selection)
    : input.profileSelection;
  if (surface === 'claude-profile' && (!profileSelection || typeof profileSelection !== 'object' || Array.isArray(profileSelection))) {
    return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile plans require explicit profile selection identity'));
  }
  const profileId = profileSelection && (profileSelection.profileId || profileSelection.id);
  if (profileSelection !== null && (typeof profileId !== 'string' || profileId.trim() === '')) {
    return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'profile selection requires a normalized profile id'));
  }
  if (surface === 'claude-profile') {
    if (!Array.isArray(profileSelection.modules) && !Array.isArray(profileSelection.moduleClosure)) {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile selection requires a module closure'));
    }
    if (!profileSelection.version && !profileSelection.selectionPolicyVersion) {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile selection requires a versioned selection policy'));
    }
    if (typeof input.inventoryFingerprint !== 'string' || input.inventoryFingerprint.trim() === '') {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile plans require an inventory fingerprint'));
    }
    if (typeof input.inputFingerprint !== 'string' || input.inputFingerprint.trim() === '') {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile plans require a selection input fingerprint'));
    }
    if (!input.selectionPolicy || typeof input.selectionPolicy !== 'object' || typeof input.selectionPolicy.version !== 'string') {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile plans require a versioned selection policy'));
    }
  }
  const ownershipInput = externalSkillPackagesInput(input);
  const explicitOwnershipFingerprint = Object.prototype.hasOwnProperty.call(input, 'externalSkillPackagesFingerprint')
    ? input.externalSkillPackagesFingerprint
    : input.external_skill_packages_fingerprint;
  const ownershipFingerprint = ownershipInput.present || explicitOwnershipFingerprint !== undefined
    ? (explicitOwnershipFingerprint !== undefined
      ? explicitOwnershipFingerprint
      : externalSkillPackagesFingerprint(ownershipInput.value))
    : undefined;
  const inventoryRevision = input.inventoryRevision || input.inventory_revision
    || (input.inventory ? resolveInventoryRevision(input.inventory, input.inventoryRevision) : null);
  const normalizationContext = {
    inventoryRevision,
    ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
  };
  const entries = [];
  const ids = new Set();
  for (const [index, raw] of input.entries.entries()) {
    const normalized = normalizeEntry(raw, index, normalizationContext);
    if (normalized.error) return result(undefined, normalized.error);
    if (ids.has(normalized.value.stableId)) {
      return result(undefined, projectionError('DUPLICATE_STABLE_ID', 'compile', `duplicate stable id '${normalized.value.stableId}'`, { stableIds: [normalized.value.stableId] }));
    }
    ids.add(normalized.value.stableId);
    entries.push(normalized.value);
  }
  entries.sort((a, b) => a.stableId.localeCompare(b.stableId));
  const entryIds = entries.map((entry) => entry.stableId);
  let selectionEntries = null;
  let selectedIds = entryIds;
  if (input.selectionEntries !== undefined) {
    if (!Array.isArray(input.selectionEntries)) {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'selection entries must be an array'));
    }
    const normalizedSelectionEntries = [];
    const selectionIds = new Set();
    for (const [index, raw] of input.selectionEntries.entries()) {
      const normalized = normalizeEntry(raw, index, normalizationContext);
      if (normalized.error) return result(undefined, normalized.error);
      if (selectionIds.has(normalized.value.stableId)) {
        return result(undefined, projectionError('DUPLICATE_STABLE_ID', 'compile', `duplicate selection stable id '${normalized.value.stableId}'`, { stableIds: [normalized.value.stableId] }));
      }
      selectionIds.add(normalized.value.stableId);
      normalizedSelectionEntries.push(normalized.value);
    }
    normalizedSelectionEntries.sort((a, b) => a.stableId.localeCompare(b.stableId));
    selectionEntries = normalizedSelectionEntries;
    selectedIds = normalizedSelectionEntries.map((entry) => entry.stableId);
  }
  if (input.selectedStableIds !== undefined) {
    if (!Array.isArray(input.selectedStableIds) || input.selectedStableIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
      return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'selected stable IDs must be a non-empty string array'));
    }
    const declaredIds = [...new Set(input.selectedStableIds)].sort();
    if (selectionEntries !== null) {
      if (JSON.stringify(declaredIds) !== JSON.stringify(selectedIds)) {
        return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'selected stable IDs do not match canonical selection entries', { stableIds: declaredIds }));
      }
      selectedIds = declaredIds;
    } else {
      if (JSON.stringify(declaredIds) !== JSON.stringify(entryIds)) {
        return result(undefined, projectionError('INCOMPLETE_PLAN', 'compile', 'selected stable IDs do not match planned entries', { stableIds: declaredIds }));
      }
      selectedIds = declaredIds;
    }
  }
  const body = {
    schema: CONTRACT_SCHEMA,
    compilerVersion: input.compilerVersion || '1',
    surface,
    inputFingerprint: input.inputFingerprint || fingerprint({ surface, entries: input.entries }),
    inventoryFingerprint: input.inventoryFingerprint || null,
    ownershipRoot: input.ownershipRoot || null,
    selectedStableIds: selectedIds,
    selectionPolicy: input.selectionPolicy || null,
    selectionEntries,
    entries,
  };
  if (profileSelection !== null) {
    body.profile = clone(profileSelection);
    body.profileId = profileId;
    body.compatibilityMode = input.compatibilityMode || profileSelection.compatibilityMode || profileSelection.mode || null;
    body.selectionPolicyVersion = input.selectionPolicyVersion
      || profileSelection.selectionPolicyVersion
      || (input.selectionPolicy && input.selectionPolicy.version)
      || null;
    body.selectionFingerprint = input.selectionFingerprint || profileSelection.selectionFingerprint || null;
    body.surfaceSelectionFingerprint = input.surfaceSelectionFingerprint || profileSelection.surfaceSelectionFingerprint || profileSelection.surfaceFingerprint || null;
    body.emittedStableIds = Array.isArray(input.emittedStableIds)
      ? [...new Set(input.emittedStableIds)]
      : (Array.isArray(profileSelection.emittedStableIds) ? [...new Set(profileSelection.emittedStableIds)] : null);
  }

  const usageEntries = [...entries, ...(selectionEntries || [])]
    .filter((entry) => entry && entry.usage && entry.usageFingerprint && entry.skillId);
  if (usageEntries.length > 0) {
    const usageById = new Map();
    const provenanceById = new Map();
    for (const entry of usageEntries) {
      if (!usageById.has(entry.skillId)) {
        usageById.set(entry.skillId, entry.usage);
        provenanceById.set(entry.skillId, entry.provenance);
      }
    }
    body.usageSchema = USAGE_SCHEMA;
    body.inventoryRevision = inventoryRevision;
    body.usage = Object.fromEntries([...usageById.entries()].sort(([left], [right]) => left.localeCompare(right)));
    body.usageFingerprints = Object.fromEntries(
      [...usageById.keys()].sort().map((id) => {
        const sourceEntry = [...entries, ...(selectionEntries || [])]
          .find((entry) => entry.skillId === id);
        return [id, sourceEntry.usageFingerprint];
      }),
    );
    body.provenance = Object.fromEntries([...provenanceById.entries()].sort(([left], [right]) => left.localeCompare(right)));
    body.selectionFingerprint = input.selectionFingerprint || fingerprint({
      surface,
      inventoryRevision,
      selectedStableIds: selectedIds,
      usageFingerprints: body.usageFingerprints,
      provenance: body.provenance,
    });
    body.surfaceSelectionFingerprint = input.surfaceSelectionFingerprint || fingerprint({
      selectionFingerprint: body.selectionFingerprint,
      surface,
      emittedStableIds: body.emittedStableIds || selectedIds,
      usageFingerprints: body.usageFingerprints,
      transforms: entries.map((entry) => entry.transform),
    });
  } else {
    if (input.selectionFingerprint) body.selectionFingerprint = input.selectionFingerprint;
    if (input.surfaceSelectionFingerprint) body.surfaceSelectionFingerprint = input.surfaceSelectionFingerprint;
  }

  // Ownership provenance was added after the v1 projection contract.  It is
  // deliberately omitted when no ledger (or explicit ledger fingerprint) is
  // supplied so legacy plan fingerprints remain byte-for-byte compatible.
  if (ownershipFingerprint !== undefined) body.externalSkillPackagesFingerprint = ownershipFingerprint;
  return result({ ...body, planFingerprint: fingerprint(body) });
}

function createDistributionArtifact(input = {}) {
  if (!input.planFingerprint || typeof input.planFingerprint !== 'string') {
    return result(undefined, projectionError('INVALID_ARTIFACT', 'materialize', 'artifact requires a plan fingerprint'));
  }
  const body = {
    schema: CONTRACT_SCHEMA,
    planFingerprint: input.planFingerprint,
    adapter: input.adapter || { id: 'unknown', version: 'unknown' },
    artifactFingerprint: input.artifactFingerprint || fingerprint(input.outputs || []),
    outputs: Array.isArray(input.outputs) ? input.outputs : [],
    links: Array.isArray(input.links) ? input.links : [],
    metadata: input.metadata === undefined ? undefined : input.metadata,
  };
  if (input.usageSchema !== undefined) body.usageSchema = input.usageSchema;
  if (input.inventoryRevision !== undefined) body.inventoryRevision = input.inventoryRevision;
  if (input.usageFingerprints !== undefined) body.usageFingerprints = clone(input.usageFingerprints);
  if (input.provenance !== undefined) body.provenance = clone(input.provenance);
  if (input.selectionFingerprint !== undefined) body.selectionFingerprint = input.selectionFingerprint;
  if (input.surfaceSelectionFingerprint !== undefined) body.surfaceSelectionFingerprint = input.surfaceSelectionFingerprint;
  const externalSkillPackagesFingerprintValue = Object.prototype.hasOwnProperty.call(input, 'externalSkillPackagesFingerprint')
    ? input.externalSkillPackagesFingerprint
    : input.external_skill_packages_fingerprint;
  if (externalSkillPackagesFingerprintValue !== undefined) {
    body.externalSkillPackagesFingerprint = externalSkillPackagesFingerprintValue;
  }
  return result(body);
}

function createEvidenceResult(input = {}) {
  if (!VERIFICATION_STAGES.includes(input.stage)) {
    return result(undefined, projectionError('INVALID_STAGE', 'verify', `unsupported verification stage '${input.stage}'`, { stage: input.stage }));
  }
  if (!VERDICTS.includes(input.verdict)) {
    return result(undefined, projectionError('INVALID_VERDICT', 'verify', `unsupported evidence verdict '${input.verdict}'`, { stage: input.stage }));
  }
  const body = {
    schema: CONTRACT_SCHEMA,
    stage: input.stage,
    adapter: input.adapter || { id: 'unknown', version: 'unknown' },
    planFingerprint: input.planFingerprint || null,
    artifactFingerprint: input.artifactFingerprint || null,
    claims: Array.isArray(input.claims) ? input.claims : [],
    observations: Array.isArray(input.observations) ? input.observations : [],
    verdict: input.verdict,
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics : [],
    observedAt: input.observedAt,
  };
  if (input.inventoryRevision !== undefined) body.inventoryRevision = input.inventoryRevision;
  if (input.usageSchema !== undefined) body.usageSchema = input.usageSchema;
  if (input.usageFingerprints !== undefined) body.usageFingerprints = clone(input.usageFingerprints);
  if (input.provenance !== undefined) body.provenance = clone(input.provenance);
  const externalSkillPackagesFingerprintValue = Object.prototype.hasOwnProperty.call(input, 'externalSkillPackagesFingerprint')
    ? input.externalSkillPackagesFingerprint
    : input.external_skill_packages_fingerprint;
  if (externalSkillPackagesFingerprintValue !== undefined) {
    body.externalSkillPackagesFingerprint = externalSkillPackagesFingerprintValue;
  }
  return result(body);
}

module.exports = {
  CONTRACT_SCHEMA,
  VERIFICATION_STAGES,
  VERDICTS,
  SYMLINK_POLICIES,
  EXTERNAL_SKILL_PACKAGE_FIELDS,
  canonicalize,
  fingerprint,
  normalizeExternalSkillPackages,
  externalSkillPackagesFingerprint,
  PROVENANCE_SCHEMA,
  USAGE_SCHEMA,
  projectionError,
  resolveInventoryRevision,
  createDistributionPlan,
  createDistributionArtifact,
  createEvidenceResult,
  skillProjectionMetadata,
};
