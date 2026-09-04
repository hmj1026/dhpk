'use strict';

// Application/domain facade for deterministic projection planning.  Concrete
// filesystem and consumer implementations are injected at the boundary so
// this module remains safe to exercise without a checkout or installed client.

const {
  createDistributionPlan,
  createDistributionArtifact,
  createEvidenceResult,
  projectionError,
  VERIFICATION_STAGES,
} = require('./distribution-projection-contract');
const {
  hasCodexSurface,
  normalizeSkillUsage,
  usageFingerprint,
  resolveInventoryRevision,
} = require('./skill-usage');

const EMISSION_METADATA_FIELDS = Object.freeze([
  'skillId',
  'publicName',
  'invocationClass',
  'lifecycle',
  'usageSchema',
  'usage',
  'usageFingerprint',
  'provenance',
]);

function canonicalMetadata(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalMetadata).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalMetadata(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateEmissionMetadata(emission, planned) {
  for (const field of EMISSION_METADATA_FIELDS) {
    const expected = planned[field];
    const observed = emission && emission[field];
    if (expected === undefined) {
      if (observed !== undefined) {
        return projectionError(
          'UNDECLARED_PROJECTION_METADATA',
          'materialize',
          `adapter emitted undeclared projection metadata '${field}' for '${planned.stableId}'`,
          { stableIds: [planned.stableId], details: { field } },
        );
      }
      continue;
    }
    if (observed === undefined) {
      return projectionError(
        'INCOMPLETE_PROJECTION_METADATA',
        'materialize',
        `adapter omitted planned projection metadata '${field}' for '${planned.stableId}'`,
        { stableIds: [planned.stableId], details: { field } },
      );
    }
    if (canonicalMetadata(expected) !== canonicalMetadata(observed)) {
      return projectionError(
        'PROJECTION_METADATA_DRIFT',
        'materialize',
        `adapter projection metadata '${field}' drifted for '${planned.stableId}'`,
        { stableIds: [planned.stableId], details: { field, expected, actual: observed } },
      );
    }
  }
  return null;
}

const MIGRATED_SELECTION_SURFACES = Object.freeze(['agent-plugin', 'cursor-plugin', 'codex-native']);
const SELECTION_POLICY_SOURCES = Object.freeze(['surface_membership', 'projection', 'platform_matrix', 'entry_surfaces']);

function selectionPolicyError(message, details = {}) {
  return projectionError('INVALID_SELECTION_POLICY', 'compile', message, details);
}

function allInventoryEntries(inventory) {
  return [...(inventory && inventory.skills || []), ...(inventory && inventory.modules || [])]
    .filter((entry) => entry && typeof entry === 'object');
}

function inventoryEntryProjection(entry, inventory) {
  const projected = {
    id: entry.id,
    source: entry.path,
    sourceFingerprint: entry.source_fingerprint || entry.sourceFingerprint || null,
    destination: entry.destination || entry.path,
    owner: entry.owner || entry.id,
    transform: entry.transform || { id: 'identity', version: '1' },
    expectedFingerprint: entry.expected_fingerprint || entry.expectedFingerprint || null,
    symlinkPolicy: entry.symlink_policy || entry.symlinkPolicy || 'forbid',
  };
  if (entry.usage !== undefined && entry.usage !== null) {
    projected.skillId = entry.id;
    projected.publicName = entry.name || entry.publicName || entry.id;
    projected.canonicalSource = entry.path;
    projected.sourceOwner = entry.owner || entry.id;
    projected.lifecycle = entry.lifecycle === undefined ? null : entry.lifecycle;
    projected.invocationClass = entry.invocation_class || entry.invocationClass || null;
    projected.retirementState = entry.retirement_state || entry.retirementState
      || (entry.lifecycle === 'deprecated' ? 'retired' : 'active');
    projected.inventoryRevision = resolveInventoryRevision(inventory);
    const usageInput = { skill: entry, usage: entry.usage };
    projected.usage = normalizeSkillUsage(usageInput);
    projected.usageFingerprint = usageFingerprint(usageInput);
  } else if (inventory
      && inventory.schema === 'dhpk.distribution-inventory.v2'
      && hasCodexSurface(entry)
      && (entry.name || entry.publicName || entry.invokable === true)) {
    return {
      error: projectionError(
        'INCOMPLETE_PLAN',
        'compile',
        `Codex-invokable skill '${entry.id}' is missing an inventory-owned usage contract`,
        { stableIds: [entry.id], details: { field: 'usage' } },
      ),
    };
  }
  if (projected.usage) {
    projected.provenance = {
      schema: 'dhpk.skill-provenance.v1',
      inventoryRevision: projected.inventoryRevision,
      canonicalSource: projected.canonicalSource,
      sourceFingerprint: projected.sourceFingerprint,
      owner: projected.sourceOwner,
      transform: projected.transform,
      lifecycle: projected.lifecycle,
      retirementState: projected.retirementState,
      publicName: projected.publicName,
      invocationClass: projected.usage.invocation_class,
    };
  }
  delete projected.stableId;
  return { value: projected };
}

function idsFromProjectionValue(value) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item])
      : [];
  return values.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return null;
    return item.source_id || item.sourceId || item.skill_id || item.skillId || item.id;
  }).filter((id) => typeof id === 'string');
}

function idsFromPlatformMatrix(inventory, surface, entries) {
  const matrix = inventory && inventory.platform_matrix;
  const rows = Array.isArray(matrix) ? matrix : matrix && Array.isArray(matrix.entries) ? matrix.entries : [];
  const surfaceRows = rows.filter((row) => row && row.surface === surface);
  const ids = [];
  const fields = ['stable_ids', 'stableIds', 'source_id', 'sourceId', 'source_ids', 'sourceIds', 'skill_id', 'skillId', 'skill_ids', 'skillIds', 'selected_id', 'selectedId', 'selected_ids', 'selectedIds', 'ids'];
  for (const row of surfaceRows) {
    for (const field of fields) {
      if (Array.isArray(row[field])) ids.push(...row[field]);
      else if (typeof row[field] === 'string') ids.push(row[field]);
    }
  }
  if (ids.length > 0) return ids.filter((id) => typeof id === 'string');
  const paths = surfaceRows.flatMap((row) => Array.isArray(row.source_paths) ? row.source_paths : []);
  if (paths.length === 0) return surfaceRows.length > 0 ? [] : null;
  return entries.filter((entry) => paths.some((source) => source === 'skills/' || source === entry.path || (source.endsWith('/') && entry.path && entry.path.startsWith(source)))).map((entry) => entry.id);
}

function resolveSelectionIds(inventory, surface) {
  const contract = inventory && inventory.projection_contract;
  const rule = contract && contract.surfaces && contract.surfaces[surface];
  const policy = rule && rule.selection_policy;
  if (!MIGRATED_SELECTION_SURFACES.includes(surface)) return { ids: null, policy: policy || null };
  // Small internal callers that provide pre-contract fixtures remain on the
  // compatibility path during migration. Once an inventory declares the
  // projection contract, migrated surfaces must declare policy explicitly.
  if (!contract || !rule) return { ids: null, policy: null };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return { error: selectionPolicyError(`surface '${surface}' is missing a selection policy`) };
  if (!SELECTION_POLICY_SOURCES.includes(policy.source) || !Array.isArray(policy.precedence) || policy.precedence.length === 0) {
    return { error: selectionPolicyError(`surface '${surface}' declares an unsupported selection policy`) };
  }
  const entries = allInventoryEntries(inventory);
  const byId = new Map();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  for (const source of policy.precedence) {
    if (!SELECTION_POLICY_SOURCES.includes(source)) return { error: selectionPolicyError(`surface '${surface}' declares unsupported selection source '${source}'`) };
    let ids = null;
    if (source === 'surface_membership') {
      if (inventory.surface_membership && Object.prototype.hasOwnProperty.call(inventory.surface_membership, surface)) ids = inventory.surface_membership[surface];
    } else if (source === 'projection') {
      if (inventory.projections && Object.prototype.hasOwnProperty.call(inventory.projections, surface)) ids = idsFromProjectionValue(inventory.projections[surface]);
    } else if (source === 'platform_matrix') {
      ids = idsFromPlatformMatrix(inventory, surface, entries);
    } else if (source === 'entry_surfaces') {
      ids = entries.filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes(surface)).map((entry) => entry.id);
    }
    if (ids === null) continue;
    const unique = [...new Set(ids)];
    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return { error: selectionPolicyError(`surface '${surface}' selection policy references unknown stable IDs`, { stableIds: missing }) };
    }
    const selected = unique
      .map((id) => byId.get(id))
      .filter((entry) => entry && entry.lifecycle !== 'deprecated');
    return { ids: selected.map((entry) => entry.id).sort(), policy };
  }
  return { error: selectionPolicyError(`surface '${surface}' selection policy has no resolvable membership data`) };
}

function inventoryEntries(inventory, surface) {
  if (!inventory || typeof inventory !== 'object') return [];
  const resolved = resolveSelectionIds(inventory, surface);
  if (resolved.error) return resolved;
  const selectedIds = resolved.ids;
  const inventoryEntries = allInventoryEntries(inventory);
  const byId = new Map();
  for (const entry of inventoryEntries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  // Pre-contract callers retain the original surface-membership boundary;
  // selection policy is optional only for compatibility fixtures, not a
  // reason to broaden a requested surface to every inventory entry.
  const legacySurfaceEntries = inventoryEntries.filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes(surface));
  const selectedEntries = (selectedIds === null ? legacySurfaceEntries : selectedIds.map((id) => byId.get(id)).filter(Boolean));
  const entries = selectedEntries
    .filter((entry) => entry.lifecycle !== 'deprecated')
    .map((entry) => inventoryEntryProjection(entry, inventory));
  const invalid = entries.find((entry) => entry && entry.error);
  if (invalid) return invalid;
  return {
    entries: entries.map((entry) => entry.value),
    selectedStableIds: selectedIds,
    selectionPolicy: resolved.policy,
    inventoryRevision: resolveInventoryRevision(inventory),
  };
}

function compileDistribution(inputs = {}) {
  // `entries` is intentionally retained as an internal expansion seam: the
  // caller must already have selected a complete output set. Surface adapters
  // cannot use it to decide inventory membership; inventory-backed calls below
  // are the only public selection path for migrated surfaces.
  const profileSelection = inputs.profileSelection || inputs.selection || null;
  let entries = inputs.entries;
  let selection = { selectedStableIds: null, selectionPolicy: null };
  if (!inputs.entries) {
    const resolved = inventoryEntries(inputs.inventory, inputs.surface);
    if (resolved && resolved.error) return { ok: false, error: resolved.error };
    entries = resolved.entries;
    selection = {
      selectedStableIds: resolved.selectedStableIds,
      selectionPolicy: resolved.selectionPolicy,
      inventoryRevision: resolved.inventoryRevision,
    };
    if (profileSelection && Array.isArray(profileSelection.selectedStableIds)) {
      const selected = new Set(profileSelection.emittedStableIds || profileSelection.selectedStableIds);
      entries = entries.filter((entry) => selected.has(entry.stableId));
    }
  }
  if (!inputs.entries && (!inputs.inventory || typeof inputs.inventory !== 'object')) {
    return {
      ok: false,
      error: projectionError('INVALID_INPUT', 'compile', 'inventory is required when entries are not supplied'),
    };
  }
  if (inputs.surface === 'claude-profile' && (!inputs.profileSelection || typeof inputs.profileSelection !== 'object')) {
    return {
      ok: false,
      error: projectionError('INCOMPLETE_PLAN', 'compile', 'claude-profile compilation requires explicit profile selection'),
    };
  }
  const planInput = { ...inputs, entries };
  const selectedStableIds = inputs.selectedStableIds
    || (profileSelection && Array.isArray(profileSelection.selectedStableIds) ? profileSelection.selectedStableIds : selection.selectedStableIds);
  const selectionPolicy = inputs.selectionPolicy || selection.selectionPolicy;
  if (selectedStableIds !== null && selectedStableIds !== undefined) planInput.selectedStableIds = selectedStableIds;
  if (selectionPolicy !== null && selectionPolicy !== undefined) planInput.selectionPolicy = selectionPolicy;
  if (selection.inventoryRevision && planInput.inventoryRevision === undefined) planInput.inventoryRevision = selection.inventoryRevision;
  if (profileSelection) {
    planInput.profileSelection = profileSelection;
    if (!inputs.entries && Array.isArray(profileSelection.selectedStableIds)) {
      const canonicalIds = new Set(profileSelection.selectedStableIds);
      planInput.selectionEntries = allInventoryEntries(inputs.inventory)
        .filter((entry) => canonicalIds.has(entry.id) && entry.lifecycle !== 'deprecated')
        .map((entry) => ({
          id: entry.id,
          source: entry.path,
          destination: entry.destination || entry.path,
          owner: entry.owner || entry.id,
          transform: entry.transform || { id: 'identity', version: '1' },
          symlinkPolicy: entry.symlink_policy || entry.symlinkPolicy || 'forbid',
        }));
    }
    if (profileSelection.selectionFingerprint) planInput.selectionFingerprint = profileSelection.selectionFingerprint;
    if (profileSelection.surfaceSelectionFingerprint) planInput.surfaceSelectionFingerprint = profileSelection.surfaceSelectionFingerprint;
    if (profileSelection.emittedStableIds) planInput.emittedStableIds = profileSelection.emittedStableIds;
    if (!planInput.selectionPolicy) {
      planInput.selectionPolicy = {
        source: 'profile',
        version: profileSelection.selectionPolicyVersion || 'dhpk.capability-bundle-selection.v1',
      };
    }
  }
  return createDistributionPlan(planInput);
}

function materializeDistribution(plan, adapter, artifactStore, { activate = true, activationGate = null } = {}) {
  if (!plan || typeof plan !== 'object' || !plan.planFingerprint) {
    return { ok: false, error: projectionError('INVALID_PLAN', 'materialize', 'a compiled plan is required') };
  }
  if (!adapter || typeof adapter.render !== 'function') {
    return { ok: false, error: projectionError('INVALID_ADAPTER', 'materialize', 'projection adapter must expose render(plan)') };
  }
  if (!artifactStore || typeof artifactStore.begin !== 'function') {
    return { ok: false, error: projectionError('INVALID_STORE', 'materialize', 'artifact store must expose begin(plan)') };
  }

  let session;
  try {
    session = artifactStore.begin(plan);
    const rendered = adapter.render(plan, { session });
    if (!rendered || !Array.isArray(rendered.outputs)) {
      throw new Error('projection adapter must return { outputs }');
    }
    if (rendered.links !== undefined && !Array.isArray(rendered.links)) {
      throw new Error('projection adapter links must be an array when present');
    }
    if (typeof session.write !== 'function' || (typeof session.stage !== 'function' && typeof session.publish !== 'function')) {
      throw new Error('artifact store session must expose write(output) and stage()/publish()');
    }
    const links = rendered.links || [];
    const expectedIds = new Set(plan.entries.map((entry) => entry.stableId));
    const emittedIds = new Set();
    const checkEmission = (emission) => {
      const stableId = emission && emission.stableId;
      if (!expectedIds.has(stableId)) {
        const error = new Error(`rendered output '${stableId}' is absent from the plan`);
        error.projectionCode = 'UNPLANNED_OUTPUT';
        error.projectionDetails = { stableIds: [stableId] };
        throw error;
      }
      if (emittedIds.has(stableId)) {
        const error = new Error(`planned output '${stableId}' was emitted more than once`);
        error.projectionCode = 'DUPLICATE_OUTPUT';
        error.projectionDetails = { stableIds: [stableId] };
        throw error;
      }
      const metadataError = validateEmissionMetadata(emission, plan.entries.find((entry) => entry.stableId === stableId));
      if (metadataError) {
        const error = new Error(metadataError.message);
        error.projectionCode = metadataError.code;
        error.projectionDetails = { stableIds: metadataError.stableIds, details: metadataError.details };
        throw error;
      }
      emittedIds.add(stableId);
    };
    for (const output of rendered.outputs) {
      checkEmission(output);
      session.write(output);
    }
    if (typeof session.link !== 'function' && links.length > 0) {
      throw new Error('artifact store session must expose link(output) for rendered links');
    }
    for (const link of links) {
      checkEmission(link);
      session.link(link);
    }
    const missingIds = plan.entries
      .map((entry) => entry.stableId)
      .filter((stableId) => !emittedIds.has(stableId));
    if (missingIds.length > 0) {
      const error = new Error(`rendered projection is missing planned outputs: ${missingIds.join(', ')}`);
      error.projectionCode = 'INCOMPLETE_OUTPUTS';
      error.projectionDetails = { stableIds: missingIds };
      throw error;
    }
    if (typeof adapter.validate === 'function') {
      adapter.validate(rendered, { plan, session });
    }
    const staged = typeof session.stage === 'function' ? session.stage() : session.publish();
    let published = staged;
    if (activationGate) {
      const gate = activationGate({ plan, staged, session });
      if (!gate || gate.ok !== true) {
        const error = new Error(gate && gate.error ? gate.error.message : 'candidate activation gate rejected the staged artifact');
        error.projectionCode = gate && gate.error && gate.error.code || 'ACTIVATION_BLOCKED';
        throw error;
      }
    }
    if (activate && typeof session.activate === 'function') published = session.activate();
    const artifact = createDistributionArtifact({
      planFingerprint: plan.planFingerprint,
      adapter: rendered.adapter || adapter.identity || { id: 'unknown', version: 'unknown' },
      outputs: published && published.outputs ? published.outputs : rendered.outputs,
      links: published && published.links ? published.links : links,
      artifactFingerprint: published && published.artifactFingerprint,
      metadata: rendered.metadata,
      ...(plan.usageSchema !== undefined ? { usageSchema: plan.usageSchema } : {}),
      ...(plan.inventoryRevision !== undefined ? { inventoryRevision: plan.inventoryRevision } : {}),
      ...(plan.usageFingerprints !== undefined ? { usageFingerprints: plan.usageFingerprints } : {}),
      ...(plan.provenance !== undefined ? { provenance: plan.provenance } : {}),
      ...(plan.selectionFingerprint !== undefined ? { selectionFingerprint: plan.selectionFingerprint } : {}),
      ...(plan.surfaceSelectionFingerprint !== undefined ? { surfaceSelectionFingerprint: plan.surfaceSelectionFingerprint } : {}),
      ...(plan.externalSkillPackagesFingerprint !== undefined
        ? { externalSkillPackagesFingerprint: plan.externalSkillPackagesFingerprint }
        : {}),
    });
    if (!artifact.ok) return artifact;
    return artifact;
  } catch (error) {
    if (session && typeof session.abort === 'function') {
      try { session.abort(); } catch (_) { /* preserve original failure */ }
    }
    return {
      ok: false,
      error: projectionError(error.projectionCode || 'MATERIALIZATION_FAILED', 'materialize', error.message, {
        stableIds: error.projectionDetails && error.projectionDetails.stableIds,
        paths: error.projectionDetails && error.projectionDetails.paths,
        details: { cause: error.name },
      }),
    };
  }
}

function verifyDistribution(stage, artifact, consumerAdapter) {
  if (!VERIFICATION_STAGES.includes(stage)) {
    return { ok: false, error: projectionError('INVALID_STAGE', 'verify', `unsupported verification stage '${stage}'`, { stage }) };
  }
  if (!artifact || typeof artifact !== 'object' || !artifact.planFingerprint) {
    return { ok: false, error: projectionError('INVALID_ARTIFACT', 'verify', 'a materialized artifact is required', { stage }) };
  }
  if (!consumerAdapter || typeof consumerAdapter.verify !== 'function') {
    return { ok: false, error: projectionError('INVALID_ADAPTER', 'verify', 'consumer adapter must expose verify(stage, artifact)', { stage }) };
  }
  try {
    const observed = consumerAdapter.verify(stage, artifact);
    return createEvidenceResult({
      ...observed,
      stage,
      planFingerprint: artifact.planFingerprint,
      artifactFingerprint: artifact.artifactFingerprint,
      adapter: observed && observed.adapter ? observed.adapter : consumerAdapter.identity,
      ...(artifact.externalSkillPackagesFingerprint !== undefined
        ? { externalSkillPackagesFingerprint: artifact.externalSkillPackagesFingerprint }
        : {}),
    });
  } catch (error) {
    return createEvidenceResult({
      stage,
      planFingerprint: artifact.planFingerprint,
      artifactFingerprint: artifact.artifactFingerprint,
      adapter: consumerAdapter.identity,
      verdict: 'FAIL',
      diagnostics: [error.message],
      ...(artifact.externalSkillPackagesFingerprint !== undefined
        ? { externalSkillPackagesFingerprint: artifact.externalSkillPackagesFingerprint }
        : {}),
    });
  }
}

module.exports = {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
  inventoryEntries,
  resolveSelectionIds,
};
