'use strict';

// Single source of truth for full-release consumer surface identity. Inventory
// validation and the public result aggregator both consume this immutable list.

const REQUIRED_SURFACES = Object.freeze([
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
]);

const REQUIRED_RUNTIME_SURFACES = Object.freeze([
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
]);

module.exports = { REQUIRED_SURFACES, REQUIRED_RUNTIME_SURFACES };
