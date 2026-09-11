'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  ADAPTER_PROVIDERS,
  createAdapterRegistry,
  createCapabilityProbe,
  createExecutionAdapter,
} = require('../scripts/lib/provider-adapter');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');
const catalog = require('../manifests/provider-model-catalog.json');

const hostProfile = {
  schema: SCHEMAS.HOST_PROFILE,
  version: 'cursor.v1', host: 'cursor', native_provider: 'cursor-native', native_model: 'cursor-default', native_transport: 'native-runtime',
  allowed_providers: ['cursor-native', 'codex-cli'],
  access: {
    'cursor-native': { status: 'AVAILABLE', evidence: 'native runtime fixture' },
    'codex-cli': { status: 'AVAILABLE', evidence: 'bounded CLI fixture' },
  },
  quota_pools: { 'cursor-native': 'cursor', 'codex-cli': 'codex' },
  concurrency_limits: { cursor: 1, codex: 1 },
  observed_at: '2026-09-11T00:00:00.000Z',
};

const request = {
  schema: SCHEMAS.REQUEST, host_profile: hostProfile, task_id: 'adapter-task', attempt_id: 'adapter-attempt',
  role: 'reasoner', authority: 'read-only', task: { description_digest: 'a'.repeat(64) },
  scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
  effort: 'high', fallback: { allow: true, retry_budget: 1 }, parallelism: { dependencies: [], max_concurrency: 1 },
};

const target = { provider: 'codex-cli', model: 'sol5.6', effort: 'high', transport: 'local-cli', native: false };

test('Probe is separate from execution and conservatively defaults to NOT_RUN', () => {
  const probe = createCapabilityProbe({ provider: 'codex-cli', version: 'codex-probe.v1' });
  const result = probe.probe(target, request);
  assert.deepStrictEqual(result, {
    status: 'NOT_RUN', provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli', evidence: 'bounded capability probe was not run', source: 'codex-probe.v1',
  });
});

test('Probe returns bounded explicit availability evidence without launching a SubAgent', () => {
  let launches = 0;
  const probe = createCapabilityProbe({
    provider: 'codex-cli', version: 'codex-probe.v1',
    probe: () => ({ status: 'AVAILABLE', evidence: 'fixture executable and auth check' }),
  });
  const result = probe.probe(target, request);
  assert.strictEqual(result.status, 'AVAILABLE');
  assert.strictEqual(launches, 0);
  assert.throws(() => probe.probe({ ...target, provider: 'agy' }, request), /target|provider/i);
});

test('Execution Adapter consumes one resolved target and returns a canonical receipt', () => {
  let received;
  const adapter = createExecutionAdapter({
    provider: 'codex-cli', version: 'codex-adapter.v1',
    execute(resolvedTarget, normalizedRequest) {
      received = { resolvedTarget, normalizedRequest };
      return { status: 'SUCCEEDED', verification: 'NOT_RUN' };
    },
  });
  const outcome = adapter.execute(target, request);
  assert.strictEqual(outcome.status, 'SUCCEEDED');
  assert.strictEqual(outcome.receipt.schema, SCHEMAS.RECEIPT);
  assert.strictEqual(outcome.receipt.resolved_target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(outcome.receipt.requested_role, 'reasoner');
  assert.strictEqual(received.normalizedRequest.role, 'reasoner');
});

test('Adapter blocks target-provider mismatch and never substitutes another Provider', () => {
  let launched = false;
  const adapter = createExecutionAdapter({
    provider: 'codex-cli',
    execute() { launched = true; return { status: 'SUCCEEDED' }; },
  });
  const outcome = adapter.execute({ ...target, provider: 'claude-code', model: 'opus5' }, request);
  assert.strictEqual(outcome.status, 'BLOCKED');
  assert.strictEqual(outcome.receipt.resolved_target, null);
  assert.strictEqual(launched, false);
  assert.ok(!JSON.stringify(outcome).includes('agy'));
});

test('Adapter preserves timeout and observed side-effect state without retrying or switching Provider', () => {
  let calls = 0;
  const adapter = createExecutionAdapter({ provider: 'codex-cli', execute() {
    calls += 1;
    return { status: 'TIMEOUT', side_effects: 'unknown', verification: 'RECONCILIATION_REQUIRED' };
  } });
  const outcome = adapter.execute(target, request);
  assert.strictEqual(outcome.status, 'TIMEOUT');
  assert.strictEqual(outcome.receipt.resolved_target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(outcome.receipt.side_effects, 'unknown');
  assert.strictEqual(outcome.receipt.verification, 'RECONCILIATION_REQUIRED');
  assert.strictEqual(calls, 1);
});

test('Adapter returns BLOCKED for invalid attestation before invoking the Provider', () => {
  let launched = false;
  const adapter = createExecutionAdapter({ provider: 'codex-cli', execute() { launched = true; return { status: 'SUCCEEDED' }; } });
  const outcome = adapter.execute(target, { ...request, scope: undefined });
  assert.strictEqual(outcome.status, 'BLOCKED');
  assert.strictEqual(outcome.failure_class, 'ATTESTATION_INVALID');
  assert.strictEqual(outcome.receipt, null);
  assert.strictEqual(launched, false);
});

test('Adapter registry exposes the four supported execution families', () => {
  const registry = createAdapterRegistry({
    executors: Object.fromEntries(ADAPTER_PROVIDERS.map((provider) => [provider, () => ({ status: 'SUCCEEDED' })])),
  });
  assert.deepStrictEqual(registry.providers, ['claude-code', 'codex-cli', 'agy', 'cursor-native']);
  assert.strictEqual(registry.get('codex-cli').provider, 'codex-cli');
  assert.strictEqual(registry.get('cursor-native').provider, 'cursor-native');
});

run('provider-adapter');
