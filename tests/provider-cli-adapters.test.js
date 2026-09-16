'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { buildInvocation, createCliAdapter } = require('../scripts/lib/provider-cli-adapters');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');

const request = {
  schema: SCHEMAS.REQUEST,
  host_profile: {
    schema: SCHEMAS.HOST_PROFILE, version: 'cursor.v2', host: 'cursor', native_target_agent: 'cursor', native_provider: 'cursor', native_model: 'composer-2.5', native_transport: 'native-runtime',
    allowed_providers: ['cursor', 'openai', 'google', 'anthropic'],
    access: {
      cursor: { status: 'AVAILABLE', evidence: 'native fixture' },
      openai: { status: 'AVAILABLE', evidence: 'codex fixture' },
      google: { status: 'AVAILABLE', evidence: 'agy fixture' },
      anthropic: { status: 'AVAILABLE', evidence: 'claude fixture' },
    },
    quota_pools: { cursor: 'cursor', openai: 'codex', google: 'agy', anthropic: 'claude' }, concurrency_limits: { cursor: 1, codex: 1, agy: 1, claude: 1 }, observed_at: '2026-09-11T00:00:00.000Z',
  },
  task_id: 'adapter-command-task', attempt_id: 'adapter-command-attempt', role: 'reasoner', authority: 'read-only',
  task: { description_digest: 'a'.repeat(64) }, scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
  effort: 'high', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 1 },
};

test('Codex CLI adapter keeps canonical effort and exact bounded argv shape', () => {
  const invocation = buildInvocation({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
  assert.strictEqual(invocation.executable, 'codex');
  assert.deepStrictEqual(invocation.argv, [
    'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--cd', '/workspace',
    '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high', '--output-last-message', '{transport_output}', '-',
  ]);
  assert.strictEqual(invocation.stdin_mode, 'prompt');
});

test('AGY adapter uses its own confirmation transport and never emits Codex output placeholders', () => {
  const invocation = buildInvocation({ target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, { ...request, role: 'worker', authority: 'workspace-write' });
  assert.strictEqual(invocation.executable, 'agy');
  assert.strictEqual(invocation.stdin_mode, 'agy-confirmation');
  assert.ok(invocation.argv.includes('Gemini 3.8 Flash (High)'));
  assert.ok(!invocation.argv.includes('{transport_output}'));
});

test('Claude Code and Cursor native adapters remain explicit target adapters', () => {
  const claude = buildInvocation({ target_agent: 'claude-code', provider: 'anthropic', model_id: 'opus5', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
  assert.strictEqual(claude.executable, 'claude');
  assert.deepStrictEqual(claude.argv, ['--print', '--model', 'opus5', '--effort', 'high', '--output-format', 'json']);
  assert.strictEqual(claude.stdin_mode, 'prompt');
  assert.ok(!claude.argv.includes('--prompt-file'));
  const native = buildInvocation({ target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'medium', route: 'native', transport: 'native-runtime' }, request);
  assert.strictEqual(native.executable, null);
  assert.deepStrictEqual(native.argv, []);
});

test('native Host routes do not become a vendor CLI when the target Agent differs', () => {
  const cursorAnthropic = buildInvocation({
    target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-thinking-high',
    effort: 'high', route: 'native', transport: 'native-runtime',
  }, request);
  assert.strictEqual(cursorAnthropic.executable, null);
  assert.deepStrictEqual(cursorAnthropic.argv, []);
  assert.strictEqual(cursorAnthropic.stdin_mode, 'native');
  assert.strictEqual(cursorAnthropic.output, 'native-result');
});

test('CLI adapter callback receives only its resolved target and invocation', () => {
  let callback;
  const adapter = createCliAdapter({ provider: 'openai', version: 'codex-adapter.v2', execute(target, normalizedRequest, invocation) {
    callback = { target, normalizedRequest, invocation };
    return { status: 'SUCCEEDED' };
  } });
  const result = adapter.execute({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
  assert.strictEqual(result.status, 'SUCCEEDED');
  assert.strictEqual(callback.target.provider, 'openai');
  assert.strictEqual(callback.invocation.executable, 'codex');
  assert.strictEqual(callback.normalizedRequest.role, 'reasoner');
});

run('provider-cli-adapters');
