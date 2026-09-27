'use strict';

// Coverage for scripts/hooks/_lib/json-out.sh: json_escape, emit_system_message,
// emit_additional_context.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'json-out.sh');

function sh(cmd) {
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000 });
}

test('json_escape wraps a plain string in quotes', () => {
  const res = sh('json_escape "hello"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), '"hello"');
});

test('json_escape correctly escapes quotes and newlines', () => {
  const res = sh('json_escape $\'line1"\\nline2\'');
  assert.strictEqual(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout.trim());
  assert.strictEqual(parsed, 'line1"\nline2');
});

test('emit_system_message prints valid JSON with systemMessage key', () => {
  const res = sh('emit_system_message "hello world"');
  assert.strictEqual(res.status, 0, res.stderr);
  const obj = JSON.parse(res.stdout.trim());
  assert.strictEqual(obj.systemMessage, 'hello world');
});

test('emit_system_message is a no-op on empty text', () => {
  const res = sh('emit_system_message ""; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
});

test('emit_additional_context prints hookSpecificOutput with event name and context', () => {
  const res = sh('emit_additional_context "PreToolUse" "some context"');
  assert.strictEqual(res.status, 0, res.stderr);
  const obj = JSON.parse(res.stdout.trim());
  assert.strictEqual(obj.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(obj.hookSpecificOutput.additionalContext, 'some context');
});

test('emit_additional_context is a no-op on empty context (edge case)', () => {
  const res = sh('emit_additional_context "PreToolUse" ""; echo "OUT:[$?]"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'OUT:[0]');
});

test('json_escape emits valid JSON through the manual fallback without python3 or jq', () => {
  const input = 'quote " slash \\\nline';
  const res = spawnSync('/bin/bash', ['-c', 'source "$DHPK_JSON_OUT_LIB"; json_escape "$DHPK_JSON_OUT_INPUT"'], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: '/dhpk-test-path-without-python-or-jq',
      DHPK_JSON_OUT_LIB: LIB,
      DHPK_JSON_OUT_INPUT: input,
    },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout.trim()), input);
});

run('json-out');
