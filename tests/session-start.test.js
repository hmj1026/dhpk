'use strict';

// Smoke coverage for session-start.sh (SessionStart hook: artifacts dir
// bootstrap, session snapshot, docker/module/orchestration advisories).
//   1. bash -n syntax check.
//   2. Safe invocation against a scratch git repo (isolated via
//      CLAUDE_PROJECT_DIR) with no docker containers / modules configured —
//      a provable no-op with respect to the HOST: no docker calls (unset
//      CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS short-circuits before any
//      `docker ps`), no module activation, no network. All writes land only
//      inside the scratch dir's own .claude/artifacts/.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('safe invocation against a scratch repo exits 0 and writes only into scratch/.claude/artifacts', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ss-')));
  spawnSync('git', ['init', '-q'], { cwd: scratch });
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: scratch };
    delete env.CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS;
    delete env.CLAUDE_PLUGIN_OPTION_MODULES;
    const payload = JSON.stringify({ source: 'startup' });
    const res = spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', HOOK], {
      cwd: scratch,
      env: { ...env, P: payload },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('[session-start]'), `expected session-start banner, got: ${res.stdout}`);
    const snapshot = path.join(scratch, '.claude', 'artifacts', 'sessions', 'latest.md');
    assert.ok(fs.existsSync(snapshot), 'expected session snapshot file written into scratch dir');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('session-start');
