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

test('uses strict cgroup policy for CI source-gate steps', () => {
  const stepsFile = mkStepsFile([{
    name: 'policy',
    cmd: 'node',
    args: ['-e', "if (process.env.DHPK_BOUNDED_REQUIRE_CGROUP !== '1' || process.env.DHPK_BOUNDED_ALLOW_FALLBACK !== '0') process.exit(1)"],
  }]);
  const env = { ...process.env, CI: 'true', DHPK_BOUNDED_REQUIRE_CGROUP: '1', DHPK_BOUNDED_ALLOW_FALLBACK: '0' };
  const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
  assert.strictEqual(res.status, 0, res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.environment, 'ci');
});

test('uses the portable policy for local macOS source-gate steps', () => {
  const stepsFile = mkStepsFile([{
    name: 'policy',
    cmd: 'node',
    args: ['-e', "if (process.platform === 'darwin' && (process.env.DHPK_BOUNDED_REQUIRE_CGROUP !== '0' || process.env.DHPK_BOUNDED_ALLOW_FALLBACK !== '1')) process.exit(1)"],
  }]);
  const env = { ...process.env, DHPK_BOUNDED_REQUIRE_CGROUP: '1', DHPK_BOUNDED_ALLOW_FALLBACK: '0' };
  delete env.CI;
  const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
  assert.strictEqual(res.status, 0, res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.environment, process.platform === 'darwin' ? 'local-portable' : 'local');
});

run('source-gate-cli');
