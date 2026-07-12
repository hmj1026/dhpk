'use strict';

// Coverage for scripts/resolve-feature.sh — bash wrapper over
// resolve-feature-cli.js. Must exec node relative to its own location, so it
// works from any cwd, and forward args/exit status/stdout through unchanged.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'resolve-feature.sh');

function runScript(args, cwd) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-feature-sh-'));
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('forwards --feature <key> and works from an unrelated cwd', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(['--feature', 'wrapper-feat'], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, 'wrapper-feat');
    assert.strictEqual(out.source, 'explicit');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runs with no args, exits 0, and emits valid JSON', () => {
  const tmp = mkTmp();
  try {
    const res = runScript([], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('resolve-feature');
