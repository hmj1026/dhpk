'use strict';

// Observable subprocess coverage for pre-agent-warmstart.sh. The opt-out path
// emits an empty object before payload parsing and writes no files; it still
// reads project config while resolving the opt-in setting.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'pre-agent-warmstart.sh');

function withScratchProject(callback) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-paw-')));
  try {
    return callback(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function invoke(scratch, role, prompt = '') {
  const payload = JSON.stringify({ tool_input: { subagent_type: role, prompt } });
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_OPTION_AGENT_WARMSTART_ENABLED;
  delete env.DHPK_AGENT_WARMSTART;
  env.CLAUDE_PROJECT_DIR = scratch;
  env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE = 'standard';
  env.DHPK_AGENT_WARMSTART = '1';
  return spawnSync('bash', ['-c', 'printf %s "$1" | bash "$2"', '_', payload, HOOK], {
    cwd: scratch,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function parseOutput(res) {
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  return parsed.hookSpecificOutput.additionalContext;
}

function bodyOf(context) {
  const header = context.indexOf('\n', context.indexOf('[warmstart]'));
  const footer = context.lastIndexOf('\n</parent-session-context>');
  assert.ok(header >= 0 && footer > header, `unexpected context envelope: ${context}`);
  return context.slice(header + 1, footer);
}

function seedProjectContext(scratch) {
  fs.mkdirSync(path.join(scratch, 'openspec', 'changes', 'warmstart-demo'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'openspec', 'changes', 'warmstart-demo', 'tasks.md'), [
    '- [x] Confirm current behavior',
    '- [ ] Add observable role coverage',
    '- [ ] Verify the packet budget',
  ].join('\n') + '\n');
  fs.mkdirSync(path.join(scratch, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(scratch, '.claude', 'warmstart-context.md'), 'PROJECT_CONTEXT_SENTINEL '.repeat(80));
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('default opt-out returns exactly an empty JSON object for an unreadable payload', () => withScratchProject((scratch) => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: scratch, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard' };
  delete env.CLAUDE_PLUGIN_OPTION_AGENT_WARMSTART_ENABLED;
  delete env.DHPK_AGENT_WARMSTART;
  const res = spawnSync('bash', ['-c', 'printf %s "$1" | bash "$2"', '_', 'not-json', HOOK], {
    cwd: scratch,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout, '{}');
}));

test('reviewer output excludes handoff and project text and stays within 700 characters', () => withScratchProject((scratch) => {
  seedProjectContext(scratch);
  const context = parseOutput(invoke(scratch, 'code-reviewer', 'HANDOFF_SENTINEL '.repeat(200)));
  const body = bodyOf(context);
  assert.ok(body.length <= 700, `reviewer context exceeded 700 chars (${body.length})`);
  assert.ok(!context.includes('HANDOFF_SENTINEL'), 'reviewers do not receive the supplied handoff');
  assert.ok(!context.includes('PROJECT_CONTEXT_SENTINEL'), 'reviewers do not receive project warmstart text');
  assert.ok(!context.includes('OpenSpec active change:'), 'reviewers do not receive implementation change context');
}));

test('worker output includes task and handoff context and is capped at 1400 characters', () => withScratchProject((scratch) => {
  seedProjectContext(scratch);
  const context = parseOutput(invoke(scratch, 'worker', 'HANDOFF_SENTINEL '.repeat(200)));
  const body = bodyOf(context);
  assert.ok(body.includes('OpenSpec active change: openspec/changes/warmstart-demo'));
  assert.ok(body.includes('Tasks (first 3): - [x] Confirm current behavior'));
  assert.ok(context.includes('Handoff packet: HANDOFF_SENTINEL'));
  assert.strictEqual(body.length, 1400, `expected worker cap, got ${body.length}`);
  assert.ok(body.endsWith('...'), 'truncated worker packet should end with an ellipsis');
}));

test('explorer receives only its routing reminder within the 500-character budget', () => withScratchProject((scratch) => {
  seedProjectContext(scratch);
  const context = parseOutput(invoke(scratch, 'explorer', 'HANDOFF_SENTINEL '.repeat(200)));
  const body = bodyOf(context);
  assert.ok(body.includes('Tool routing: prefer semantic code tools'));
  assert.ok(body.length <= 500, `explorer context exceeded 500 chars (${body.length})`);
  assert.ok(!context.includes('HANDOFF_SENTINEL'));
  assert.ok(!context.includes('PROJECT_CONTEXT_SENTINEL'));
  assert.ok(!context.includes('OpenSpec active change:'));
}));

test('monitor receives process identity only within the 300-character budget', () => withScratchProject((scratch) => {
  seedProjectContext(scratch);
  const context = parseOutput(invoke(scratch, 'monitor', 'HANDOFF_SENTINEL '.repeat(200)));
  const body = bodyOf(context);
  assert.ok(body.includes('Agent role: monitor; preserve process identity and report state only'));
  assert.ok(body.length <= 300, `monitor context exceeded 300 chars (${body.length})`);
  assert.ok(!context.includes('HANDOFF_SENTINEL'));
  assert.ok(!context.includes('PROJECT_CONTEXT_SENTINEL'));
  assert.ok(!context.includes('OpenSpec active change:'));
}));

run('pre-agent-warmstart');
