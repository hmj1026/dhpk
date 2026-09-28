'use strict';

// Coverage for scripts/hooks/_lib/session-env.sh: the canonical project-root /
// sessions-dir / payload-read resolution every hook sources, replacing three
// divergent inline fallback chains.

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

function sh(cmd, { cwd, projectDir, input, sourceLib = true, extraEnv = {} } = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
  else env.CLAUDE_PROJECT_DIR = projectDir;
  const source = sourceLib ? `source "${LIB}"; ` : '';
  return spawnSync('/bin/bash', ['-c', `set -euo pipefail; ${source}${cmd}`], {
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

test('sidecar basename registry constants are defined', () => {
  const res = sh(
    'printf "%s\\n%s" "$DHPK_SIDECAR_MODULE_FINDINGS" "$DHPK_SIDECAR_FAST_WORKER_ACTIVE"',
    {}
  );
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.split('\n'), [
    '.module-findings',
    '.active-fast-worker',
  ]);
});

test('sourcing twice leaves exported environment and project files unchanged', () => {
  const scratch = tmpDir('dhpk-senv-source-');
  try {
    const res = sh([
      'before_env="$(export -p)"',
      'before_files="$(find . -mindepth 1 -print | LC_ALL=C sort)"',
      'before_pwd="$PWD"',
      `source "${LIB}"`,
      `source "${LIB}"`,
      'after_env="$(export -p)"',
      'after_files="$(find . -mindepth 1 -print | LC_ALL=C sort)"',
      'test "$before_env" = "$after_env"',
      'test "$before_files" = "$after_files"',
      'test "$before_pwd" = "$PWD"',
      'test "$DHPK_SIDECAR_MODULE_FINDINGS" = ".module-findings"',
      'test "$DHPK_SIDECAR_FAST_WORKER_ACTIVE" = ".active-fast-worker"',
      'printf ok',
    ].join('; '), { cwd: scratch, projectDir: scratch, sourceLib: false });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, 'ok');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('current session identity prefers the canonical value, falls back, and stays empty when absent', () => {
  const canonical = sh('dhpk_current_session_id', {
    extraEnv: { CLAUDE_CODE_SESSION_ID: 'canonical-session', CLAUDE_SESSION_ID: 'legacy-session' },
  });
  assert.strictEqual(canonical.status, 0, canonical.stderr);
  assert.strictEqual(canonical.stdout, 'canonical-session');

  const fallback = sh('dhpk_current_session_id', {
    extraEnv: { CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: 'legacy-session' },
  });
  assert.strictEqual(fallback.status, 0, fallback.stderr);
  assert.strictEqual(fallback.stdout, 'legacy-session');

  const empty = sh('dhpk_current_session_id', {
    extraEnv: { CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '' },
  });
  assert.strictEqual(empty.status, 0, empty.stderr);
  assert.strictEqual(empty.stdout, '');
});

run('session-env');
