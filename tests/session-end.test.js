'use strict';

// Smoke coverage for session-end.sh (SessionEnd hook: teardown cleanup —
// opt-in orphaned gitnexus MCP process reap + stale sentinel sweep).
//   1. bash -n syntax check.
//   2. Default invocation (reap_stale_mcp_processes unset → false) against a
//      scratch project dir is a safe no-op with respect to the host: no
//      process is targeted (the pgrep branch is skipped entirely), and the
//      only filesystem effect is the sentinel sweep confined to the scratch
//      dir's own .claude/artifacts/sessions/.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'session-end.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('default invocation (reap_stale_mcp_processes off) exits 0, no host process reaping', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-se-')));
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: scratch };
    delete env.CLAUDE_PLUGIN_OPTION_REAP_STALE_MCP_PROCESSES;
    const res = spawnSync('bash', [HOOK], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stderr.includes('reaped'),
      `expected no mcp-process reap activity by default, got stderr: ${res.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('session-end');
