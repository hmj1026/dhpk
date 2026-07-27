#!/usr/bin/env node
'use strict';

// PACKAGE release gate: composes staged package layout/metadata validation
// and local-install smoke tests into one release-evidence stage.
//
// Claude's install source is the repository root itself (marketplace "local"
// source, no separate staging step) — its layout is already validated by the
// SOURCE-gate validators, so this gate does not re-stage a Claude package.
// The Codex native package IS a separate staged build output (see
// scripts/lib/codex-native-package.js), so this gate materializes it at the
// target version, verifies version parity, and — when the codex CLI is
// available — runs the real install smoke test (tests/codex-native-install-smoke.test.js,
// which self-reports a vacuous pass when codex is absent rather than failing CI).
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
    { name: 'codex-native-install-smoke', cmd: 'node', args: [path.join(root, 'tests/codex-native-install-smoke.test.js')] },
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
