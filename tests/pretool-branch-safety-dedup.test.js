'use strict';

// D5 regression: pretool-git-gate.sh's branch-safety slot (merged from
// pretool-branch-safety.sh) warn mode must dedup the "[branch-safety]
// REMINDER" systemMessage to once per session per (branch, protected-list),
// using a SESSION-scoped tmp state file (not a durable repo file). Keying on
// a hash of the protected list too means a mid-session protected_branches
// config change re-arms the reminder for a newly-protected branch. block
// mode is NOT deduped — every rejected command must always explain itself.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'pretool-git-gate.sh';

function mkTempRepo() {
  // realpath: on macOS os.tmpdir() lives under a /var symlink to /private/var;
  // the hook derives ROOT via `git rev-parse --show-toplevel` which resolves
  // symlinks, so an unresolved path here could cause mismatches downstream.
  const dir = mkRepo({ prefix: 'dhpk-bs-repo-', gitConfig: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  // Ensure the branch is named 'main' (a default-protected branch) regardless
  // of the environment's init.defaultBranch setting.
  spawnSync('git', ['branch', '-M', 'main'], { cwd: dir });
  return dir;
}

function runHook(cwd, tmpdir, extraEnv) {
  const payload = {
    session_id: 'testsess1',
    tool_input: { command: 'git commit -m x' },
  };
  return runHookRaw(HOOK, {
    cwd,
    payload,
    env: { TMPDIR: tmpdir, ...extraEnv },
    deleteEnv: ['DHPK_BRANCH_SAFETY', 'CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES'],
  });
}

test('warn mode dedups the REMINDER to once per session (5.1)', () => {
  const repo = mkTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bs-state-'));
  try {
    const first = runHook(repo, stateDir, {});
    assert.strictEqual(first.status, 0, `first run exited non-zero: ${first.stderr}`);
    assert.ok(first.stdout.includes('[branch-safety] REMINDER'),
      `first run should warn; stdout: ${first.stdout}`);

    const second = runHook(repo, stateDir, {});
    assert.strictEqual(second.status, 0, `second run exited non-zero: ${second.stderr}`);
    assert.ok(!second.stdout.includes('[branch-safety] REMINDER'),
      `second run should be deduped (no REMINDER); stdout: ${second.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('changing protected_branches mid-session re-arms the reminder (5.2)', () => {
  const repo = mkTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bs-state-'));
  try {
    const first = runHook(repo, stateDir, {});
    assert.strictEqual(first.status, 0, `first run exited non-zero: ${first.stderr}`);
    assert.ok(first.stdout.includes('[branch-safety] REMINDER'),
      `first run should warn; stdout: ${first.stdout}`);

    const second = runHook(repo, stateDir, {});
    assert.ok(!second.stdout.includes('[branch-safety] REMINDER'),
      `second run should be deduped; stdout: ${second.stdout}`);

    const third = runHook(repo, stateDir, {
      CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES: 'main,release/*,foo/*',
    });
    assert.strictEqual(third.status, 0, `third run exited non-zero: ${third.stderr}`);
    assert.ok(third.stdout.includes('[branch-safety] REMINDER'),
      `third run (changed protected list) should re-warn; stdout: ${third.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('block mode is never deduped (5.3)', () => {
  const repo = mkTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bs-state-'));
  try {
    const first = runHook(repo, stateDir, { DHPK_BRANCH_SAFETY: 'block' });
    assert.strictEqual(first.status, 2, `first run should exit 2; stderr: ${first.stderr}`);
    assert.ok(first.stderr.includes('BLOCKED'),
      `first run stderr should contain BLOCKED; stderr: ${first.stderr}`);

    const second = runHook(repo, stateDir, { DHPK_BRANCH_SAFETY: 'block' });
    assert.strictEqual(second.status, 2, `second run should also exit 2; stderr: ${second.stderr}`);
    assert.ok(second.stderr.includes('BLOCKED'),
      `second run stderr should also contain BLOCKED (no dedup in block mode); stderr: ${second.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

run('pretool-branch-safety-dedup');
