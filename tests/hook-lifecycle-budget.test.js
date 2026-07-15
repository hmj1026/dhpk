'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'stop-review-reminder.sh');

function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-hook-budget-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function session(dir) {
  return path.join(dir, '.claude', 'artifacts', 'sessions');
}

function runHook(dir, payload = {}) {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard',
    DHPK_TEST_HOOK: HOOK,
    DHPK_TEST_PAYLOAD: JSON.stringify(payload),
  };
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
}

function runHookWithEnv(dir, payload, overrides) {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard',
    DHPK_TEST_HOOK: HOOK,
    DHPK_TEST_PAYLOAD: JSON.stringify(payload),
    ...overrides,
  };
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
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
    fs.rmSync(dir, { recursive: true, force: true });
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('hook-lifecycle-budget');
