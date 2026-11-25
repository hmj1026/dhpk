'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

function edit(cwd) {
  return payload({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd });
}

test('project block mode pauses editing while default advisory does not', () => {
  const stateDir = fixtureDir();
  const cwd = fixtureDir();
  try {
    const fixture = payload({ cwd });
    diagnostics.processEvent(fixture, { stateDir });
    diagnostics.processEvent(fixture, { stateDir });
    assert.strictEqual(diagnostics.processEvent(edit(cwd), { stateDir }).message, null);

    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(path.join(cwd, '.claude/settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { validation_failure_mode: 'block' } } },
    }));
    diagnostics.processEvent(fixture, { stateDir });
    const read = diagnostics.processEvent(payload({
      hook_event_name: 'PreToolUse', tool_name: 'Read', cwd,
    }), { stateDir });
    assert.strictEqual(read.message, null);
    assert.strictEqual(diagnostics.processEvent(edit(cwd), { stateDir })
      .message.hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('an actual owned recovery command checks the observation and clears the matching latch', () => {
  const stateDir = fixtureDir();
  const cwd = fixtureDir();
  try {
    const base = { stateDir, mode: 'block' };
    const failed = payload({ cwd });
    diagnostics.processEvent(failed, base);
    diagnostics.processEvent(payload({ cwd, error: 'Exit code 1\nsecond case' }), base);
    diagnostics.processEvent(payload({
      cwd, hook_event_name: 'PostToolUse', tool_input: { command: 'git status --short' },
    }), base);
    diagnostics.processEvent(payload({
      cwd, tool_input: { command: 'npm run lint' },
    }), base);
    diagnostics.processEvent(payload({ cwd, hook_event_name: 'PostToolUse' }), base);
    assert.strictEqual(diagnostics.processEvent(edit(cwd), base).record.latch.target, 'npm:test');

    const script = path.join(__dirname, '..', 'scripts/hooks/validation-diagnostics.js');
    const args = {
      target: 'npm:test', premise: 'The runner selects the wrong config', file: 'package.json',
      observation: 'jest --config jest.old.config.js', proposed_change: 'Use the current config',
      rerun_plan: 'npm test',
    };
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: args.observation } }));
    const bad = spawnSync(process.execPath, [script, 'recover', JSON.stringify({ ...args, observation: 'unobserved' })], { cwd });
    assert.notStrictEqual(bad.status, 0);
    const raw = JSON.stringify(args);
    const recovered = spawnSync(process.execPath, [script, 'recover', raw], { cwd, encoding: 'utf8' });
    assert.strictEqual(recovered.status, 0, recovered.stderr);
    const event = payload({
      cwd, hook_event_name: 'PostToolUse',
      tool_input: { command: "node '" + script + "' recover '" + raw + "'" },
      tool_response: { stdout: recovered.stdout, exit_code: 0 },
    });
    diagnostics.processEvent({ ...event, tool_response: { stdout: '{}' } }, base);
    assert.ok(diagnostics.processEvent(edit(cwd), base).message);
    const result = diagnostics.processEvent(event, base);
    assert.strictEqual(result.record.recoveryEvidence.target, 'npm:test');
    assert.strictEqual(diagnostics.processEvent(edit(cwd), base).message, null);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('three identical failures require escalation, including after a target switch', () => {
  const stateDir = fixtureDir();
  try {
    const base = { stateDir, mode: 'block' };
    diagnostics.processEvent(payload(), base);
    diagnostics.processEvent(payload(), base);
    const stopped = diagnostics.processEvent(payload(), base);
    assert.strictEqual(stopped.record.latch.stopped, true);
    diagnostics.processEvent(payload({ tool_input: { command: 'npm run lint' } }), base);
    assert.strictEqual(diagnostics.processEvent(edit(process.cwd()), base).record.latch.stopped, true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

run('validation-diagnostics');
