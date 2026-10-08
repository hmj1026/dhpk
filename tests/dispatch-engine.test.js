'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  FAILURE_CLASSES,
  decideFallback,
  resolveTarget,
} = require('../scripts/lib/dispatch-engine');
const { SCHEMAS, createDispatchReceipt } = require('../scripts/lib/dispatch-contract');
const catalog = require('../manifests/provider-model-catalog.json');
const profiles = require('../manifests/host-profiles.json');

const cursorProfile = profiles.profiles.find((profile) => profile.host === 'cursor');
const codexProfile = profiles.profiles.find((profile) => profile.host === 'codex-cli');

const request = (hostProfile, overrides = {}) => {
  const input = {
    schema: SCHEMAS.REQUEST,
    host_profile: hostProfile,
    task_id: 'engine-task-1',
    attempt_id: 'engine-attempt-1',
    role: 'reasoner',
    authority: 'read-only',
    task: { description_digest: 'a'.repeat(64) },
    scope: {
      workdir: '/workspace/project',
      assigned_files: [],
      prompt_evidence: {
        path: '/workspace/project/.dhpk/prompt.txt',
        dev: 1,
        ino: 2,
        sha256: 'b'.repeat(64),
      },
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
};

test('explicit Cursor to Codex target preserves the neutral Role', () => {
  const availableCursor = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      openai: { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = resolveTarget(request(availableCursor, {
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.capability.status, 'AVAILABLE');
  assert.deepStrictEqual(result.target, {
    target_agent: 'codex-cli',
    provider: 'openai',
    model_id: 'gpt-5.6-sol-high',
    model: 'gpt-5.6-sol-high',
    effort: 'high',
    route: 'native',
    transport: 'native-runtime',
    native: false,
    identity: 'codex-cli/gpt-5.6-sol-high',
  });
  assert.strictEqual(result.request.role, 'reasoner');
});

test('explicit Cursor to Claude target preserves Provider, Model, and Route', () => {
  const availableCursor = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      anthropic: { status: 'AVAILABLE', evidence: 'bounded Claude runtime probe' },
    },
  };
  const result = resolveTarget(request(availableCursor, {
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.deepStrictEqual(result.target, {
    target_agent: 'claude-code',
    provider: 'anthropic',
    model_id: 'claude-opus-5-5-high',
    model: 'claude-opus-5-5-high',
    effort: 'high',
    route: 'native',
    transport: 'native-runtime',
    native: false,
    identity: 'claude-code/claude-opus-5-5-high',
  });
  assert.strictEqual(result.request.role, 'reasoner');
  assert.strictEqual(result.request.authority, 'read-only');
});

test('explicit target is blocked when the Host policy denies its Provider', () => {
  const denied = {
    ...cursorProfile,
    allowed_providers: ['cursor', 'openai'],
    role_defaults: Object.fromEntries(Object.entries(cursorProfile.role_defaults).map(([role, pair]) => [role, {
      ...pair,
      target_agent: 'cursor',
      provider: 'cursor',
      model_id: 'composer-2.5',
      route: 'native',
      transport: 'native-runtime',
    }])),
    role_fallbacks: { planner: [], reasoner: [], worker: [], reviewer: [] },
    access: {
      ...cursorProfile.access,
      anthropic: { status: 'BLOCKED', evidence: 'Host policy denies Claude' },
    },
  };
  const result = resolveTarget(request(denied, {
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });

  assert.strictEqual(result.status, 'BLOCKED');
  assert.ok(result.reason.includes('does not allow Provider anthropic'));
  assert.strictEqual(result.probe_performed, false);
});

test('automatic selection prefers the declared Host-native target when available', () => {
  const availableNative = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      cursor: { status: 'AVAILABLE', evidence: 'native runtime ready' },
      openai: { status: 'AVAILABLE', evidence: 'external CLI ready' },
    },
  };
  const result = resolveTarget(request(availableNative, {
    role: 'worker',
    authority: 'workspace-write',
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'cursor/composer-2.5');
  assert.strictEqual(result.target.native, true);
  assert.strictEqual(result.capability.status, 'AVAILABLE');
});

test('AGY Host-native resolution uses Gemini 3.8 Flash High by default', () => {
  const agyProfile = profiles.profiles.find((profile) => profile.host === 'agy');
  const result = resolveTarget(request(agyProfile, {
    role: 'worker',
    authority: 'workspace-write',
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.deepStrictEqual(result.target, {
    target_agent: 'agy',
    provider: 'google',
    model_id: 'gemini-3.8-flash-high',
    model: 'gemini-3.8-flash-high',
    effort: 'high',
    route: 'native',
    transport: 'native-runtime',
    native: true,
    identity: 'agy/gemini-3.8-flash-high',
  });
});

test('automatic selection skips NOT_RUN external capability and records evidence', () => {
  const result = resolveTarget(request(cursorProfile), {
    catalog,
    preferenceOrder: ['codex-cli', 'cursor-native'],
  });

  assert.strictEqual(result.status, 'NOT_RUN');
  assert.ok(result.rejected_candidates.some((candidate) => candidate.provider === 'openai' && candidate.status === 'NOT_RUN'));
});

test('configured external preference selects an available Codex target', () => {
  const available = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      openai: { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = resolveTarget(request(available), {
    catalog,
    preferenceOrder: ['codex-cli', 'cursor-native'],
  });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'codex-cli/gpt-5.6-sol-high');
  assert.strictEqual(result.request.role, 'reasoner');
});

test('Provider-scoped preference entries may carry an explicit normalized Effort', () => {
  const available = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      openai: { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = resolveTarget(request(available), {
    catalog,
    preferenceOrder: [{ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', effort: 'high' }, 'cursor'],
  });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'codex-cli/gpt-5.6-sol-high');
  assert.strictEqual(result.target.effort, 'high');
});

test('explicit unknown Model is unavailable and is never inferred from another Provider', () => {
  const result = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, openai: { status: 'AVAILABLE', evidence: 'ready' } },
  }, {
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'opus5', route: 'headless-cli', transport: 'local-cli' },
  }), { catalog });

  assert.strictEqual(result.status, 'UNAVAILABLE');
  assert.ok(result.reason.includes('opus5'));
});

test('bound current Host evidence resolves a model absent from a stale catalog', () => {
  const evidence = {
    kind: 'host-executable-capability',
    state: 'OBSERVED_AVAILABLE',
    status: 'AVAILABLE',
    source: 'stub Host executor',
    observed_at: '2026-10-08T00:00:00.000Z',
    session_id: 'session-919',
    binding_id: 'binding-919',
    host: 'cursor',
    target_agent: 'cursor',
    provider: 'openai',
    model_id: 'fresh-model',
    role: 'reasoner',
    authority: 'read-only',
    effort: 'high',
    effort_binding: 'parameter',
    route: 'headless-cli',
    transport: 'local-cli',
  };
  const staleCatalog = { ...catalog, models: { ...catalog.models }, routes: catalog.routes.filter((route) => route.model_id !== 'fresh-model') };
  const result = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, openai: { status: 'AVAILABLE', evidence: 'stale profile access' } },
  }, {
    target: { target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model' },
    capability_evidence: evidence,
    execution_binding: { session_id: 'session-919', binding_id: 'binding-919' },
  }), { catalog: staleCatalog });
  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.model_id, 'fresh-model');
  assert.strictEqual(result.target.route, 'headless-cli');
  assert.strictEqual(result.capability.source, 'stub Host executor');
});

test('unbound capability evidence cannot authorize a target', () => {
  assert.throws(() => resolveTarget(request(cursorProfile, {
    target: { target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model' },
    capability_evidence: { status: 'AVAILABLE', provider: 'openai' },
  }), { catalog }), /capability evidence/i);
});

test('capability evidence with the wrong executor binding is blocked', () => {
  const result = resolveTarget(request(cursorProfile, {
    target: { target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'stub Host executor',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-real', binding_id: 'binding-real',
      host: 'cursor', target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model', role: 'reasoner', authority: 'read-only', effort: 'high', effort_binding: 'parameter', route: 'headless-cli', transport: 'local-cli',
    },
    execution_binding: { session_id: 'session-other', binding_id: 'binding-other' },
  }), { catalog });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.match(result.reason, /bound to the injected executor/i);
});

test('declared capability evidence does not authorize execution', () => {
  const result = resolveTarget(request(cursorProfile, {
    target: { target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'DECLARED', status: 'AVAILABLE', source: 'static declaration',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-declared', binding_id: 'binding-declared',
      host: 'cursor', target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model', role: 'reasoner', authority: 'read-only', effort: 'high', effort_binding: 'parameter', route: 'headless-cli', transport: 'local-cli',
    },
    execution_binding: { session_id: 'session-declared', binding_id: 'binding-declared' },
  }), { catalog });
  assert.strictEqual(result.status, 'NOT_RUN');
});

test('exposed Host capability authorizes invocation without claiming observed identity', () => {
  const result = resolveTarget(request(cursorProfile, {
    role: 'worker', authority: 'workspace-write', effort: undefined,
    target: { target_agent: 'cursor', provider: 'openai' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'EXPOSED', status: 'AVAILABLE', source: 'injected Host executable contract',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-exposed', binding_id: 'binding-exposed',
      host: 'cursor', target_agent: 'cursor', provider: 'openai', model_id: null, role: 'worker', authority: 'workspace-write',
      effort: null, effort_binding: 'unsupported', route: 'native', transport: 'native-runtime',
    },
    execution_binding: { session_id: 'session-exposed', binding_id: 'binding-exposed' },
  }), { catalog });
  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.capability.state, 'EXPOSED');
  assert.strictEqual(result.capability.model_id, null);
  assert.strictEqual(result.capability.effort, null);
});

test('strict requested effort remains blocked when observed effort is unknown', () => {
  const result = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, openai: { status: 'AVAILABLE', evidence: 'stub access' } },
  }, {
    target: { target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model' },
    capability_evidence: {
      kind: 'host-executable-capability', status: 'AVAILABLE', source: 'stub Host executor',
      state: 'OBSERVED_AVAILABLE',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-919', binding_id: 'binding-919',
      host: 'cursor', target_agent: 'cursor', provider: 'openai', model_id: 'fresh-model',
      role: 'reasoner', authority: 'read-only', effort_binding: 'unsupported', route: 'headless-cli', transport: 'local-cli',
    },
    execution_binding: { session_id: 'session-919', binding_id: 'binding-919' },
  }), { catalog });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.match(result.reason, /Effort high|effort/i);
});

test('same Provider alternate Route remains same-Provider evidence', () => {
  const result = resolveTarget(request(cursorProfile, {
    role: 'worker',
    authority: 'workspace-write',
    effort: 'high',
    target: { target_agent: 'cursor', provider: 'openai', model_id: 'route-alias' },
    capability_evidence: {
      kind: 'host-executable-capability', status: 'AVAILABLE', source: 'stub alternate route',
      state: 'OBSERVED_AVAILABLE',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-route', binding_id: 'binding-route',
      host: 'cursor', target_agent: 'cursor', provider: 'openai', model_id: 'route-alias', role: 'worker',
      authority: 'workspace-write', effort: 'high', effort_binding: 'parameter', route: 'headless-cli', transport: 'local-cli',
    },
    execution_binding: { session_id: 'session-route', binding_id: 'binding-route' },
  }), { catalog });
  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.provider, 'openai');
  assert.strictEqual(result.target.route, 'headless-cli');
  assert.strictEqual(result.capability.provider, result.target.provider);
});

test('receipt keeps unknown observed Model and Effort explicit', () => {
  const input = request(cursorProfile, {
    role: 'worker',
    authority: 'workspace-write',
    effort: undefined,
    target: { target_agent: 'cursor', provider: 'openai' },
    capability_evidence: {
      kind: 'host-executable-capability', status: 'AVAILABLE', source: 'stub unknown target',
      state: 'OBSERVED_AVAILABLE',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-unknown', binding_id: 'binding-unknown',
      host: 'cursor', target_agent: 'cursor', provider: 'openai', model_id: null, role: 'worker',
      authority: 'workspace-write', effort: null, effort_binding: 'unsupported', route: 'native', transport: 'native-runtime',
    },
    execution_binding: { session_id: 'session-unknown', binding_id: 'binding-unknown' },
  });
  const resolution = resolveTarget(input, { catalog });
  assert.strictEqual(resolution.status, 'RESOLVED');
  const receipt = createDispatchReceipt({
    receipt_id: 'receipt-unknown-target', request: resolution.request, target: resolution.target,
    status: 'SUCCEEDED', verification: 'NOT_RUN', allow_unknown_effort: true, capability_evidence: resolution.capability,
  });
  assert.strictEqual(receipt.resolved_target.model_id, 'unknown');
  assert.strictEqual(receipt.resolved_target.effort, null);
  assert.strictEqual(receipt.effort, undefined);
});

test('automatic selection requires Host policy opt-in for an external Provider', () => {
  const restricted = {
    ...cursorProfile,
    allowed_providers: ['cursor'],
    role_defaults: Object.fromEntries(Object.entries(cursorProfile.role_defaults).map(([role, pair]) => [role, {
      ...pair,
      target_agent: 'cursor',
      provider: 'cursor',
      model_id: 'composer-2.5',
      route: 'native',
      transport: 'native-runtime',
    }])),
    role_fallbacks: { planner: [], reasoner: [], worker: [], reviewer: [] },
    access: {
      cursor: { status: 'AVAILABLE', evidence: 'native runtime ready' },
    },
    quota_pools: { cursor: 'native' },
    concurrency_limits: { native: 1 },
  };
  const result = resolveTarget(request(restricted), {
    catalog,
    preferenceOrder: ['codex-cli', 'cursor-native'],
  });

  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.rejected_candidates[0].status, 'BLOCKED');
});

test('unsupported Role and Effort are reported instead of silently downgraded', () => {
  const roleResult = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, google: { status: 'AVAILABLE', evidence: 'ready' } },
  }, {
    role: 'reviewer',
    authority: 'read-only',
    target: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.7-flash-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(roleResult.status, 'UNAVAILABLE');

  const effortResult = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, google: { status: 'AVAILABLE', evidence: 'ready' } },
  }, {
    role: 'worker',
    authority: 'workspace-write',
    effort: 'max',
    target: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.7-flash-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(effortResult.status, 'UNAVAILABLE');
  assert.ok(/effort/i.test(effortResult.reason));
});

test('unavailable explicit target may use contextual native fallback before side effects', () => {
  const unavailable = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      cursor: { status: 'AVAILABLE', evidence: 'native runtime ready' },
      openai: { status: 'UNAVAILABLE', evidence: 'missing executable: codex' },
      anthropic: { status: 'AVAILABLE', evidence: 'native Claude route ready' },
    },
  };
  const initial = resolveTarget(request(unavailable, {
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });
  const result = decideFallback({
    request: initial.request,
    resolution: initial,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'claude-code/claude-opus-5-5-high');
  assert.strictEqual(result.fallback_history[0].provider, 'openai');
  assert.strictEqual(result.fallback_history[0].model_id, 'gpt-5.6-sol-high');
  assert.strictEqual(result.retry_budget_remaining, 0);
});

test('fallback enters reconciliation after an observed side effect', () => {
  const result = decideFallback({
    request: request(cursorProfile, { target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' } }),
    resolution: { status: 'UNAVAILABLE', reason: 'timeout after launch', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' } },
    failureClass: FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION,
    sideEffects: 'unknown',
    catalog,
  });

  assert.strictEqual(result.status, 'RECONCILIATION_REQUIRED');
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.retry_budget_remaining, 1);
});

test('fallback does not retry the same resolved target identity', () => {
  const hostProfile = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      google: { status: 'AVAILABLE', evidence: 'native AGY fallback fixture' },
    },
  };
  const result = decideFallback({
    request: request(hostProfile, { role: 'worker', authority: 'workspace-write' }),
    resolution: {
      status: 'UNAVAILABLE',
      reason: 'Cursor native runtime unavailable',
      target: {
        target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5',
        effort: 'medium', route: 'native', transport: 'native-runtime', identity: 'cursor/composer-2.5',
      },
      fallback_eligible: true,
    },
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'agy/gemini-3.7-flash-high');
});

test('fallback distinguishes cross-Agent targets from the Host-native route', () => {
  const result = decideFallback({
    request: request(cursorProfile, {
      role: 'worker',
      authority: 'workspace-write',
      target: { target_agent: 'codex-cli', provider: 'cursor', model_id: 'composer-2.5', transport: 'local-cli' },
    }),
    resolution: {
      status: 'UNAVAILABLE',
      reason: 'cross-Agent route unavailable',
      target: {
        target_agent: 'codex-cli', provider: 'cursor', model_id: 'composer-2.5',
        effort: 'medium', route: 'headless-cli', transport: 'local-cli', identity: 'codex-cli/composer-2.5',
      },
      fallback_eligible: true,
    },
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'cursor/composer-2.5');
});

test('Codex Host native fallback is derived from its Host profile', () => {
  const unavailable = {
    ...codexProfile,
    access: {
      ...codexProfile.access,
      anthropic: { status: 'UNAVAILABLE', evidence: 'missing claude CLI' },
    },
  };
  const initial = resolveTarget(request(unavailable, {
    role: 'reviewer',
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5', route: 'headless-cli', transport: 'local-cli' },
  }), { catalog });
  const result = decideFallback({
    request: initial.request,
    resolution: initial,
    failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'codex-cli/gpt-6.1-sol');
  assert.strictEqual(result.target.native, true);
});

// Source suite: dispatch.test.js
{
  const { test, assert } = require('./_lib/tinytest');
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
}

// Source suite: dispatch-config.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const { applyDispatchConfig, createDispatchConfigReport, diagnoseDispatchConfig, resolveDispatchConfig } = require('../scripts/lib/dispatch-config');
  const catalog = require('../manifests/provider-model-catalog.json');
  const profiles = require('../manifests/host-profiles.json');

  test('canonical project target wins over legacy and global values with observable source', () => {
    const result = resolveDispatchConfig({
      project: { worker_target: 'codex-cli/gpt-5.6-sol-high:high', fast_worker_backend: 'agy' },
      global: { worker_target: 'claude-code/opus5:medium' },
    });
    assert.deepStrictEqual(result.worker_target, { target_agent: 'codex-cli', model_id: 'gpt-5.6-sol-high', effort: 'high' });
    assert.strictEqual(result.source.worker_target, 'project.worker_target');
    assert.deepStrictEqual(result.legacy_sources, []);
  });

  test('legacy backend/model values remain bounded compatibility inputs', () => {
    const result = resolveDispatchConfig({ project: { fast_worker_backend: 'codex', codex_fast_worker_model: 'gpt-5.6-luna' }, global: {} });
    assert.strictEqual(result.worker_target.provider, 'codex-cli');
    assert.strictEqual(result.worker_target.model_id, 'gpt-5.6-luna');
    assert.ok(result.legacy_sources.some((entry) => entry.field === 'worker_target'));
  });

  test('invalid canonical values block only the invalid field and retain orchestration kill switch semantics', () => {
    const result = resolveDispatchConfig({ project: { orchestration_dispatch: 'off', reasoner_target: 'bare-model' } });
    assert.strictEqual(result.orchestration_dispatch, 'off');
    assert.ok(result.diagnostics.some((entry) => entry.field === 'reasoner_target'));

    const invalidOrchestration = resolveDispatchConfig({ project: { orchestration_dispatch: 'maybe' } });
    assert.deepStrictEqual(invalidOrchestration.diagnostics, [{
      field: 'orchestration_dispatch',
      status: 'BLOCKED',
      reason: 'orchestration_dispatch must be on or off',
    }]);
    assert.strictEqual(invalidOrchestration.source.orchestration_dispatch, 'project.orchestration_dispatch');
  });

  test('config targets reject caller-selected routes', () => {
    const result = resolveDispatchConfig({ project: {
      worker_target: { target_agent: 'codex-cli', model_id: 'gpt-5.6-sol-high', route: 'native' },
    } });
    assert.ok(result.diagnostics.some((entry) => entry.field === 'worker_target' && /route.*catalog.*config boundary/i.test(entry.reason)));
    assert.strictEqual(result.worker_target, null);
  });

  test('config diagnostics honor an explicit vendor for a Target-Agent route', () => {
    const config = resolveDispatchConfig({ project: {
      reasoner_target: {
        target_agent: 'agy', provider: 'anthropic', model_id: 'claude-opus-4-6-thinking', effort: 'high',
      },
    } });
    const agy = profiles.profiles.find((profile) => profile.host === 'agy');
    const result = diagnoseDispatchConfig({ config, catalog, hostProfile: agy, role: 'reasoner', authority: 'read-only', effort: 'high' });
    assert.strictEqual(result.catalog_support, 'SUPPORTED');
    assert.strictEqual(result.host_access, 'NOT_RUN');
    assert.strictEqual(result.runtime, 'NOT_RUN');
  });

  test('diagnostics keep catalog support, Host access, runtime, and fallback distinct', () => {
    const config = resolveDispatchConfig({ project: { reasoner_target: 'codex-cli/gpt-5.6-sol-high:high', fallback_allow: true } });
    const cursor = profiles.profiles.find((profile) => profile.host === 'cursor');
    const result = diagnoseDispatchConfig({ config, catalog, hostProfile: cursor, role: 'reasoner', authority: 'read-only', effort: 'high' });
    assert.strictEqual(result.catalog_support, 'SUPPORTED');
    assert.strictEqual(result.host_access, 'NOT_RUN');
    assert.strictEqual(result.runtime, 'NOT_RUN');
    assert.strictEqual(result.fallback, 'allowed');
  });

  test('session-start report keeps invalid configuration and runtime evidence separate', () => {
    const config = resolveDispatchConfig({
      project: { worker_target: 'codex-cli/gpt-5.6-luna-high:high', fallback_allow: false },
    });
    const report = createDispatchConfigReport({ config });
    assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
    assert.strictEqual(report.targets.worker.target_agent, 'codex-cli');
    assert.deepStrictEqual(report.status, {
      catalog_support: 'NOT_RUN',
      host_access: 'NOT_RUN',
      runtime: 'NOT_RUN',
      fallback: 'disabled',
    });
    assert.deepStrictEqual(report.diagnostics, []);
  });

  test('applying a canonical role target keeps Effort top-level for the v2 request', () => {
    const config = resolveDispatchConfig({ project: { worker_target: 'codex-cli/gpt-5.6-luna-high:high', fallback_allow: true } });
    const applied = applyDispatchConfig({ config, role: 'worker', request: { task_id: 'task', effort: 'medium' } });
    assert.deepStrictEqual(applied.target, { target_agent: 'codex-cli', model_id: 'gpt-5.6-luna-high' });
    assert.strictEqual(applied.effort, 'high');
    assert.strictEqual(applied.fallback.allow, true);
  });
}

// Source suite: dispatch-config-report.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const { environmentOptions, main, shouldReport } = require('../scripts/dispatch-config-report');

  function captureStdout(action) {
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (value) => { output += value; return true; };
    try {
      return { result: action(), output };
    } finally {
      process.stdout.write = originalWrite;
    }
  }

  test('config report only emits for explicit non-default dispatch settings', () => {
    assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'auto' }), false);
    assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), true);
    assert.deepStrictEqual(environmentOptions({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), {
      worker_target: 'codex-cli/sol5.6:high',
    });
    const defaults = captureStdout(() => main({}));
    assert.strictEqual(defaults.result, 0);
    assert.strictEqual(defaults.output, '');
  });

  test('config report is bounded JSON and reports invalid values without failing startup', () => {
    const explicit = captureStdout(() => main({
      CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high',
    }));
    assert.strictEqual(explicit.result, 0);
    assert.ok(explicit.output.endsWith('\n'));
    const lines = explicit.output.slice(0, -1).split(/\r?\n/u);
    assert.strictEqual(lines.length, 1);
    const report = JSON.parse(lines[0]);
    assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
    assert.strictEqual(report.status.catalog_support, 'NOT_RUN');

    const invalid = captureStdout(() => main({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'bare-model' }));
    assert.strictEqual(invalid.result, 0);
    const invalidReport = JSON.parse(invalid.output);
    assert.strictEqual(invalidReport.schema, 'dhpk.dispatch.config-report.v1');
    assert.ok(invalidReport.diagnostics.some((entry) => entry.field === 'worker_target'));
  });
}

// Source suite: dispatch-contract.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const {
    AUTHORITIES,
    CANONICAL_ROLES,
    EFFORTS,
    SCHEMAS,
    TRANSPORTS,
    createDispatchRequest,
    createDispatchReceipt,
    createHostProfile,
    createHostProfileSet,
    createProviderModelCatalog,
    translateLegacyRequest,
  } = require('../scripts/lib/dispatch-contract');
  const PROVIDER_CATALOG = require('../manifests/provider-model-catalog.json');
  const HOST_PROFILES = require('../manifests/host-profiles.json');

  const HOST_PROFILE = {
    schema: SCHEMAS.HOST_PROFILE,
    version: 'host-profile.test.v2',
    host: 'cursor',
    native_target_agent: 'cursor',
    native_provider: 'cursor',
    native_model: 'composer-2.5',
    native_transport: 'native-runtime',
    allowed_providers: ['cursor', 'anthropic', 'openai', 'google'],
    access: {
      cursor: { status: 'AVAILABLE', evidence: 'fixture native runtime' },
      anthropic: { status: 'NOT_RUN', evidence: 'fixture probe not run' },
      openai: { status: 'AVAILABLE', evidence: 'fixture bounded probe' },
      google: { status: 'UNAVAILABLE', evidence: 'fixture executable missing' },
    },
    quota_pools: { cursor: 'native', anthropic: 'claude', openai: 'codex', google: 'agy' },
    concurrency_limits: { native: 1, claude: 1, codex: 2, agy: 1 },
    observed_at: '2026-09-11T00:00:00.000Z',
  };

  function request(overrides = {}) {
    return {
      schema: SCHEMAS.REQUEST,
      host_profile: HOST_PROFILE,
      task_id: 'task-contract-1',
      attempt_id: 'attempt-contract-1',
      role: 'worker',
      authority: 'workspace-write',
      task: { description_digest: 'a'.repeat(64) },
      scope: {
        workdir: '/workspace/project',
        assigned_files: ['src/example.js'],
        prompt_evidence: {
          path: '/workspace/project/.dhpk/prompt.txt',
          dev: 1,
          ino: 2,
          sha256: 'b'.repeat(64),
        },
      },
      effort: 'high',
      fallback: { allow: true, retry_budget: 1 },
      parallelism: { dependencies: [], max_concurrency: 1 },
      ...overrides,
    };
  }

  test('canonical request keeps Host, Provider-scoped target, Role, Effort, and authority distinct', () => {
    const normalized = createDispatchRequest(request({
      role: 'reasoner',
      authority: 'read-only',
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', transport: 'local-cli' },
    }));

    assert.strictEqual(normalized.schema, SCHEMAS.REQUEST);
    assert.strictEqual(normalized.host_profile.host, 'cursor');
    assert.strictEqual(normalized.role, 'reasoner');
    assert.strictEqual(normalized.authority, 'read-only');
    assert.deepStrictEqual(normalized.target, {
      target_agent: 'codex-cli',
      provider: 'openai',
      model_id: 'gpt-5.6-sol',
      transport: 'local-cli',
    });
    assert.strictEqual(normalized.effort, 'high');
    assert.strictEqual(Object.isFrozen(normalized), true);
    assert.strictEqual(Object.isFrozen(normalized.host_profile), true);
  });

  test('canonical contract exposes bounded role, authority, effort, and transport vocabularies', () => {
    assert.throws(
      () => createDispatchRequest(request({ effort: 'warp' })),
      /effort/i,
    );
  });

  test('canonical requests preserve CLI xhigh and ultra efforts without downgrading', () => {
    for (const effort of ['xhigh', 'ultra']) {
      const normalized = createDispatchRequest(request({
        role: 'reasoner', authority: 'read-only', effort,
        target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-sol', transport: 'local-cli' },
      }));
      assert.strictEqual(normalized.effort, effort);
      assert.strictEqual(normalized.authority, 'read-only');
    }
  });

  test('provider-bound role names are rejected at the canonical seam', () => {
    assert.throws(() => createDispatchRequest(request({ role: 'codex-reasoner', authority: 'read-only' })), /canonical Role|unknown role|role/i);
    assert.throws(() => createDispatchRequest(request({ role: 'agy-worker' })), /canonical Role|unknown role|role/i);
  });

  test('bare Model names cannot identify a canonical execution target', () => {
    assert.throws(() => createDispatchRequest(request({ target: { model: 'opus5', transport: 'local-cli' } })), /Provider|provider-scoped|target/i);
  });

  test('read-only Roles cannot be widened to workspace-write', () => {
    for (const role of ['planner', 'reasoner', 'reviewer']) {
      assert.throws(() => createDispatchRequest(request({ role, authority: 'workspace-write' })), /authority/i);
    }
  });

  test('raw prompt/output/secret fields do not enter the canonical request', () => {
    const normalized = createDispatchRequest(request({
      prompt: 'do not persist this prompt',
      output: 'do not persist this output',
      secret: 'do not persist this secret',
    }));
    const serialized = JSON.stringify(normalized);
    assert.ok(!serialized.includes('do not persist this prompt'));
    assert.ok(!serialized.includes('do not persist this output'));
    assert.ok(!serialized.includes('do not persist this secret'));
  });

  test('versioned catalog and Host profiles keep Provider capability separate from Host access', () => {
    const catalog = createProviderModelCatalog(PROVIDER_CATALOG);
    const profiles = createHostProfileSet(HOST_PROFILES);
    assert.strictEqual(catalog.version, 'model-catalog.v2');
    assert.deepStrictEqual(Object.keys(catalog.models).slice(0, 2), ['anthropic/opus5', 'anthropic/sonnet5']);
    assert.strictEqual(catalog.models['openai/gpt-6-sol'].model_id, 'gpt-6-sol');
    assert.ok(catalog.routes.some((route) => route.provider === 'openai' && route.model_id === 'gpt-6-sol'));
    assert.strictEqual(catalog.models['openai/gpt-6.1-sol'].model_id, 'gpt-6.1-sol');
    assert.ok(catalog.routes.some((route) => route.provider === 'openai' && route.model_id === 'gpt-6.1-sol'));
    assert.deepStrictEqual(profiles.profiles.map((profile) => profile.host).sort(), ['agy', 'claude-code', 'codex-cli', 'cursor']);
    const cursorProfile = profiles.profiles.find((profile) => profile.host === 'cursor');
    assert.strictEqual(cursorProfile.native_provider, 'cursor');
    assert.strictEqual(cursorProfile.access.openai.status, 'NOT_RUN');
    assert.strictEqual(Object.isFrozen(catalog.models['anthropic/opus5']), true);
  });

  test('capability statuses are explicit and static catalog data cannot become runtime proof', () => {
    assert.throws(() => createHostProfile({
      ...HOST_PROFILE,
      access: {
        ...HOST_PROFILE.access,
        openai: { status: 'MAYBE', evidence: 'unrecognized access status' },
      },
    }), /host_profile\.access\.openai\.status/);
  });

  test('v1 compatibility translation preserves alias while leaving Provider selection to the Host policy', () => {
    const translated = translateLegacyRequest({
      schema: 'dhpk.cli.request.v1',
      host_profile: HOST_PROFILE,
      task_id: 'legacy-task-1',
      attempt_id: 'legacy-attempt-1',
      requested_role: 'codex-fast-worker',
      mode: 'workspace-write',
      model: 'gpt-5.6-luna',
      effort: 'high',
      task: { description_digest: 'c'.repeat(64) },
      scope: request().scope,
    });
    assert.strictEqual(translated.request.schema, SCHEMAS.REQUEST);
    assert.strictEqual(translated.request.role, 'worker');
    assert.strictEqual(translated.request.target, undefined);
    assert.strictEqual(translated.compatibility.requested_alias, 'codex-fast-worker');
    assert.strictEqual(translated.compatibility.canonical_role, 'worker');
    assert.strictEqual(translated.compatibility.provider_constraint, null);
    assert.strictEqual(translated.compatibility.deprecated, true);
  });

  test('codex-bridge translation requires explicit mode and never guesses a Role', () => {
    assert.throws(() => translateLegacyRequest({
      schema: 'dhpk.cli.context.v1',
      host_profile: HOST_PROFILE,
      task_id: 'legacy-task-2',
      attempt_id: 'legacy-attempt-2',
      requested_role: 'codex-bridge',
      task: { description_digest: 'd'.repeat(64) },
      scope: request().scope,
    }), /explicit.*mode/i);

    const reviewer = translateLegacyRequest({
      schema: 'dhpk.cli.context.v1',
      host_profile: HOST_PROFILE,
      task_id: 'legacy-task-3',
      attempt_id: 'legacy-attempt-3',
      requested_role: 'codex-bridge',
      mode: 'read-only',
      task: { description_digest: 'e'.repeat(64) },
      scope: request().scope,
    });
    assert.strictEqual(reviewer.request.role, 'reviewer');
    assert.strictEqual(reviewer.request.authority, 'read-only');
  });

  test('v2 receipt identifies target and verification without raw prompt, output, or secret content', () => {
    const normalized = createDispatchRequest(request({
      role: 'reasoner',
      authority: 'read-only',
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', transport: 'local-cli' },
    }));
    const receipt = createDispatchReceipt({
      receipt_id: 'receipt-contract-1',
      request: normalized,
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', effort: 'high', route: 'headless-cli', transport: 'local-cli' },
      status: 'SUCCEEDED',
      verification: 'PASSED',
      catalog_version: 'model-catalog.v2',
      adapter_version: 'codex-adapter.v1',
      capability_evidence: { status: 'AVAILABLE', source: 'fixture' },
      prompt: 'raw prompt must not be persisted',
      output: 'raw output must not be persisted',
      secret: 'secret must not be persisted',
    });
    assert.strictEqual(receipt.schema, SCHEMAS.RECEIPT);
    assert.strictEqual(receipt.requested_role, 'reasoner');
    assert.strictEqual(receipt.resolved_target.identity, 'codex-cli/gpt-5.6-sol');
    assert.strictEqual(receipt.verification, 'PASSED');
    assert.strictEqual(receipt.host_profile_version, HOST_PROFILE.version);
    const serialized = JSON.stringify(receipt);
    assert.ok(!serialized.includes('raw prompt must not be persisted'));
    assert.ok(!serialized.includes('raw output must not be persisted'));
    assert.ok(!serialized.includes('secret must not be persisted'));
  });

  test('receipt evidence rejects raw or provider-private fields', () => {
    const normalized = createDispatchRequest(request({
      role: 'reasoner',
      authority: 'read-only',
    }));
    assert.throws(() => createDispatchReceipt({
      receipt_id: 'receipt-contract-2',
      request: normalized,
      status: 'BLOCKED',
      fallback_history: [{ provider: 'codex-cli', raw_output: 'must not cross receipt boundary' }],
    }), /fallback_history.*unsupported/i);
    assert.throws(() => createDispatchReceipt({
      receipt_id: 'receipt-contract-3',
      request: normalized,
      status: 'BLOCKED',
      capability_evidence: { secret: 'must not cross receipt boundary' },
    }), /capability_evidence.*unsupported/i);
  });

  test('legacy transport names translate to the canonical local-cli transport', () => {
    const translated = translateLegacyRequest({
      schema: 'dhpk.cli.context.v1',
      host_profile: HOST_PROFILE,
      task_id: 'legacy-task-4',
      attempt_id: 'legacy-attempt-4',
      requested_role: 'codex-fast-worker',
      mode: 'workspace-write',
      backend: 'codex',
      model: 'gpt-5.6-luna',
      transport: 'codex-exec',
      task: { description_digest: 'f'.repeat(64) },
      scope: request().scope,
    });
    assert.strictEqual(translated.request.target.target_agent, 'codex-cli');
    assert.strictEqual(translated.request.target.provider, 'openai');
    assert.strictEqual(translated.request.target.transport, 'local-cli');
  });
}

// Source suite: dispatch-platform-validation.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const {
    VALIDATION_SCHEMA,
    validateDispatchPlatformEvidence,
    validateDispatchSurfaceSet,
  } = require('../scripts/lib/dispatch-platform-validation');
  const catalog = require('../manifests/provider-model-catalog.json');
  const profile = require('../manifests/host-profiles.json').profiles.find((entry) => entry.host === 'cursor');

  const target = { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', effort: 'high', route: 'native', transport: 'native-runtime' };

  test('platform evidence separates catalog support, Host access, and runtime probe status', () => {
    const evidence = validateDispatchPlatformEvidence({ hostProfile: profile, catalog, target });
    assert.strictEqual(evidence.schema, 'dhpk.dispatch.platform-validation.v1');
    assert.strictEqual(evidence.status.catalog_support, 'SUPPORTED');
    assert.strictEqual(evidence.status.host_access, 'NOT_RUN');
    assert.strictEqual(evidence.status.runtime, 'NOT_RUN');
    assert.strictEqual(evidence.status.terminal, 'NOT_RUN');
  });

  test('runtime and verification evidence are recorded without turning a receipt into capability proof', () => {
    const evidence = validateDispatchPlatformEvidence({
      hostProfile: { ...profile, access: { ...profile.access, openai: { status: 'AVAILABLE', evidence: 'bounded probe' } } },
      catalog,
      target,
      probe: { status: 'AVAILABLE', evidence: 'executable and auth fixture' },
      receipt: { receipt_id: 'receipt-platform-1', status: 'SUCCEEDED', verification: 'PASSED' },
    });
    assert.strictEqual(evidence.status.host_access, 'AVAILABLE');
    assert.strictEqual(evidence.status.runtime, 'AVAILABLE');
    assert.strictEqual(evidence.status.terminal, 'SUCCEEDED');
    assert.strictEqual(evidence.status.verification, 'PASSED');
  });

  test('successful receipt leaves Host access and runtime unproved without a probe', () => {
    const evidence = validateDispatchPlatformEvidence({
      hostProfile: profile,
      catalog,
      target,
      receipt: { receipt_id: 'receipt-platform-2', status: 'SUCCEEDED', verification: 'PASSED' },
    });
    assert.strictEqual(evidence.status.host_access, 'NOT_RUN');
    assert.strictEqual(evidence.status.runtime, 'NOT_RUN');
    assert.strictEqual(evidence.status.terminal, 'SUCCEEDED');
    assert.strictEqual(evidence.status.verification, 'PASSED');
    assert.strictEqual(evidence.evidence.probe, 'runtime probe not run');
  });

  test('surface validation marks missing catalog support incomplete', () => {
    const result = validateDispatchSurfaceSet([{
      hostProfile: profile,
      catalog,
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'missing-model', effort: 'high', route: 'headless-cli', transport: 'local-cli' },
    }]);
    assert.strictEqual(result.verdict, 'INCOMPLETE');
    assert.strictEqual(result.surfaces[0].status.catalog_support, 'UNSUPPORTED');
  });
}

// Source suite: dispatch-projection.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const {
    SURFACES,
    buildDispatchProjection,
    validateDispatchProjection,
    validateDispatchProjectionSet,
  } = require('../scripts/lib/dispatch-projection');
  const catalog = require('../manifests/provider-model-catalog.json');
  const hostProfiles = require('../manifests/host-profiles.json');

  test('projection carries one canonical dispatch contract for each configured surface', () => {
    const projection = buildDispatchProjection({ surface: 'cursor-plugin', catalog, hostProfiles });
    assert.strictEqual(projection.contract.request, 'dhpk.dispatch.request.v2');
    assert.strictEqual(projection.surface, 'cursor-plugin');
    assert.strictEqual(projection.contract.receipt, 'dhpk.dispatch.receipt.v2');
    assert.deepStrictEqual(projection.contract.roles.map((entry) => entry.role), ['planner', 'reasoner', 'worker', 'reviewer']);
    assert.strictEqual(projection.hosts.find((entry) => entry.host === 'cursor').native_provider, 'cursor');
    assert.deepStrictEqual(validateDispatchProjection(projection), { ok: true, errors: [] });
  });

  test('projection parity keeps the same dispatch contract across every configured surface', () => {
    const expectedSurfaces = [
      'agent-plugin',
      'agy-plugin',
      'claude-core',
      'codex-native',
      'codex-sync',
      'cursor-plugin',
      'cursor-sync',
    ];
    const projections = expectedSurfaces.map((surface) => buildDispatchProjection({ surface, catalog, hostProfiles }));
    const result = validateDispatchProjectionSet(projections);
    assert.strictEqual(result.ok, true, result.errors.join('; '));
    assert.deepStrictEqual(result.surfaces, [...expectedSurfaces].sort());
    assert.throws(
      () => buildDispatchProjection({ surface: 'not-configured', catalog, hostProfiles }),
      /unsupported dispatch projection surface/,
    );
  });

  test('projection parity rejects contract drift on one surface', () => {
    const projections = SURFACES.map((surface) => buildDispatchProjection({ surface, catalog, hostProfiles }));
    projections[0].contract.roles[0].authority = 'workspace-write';
    const result = validateDispatchProjectionSet(projections);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => /contract drift/i.test(error)));
  });

  test('projection validator rejects Provider-bound role definitions', () => {
    const projection = buildDispatchProjection({ surface: 'agent-plugin', catalog, hostProfiles });
    const altered = JSON.parse(JSON.stringify(projection));
    altered.contract.roles[0].role = 'codex-reasoner';
    assert.strictEqual(validateDispatchProjection(altered).ok, false);
  });
}

// Source suite: dispatch-scheduler.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const { createSchedule, executeSchedule } = require('../scripts/lib/dispatch-scheduler');
  const { dispatch } = require('../scripts/lib/dispatch');
  const { createAdapterRegistry } = require('../scripts/lib/provider-adapter');
  const { SCHEMAS } = require('../scripts/lib/dispatch-contract');

  const catalog = require('../manifests/provider-model-catalog.json');
  const baseProfile = {
    schema: SCHEMAS.HOST_PROFILE, version: 'cursor-scheduler.v2', host: 'cursor', native_target_agent: 'cursor', native_provider: 'cursor', native_model: 'composer-2.5', native_transport: 'native-runtime',
    allowed_providers: ['cursor', 'anthropic', 'openai', 'google'],
    access: {
      cursor: { status: 'AVAILABLE', evidence: 'native scheduler fixture' },
      anthropic: { status: 'AVAILABLE', evidence: 'claude scheduler fixture' },
      openai: { status: 'AVAILABLE', evidence: 'codex scheduler fixture' },
      google: { status: 'AVAILABLE', evidence: 'agy scheduler fixture' },
    },
    quota_pools: { cursor: 'native', anthropic: 'claude', openai: 'codex', google: 'agy' },
    concurrency_limits: { native: 1, claude: 1, codex: 1, agy: 1 },
    observed_at: '2026-09-11T00:00:00.000Z',
  };

  function request(id, files, overrides = {}) {
    const input = {
      schema: SCHEMAS.REQUEST, host_profile: baseProfile, task_id: id, attempt_id: `${id}-attempt`,
      role: 'worker', authority: 'workspace-write', task: { description_digest: 'a'.repeat(64) },
      scope: { workdir: '/workspace', assigned_files: files, prompt_evidence: { path: `/workspace/${id}.prompt`, dev: 1, ino: id.length, sha256: 'b'.repeat(64) } },
      effort: 'medium', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 3 },
      ...overrides,
    };
    if (input.target && Object.prototype.hasOwnProperty.call(input.target, 'route')) {
      const { route, ...target } = input.target;
      input.target = target;
    }
    return input;
  }

  test('scheduler admits independent mixed-provider workers in one wave', () => {
    const plan = createSchedule([
      request('claude-task', ['src/claude.js'], { effort: 'medium', target: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', route: 'native', transport: 'native-runtime' } }),
      request('codex-task', ['src/codex.js'], { effort: 'high', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' } }),
      request('agy-task', ['src/agy.js'], { effort: 'high', target: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.7-flash-high', route: 'native', transport: 'native-runtime' } }),
    ], { catalog });

    assert.strictEqual(plan.status, 'READY');
    assert.strictEqual(plan.waves.length, 1);
    assert.deepStrictEqual(plan.waves[0].map((entry) => entry.target.provider), ['cursor', 'openai', 'google']);
  });

  test('scheduler separates conflicting assigned scopes without blaming Provider identity', () => {
    const plan = createSchedule([
      request('first', ['src/shared.js'], { effort: 'high', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' } }),
      request('second', ['src/shared.js'], { effort: 'high', target: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.7-flash-high', route: 'native', transport: 'native-runtime' } }),
    ], { catalog });

    assert.strictEqual(plan.status, 'READY');
    assert.strictEqual(plan.waves.length, 2);
    assert.strictEqual(plan.waves[0][0].target.provider, 'openai');
    assert.strictEqual(plan.waves[1][0].target.provider, 'google');
    assert.ok(plan.diagnostics.some((item) => item.reason === 'assigned scope conflict'));
  });

  test('scheduler enforces a shared Provider quota pool', () => {
    const profile = { ...baseProfile, quota_pools: { ...baseProfile.quota_pools, openai: 'shared' }, concurrency_limits: { ...baseProfile.concurrency_limits, shared: 1 } };
    const plan = createSchedule([
      request('codex-one', ['src/one.js'], { host_profile: profile, effort: 'high', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' } }),
      request('codex-two', ['src/two.js'], { host_profile: profile, effort: 'high', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' } }),
    ], { catalog });

    assert.strictEqual(plan.waves.length, 2);
    assert.ok(plan.diagnostics.some((item) => item.reason === 'Provider quota limit'));
  });

  test('scheduler plans unavailable external work onto the current Host-native fallback', async () => {
    const unavailable = {
      ...baseProfile,
      access: { ...baseProfile.access, openai: { status: 'UNAVAILABLE', evidence: 'missing Codex CLI' } },
    };
    const input = request('fallback-task', ['src/fallback.js'], {
      host_profile: unavailable,
      effort: 'high',
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', route: 'native', transport: 'native-runtime' },
      fallback: { allow: true, retry_budget: 1 },
    });
    const plan = createSchedule([input], { catalog });
    assert.strictEqual(plan.status, 'READY');
    assert.strictEqual(plan.waves[0][0].target.identity, 'cursor/composer-2.5');
    assert.strictEqual(plan.waves[0][0].fallback.status, 'FALLBACK');

    const registry = createAdapterRegistry({ executors: {
      cursor: (target) => ({ status: 'SUCCEEDED', verification: 'PASSED', receipt_id: `receipt-${target.identity}` }),
    } });
    const result = await executeSchedule([input], { catalog, registry, dispatch, fallback: true });
    assert.strictEqual(result.results[0].status, 'SUCCEEDED');
    assert.strictEqual(result.results[0].receipt.resolved_target.identity, 'cursor/composer-2.5');
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
    let dispatchCalls = 0;
    const cancelled = await executeSchedule([request('cancelled', ['src/cancelled.js'])], {
      catalog,
      signal: controller.signal,
      dispatch: async () => {
        dispatchCalls += 1;
        return { status: 'SUCCEEDED' };
      },
    });
    assert.strictEqual(cancelled.results[0].status, 'CANCELLED');
    assert.strictEqual(dispatchCalls, 0, 'pre-aborted work must not invoke dispatch');
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
      target: 'cursor/composer-2.5',
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
}

// Source suite: issue-534-p1-dispatch-contract.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const {
    CAPABILITY_STATUSES,
    SUPPORT_STATUSES,
    SCHEMAS,
    createHostProfile,
    createDispatchRequest,
    createProviderModelCatalog,
    translateLegacyRequest,
  } = require('../scripts/lib/dispatch-contract');
  const { buildInvocation } = require('../scripts/lib/provider-cli-adapters');
  const { validateDispatchPlatformEvidence } = require('../scripts/lib/dispatch-platform-validation');

  const timestamp = '2026-09-16T00:00:00.000Z';

  const catalog = {
    schema: 'dhpk.model.catalog.v2',
    version: 'model-catalog.v2',
    observed_at: timestamp,
    models: {
      'anthropic/sonnet-5': {
        provider: 'anthropic',
        model_id: 'sonnet-5',
        display_name: 'Claude Sonnet 5',
        pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
      },
      'openai/gpt-5.6-luna': {
        provider: 'openai',
        model_id: 'gpt-5.6-luna',
        display_name: 'GPT-5.6 Luna',
        pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
      },
      'google/gemini-3.8-flash-high': {
        provider: 'google',
        model_id: 'gemini-3.8-flash-high',
        display_name: 'Gemini 3.8 Flash (High)',
        pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
      },
      'xai/cursor-grok-4.6-high': {
        provider: 'xai',
        model_id: 'cursor-grok-4.6-high',
        display_name: 'Grok 4.6 (High)',
        pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
      },
    },
    routes: [
      {
        host: 'claude-code', target_agent: 'claude-code', provider: 'anthropic', model_id: 'sonnet-5',
        invocation_aliases: ['claude', 'claude-code'], route: 'native', transport: 'native-runtime',
        roles: ['planner', 'reasoner', 'worker', 'reviewer'], efforts: ['low', 'medium', 'high', 'max'],
        authorities: ['read-only', 'workspace-write'], effort_binding: 'parameter',
        parameter_mapping: { model: 'model_id', effort: '--effort' }, source: 'claude --help', observed_at: timestamp,
      },
      {
        host: 'cursor', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna',
        invocation_aliases: ['codex'], route: 'headless-cli', transport: 'local-cli',
        roles: ['worker'], efforts: ['high'], authorities: ['workspace-write'], effort_binding: 'parameter',
        parameter_mapping: { model: '-m', effort: 'model_reasoning_effort' }, source: 'codex --help', observed_at: timestamp,
      },
      {
        host: 'agy', target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high',
        invocation_aliases: ['agy'], route: 'native', transport: 'native-runtime',
        roles: ['worker'], efforts: ['high'], authorities: ['workspace-write'], effort_binding: 'embedded',
        parameter_mapping: { model: 'model_id' }, source: 'agy models', observed_at: timestamp,
      },
      {
        host: 'cursor', target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high',
        invocation_aliases: ['cursor'], route: 'native', transport: 'native-runtime',
        roles: ['planner', 'reasoner', 'worker', 'reviewer'], efforts: ['high'], authorities: ['read-only', 'workspace-write'], effort_binding: 'embedded',
        parameter_mapping: { model: 'model_id' }, source: 'cursor-agent models', observed_at: timestamp,
      },
    ],
  };

  const profile = {
    schema: 'dhpk.host.profile.v1', version: 'cursor.v2', host: 'cursor',
    native_provider: 'xai', native_model: 'cursor-grok-4.6-high', native_transport: 'native-runtime',
    allowed_providers: ['xai', 'anthropic', 'openai', 'google'],
    access: {
      xai: { status: 'AVAILABLE', evidence: 'cursor native runtime fixture' },
      anthropic: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
      openai: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
      google: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
    },
    quota_pools: { xai: 'cursor', anthropic: 'anthropic', openai: 'openai', google: 'google' },
    concurrency_limits: { cursor: 1, anthropic: 1, openai: 1, google: 1 }, observed_at: timestamp,
  };

  function request(overrides = {}) {
    return {
      schema: SCHEMAS.REQUEST,
      host_profile: profile,
      task_id: 'route-boundary-task',
      attempt_id: 'route-boundary-attempt',
      role: 'worker',
      authority: 'workspace-write',
      task: { description_digest: 'a'.repeat(64) },
      scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
      effort: 'high',
      fallback: { allow: false, retry_budget: 0 },
      parallelism: { dependencies: [], max_concurrency: 1 },
      ...overrides,
    };
  }

  test('v2 catalog is a flat Host/Target-Agent/Provider/Model/Route matrix', () => {
    const normalized = createProviderModelCatalog(catalog);
    assert.strictEqual(normalized.schema, SCHEMAS.CATALOG);
    assert.strictEqual(normalized.schema, 'dhpk.model.catalog.v2');
    assert.ok(normalized.models['anthropic/sonnet-5']);
    assert.strictEqual(normalized.routes.length, 4);
    assert.strictEqual(normalized.routes[0].target_agent, 'claude-code');
    assert.strictEqual(normalized.routes[0].provider, 'anthropic');
    assert.strictEqual(normalized.routes[0].model_id, 'sonnet-5');
    assert.strictEqual(normalized.routes[0].route, 'native');
    assert.strictEqual(normalized.routes[2].effort_binding, 'embedded');
    assert.ok(!normalized.routes.some((row) => row.provider === 'cursor-native'));
    assert.ok(!Object.keys(normalized.models).some((id) => id.endsWith('/cursor-default')));

    const missingModelRoute = { ...catalog.routes[0], model_id: 'unlisted-model', invocation_aliases: [] };
    assert.throws(() => createProviderModelCatalog({
      ...catalog,
      routes: [...catalog.routes, missingModelRoute],
    }), /references missing model/i);
  });

  test('canonical requests reject caller-selected routes', () => {
    assert.throws(() => createDispatchRequest(request({
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna', route: 'headless-cli', transport: 'local-cli' },
    })), /target\.route.*catalog.*request boundary/i);
  });

  test('v2 catalog rejects duplicate route identity and placeholder Provider rows', () => {
    assert.throws(() => createProviderModelCatalog({
      ...catalog,
      routes: [...catalog.routes, catalog.routes[0]],
    }), /duplicate.*route|identity/i);
    assert.throws(() => createProviderModelCatalog({
      ...catalog,
      routes: [{ ...catalog.routes[0], provider: 'cursor-native' }],
    }), /Provider|vendor|unsupported/i);
  });

  test('Host Profiles expose defaults separately from static catalog support', () => {
    const normalized = createHostProfile({
      ...profile,
      role_defaults: {
        planner: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
        reasoner: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
        worker: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
        reviewer: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
      },
      role_fallbacks: { planner: [], reasoner: [], worker: [], reviewer: [] },
    });
    assert.strictEqual(normalized.role_defaults.worker.model_id, 'cursor-grok-4.6-high');
    assert.strictEqual(normalized.role_defaults.worker.route, 'native');
    assert.deepStrictEqual(normalized.role_fallbacks.worker, []);
    assert.strictEqual(normalized.access.openai.status, 'NOT_RUN');
    assert.ok(createProviderModelCatalog(catalog).routes.some((route) => route.host === 'cursor' && route.provider === 'openai'));
    assert.throws(() => createHostProfile({
      ...profile,
      role_defaults: {
        worker: {
          target_agent: 'codex-cli',
          provider: 'openai',
          model_id: 'gpt-5.6-luna',
          effort: 'high',
          route: 'headless-cli',
          transport: 'local-cli',
        },
      },
    }), /role_defaults\.worker\.route must be native/);
  });

  test('legacy Role aliases carry only canonical Role and authority', () => {
    const translated = translateLegacyRequest({
      schema: 'dhpk.cli.request.v1', host_profile: profile, task_id: 'legacy-p1', attempt_id: 'attempt-p1',
      requested_role: 'codex-fast-worker', mode: 'workspace-write', model: 'gpt-5.6-luna', effort: 'high',
      task: { description_digest: 'a'.repeat(64) },
      scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    });
    assert.strictEqual(translated.compatibility.provider_constraint, null);
    assert.strictEqual(translated.request.target, undefined);
    assert.match(translated.compatibility.diagnostic, /explicit target/i);
  });

  test('all four adapters expose explicit argv contracts and Claude reads prompt from stdin', () => {
    const request = { authority: 'read-only', scope: { workdir: '/workspace' } };
    const claude = buildInvocation({ target_agent: 'claude-code', provider: 'anthropic', model_id: 'sonnet-5', model: 'sonnet-5', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
    assert.deepStrictEqual(claude.argv, ['--print', '--model', 'sonnet-5', '--effort', 'high', '--output-format', 'json']);
    assert.strictEqual(claude.stdin_mode, 'prompt');
    assert.ok(!claude.argv.includes('--prompt-file'));

    const codex = buildInvocation({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna', model: 'gpt-5.6-luna', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
    assert.strictEqual(codex.executable, 'codex');
    assert.deepStrictEqual(codex.argv, [
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', 'approval_policy=never', '--cd', '/workspace',
      '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort=high',
      '--output-last-message', '{transport_output}', '-',
    ]);
    assert.strictEqual(codex.stdin_mode, 'prompt');
    assert.strictEqual(codex.output, 'transport-file');

    const agy = buildInvocation(
      { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high', model: 'gemini-3.8-flash-high', effort: 'high', route: 'headless-cli', transport: 'local-cli' },
      { ...request, authority: 'workspace-write' },
      { catalog },
    );
    assert.strictEqual(agy.executable, 'agy');
    assert.deepStrictEqual(agy.argv, [
      '--dangerously-skip-permissions', '--mode', 'accept-edits', '--add-dir', '/workspace',
      '--model', 'Gemini 3.8 Flash (High)', '--print-timeout', '300s', '-p', '{prompt}',
    ]);
    assert.strictEqual(agy.stdin_mode, 'agy-confirmation');
    assert.strictEqual(agy.output, 'none');
    const cursor = buildInvocation({ target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', model: 'cursor-grok-4.6-high', effort: 'high', route: 'native', transport: 'native-runtime' }, request);
    assert.deepStrictEqual(cursor.argv, []);
  });
}

// Source suite: issue-534-p1-failure-matrix.test.js
{
  const { test, assert } = require('./_lib/tinytest');
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
}

// Source suite: gen-dispatch-projection.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');

  const ROOT = path.join(__dirname, '..');
  const CLI = path.join(ROOT, 'scripts', 'ci', 'gen-dispatch-projection.js');

  test('dispatch projection generator emits the canonical contract and AGY 3.8 native model', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dispatch-projection-parity-'));
    try {
      const output = path.join(directory, 'agy-plugin.json');
      const result = spawnSync(process.execPath, [CLI, '--surface', 'agy-plugin'], { cwd: ROOT, encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stderr);
      const projection = JSON.parse(result.stdout);
      const written = spawnSync(process.execPath, [CLI, '--surface', 'agy-plugin', '--out', output], { cwd: ROOT, encoding: 'utf8' });
      assert.strictEqual(written.status, 0, written.stderr);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(output, 'utf8')), projection, 'stdout and --out must publish the same projection');
      const { fingerprint, ...shape } = projection;
      const recomputed = crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
      assert.strictEqual(fingerprint, recomputed, 'fingerprint must bind the projection payload');
      assert.strictEqual(projection.schema, 'dhpk.dispatch.projection.v1');
      assert.strictEqual(projection.contract.request, 'dhpk.dispatch.request.v2');
      assert.strictEqual(projection.hosts.find((entry) => entry.host === 'agy').native_model, 'gemini-3.8-flash-high');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('dispatch projection generator writes a validated bounded artifact', () => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dispatch-projection-')));
    const output = path.join(directory, 'projection.json');
    try {
      const result = spawnSync(process.execPath, [CLI, '--surface', 'cursor-plugin', '--out', output], { cwd: ROOT, encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stderr);
      const projection = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.match(projection.fingerprint, /^[0-9a-f]{64}$/);
      const { fingerprint, ...payload } = projection;
      const expectedFingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      assert.strictEqual(fingerprint, expectedFingerprint, 'fingerprint must bind the cursor projection payload');
      assert.deepStrictEqual(projection.contract.roles.map((entry) => entry.role), ['planner', 'reasoner', 'worker', 'reviewer']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('dispatch projection generator can validate every configured surface together', () => {
    const result = spawnSync(process.execPath, [CLI, '--all'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const document = JSON.parse(result.stdout);
    assert.strictEqual(document.schema, 'dhpk.dispatch.projections.v1');
    const expectedSurfaces = ['claude-core', 'agent-plugin', 'cursor-plugin', 'cursor-sync', 'codex-native', 'codex-sync', 'agy-plugin'];
    const actualSurfaces = document.projections.map((entry) => entry.surface);
    assert.deepStrictEqual(actualSurfaces, expectedSurfaces);
    assert.strictEqual(new Set(actualSurfaces).size, 7);
    assert.strictEqual(document.projections.find((entry) => entry.surface === 'agy-plugin').hosts.find((entry) => entry.host === 'agy').native_model, 'gemini-3.8-flash-high');
  });
}

run('dispatch-engine');
