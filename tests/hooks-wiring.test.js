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

test('Task|Agent PreToolUse hooks include reviewer liveness marker before subagent work returns', () => {
  const parsed = JSON.parse(raw);
  const taskAgent = parsed.hooks.PreToolUse.find((entry) => entry.matcher === 'Task|Agent');
  assert.ok(taskAgent, 'missing Task|Agent PreToolUse matcher');
  const args = taskAgent.hooks.flatMap((hook) => hook.args || []);
  assert.ok(args.some((arg) => arg.includes('scripts/hooks/pre-agent-liveness-mark.sh')),
    'Task|Agent PreToolUse must wire pre-agent-liveness-mark.sh');
});

test('Edit|Write|MultiEdit wires the batch gate with an explicit timeout', () => {
  const parsed = JSON.parse(raw);
  const edit = parsed.hooks.PreToolUse.find((entry) => entry.matcher === 'Edit|Write|MultiEdit');
  const gate = edit.hooks.find((hook) => (hook.args || []).some((arg) => arg.includes('pre-edit-batch-gate.sh')));
  assert.ok(gate, 'missing pre-edit-batch-gate.sh');
  assert.strictEqual(gate.timeout, 5);
});

test('SubagentStop wires subagent-stop-quality.sh before subagent-stop-verify.sh', () => {
  const parsed = JSON.parse(raw);
  const subagentStopArgs = (parsed.hooks.SubagentStop || [])
    .flatMap((entry) => entry.hooks || [])
    .flatMap((hook) => hook.args || []);
  const qualityIdx = subagentStopArgs.findIndex((arg) => arg.includes('scripts/hooks/subagent-stop-quality.sh'));
  const verifyIdx = subagentStopArgs.findIndex((arg) => arg.includes('scripts/hooks/subagent-stop-verify.sh'));
  assert.ok(qualityIdx !== -1, 'missing subagent-stop-quality.sh in SubagentStop');
  assert.ok(verifyIdx !== -1, 'missing subagent-stop-verify.sh in SubagentStop');
  assert.ok(qualityIdx < verifyIdx,
    'subagent-stop-quality.sh must be wired BEFORE subagent-stop-verify.sh (block-before-auto-clear)');
});

run('hooks-wiring');
