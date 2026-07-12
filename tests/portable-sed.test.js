'use strict';

// Coverage for scripts/hooks/_lib/portable-sed.sh: sed_inplace().

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'portable-sed.sh');

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sed-'));
  const f = path.join(dir, 'target.txt');
  fs.writeFileSync(f, content);
  return f;
}

function sh(cmd) {
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000 });
}

test('sed_inplace replaces text in a file (current-platform sed dialect)', () => {
  const f = tmpFile('foo bar\n');
  const res = sh(`sed_inplace 's/foo/baz/' "${f}"`);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'baz bar\n');
});

test('sed_inplace on file with no match leaves content unchanged (edge case)', () => {
  const f = tmpFile('nothing to see\n');
  const res = sh(`sed_inplace 's/xyz/abc/' "${f}"`);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'nothing to see\n');
});

run('portable-sed');
