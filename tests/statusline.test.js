'use strict';

// Coverage for scripts/statusline/statusline.sh — dhpk plugin statusline.
// Runs against a scratch git repo with HOME redirected to a scratch dir (no
// ~/.claude/statusline.sh there), so the "global rich statusline" branch is
// deterministically skipped and only the dhpk prefix line is asserted.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'statusline', 'statusline.sh');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-repo-'));
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t.test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function mkHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-home-'));
}

const PAYLOAD = JSON.stringify({
  model: { id: 'claude-sonnet-5' },
  cwd: '/some/project',
  context_window: {},
});

function runStatusline(repo, home) {
  return spawnSync('bash', ['-c', `printf '%s' "$DHPK_PAYLOAD" | bash "${SCRIPT}"`], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, HOME: home, DHPK_PAYLOAD: PAYLOAD, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard' },
  });
}

test('clean repo: prefix line reports branch, +0 staged, ~0 modified, profile', () => {
  const repo = mkRepo();
  const home = mkHome();
  try {
    const res = runStatusline(repo, home);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '[main] +0 ~0 | profile=standard');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('modified file is reflected in the ~N modified count', () => {
  const repo = mkRepo();
  const home = mkHome();
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
    spawnSync('git', ['-C', repo, 'add', 'a.txt']);
    spawnSync('git', ['-C', repo, '-c', 'user.email=t@t.test', '-c', 'user.name=test', 'commit', '-q', '-m', 'add a']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'y');
    const res = runStatusline(repo, home);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '[main] +0 ~1 | profile=standard');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('pending sentinel present: badge is currently suppressed by an array-length mismatch bug', () => {
  // KNOWN SCRIPT BUG (reported, not fixed here): statusline.sh's local
  // SHORT=(...) array has 6 entries (scripts/statusline/statusline.sh:99),
  // but the SSOT SENTINEL_NAMES in scripts/hooks/_lib/payload.sh has grown to
  // 7 (a "migration-review" slot was added later). The script only builds the
  // sentinel badge when `${#SHORT[@]} -eq ${#SENTINEL_NAMES[@]}`, so this
  // guard is now always false and the "⚠ <label>" badge never renders,
  // regardless of any pending review sentinel. This test documents the
  // CURRENT (broken) behavior; see the fast-worker report for the escalation.
  const repo = mkRepo();
  const home = mkHome();
  try {
    const sess = path.join(repo, '.claude', 'artifacts', 'sessions');
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, '.pending-review'), 'stub');
    const res = runStatusline(repo, home);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '[main] +0 ~0 | profile=standard');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

run('statusline');
