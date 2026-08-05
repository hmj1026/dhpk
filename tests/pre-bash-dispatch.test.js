'use strict';

// Coverage for pre-bash-dispatch.sh (PreToolUse Bash dispatcher): runs the
// core pre-bash-guard.sh first — any non-zero exit aborts the bash call
// immediately. With no active modules configured, the dispatcher's exit code
// mirrors the core guard exactly.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT, mkRepo, rmRepo, sessionsDir, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'pre-bash-dispatch.sh';

function runHook(command, cwd, env = {}) {
  return runHookRaw(HOOK, {
    payload: { tool_input: { command } },
    cwd: cwd || ROOT,
    projectDir: cwd || ROOT,
    env,
    deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_MODULES'],
  });
}

test('dangerous command (rm -rf /home) is blocked (exit 2), core guard bubbles up', () => {
  const res = runHook('rm -rf /home');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('safe command passes through (exit 0), no active modules', () => {
  const res = runHook('echo hello');
  assert.strictEqual(res.status, 0, `expected allowed, got: ${res.status} / ${res.stderr}`);
});

test('.env write via redirection is blocked (exit 2), core guard bubbles up', () => {
  const res = runHook('echo SECRET=x > .env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('deep workspace path under /home still passes through the dispatcher', () => {
  const res = runHook('rm -rf /home/paul/projects/x/y');
  assert.strictEqual(res.status, 0, `expected allowed, got: ${res.status} / ${res.stderr}`);
});

function repoOnMainWithPendingReview() {
  const repo = mkRepo({ prefix: 'dhpk-pre-bash-compose-', gitConfig: true });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['commit', '-qm', 'seed'], { cwd: repo });
  spawnSync('git', ['branch', '-M', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'edited\n');
  fs.mkdirSync(sessionsDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessionsDir(repo), '.pending-review'), 'seed.txt\n');
  return repo;
}

test('combined dispatcher preserves protected-branch commit block', () => {
  const repo = repoOnMainWithPendingReview();
  try {
    const res = runHook('git commit -m guarded', repo, { DHPK_BRANCH_SAFETY: 'block' });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.match(res.stderr, /branch-safety/i);
  } finally { rmRepo(repo); }
});

test('combined dispatcher preserves pending-review commit and push blocks', () => {
  const repo = repoOnMainWithPendingReview();
  try {
    const commit = runHook('git commit -m guarded', repo, { DHPK_SENTINEL_COMMIT_GATE: 'block' });
    assert.strictEqual(commit.status, 2, commit.stderr);
    assert.match(commit.stderr, /sentinel-gate|pending-review/i);
    const push = runHook('git push origin main', repo, { DHPK_SENTINEL_COMMIT_GATE: 'block' });
    assert.strictEqual(push.status, 2, push.stderr);
    assert.match(push.stderr, /pending-review|sentinel/i);
  } finally { rmRepo(repo); }
});

run('pre-bash-dispatch');
