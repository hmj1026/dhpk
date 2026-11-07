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
  abortHeldProjection,
  heldProjection,
  recoverAgentsSkillsProjection,
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

function receiptMissing(projectRoot) {
  try {
    fs.lstatSync(path.join(projectRoot, '.agents', '.dhpk-installed.json'));
    return false;
  } catch (error) {
    return Boolean(error && error.code === 'ENOENT');
  }
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

function qualifySkillIds(ids, inventory) {
  const skillIds = new Set((inventory.skills || []).map((entry) => entry.id));
  const moduleIds = new Set((inventory.modules || []).map((entry) => entry.id));
  return uniqueSorted(ids).map((id) => skillIds.has(id) && moduleIds.has(id) ? `skill:${id}` : id);
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
  hold = null,
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
  const resolvedInventory = inventory || readInventory(sourceRoot);
  const currentIds = new Set([
    ...(Array.isArray(resolvedInventory.skills) ? resolvedInventory.skills : []),
    ...(Array.isArray(resolvedInventory.modules) ? resolvedInventory.modules : []),
  ].map((entry) => entry && entry.id).filter((id) => typeof id === 'string'));
  const originalEntries = previous && Array.isArray(previous.entries) ? previous.entries : [];
  const originalIds = [
    ...(previous && Array.isArray(previous.selectedIds) ? previous.selectedIds : []),
    ...(previous && Array.isArray(previous.emittedIds) ? previous.emittedIds : []),
    ...originalEntries.map((entry) => entry && entry.stableId),
    ...Object.values(previousBindings).flatMap((binding) => [
      ...(binding && Array.isArray(binding.selectedStableIds) ? binding.selectedStableIds : []),
      ...(binding && Array.isArray(binding.emittedStableIds) ? binding.emittedStableIds : []),
      ...(binding && Array.isArray(binding.bindings) ? binding.bindings.map((entry) => entry && entry.stableId) : []),
    ]),
  ];
  const retiredIds = new Set(originalIds.filter((id) => typeof id === 'string' && !currentIds.has(id)));
  const retiredNames = originalEntries.filter((entry) => entry && retiredIds.has(entry.stableId))
    .map((entry) => entry.name).filter((name) => typeof name === 'string');
  for (const other of Object.keys(previousBindings)) {
    if (other === host) continue;
    const pruned = pruneRetiredHostBinding(previousBindings[other], retiredIds, retiredNames);
    preserveHostBindings[other] = pruned.binding;
    otherIds.push(...boundStableIds(pruned.binding));
    if (previous.bindingPaths && Array.isArray(previous.bindingPaths[other])) {
      preserveBindingPaths[other] = previous.bindingPaths[other]
        .filter((entry) => !entry || !pruned.retiredPaths.has(entry.path));
    }
  }
  const unionIds = qualifySkillIds([...thisIds, ...otherIds], resolvedInventory);
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
    inventory: resolvedInventory,
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
    hold,
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
  hold = null,
} = {}) {
  if (!sourceRoot || !projectRoot) throw new Error('sourceRoot and projectRoot are required');
  if (!NATIVE_SHARED_SKILL_HOSTS.includes(host)) {
    throw new Error(`unsupported native shared-skill Host: ${host}`);
  }
  const previous = readPreviousReceipt(projectRoot);
  if (!previous) {
    if (receiptMissing(projectRoot)) {
      return { ok: true, state: 'ABSENT', held: false, removedPaths: [], preservedPaths: [], projectRoot };
    }
    // A present receipt that this lenient reader cannot use is not absence.
    // The strict projection uninstaller reports INVALID_RECEIPT and keeps files.
    return uninstallAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: inventory || readInventory(sourceRoot),
      hold,
    });
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
      hold,
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
  const unionIds = qualifySkillIds(remainingIds, resolvedInventory);
  if (unionIds.length === 0) {
    return throwIfUninstallFailed(uninstallAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: resolvedInventory,
      hold,
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
    hold,
  });
  return { ok: true, ...published };
}

// Explicit recovery (ADR-0033): a held publication belongs to its installer
// while that installer's journal is active; once the journal is gone or
// terminal, the publication never reached its commit point and is aborted.
function installerJournalActive(projectRoot, hold) {
  const journalPath = path.join(projectRoot, `.${hold.host}`, `.dhpk-transaction-${hold.transactionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase === 'active';
  } catch (error) {
    // An unreadable journal is not proof that the installer is done.
    return !(error && error.code === 'ENOENT');
  }
}

function recoverSharedProjection({ projectRoot } = {}) {
  if (!projectRoot) throw new Error('projectRoot is required');
  try {
    const held = heldProjection({ projectRoot });
    if (held && held.phase !== 'published') {
      if (installerJournalActive(projectRoot, held)) {
        return {
          ok: false,
          state: 'BLOCKED',
          code: 'INSTALLER_ACTIVE',
          message: `project projection transaction ${held.transactionId} belongs to the ${held.host} installer, whose journal is still active; rerun that installer to finish or undo it`,
        };
      }
      const aborted = abortHeldProjection({ projectRoot, transactionId: held.transactionId });
      return aborted.ok ? aborted : { ...aborted, message: aborted.error && aborted.error.message };
    }
    const recovered = recoverAgentsSkillsProjection({ projectRoot });
    return { ok: true, state: recovered.recovered ? 'RECOVERED' : 'ABSENT' };
  } catch (error) {
    const code = error.projectionCode || 'RECOVERY_FAILED';
    return { ok: false, state: 'BLOCKED', code, message: error.message };
  }
}

module.exports = {
  recoverSharedProjection,
  NATIVE_SHARED_SKILL_HOSTS,
  installNativeSharedSkills,
  uninstallNativeSharedSkills,
};
