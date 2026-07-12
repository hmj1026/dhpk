'use strict';

// Coverage for scripts/check-cross-cli-drift.sh — advisory drift detector
// comparing newest-file mtimes under .claude/ vs sibling .codex/ / .gemini/
// harness dirs. Always exits 0; only stdout content varies.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-cross-cli-drift.sh');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cross-cli-drift-'));
}

function touch(file, mtimeSeconds) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  const t = new Date(mtimeSeconds * 1000);
  fs.utimesSync(file, t, t);
}

function runScript(projectDir, extraEnv) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...extraEnv };
  return spawnSync('bash', [SCRIPT], { cwd: projectDir, env, encoding: 'utf8', timeout: 10000 });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('no .claude dir at all: exits 0 silently', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('.claude present but no sibling .codex/.gemini: exits 0 silently', () => {
  const tmp = mkTmp();
  try {
    touch(path.join(tmp, '.claude', 'skills', 'a.md'), Math.floor(Date.now() / 1000));
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drift under threshold: no advisory printed', () => {
  const tmp = mkTmp();
  try {
    const now = Math.floor(Date.now() / 1000);
    touch(path.join(tmp, '.claude', 'skills', 'a.md'), now);
    touch(path.join(tmp, '.codex', 'skills', 'a.md'), now - 100);
    const res = runScript(tmp, { DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drift over threshold: prints advisory naming the stale sibling with hour delta', () => {
  const tmp = mkTmp();
  try {
    const now = Math.floor(Date.now() / 1000);
    touch(path.join(tmp, '.claude', 'skills', 'a.md'), now);
    touch(path.join(tmp, '.codex', 'skills', 'a.md'), now - 3 * 3600 - 60);
    const res = runScript(tmp, { DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('cross-cli drift'), res.stdout);
    assert.ok(res.stdout.includes('.codex(+3h)'), res.stdout);
    assert.ok(res.stdout.includes('/multi-ai-sync'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('check-cross-cli-drift');
