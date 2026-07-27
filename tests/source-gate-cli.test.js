'use strict';

// CLI-level coverage for scripts/release/source-gate.js. Uses --steps-file
// (test-only override) so the suite stays fast instead of shelling the real
// heavy commands (tests/run-all.js, openspec validate) on every run — those
// are exercised for real in RELEASE.md's checklist and task 5.3's full sweep.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'source-gate.js');

function mkStepsFile(steps) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-source-gate-')), 'steps.json');
  fs.writeFileSync(file, JSON.stringify(steps));
  return file;
}

test('prints a PASS SOURCE stage as JSON when every step succeeds', () => {
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

run('source-gate-cli');
