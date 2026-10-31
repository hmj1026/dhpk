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
    fs.writeFileSync(activeFile,
      'line1\tdhpk:fast-worker\nline2\tdhpk:fast-worker\nline3\tdhpk:codex-worker\n');

    const res = runHook(HOOK, { payload: { agent_type: 'dhpk:fast-worker' }, projectDir: repo });
    assert.strictEqual(res.status, 0, res.stderr);

    const remaining = fs.readFileSync(activeFile, 'utf8');
    const lines = remaining.trimEnd().split('\n');
    assert.deepStrictEqual(lines, ['line2\tdhpk:fast-worker', 'line3\tdhpk:codex-worker']);
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

// --- dispatch log (model/effort retrievable after the fact, zero context output) ---

const LOG_NAME = 'subagent-dispatch.jsonl';

function readLog(repo) {
  const file = path.join(sessionsDir(repo), LOG_NAME);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

function writeTranscript(dir, lines) {
  const file = path.join(dir, 'agent.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const assistant = (model) => JSON.stringify({ type: 'assistant', message: { model, content: [] } });

test('dispatch log records the LAST assistant model, tolerates malformed lines, emits nothing', () => {
  const repo = mkRepo();
  try {
    const transcript = writeTranscript(repo, [
      assistant('claude-haiku-4-5'),
      '{not json',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      assistant('claude-sonnet-5-5'),
      'also {{ broken',
    ]);
    const res = runHook(HOOK, {
      payload: { agent_type: 'dhpk:architect', agent_id: 'a1', agent_transcript_path: transcript, effort: 'high' },
      projectDir: repo,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
    assert.strictEqual(res.stderr, '');
    const recs = readLog(repo);
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].model, 'claude-sonnet-5-5');
    assert.strictEqual(recs[0].model_source, 'agent_transcript');
    assert.strictEqual(recs[0].agent_type, 'dhpk:architect');
    assert.strictEqual(recs[0].agent_id, 'a1');
    assert.strictEqual(recs[0].effort, 'high');
    assert.strictEqual(recs[0].effort_source, 'hook_input');
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(recs[0].ts), recs[0].ts);
  } finally {
    rmRepo(repo);
  }
});

test('dispatch log: missing transcript path yields model null and exit 0', () => {
  const repo = mkRepo();
  try {
    const res = runHook(HOOK, {
      payload: { agent_type: 'dhpk:architect', agent_id: 'a2', agent_transcript_path: path.join(repo, 'nope.jsonl') },
      projectDir: repo,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
    assert.strictEqual(res.stderr, '');
    const recs = readLog(repo);
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].model, null);
  } finally {
    rmRepo(repo);
  }
});

test('dispatch log: absent effort is null with null source', () => {
  const repo = mkRepo();
  try {
    runHook(HOOK, { payload: { agent_type: 'dhpk:architect', agent_id: 'a3' }, projectDir: repo });
    const [rec] = readLog(repo);
    assert.strictEqual(rec.effort, null);
    assert.strictEqual(rec.effort_source, null);
  } finally {
    rmRepo(repo);
  }
});

test('dispatch log: fast-worker logs and still removes its liveness entry', () => {
  const repo = mkRepo();
  try {
    const sess = sessionsDir(repo);
    fs.mkdirSync(sess, { recursive: true });
    const activeFile = path.join(sess, '.active-fast-worker');
    fs.writeFileSync(activeFile, 'l1\tdhpk:fast-worker\n');
    runHook(HOOK, { payload: { agent_type: 'dhpk:fast-worker', agent_id: 'w1' }, projectDir: repo });
    assert.ok(!fs.existsSync(activeFile));
    assert.strictEqual(readLog(repo).length, 1);
  } finally {
    rmRepo(repo);
  }
});

test('dispatch log rotates to .1 when larger than 1MB', () => {
  const repo = mkRepo();
  try {
    const sess = sessionsDir(repo);
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, LOG_NAME), 'x'.repeat(1100000) + '\n');
    runHook(HOOK, { payload: { agent_type: 'dhpk:architect', agent_id: 'r1' }, projectDir: repo });
    assert.ok(fs.existsSync(path.join(sess, LOG_NAME + '.1')));
    const recs = readLog(repo);
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].agent_id, 'r1');
  } finally {
    rmRepo(repo);
  }
});

run('subagent-stop-verify');
