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

function runHook(repo) {
  return runHookRaw(HOOK, {
    payload: {},
    cwd: repo,
    deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
  });
}

test('Stop reminder prints exact sentinel basename in manual clear command', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-db-review', '2026-07-07 12:00 src/Repo.php\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('clear-sentinel.sh" .pending-db-review manual'),
      `manual clear command must use exact basename:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('clear-sentinel.sh" db manual'),
      `manual clear command must not use shorthand:\n${res.stderr}`);
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

test('Stop reminder keeps existing idle-pending guidance when no active marker exists', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'),
      `missing existing pending status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('Recommended: invoke \'doc-reviewer\''),
      `missing existing invoke guidance:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('stop-review-reminder-liveness');
