'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const HOOK = 'pre-edit-batch-gate.sh';

function edit(repo, filePath, { session = 'batch', env = {}, payload = {} } = {}) {
  return runHook(HOOK, {
    cwd: repo,
    projectDir: repo,
    payload: { session_id: session, tool_input: { file_path: filePath }, ...payload },
    env,
  });
}

test('warns on third distinct file, ignores duplicates, and blocks fourth only in dispatch mode', () => {
  const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
  try {
    const env = { DHPK_ORCHESTRATION_DISPATCH: 'on' };
    assert.strictEqual(edit(repo, 'src/a.js', { env }).status, 0);
    assert.strictEqual(edit(repo, 'src/a.js', { env }).status, 0);
    assert.strictEqual(edit(repo, 'src/b.js', { env }).status, 0);
    const third = edit(repo, 'src/c.js', { env });
    assert.strictEqual(third.status, 0, third.stderr);
    assert.ok(third.stderr.includes('WARN') && third.stderr.includes('3-file'), third.stderr);
    const fourth = edit(repo, 'src/d.js', { env });
    assert.strictEqual(fourth.status, 2, fourth.stderr);
    assert.ok(fourth.stderr.includes('fast-worker'), fourth.stderr);
  } finally { rmRepo(repo); }
});

test('fourth distinct file remains advisory outside dispatch mode', () => {
  const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
  try {
    for (const name of ['a', 'b', 'c', 'd']) {
      assert.strictEqual(edit(repo, `src/${name}.js`, { session: 'plain' }).status, 0);
    }
  } finally { rmRepo(repo); }
});

test('explicit acceptance and live fast-worker marker bypass without advancing count', () => {
  const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
  try {
    const env = { DHPK_ORCHESTRATION_DISPATCH: 'on' };
    for (const name of ['a', 'b', 'c']) edit(repo, `src/${name}.js`, { env });
    assert.strictEqual(edit(repo, 'src/inline.js', { env: { ...env, DHPK_INLINE_BATCH_OK: '1' } }).status, 0);
    fs.mkdirSync(sessionsDir(repo), { recursive: true });
    const active = path.join(sessionsDir(repo), '.active-fast-worker');
    fs.writeFileSync(active, `${Math.floor(Date.now() / 1000)} fast-worker pid=1\n`);
    assert.strictEqual(edit(repo, 'src/worker.js', { env }).status, 0);
    fs.rmSync(active);
    assert.strictEqual(edit(repo, 'src/d.js', { env }).status, 2,
      'bypassed edits must not enter the distinct-file counter');
  } finally { rmRepo(repo); }
});

test('bookkeeping and out-of-project paths do not count', () => {
  const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
  try {
    const env = { DHPK_ORCHESTRATION_DISPATCH: 'on' };
    for (const file of ['openspec/changes/x/proposal.md', '.claude/artifacts/a.md', 'tasks.md', '/tmp/outside.js']) {
      assert.strictEqual(edit(repo, file, { env }).status, 0);
    }
    for (const name of ['a', 'b', 'c']) assert.strictEqual(edit(repo, `src/${name}.js`, { env }).status, 0);
    assert.strictEqual(edit(repo, 'src/d.js', { env }).status, 2);
  } finally { rmRepo(repo); }
});

test('malformed payload and unwritable sidecar location fail open', () => {
  const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
  try {
    const malformed = runHook(HOOK, { cwd: repo, projectDir: repo, payload: '{bad' });
    assert.strictEqual(malformed.status, 0, malformed.stderr);
    fs.mkdirSync(path.join(repo, '.claude', 'artifacts'), { recursive: true });
    fs.writeFileSync(sessionsDir(repo), 'not a directory');
    const failedState = edit(repo, 'src/a.js', { env: { DHPK_ORCHESTRATION_DISPATCH: 'on' } });
    assert.strictEqual(failedState.status, 0, failedState.stderr);
  } finally { rmRepo(repo); }
});

run('pre-edit-batch-gate');
