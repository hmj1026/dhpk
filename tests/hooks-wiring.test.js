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

test('default lifecycle wiring is the three deterministic hook events only', () => {
  const parsed = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(parsed.hooks).sort(), [
    'PreToolUse', 'SessionStart', 'SubagentStop',
  ]);
  assert.strictEqual(parsed.hooks.PreToolUse.length, 2, 'only edit and Bash gates are default PreToolUse hooks');
  assert.strictEqual(parsed.hooks.SubagentStop.length, 1, 'only fast-worker liveness cleanup is default SubagentStop');
});

test('Edit|Write|MultiEdit wires only the protected-path guard', () => {
  const parsed = JSON.parse(raw);
  const edit = parsed.hooks.PreToolUse.find((entry) => entry.matcher === 'Edit|Write|MultiEdit');
  assert.ok(edit, 'missing edit PreToolUse entry');
  assert.deepStrictEqual(edit.hooks, [{
    type: 'command',
    command: 'bash',
    args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-edit-guard.sh'],
    timeout: 5,
  }]);
});

test('Bash and SubagentStop each wire one consolidated deterministic hook', () => {
  const parsed = JSON.parse(raw);
  const bash = parsed.hooks.PreToolUse.find((entry) => entry.matcher === 'Bash');
  assert.ok(bash, 'missing Bash PreToolUse entry');
  assert.deepStrictEqual(bash.hooks, [{
    type: 'command',
    command: 'bash',
    args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-bash-dispatch.sh'],
  }]);
  assert.deepStrictEqual(parsed.hooks.SubagentStop, [{
    hooks: [{
      type: 'command',
      command: 'bash',
      args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/subagent-stop-verify.sh'],
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

  test('default hook event manifest exactly matches hooks.json and documents opt-ins separately', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'default-events.json'), 'utf8'));
    assert.deepStrictEqual(defaults.events.slice().sort(), Object.keys(hooks.hooks).sort());
    assert.deepStrictEqual(defaults.events.slice().sort(), ['PreToolUse', 'SessionStart', 'SubagentStop']);
    assert.ok(defaults.optionalEvents.includes('UserPromptSubmit'));
    const docs = fs.readFileSync(path.join(ROOT, 'docs', 'hook-extension.md'), 'utf8');
    assert.match(docs, /default event manifest/i);
    assert.match(docs, /optional.*not.*registered|not.*registered.*optional/i);
  });
}


run('hooks-wiring');
