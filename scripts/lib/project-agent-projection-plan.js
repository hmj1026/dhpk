'use strict';

// The project-agent projection is a compiler-owned selection boundary.  It is
// deliberately pure: inventory metadata is the only input, and this module
// never reads or writes the output directory.  Host adapters consume the plan
// later; they do not decide which capabilities belong to the Portable Profile.

const {
  createDistributionPlan,
  fingerprint,
  projectionError,
} = require('./distribution-projection-contract');

const PROJECT_AGENT_PROJECTION_SCHEMA = 'dhpk.project-agent-projection.v1';
const PROJECT_AGENT_PROFILE_ID = 'portable-core';
const PROJECT_AGENT_HOST_IDS = Object.freeze(['agy', 'claude', 'codex', 'cursor']);
const PROJECT_AGENT_EVIDENCE_SOURCES = Object.freeze([
  'entry_surfaces',
  'surface_membership',
  'platform_matrix',
]);
const PROJECT_AGENT_SURFACES = Object.freeze([
  'claude-core',
  'claude-module',
  'codex-sync',
  'codex-native',
  'agent-plugin',
  'cursor-plugin',
  'cursor-sync',
  'agy-plugin',
]);

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key])]));
  }
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function fail(code, message, details = {}) {
  return freeze({ ok: false, error: projectionError(code, 'compile', message, details) });
}

function configFrom(input) {
  if (!isObject(input)) return { present: false, value: undefined };
  if (Object.prototype.hasOwnProperty.call(input, 'project_agent_projection')) {
    return { present: true, value: input.project_agent_projection };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'projectAgentProjection')) {
    return { present: true, value: input.projectAgentProjection };
  }
  return { present: true, value: input };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function uniqueStringList(value, label, errors, { required = true } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    errors.push(`${label} must be a non-empty string array`);
    return [];
  }
  if (value.some((item) => !nonEmptyString(item))) {
    errors.push(`${label} must contain only non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    errors.push(`${label} must not contain duplicates`);
  }
  return value.filter(nonEmptyString);
}

function validateRelativePath(value, label, errors) {
  if (!nonEmptyString(value)) {
    errors.push(`${label} must be a non-empty relative path`);
    return;
  }
  const segments = value.split('/');
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')
    || /^[A-Za-z]:/.test(value) || segments.includes('.')
    || segments.includes('..') || segments.includes('')) {
    errors.push(`${label} must be a normalized relative path`);
  }
}

function validateTransform(value, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!nonEmptyString(value.id)) errors.push(`${label}.id must be a non-empty string`);
  if (!nonEmptyString(value.version)) errors.push(`${label}.version must be a non-empty string`);
}

function validateDependencySpec(value, label, errors) {
  if (Array.isArray(value)) {
    uniqueStringList(value, `${label}.stable_ids`, errors);
    return;
  }
  if (!isObject(value)) {
    errors.push(`${label} must be a string array or object`);
    return;
  }
  if (value.stable_ids !== undefined) uniqueStringList(value.stable_ids, `${label}.stable_ids`, errors, { required: false });
  if (value.stableIds !== undefined) uniqueStringList(value.stableIds, `${label}.stableIds`, errors, { required: false });
  if (value.supporting_asset_ids !== undefined) {
    uniqueStringList(value.supporting_asset_ids, `${label}.supporting_asset_ids`, errors, { required: false });
  }
  if (value.supportingAssetIds !== undefined) {
    uniqueStringList(value.supportingAssetIds, `${label}.supportingAssetIds`, errors, { required: false });
  }
}

function validateProjectAgentProjection(input = {}) {
  const source = configFrom(input);
  const config = source.value;
  const errors = [];
  if (!source.present || !isObject(config)) {
    return { ok: false, errors: ['project_agent_projection must be an object'] };
  }
  if (config.schema !== PROJECT_AGENT_PROJECTION_SCHEMA) {
    errors.push(`project_agent_projection.schema must be ${PROJECT_AGENT_PROJECTION_SCHEMA}`);
  }
  if (config.scope !== 'project') errors.push("project_agent_projection.scope must be 'project'");
  if (!nonEmptyString(config.owner)) errors.push('project_agent_projection.owner must be a non-empty string');
  validateRelativePath(config.managed_root, 'project_agent_projection.managed_root', errors);
  validateRelativePath(config.receipt, 'project_agent_projection.receipt', errors);

  if (!isObject(config.profiles)) {
    errors.push('project_agent_projection.profiles must be an object');
  } else {
    const profile = config.profiles[PROJECT_AGENT_PROFILE_ID];
    if (!isObject(profile)) {
      errors.push(`project_agent_projection.profiles.${PROJECT_AGENT_PROFILE_ID} is required`);
    } else {
      if (!nonEmptyString(profile.version)) errors.push('portable-core.version must be a non-empty string');
      if (!nonEmptyString(profile.compatibility_mode)) errors.push('portable-core.compatibility_mode must be a non-empty string');
      const stableIds = uniqueStringList(profile.stable_ids, 'portable-core.stable_ids', errors);
      const hosts = uniqueStringList(profile.hosts, 'portable-core.hosts', errors);
      for (const host of hosts) {
        if (!PROJECT_AGENT_HOST_IDS.includes(host)) errors.push(`portable-core.hosts contains unsupported Host '${host}'`);
      }
      if (stableIds.length === 0) errors.push('portable-core.stable_ids must declare an explicit allowlist');
    }
  }

  if (!isObject(config.hosts)) {
    errors.push('project_agent_projection.hosts must be an object');
  } else {
    for (const hostId of PROJECT_AGENT_HOST_IDS) {
      const host = config.hosts[hostId];
      const label = `project_agent_projection.hosts.${hostId}`;
      if (!isObject(host)) {
        errors.push(`${label} is required`);
        continue;
      }
      if (!nonEmptyString(host.surface)) errors.push(`${label}.surface must be a non-empty string`);
      else if (!PROJECT_AGENT_SURFACES.includes(host.surface)) errors.push(`${label}.surface is unsupported: '${host.surface}'`);
      if (!PROJECT_AGENT_EVIDENCE_SOURCES.includes(host.evidence_source)) {
        errors.push(`${label}.evidence_source must be one of ${PROJECT_AGENT_EVIDENCE_SOURCES.join('/')}`);
      }
      if (!nonEmptyString(host.shape)) errors.push(`${label}.shape must be a non-empty string`);
      validateTransform(host.transform, `${label}.transform`, errors);
    }
  }

  if (config.dependencies !== undefined) {
    if (!isObject(config.dependencies)) {
      errors.push('project_agent_projection.dependencies must be an object');
    } else {
      for (const [id, value] of Object.entries(config.dependencies)) {
        validateDependencySpec(value, `project_agent_projection.dependencies.${id}`, errors);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function allEntries(inventory) {
  return [...(Array.isArray(inventory.skills) ? inventory.skills : []),
    ...(Array.isArray(inventory.modules) ? inventory.modules : [])]
    .filter(isObject);
}

function dependencySpec(config, entry) {
  const values = [];
  const assets = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      values.push(...value);
      return;
    }
    if (!isObject(value)) return;
    values.push(...(Array.isArray(value.stable_ids) ? value.stable_ids : []));
    values.push(...(Array.isArray(value.stableIds) ? value.stableIds : []));
    assets.push(...(Array.isArray(value.supporting_asset_ids) ? value.supporting_asset_ids : []));
    assets.push(...(Array.isArray(value.supportingAssetIds) ? value.supportingAssetIds : []));
  };
  add(entry.project_dependencies);
  add(entry.projectDependencies);
  add(config.dependencies && config.dependencies[entry.id]);
  return {
    stableIds: [...new Set(values)].sort(),
    supportingAssetIds: [...new Set(assets)].sort(),
  };
}

function evidenceIds(inventory, host, entries) {
  if (host.evidence_source === 'entry_surfaces') {
    return {
      available: true,
      ids: new Set(entries.filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes(host.surface)).map((entry) => entry.id)),
    };
  }
  if (host.evidence_source === 'surface_membership') {
    const membership = inventory.surface_membership;
    if (!isObject(membership) || !Array.isArray(membership[host.surface])) return { available: false, ids: new Set() };
    return { available: true, ids: new Set(membership[host.surface]) };
  }

  const matrix = inventory.platform_matrix;
  const rows = Array.isArray(matrix)
    ? matrix.filter((row) => row && row.surface === host.surface)
    : isObject(matrix) && Array.isArray(matrix.entries)
      ? matrix.entries.filter((row) => row && row.surface === host.surface)
      : [];
  if (rows.length === 0) return { available: false, ids: new Set() };
  const ids = [];
  for (const row of rows) {
    for (const field of ['stable_ids', 'stableIds', 'source_ids', 'sourceIds', 'ids']) {
      if (Array.isArray(row[field])) ids.push(...row[field]);
      else if (typeof row[field] === 'string') ids.push(row[field]);
    }
    const paths = Array.isArray(row.source_paths) ? row.source_paths : [];
    if (paths.includes('skills/')) {
      ids.push(...entries.map((entry) => entry.id));
    } else if (paths.length > 0) {
      ids.push(...entries.filter((entry) => paths.some((prefix) => entry.path === prefix
        || (typeof prefix === 'string' && prefix.endsWith('/') && typeof entry.path === 'string' && entry.path.startsWith(prefix)))).map((entry) => entry.id));
    }
  }
  return { available: true, ids: new Set(ids) };
}

function planEntry(entry) {
  const value = {
    id: entry.id,
    source: entry.path,
    sourceFingerprint: entry.source_fingerprint || entry.sourceFingerprint || null,
    destination: entry.destination || entry.path,
    owner: entry.owner || entry.id,
    transform: entry.transform || { id: 'project-agent-source', version: '1' },
    expectedFingerprint: entry.expected_fingerprint || entry.expectedFingerprint || null,
    symlinkPolicy: entry.symlink_policy || entry.symlinkPolicy || 'forbid',
  };
  if (entry.usage !== undefined) {
    value.skillId = entry.id;
    value.publicName = entry.name || entry.publicName || entry.id;
    value.invocationClass = entry.invocation_class || entry.invocationClass;
    value.lifecycle = entry.lifecycle === undefined ? null : entry.lifecycle;
    value.usage = clone(entry.usage);
  }
  return value;
}

function dependencyFiles(inventory, assetIds) {
  const assets = Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : [];
  const byId = new Map(assets.filter(isObject).map((asset) => [asset.id, asset]));
  return assetIds.map((id) => {
    const asset = byId.get(id);
    return {
      id,
      source: asset && (asset.canonical_source || asset.source) || null,
      destination: asset && asset.destination || null,
    };
  });
}

function validateSupportingAsset(asset, assetId) {
  const errors = [];
  if (!isObject(asset)) {
    return [`supporting asset '${assetId}' must be an object`];
  }
  const sourceFields = ['source', 'canonical_source'];
  if (!sourceFields.some((field) => nonEmptyString(asset[field]))) {
    errors.push(`supporting asset '${assetId}' must declare source or canonical_source`);
  }
  for (const field of sourceFields) {
    if (asset[field] !== undefined) {
      validateRelativePath(asset[field], `supporting_assets.${assetId}.${field}`, errors);
    }
  }
  validateRelativePath(asset.destination, `supporting_assets.${assetId}.destination`, errors);
  return errors;
}

function compileProjectAgentProjection({ inventory, profileId, requestedHosts } = {}) {
  if (!isObject(inventory)) return fail('INVALID_INPUT', 'inventory is required for project-agent projection compilation');
  const configResult = configFrom(inventory);
  if (!configResult.present || !isObject(configResult.value)) {
    return fail('INVALID_PROJECT_PROJECTION', 'inventory must declare project_agent_projection');
  }
  const validation = validateProjectAgentProjection(inventory);
  if (!validation.ok) {
    return fail('INVALID_PROJECT_PROJECTION', validation.errors.join('; '), { details: { errors: validation.errors } });
  }
  if (!nonEmptyString(profileId)) return fail('INVALID_PROJECT_PROFILE', 'project-agent projection requires an explicit profile id');
  if (profileId !== PROJECT_AGENT_PROFILE_ID) {
    return fail('INVALID_PROJECT_PROFILE', `project-agent projection profile '${profileId}' is not declared as portable-core`);
  }

  const config = configResult.value;
  const profile = config.profiles[profileId];
  const hosts = requestedHosts === undefined ? profile.hosts : requestedHosts;
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.some((host) => !nonEmptyString(host)) || new Set(hosts).size !== hosts.length) {
    return fail('INVALID_PROJECT_HOST', 'requestedHosts must be a non-empty, unique string array');
  }
  const canonicalHosts = [...hosts].sort();
  for (const hostId of canonicalHosts) {
    if (!PROJECT_AGENT_HOST_IDS.includes(hostId) || !profile.hosts.includes(hostId) || !isObject(config.hosts[hostId])) {
      return fail('INVALID_PROJECT_HOST', `requested Host '${hostId}' is not declared by portable-core`);
    }
  }

  const entries = allEntries(inventory);
  const byId = new Map();
  const duplicateIds = new Set();
  for (const entry of entries) {
    if (!nonEmptyString(entry.id) || !nonEmptyString(entry.path)) {
      return fail('INVALID_PROJECT_ENTRY', 'every project projection entry requires a stable id and source path');
    }
    if (byId.has(entry.id)) duplicateIds.add(entry.id);
    else byId.set(entry.id, entry);
  }

  const selectedStableIds = [...profile.stable_ids].sort();
  const missingSelected = selectedStableIds.filter((id) => !byId.has(id));
  if (missingSelected.length > 0) {
    return fail('PROJECT_PROFILE_ENTRY_MISSING', 'portable-core references unknown inventory entries', { stableIds: missingSelected });
  }
  const ambiguousSelected = selectedStableIds.filter((id) => duplicateIds.has(id));
  if (ambiguousSelected.length > 0) {
    return fail('INVALID_PROJECT_ENTRY', 'portable-core references ambiguous inventory entries', { stableIds: ambiguousSelected });
  }
  const uniqueEntries = [...byId.values()];
  const selectedSet = new Set(selectedStableIds);
  const dependencyById = new Map();
  const dependencyEdges = [];
  const closureIds = new Set();
  const supportingAssetIds = new Set();
  const supportingAssets = new Map((Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : [])
    .filter(isObject).map((asset) => [asset.id, asset]));
  const visiting = new Set();

  function visit(id, stack = []) {
    if (visiting.has(id)) {
      const cycle = [...stack, id];
      return fail('PROJECT_DEPENDENCY_CYCLE', `project dependency cycle detected: ${cycle.join(' -> ')}`, { stableIds: cycle });
    }
    if (!byId.has(id)) return fail('PROJECT_DEPENDENCY_MISSING', `project dependency '${id}' is not present in inventory`, { stableIds: [id] });
    if (closureIds.has(id)) return null;
    visiting.add(id);
    closureIds.add(id);
    const spec = dependencySpec(config, byId.get(id));
    dependencyById.set(id, spec.stableIds);
    for (const assetId of spec.supportingAssetIds) {
      if (!supportingAssets.has(assetId)) {
        return fail('PROJECT_SUPPORTING_ASSET_MISSING', `project dependency '${id}' references unknown supporting asset '${assetId}'`, { stableIds: [id] });
      }
      const assetErrors = validateSupportingAsset(supportingAssets.get(assetId), assetId);
      if (assetErrors.length > 0) {
        return fail('INVALID_PROJECT_SUPPORTING_ASSET', assetErrors.join('; '), {
          stableIds: [id],
          paths: [assetId],
          details: { errors: assetErrors, supportingAssetIds: [assetId] },
        });
      }
      supportingAssetIds.add(assetId);
    }
    for (const dependencyId of spec.stableIds) {
      dependencyEdges.push({ from: id, to: dependencyId });
      const result = visit(dependencyId, [...stack, id]);
      if (result) return result;
    }
    visiting.delete(id);
    return null;
  }

  for (const id of selectedStableIds) {
    const result = visit(id);
    if (result) return result;
  }

  const closureStableIds = [...closureIds].sort();
  const dependencyClosure = {
    roots: selectedStableIds,
    stableIds: closureStableIds,
    supportingAssetIds: [...supportingAssetIds].sort(),
    files: dependencyFiles(inventory, [...supportingAssetIds].sort()),
    edges: dependencyEdges.sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`)),
  };

  const evidenceByHost = new Map(canonicalHosts.map((hostId) => [
    hostId,
    evidenceIds(inventory, config.hosts[hostId], uniqueEntries),
  ]));
  const localDecisions = new Map();
  for (const id of closureStableIds) {
    const entry = byId.get(id);
    const role = entry.invokable === false ? 'runtime-support' : 'public-skill';
    const hostResults = {};
    for (const hostId of canonicalHosts) {
      const host = config.hosts[hostId];
      const evidence = evidenceByHost.get(hostId);
      let supported = evidence.available && evidence.ids.has(id);
      let reasonCode = 'HOST_SUPPORTED';
      let reason = `declared ${host.evidence_source} evidence supports '${id}'`;
      if (!evidence.available) {
        supported = false;
        reasonCode = 'HOST_EVIDENCE_MISSING';
        reason = `Host '${hostId}' has no ${host.evidence_source} evidence for '${host.surface}'`;
      } else if (!supported) {
        reasonCode = 'HOST_UNSUPPORTED_ENTRY';
        reason = `Host '${hostId}' does not declare '${id}' on '${host.surface}'`;
      }
      hostResults[hostId] = {
        surface: host.surface,
        evidenceSource: host.evidence_source,
        supported,
        reasonCode,
        reason,
      };
    }
    const ownUnsupported = !entry.lifecycle || entry.lifecycle === 'deprecated'
      ? { reasonCode: 'INACTIVE_ENTRY', reason: `inventory entry '${id}' is not active` }
      : Object.values(hostResults).find((host) => !host.supported);
    localDecisions.set(id, {
      stableId: id,
      role,
      selected: selectedSet.has(id),
      hosts: hostResults,
      ownUnsupported,
    });
  }

  const finalDecisionCache = new Map();
  function finalDecision(id) {
    if (finalDecisionCache.has(id)) return finalDecisionCache.get(id);
    const local = localDecisions.get(id);
    if (local.ownUnsupported) {
      const decision = {
        ...local,
        outcome: 'SKIP_INCOMPATIBLE',
        reasonCode: local.ownUnsupported.reasonCode,
        reason: local.ownUnsupported.reason,
      };
      finalDecisionCache.set(id, decision);
      return decision;
    }
    for (const dependencyId of dependencyById.get(id) || []) {
      const dependency = finalDecision(dependencyId);
      if (dependency.outcome !== 'EMIT') {
        const decision = {
          ...local,
          outcome: 'SKIP_INCOMPATIBLE',
          reasonCode: 'DEPENDENCY_INCOMPATIBLE',
          reason: `dependency '${dependencyId}' is incompatible: ${dependency.reason}`,
          blockedBy: dependencyId,
        };
        finalDecisionCache.set(id, decision);
        return decision;
      }
    }
    const decision = {
      ...local,
      outcome: 'EMIT',
      reasonCode: 'HOST_SUPPORTED',
      reason: `entry '${id}' is supported by all requested Hosts`,
    };
    finalDecisionCache.set(id, decision);
    return decision;
  }

  const capabilityDecisions = closureStableIds.map((id) => {
    const decision = finalDecision(id);
    const { ownUnsupported, ...publicDecision } = decision;
    return publicDecision;
  });
  const emittedStableIds = capabilityDecisions.filter((entry) => entry.outcome === 'EMIT').map((entry) => entry.stableId).sort();
  const selected = selectedStableIds.map((id) => {
    const decision = capabilityDecisions.find((entry) => entry.stableId === id);
    return {
      stableId: id,
      role: decision.role,
      outcome: decision.outcome,
      reason: 'declared by the portable-core explicit allowlist',
    };
  });
  const incompatible = capabilityDecisions.filter((entry) => entry.outcome === 'SKIP_INCOMPATIBLE').map((entry) => ({
    stableId: entry.stableId,
    role: entry.role,
    reasonCode: entry.reasonCode,
    reason: entry.reason,
    ...(entry.blockedBy ? { blockedBy: entry.blockedBy } : {}),
  }));
  const skipped = uniqueEntries
    .filter((entry) => !closureIds.has(entry.id))
    .map((entry) => ({
      stableId: entry.id,
      status: 'SKIP_NOT_SELECTED',
      reason: `entry '${entry.id}' is outside the portable-core explicit allowlist and dependency closure`,
    }))
    .sort((left, right) => left.stableId.localeCompare(right.stableId));

  const hostBindings = Object.fromEntries(canonicalHosts.map((hostId) => {
    const host = config.hosts[hostId];
    return [hostId, {
      host: hostId,
      surface: host.surface,
      evidenceSource: host.evidence_source,
      shape: host.shape,
      transform: clone(host.transform),
      selectedStableIds,
      emittedStableIds,
    }];
  }));
  const profileFingerprint = fingerprint({
    profileId,
    version: profile.version,
    compatibilityMode: profile.compatibility_mode,
    selectedStableIds,
    requestedHosts: canonicalHosts,
  });
  const selectionFingerprint = fingerprint({
    profileFingerprint,
    selectedStableIds,
    dependencyClosure,
  });
  const capabilityEvidenceFingerprint = fingerprint({
    requestedHosts: canonicalHosts,
    hostBindings,
    capabilityDecisions,
  });
  const projectionOwner = {
    scope: config.scope,
    owner: config.owner,
    managedRoot: config.managed_root,
    receipt: config.receipt,
  };

  const plan = createDistributionPlan({
    surface: 'project-agent-projection',
    entries: emittedStableIds.map((id) => planEntry(byId.get(id))),
    selectionEntries: selectedStableIds.map((id) => planEntry(byId.get(id))),
    selectedStableIds,
    emittedStableIds,
    selectionPolicy: {
      source: 'project_agent_projection',
      version: PROJECT_AGENT_PROJECTION_SCHEMA,
      profileId,
    },
    profileSelection: {
      profileId,
      version: profile.version,
      compatibilityMode: profile.compatibility_mode,
      selectionPolicyVersion: PROJECT_AGENT_PROJECTION_SCHEMA,
      selectedStableIds,
      emittedStableIds,
      selectionFingerprint,
    },
    inventoryFingerprint: fingerprint(inventory),
    inventoryRevision: `sha256:${fingerprint(inventory)}`,
    inputFingerprint: fingerprint({
      profileId,
      requestedHosts: canonicalHosts,
      inventoryFingerprint: fingerprint(inventory),
    }),
    selectionFingerprint,
    profileFingerprint,
    scope: { kind: config.scope, artifact: config.managed_root, receipt: config.receipt },
    projectionOwner,
    ownershipRoot: config.managed_root,
    requestedHosts: canonicalHosts,
    dependencyClosure,
    capabilityDecisions,
    capabilityEvidenceFingerprint,
    hostBindings,
    selected,
    skipped,
    incompatible,
    writes: [],
  });
  return plan;
}

module.exports = {
  PROJECT_AGENT_PROJECTION_SCHEMA,
  PROJECT_AGENT_PROFILE_ID,
  PROJECT_AGENT_HOST_IDS,
  PROJECT_AGENT_EVIDENCE_SOURCES,
  validateProjectAgentProjection,
  compileProjectAgentProjection,
};
