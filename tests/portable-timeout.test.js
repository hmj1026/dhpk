'use strict';

// Coverage for scripts/hooks/_lib/portable-timeout.sh: run_with_timeout().

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'portable-timeout.sh');

function sh(cmd) {
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000 });
}

test('command finishing before the deadline runs to completion and returns its exit code', () => {
  const res = sh('run_with_timeout 5 true');
  assert.strictEqual(res.status, 0, res.stderr);
});

test('command exceeding the deadline is killed with exit 124', () => {
  const res = sh('run_with_timeout 1 sleep 5');
  assert.strictEqual(res.status, 124, `expected 124, got ${res.status} / ${res.stderr}`);
});

test('propagates a non-zero exit code from the wrapped command', () => {
  const res = sh('run_with_timeout 5 bash -c "exit 7"');
  assert.strictEqual(res.status, 7, res.stderr);
});

test('no command given (edge case) returns 0 without executing anything', () => {
  const res = sh('run_with_timeout 5; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
});

run('portable-timeout');
