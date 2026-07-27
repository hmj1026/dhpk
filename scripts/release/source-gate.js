#!/usr/bin/env node
'use strict';

// SOURCE release gate: composes fragment validation, version/changelog
// parity, standard repository tests, and OpenSpec validation into one
// release-evidence stage. Prints the stage as JSON on stdout; exit code
// mirrors the verdict (0 = PASS, 1 = FAIL).
//
// Usage: node scripts/release/source-gate.js --version X.Y.Z [--repo-root <path>]

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
    // Test-only override: run an arbitrary step list instead of the real
    // (heavy) release checks, so the CLI is testable without shelling
    // tests/run-all.js / openspec validate on every test run.
    else if (arg === '--steps-file') args.stepsFile = argv[++i];
    else {
      console.error(`source-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  return args;
}

function defaultSteps(root, version) {
  return [
    { name: 'changelog-fragments', cmd: 'node', args: [path.join(root, 'scripts/ci/validate-changelog-fragments.js'), '--repo-root', root] },
    { name: 'release-parity', cmd: 'node', args: [path.join(root, 'scripts/release/prepare-release.js'), 'check', '--version', version, '--repo-root', root] },
    { name: 'repository-tests', cmd: 'node', args: [path.join(root, 'tests/run-all.js')] },
    { name: 'openspec-validate', cmd: 'openspec', args: ['validate', '--changes', '--strict', '--no-interactive'] },
  ];
}

const args = parseArgs(process.argv.slice(2));
if (!args.stepsFile && !args.version) {
  console.error('usage: source-gate.js --version X.Y.Z [--repo-root <path>]');
  process.exit(2);
}

const steps = args.stepsFile
  ? JSON.parse(fs.readFileSync(args.stepsFile, 'utf8'))
  : defaultSteps(args.root, args.version);

const stage = runSteps(steps, { environment: process.env.CI ? 'ci' : 'local', cwd: args.root });
console.log(JSON.stringify(stage, null, 2));
process.exit(stage.verdict === 'PASS' ? 0 : 1);
