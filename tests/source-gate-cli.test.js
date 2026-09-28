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

function withStepsFile(steps, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-source-gate-'));
  try {
    const file = path.join(directory, 'steps.json');
    fs.writeFileSync(file, JSON.stringify(steps));
    return callback(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
  withStepsFile([{ name: 'ok', cmd: process.execPath, args: ['-e', 'process.exit(0)'] }], (stepsFile) => {
    const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PASS');
    assert.deepStrictEqual(stage.commands, [{ cmd: `${process.execPath} -e process.exit(0)`, exitCode: 0 }]);
    assert.strictEqual(stage.environment, process.env.CI ? 'ci' : process.platform === 'darwin' ? 'local-portable' : 'local');
    assert.deepStrictEqual(stage.failureReasons, []);
  });
});

test('exits non-zero and reports failureReasons when a step fails', () => {
  withStepsFile([{ name: 'boom', cmd: process.execPath, args: ['-e', 'process.exit(1)'] }], (stepsFile) => {
    const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8' });
    assert.strictEqual(res.status, 1);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'FAIL');
    assert.deepStrictEqual(stage.commands, [{ cmd: `${process.execPath} -e process.exit(1)`, exitCode: 1 }]);
    assert.deepStrictEqual(stage.failureReasons, ['boom: exited 1']);
  });
});

test('inherits CI-owned strict cgroup policy for source-gate steps', () => {
  withStepsFile([{
    name: 'policy',
    cmd: process.execPath,
    args: ['-e', "if (process.env.DHPK_BOUNDED_REQUIRE_CGROUP !== '1' || process.env.DHPK_BOUNDED_ALLOW_FALLBACK !== '0') process.exit(1)"],
  }], (stepsFile) => {
    const env = {
      ...process.env,
      CI: 'true',
      DHPK_BOUNDED_REQUIRE_CGROUP: '1',
      DHPK_BOUNDED_ALLOW_FALLBACK: '0',
      DHPK_RELEASE_TARGET_BRANCH: 'main',
    };
    const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
    assert.strictEqual(res.status, 0, res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.environment, 'ci');
    assert.deepStrictEqual(stage.failureReasons, []);
    assert.strictEqual(stage.commands[0].exitCode, 0);
  });
});

test('does not leak the release target context into generic source-gate steps', () => {
  withStepsFile([{
    name: 'policy',
    cmd: process.execPath,
    args: ['-e', "if (process.env.DHPK_RELEASE_TARGET_BRANCH) process.exit(1)"],
  }], (stepsFile) => {
    const env = { ...process.env, DHPK_RELEASE_TARGET_BRANCH: 'main' };
    delete env.CI;
    const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
    assert.strictEqual(res.status, 0, res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.deepStrictEqual(stage.failureReasons, []);
    assert.strictEqual(stage.commands[0].exitCode, 0);
  });
});

test('uses the portable policy for local macOS source-gate steps', () => {
  withStepsFile([{
    name: 'policy',
    cmd: process.execPath,
    args: ['-e', "if (process.platform === 'darwin' && (process.env.DHPK_BOUNDED_REQUIRE_CGROUP !== '0' || process.env.DHPK_BOUNDED_ALLOW_FALLBACK !== '1')) process.exit(1)"],
  }], (stepsFile) => {
    const env = { ...process.env, DHPK_BOUNDED_REQUIRE_CGROUP: '1', DHPK_BOUNDED_ALLOW_FALLBACK: '0' };
    delete env.CI;
    const res = spawnSync(process.execPath, [CLI, '--version', '1.0.0', '--steps-file', stepsFile], { encoding: 'utf8', env });
    assert.strictEqual(res.status, 0, res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.environment, process.platform === 'darwin' ? 'local-portable' : 'local');
    assert.deepStrictEqual(stage.failureReasons, []);
    assert.strictEqual(stage.commands[0].exitCode, 0);
  });
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

  try {
    const res = spawnSync(process.execPath, [
      CLI,
      '--version', '1.0.0',
      '--repo-root', fixture.root,
    ], { encoding: 'utf8', env });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PASS');
    assert.strictEqual(stage.commands.length, 4, 'source gate must execute all four default stages');
    assert.deepStrictEqual(stage.commands.map((command) => command.exitCode), [0, 0, 0, 0]);
    assert.deepStrictEqual(stage.failureReasons, []);
    assert.ok(stage.commands[0].cmd.includes('validate-changelog-fragments.js'));
    assert.ok(stage.commands[1].cmd.includes('prepare-release.js'));
    assert.ok(stage.commands[2].cmd.includes('run-bounded-node-test.sh'));
    assert.ok(stage.commands[3].cmd.includes('openspec'));

    const observed = fs.readFileSync(fixture.probe, 'utf8');
    assert.strictEqual(observed, ciWorkerPool());
    assert.strictEqual(observed, '4');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

run('source-gate-cli');
