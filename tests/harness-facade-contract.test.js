'use strict';

// RED-first tests for harness-facade-receipt-contract task 1.1.
// These tests exercise the public result/parser seam, not private helpers.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const harness = require('../scripts/lib/harness');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk');

function invoke(args) {
  return spawnSync('bash', [CLI, 'harness', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('parses one supported phase and preserves the invocation context', () => {
  const parsed = harness.parseArgs(['preflight', '--json', '--task-id', 'task-1']);
  assert.deepStrictEqual(parsed, {
    phase: 'preflight',
    json: true,
    taskId: 'task-1',
  });
});

test('rejects unknown phases and options with usage status', () => {
  assert.throws(() => harness.parseArgs(['unknown']), /phase|usage|unknown/i);
  assert.throws(() => harness.parseArgs(['preflight', '--unknown']), /option|usage|unknown/i);
  assert.strictEqual(harness.exitCodeForOutcome('PASS'), 0);
  assert.strictEqual(harness.exitCodeForOutcome('FAIL'), 1);
  assert.strictEqual(harness.exitCodeForOutcome('NOT_RUN'), 2);
  assert.strictEqual(harness.exitCodeForOutcome('USAGE'), 64);
  assert.strictEqual(harness.exitCodeForOutcome('INTERNAL_ERROR'), 70);
});

test('requires an explicit surface for distribution adapter phases', () => {
  for (const phase of ['generate', 'validate', 'verify']) {
    assert.throws(() => harness.parseArgs([phase, '--json']), /surface|required/i);
  }
  assert.deepStrictEqual(harness.parseArgs(['generate', '--surface', 'agent-plugin']), {
    phase: 'generate',
    surface: 'agent-plugin',
  });
});

test('CLI exposes the harness help contract', () => {
  const result = invoke(['--help']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight/);
  assert.match(result.stdout, /release/);
});

run('harness-facade-contract');
