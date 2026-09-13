#!/usr/bin/env node
'use strict';

// PACKAGE-gate version parity (task 3.2): validates the version recorded in
// the TRACKED codex-native publication artifact at plugins/dhpk/ — the exact
// artifact a consumer installs — rather than a disposable temp candidate
// materialized fresh at whatever version is passed on the command line
// (which would trivially "pass" regardless of what the tracked tree actually
// contains). Name kept for minimal call-site churn (scripts/release/package-gate.js);
// behavior now targets the tracked artifact, not a staged/materialized one.
// Complements scripts/lib/release-parity.js, which covers the repo-tree
// manifests only.
//
// Usage: node scripts/ci/verify-staged-package-version.js --version X.Y.Z [--repo-root <path>]

const fs = require('fs');
const path = require('path');
const { SEMVER_PATTERN } = require('../lib/release-parity');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--repo-root') args.root = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.version || !SEMVER_PATTERN.test(args.version)) {
  console.error(`verify-staged-package-version: version '${args.version}' is not valid semver (X.Y.Z)`);
  process.exit(2);
}

const pkgDir = path.join(args.root, 'plugins', 'dhpk');
const manifestPath = path.join(pkgDir, '.codex-plugin', 'plugin.json');
const provenancePath = path.join(pkgDir, 'provenance.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`verify-staged-package-version: tracked manifest not found at ${manifestPath}`);
  process.exit(1);
}
if (!fs.existsSync(provenancePath)) {
  console.error(`verify-staged-package-version: tracked provenance.json not found at ${provenancePath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));

const errors = [];
if (manifest.version !== args.version) {
  errors.push(`tracked manifest version '${manifest.version}' does not match target '${args.version}'`);
}
if (provenance.sourceVersion !== args.version) {
  errors.push(`tracked provenance sourceVersion '${provenance.sourceVersion}' does not match target '${args.version}'`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`verify-staged-package-version: ${e}`);
  process.exit(1);
}
console.log(`verify-staged-package-version: PASS (tracked package version ${manifest.version})`);
