'use strict';

// Native installers select skills into the Shared Project Projection and bind
// one Host at a time. This module is the Node seam those installers call; it
// does not own native agents, rules, or commands.

const fs = require('node:fs');
const path = require('node:path');
const {
  materializeRelocatableAgentsSkillsProjection,
} = require('./project-agent-projection-publisher');

const NATIVE_SHARED_SKILL_HOSTS = Object.freeze(['cursor']);

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

function installNativeSharedSkills({
  sourceRoot,
  projectRoot,
  inventory,
  host = 'cursor',
  selectedStableIds,
  declaredSelection = true,
  update = false,
} = {}) {
  if (!sourceRoot || !projectRoot) throw new Error('sourceRoot and projectRoot are required');
  if (!NATIVE_SHARED_SKILL_HOSTS.includes(host)) {
    throw new Error(`unsupported native shared-skill Host: ${host}`);
  }
  return materializeRelocatableAgentsSkillsProjection({
    sourceRoot,
    projectRoot,
    inventory: inventory || readInventory(sourceRoot),
    profileId: 'portable-core',
    requestedHosts: [host],
    selectedStableIds: uniqueIds(selectedStableIds),
    declaredSelection,
    allowCanonicalChanges: update,
  });
}

module.exports = {
  NATIVE_SHARED_SKILL_HOSTS,
  installNativeSharedSkills,
};
