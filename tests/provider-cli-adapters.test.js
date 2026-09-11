'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { buildInvocation, createCliAdapter } = require('../scripts/lib/provider-cli-adapters');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');

const request = {
  schema: SCHEMAS.REQUEST,
  host_profile: {
    schema: SCHEMAS.HOST_PROFILE, version: 'cursor.v1', host: 'cursor', native_provider: 'cursor-native', native_model: 'cursor-default', native_transport: 'native-runtime',
    allowed_providers: ['cursor-native', 'codex-cli', 'agy'],
    access: {
      'cursor-native': { status: 'AVAILABLE', evidence: 'native fixture' },
      'codex-cli': { status: 'AVAILABLE', evidence: 'codex fixture' },
      agy: { status: 'AVAILABLE', evidence: 'agy fixture' },
    },
    quota_pools: { 'cursor-native': 'cursor', 'codex-cli': 'codex', agy: 'agy' }, concurrency_limits: { cursor: 1, codex: 1, agy: 1 }, observed_at: '2026-09-11T00:00:00.000Z',
  },
  task_id: 'adapter-command-task', attempt_id: 'adapter-command-attempt', role: 'reasoner', authority: 'read-only',
  task: { description_digest: 'a'.repeat(64) }, scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
  effort: 'high', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 1 },
};

test('Codex CLI adapter keeps canonical effort and exact bounded argv shape', () => {
  const invocation = buildInvocation({ provider: 'codex-cli', model: 'sol5.6', effort: 'high', transport: 'local-cli' }, request);
  assert.strictEqual(invocation.executable, 'codex');
  assert.deepStrictEqual(invocation.argv, [
    'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--cd', '/workspace',
    '-m', 'sol5.6', '-c', 'model_reasoning_effort=high', '--output-last-message', '{transport_output}', '-',
  ]);
  assert.strictEqual(invocation.stdin_mode, 'prompt');
});

test('AGY adapter uses its own confirmation transport and never emits Codex output placeholders', () => {
  const invocation = buildInvocation({ provider: 'agy', model: 'gemini-3.8-flash-high', effort: 'high', transport: 'local-cli' }, { ...request, role: 'worker', authority: 'workspace-write' });
  assert.strictEqual(invocation.executable, 'agy');
  assert.strictEqual(invocation.stdin_mode, 'agy-confirmation');
  assert.ok(invocation.argv.includes('Gemini 3.8 Flash (High)'));
  assert.ok(!invocation.argv.includes('{transport_output}'));
});

test('Claude Code and Cursor native adapters remain explicit target adapters', () => {
  const claude = buildInvocation({ provider: 'claude-code', model: 'opus5', effort: 'high', transport: 'local-cli' }, request);
  assert.strictEqual(claude.executable, 'claude');
  assert.ok(claude.argv.includes('opus5'));
  const native = buildInvocation({ provider: 'cursor-native', model: 'cursor-default', effort: 'high', transport: 'native-runtime' }, request);
  assert.strictEqual(native.executable, null);
  assert.deepStrictEqual(native.argv, []);
});

test('CLI adapter callback receives only its resolved target and invocation', () => {
  let callback;
  const adapter = createCliAdapter({ provider: 'codex-cli', version: 'codex-adapter.v2', execute(target, normalizedRequest, invocation) {
    callback = { target, normalizedRequest, invocation };
    return { status: 'SUCCEEDED' };
  } });
  const result = adapter.execute({ provider: 'codex-cli', model: 'sol5.6', effort: 'high', transport: 'local-cli' }, request);
  assert.strictEqual(result.status, 'SUCCEEDED');
  assert.strictEqual(callback.target.provider, 'codex-cli');
  assert.strictEqual(callback.invocation.executable, 'codex');
  assert.strictEqual(callback.normalizedRequest.role, 'reasoner');
});

run('provider-cli-adapters');
