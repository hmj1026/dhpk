#!/usr/bin/env node
'use strict';

// Build the physical, explicitly-allowlisted (codex-native surface) Codex
// native package into a caller-supplied output directory. Used both to
// (re)generate the tracked publication artifact at plugins/dhpk/ during a
// release, and to materialize disposable candidates in tests/smoke checks —
// see docs/distribution-surfaces.md and openspec/changes/
// make-codex-plugin-distribution-install-safe.
//   node scripts/ci/gen-codex-native-package.js <outDir> [--version=X.Y.Z]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  compileNativePackage,
  materializeNativePackage,
  validateNativeCandidate,
  validateNativeMembership,
} = require('../lib/codex-native-package');

const ROOT = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT, 'manifests', 'distribution-inventory.json');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
if (!outDir) {
  console.error('usage: node scripts/ci/gen-codex-native-package.js <outDir> [--version=X.Y.Z]');
  process.exit(2);
}
const versionArg = args.find((a) => a.startsWith('--version='));
const version = versionArg ? versionArg.split('=')[1] : JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function resolveSourceCommit() {
  const res = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : 'unknown';
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
const resolvedOutDir = path.resolve(outDir);

const sourceCommit = resolveSourceCommit();
const compiledProjection = compileNativePackage({
  inventory,
  root: ROOT,
  outDir: resolvedOutDir,
  name: 'dhpk',
  version,
  sourceCommit,
});
const result = materializeNativePackage({
  inventory,
  root: ROOT,
  outDir: resolvedOutDir,
  name: 'dhpk',
  version,
  sourceCommit,
  compiledProjection,
});
const structural = validateNativeCandidate({ manifestSkillsField: result.manifestSkillsField, packageRoot: resolvedOutDir });
const membership = validateNativeMembership({ candidateSkillNames: result.skillNames, inventory });

const errors = [...structural.errors, ...membership.errors];
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR [gen-codex-native-package]: ${e}`);
  console.error('FAIL [gen-codex-native-package]: generated candidate failed its own physical/parent-relative/membership validation.');
  process.exit(1);
}

console.log(`PASS [gen-codex-native-package]: wrote ${result.skillIds.length} codex-native skills to ${resolvedOutDir} (version ${version}).`);
