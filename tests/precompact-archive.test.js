'use strict';

// Smoke coverage for precompact-archive.sh (PreCompact hook).
//   1. bash -n syntax check.
//   2. Safe invocation against a scratch git repo (isolated via
//      CLAUDE_PROJECT_DIR) — no host mutation, no network, no real-repo
//      writes: the checkpoint + handoff files land only inside the scratch
//      dir, which is deleted afterwards. Asserts only exit code 0 (this hook
//      always exits 0 per its own contract) — the shape of its output is not
//      asserted in this smoke-level test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'precompact-archive.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('safe invocation against a scratch repo exits 0, no host mutation', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pca-')));
  spawnSync('git', ['init', '-q'], { cwd: scratch });
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: scratch };
    const res = spawnSync('bash', ['-c', 'printf %s "{}" | bash "$1"', '_', HOOK], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('precompact-archive');
