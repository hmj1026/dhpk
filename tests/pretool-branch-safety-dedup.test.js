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

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'pretool-git-gate.sh');

function mkTempRepo() {
  // realpath: on macOS os.tmpdir() lives under a /var symlink to /private/var;
  // the hook derives ROOT via `git rev-parse --show-toplevel` which resolves
  // symlinks, so an unresolved path here could cause mismatches downstream.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bs-repo-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  // Ensure the branch is named 'main' (a default-protected branch) regardless
  // of the environment's init.defaultBranch setting.
  spawnSync('git', ['branch', '-M', 'main'], { cwd: dir });
  return dir;
}

function runHook(cwd, tmpdir, extraEnv) {
  const env = { ...process.env, TMPDIR: tmpdir, ...extraEnv };
  delete env.DHPK_BRANCH_SAFETY;
  delete env.CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES;
  Object.assign(env, extraEnv);
  const payload = JSON.stringify({
    session_id: 'testsess1',
    tool_input: { command: 'git commit -m x' },
  });
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = payload;
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 10000,
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

// D-mixed regression: when the sentinel-gate slot fires in one mode and the
// branch-safety slot fires in the other on the SAME command, the combined
// resolution must never silently drop a fired slot's detail. If either slot
// blocks, the single exit-2 stderr block must ALSO carry a labeled reminder
// for the other slot's warn-mode detail (design.md Decision (a) step 5:
// "single combined stderr message covering EVERY fired check").
function writeSentinel(repo) {
  const sessDir = path.join(repo, '.claude', 'artifacts', 'sessions');
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, '.pending-review'), '');
}

test('mixed mode: SENTINEL=warn + BRANCH=block surfaces both slots in exit-2 stderr', () => {
  const repo = mkTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bs-state-'));
  try {
    writeSentinel(repo);
    const result = runHook(repo, stateDir, {
      DHPK_SENTINEL_COMMIT_GATE: 'warn',
      DHPK_BRANCH_SAFETY: 'block',
    });
    assert.strictEqual(result.status, 2, `should exit 2; stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('BLOCKED [branch-safety]'),
      `stderr should contain the blocked branch-safety detail; stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('reminder [sentinel-gate]'),
      `stderr should ALSO contain the warn-fired sentinel-gate reminder (not dropped); stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('mixed mode: SENTINEL=block + BRANCH=warn surfaces both slots in exit-2 stderr', () => {
  const repo = mkTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bs-state-'));
  try {
    writeSentinel(repo);
    const result = runHook(repo, stateDir, {
      DHPK_SENTINEL_COMMIT_GATE: 'block',
      DHPK_BRANCH_SAFETY: 'warn',
    });
    assert.strictEqual(result.status, 2, `should exit 2; stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('BLOCKED [sentinel-gate]'),
      `stderr should contain the blocked sentinel-gate detail; stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('reminder [branch-safety]'),
      `stderr should ALSO contain the warn-fired branch-safety reminder (not dropped); stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

run('pretool-branch-safety-dedup');
