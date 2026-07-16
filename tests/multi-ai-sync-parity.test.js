'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'skills', 'multi-ai-sync', 'scripts', 'multi_ai_sync.py');
const CODEX = path.join(ROOT, 'codex', 'skills', 'multi-ai-sync', 'scripts', 'multi_ai_sync.py');
const DRIFT = path.join(ROOT, 'scripts', 'check-cross-cli-drift.sh');

function runPython(script, args = []) {
  return spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', timeout: 20000 });
}

test('canonical and Codex multi-ai-sync self-tests both pass in a clean scratch repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-multi-ai-sync-'));
  try {
    const canonical = runPython(CANONICAL, ['self-test', '--format', 'json']);
    const codex = runPython(CODEX, ['--root', root, 'self-test', '--format', 'json']);
    assert.strictEqual(canonical.status, 0, canonical.stderr || canonical.stdout);
    assert.strictEqual(codex.status, 0, codex.stderr || codex.stdout);
    const report = JSON.parse(codex.stdout);
    assert.strictEqual(report.failed, 0, codex.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cross-cli drift reports content mismatch even below the mtime threshold', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-content-drift-'));
  try {
    fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'same.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'same.md'), 'stale\n');
    const now = new Date();
    fs.utimesSync(path.join(root, '.claude', 'skills', 'same.md'), now, now);
    fs.utimesSync(path.join(root, '.codex', 'skills', 'same.md'), now, now);
    const res = spawnSync('bash', [DRIFT], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /content drift/);
    assert.match(res.stdout, /\.codex/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('multi-ai-sync-parity');
