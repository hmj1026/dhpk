'use strict';

// Coverage for pre-bash-dispatch.sh (PreToolUse Bash dispatcher): runs the
// core pre-bash-guard.sh first — any non-zero exit aborts the bash call
// immediately. With no active modules configured, the dispatcher's exit code
// mirrors the core guard exactly.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'pre-bash-dispatch.sh');

function runHook(command, cwd) {
  const payload = JSON.stringify({ tool_input: { command } });
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT };
  delete env.DHPK_ACTIVE_MODULES;
  delete env.CLAUDE_PLUGIN_OPTION_MODULES;
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = payload;
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd: cwd || ROOT,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('dangerous command (rm -rf /home) is blocked (exit 2), core guard bubbles up', () => {
  const res = runHook('rm -rf /home');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('safe command passes through (exit 0), no active modules', () => {
  const res = runHook('echo hello');
  assert.strictEqual(res.status, 0, `expected allowed, got: ${res.status} / ${res.stderr}`);
});

test('.env write via redirection is blocked (exit 2), core guard bubbles up', () => {
  const res = runHook('echo SECRET=x > .env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('deep workspace path under /home still passes through the dispatcher', () => {
  const res = runHook('rm -rf /home/paul/projects/x/y');
  assert.strictEqual(res.status, 0, `expected allowed, got: ${res.status} / ${res.stderr}`);
});

run('pre-bash-dispatch');
