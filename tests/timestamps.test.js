'use strict';

// Coverage for scripts/hooks/_lib/timestamps.sh: ts_now, ts_iso, ts_epoch.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'timestamps.sh');

function sh(cmd) {
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000 });
}

test('ts_now matches "YYYY-MM-DD HH:MM:SS TZ" format', () => {
  const res = sh('ts_now');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout.trim(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+$/);
});

test('ts_iso matches UTC ISO-8601 with trailing Z', () => {
  const res = sh('ts_iso');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout.trim(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('ts_epoch prints an integer close to current time', () => {
  const before = Math.floor(Date.now() / 1000) - 5;
  const res = sh('ts_epoch');
  assert.strictEqual(res.status, 0, res.stderr);
  const epoch = parseInt(res.stdout.trim(), 10);
  const after = Math.floor(Date.now() / 1000) + 5;
  assert.ok(epoch >= before && epoch <= after, `epoch ${epoch} out of range [${before}, ${after}]`);
});

run('timestamps');
