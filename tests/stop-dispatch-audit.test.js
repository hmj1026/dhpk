'use strict';

// stop-dispatch-audit.sh — the post-hoc fast-worker dispatch-mandate audit sourced
// by stop-advisory-dispatch.sh (Advisory 3). Covers issue #80: when orchestration_dispatch is on and a
// session edited >=3 distinct source files inline (the pre-edit batch gate having
// been overridden), Stop surfaces the violation instead of leaving it for a later
// manual audit.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook, sessionsDir } = require('./_lib/hookharness');

const HOOK = 'stop-advisory-dispatch.sh';
const SIG = 'should have been ONE fast-worker batch'; // stable substring of the advisory

function writeCounter(repo, sessionId, files) {
  const sess = sessionsDir(repo);
  fs.mkdirSync(sess, { recursive: true });
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  fs.writeFileSync(path.join(sess, `.edit-batch-${safe}.files`), files.map((f) => `${f}\n`).join(''));
}

function runStop(repo, sessionId, dispatch) {
  return runHook(HOOK, {
    projectDir: repo,
    payload: { session_id: sessionId },
    env: { DHPK_ORCHESTRATION_DISPATCH: dispatch },
  });
}

test('orchestration_dispatch=on with >=3 inline files surfaces the dispatch-mandate advisory', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-on', ['src/A.php', 'src/B.php', 'src/C.php']);
    const res = runStop(repo, 'audit-on', 'on');
    assert.strictEqual(res.status, 0, `stop-dispatch must never block Stop; stderr:\n${res.stderr}`);
    assert.ok(res.stdout.includes(SIG) && res.stdout.includes('#80'),
      `expected the dispatch-audit advisory, got stdout:\n${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('orchestration_dispatch=off stays silent even with many inline files', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-off', ['src/A.php', 'src/B.php', 'src/C.php', 'src/D.php']);
    const res = runStop(repo, 'audit-off', 'off');
    assert.ok(!res.stdout.includes(SIG), `advisory must not fire when dispatch mode is off:\n${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('fewer than 3 distinct inline files stays silent even under orchestration_dispatch=on', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-two', ['src/A.php', 'src/B.php']);
    const res = runStop(repo, 'audit-two', 'on');
    assert.ok(!res.stdout.includes(SIG), `advisory must not fire below the 3-file threshold:\n${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('the advisory fires at most once per session even across multiple Stop turns', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-once', ['src/A.php', 'src/B.php', 'src/C.php']);
    const first = runStop(repo, 'audit-once', 'on');
    assert.ok(first.stdout.includes(SIG), `first Stop should fire the advisory:\n${first.stdout}`);
    const second = runStop(repo, 'audit-once', 'on');
    assert.ok(!second.stdout.includes(SIG),
      `a later Stop turn in the same session must NOT re-emit the advisory:\n${second.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

run('stop-dispatch-audit');
