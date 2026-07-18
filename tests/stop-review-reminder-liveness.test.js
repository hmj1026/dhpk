'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  mkRepo,
  sessionsDir: sessDir,
  runHook: runHookRaw,
} = require('./_lib/hookharness');

const HOOK = 'stop-review-reminder.sh';

function mkTempRepo() {
  return mkRepo({ prefix: 'dhpk-stop-reminder-' });
}

function writeFile(repo, name, body) {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), name), body);
}

function runHook(repo, payload = {}, env = {}) {
  return runHookRaw(HOOK, {
    payload,
    cwd: repo,
    env,
    deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
  });
}

test('stale sentinel exposes exact manual-clear basename as triage-drop only', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-db-review', '2026-07-07 12:00 src/Repo.php\n');
    const stale = new Date(Date.now() - 61 * 60 * 1000);
    fs.utimesSync(path.join(sessDir(repo), '.pending-db-review'), stale, stale);
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('clear-sentinel.sh" .pending-db-review manual'),
      `manual clear command must use exact basename:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('clear-sentinel.sh" db manual'),
      `manual clear command must not use shorthand:\n${res.stderr}`);
    assert.ok(res.stderr.includes('triage-drop'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stop reminder reports matching active marker as in-flight work to wait for', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    writeFile(repo, '.active-doc-review', '1783440000 doc-reviewer\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] IN-FLIGHT: doc-reviewer'),
      `missing in-flight status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('wait for the existing doc-reviewer result'),
      `missing wait instruction:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('Recommended: invoke \'doc-reviewer\''),
      `must not suggest duplicate dispatch for in-flight reviewer:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stop reminder recommends one merged dispatch with every pending file and no fresh manual clear', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', [
      '2026-07-07 12:00 docs/Guide.md',
      '2026-07-07 12:01 docs/API.md',
      '2026-07-07 12:02 docs/Runbook.md',
      '2026-07-07 12:03 docs/Policy.md',
      '2026-07-07 12:04 docs/FAQ.md',
      '2026-07-07 12:05 docs/Sixth.md',
    ].join('\n') + '\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'),
      `missing existing pending status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('dispatch ONE \'doc-reviewer\' covering ALL 6 pending files'), res.stderr);
    assert.ok(res.stderr.includes('docs/Sixth.md'), `complete file list missing:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('Manual clear:'), `fresh sentinel advertised manual clear:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('third unchanged reminder escalates after two ignored reminders', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    const payload = { session_id: 'ignored' };
    const env = { DHPK_REVIEW_REMINDER_BACKOFF_SECONDS: '0' };
    runHook(repo, payload, env);
    runHook(repo, payload, env);
    const third = runHook(repo, payload, env);
    assert.strictEqual(third.status, 2, third.stderr);
    assert.ok(third.stderr.includes('ignored 2 times'), third.stderr);
    assert.ok(third.stderr.includes('dispatch before any further implementation work'), third.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('arm-on-dispatch marker is treated as owed review without a phantom file path', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '1783440000 arm-on-dispatch:doc-reviewer [arm-on-dispatch]\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'));
    assert.ok(!res.stderr.includes('    · [arm-on-dispatch]'), `marker leaked as file path:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('stop-review-reminder-liveness');
