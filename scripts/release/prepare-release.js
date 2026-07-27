#!/usr/bin/env node
'use strict';

// One release preparation command: SemVer-validates a target version, checks
// (or deterministically writes) parity across every version-bearing manifest
// and the CHANGELOG.md release heading, and promotes changelog.d/ fragments.
// Preserves git-flow authority (RELEASE.md): preparation runs on `develop`
// only and never merges, tags, or pushes — release-runner.sh still owns the
// commit/PR/tag mechanics once these files are correct.
//
// Usage:
//   node scripts/release/prepare-release.js check --version X.Y.Z
//   node scripts/release/prepare-release.js write --version X.Y.Z --date YYYY-MM-DD [--summary "..."]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SEMVER_PATTERN, MANIFEST_PATHS, checkParity } = require('../lib/release-parity');
const { readFragments, validateFragments, promote } = require('../lib/changelog-fragments');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const REQUIRED_BRANCH = 'develop';

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'check' || arg === 'write') args.mode = arg;
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--summary') args.summary = argv[++i];
    // Test-only override; production always prepares the plugin's own repo.
    else if (arg === '--repo-root') args.root = argv[++i];
    else {
      console.error(`prepare-release: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.mode) {
    console.error('usage: prepare-release.js <check|write> --version X.Y.Z [--date YYYY-MM-DD] [--summary "..."] [--repo-root <path>]');
    process.exit(2);
  }
  return args;
}

function currentBranch(root) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function writeManifestVersion(root, relPath, version) {
  const abs = path.join(root, relPath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (relPath.endsWith('marketplace.json')) {
    const entry = (data.plugins || []).find((p) => p.name === 'dhpk');
    if (!entry) throw new Error(`${relPath}: no 'dhpk' plugin entry`);
    entry.version = version;
  } else {
    data.version = version;
  }
  fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.version || !SEMVER_PATTERN.test(args.version)) {
    console.error(`prepare-release: version '${args.version}' is not valid semver (X.Y.Z)`);
    process.exit(2);
  }

  const branch = currentBranch(args.root);
  if (branch !== REQUIRED_BRANCH) {
    console.error(`prepare-release: must run on '${REQUIRED_BRANCH}' (current: '${branch}'); the develop -> main PR is the release candidate boundary`);
    process.exit(1);
  }

  if (args.mode === 'check') {
    const result = checkParity(args.root, args.version);
    if (!result.ok) {
      console.error('prepare-release: check FAIL');
      for (const err of result.errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(`prepare-release: check PASS (target ${args.version})`);
    return;
  }

  // write mode
  if (!args.date) {
    console.error('prepare-release: write requires --date YYYY-MM-DD');
    process.exit(2);
  }

  const fragmentDir = path.join(args.root, 'changelog.d');
  const changelogPath = path.join(args.root, 'CHANGELOG.md');
  const { fragments, markers } = readFragments(fragmentDir);
  const validation = validateFragments(fragments, markers);
  if (!validation.ok) {
    console.error('prepare-release: write FAIL (invalid fragments, nothing changed)');
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  const changed = [];
  promote({ fragmentDir, changelogPath, version: args.version, date: args.date, summary: args.summary });
  changed.push('CHANGELOG.md');

  for (const relPath of MANIFEST_PATHS) {
    writeManifestVersion(args.root, relPath, args.version);
    changed.push(relPath);
  }

  console.log(`prepare-release: write PASS (target ${args.version}); changed files:`);
  for (const f of changed) console.log(`  - ${f}`);
}

main();
