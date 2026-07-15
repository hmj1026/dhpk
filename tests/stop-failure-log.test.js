'use strict';

// Coverage for stop-failure-log.sh (StopFailure hook, advisory only):
//   - No active sentinels → log line "active_sentinels=none".
//   - Active sentinel(s) present → log line lists them by name.
//   - Payload reason/message field is appended to the log line.
//   - minimal profile suppresses the stderr summary but still writes the log.
//   - Always exits 0.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  mkRepo: mkRepoRaw,
  sessionsDir: sessDir,
  runHook: runHookRaw,
} = require('./_lib/hookharness');

const HOOK = 'stop-failure-log.sh';

function mkRepo() {
  return mkRepoRaw({ prefix: 'dhpk-sfl-' });
}

function logPath(repo) {
  return path.join(repo, '.claude', 'artifacts', 'stop-failures.log');
}

function runHook(repo, payloadObj, extraEnv = {}) {
  return runHookRaw(HOOK, {
    payload: payloadObj || {},
    cwd: repo,
    projectDir: repo,
    env: extraEnv,
  });
}

test('no active sentinels → log line records active_sentinels=none', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, {});
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const log = fs.readFileSync(logPath(repo), 'utf8');
    assert.ok(log.includes('active_sentinels=none'), `expected "none" in log, got: ${log}`);
    assert.ok(res.stderr.includes('active_sentinels=none'), `expected stderr summary, got: ${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('active sentinel present → log line lists it by name', () => {
  const repo = mkRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    fs.writeFileSync(path.join(sessDir(repo), '.pending-review'), '2026-07-12 00:00:00 src/Foo.php\n');
    const res = runHook(repo, {});
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const log = fs.readFileSync(logPath(repo), 'utf8');
    assert.ok(log.includes('active_sentinels=.pending-review'), `expected sentinel name in log, got: ${log}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('payload reason field is appended to the log line', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, { reason: 'user cancelled' });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const log = fs.readFileSync(logPath(repo), 'utf8');
    assert.ok(log.includes('reason=user cancelled'), `expected reason in log, got: ${log}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('minimal profile suppresses stderr summary but still writes the log', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, {}, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.strictEqual(res.stderr.trim(), '', `expected no stderr in minimal profile, got: ${res.stderr}`);
    assert.ok(fs.existsSync(logPath(repo)), 'expected log file still written under minimal profile');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('stop-failure-log');
