'use strict';

// Inventory-owned capability selection.  This module is deliberately pure:
// it resolves profile/module/ID semantics and fingerprints, but never reads
// the filesystem, mutates a profile definition, or activates an artifact.

const {
  canonicalize,
  fingerprint,
  projectionError,
} = require('./distribution-projection-contract');

const SELECTION_POLICY_VERSION = 'dhpk.capability-bundle-selection.v1';
const PROFILE_IDS = Object.freeze(['minimal', 'full', 'compat-v1']);
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SURFACE_ALIASES = Object.freeze({
  'claude-profile': ['claude-profile', 'claude-core', 'claude-module'],
  claude: ['claude', 'claude-core', 'claude-module'],
});
const NON_PASS_VERDICTS = Object.freeze([
  'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE',
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = clone(value[key]);
      return out;
    }, {});
  }
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function error(code, message, stableIds = [], details = {}) {
  return projectionError(code, 'selection', message, { stableIds, details });
}

function fail(code, message, stableIds = [], details = {}) {
  return { ok: false, error: error(code, message, stableIds, details) };
}

function profileTable(profiles) {
  if (profiles && profiles.profiles && typeof profiles.profiles === 'object' && !Array.isArray(profiles.profiles)) return profiles.profiles;
  return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
}

function asIds(value) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return item.id || item.stableId || item.skillId || item.skill_id;
    return null;
  });
}

function profileSkillIds(profile) {
  if (!profile || typeof profile !== 'object') return null;
  for (const key of ['skillIds', 'stableIds', 'selectedStableIds', 'skill_ids', 'skills']) {
    const values = asIds(profile[key]);
    if (values !== null) return values;
  }
  return null;
}

function profileCommandIds(profile) {
  if (!profile || typeof profile !== 'object') return null;
  for (const key of ['commandIds', 'command_ids', 'selectedCommandIds', 'commands']) {
    const values = asIds(profile[key]);
    if (values !== null) return values;
  }
  return null;
}

function profileModules(profile) {
  if (!profile || typeof profile !== 'object') return [];
  for (const key of ['modules', 'moduleIds', 'module_ids']) {
    if (Array.isArray(profile[key])) return profile[key].slice();
  }
  return [];
}

function allSkills(inventory) {
  const candidates = Array.isArray(inventory && inventory.skills)
    ? inventory.skills
    : Array.isArray(inventory && inventory.entries) ? inventory.entries : [];
  const byId = new Map();
  for (const entry of candidates) {
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') continue;
    if (byId.has(entry.id)) return { error: fail('DUPLICATE_STABLE_ID', `duplicate inventory stable id '${entry.id}'`, [entry.id]) };
    byId.set(entry.id, entry);
  }
  return { entries: [...byId.values()], byId };
}

function retiredMap(inventory) {
  return new Map((Array.isArray(inventory && inventory.retired_skills) ? inventory.retired_skills : [])
    .filter((entry) => entry && typeof entry.id === 'string')
    .map((entry) => [entry.id, entry]));
}

function moduleCatalog(moduleCatalog) {
  const modules = new Map();
  const add = (id, requires = []) => {
    if (typeof id !== 'string' || id.trim() === '') return;
    const current = modules.get(id) || { id, requires: [] };
    current.requires = [...new Set([...(current.requires || []), ...(Array.isArray(requires) ? requires : [])])].sort();
    modules.set(id, current);
  };
  for (const entry of moduleCatalog && Array.isArray(moduleCatalog.modules) ? moduleCatalog.modules : []) {
    add(entry && (entry.id || entry.module), entry && entry.requires);
  }
  for (const stack of moduleCatalog && Array.isArray(moduleCatalog.stacks) ? moduleCatalog.stacks : []) {
    for (const version of stack && Array.isArray(stack.versions) ? stack.versions : []) {
      add(version && (version.module || version.id), [
        ...(version && version.requires_module ? [version.requires_module] : []),
        ...(version && Array.isArray(version.requires) ? version.requires : []),
      ]);
    }
  }
  return modules;
}

function resolveModuleClosure(selected, catalog) {
  const result = [];
  const state = new Map();
  const visit = (id, chain) => {
    if (!catalog.has(id)) return error('UNKNOWN_MODULE', `profile references unknown module '${id}'`, [], { chain });
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'active') return error('MODULE_REQUIREMENT_CYCLE', `module requirement cycle detected: ${[...chain, id].join(' -> ')}`);
    state.set(id, 'active');
    for (const dependency of catalog.get(id).requires || []) {
      const nested = visit(dependency, [...chain, id]);
      if (nested) return nested;
    }
    state.set(id, 'done');
    result.push(id);
    return null;
  };
  for (const id of selected) {
    const nested = visit(id, []);
    if (nested) return { error: nested };
  }
  return { modules: result.sort() };
}

function sameIdSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return JSON.stringify(left.slice().sort()) === JSON.stringify(right.slice().sort());
}

function requiredCoreIds(inventory, profile) {
  const candidates = [
    inventory && inventory.required_core_ids,
    inventory && inventory.requiredCoreIds,
    inventory && inventory.profile_policy && inventory.profile_policy.required_core_ids,
    inventory && inventory.profilePolicy && inventory.profilePolicy.requiredCoreIds,
    profileSkillIds(profile),
  ];
  return candidates.find((value) => Array.isArray(value)) || [];
}

function surfaceIds(inventory, surface, entries) {
  if (!surface) return null;
  const aliases = SURFACE_ALIASES[surface] || [surface];
  const membership = inventory && inventory.surface_membership;
  const selected = aliases.map((alias) => membership && membership[alias]).find(Array.isArray);
  if (Array.isArray(selected)) return new Set(selected);
  return new Set(entries.filter((entry) => Array.isArray(entry.surfaces) && aliases.some((alias) => entry.surfaces.includes(alias))).map((entry) => entry.id));
}

function entryMatchesModule(entry, modules) {
  const labels = [
    ...(Array.isArray(entry && entry.profiles) ? entry.profiles : []),
    ...(Array.isArray(entry && entry.modules) ? entry.modules : []),
    ...(entry && typeof entry.module === 'string' ? [entry.module] : []),
  ];
  return labels.some((value) => modules.has(value));
}

function normalizeOverlay(input) {
  const values = input.skillIds !== undefined ? input.skillIds : input.overlayStableIds;
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) return { error: error('INVALID_SKILL_OVERLAY', 'skill overlay must be an array') };
  const ids = values.map((value) => (typeof value === 'string' ? value : value && value.id));
  const invalid = ids.find((id) => typeof id !== 'string' || id.trim() === '');
  if (invalid !== undefined) return { error: error('MISSING_STABLE_ID', 'skill overlay contains a missing stable ID') };
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) return { error: error('DUPLICATE_STABLE_ID', `skill overlay contains duplicate stable ID '${duplicate}'`, [duplicate]) };
  return ids;
}

function standaloneInputValues(input) {
  const names = ['standaloneSkillIds', 'standaloneIds', 'standalone_skill_ids'];
  const present = names.filter((name) => input[name] !== undefined && input[name] !== null);
  if (present.length === 0) return null;
  if (present.some((name) => !Array.isArray(input[name]))) {
    return { error: error('INVALID_STANDALONE_SELECTION', 'standalone selection must be an array') };
  }
  const values = present.flatMap((name) => input[name]);
  if (values.length === 0) return { error: error('EMPTY_STANDALONE_SELECTION', 'standalone selection requires at least one skill') };
  return values;
}

function standaloneCatalog(input) {
  const inventory = input.inventory || {};
  const source = input.standaloneDependencies
    || input.standalone_dependencies
    || inventory.standalone_dependencies
    || inventory.standaloneDependencies
    || {};
  const rows = source && source.skills && typeof source.skills === 'object' && !Array.isArray(source.skills)
    ? source.skills
    : source;
  const catalog = new Map();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && typeof row.id === 'string' && row.id.trim() !== '') catalog.set(row.id, row);
    }
  } else if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
    for (const [id, row] of Object.entries(rows)) {
      if (row && typeof row === 'object' && !Array.isArray(row)) catalog.set(id, { ...row, id: row.id || id });
    }
  }
  return catalog;
}

function standaloneList(spec, keys) {
  for (const key of keys) {
    if (Array.isArray(spec && spec[key])) return spec[key];
  }
  return [];
}

function standaloneReferenceValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.id || value.stableId || value.skillId || value.skill_id || value.name || value.publicName;
  return null;
}

function standaloneIdLookup(entries) {
  const byPublicName = new Map();
  const add = (key, entry) => {
    if (typeof key !== 'string' || key.trim() === '') return;
    const current = byPublicName.get(key);
    if (current && current.id !== entry.id) byPublicName.set(key, null);
    else if (!current) byPublicName.set(key, entry);
  };
  for (const entry of entries) {
    add(entry.name, entry);
    for (const legacy of Array.isArray(entry.legacy_names) ? entry.legacy_names : []) add(legacy, entry);
  }
  return byPublicName;
}

function safeStandalonePath(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && !value.includes('\0')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && value !== '.'
    && value !== '..'
    && !value.startsWith('../')
    && !value.includes('/../')
    && value.split('/').every((part) => part !== '' && part !== '.');
}

function resolveStandaloneSelection({ input, entries, byId, retired, surfaceAllowed, sourceFingerprint, inventoryFingerprint }) {
  const values = standaloneInputValues(input);
  if (values === null) return null;
  if (values.error) return { ok: false, error: values.error };
  const hasProfile = input.profileId !== undefined && input.profileId !== null && input.profileId !== '';
  const overlay = input.skillIds !== undefined && input.skillIds !== null && input.skillIds.length > 0;
  if (hasProfile || overlay) {
    return fail('MIXED_SELECTION_MODES', 'standalone selection cannot be combined with a profile or additive skill overlay');
  }

  const byPublicName = standaloneIdLookup(entries);
  const resolveId = (value, role = 'selected') => {
    const reference = standaloneReferenceValue(value);
    if (!reference) return { error: error('MISSING_STABLE_ID', `standalone ${role} contains a missing stable ID`) };
    if (byId.has(reference)) return { id: reference };
    const named = byPublicName.get(reference);
    if (named === null) return { error: error('AMBIGUOUS_PUBLIC_NAME', `standalone ${role} name '${reference}' is ambiguous`) };
    if (named) return { id: named.id };
    if (retired.has(reference)) return { error: error('RETIRED_STABLE_ID', `stable ID '${reference}' is retired`, [reference], { retired: retired.get(reference) }) };
    return { error: error('UNKNOWN_STABLE_ID', `unknown standalone ${role} '${reference}'`, [reference]) };
  };
  const roots = [];
  for (const value of values) {
    const resolved = resolveId(value);
    if (resolved.error) return { ok: false, error: resolved.error };
    if (!roots.includes(resolved.id)) roots.push(resolved.id);
  }
  roots.sort();
  const catalog = standaloneCatalog(input);
  const selected = new Set();
  const state = new Map();
  const supportingAssetIds = new Set();
  const runtimeSupportIds = new Set();
  const fileByDestination = new Map();
  const unavailableCapabilities = [];
  const supportingAssets = new Map((Array.isArray(input.inventory && input.inventory.supporting_assets)
    ? input.inventory.supporting_assets : []).map((asset) => [asset && asset.id, asset]));
  const runtimeSupport = new Set([
    ...Object.values(input.inventory && input.inventory.internal_runtime_skills || {}).flatMap((ids) => Array.isArray(ids) ? ids : []),
    ...entries.filter((entry) => entry && entry.invokable === false).map((entry) => entry.id),
  ]);

  const checkEntry = (id, role) => {
    if (retired.has(id)) return error('RETIRED_STABLE_ID', `standalone ${role} '${id}' is retired`, [id], { retired: retired.get(id) });
    const entry = byId.get(id);
    if (!entry || entry.lifecycle === 'deprecated') return error('UNKNOWN_STABLE_ID', `unknown standalone ${role} '${id}'`, [id]);
    if (entry.invokable === false) return error('NON_INVOKABLE_STABLE_ID', `standalone ${role} '${id}' is internal runtime support and cannot be public`, [id]);
    if (surfaceAllowed && !surfaceAllowed.has(id)) return error('SURFACE_INCOMPATIBLE', `standalone ${role} '${id}' is not available on surface '${input.surface}'`, [id], { surface: input.surface });
    return null;
  };

  const visit = (id, chain) => {
    const issue = checkEntry(id, chain.length === 0 ? 'skill' : 'required skill');
    if (issue) return issue;
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'active') return error('STANDALONE_DEPENDENCY_CYCLE', `standalone dependency cycle detected: ${[...chain, id].join(' -> ')}`, [...new Set([...chain, id])]);
    state.set(id, 'active');
    const spec = catalog.get(id) || {};
    for (const raw of standaloneList(spec, ['requires', 'required_skill_ids', 'requiredSkills', 'skills'])) {
      const resolved = resolveId(raw, 'dependency');
      if (resolved.error) return resolved.error;
      const nested = visit(resolved.id, [...chain, id]);
      if (nested) return nested;
    }
    for (const raw of standaloneList(spec, ['conflicts', 'conflict_skill_ids'])) {
      const resolved = resolveId(raw, 'conflict');
      if (resolved.error) return resolved.error;
      if (roots.includes(resolved.id) || selected.has(resolved.id)) {
        return error('STANDALONE_CONFLICT', `standalone skill '${id}' conflicts with '${resolved.id}'`, [id, resolved.id]);
      }
    }
    for (const raw of standaloneList(spec, ['supporting_assets', 'supporting_asset_ids'])) {
      const assetId = standaloneReferenceValue(raw);
      const asset = supportingAssets.get(assetId);
      if (!asset) return error('UNKNOWN_SUPPORTING_ASSET', `standalone skill '${id}' references unknown supporting asset '${assetId || '<missing>'}'`, [id], { assetId });
      if (!safeStandalonePath(asset.source) || !safeStandalonePath(asset.destination)) {
        return error('UNRESOLVABLE_SUPPORTING_ASSET', `standalone supporting asset '${assetId}' has an unsafe source or destination`, [id], { assetId });
      }
      supportingAssetIds.add(asset.id);
    }
    for (const raw of standaloneList(spec, ['runtime_support', 'runtime_support_ids', 'runtimeSupport'])) {
      const runtimeId = standaloneReferenceValue(raw);
      if (!runtimeSupport.has(runtimeId)) return error('UNKNOWN_RUNTIME_SUPPORT', `standalone skill '${id}' references unknown runtime support '${runtimeId || '<missing>'}'`, [id], { runtimeId });
      runtimeSupportIds.add(runtimeId);
    }
    for (const raw of standaloneList(spec, ['files', 'required_files', 'requiredFiles'])) {
      const file = typeof raw === 'string' ? { source: raw, destination: raw } : raw;
      if (!file || !safeStandalonePath(file.source) || !safeStandalonePath(file.destination || file.source)) {
        return error('UNRESOLVABLE_STANDALONE_FILE', `standalone skill '${id}' declares an unsafe required file`, [id]);
      }
      const normalized = { source: file.source, destination: file.destination || file.source, owner: file.owner || id };
      const prior = fileByDestination.get(normalized.destination);
      if (prior && prior.source !== normalized.source) {
        return error('STANDALONE_DEPENDENCY_CONFLICT', `standalone files collide at '${normalized.destination}'`, [id], { existingSource: prior.source, source: normalized.source });
      }
      fileByDestination.set(normalized.destination, normalized);
    }
    for (const raw of standaloneList(spec, ['capabilities', 'required_capabilities'])) {
      const capability = typeof raw === 'string' ? { id: raw } : raw;
      if (!capability || typeof capability.id !== 'string' || capability.id.trim() === '') {
        return error('INVALID_CAPABILITY', `standalone skill '${id}' declares an invalid capability`, [id]);
      }
      const availability = input.capabilityAvailability && input.capabilityAvailability[capability.id];
      const available = capability.available !== false && availability !== false;
      if (!available) {
        const row = { id: capability.id, reason: capability.reason || 'unavailable', required: capability.required !== false };
        unavailableCapabilities.push(row);
      }
    }
    selected.add(id);
    state.set(id, 'done');
    return null;
  };

  for (const id of roots) {
    const issue = visit(id, []);
    if (issue) return { ok: false, error: issue };
  }
  for (const id of [...selected].sort()) {
    const spec = catalog.get(id) || {};
    for (const raw of standaloneList(spec, ['conflicts', 'conflict_skill_ids'])) {
      const resolved = resolveId(raw, 'conflict');
      if (resolved.error) return { ok: false, error: resolved.error };
      if (selected.has(resolved.id)) {
        return { ok: false, error: error('STANDALONE_CONFLICT', `standalone skill '${id}' conflicts with '${resolved.id}'`, [id, resolved.id]) };
      }
    }
  }
  const selectedStableIds = [...selected].sort();
  const emittedPublicNames = selectedStableIds.map((id) => byId.get(id).name || id).sort();
  const uniqueUnavailableCapabilities = [...new Map(unavailableCapabilities.map((row) => [row.id, row])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const dependencyClosure = {
    skillIds: selectedStableIds,
    supportingAssetIds: [...supportingAssetIds].sort(),
    runtimeSupportIds: [...runtimeSupportIds].sort(),
    files: [...fileByDestination.values()].sort((left, right) => left.destination.localeCompare(right.destination)),
    unavailableCapabilities: uniqueUnavailableCapabilities,
  };
  const profileDefinition = null;
  const profileFingerprint = fingerprint({ mode: 'standalone', requestedStableIds: roots, dependencyClosure });
  const identity = {
    schema: SELECTION_POLICY_VERSION,
    id: 'standalone',
    profileId: null,
    selectedStableIds,
    selectedCommandIds: null,
    moduleClosure: [],
    compatibilityMode: 'standalone',
    selectionMode: 'standalone',
    selectionPolicyVersion: input.policyVersion || SELECTION_POLICY_VERSION,
    requestedStableIds: roots,
    emittedStableIds: selectedStableIds,
    emittedPublicNames,
    dependencyClosure,
    unavailableCapabilities: dependencyClosure.unavailableCapabilities,
    sourceFingerprint,
    profileFingerprint,
    inventoryFingerprint,
  };
  return { ok: true, value: freeze({
    ...identity,
    profileDefinition,
    overlayStableIds: [],
    selectionFingerprint: fingerprint(identity),
    surfaceFingerprint: null,
  }) };
}

function resolveCapabilitySelection(input = {}) {
  const inventoryResult = allSkills(input.inventory);
  if (inventoryResult.error) return inventoryResult.error;
  const { entries, byId } = inventoryResult;
  const retired = retiredMap(input.inventory);
  const hasStandaloneInput = standaloneInputValues(input) !== null;
  const calculatedInventoryFingerprint = input.inventoryFingerprint || fingerprint(hasStandaloneInput
    ? {
      skills: entries,
      retired_skills: input.inventory && input.inventory.retired_skills || [],
      standalone_dependencies: input.standaloneDependencies
        || input.inventory && (input.inventory.standalone_dependencies || input.inventory.standaloneDependencies)
        || null,
    }
    : { skills: entries, retired_skills: input.inventory && input.inventory.retired_skills || [] });
  const standalone = resolveStandaloneSelection({
    input,
    entries,
    byId,
    retired,
    surfaceAllowed: surfaceIds(input.inventory, input.surface, entries),
    sourceFingerprint: input.sourceFingerprint || input.sourceInputs && fingerprint(clone(input.sourceInputs)) || fingerprint({ source: input.source || null }),
    inventoryFingerprint: calculatedInventoryFingerprint,
  });
  if (standalone) return standalone;
  const table = profileTable(input.profiles);
  const profileId = input.profileId === undefined || input.profileId === null || input.profileId === '' ? 'minimal' : input.profileId;
  if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) return fail('INVALID_PROFILE_ID', 'profile id must use a finite safe alias');
  if (!Object.prototype.hasOwnProperty.call(table, profileId)) return fail('UNKNOWN_PROFILE', `unknown profile '${profileId}'`);
  const profile = table[profileId];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return fail('INVALID_PROFILE', `profile '${profileId}' must be an object`);
  const modules = moduleCatalog(input.moduleCatalog);
  const selectedModules = profileModules(profile);
  if (new Set(selectedModules).size !== selectedModules.length) return fail('DUPLICATE_MODULE', `profile '${profileId}' declares duplicate modules`);
  const closureResult = resolveModuleClosure(selectedModules, modules);
  if (closureResult.error) return { ok: false, error: closureResult.error };
  const moduleClosure = closureResult.modules;
  const excludes = profile.excludes && typeof profile.excludes === 'object' && !Array.isArray(profile.excludes)
    ? Object.keys(profile.excludes).sort()
    : [];
  if (profile.excludes !== undefined && (!profile.excludes || typeof profile.excludes !== 'object' || Array.isArray(profile.excludes))) {
    return fail('INVALID_PROFILE', `profile '${profileId}' excludes must be an object`);
  }
  const unknownExclusion = excludes.find((id) => !modules.has(id));
  if (unknownExclusion) return fail('UNKNOWN_MODULE', `profile excludes unknown module '${unknownExclusion}'`);
  const selectedDefinition = profileSkillIds(profile);
  const selectedCommandDefinition = profileCommandIds(profile);
  if (selectedCommandDefinition && new Set(selectedCommandDefinition).size !== selectedCommandDefinition.length) {
    return fail('DUPLICATE_COMMAND_ID', `profile '${profileId}' declares duplicate commands`);
  }
  if (selectedCommandDefinition && selectedCommandDefinition.some((id) => (
    typeof id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\.md)?$/.test(id)
  ))) {
    return fail('INVALID_COMMAND_ID', `profile '${profileId}' declares an unsafe command id`);
  }
  if (profileId === 'minimal') {
    const core = requiredCoreIds(input.inventory, profile);
    if (!selectedDefinition) {
      return fail('INVALID_PROFILE', 'minimal profile must declare required core stable IDs');
    }
    const policyIds = input.inventory && input.inventory.profile_policy
      && Array.isArray(input.inventory.profile_policy.required_core_ids)
      ? input.inventory.profile_policy.required_core_ids
      : null;
    if (policyIds) {
      if (!sameIdSet(core, policyIds) || !sameIdSet(selectedDefinition, policyIds)) {
        return fail('PROFILE_CORE_MISMATCH', 'minimal profile must list exactly the required_core_ids', selectedDefinition);
      }
    } else if (!sameIdSet(core, selectedDefinition)) {
      return fail('PROFILE_CORE_MISMATCH', 'minimal profile stable IDs must match inventory required core IDs', selectedDefinition);
    }
  }
  let baseIds;
  if (profileId === 'compat-v1') {
    // Keep the predecessor-compatible allowlist closed when the profile
    // declares one.  This matters when the current inventory has gained a
    // newer live skill that was not part of the predecessor bundle (for
    // example opsx-post-obs); compat-v1 must preserve its recorded 0.52.x
    // selection rather than silently broadening to every current entry.
    baseIds = selectedDefinition
      ? selectedDefinition.slice().sort()
      : entries.filter((entry) => entry.lifecycle !== 'deprecated' && entry.invokable !== false).map((entry) => entry.id).sort();
  } else if (selectedDefinition) {
    baseIds = selectedDefinition.slice();
  } else if (profileId === 'full') {
    baseIds = entries.filter((entry) => entry.lifecycle !== 'deprecated'
      && ((entry.lifecycle === 'promoted' || entry.tier === 'core') || entryMatchesModule(entry, new Set(moduleClosure)))).map((entry) => entry.id).sort();
  } else {
    baseIds = entries.filter((entry) => entry.lifecycle === 'promoted' || entry.tier === 'core').map((entry) => entry.id).sort();
  }
  const baseSet = new Set(baseIds);
  const overlay = normalizeOverlay(input);
  if (overlay && overlay.error) return { ok: false, error: overlay.error };
  const surfaceAllowed = surfaceIds(input.inventory, input.surface, entries);
  const checkId = (id, isOverlay) => {
    if (!id || typeof id !== 'string' || id.trim() === '') return error('MISSING_STABLE_ID', 'a selected stable ID is missing');
    if (retired.has(id)) return error('RETIRED_STABLE_ID', `stable ID '${id}' is retired`, [id], { retired: retired.get(id) });
    const entry = byId.get(id);
    if (!entry || entry.lifecycle === 'deprecated') return error('UNKNOWN_STABLE_ID', `unknown stable ID '${id}'`, [id]);
    if (entry.invokable === false) return error('NON_INVOKABLE_STABLE_ID', `stable ID '${id}' is internal runtime support and cannot be selected`, [id]);
    if (isOverlay && surfaceAllowed && !surfaceAllowed.has(id)) return error('SURFACE_INCOMPATIBLE', `stable ID '${id}' is not available on surface '${input.surface}'`, [id], { surface: input.surface });
    if (isOverlay && excludes.some((excluded) => (entry.profiles || []).includes(excluded) || entry.module === excluded)) {
      return error('CONFLICT_EXCLUDED', `stable ID '${id}' is excluded by profile '${profileId}'`, [id], { excludes });
    }
    return null;
  };
  for (const id of baseIds) {
    const issue = checkId(id, false);
    if (issue) return { ok: false, error: issue };
    if (excludes.some((excluded) => (byId.get(id).profiles || []).includes(excluded) || byId.get(id).module === excluded)) baseSet.delete(id);
  }
  for (const id of overlay) {
    const issue = checkId(id, true);
    if (issue) return { ok: false, error: issue };
    baseSet.add(id);
  }
  const selectedStableIds = [...baseSet];
  const profileDefinition = clone({ ...profile, modules: selectedModules, skillIds: selectedDefinition || null, excludes });
  const sourceFingerprint = input.sourceFingerprint || input.sourceInputs && fingerprint(clone(input.sourceInputs)) || fingerprint({ source: input.source || null });
  const inventoryFingerprint = input.inventoryFingerprint || fingerprint({ skills: entries, retired_skills: input.inventory && input.inventory.retired_skills || [] });
  const profileFingerprint = fingerprint(profileDefinition);
  const selectionMode = overlay.length > 0 ? 'explicit-overlay' : 'profile';
  const compatibilityMode = profileId === 'compat-v1' ? 'compat-v1' : profile.compatibilityMode || 'profile';
  const identity = {
    schema: SELECTION_POLICY_VERSION,
    profileId,
    selectedStableIds,
    selectedCommandIds: selectedCommandDefinition ? selectedCommandDefinition.slice().sort() : null,
    moduleClosure,
    compatibilityMode,
    selectionMode,
    selectionPolicyVersion: input.policyVersion || SELECTION_POLICY_VERSION,
    sourceFingerprint,
    profileFingerprint,
    inventoryFingerprint,
  };
  const selectionFingerprint = fingerprint(identity);
  const value = {
    ...identity,
    profileDefinition,
    selectedCommandIds: selectedCommandDefinition ? selectedCommandDefinition.slice().sort() : null,
    overlayStableIds: overlay.slice(),
    selectionFingerprint,
    // Alias retained for callers that use the shorter surface terminology.
    surfaceFingerprint: null,
  };
  return { ok: true, value: freeze(value) };
}

function validateProfileDefinitions({ inventory, profiles, moduleCatalog } = {}) {
  const errors = [];
  const table = profileTable(profiles);
  for (const id of PROFILE_IDS) {
    if (!Object.prototype.hasOwnProperty.call(table, id)) {
      errors.push(`missing capability profile '${id}'`);
      continue;
    }
    const declaredIds = profileSkillIds(table[id]);
    if (declaredIds) {
      const duplicate = declaredIds.find((stableId, index) => declaredIds.indexOf(stableId) !== index);
      if (duplicate) {
        errors.push(`${id}: duplicate stable ID '${duplicate}'`);
        continue;
      }
    }
    const result = resolveCapabilitySelection({ inventory, profiles, moduleCatalog, profileId: id });
    if (!result.ok) errors.push(`${id}: ${result.error.message}`);
    else if (id === 'full') {
      const protectedIds = (Array.isArray(inventory && inventory.external_skill_packages)
        ? inventory.external_skill_packages
        : [])
        .filter((entry) => entry && entry.policy === 'protect-existing')
        .flatMap((entry) => Array.isArray(entry.stable_ids) ? entry.stable_ids : []);
      for (const stableId of protectedIds) {
        if (!result.value.selectedStableIds.includes(stableId)) {
          errors.push(`full: protected external skill '${stableId}' must remain selected`);
        }
      }
      if (result.value.selectedStableIds.length >= (inventory.skills || []).filter((entry) => entry.lifecycle !== 'deprecated' && entry.invokable !== false).length) {
        errors.push('full must remain a conflict-aware subset of live invokable inventory');
      }
    }
    else if (id === 'minimal') {
      const required = inventory && inventory.profile_policy && Array.isArray(inventory.profile_policy.required_core_ids)
        ? inventory.profile_policy.required_core_ids
        : null;
      if (required && !sameIdSet(result.value.selectedStableIds, required)) {
        errors.push('minimal must list exactly the required_core_ids');
      }
    }
    else if (id === 'compat-v1') {
      const declared = profileSkillIds(table[id]);
      if (declared && !sameIdSet(result.value.selectedStableIds, declared)) {
        errors.push('compat-v1 selection must exactly match its declared predecessor-compatible stable IDs');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function bindSurfaceSelection({ selection, surface, supportedStableIds = null, emittedStableIds = null, transform = null } = {}) {
  if (!selection || typeof selection !== 'object' || typeof selection.selectionFingerprint !== 'string') return fail('INVALID_SELECTION', 'a normalized capability selection is required');
  const canonical = selection.selectedStableIds.slice();
  const supported = supportedStableIds === null ? null : new Set(supportedStableIds);
  const emitted = emittedStableIds === null
    ? (surface === 'codex-native' && supported ? canonical.filter((id) => supported.has(id)) : canonical.slice())
    : emittedStableIds.slice();
  const expected = surface === 'codex-native' && supported ? canonical.filter((id) => supported.has(id)) : canonical;
  if (JSON.stringify(emitted) !== JSON.stringify(expected)) {
    return fail('SELECTION_MEMBERSHIP_DRIFT', `surface '${surface}' emitted stable IDs do not match canonical selection`, [...new Set([...expected, ...emitted])], { surface, expected, emitted });
  }
  const surfaceSelectionFingerprint = fingerprint({
    selectionFingerprint: selection.selectionFingerprint,
    surface,
    emittedStableIds: emitted,
    transform: transform || { id: 'identity', version: '1' },
  });
  return { ok: true, value: freeze({
    ...selection,
    surface,
    emittedStableIds: emitted,
    surfaceSelectionFingerprint,
    surfaceFingerprint: surfaceSelectionFingerprint,
  }) };
}

function validateSurfaceSelection({ selection, surface, emittedStableIds, supportedStableIds = null, transform = null } = {}) {
  return bindSurfaceSelection({ selection, surface, emittedStableIds, supportedStableIds, transform });
}

function parseSelectionArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('selection arguments must be an array');
  let profileId = null;
  const skillIds = [];
  const standaloneSkillIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile' || arg === '--skill' || arg === '--standalone') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--profile') profileId = value;
      else if (arg === '--skill') skillIds.push(value);
      else if (!standaloneSkillIds.includes(value)) standaloneSkillIds.push(value);
    } else if (typeof arg === 'string' && arg.startsWith('--profile=')) {
      profileId = arg.slice('--profile='.length);
      if (!profileId) throw new Error('--profile requires a value');
    } else if (typeof arg === 'string' && arg.startsWith('--skill=')) {
      const value = arg.slice('--skill='.length);
      if (!value) throw new Error('--skill requires a value');
      skillIds.push(value);
    } else if (typeof arg === 'string' && arg.startsWith('--standalone=')) {
      const value = arg.slice('--standalone='.length);
      if (!value) throw new Error('--standalone requires a value');
      if (!standaloneSkillIds.includes(value)) standaloneSkillIds.push(value);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown selection option '${arg}'`);
    } else {
      throw new Error(`unexpected selection argument '${arg}'`);
    }
  }
  if (standaloneSkillIds.length > 0 && (profileId || skillIds.length > 0)) {
    throw new Error('--standalone cannot be combined with --profile or --skill');
  }
  return {
    profileId: profileId || null,
    skillIds,
    ...(standaloneSkillIds.length > 0 ? { standaloneSkillIds } : {}),
  };
}

function resolveReceiptSelection({ receipt, ...input } = {}) {
  const existing = receipt && typeof receipt === 'object' ? receipt : {};
  const standalone = existing.selectionMode === 'standalone' || existing.profileId === 'standalone';
  if (standalone) {
    const requested = Array.isArray(existing.requestedStableIds) && existing.requestedStableIds.length > 0
      ? existing.requestedStableIds
      : existing.selectedStableIds;
    if (!Array.isArray(requested) || requested.length === 0) return fail('MISSING_STANDALONE_SELECTION', 'standalone receipt is missing requested stable IDs');
    const result = resolveCapabilitySelection({ ...input, profileId: null, skillIds: undefined, standaloneSkillIds: requested });
    if (!result.ok) return result;
    return { ok: true, value: freeze({
      ...result.value,
      migration: existing.migration || null,
      preservedStandalone: true,
      preservedCompatibility: false,
    }) };
  }
  const explicit = typeof existing.profileId === 'string' && existing.profileId !== '';
  const profileId = explicit ? existing.profileId : 'compat-v1';
  const result = resolveCapabilitySelection({ ...input, profileId, skillIds: explicit ? undefined : undefined });
  if (!result.ok) return result;
  return { ok: true, value: freeze({
    ...result.value,
    migration: existing.migration || null,
    preservedCompatibility: !explicit,
  }) };
}

function planProfileMigration({ receipt, targetProfileId, targetStandaloneSkillIds, ...input } = {}) {
  const standaloneTarget = targetStandaloneSkillIds !== undefined && targetStandaloneSkillIds !== null;
  if (standaloneTarget && targetProfileId) return fail('MIXED_SELECTION_MODES', 'migration target cannot combine a profile and standalone selection');
  if (!standaloneTarget && (typeof targetProfileId !== 'string' || targetProfileId.trim() === '')) return fail('MIGRATION_PROFILE_REQUIRED', 'target profile is required');
  const oldSelection = resolveReceiptSelection({ receipt, ...input });
  if (!oldSelection.ok) return oldSelection;
  const next = resolveCapabilitySelection({
    ...input,
    profileId: standaloneTarget ? null : targetProfileId,
    standaloneSkillIds: standaloneTarget ? targetStandaloneSkillIds : undefined,
  });
  if (!next.ok) return next;
  return { ok: true, value: freeze({
    oldSelection: oldSelection.value,
    newSelection: next.value,
    migration: {
      from: oldSelection.value.selectionFingerprint,
      to: next.value.selectionFingerprint,
      fromProfileId: oldSelection.value.profileId,
      toProfileId: next.value.profileId,
      fromSelectionMode: oldSelection.value.selectionMode,
      toSelectionMode: next.value.selectionMode,
    },
  }) };
}

function evaluateActivation({ requiredRuntimeSurfaces = [], evidence = [] } = {}) {
  const rows = Array.isArray(evidence) ? evidence : Object.entries(evidence || {}).map(([surface, value]) => ({ surface, ...value }));
  const bySurface = new Map(rows.map((row) => [row && row.surface, row && row.verdict]));
  const nonPassSurfaces = [...new Set(requiredRuntimeSurfaces.filter((surface) => bySurface.get(surface) !== 'PASS'))].sort();
  const unexpected = rows.filter((row) => row && row.verdict && !['PASS', ...NON_PASS_VERDICTS].includes(row.verdict));
  return freeze({
    ok: nonPassSurfaces.length === 0 && unexpected.length === 0,
    requiredRuntimeSurfaces: requiredRuntimeSurfaces.slice(),
    nonPassSurfaces,
    evidence: rows.map((row) => ({ ...row })),
    diagnostics: unexpected.map((row) => `unsupported evidence verdict '${row.verdict}' for '${row.surface}'`),
  });
}

module.exports = {
  SELECTION_POLICY_VERSION,
  PROFILE_IDS,
  NON_PASS_VERDICTS,
  canonicalize,
  fingerprint,
  profileCommandIds,
  resolveModuleClosure,
  resolveCapabilitySelection,
  validateProfileDefinitions,
  bindSurfaceSelection,
  validateSurfaceSelection,
  parseSelectionArgs,
  resolveReceiptSelection,
  planProfileMigration,
  evaluateActivation,
};
