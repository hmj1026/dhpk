'use strict';

// Coverage for scripts/emit-review-gate.sh — emits `REVIEW_GATE=<state>` for
// one of PENDING|READY|BLOCKED, and rejects anything else with usage + exit 2.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'emit-review-gate.sh');

function runScript(args) {
  return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('PENDING emits REVIEW_GATE=PENDING and exits 0', () => {
  const res = runScript(['PENDING']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'REVIEW_GATE=PENDING');
});

test('READY emits REVIEW_GATE=READY and exits 0', () => {
  const res = runScript(['READY']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'REVIEW_GATE=READY');
});

test('BLOCKED emits REVIEW_GATE=BLOCKED and exits 0', () => {
  const res = runScript(['BLOCKED']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'REVIEW_GATE=BLOCKED');
});

test('unknown state prints usage to stderr and exits 2', () => {
  const res = runScript(['WHATEVER']);
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('usage:'), res.stderr);
});

test('missing arg prints usage to stderr and exits 2', () => {
  const res = runScript([]);
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('usage:'), res.stderr);
});

run('emit-review-gate');
