'use strict';

// hookharness — shared scaffolding for exercising bash hook scripts end-to-end.
//
// Before this module, ~15 hook test files each carried their own copy of the
// same ~25-line scaffold: mkdtemp + git init, env scrubbing, the
// `printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"` spawn seam, and a
// try/finally rmSync teardown. The seam itself (DHPK_TEST_HOOK/PAYLOAD env
// indirection) is unchanged — only the consumer side is factored here.
//
// Determinism contract: runHook DELETES CLAUDE_PROJECT_DIR unless the caller
// passes `projectDir` explicitly. Hooks resolve their root env-first (see
// scripts/hooks/_lib/session-env.sh); with the env var absent they fall back
// to the git toplevel of `cwd` — the temp-repo behavior every existing test
// was written against, now independent of whatever environment the test
// runner itself inherits.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

// hookPath('stop-review-reminder.sh') → absolute path under scripts/hooks/.
function hookPath(name) {
  return path.join(ROOT, 'scripts', 'hooks', name);
}

// mkRepo() → realpath'd throwaway git repo. gitConfig adds user identity for
// tests that need to commit.
function mkRepo({ prefix = 'dhpk-hook-', gitConfig = false } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (gitConfig) {
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  }
  return dir;
}

function rmRepo(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// withRepo(fn) — mkRepo, run fn(dir), always clean up. Options forward to mkRepo.
function withRepo(fn, opts) {
  const dir = mkRepo(opts);
  try {
    return fn(dir);
  } finally {
    rmRepo(dir);
  }
}

// The session-state dir every sentinel/sidecar test touches.
function sessionsDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

// runHook(hook, opts) → spawnSync result ({ status, stdout, stderr, ... }).
//   hook       — basename under scripts/hooks/ or an absolute path
//   payload    — object (JSON-encoded) or string piped verbatim to stdin
//   cwd        — working dir for the hook (default: plugin ROOT)
//   env        — extra env vars merged last (highest precedence)
//   deleteEnv  — env var names to remove before merging `env`
//   pluginRoot — CLAUDE_PLUGIN_ROOT (default: plugin ROOT; null to unset)
//   projectDir — CLAUDE_PROJECT_DIR (default: DELETED; pass a path to pin)
//   profile    — CLAUDE_PLUGIN_OPTION_HOOK_PROFILE (default 'standard';
//                null to leave whatever the inherited env carries)
function runHook(
  hook,
  {
    payload = {},
    cwd = ROOT,
    env: envOverrides = {},
    deleteEnv = [],
    pluginRoot = ROOT,
    projectDir,
    profile = 'standard',
    timeout = 10000,
  } = {}
) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  for (const name of deleteEnv) delete env[name];
  if (pluginRoot === null) delete env.CLAUDE_PLUGIN_ROOT;
  else env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  if (projectDir !== undefined && projectDir !== null) env.CLAUDE_PROJECT_DIR = projectDir;
  if (profile !== null) env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE = profile;
  Object.assign(env, envOverrides);
  env.DHPK_TEST_HOOK = path.isAbsolute(hook) ? hook : hookPath(hook);
  env.DHPK_TEST_PAYLOAD = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
  });
}

module.exports = { ROOT, hookPath, mkRepo, rmRepo, withRepo, sessionsDir, runHook };
