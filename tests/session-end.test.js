'use strict';

// Smoke coverage for session-end.sh (SessionEnd hook: teardown cleanup —
// opt-in orphaned gitnexus MCP process reap).
//   1. bash -n syntax check.
//   2. Default invocation (reap_stale_mcp_processes unset → false) against a
//      scratch project dir is a safe no-op with respect to the host: no
//      process is targeted (the pgrep branch is skipped entirely).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'session-end.sh');

function sessionEndHarness({ enabled = false } = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-se-')));
  const bin = path.join(scratch, 'bin');
  const pgrepLog = path.join(scratch, 'pgrep.log');
  const psLog = path.join(scratch, 'ps.log');
  const killLog = path.join(scratch, 'kill.log');
  const bashEnv = path.join(scratch, 'bash-env.sh');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'pgrep'), [
    '#!/bin/sh',
    'printf "called\\n" >> "$DHPK_PGREP_LOG"',
    'printf "987654321\\n987654322\\n"',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ps'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$DHPK_PS_LOG"',
    'case "$*" in',
    '  "-o ppid= -p 987654321") printf "1\\n" ;;',
    '  "-o ppid= -p 987654322") printf "987654323\\n" ;;',
    '  "-p 987654323") exit 0 ;;',
    '  *) exit 1 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(bashEnv, [
    'kill() {',
    '  printf "%s\\n" "$*" >> "$DHPK_KILL_LOG"',
    '  return 0',
    '}',
  ].join('\n') + '\n');
  const env = {
    ...process.env,
    BASH_ENV: bashEnv,
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PROJECT_DIR: scratch,
    DHPK_PGREP_LOG: pgrepLog,
    DHPK_PS_LOG: psLog,
    DHPK_KILL_LOG: killLog,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
  };
  delete env.CLAUDE_PLUGIN_OPTION_REAP_STALE_MCP_PROCESSES;
  if (enabled) env.CLAUDE_PLUGIN_OPTION_REAP_STALE_MCP_PROCESSES = 'true';
  const result = spawnSync('/bin/bash', [HOOK], {
    cwd: scratch,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  return { result, scratch, pgrepLog, psLog, killLog };
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('default invocation skips process discovery and reaping', () => {
  const { result, scratch, pgrepLog, psLog, killLog } = sessionEndHarness();
  try {
    assert.strictEqual(result.status, 0, `expected exit 0: ${result.stderr}`);
    assert.strictEqual(fs.existsSync(pgrepLog), false, 'default-off must skip pgrep');
    assert.strictEqual(fs.existsSync(psLog), false, 'default-off must skip ps');
    assert.strictEqual(fs.existsSync(killLog), false, 'default-off must not kill candidates');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('opt-in reaps orphan candidates and preserves candidates with a live parent', () => {
  const { result, scratch, pgrepLog, psLog, killLog } = sessionEndHarness({ enabled: true });
  try {
    assert.strictEqual(result.status, 0, `expected exit 0: ${result.stderr}`);
    assert.strictEqual(fs.readFileSync(pgrepLog, 'utf8'), 'called\n');
    assert.deepStrictEqual(fs.readFileSync(psLog, 'utf8').trim().split('\n').sort(), [
      '-o ppid= -p 987654321',
      '-o ppid= -p 987654322',
      '-p 987654323',
    ].sort());
    assert.strictEqual(fs.readFileSync(killLog, 'utf8'), '987654321\n');
    assert.ok(result.stderr.includes('[session-end] reaped 1 orphaned gitnexus mcp processes'), result.stderr);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('session-end');
