'use strict';

// Coverage for scripts/lib/gate-runner.js: runs a fixed list of shell steps,
// never stops early (every step's result is recorded for evidence), and
// composes a release-evidence-shaped stage object (verdict/commands/failureReasons).

const { test, run, assert } = require('./_lib/tinytest');
const { runSteps } = require('../scripts/lib/gate-runner');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('all steps passing yields verdict PASS with no failure reasons', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(0)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(0)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.verdict, 'PASS');
  assert.deepStrictEqual(stage.commands, [
    { cmd: 'node -e process.exit(0)', exitCode: 0 },
    { cmd: 'node -e process.exit(0)', exitCode: 0 },
  ]);
  assert.deepStrictEqual(stage.failureReasons, []);
});

test('a failing step yields verdict FAIL and records the exit code', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(0)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(1)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.verdict, 'FAIL');
  assert.deepStrictEqual(stage.commands.map((command) => command.exitCode), [0, 1]);
  assert.deepStrictEqual(stage.failureReasons, ['b: exited 1']);
});

test('every step runs even after an earlier one fails (full evidence, not fail-fast)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-gate-runner-'));
  const marker = path.join(directory, 'second-step-ran');
  try {
    const stage = runSteps([
      { name: 'first', cmd: 'node', args: ['-e', 'process.exit(7)'] },
      { name: 'second', cmd: 'node', args: ['-e', "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker] },
    ], { environment: 'test' });
    assert.deepStrictEqual(stage.commands.map((command) => command.exitCode), [7, 0]);
    assert.deepStrictEqual(stage.failureReasons, ['first: exited 7']);
    assert.strictEqual(stage.verdict, 'FAIL');
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'ran', 'later steps must run after an earlier failure');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('passes an explicit environment to every step', () => {
  const stage = runSteps([
    {
      name: 'environment',
      cmd: 'node',
      args: ['-e', "if (process.env.DHPK_GATE_RUNNER_TEST !== 'present') process.exit(1)"],
    },
  ], {
    environment: 'test',
    env: { ...process.env, DHPK_GATE_RUNNER_TEST: 'present' },
  });
  assert.strictEqual(stage.verdict, 'PASS');
});

test('merges per-step environment overrides without losing the gate environment', () => {
  const stage = runSteps([
    {
      name: 'environment',
      cmd: 'node',
      args: ['-e', "if (process.env.DHPK_GATE_RUNNER_TEST !== 'present' || process.env.DHPK_STEP_TEST !== 'present') process.exit(1)"],
      env: { DHPK_STEP_TEST: 'present' },
    },
  ], {
    environment: 'test',
    env: { ...process.env, DHPK_GATE_RUNNER_TEST: 'present' },
  });
  assert.strictEqual(stage.verdict, 'PASS');
});

run('gate-runner');
