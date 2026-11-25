'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const diagnostics = require('../scripts/hooks/validation-diagnostics');

function fixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validation-diagnostics-'));
}

function payload(overrides = {}) {
  return {
    hook_event_name: 'PostToolUseFailure',
    session_id: 'session-a',
    cwd: process.cwd(),
    agent_id: 'agent-a',
    tool_name: 'Bash',
    tool_input: { command: 'npm test -- --runInBand case-a' },
    error: 'Exit code 1\nfailed case',
    ...overrides,
  };
}

test('same session, project, subagent and target advises only on the second failure', () => {
  const stateDir = fixtureDir();
  const first = diagnostics.processEvent(payload(), { stateDir });
  const second = diagnostics.processEvent(payload({
    tool_input: { command: 'npm test -- --runInBand case-b' },
  }), { stateDir });

  assert.strictEqual(first.message, null);
  assert.ok(second.message && second.message.systemMessage.includes('read-only'));
  assert.strictEqual(second.record.failures, 2);
});

test('success resets failures and target changes start at one', () => {
  const stateDir = fixtureDir();
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload(), { stateDir });
  const success = diagnostics.processEvent(payload({
    hook_event_name: 'PostToolUse',
    error: undefined,
    tool_response: { exit_code: 0 },
  }), { stateDir });
  const changed = diagnostics.processEvent(payload({
    tool_input: { command: 'npx eslint src/app.js' },
  }), { stateDir });

  assert.strictEqual(success.record.failures, 0);
  assert.strictEqual(changed.record.failures, 1);
  assert.strictEqual(changed.message, null);
});

test('session, project and subagent state are isolated', () => {
  const stateDir = fixtureDir();
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload(), { stateDir });
  const other = diagnostics.processEvent(payload({
    session_id: 'session-b', agent_id: 'agent-b', cwd: fixtureDir(),
  }), { stateDir });
  assert.strictEqual(other.record.failures, 1);
  assert.strictEqual(other.message, null);
});

test('subagent stop removes only that subagent state', () => {
  const stateDir = fixtureDir();
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload({ agent_id: 'agent-b' }), { stateDir });
  const stopped = diagnostics.processEvent(payload({
    hook_event_name: 'SubagentStop',
    agent_id: 'agent-a',
    tool_input: undefined,
  }), { stateDir });
  const surviving = diagnostics.processEvent(payload({ agent_id: 'agent-b' }), { stateDir });

  assert.strictEqual(stopped.record.cleaned, true);
  assert.strictEqual(surviving.record.failures, 2);
  assert.ok(surviving.message);
});

test('non-validation commands are ignored', () => {
  const result = diagnostics.processEvent(payload({
    tool_input: { command: 'git status --short' },
  }), { stateDir: fixtureDir() });
  assert.strictEqual(result.record.ignored, true);
  assert.strictEqual(result.message, null);
});

test('classifier rejects shell composition and quoted false positives', () => {
  for (const command of [
    'echo "npm test"',
    'npm test && echo done',
    'printf npm test > report.txt',
    'git log --oneline',
  ]) {
    assert.strictEqual(diagnostics.deriveValidationTarget({ tool_input: { command } }), null, command);
  }
});

test('script names remain distinct while case selectors do not split the target', () => {
  assert.strictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'npm run test:api -- case-a' } }), 'npm:test:api');
  assert.strictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'npm run test:api -- case-b' } }), 'npm:test:api');
  assert.notStrictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'npm run test:web' } }), 'npm:test:api');
});

test('interrupted or missing-session failures are ignored', () => {
  const stateDir = fixtureDir();
  assert.strictEqual(diagnostics.processEvent(payload({ is_interrupt: true }), { stateDir }).record.ignored, true);
  assert.strictEqual(diagnostics.processEvent(payload({ session_id: undefined }), { stateDir }).record.ignored, true);
  diagnostics.processEvent(payload(), { stateDir });
  assert.strictEqual(diagnostics.processEvent(payload({ error: 'Could not start process' }), { stateDir }).record.ignored, true);
  assert.strictEqual(diagnostics.processEvent(payload(), { stateDir }).record.failures, 2);
});

run('validation-diagnostics');
