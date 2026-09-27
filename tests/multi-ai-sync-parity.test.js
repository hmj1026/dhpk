'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const CODEX = path.join(ROOT, 'codex', 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const DRIFT = path.join(ROOT, 'scripts', 'check-cross-cli-drift.sh');

function runPython(script, args = []) {
  return spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', timeout: 20000 });
}

test('canonical and Codex harness-govern sync self-tests both pass in a clean scratch repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-multi-ai-sync-'));
  try {
    assert.strictEqual(fs.realpathSync(CODEX), fs.realpathSync(CANONICAL),
      'Codex entrypoint must resolve to the canonical implementation');
    const result = runPython(CODEX, ['--root', root, 'self-test', '--format', 'json']);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.total, 4, result.stdout);
    assert.strictEqual(report.passed, 4, result.stdout);
    assert.strictEqual(report.failed, 0, result.stdout);
    assert.deepStrictEqual(report.results.map(({ name, status }) => [name, status]), [
      ['agent-bundle-tdd-guide', 'pass'],
      ['agent-bundle-architect-parseable', 'pass'],
      ['agent-manifest-build', 'pass'],
      ['agent-bundle-refactor-cleaner-parseable', 'pass'],
    ]);
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

    fs.writeFileSync(path.join(root, '.codex', 'skills', 'same.md'), 'canonical\n');
    fs.utimesSync(path.join(root, '.claude', 'skills', 'same.md'), now, now);
    fs.utimesSync(path.join(root, '.codex', 'skills', 'same.md'), now, now);
    assert.strictEqual(
      fs.statSync(path.join(root, '.claude', 'skills', 'same.md')).mtimeMs,
      fs.statSync(path.join(root, '.codex', 'skills', 'same.md')).mtimeMs,
      'matching-content control must retain equal mtimes',
    );
    const synchronized = spawnSync('bash', [DRIFT], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(synchronized.status, 0, synchronized.stderr);
    assert.doesNotMatch(synchronized.stdout, /content drift/i,
      'matching content must remove the drift advisory below the mtime threshold');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('harness-govern-sync-parity');
