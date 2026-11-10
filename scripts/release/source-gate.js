#!/usr/bin/env node
'use strict';

// SOURCE release gate: composes fragment validation, version/changelog
// parity, standard repository tests, and OpenSpec validation into one
// release-evidence stage. Prints the stage as JSON on stdout; exit code
// mirrors the verdict (0 = PASS, 1 = FAIL).
//
// Usage: node scripts/release/source-gate.js --version X.Y.Z [--repo-root <path>]
//        node scripts/release/source-gate.js --only <step-name> [--repo-root <path>]
//
// `--only` runs one step under the same gate policy (`npm run test:gate` runs
// repository-tests); it needs no --version. The stage records the step
// toolchain (python3/node/bash resolved from the gate PATH) as evidence.

const fs = require('fs');
const path = require('path');
const { runSteps } = require('../lib/gate-runner');
const { readFileBounded } = require('../lib/bounded-filesystem');
const { describeToolchain } = require('../lib/toolchain-identity');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const TEST_JOBS = '4';

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg === '--repo-root') args.root = argv[++i];
    else if (arg === '--only') {
      args.only = argv[++i];
      if (!args.only || args.only.startsWith('--')) {
        console.error("source-gate: '--only' needs a step name");
        args.invalid = true;
        break;
      }
    }
    // Test-only override: run an arbitrary step list instead of the real
    // (heavy) release checks, so the CLI is testable without shelling
    // tests/run-all.js / openspec validate on every test run.
    else if (arg === '--steps-file') args.stepsFile = argv[++i];
    else {
      console.error(`source-gate: unknown argument '${arg}'`);
      args.invalid = true;
      break;
    }
  }
  return args;
}

function defaultSteps(root, version, releaseTargetBranch) {
  const releaseParity = {
    name: 'release-parity',
    cmd: 'node',
    args: [path.join(root, 'scripts/release/prepare-release.js'), 'check', '--version', version, '--repo-root', root],
  };
  if (releaseTargetBranch) releaseParity.env = { DHPK_RELEASE_TARGET_BRANCH: releaseTargetBranch };
  return [
    { name: 'changelog-fragments', cmd: 'node', args: [path.join(root, 'scripts/ci/validate-changelog-fragments.js'), '--repo-root', root] },
    releaseParity,
    {
      name: 'repository-tests',
      cmd: path.join(root, 'scripts/ci/run-bounded-node-test.sh'),
      args: ['node', path.join(root, 'tests/run-all.js')],
      env: { DHPK_TEST_JOBS: TEST_JOBS },
    },
    { name: 'openspec-validate', cmd: 'openspec', args: ['validate', '--changes', '--strict', '--no-interactive'] },
  ];
}

function sourceGatePolicy() {
  const env = { ...process.env };
  const releaseTargetBranch = env.DHPK_RELEASE_TARGET_BRANCH;
  delete env.DHPK_RELEASE_TARGET_BRANCH;
  if (process.env.CI) return { environment: 'ci', env, releaseTargetBranch };
  if (process.platform === 'darwin') {
    env.DHPK_BOUNDED_REQUIRE_CGROUP = '0';
    env.DHPK_BOUNDED_ALLOW_FALLBACK = '1';
    return { environment: 'local-portable', env, releaseTargetBranch };
  }
  return { environment: 'local', env, releaseTargetBranch };
}

function selectSteps(steps, only) {
  if (!only) return steps;
  const selected = steps.filter((step) => step.name === only);
  if (selected.length === 0) {
    console.error(`source-gate: unknown step '${only}' (known: ${steps.map((step) => step.name).join(', ')})`);
    return null;
  }
  return selected;
}

const args = parseArgs(process.argv.slice(2));
if (args.invalid || (!args.stepsFile && !args.version && !args.only)) {
  if (!args.invalid) console.error('usage: source-gate.js --version X.Y.Z [--repo-root <path>] | --only <step-name>');
  process.exitCode = 2;
} else {
  const policy = sourceGatePolicy();
  const allSteps = args.stepsFile
    ? JSON.parse(readFileBounded(args.stepsFile).toString('utf8'))
    : defaultSteps(args.root, args.version || '0.0.0', policy.releaseTargetBranch);
  const steps = selectSteps(allSteps, args.only);
  if (!steps) {
    process.exitCode = 2;
  } else if (!args.version && !args.stepsFile && steps.some((step) => step.name === 'release-parity')) {
    console.error("source-gate: step 'release-parity' needs --version X.Y.Z");
    process.exitCode = 2;
  } else {
    const stage = runSteps(steps, { ...policy, cwd: args.root });
    if (args.only) stage.only = args.only;
    stage.toolchain = describeToolchain(policy.env, undefined, { cwd: args.root });
    console.log(JSON.stringify(stage, null, 2));
    process.exitCode = stage.verdict === 'PASS' ? 0 : 1;
  }
}
