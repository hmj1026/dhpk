'use strict';

// CLI-level coverage for scripts/release/package-gate.js. Uses --steps-file
// (test-only override, same pattern as source-gate-cli.test.js) so the suite
// stays fast instead of shelling the real staged-package/install-smoke steps
// on every run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'package-gate.js');

function mkStepsFile(steps) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-package-gate-')), 'steps.json');
  fs.writeFileSync(file, JSON.stringify(steps));
  return file;
}

test('prints a PASS PACKAGE stage as JSON when every step succeeds', () => {
  const stepsFile = mkStepsFile([{ name: 'ok', cmd: 'node', args: ['-e', 'process.exit(0)'] }]);
  const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PASS');
});

test('exits non-zero and reports failureReasons when a step fails', () => {
  const stepsFile = mkStepsFile([{ name: 'boom', cmd: 'node', args: ['-e', 'process.exit(1)'] }]);
  const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'FAIL');
  assert.ok(stage.failureReasons.some((r) => r.includes('boom')));
});

test('default package gate reports shared-copy drift before package checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-package-copy-gate-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts', 'ci'), { recursive: true });
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    for (const name of ['validate-plugin', 'gen-claude-marketplace-package',
      'validate-distribution', 'verify-staged-package-version',
      'validate-cursor-sync', 'verify-platform-packages']) {
      fs.writeFileSync(path.join(root, 'scripts', 'ci', `${name}.js`), 'process.exit(0);\n');
    }
    fs.writeFileSync(path.join(root, 'bin', 'dhpk'), '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(root, 'scripts', 'ci', 'sync-skill-resources.js'),
      'if (process.argv[2] !== "--check") process.exit(2);\nconsole.error("stale managed copy");\nprocess.exit(1);\n');
    const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--repo-root', root], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.strictEqual(res.status, 1, res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'FAIL');
    assert.match(stage.commands[0].cmd, /sync-skill-resources\.js --check$/);
    assert.strictEqual(stage.commands[0].exitCode, 1);
    assert.ok(stage.failureReasons.some((reason) => /skill-resource-copies.*stale managed copy/.test(reason)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('package-gate-cli');
