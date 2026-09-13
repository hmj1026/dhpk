'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PATH_CONTRACT_SCHEMA = 'dhpk.agy-install-path.v1';
const DEFAULT_PATH_CONTRACT = Object.freeze({
  schema: PATH_CONTRACT_SCHEMA,
  plugin_name: 'dhpk',
  canonical_relative: '.gemini/antigravity-cli/plugins/dhpk',
  legacy_relatives: Object.freeze(['.gemini/config/plugins/dhpk']),
  sandbox_home: '/home/agy',
});

function isSafeRelative(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && value.split(/[\\/]+/).every((part) => part && part !== '.' && part !== '..');
}

function validateAgyPathContract(input) {
  const contract = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const errors = [];
  if (!contract) return { ok: false, errors: ['AGY path contract must be an object'] };
  if (contract.schema !== PATH_CONTRACT_SCHEMA) errors.push(`AGY path contract schema must be ${PATH_CONTRACT_SCHEMA}`);
  if (contract.plugin_name !== 'dhpk') errors.push("AGY path contract plugin_name must be 'dhpk'");
  if (!isSafeRelative(contract.canonical_relative)) errors.push('AGY path contract canonical_relative must be a safe relative path');
  if (!Array.isArray(contract.legacy_relatives) || contract.legacy_relatives.length === 0) {
    errors.push('AGY path contract legacy_relatives must be a non-empty array');
  } else {
    const seen = new Set();
    for (const relative of contract.legacy_relatives) {
      if (!isSafeRelative(relative)) errors.push(`AGY path contract legacy path is unsafe: ${relative}`);
      if (seen.has(relative)) errors.push(`AGY path contract legacy path is duplicated: ${relative}`);
      seen.add(relative);
      if (relative === contract.canonical_relative) errors.push('AGY path contract canonical path must not be listed as legacy');
    }
  }
  if (contract.sandbox_home !== '/home/agy') {
    errors.push("AGY path contract sandbox_home must be '/home/agy'");
  }
  return { ok: errors.length === 0, errors };
}

function cloneContract(contract) {
  return {
    schema: contract.schema,
    plugin_name: contract.plugin_name,
    canonical_relative: contract.canonical_relative,
    legacy_relatives: [...contract.legacy_relatives],
    sandbox_home: contract.sandbox_home,
  };
}

function loadAgyPathContract(root = ROOT) {
  const manifestPath = path.join(root, 'manifests', 'distribution-inventory.json');
  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot load AGY path contract: ${error.message}`);
  }
  const contract = inventory && inventory.agy_plugin && inventory.agy_plugin.install_paths;
  const checked = validateAgyPathContract(contract);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return cloneContract(contract);
}

function resolveAgyInstallPaths(homeDirectory, contract = DEFAULT_PATH_CONTRACT) {
  if (typeof homeDirectory !== 'string' || homeDirectory.length === 0 || !path.isAbsolute(homeDirectory)) {
    throw new Error('homeDirectory must be an absolute path');
  }
  const checked = validateAgyPathContract(contract);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return {
    canonical: path.join(homeDirectory, contract.canonical_relative),
    legacy: contract.legacy_relatives.map((relative) => path.join(homeDirectory, relative)),
    contract: cloneContract(contract),
  };
}

function resolveAgyConsumerPath(contract = DEFAULT_PATH_CONTRACT) {
  const checked = validateAgyPathContract(contract);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return path.join(contract.sandbox_home, contract.canonical_relative);
}

module.exports = {
  PATH_CONTRACT_SCHEMA,
  DEFAULT_PATH_CONTRACT,
  validateAgyPathContract,
  loadAgyPathContract,
  resolveAgyInstallPaths,
  resolveAgyConsumerPath,
};
