'use strict';

// Smoke coverage for pre-agent-warmstart.sh (PreToolUse Task|Agent hook).
// Opt-in (userConfig.agent_warmstart_enabled, default false) — the default
// path is a provable no-op: prints "{}" and exits 0 without reading the
// payload contents or touching the filesystem.
//   1. bash -n syntax check.
//   2. Default (opt-out) invocation → exit 0, stdout is exactly "{}".

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'pre-agent-warmstart.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('default (opt-out) invocation is a safe no-op: prints "{}" and exits 0', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-paw-')));
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: scratch };
    delete env.CLAUDE_PLUGIN_OPTION_AGENT_WARMSTART_ENABLED;
    delete env.DHPK_AGENT_WARMSTART;
    const res = spawnSync('bash', ['-c', 'printf %s "{}" | bash "$1"', '_', HOOK], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.strictEqual(res.stdout, '{}', `expected exactly "{}", got: ${res.stdout}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('pre-agent-warmstart');
