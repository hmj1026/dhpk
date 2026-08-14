#!/usr/bin/env node
'use strict';

// Generate the inventory-owned native AGY package.
//
//   node scripts/ci/gen-agy-plugin-package.js <outDir> [--version=X.Y.Z]

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  GENERATOR_VERSION,
  materializeAgyPluginPackage,
  validateAgyPluginPackage,
} = require('../lib/agy-plugin-package');

const ROOT = path.join(__dirname, '..', '..');
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const versionArg = process.argv.slice(2).find((arg) => arg.startsWith('--version='));

if (positional.length !== 1) {
  console.error('usage: node scripts/ci/gen-agy-plugin-package.js <outDir> [--version=X.Y.Z]');
  process.exit(2);
}

function sourceCommit() {
  const result = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const commit = result.status === 0 ? result.stdout.trim() : '';
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('unable to resolve a 40-character source commit');
  return commit;
}

const outDir = path.resolve(positional[0]);
const version = versionArg ? versionArg.slice('--version='.length) : sourceManifest.version;

try {
  const result = materializeAgyPluginPackage({
    root: ROOT,
    inventory,
    outDir,
    version,
    sourceVersion: sourceManifest.version,
    sourceCommit: sourceCommit(),
    generatorVersion: GENERATOR_VERSION,
  });
  const validation = validateAgyPluginPackage(outDir, { inventory, expectedVersion: version });
  for (const warning of validation.warnings) console.error(`WARN [gen-agy-plugin-package]: ${warning}`);
  for (const error of validation.errors) console.error(`ERROR [gen-agy-plugin-package]: ${error}`);
  if (!validation.ok) {
    console.error('FAIL [gen-agy-plugin-package]: generated package failed AGY validation.');
    process.exit(1);
  }
  console.log(`PASS [gen-agy-plugin-package]: wrote ${result.selected.agents.length} agents and ${result.selected.skills.length} skills to ${outDir} (version ${version}).`);
} catch (error) {
  console.error(`FAIL [gen-agy-plugin-package]: ${error.message}`);
  process.exit(1);
}
