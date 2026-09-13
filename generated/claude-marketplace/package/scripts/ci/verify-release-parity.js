#!/usr/bin/env node
'use strict';

// Release-only parity gate: verifies every version-bearing manifest and the
// CHANGELOG.md heading match the tagged version. Unlike
// scripts/release/prepare-release.js, this does NOT enforce a branch — it
// runs against the tag commit in .github/workflows/release.yml (detached
// HEAD on main), not on develop.
//
// Usage: node scripts/ci/verify-release-parity.js --version X.Y.Z

const path = require('path');
const { checkParity } = require('../lib/release-parity');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg === '--repo-root') args.root = argv[++i];
    else {
      console.error(`verify-release-parity: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.version) {
    console.error('usage: verify-release-parity.js --version X.Y.Z [--repo-root <path>]');
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = checkParity(args.root, args.version);
if (!result.ok) {
  console.error('verify-release-parity: FAIL');
  for (const err of result.errors) console.error(`  - ${err}`);
  process.exit(1);
}
console.log(`verify-release-parity: PASS (${args.version})`);
