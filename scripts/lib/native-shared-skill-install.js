'use strict';

// Native installers select skills into the Shared Project Projection and bind
// one Host at a time. This module is the Node seam those installers call; it
// does not own native agents, rules, or commands.

const fs = require('node:fs');
const path = require('node:path');
const {
  materializeRelocatableAgentsSkillsProjection,
} = require('./project-agent-projection-publisher');
const { classifyHostBinding } = require('./cursor-consumer-evidence');

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

function uniqueSorted(values) {
  return [...new Set(values.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))].sort();
}

function boundStableIds(hostBinding) {
  if (!hostBinding || typeof hostBinding !== 'object' || Array.isArray(hostBinding)) return [];
  if (Array.isArray(hostBinding.bindings)) {
    const fromBindings = uniqueSorted(hostBinding.bindings.map((entry) => entry && entry.stableId));
    if (fromBindings.length > 0) return fromBindings;
  }
  return uniqueSorted([
    ...(Array.isArray(hostBinding.selectedStableIds) ? hostBinding.selectedStableIds : []),
    ...(Array.isArray(hostBinding.emittedStableIds) ? hostBinding.emittedStableIds : []),
  ]);
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

module.exports = {
  NATIVE_SHARED_SKILL_HOSTS,
  installNativeSharedSkills,
};
