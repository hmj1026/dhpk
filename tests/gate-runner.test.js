'use strict';

// Coverage for scripts/lib/gate-runner.js: runs a fixed list of shell steps,
// never stops early (every step's result is recorded for evidence), and
// composes a release-evidence-shaped stage object (verdict/commands/failureReasons).

const { test, run, assert } = require('./_lib/tinytest');
const { runSteps } = require('../scripts/lib/gate-runner');

test('all steps passing yields verdict PASS with no failure reasons', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(0)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(0)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.verdict, 'PASS');
  assert.strictEqual(stage.commands.length, 2);
  assert.deepStrictEqual(stage.failureReasons, []);
});

test('a failing step yields verdict FAIL and records the exit code', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(0)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(1)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.verdict, 'FAIL');
  assert.ok(stage.failureReasons.some((r) => r.includes('b')));
});

test('every step runs even after an earlier one fails (full evidence, not fail-fast)', () => {
  const stage = runSteps([
    { name: 'a', cmd: 'node', args: ['-e', 'process.exit(1)'] },
    { name: 'b', cmd: 'node', args: ['-e', 'process.exit(0)'] },
  ], { environment: 'test' });
  assert.strictEqual(stage.commands.length, 2);
  assert.strictEqual(stage.verdict, 'FAIL');
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

run('gate-runner');
