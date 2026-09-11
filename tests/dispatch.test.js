'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { dispatch } = require('../scripts/lib/dispatch');
const { createAdapterRegistry } = require('../scripts/lib/provider-adapter');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');

const catalog = require('../manifests/provider-model-catalog.json');
const profile = {
  schema: SCHEMAS.HOST_PROFILE, version: 'cursor-dispatch.v1', host: 'cursor', native_provider: 'cursor-native', native_model: 'cursor-default', native_transport: 'native-runtime',
  allowed_providers: ['cursor-native', 'codex-cli'],
  access: {
    'cursor-native': { status: 'AVAILABLE', evidence: 'Cursor native fixture' },
    'codex-cli': { status: 'AVAILABLE', evidence: 'Codex fixture' },
  },
  quota_pools: { 'cursor-native': 'native', 'codex-cli': 'codex' }, concurrency_limits: { native: 1, codex: 1 }, observed_at: '2026-09-11T00:00:00.000Z',
};

function request(overrides = {}) {
  return {
    schema: SCHEMAS.REQUEST, host_profile: profile, task_id: 'dispatch-task', attempt_id: 'dispatch-attempt', role: 'reasoner', authority: 'read-only',
    task: { description_digest: 'a'.repeat(64) }, scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    effort: 'high', fallback: { allow: true, retry_budget: 1 }, parallelism: { dependencies: [], max_concurrency: 1 }, ...overrides,
  };
}

test('dispatch resolves Cursor to Codex Sol5.6 and returns the shared receipt', async () => {
  const registry = createAdapterRegistry({ executors: {
    'codex-cli': (target) => ({ status: 'SUCCEEDED', verification: 'PASSED', side_effects: 'none', receipt_id: `receipt-${target.identity}` }),
  } });
  const result = await dispatch(request({ target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }), { catalog, registry, fallback: false });
  assert.strictEqual(result.status, 'SUCCEEDED');
  assert.strictEqual(result.receipt.schema, SCHEMAS.RECEIPT);
  assert.strictEqual(result.receipt.host, 'cursor');
  assert.strictEqual(result.receipt.resolved_target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(result.receipt.requested_role, 'reasoner');
  assert.strictEqual(result.receipt.verification, 'PASSED');
});

test('dispatch falls back from unavailable Codex to Cursor native only before side effects', async () => {
  const unavailable = {
    ...profile,
    access: { ...profile.access, 'codex-cli': { status: 'UNAVAILABLE', evidence: 'missing executable: codex' } },
  };
  const registry = createAdapterRegistry({ executors: {
    'cursor-native': (target) => ({ status: 'SUCCEEDED', verification: 'PASSED', receipt_id: `receipt-${target.identity}` }),
  } });
  const result = await dispatch(request({ host_profile: unavailable, target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }), { catalog, registry });
  assert.strictEqual(result.status, 'SUCCEEDED');
  assert.strictEqual(result.fallback.status, 'FALLBACK');
  assert.strictEqual(result.receipt.resolved_target.identity, 'cursor-native/cursor-default');
  assert.strictEqual(result.fallback.fallback_history[0].provider, 'codex-cli');
});

test('dispatch returns a blocked receipt when capability evidence is NOT_RUN', async () => {
  const notRun = { ...profile, access: { ...profile.access, 'codex-cli': { status: 'NOT_RUN', evidence: 'probe not run' } } };
  const registry = createAdapterRegistry({ executors: { 'codex-cli': () => ({ status: 'SUCCEEDED' }) } });
  const result = await dispatch(request({ host_profile: notRun, target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }), { catalog, registry, fallback: false });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.receipt.status, 'BLOCKED');
  assert.strictEqual(result.receipt.failure_class, 'CAPABILITY_PROBE_NOT_RUN');
  assert.strictEqual(result.receipt.resolved_target.identity, 'codex-cli/sol5.6');
});

test('dispatch does not reinterpret an unsupported target as an unavailable CLI', async () => {
  const registry = createAdapterRegistry({ executors: {
    'cursor-native': () => ({ status: 'SUCCEEDED' }),
    agy: () => ({ status: 'SUCCEEDED' }),
  } });
  const result = await dispatch(request({
    target: { provider: 'codex-cli', model: 'unknown-model', transport: 'local-cli' },
  }), { catalog, registry });

  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.fallback, undefined);
  assert.strictEqual(result.resolution.status, 'UNAVAILABLE');
  assert.strictEqual(result.resolution.fallback_eligible, false);
  assert.strictEqual(result.receipt.failure_class, 'CAPABILITY_UNAVAILABLE');
});

run('dispatch');
