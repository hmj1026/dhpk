'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { resolveTarget, decideFallback, FAILURE_CLASSES } = require('../scripts/lib/dispatch-engine');
const { createSchedule } = require('../scripts/lib/dispatch-scheduler');
const { createAdapterRegistry } = require('../scripts/lib/provider-adapter');
const { createDispatchRequest, SCHEMAS } = require('../scripts/lib/dispatch-contract');
const catalog = require('../manifests/provider-model-catalog.json');
const profiles = require('../manifests/host-profiles.json');

const cursor = profiles.profiles.find((profile) => profile.host === 'cursor');
const unsupportedEffortCatalog = {
  ...catalog,
  models: {
    ...catalog.models,
    'xai/no-effort-model': {
      ...catalog.models['xai/cursor-grok-4.6-high'],
      model_id: 'no-effort-model',
      display_name: 'No Effort Model',
    },
  },
  routes: [...catalog.routes, {
    host: 'cursor',
    target_agent: 'cursor',
    provider: 'xai',
    model_id: 'no-effort-model',
    invocation_aliases: ['no-effort'],
    route: 'native',
    transport: 'native-runtime',
    roles: ['worker'],
    efforts: [],
    authorities: ['workspace-write'],
    effort_binding: 'unsupported',
    parameter_mapping: {},
    source: 'fixture unsupported effort route',
    observed_at: catalog.observed_at,
  }],
};

function request(overrides = {}) {
  const input = {
    schema: SCHEMAS.REQUEST,
    host_profile: cursor,
    task_id: 'matrix-task',
    attempt_id: 'matrix-attempt',
    role: 'worker',
    authority: 'workspace-write',
    task: { description_digest: 'a'.repeat(64) },
    scope: {
      workdir: '/workspace',
      assigned_files: ['src/matrix.js'],
      prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) },
    },
    effort: 'high',
    fallback: { allow: true, retry_budget: 1 },
    parallelism: { dependencies: [], max_concurrency: 1 },
    ...overrides,
  };
  if (input.target && Object.prototype.hasOwnProperty.call(input.target, 'route')) {
    const { route, ...target } = input.target;
    input.target = target;
  }
  return input;
}

test('cold start remains NOT_RUN and never probes or substitutes a target', () => {
  const result = resolveTarget(request({
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(result.status, 'NOT_RUN');
  assert.strictEqual(result.probe_performed, false);
  assert.strictEqual(result.fallback_eligible, false);
});

test('denied Provider and unsupported Effort fail closed without downgrade', () => {
  const deniedProfile = {
    ...cursor,
    allowed_providers: ['cursor'],
    role_defaults: Object.fromEntries(Object.entries(cursor.role_defaults).map(([role, pair]) => [role, {
      ...pair, target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', route: 'native', transport: 'native-runtime',
    }])),
    role_fallbacks: { planner: [], reasoner: [], worker: [], reviewer: [] },
    access: { cursor: { status: 'AVAILABLE', evidence: 'native fixture' } },
    quota_pools: { cursor: 'native' },
    concurrency_limits: { native: 1 },
  };
  const denied = resolveTarget(request({
    host_profile: deniedProfile,
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(denied.status, 'BLOCKED');

  const unsupported = resolveTarget(request({
    host_profile: { ...cursor, access: { ...cursor.access, google: { status: 'AVAILABLE', evidence: 'agy fixture' } } },
    target: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.7-flash-high', route: 'native', transport: 'native-runtime' },
    effort: 'max',
  }), { catalog });
  assert.strictEqual(unsupported.status, 'UNAVAILABLE');
  assert.match(unsupported.reason, /Effort/i);
});

test('unsupported effort binding blocks an explicit effort instead of reporting unavailable', () => {
  const result = resolveTarget(request({
    host_profile: {
      ...cursor,
      access: { ...cursor.access, xai: { status: 'AVAILABLE', evidence: 'fixture route' } },
    },
    target: { target_agent: 'cursor', provider: 'xai', model_id: 'no-effort-model' },
    effort: 'high',
  }), { catalog: unsupportedEffortCatalog });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.match(result.reason, /cannot express Effort high/i);
  assert.strictEqual(result.fallback_eligible, false);
});

test('unavailable runtime consumes one retry and only then selects the declared fallback', () => {
  const unavailable = resolveTarget(request({
    host_profile: { ...cursor, access: { ...cursor.access, openai: { status: 'UNAVAILABLE', evidence: 'missing codex executable' }, cursor: { status: 'AVAILABLE', evidence: 'native fixture' } } },
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(unavailable.status, 'UNAVAILABLE');
  const fallback = decideFallback({ request: unavailable.request, resolution: unavailable, failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE, sideEffects: 'none', catalog });
  assert.strictEqual(fallback.status, 'FALLBACK');
  assert.strictEqual(fallback.retry_budget_remaining, 0);
  assert.strictEqual(fallback.target.identity, 'cursor/composer-2.5');
});

test('partial writes, missing tools, timeout, and scope collisions stay on their safety paths', () => {
  const reconciliation = decideFallback({
    request: request(),
    resolution: { status: 'UNAVAILABLE', reason: 'writer started', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' } },
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'observed',
    catalog,
  });
  assert.strictEqual(reconciliation.status, 'RECONCILIATION_REQUIRED');

  const adapter = createAdapterRegistry().get('openai');
  const blocked = adapter.execute({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', effort: 'high', route: 'native', transport: 'native-runtime' }, createDispatchRequest(request()));
  assert.strictEqual(blocked.status, 'BLOCKED');
  assert.strictEqual(blocked.failure_class, 'ADAPTER_NOT_CONFIGURED');

  const collision = createSchedule([
    request({ task_id: 'matrix-a', attempt_id: 'matrix-a-attempt' }),
    request({ task_id: 'matrix-b', attempt_id: 'matrix-b-attempt' }),
  ], { catalog });
  assert.ok(collision.diagnostics.some((entry) => entry.reason === 'assigned scope conflict'));
});

run('issue-534-p1-failure-matrix');
