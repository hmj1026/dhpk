'use strict';

// Coverage for scripts/hooks/_lib/portable-stat.sh: file_mtime_epoch().

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'portable-stat.sh');

function sh(cmd) {
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000 });
}

test('file_mtime_epoch returns a plausible epoch seconds value for an existing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stat-'));
  const f = path.join(dir, 'x.txt');
  fs.writeFileSync(f, 'hello');
  const before = Math.floor(Date.now() / 1000) - 5;
  const res = sh(`file_mtime_epoch "${f}"`);
  assert.strictEqual(res.status, 0, res.stderr);
  const mtime = parseInt(res.stdout.trim(), 10);
  assert.ok(Number.isInteger(mtime), `not an integer: ${res.stdout}`);
  assert.ok(mtime >= before, `mtime ${mtime} looks too old (before=${before})`);
});

test('file_mtime_epoch on a missing file (edge case) prints nothing and exits 0', () => {
  const res = sh('file_mtime_epoch "/nonexistent/path/does-not-exist.txt"; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
});

run('portable-stat');
