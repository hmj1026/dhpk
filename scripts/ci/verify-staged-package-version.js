#!/usr/bin/env node
'use strict';

// Staged-package-metadata parity (task 2.1 / 3.3): materializes the physical
// Codex native package candidate into a throwaway temp dir at a target
// version and asserts its manifest carries that exact version. Complements
// scripts/lib/release-parity.js, which covers the repo-tree manifests only —
// the staged package is a build output, not a checked-in file.
//
// Usage: node scripts/ci/verify-staged-package-version.js --version X.Y.Z

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SEMVER_PATTERN } = require('../lib/release-parity');
const { materializeNativePackage } = require('../lib/codex-native-package');

const ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--version') args.version = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.version || !SEMVER_PATTERN.test(args.version)) {
  console.error(`verify-staged-package-version: version '${args.version}' is not valid semver (X.Y.Z)`);
  process.exit(2);
}

const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-staged-package-version-'));

try {
  materializeNativePackage({ inventory, root: ROOT, outDir, name: 'dhpk', version: args.version });
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, '.codex-plugin', 'plugin.json'), 'utf8'));
  if (manifest.version !== args.version) {
    console.error(`verify-staged-package-version: staged package manifest version '${manifest.version}' does not match target '${args.version}'`);
    process.exit(1);
  }
  console.log(`verify-staged-package-version: PASS (staged package manifest version ${manifest.version})`);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
