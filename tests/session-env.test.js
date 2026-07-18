'use strict';

// Coverage for scripts/hooks/_lib/session-env.sh: the canonical project-root /
// sessions-dir / payload-read / active-marker resolution every hook sources,
// replacing the three divergent inline fallback chains that previously forced
// subagent-stop-verify.sh to distrust clear-sentinel.sh's root (double-clear).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'session-env.sh');

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function sh(cmd, { cwd, projectDir, input } = {}) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
  else env.CLAUDE_PROJECT_DIR = projectDir;
  return spawnSync('bash', ['-c', `set -euo pipefail; source "${LIB}"; ${cmd}`], {
    encoding: 'utf8',
    timeout: 10000,
    cwd: cwd || ROOT,
    env,
    input: input === undefined ? '' : input,
  });
}

test('dhpk_root prefers CLAUDE_PROJECT_DIR over git toplevel', () => {
  const project = tmpDir('dhpk-senv-proj-');
  // cwd is this repo (a git toplevel) — env must still win.
  const res = sh('dhpk_root', { projectDir: project });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, project);
});

test('dhpk_root falls back to git toplevel from a repo subdirectory', () => {
  const repo = tmpDir('dhpk-senv-repo-');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const sub = path.join(repo, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  const res = sh('dhpk_root', { cwd: sub });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, repo);
});

test('dhpk_root falls back to pwd outside any repo', () => {
  const dir = tmpDir('dhpk-senv-norepo-');
  const res = sh('dhpk_root', { cwd: dir });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, dir);
});

test('dhpk_sessions_dir appends the sessions path to an explicit root', () => {
  const res = sh('dhpk_sessions_dir /some/root', {});
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, '/some/root/.claude/artifacts/sessions');
});

test('dhpk_sessions_dir resolves the root itself when no arg is given', () => {
  const project = tmpDir('dhpk-senv-sess-');
  const res = sh('dhpk_sessions_dir', { projectDir: project });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, path.join(project, '.claude', 'artifacts', 'sessions'));
});

test('dhpk_read_payload echoes stdin and never fails', () => {
  const res = sh('PAYLOAD="$(dhpk_read_payload)"; printf "%s" "$PAYLOAD"', {
    input: '{"tool_input":{"file_path":"a.php"}}',
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, '{"tool_input":{"file_path":"a.php"}}');
});

test('dhpk_active_marker maps .pending-* basenames to .active-* companions', () => {
  const res = sh(
    'dhpk_active_marker .pending-review; echo; dhpk_active_marker .pending-db-review',
    {}
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const [a, b] = res.stdout.split('\n');
  assert.strictEqual(a, '.active-review');
  assert.strictEqual(b, '.active-db-review');
});

test('sidecar basename registry constants are defined', () => {
  const res = sh(
    'printf "%s\\n%s\\n%s\\n%s" ' +
      '"$DHPK_SIDECAR_UNRESOLVED_VERDICT" "$DHPK_SIDECAR_REVIEW_BACKOFF" ' +
      '"$DHPK_SIDECAR_MODULE_FINDINGS" "$DHPK_SIDECAR_FAST_WORKER_ACTIVE"',
    {}
  );
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.split('\n'), [
    '.unresolved-verdict',
    '.review-reminder-backoff',
    '.module-findings',
    '.active-fast-worker',
  ]);
});

test('sourcing is side-effect free and idempotent under set -euo pipefail', () => {
  const res = sh(`source "${LIB}"; echo ok`, {});
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'ok');
});

run('session-env');
