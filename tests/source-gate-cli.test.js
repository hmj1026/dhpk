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

function writeExecutable(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function mkLocalGateRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-source-gate-repo-'));
  const probe = path.join(root, 'worker-pool.txt');
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(path.join(scripts, 'ci'), { recursive: true });
  fs.mkdirSync(path.join(scripts, 'release'), { recursive: true });
  fs.writeFileSync(path.join(scripts, 'ci', 'validate-changelog-fragments.js'), '');
  fs.writeFileSync(path.join(scripts, 'release', 'prepare-release.js'), '');
  writeExecutable(
    path.join(scripts, 'ci', 'run-bounded-node-test.sh'),
    `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(probe)}, process.env.DHPK_TEST_JOBS || '');
`
  );
  const bin = path.join(root, 'bin');
  writeExecutable(path.join(bin, 'openspec'), '#!/bin/sh\nexit 0\n');
  return { root, probe, bin };
}

function ciWorkerPool() {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const match = workflow.match(/name:\s+Tests[\s\S]*?DHPK_TEST_JOBS:\s*[\"']?(\d+)/);
  assert.ok(match, 'CI must declare a worker-pool size for the Tests stage');
  return match[1];
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
  const env = {
    ...process.env,
    CI: 'true',
    DHPK_BOUNDED_REQUIRE_CGROUP: '1',
    DHPK_BOUNDED_ALLOW_FALLBACK: '0',
    DHPK_RELEASE_TARGET_BRANCH: 'main',
  };
  const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
  assert.strictEqual(res.status, 0, res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.environment, 'ci');
});

test('does not leak the release target context into generic source-gate steps', () => {
  const stepsFile = mkStepsFile([{
    name: 'policy',
    cmd: 'node',
    args: ['-e', "if (process.env.DHPK_RELEASE_TARGET_BRANCH) process.exit(1)"],
  }]);
  const env = { ...process.env, DHPK_RELEASE_TARGET_BRANCH: 'main' };
  delete env.CI;
  const res = spawnSync('node', [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
  assert.strictEqual(res.status, 0, res.stderr);
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

test('local source gate uses the same worker pool as the CI Tests stage', () => {
  const fixture = mkLocalGateRepo();
  const env = {
    ...process.env,
    PATH: [fixture.bin, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
  };
  delete env.CI;
  delete env.DHPK_TEST_JOBS;
  delete env.DHPK_RELEASE_TARGET_BRANCH;

  const res = spawnSync(process.execPath, [
    CLI,
    '--version', '1.0.0',
    '--repo-root', fixture.root,
  ], { encoding: 'utf8', env });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PASS');

  const observed = fs.readFileSync(fixture.probe, 'utf8');
  assert.strictEqual(observed, ciWorkerPool());
  assert.strictEqual(observed, '4');
});

run('source-gate-cli');
