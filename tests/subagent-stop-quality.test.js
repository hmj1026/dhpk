'use strict';

// subagent-stop-quality.sh — default-OFF SubagentStop quality gate that
// blocks-and-continues a subagent whose final report is thin, a bare
// approval, an unresolved error with no risk/next-step language, or an
// evidence-free review-shaped report. Wired BEFORE subagent-stop-verify.sh
// in hooks.json so a no-op reply never auto-clears a reviewer's sentinel.
//
// Each test points CLAUDE_PROJECT_DIR at a per-test tmp dir so the hook's
// state/counter writes (.claude/artifacts/sessions/.subagent-stop-quality-*)
// never touch this repo's tracked tree.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'subagent-stop-quality.sh';

// >=120 chars, contains error/failed but no risk/uncertain/recommend/next/because.
const ERROR_TEXT = 'The migration script encountered an error while trying to '
  + 'update the schema and the failed step needs further investigation before '
  + 'proceeding to production.';

// >=120 chars, contains review/audit but no file/symbol/command/test/evidence
// reference (no path, extension, colon+number, backticks, or those nouns).
const REVIEW_TEXT = 'I completed a thorough review of the authentication module '
  + 'and audited the overall design for correctness and consistency across the '
  + 'codebase in general terms.';

function mkTempProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ssq-'));
}

function runHook(payload, extraEnv = {}, deleteEnv = []) {
  return runHookRaw(HOOK, {
    payload,
    env: extraEnv,
    deleteEnv,
  });
}

function assertBlocked(res, label) {
  assert.strictEqual(res.status, 0, `${label}: hook exited non-zero: ${res.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout.trim());
  } catch (e) {
    assert.fail(`${label}: stdout was not valid JSON: ${res.stdout}`);
  }
  assert.strictEqual(parsed.decision, 'block', `${label}: expected block decision, got: ${res.stdout}`);
  assert.ok(typeof parsed.reason === 'string' && parsed.reason.length > 0,
    `${label}: expected a non-empty reason string`);
}

function assertSilent(res, label) {
  assert.strictEqual(res.status, 0, `${label}: hook exited non-zero: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `${label}: expected silent stdout, got: ${res.stdout}`);
}

test('thin reviewer report (<120 chars) blocks', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', last_assistant_message: 'Fixed the bug.' },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertBlocked(res, 'thin report');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bare approval (lgtm) blocks', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', last_assistant_message: 'lgtm' },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertBlocked(res, 'bare approval');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unresolved-error mention with no next-step/recommendation word blocks', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', last_assistant_message: ERROR_TEXT },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertBlocked(res, 'unresolved error');
    const parsed = JSON.parse(res.stdout.trim());
    assert.ok(parsed.reason.includes('unresolved error'),
      `expected unresolved-error reason text, got: ${parsed.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence-free review-shaped report blocks', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', last_assistant_message: REVIEW_TEXT },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertBlocked(res, 'evidence-free review');
    const parsed = JSON.parse(res.stdout.trim());
    assert.ok(parsed.reason.includes('lacks file, symbol, command, or evidence references'),
      `expected evidence-free reason text, got: ${parsed.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mechanical worker reports are outside the reviewer-only quality gate', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:fast-worker', last_assistant_message: 'Fixed the bug.' },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertSilent(res, 'mechanical worker must bypass reviewer-only quality gate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scope-key dedup: same report twice → second invocation is silent', () => {
  const dir = mkTempProjectDir();
  try {
    const env = { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir };
    const payload = {
      agent_type: 'dhpk:code-reviewer',
      session_id: 'dedup-session',
      last_assistant_message: 'Fixed the bug.',
    };
    const first = runHook(payload, env);
    assertBlocked(first, 'dedup first call');

    const second = runHook(payload, env);
    assertSilent(second, 'dedup second call (same report)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a new reviewer dispatch in the same session gets its own bounded retry', () => {
  const dir = mkTempProjectDir();
  try {
    const env = { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir };
    const first = runHook({
      agent_type: 'dhpk:code-reviewer',
      session_id: 'multi-wave-session',
      agent_id: 'review-dispatch-1',
      last_assistant_message: 'Thin first wave.',
    }, env);
    const second = runHook({
      agent_type: 'dhpk:code-reviewer',
      session_id: 'multi-wave-session',
      agent_id: 'review-dispatch-2',
      last_assistant_message: 'Thin second wave.',
    }, env);
    assertBlocked(first, 'first review dispatch');
    assertBlocked(second, 'second review dispatch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop_hook_active:true → no block', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', stop_hook_active: true, last_assistant_message: 'Fixed the bug.' },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertSilent(res, 'stop_hook_active:true');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subagent_stop_hook_active:true → no block', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      {
        agent_type: 'dhpk:code-reviewer',
        subagent_stop_hook_active: true,
        last_assistant_message: 'Fixed the bug.',
      },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertSilent(res, 'subagent_stop_hook_active:true');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing text and no transcript path → silent exit 0, no block', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer' },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertSilent(res, 'missing text, no transcript');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unreadable transcript path → silent, no false block', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', transcript_path: '/nonexistent/path/does-not-exist.jsonl' },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE: 'on', CLAUDE_PROJECT_DIR: dir },
    );
    assertSilent(res, 'unreadable transcript path');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gate OFF (env unset) → no block even on a thin report', () => {
  const dir = mkTempProjectDir();
  try {
    const res = runHook(
      { agent_type: 'dhpk:code-reviewer', last_assistant_message: 'Fixed the bug.' },
      { CLAUDE_PROJECT_DIR: dir },
      ['CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE'],
    );
    assertSilent(res, 'gate off');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('subagent-stop-quality');
