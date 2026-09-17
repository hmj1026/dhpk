'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { dispatch } = require('../scripts/lib/dispatch');
const { createAdapterRegistry } = require('../scripts/lib/provider-adapter');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');

const catalog = require('../manifests/provider-model-catalog.json');
const profile = {
  schema: SCHEMAS.HOST_PROFILE, version: 'cursor-dispatch.v2', host: 'cursor', native_target_agent: 'cursor', native_provider: 'cursor', native_model: 'composer-2.5', native_transport: 'native-runtime',
  allowed_providers: ['cursor', 'openai'],
  access: {
    cursor: { status: 'AVAILABLE', evidence: 'Cursor native fixture' },
    openai: { status: 'AVAILABLE', evidence: 'Codex fixture' },
  },
  quota_pools: { cursor: 'native', openai: 'codex' }, concurrency_limits: { native: 1, codex: 1 }, observed_at: '2026-09-11T00:00:00.000Z',
};

function request(overrides = {}) {
  const input = {
    schema: SCHEMAS.REQUEST, host_profile: profile, task_id: 'dispatch-task', attempt_id: 'dispatch-attempt', role: 'reasoner', authority: 'read-only',
    task: { description_digest: 'a'.repeat(64) }, scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    effort: 'high', fallback: { allow: true, retry_budget: 1 }, parallelism: { dependencies: [], max_concurrency: 1 }, ...overrides,
  };
  if (input.target && Object.prototype.hasOwnProperty.call(input.target, 'route')) {
    const { route, ...target } = input.target;
    input.target = target;
  }
  return input;
}

test('dispatch resolves Cursor to Codex Sol5.6 and returns the shared receipt', async () => {
  const registry = createAdapterRegistry({ executors: {
    openai: (target) => ({ status: 'SUCCEEDED', verification: 'PASSED', side_effects: 'none', receipt_id: `receipt-${target.identity}` }),
  } });
  const result = await dispatch(request({ target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' } }), { catalog, registry, fallback: false });
  assert.strictEqual(result.status, 'SUCCEEDED');
  assert.strictEqual(result.receipt.schema, SCHEMAS.RECEIPT);
  assert.strictEqual(result.receipt.host, 'cursor');
  assert.strictEqual(result.receipt.resolved_target.identity, 'codex-cli/gpt-5.6-sol-high');
  assert.strictEqual(result.receipt.requested_role, 'reasoner');
  assert.strictEqual(result.receipt.verification, 'PASSED');
});

test('dispatch falls back from unavailable Codex to Cursor native only before side effects', async () => {
  const unavailable = {
    ...profile,
    access: { ...profile.access, openai: { status: 'UNAVAILABLE', evidence: 'missing executable: codex' } },
  };
  const registry = createAdapterRegistry({ executors: {
    cursor: (target) => ({ status: 'SUCCEEDED', verification: 'PASSED', receipt_id: `receipt-${target.identity}` }),
  } });
  const result = await dispatch(request({ host_profile: unavailable, role: 'worker', authority: 'workspace-write', effort: 'high', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' } }), { catalog, registry });
  assert.strictEqual(result.status, 'SUCCEEDED');
  assert.strictEqual(result.fallback.status, 'FALLBACK');
  assert.strictEqual(result.receipt.resolved_target.identity, 'cursor/composer-2.5');
  assert.strictEqual(result.fallback.fallback_history[0].provider, 'openai');
});

test('dispatch returns a blocked receipt when capability evidence is NOT_RUN', async () => {
  const notRun = { ...profile, access: { ...profile.access, openai: { status: 'NOT_RUN', evidence: 'probe not run' } } };
  const registry = createAdapterRegistry({ executors: { openai: () => ({ status: 'SUCCEEDED' }) } });
  const result = await dispatch(request({ host_profile: notRun, target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' } }), { catalog, registry, fallback: false });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.receipt.status, 'BLOCKED');
  assert.strictEqual(result.receipt.failure_class, 'CAPABILITY_PROBE_NOT_RUN');
  assert.strictEqual(result.receipt.resolved_target.identity, 'codex-cli/gpt-5.6-sol-high');
});

test('dispatch does not reinterpret an unsupported target as an unavailable CLI', async () => {
  const registry = createAdapterRegistry({ executors: {
    cursor: () => ({ status: 'SUCCEEDED' }),
    google: () => ({ status: 'SUCCEEDED' }),
  } });
  const result = await dispatch(request({
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'unknown-model', route: 'headless-cli', transport: 'local-cli' },
  }), { catalog, registry });

  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.fallback, undefined);
  assert.strictEqual(result.resolution.status, 'UNAVAILABLE');
  assert.strictEqual(result.resolution.fallback_eligible, false);
  assert.strictEqual(result.receipt.failure_class, 'CAPABILITY_UNAVAILABLE');
});

run('dispatch');
