'use strict';

// Native installers select skills into the Shared Project Projection and bind
// one Host at a time. This module is the Node seam those installers call; it
// does not own native agents, rules, or commands.

const fs = require('node:fs');
const path = require('node:path');
const { compileProjectAgentProjection } = require('./project-agent-projection-plan');
const {
  materializeRelocatableAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
} = require('./project-agent-projection-publisher');
const { classifyHostBinding } = require('./cursor-consumer-evidence');
const { boundStableIds, uniqueSorted } = require('./project-agent-host-binding-policy');

const NATIVE_SHARED_SKILL_HOSTS = Object.freeze(['codex', 'cursor']);

function readInventory(sourceRoot) {
  const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(`distribution inventory not found: ${inventoryPath}`);
  }
  return JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
}

function uniqueIds(values) {
  if (!Array.isArray(values) || values.length === 0
    || values.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new Error('selectedStableIds must be a unique non-empty string array');
  }
  const selected = [...new Set(values.map((id) => id.trim()))];
  if (selected.length !== values.length) {
    throw new Error('selectedStableIds must be a unique non-empty string array');
  }
  return selected;
}

function readPreviousReceipt(projectRoot) {
  const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
  try {
    const stat = fs.lstatSync(receiptPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    return receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : null;
  } catch {
    return null;
  }
}

function installNativeSharedSkills({
  sourceRoot,
  projectRoot,
  inventory,
  host = 'cursor',
  selectedStableIds,
  declaredSelection = true,
  update = false,
  consumerEvidence = null,
  consumerEvidencePath = null,
  env = process.env,
} = {}) {
  if (!sourceRoot || !projectRoot) throw new Error('sourceRoot and projectRoot are required');
  if (!NATIVE_SHARED_SKILL_HOSTS.includes(host)) {
    throw new Error(`unsupported native shared-skill Host: ${host}`);
  }
  const thisIds = uniqueIds(selectedStableIds);
  const previous = readPreviousReceipt(projectRoot);
  const preserveHostBindings = {};
  const preserveBindingPaths = {};
  const otherIds = [];
  const previousBindings = previous && previous.hostBindings && typeof previous.hostBindings === 'object'
    && !Array.isArray(previous.hostBindings)
    ? previous.hostBindings
    : {};
  for (const other of Object.keys(previousBindings)) {
    if (other === host) continue;
    preserveHostBindings[other] = previousBindings[other];
    otherIds.push(...boundStableIds(previousBindings[other]));
    if (previous.bindingPaths && Array.isArray(previous.bindingPaths[other])) {
      preserveBindingPaths[other] = previous.bindingPaths[other];
    }
  }
  const unionIds = uniqueSorted([...thisIds, ...otherIds]);
  const requestedHosts = uniqueSorted([host, ...Object.keys(preserveHostBindings)]);
  const hostSelections = { [host]: thisIds };
  for (const other of Object.keys(preserveHostBindings)) {
    hostSelections[other] = boundStableIds(preserveHostBindings[other]);
  }
  const classified = classifyHostBinding(host, {
    consumerEvidence,
    consumerEvidencePath,
    env,
  });
  const cursorBinding = host === 'cursor' ? classified : null;
  const codexBinding = host === 'codex' ? classified : null;
  return materializeRelocatableAgentsSkillsProjection({
    sourceRoot,
    projectRoot,
    inventory: inventory || readInventory(sourceRoot),
    profileId: 'portable-core',
    requestedHosts,
    selectedStableIds: unionIds,
    declaredSelection,
    allowCanonicalChanges: update,
    cursorBinding,
    codexBinding,
    hostSelections,
    preserveHostBindings,
    preserveBindingPaths,
  });
}

function throwIfUninstallFailed(result) {
  if (result && result.ok === false) {
    const detail = result.error && result.error.message
      ? result.error.message
      : 'shared projection uninstall failed';
    throw new Error(detail);
  }
  return result;
}

function pruneRetiredHostBinding(binding, retiredIds, retiredNames) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { binding, retiredPaths: new Set() };
  }
  const next = { ...binding };
  for (const field of ['selectedStableIds', 'emittedStableIds']) {
    if (Array.isArray(binding[field])) {
      next[field] = binding[field].filter((id) => !retiredIds.has(id));
    }
  }
  const retiredPaths = new Set();
  const destinationRoot = binding.discovery && binding.discovery.destinationRoot;
  if (typeof destinationRoot === 'string') {
    for (const name of retiredNames) {
      retiredPaths.add(`${destinationRoot}/${name}`);
      retiredPaths.add(`${destinationRoot}/${name}.md`);
    }
  }
  if (Array.isArray(binding.bindings)) {
    for (const entry of binding.bindings) {
      if (entry && retiredIds.has(entry.stableId) && typeof entry.path === 'string') {
        retiredPaths.add(entry.path);
      }
    }
    next.bindings = binding.bindings.filter((entry) => !entry || !retiredIds.has(entry.stableId));
  }
  if (binding.discovery && typeof binding.discovery === 'object' && !Array.isArray(binding.discovery)) {
    next.discovery = { ...binding.discovery };
    if (Array.isArray(binding.discovery.paths)) {
      next.discovery.paths = binding.discovery.paths.filter((entryPath) => !retiredPaths.has(entryPath));
    }
  }
  return { binding: next, retiredPaths };
}

function compileRetirementGuard(inventory, profileId, requestedHosts) {
  const result = compileProjectAgentProjection({
    inventory,
    profileId,
    requestedHosts,
    declaredSelection: true,
  });
  if (result.ok) return;
  const error = new Error(result.error.message);
  error.projectionCode = result.error.code;
  error.projectionDetails = result.error.details || {};
  throw error;
}

function uninstallNativeSharedSkills({
  sourceRoot,
  projectRoot,
  inventory,
  host = 'cursor',
} = {}) {
  if (!sourceRoot || !projectRoot) throw new Error('sourceRoot and projectRoot are required');
  if (!NATIVE_SHARED_SKILL_HOSTS.includes(host)) {
    throw new Error(`unsupported native shared-skill Host: ${host}`);
  }
  const previous = readPreviousReceipt(projectRoot);
  if (!previous) {
    return { ok: true, state: 'ABSENT', removedPaths: [], preservedPaths: [], projectRoot };
  }
  const previousBindings = previous.hostBindings && typeof previous.hostBindings === 'object'
    && !Array.isArray(previous.hostBindings)
    ? previous.hostBindings
    : {};
  const remainingHosts = uniqueSorted(Object.keys(previousBindings).filter((other) => other !== host));
  const resolvedInventory = inventory || readInventory(sourceRoot);
  if (remainingHosts.length === 0) {
    return throwIfUninstallFailed(uninstallAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: resolvedInventory,
    }));
  }
  const profileId = previous.profileId || 'portable-core';
  compileRetirementGuard(resolvedInventory, profileId, remainingHosts);
  const currentIds = new Set([
    ...(Array.isArray(resolvedInventory.skills) ? resolvedInventory.skills : []),
    ...(Array.isArray(resolvedInventory.modules) ? resolvedInventory.modules : []),
  ].map((entry) => entry && entry.id).filter((id) => typeof id === 'string'));
  const originalEntries = Array.isArray(previous.entries) ? previous.entries : [];
  const originalIds = [
    ...(Array.isArray(previous.selectedIds) ? previous.selectedIds : []),
    ...(Array.isArray(previous.emittedIds) ? previous.emittedIds : []),
    ...originalEntries.map((entry) => entry && entry.stableId),
    ...Object.values(previousBindings).flatMap((binding) => [
      ...(binding && Array.isArray(binding.selectedStableIds) ? binding.selectedStableIds : []),
      ...(binding && Array.isArray(binding.emittedStableIds) ? binding.emittedStableIds : []),
      ...(binding && Array.isArray(binding.bindings) ? binding.bindings.map((entry) => entry && entry.stableId) : []),
    ]),
  ];
  const retiredIds = new Set(originalIds.filter((id) => typeof id === 'string' && !currentIds.has(id)));
  const retiredEntries = originalEntries.filter((entry) => entry && retiredIds.has(entry.stableId));
  const retiredNames = retiredEntries.map((entry) => entry.name)
    .filter((name) => typeof name === 'string');
  const preserveHostBindings = {};
  const preserveBindingPaths = {};
  const remainingIds = [];
  const hostSelections = {};
  for (const other of remainingHosts) {
    const pruned = pruneRetiredHostBinding(previousBindings[other], retiredIds, retiredNames);
    preserveHostBindings[other] = pruned.binding;
    const ids = boundStableIds(preserveHostBindings[other]);
    remainingIds.push(...ids);
    hostSelections[other] = ids;
    if (previous.bindingPaths && Array.isArray(previous.bindingPaths[other])) {
      preserveBindingPaths[other] = previous.bindingPaths[other]
        .filter((entry) => !entry || !pruned.retiredPaths.has(entry.path));
    }
  }
  const unionIds = uniqueSorted(remainingIds);
  if (unionIds.length === 0) {
    return throwIfUninstallFailed(uninstallAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: resolvedInventory,
    }));
  }
  const published = materializeRelocatableAgentsSkillsProjection({
    sourceRoot,
    projectRoot,
    inventory: resolvedInventory,
    profileId,
    requestedHosts: remainingHosts,
    selectedStableIds: unionIds,
    declaredSelection: true,
    allowCanonicalChanges: true,
    hostSelections,
    preserveHostBindings,
    preserveBindingPaths,
  });
  return { ok: true, ...published };
}

module.exports = {
  NATIVE_SHARED_SKILL_HOSTS,
  installNativeSharedSkills,
  uninstallNativeSharedSkills,
};
