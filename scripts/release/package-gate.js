#!/usr/bin/env node
'use strict';

// PACKAGE release gate: validates the TRACKED codex-native publication
// artifact at plugins/dhpk/ (see scripts/lib/codex-native-package.js and
// openspec/changes/make-codex-plugin-distribution-install-safe) — layout,
// structural (no symlinks / no parent-relative escape), version parity, and
// deterministic-generation (no drift from a fresh inventory-controlled
// regeneration). Composes into one release-evidence stage.
//
// Claude's install source is the repository root itself (marketplace "local"
// source, no separate staging step) — its layout is already validated by the
// SOURCE-gate validators, so this gate does not re-stage a Claude package.
// Real-CLI install/cache-discovery proof for the exact tracked artifact is a
// CONSUMER-gate concern (scripts/release/consumer-gate.js), not this one —
// PACKAGE validates the artifact itself, CONSUMER proves it installs.
//
// Prints the stage as JSON on stdout; exit code mirrors the verdict.
//
// Usage: node scripts/release/package-gate.js --version X.Y.Z [--repo-root <path>]

const fs = require('fs');
const path = require('path');
const { runSteps } = require('../lib/gate-runner');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg === '--repo-root') args.root = argv[++i];
    // Test-only override; see source-gate.js for the same pattern.
    else if (arg === '--steps-file') args.stepsFile = argv[++i];
    else {
      console.error(`package-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  return args;
}

function defaultSteps(root, version) {
  return [
    { name: 'claude-package-layout', cmd: 'node', args: [path.join(root, 'scripts/ci/validate-plugin.js'), '--strict'] },
    { name: 'claude-distribution-layout', cmd: 'node', args: [path.join(root, 'scripts/ci/validate-distribution.js'), '--strict'] },
    { name: 'staged-package-version', cmd: 'node', args: [path.join(root, 'scripts/ci/verify-staged-package-version.js'), '--version', version] },
    { name: 'codex-native-deterministic-generation', cmd: 'node', args: [path.join(root, 'scripts/ci/verify-codex-native-package.js')] },
  ];
}

const args = parseArgs(process.argv.slice(2));
if (!args.stepsFile && !args.version) {
  console.error('usage: package-gate.js --version X.Y.Z [--repo-root <path>]');
  process.exit(2);
}

const steps = args.stepsFile
  ? JSON.parse(fs.readFileSync(args.stepsFile, 'utf8'))
  : defaultSteps(args.root, args.version);

const stage = runSteps(steps, { environment: process.env.CI ? 'ci' : 'local', cwd: args.root });
console.log(JSON.stringify(stage, null, 2));
process.exit(stage.verdict === 'PASS' ? 0 : 1);
