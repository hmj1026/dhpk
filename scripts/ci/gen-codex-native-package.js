#!/usr/bin/env node
'use strict';

// Build a physical, promoted-only Codex native release candidate into a
// caller-supplied output directory (task 3.2). Not wired into any committed
// output — this is a build-time/test-time generator; see
// docs/distribution-surfaces.md and design.md's Open Questions for the
// still-undecided release location/retention policy.
//   node scripts/ci/gen-codex-native-package.js <outDir> [--version=X.Y.Z]

const fs = require('fs');
const path = require('path');
const { materializeNativePackage, validateNativeCandidate } = require('../lib/codex-native-package');

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

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
const resolvedOutDir = path.resolve(outDir);
fs.mkdirSync(resolvedOutDir, { recursive: true });

const result = materializeNativePackage({ inventory, root: ROOT, outDir: resolvedOutDir, name: 'dhpk', version });
const validation = validateNativeCandidate({ manifestSkillsField: result.manifestSkillsField, packageRoot: resolvedOutDir });

if (!validation.ok) {
  for (const e of validation.errors) console.error(`ERROR [gen-codex-native-package]: ${e}`);
  console.error('FAIL [gen-codex-native-package]: generated candidate failed its own physical/parent-relative validation.');
  process.exit(1);
}

console.log(`PASS [gen-codex-native-package]: wrote ${result.skillIds.length} promoted skills to ${resolvedOutDir} (version ${version}).`);
