'use strict';

// Dedicated coverage for scripts/hooks/_lib/sentinel-clear-core.sh — the shared
// sentinel-file operations extracted from the three sentinel entry points
// (clear-sentinel.sh, subagent-stop-verify.sh, reap-stale-sentinels.sh).
// Verifies the two-layer contract: sentinel_remove_file (bare rm, no side
// effects) and sentinel_clear_present (sanctioned clear: rm + status line +
// ldb success + backoff reset).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib');

function mkRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-core-')));
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t.test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

// Runs a bash snippet with the three libs sourced and CLAUDE_PROJECT_DIR set to
// the scratch repo, so dhpk_root / dhpk_sessions_dir resolve inside it.
function runCore(repo, snippet) {
  const prelude =
    `. "${LIB}/session-env.sh"; . "${LIB}/learning-db.sh"; . "${LIB}/sentinel-clear-core.sh"; ` +
    `SESS="$(dhpk_sessions_dir)"; mkdir -p "$SESS"; `;
  return spawnSync('bash', ['-c', prelude + snippet], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
}

test('sentinel_remove_file removes a present sentinel file', () => {
  const repo = mkRepo();
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), '.pending-review'), 'stub');
  const res = runCore(repo, 'sentinel_remove_file "$SESS/.pending-review"');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')), 'file should be removed');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('sentinel_remove_file is idempotent on a missing file', () => {
  const repo = mkRepo();
  const res = runCore(repo, 'sentinel_remove_file "$SESS/.pending-review"');
  assert.strictEqual(res.status, 0, `expected exit 0 on missing file: ${res.stderr}`);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('sentinel_clear_present removes the file and emits the canonical status line', () => {
  const repo = mkRepo();
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), '.pending-review'), 'stub');
  const res = runCore(repo, 'sentinel_clear_present "$SESS" ".pending-review" "unit"');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.ok(res.stdout.includes('[unit] sentinel cleared (.pending-review)'),
    `expected canonical cleared line, got:\n${res.stdout}`);
  assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')), 'file should be removed');
  fs.rmSync(repo, { recursive: true, force: true });
});

run('sentinel-clear-core');
