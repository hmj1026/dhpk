#!/usr/bin/env node
'use strict';

// Blocks tag/publication preparation unless SOURCE and PACKAGE both PASS
// (task 3.4). Purely advisory: it never merges a PR, creates a tag, or
// pushes anything — it runs (or, in tests, reads pre-baked JSON for)
// source-gate.js and package-gate.js, builds combined release evidence with
// CONSUMER left PENDING (nothing has published yet), and exits non-zero when
// the result is BLOCKED. release-runner.sh publish still owns the actual
// tag/push mechanics and remains a human-invoked step.
//
// Usage: node scripts/release/publish-gate.js --version X.Y.Z [--repo-root <path>]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildEvidence, VERDICTS } = require('../lib/release-evidence');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg === '--repo-root') args.root = argv[++i];
    // Test-only overrides: inject pre-baked stage JSON instead of spawning
    // the real (heavy) source-gate.js/package-gate.js.
    else if (arg === '--source-gate-json') args.sourceGateJson = argv[++i];
    else if (arg === '--package-gate-json') args.packageGateJson = argv[++i];
    else {
      console.error(`publish-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.version) {
    console.error('usage: publish-gate.js --version X.Y.Z [--repo-root <path>]');
    process.exit(2);
  }
  return args;
}

function currentBranch(root) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function runGate(scriptRelPath, jsonOverride, root, version, env = process.env) {
  if (jsonOverride) {
    return JSON.parse(fs.readFileSync(jsonOverride, 'utf8'));
  }
  try {
    const out = execFileSync('node', [path.join(root, scriptRelPath), '--version', version, '--repo-root', root], { encoding: 'utf8', env });
    return JSON.parse(out);
  } catch (e) {
    // The gate CLI exits non-zero on FAIL but still prints a valid stage JSON to stdout.
    if (e.stdout) return JSON.parse(e.stdout);
    return { verdict: VERDICTS.FAIL, commands: [], environment: 'local', artifacts: [], failureReasons: [`${scriptRelPath} did not produce evidence: ${e.message}`] };
  }
}

const args = parseArgs(process.argv.slice(2));

const targetBranch = process.env.DHPK_RELEASE_TARGET_BRANCH || currentBranch(args.root);
const publishEnv = { ...process.env };
if (targetBranch && targetBranch !== 'HEAD') publishEnv.DHPK_RELEASE_TARGET_BRANCH = targetBranch;

const sourceStage = runGate('scripts/release/source-gate.js', args.sourceGateJson, args.root, args.version, publishEnv);
const packageStage = runGate('scripts/release/package-gate.js', args.packageGateJson, args.root, args.version);
const consumerStage = { verdict: VERDICTS.PENDING, commands: [], environment: 'local', artifacts: [], failureReasons: [] };

const evidence = buildEvidence({ version: args.version, stages: { SOURCE: sourceStage, PACKAGE: packageStage, CONSUMER: consumerStage } });
console.log(JSON.stringify(evidence, null, 2));

if (evidence.overall === 'BLOCKED') {
  console.error('publish-gate: BLOCKED — publication refused until SOURCE and PACKAGE both PASS');
  process.exit(1);
}
