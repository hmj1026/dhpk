'use strict';

// Every shell script referenced from hooks/hooks.json must exist and be
// executable — a missing or non-executable hook script fails silently at
// runtime, which is exactly the class of breakage this test guards.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');

// Collect ${CLAUDE_PLUGIN_ROOT}-relative .sh references from the hook commands.
const refs = [...raw.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+?\.sh)/g)].map((m) => m[1]);

test('hooks.json is valid JSON with a hooks key', () => {
  const parsed = JSON.parse(raw);
  assert.ok(parsed.hooks, 'missing hooks key');
});

test('hooks.json references at least one script', () => {
  assert.ok(refs.length > 0, 'no ${CLAUDE_PLUGIN_ROOT}/...sh references found');
});

test('every referenced hook script exists', () => {
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `missing hook script: ${ref}`);
  }
});

test('every referenced hook script is executable', () => {
  for (const ref of refs) {
    const fp = path.join(ROOT, ref);
    if (!fs.existsSync(fp)) continue; // existence covered above
    const mode = fs.statSync(fp).mode;
    assert.ok(mode & 0o111, `not executable: ${ref}`);
  }
});

test('default lifecycle wiring includes native validation events and deterministic gates', () => {
  const parsed = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(parsed.hooks).sort(), [
    'PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionStart', 'SubagentStop',
  ]);
  assert.strictEqual(parsed.hooks.PreToolUse.length, 2, 'only edit and Bash gates are default PreToolUse hooks');
  assert.strictEqual(parsed.hooks.SubagentStop.length, 1, 'only cleanup is default SubagentStop');
});

test('PostToolUse and PostToolUseFailure wire the validation diagnostics seam', () => {
  const parsed = JSON.parse(raw);
  for (const event of ['PostToolUse', 'PostToolUseFailure']) {
    assert.deepStrictEqual(parsed.hooks[event], [{
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validation-diagnostics.js'],
      }],
    }]);
  }
});

test('Edit|Write|MultiEdit wires diagnostics before the protected-path guard', () => {
  const parsed = JSON.parse(raw);
  const edit = parsed.hooks.PreToolUse.find((entry) => entry.matcher === 'Edit|Write|MultiEdit');
  assert.ok(edit, 'missing edit PreToolUse entry');
  assert.deepStrictEqual(edit.hooks, [{
    type: 'command',
    command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validation-diagnostics.js'],
    onFailure: 'block',
  }, {
    type: 'command',
    command: 'bash',
    args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-edit-guard.sh'],
    timeout: 5,
    onFailure: 'block',
  }]);
});

test('Bash safety and both SubagentStop cleanup handlers are wired', () => {
  const parsed = JSON.parse(raw);
  const bash = parsed.hooks.PreToolUse.find((entry) => entry.matcher === 'Bash');
  assert.ok(bash, 'missing Bash PreToolUse entry');
  assert.deepStrictEqual(bash.hooks, [{
    type: 'command',
    command: 'bash',
    args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-bash-dispatch.sh'],
    timeout: 1800,
    onFailure: 'block',
  }]);
  assert.deepStrictEqual(parsed.hooks.SubagentStop, [{
    hooks: [{
      type: 'command',
      command: 'bash',
      args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/subagent-stop-verify.sh'],
    }, {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validation-diagnostics.js'],
    }],
  }]);
});

test('SessionStart wires only module activation', () => {
  const parsed = JSON.parse(raw);
  assert.deepStrictEqual(parsed.hooks.SessionStart, [{
    hooks: [{
      type: 'command',
      command: 'bash',
      args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/session-start.sh'],
      timeout: 20,
    }],
  }]);
});

// Consolidated source suite: default-hook-events.
{

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  test('default hook event manifest matches hooks.json and declares optional events', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'default-events.json'), 'utf8'));
    assert.deepStrictEqual(defaults.events.slice().sort(), Object.keys(hooks.hooks).sort());
    assert.deepStrictEqual(defaults.events.slice().sort(), [
      'PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionStart', 'SubagentStop',
    ]);
    assert.ok(defaults.optionalEvents.includes('UserPromptSubmit'));
  });
}


run('hooks-wiring');
