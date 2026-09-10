'use strict';

// Coverage for subagent-stop-verify.sh (SubagentStop hook).
//
// The Review Sentinel auto-clear/reviewer-verification machinery this hook
// used to run was retired with the rest of Sentinel (#376/#377). What
// remains: removing a stopped fast-worker's active-liveness marker so a
// finished worker no longer shows up as in-flight.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const HOOK = 'subagent-stop-verify.sh';

test('non-reviewer, non-fast-worker subagent is a silent no-op', () => {
  const repo = mkRepo();
  try {
    const res = runHook(HOOK, { payload: { agent_type: 'dhpk:architect' }, projectDir: repo });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '', `expected silent stdout, got: ${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('a stopped fast-worker removes its own active-liveness entry, leaving others', () => {
  const repo = mkRepo();
  try {
    const sess = sessionsDir(repo);
    fs.mkdirSync(sess, { recursive: true });
    const activeFile = path.join(sess, '.active-fast-worker');
    fs.writeFileSync(activeFile, 'line1\tdhpk:fast-worker\nline2\tdhpk:codex-worker\n');

    const res = runHook(HOOK, { payload: { agent_type: 'dhpk:fast-worker' }, projectDir: repo });
    assert.strictEqual(res.status, 0, res.stderr);

    const remaining = fs.readFileSync(activeFile, 'utf8');
    assert.ok(!remaining.includes('dhpk:fast-worker'), `expected the fast-worker entry removed, got: ${remaining}`);
    assert.ok(remaining.includes('dhpk:codex-worker'), `expected the unrelated entry to survive, got: ${remaining}`);
  } finally {
    rmRepo(repo);
  }
});

test('missing active-liveness file is a safe no-op', () => {
  const repo = mkRepo();
  try {
    const res = runHook(HOOK, { payload: { agent_type: 'dhpk:agy-worker' }, projectDir: repo });
    assert.strictEqual(res.status, 0, res.stderr);
  } finally {
    rmRepo(repo);
  }
});

run('subagent-stop-verify');
