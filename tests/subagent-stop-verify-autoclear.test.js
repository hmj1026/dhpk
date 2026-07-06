'use strict';

// Regression: subagent-stop-verify.sh Case B must AUTO-CLEAR a reviewer's own
// sentinel when that reviewer subagent stops successfully with the sentinel
// still armed. Reviewers spawned via the Agent/Task tool do not reliably run
// their own closing clear-sentinel.sh, leaving a stale sentinel that falsely
// blocks the opsx-apply-goal end-gate. Case B was warn-only; it now clears
// (scoped strictly to the reviewer's own slot) then warns. Case A (a FAILED
// reviewer) must still leave the sentinel armed so the chain re-fires.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'subagent-stop-verify.sh');

function mkTempRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sv-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}
function armSentinel(repo, name) {
  const d = sessDir(repo);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), '2026-07-06 12:00 src/Foo.php\n');
}
function sentinelExists(repo, name) {
  return fs.existsSync(path.join(sessDir(repo), name));
}

function runHook(repo, payload, { pluginRoot = ROOT, cwd = repo } = {}) {
  const env = { ...process.env };
  delete env.DHPK_ACTIVE_MODULES;
  delete env.CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS; // force default slot mapping
  env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE = 'standard'; // ensure advisory messages emit
  env.CLAUDE_PROJECT_DIR = repo; // pin the hook's ROOT to this temp repo
  if (pluginRoot === null) delete env.CLAUDE_PLUGIN_ROOT;
  else env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  return spawnSync('bash', [HOOK], {
    cwd, // clear-sentinel.sh derives ITS root from cwd's git-toplevel
    input: JSON.stringify(payload),
    env,
    encoding: 'utf8',
  });
}

test('reviewer stop with armed sentinel → auto-cleared via clear-sentinel.sh (primary path)', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was NOT auto-cleared on the reviewer\'s behalf');
    assert.ok(res.stdout.includes('AUTO-CLEARED'),
      `expected AUTO-CLEARED systemMessage, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rm -f fallback when CLAUDE_PLUGIN_ROOT unset → still cleared', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 }, { pluginRoot: null });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was NOT cleared via the rm -f fallback');
    assert.ok(res.stdout.includes('AUTO-CLEARED'),
      `expected AUTO-CLEARED systemMessage, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('scoping: frontend-reviewer stop clears ONLY its slot, not code-reviewer\'s', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'frontend-reviewer\'s own sentinel was not cleared');
    assert.ok(sentinelExists(repo, '.pending-review'),
      'code-reviewer\'s .pending-review was wrongly cleared by a frontend-reviewer stop');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Case A unchanged: a FAILED reviewer (exit!=0) keeps its sentinel armed', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 1 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was wrongly cleared for a FAILED reviewer (Case A must keep it armed)');
    assert.ok(res.stdout.includes('SUBAGENT FAILURE'),
      `expected SUBAGENT FAILURE systemMessage, got stdout:\n${res.stdout}`);
    assert.ok(!res.stdout.includes('AUTO-CLEARED'), 'must not report AUTO-CLEARED on failure');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('unrecognized / absent subagent name → sentinel untouched (schema-drift safety)', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    // Non-reviewer name (not in SENTINEL_AGENTS) → SLOT=-1 → exits before Case B.
    const res1 = runHook(repo, { subagent_type: 'general-purpose', exit_status: 0 });
    assert.strictEqual(res1.status, 0, `hook exited non-zero: ${res1.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'sentinel wrongly cleared for a non-reviewer subagent');
    assert.ok(!res1.stdout.includes('AUTO-CLEARED'));
    // Absent subagent name (payload schema drift) → same silent exit.
    const res2 = runHook(repo, { exit_status: 0 });
    assert.strictEqual(res2.status, 0, `hook exited non-zero: ${res2.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'sentinel wrongly cleared when subagent name absent');
    assert.ok(!res2.stdout.includes('AUTO-CLEARED'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('guaranteed removal when CLAUDE_PROJECT_DIR diverges from cwd git-toplevel', () => {
  // The hook detects the sentinel under CLAUDE_PROJECT_DIR (repoA), but
  // clear-sentinel.sh resolves ITS root from the cwd's git-toplevel (repoB).
  // clear-sentinel.sh no-ops ("already clean") on repoB and exits 0, so the
  // hook must still guarantee removal of the exact file it flagged in repoA —
  // otherwise AUTO-CLEARED would be a false report.
  const repoA = mkTempRepo();
  const repoB = mkTempRepo();
  try {
    armSentinel(repoA, '.pending-frontend-review');
    const res = runHook(repoA, { subagent_type: 'frontend-reviewer', exit_status: 0 }, { cwd: repoB });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repoA, '.pending-frontend-review'),
      'sentinel under CLAUDE_PROJECT_DIR was NOT removed when clear-sentinel.sh resolved a different root');
    assert.ok(res.stdout.includes('AUTO-CLEARED'),
      `expected AUTO-CLEARED, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

run('subagent-stop-verify-autoclear');
