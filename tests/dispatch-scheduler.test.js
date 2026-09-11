'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { createSchedule, executeSchedule } = require('../scripts/lib/dispatch-scheduler');
const { dispatch } = require('../scripts/lib/dispatch');
const { createAdapterRegistry } = require('../scripts/lib/provider-adapter');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');

const catalog = require('../manifests/provider-model-catalog.json');
const baseProfile = {
  schema: SCHEMAS.HOST_PROFILE, version: 'cursor-scheduler.v1', host: 'cursor', native_provider: 'cursor-native', native_model: 'cursor-default', native_transport: 'native-runtime',
  allowed_providers: ['cursor-native', 'claude-code', 'codex-cli', 'agy'],
  access: {
    'cursor-native': { status: 'AVAILABLE', evidence: 'native scheduler fixture' },
    'claude-code': { status: 'AVAILABLE', evidence: 'claude scheduler fixture' },
    'codex-cli': { status: 'AVAILABLE', evidence: 'codex scheduler fixture' },
    agy: { status: 'AVAILABLE', evidence: 'agy scheduler fixture' },
  },
  quota_pools: { 'cursor-native': 'native', 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' },
  concurrency_limits: { native: 1, claude: 1, codex: 1, agy: 1 },
  observed_at: '2026-09-11T00:00:00.000Z',
};

function request(id, files, overrides = {}) {
  return {
    schema: SCHEMAS.REQUEST, host_profile: baseProfile, task_id: id, attempt_id: `${id}-attempt`,
    role: 'worker', authority: 'workspace-write', task: { description_digest: 'a'.repeat(64) },
    scope: { workdir: '/workspace', assigned_files: files, prompt_evidence: { path: `/workspace/${id}.prompt`, dev: 1, ino: id.length, sha256: 'b'.repeat(64) } },
    effort: 'high', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 3 },
    ...overrides,
  };
}

test('scheduler admits independent mixed-provider workers in one wave', () => {
  const plan = createSchedule([
    request('claude-task', ['src/claude.js'], { target: { provider: 'claude-code', model: 'opus5', transport: 'local-cli' } }),
    request('codex-task', ['src/codex.js'], { target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }),
    request('agy-task', ['src/agy.js'], { target: { provider: 'agy', model: 'gemini-3.8-flash-high', transport: 'local-cli' } }),
  ], { catalog });

  assert.strictEqual(plan.status, 'READY');
  assert.strictEqual(plan.waves.length, 1);
  assert.deepStrictEqual(plan.waves[0].map((entry) => entry.target.provider), ['claude-code', 'codex-cli', 'agy']);
});

test('scheduler separates conflicting assigned scopes without blaming Provider identity', () => {
  const plan = createSchedule([
    request('first', ['src/shared.js'], { target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }),
    request('second', ['src/shared.js'], { target: { provider: 'claude-code', model: 'opus5', transport: 'local-cli' } }),
  ], { catalog });

  assert.strictEqual(plan.status, 'READY');
  assert.strictEqual(plan.waves.length, 2);
  assert.strictEqual(plan.waves[0][0].target.provider, 'codex-cli');
  assert.strictEqual(plan.waves[1][0].target.provider, 'claude-code');
  assert.ok(plan.diagnostics.some((item) => item.reason === 'assigned scope conflict'));
});

test('scheduler enforces a shared Provider quota pool', () => {
  const profile = { ...baseProfile, quota_pools: { ...baseProfile.quota_pools, 'codex-cli': 'shared' }, concurrency_limits: { ...baseProfile.concurrency_limits, shared: 1 } };
  const plan = createSchedule([
    request('codex-one', ['src/one.js'], { host_profile: profile, target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }),
    request('codex-two', ['src/two.js'], { host_profile: profile, target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }),
  ], { catalog });

  assert.strictEqual(plan.waves.length, 2);
  assert.ok(plan.diagnostics.some((item) => item.reason === 'Provider quota limit'));
});

test('scheduler plans unavailable external work onto the current Host-native fallback', async () => {
  const unavailable = {
    ...baseProfile,
    access: { ...baseProfile.access, 'codex-cli': { status: 'UNAVAILABLE', evidence: 'missing Codex CLI' } },
  };
  const input = request('fallback-task', ['src/fallback.js'], {
    host_profile: unavailable,
    target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' },
    fallback: { allow: true, retry_budget: 1 },
  });
  const plan = createSchedule([input], { catalog });
  assert.strictEqual(plan.status, 'READY');
  assert.strictEqual(plan.waves[0][0].target.identity, 'cursor-native/cursor-default');
  assert.strictEqual(plan.waves[0][0].fallback.status, 'FALLBACK');

  const registry = createAdapterRegistry({ executors: {
    'cursor-native': (target) => ({ status: 'SUCCEEDED', verification: 'PASSED', receipt_id: `receipt-${target.identity}` }),
  } });
  const result = await executeSchedule([input], { catalog, registry, dispatch, fallback: true });
  assert.strictEqual(result.results[0].status, 'SUCCEEDED');
  assert.strictEqual(result.results[0].receipt.resolved_target.identity, 'cursor-native/cursor-default');
});

test('scheduler honors dependencies before admitting a wave', () => {
  const plan = createSchedule([
    request('base', ['src/base.js']),
    request('dependent', ['src/dependent.js'], { parallelism: { dependencies: ['base'], max_concurrency: 3 } }),
  ], { catalog });
  assert.strictEqual(plan.waves.length, 2);
  assert.strictEqual(plan.waves[1][0].request.task_id, 'dependent');
});

test('execution scheduler reports timeout and cancellation without fallback substitution', async () => {
  const controller = new AbortController();
  const timeoutResult = await executeSchedule([request('timeout', ['src/timeout.js'])], {
    catalog, timeoutMs: 10, dispatch: () => new Promise(() => {}),
  });
  assert.strictEqual(timeoutResult.results[0].status, 'TIMEOUT');
  assert.strictEqual(timeoutResult.results[0].fallback, undefined);

  controller.abort();
  const cancelled = await executeSchedule([request('cancelled', ['src/cancelled.js'])], {
    catalog, signal: controller.signal, dispatch: async () => ({ status: 'SUCCEEDED' }),
  });
  assert.strictEqual(cancelled.results[0].status, 'CANCELLED');
});

test('execution scheduler preserves launch identity and distinguishes crash from unknown lifecycle state', async () => {
  const crash = await executeSchedule([request('crash', ['src/crash.js'])], {
    catalog,
    dispatch: async () => { throw new Error('adapter process crashed'); },
  });
  assert.strictEqual(crash.results[0].status, 'CRASHED');
  assert.deepStrictEqual(crash.results[0].launch_identity, {
    task_id: 'crash',
    attempt_id: 'crash-attempt',
    target: 'cursor-native/cursor-default',
  });

  const unknown = await executeSchedule([request('unknown', ['src/unknown.js'])], {
    catalog,
    dispatch: async () => ({ status: 'UNKNOWN' }),
  });
  assert.strictEqual(unknown.results[0].status, 'UNKNOWN');
  assert.strictEqual(unknown.results[0].fallback, undefined);
});

test('failed lifecycle outcomes block dependent work instead of dispatching a duplicate task', async () => {
  const calls = [];
  const dependent = request('dependent-failure', ['src/dependent.js'], { parallelism: { dependencies: ['root-failure'], max_concurrency: 3 } });
  const result = await executeSchedule([request('root-failure', ['src/root.js']), dependent], {
    catalog,
    dispatch: async (entry) => {
      calls.push(entry.task_id);
      return { status: 'FAILED' };
    },
  });
  assert.deepStrictEqual(calls, ['root-failure']);
  assert.strictEqual(result.results.find((entry) => entry.task_id === 'dependent-failure').status, 'BLOCKED');
});

run('dispatch-scheduler');
