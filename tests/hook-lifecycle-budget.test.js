'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT, mkRepo, rmRepo, sessionsDir, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'stop-review-reminder.sh';

const repo = () => mkRepo({ prefix: 'dhpk-hook-budget-' });
const session = sessionsDir;

function runHook(dir, payload = {}) {
  return runHookRaw(HOOK, { cwd: dir, payload });
}

function runHookWithEnv(dir, payload, overrides) {
  return runHookRaw(HOOK, { cwd: dir, payload, env: overrides });
}

test('unchanged pending state is debounced across Stop turns and state changes re-notify', () => {
  const dir = repo();
  try {
    fs.mkdirSync(session(dir), { recursive: true });
    const pending = path.join(session(dir), '.pending-doc-review');
    fs.writeFileSync(pending, 'one\n');
    const first = runHook(dir, { session_id: 'budget', stop_hook_active: false });
    const second = runHook(dir, { session_id: 'budget', stop_hook_active: false });
    assert.strictEqual(first.status, 2, first.stderr);
    assert.strictEqual(second.status, 0, `second reminder was not debounced:\n${second.stderr}`);
    fs.writeFileSync(pending, 'two\n');
    const changed = runHook(dir, { session_id: 'budget', stop_hook_active: false });
    assert.strictEqual(changed.status, 2, `changed sentinel did not re-notify:\n${changed.stderr}`);
  } finally {
    rmRepo(dir);
  }
});

test('hook lifecycle policy classifies gates and keeps quality advisory reviewer-scoped', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8');
  const hooks = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');
  for (const token of ['blocking safety gate', 'sentinel/liveness gate', 'lifecycle bookkeeping', 'opt-in advisory']) {
    assert.ok(policy.includes(token), `missing lifecycle class: ${token}`);
  }
  assert.ok(policy.includes('subagent_quality_gate') && policy.includes('reviewer sentinels'));
  assert.ok(hooks.includes('subagent-stop-quality.sh'));
});

test('unchanged pending state re-notifies after the configured backoff expires', () => {
  const dir = repo();
  try {
    fs.mkdirSync(session(dir), { recursive: true });
    fs.writeFileSync(path.join(session(dir), '.pending-doc-review'), 'one\n');
    const payload = { session_id: 'expiry', stop_hook_active: false };
    const first = runHookWithEnv(dir, payload, { DHPK_REVIEW_REMINDER_BACKOFF_SECONDS: '0' });
    const expired = runHookWithEnv(dir, payload, { DHPK_REVIEW_REMINDER_BACKOFF_SECONDS: '0' });
    assert.strictEqual(first.status, 2, first.stderr);
    assert.strictEqual(expired.status, 2, `expired reminder did not re-notify:\n${expired.stderr}`);
  } finally {
    rmRepo(dir);
  }
});

run('hook-lifecycle-budget');
