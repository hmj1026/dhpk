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

test('string and object cursor-native preferences resolve to the same Cursor target with a legacy diagnostic', () => {
  const worker = { role: 'worker', authority: 'workspace-write', effort: 'medium' };
  const forms = [
    ['cursor-native/composer-2.5:medium'],
    [{ provider: 'cursor-native', model_id: 'composer-2.5', effort: 'medium' }],
    [{ target_agent: 'cursor-native', model_id: 'composer-2.5', effort: 'medium' }],
  ].map((preferenceOrder) => resolveTarget(request(cursorProfile, worker), { catalog, preferenceOrder }));

  for (const result of forms) {
    assert.strictEqual(result.status, 'RESOLVED');
    assert.strictEqual(result.target.target_agent, 'cursor');
    assert.strictEqual(result.target.provider, 'cursor');
    assert.strictEqual(result.target.model_id, 'composer-2.5');
    assert.strictEqual(result.diagnostic, 'legacy provider/route target spelling translated at input boundary');
  }
  assert.deepStrictEqual(forms[1].target, forms[0].target);
  assert.deepStrictEqual(forms[2].target, forms[0].target);
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
    target: { target_agent: 'cursor', provider: 'cursor' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'EXPOSED', status: 'AVAILABLE', source: 'injected Host executable contract',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-exposed', binding_id: 'binding-exposed',
      host: 'cursor', target_agent: 'cursor', provider: 'cursor', model_id: null, role: 'worker', authority: 'workspace-write',
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
    target: { target_agent: 'cursor', provider: 'cursor' },
    capability_evidence: {
      kind: 'host-executable-capability', status: 'AVAILABLE', source: 'stub unknown target',
      state: 'OBSERVED_AVAILABLE',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'session-unknown', binding_id: 'binding-unknown',
      host: 'cursor', target_agent: 'cursor', provider: 'cursor', model_id: null, role: 'worker',
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
  assert.strictEqual(receipt.resolved_target.model_id, null);
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

test('the fallback contract exposes the six canonical failure classes', () => {
  assert.deepStrictEqual(Object.values(FAILURE_CLASSES), [
    'CLI_UNAVAILABLE',
    'AUTHENTICATION_OR_MODEL_UNAVAILABLE',
    'QUOTA_OR_RATE_LIMIT',
    'SAFETY_OR_USER_DENIAL',
    'TASK_OR_SEMANTIC_FAILURE',
    'TIMEOUT_OR_INTERRUPTION',
  ]);
});

test('failure classes that are not availability failures never switch Provider and keep the budget', () => {
  const target = { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' };
  for (const [failureClass, status, action] of [
    [FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT, 'BLOCKED', 'stop'],
    [FAILURE_CLASSES.SAFETY_OR_USER_DENIAL, 'BLOCKED', 'stop'],
    [FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE, 'BLOCKED', 'repair'],
    [FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION, 'RECONCILIATION_REQUIRED', undefined],
  ]) {
    const result = decideFallback({
      request: request(cursorProfile, { target, fallback: { allow: true, retry_budget: 3 } }),
      resolution: { status: 'UNAVAILABLE', reason: 'failed', target, fallback_eligible: true },
      failureClass,
      sideEffects: 'none',
      catalog,
    });
    assert.strictEqual(result.status, status, failureClass);
    assert.strictEqual(result.action, action, failureClass);
    assert.strictEqual(result.retry_budget_remaining, 3, failureClass);
  }
});

test('an exhausted retry budget blocks fallback even for an availability failure', () => {
  const target = { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', route: 'native', transport: 'native-runtime' };
  const result = decideFallback({
    request: request(cursorProfile, { target, fallback: { allow: true, retry_budget: 0 } }),
    resolution: { status: 'UNAVAILABLE', reason: 'missing executable: codex', target, fallback_eligible: true },
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.strictEqual(result.action, 'stop');
  assert.strictEqual(result.retry_budget_remaining, 0);
});

// Independent oracle: the design D5 mapping table plus the keys the code already
// diagnosed (codex_deep_reasoner_*, architect_*, reviewer_effort).
const EXPECTED_REMOVED_KEYS = {
  fast_worker_backend: 'worker_target',
  fast_worker_backend_order: 'preference_order',
  fast_worker_fallback: 'fallback_allow',
  fast_worker_model: 'worker_target',
  fast_worker_effort: 'worker_target',
  deep_reasoner_model: 'reasoner_target',
  deep_reasoner_effort: 'reasoner_target',
  planner_model: 'planner_target',
  planner_effort: 'planner_target',
  reviewer_model: 'reviewer_target',
  reviewer_effort: 'reviewer_target',
  codex_worker_model: 'worker_target',
  codex_fast_worker_model: 'worker_target',
  codex_worker_effort: 'worker_target',
  codex_fast_worker_effort: 'worker_target',
  agy_worker_model: 'worker_target',
  agy_fast_worker_model: 'worker_target',
  codex_reasoner_model: 'reasoner_target',
  codex_reasoner_effort: 'reasoner_target',
  codex_deep_reasoner_model: 'reasoner_target',
  codex_deep_reasoner_effort: 'reasoner_target',
  codex_reviewer_model: 'reviewer_target',
  codex_reviewer_effort: 'reviewer_target',
  codex_fast_worker_timeout_secs: 'codex_worker_timeout_secs',
  codex_deep_reasoner_timeout_secs: 'codex_reasoner_timeout_secs',
  codex_bridge_timeout_secs: 'codex_reviewer_timeout_secs',
  architect_model: 'reasoner_target',
  architect_effort: 'reasoner_target',
};


// Source suite: dispatch-config.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const dispatchConfigModule = require('../scripts/lib/dispatch-config');
  const { applyDispatchConfig, createDispatchConfigReport, diagnoseDispatchConfig, resolveDispatchConfig, resolveRoleConfig } = dispatchConfigModule;
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

  test('REMOVED_KEYS is the frozen key-to-replacement table and the translation tables are gone', () => {
    assert.ok(Object.isFrozen(dispatchConfigModule.REMOVED_KEYS));
    assert.deepStrictEqual({ ...dispatchConfigModule.REMOVED_KEYS }, EXPECTED_REMOVED_KEYS);
    for (const name of ['LEGACY_KEYS', 'LEGACY_EFFORT_KEYS', 'LEGACY_KEY_AGENTS', 'translateLegacyTarget']) {
      assert.strictEqual(dispatchConfigModule[name], undefined, `${name} must not be exported`);
    }
  });

  test('every removed key in project, global, and environment yields a BLOCKED diagnostic and is never applied', () => {
    for (const [key, replacement] of Object.entries(EXPECTED_REMOVED_KEYS)) {
      for (const layer of ['project', 'global', 'environment']) {
        const result = resolveDispatchConfig({ [layer]: { [key]: 'codex' } });
        assert.deepStrictEqual(result.diagnostics, [{
          field: key,
          status: 'BLOCKED',
          layer,
          key,
          replacement,
          source: `${layer}.${key}`,
          reason: `removed in 0.69.0; use ${replacement}`,
        }], `${layer}.${key}`);
        for (const role of ['worker', 'reasoner', 'planner', 'reviewer']) {
          assert.strictEqual(result[`${role}_target`], null, `${layer}.${key} applied to ${role}`);
          assert.strictEqual(result.source[`${role}_target`], 'default');
        }
        assert.deepStrictEqual(result.preference_order, []);
        assert.strictEqual(result.fallback_allow, true);
        assert.strictEqual(result.source.preference_order, 'default');
        assert.strictEqual(result.source.fallback_allow, 'default');
        assert.deepStrictEqual(result.legacy_sources, []);
      }
    }
  });

  test('a removed key with an empty value is still reported, not silently ignored', () => {
    const result = resolveDispatchConfig({ project: { fast_worker_model: '' } });
    assert.strictEqual(result.diagnostics.length, 1);
    assert.strictEqual(result.diagnostics[0].source, 'project.fast_worker_model');
  });

  test('a removed key does not displace the canonical key and is still reported', () => {
    const result = resolveDispatchConfig({
      project: { worker_target: 'codex-cli/gpt-5.6-sol-high:high', codex_worker_model: 'gpt-6-luna' },
    });
    assert.deepStrictEqual(result.worker_target, { target_agent: 'codex-cli', model_id: 'gpt-5.6-sol-high', effort: 'high' });
    assert.strictEqual(result.source.worker_target, 'project.worker_target');
    assert.deepStrictEqual(result.diagnostics.map((entry) => entry.source), ['project.codex_worker_model']);
  });

  test('a clean configuration produces no removed-key diagnostic', () => {
    const result = resolveDispatchConfig({
      project: { worker_target: 'codex-cli/gpt-5.6-sol-high:high', codex_worker_timeout_secs: 90 },
      global: { fallback_allow: false, preference_order: 'codex-cli/gpt-5.6-sol-high' },
    });
    assert.deepStrictEqual(result.diagnostics, []);
  });

  test('role config comes from the canonical target and the surviving timeout key only', () => {
    const config = {
      worker_target: 'codex-cli/gpt-6-luna:xhigh',
      codex_worker_timeout_secs: '90',
      codex_worker_model: 'removed-model',
      codex_fast_worker_effort: 'removed-effort',
      codex_fast_worker_timeout_secs: '1',
    };
    assert.deepStrictEqual(resolveRoleConfig({ role: 'codex-worker', config }), {
      model: { value: 'gpt-6-luna', source: 'worker_target' },
      effort: { value: 'xhigh', source: 'worker_target' },
      timeout_secs: { value: '90', source: 'codex_worker_timeout_secs' },
    });
    const empty = resolveRoleConfig({ role: 'codex-reasoner', config: { codex_reasoner_model: 'removed', codex_deep_reasoner_timeout_secs: '5' } });
    assert.deepStrictEqual(empty, {
      model: { value: undefined, source: undefined },
      effort: { value: undefined, source: undefined },
      timeout_secs: { value: undefined, source: undefined },
    });
  });

  test('role config ignores a canonical target for a different Target Agent and blocks unknown roles', () => {
    const mismatch = resolveRoleConfig({ role: 'agy-worker', config: { worker_target: 'codex-cli/gpt-6-luna:xhigh' } });
    assert.strictEqual(mismatch.model.value, undefined);
    assert.strictEqual(mismatch.effort.value, undefined);
    const agy = resolveRoleConfig({ role: 'agy-worker', config: { worker_target: 'agy/gemini-3.8-flash-high' } });
    assert.deepStrictEqual(agy.model, { value: 'gemini-3.8-flash-high', source: 'worker_target' });
    assert.strictEqual(resolveRoleConfig({ role: 'no-such-role', config: {} }).status, 'BLOCKED');
    assert.strictEqual(resolveRoleConfig({ role: 'codex-worker', config: { worker_target: 'bare-model' } }).status, 'BLOCKED');
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
    assert.strictEqual(result.fallback, 'only UNAVAILABLE candidates advance; NOT_RUN and BLOCKED do not fall back');
  });

  test('string and object cursor-native config targets share one resolution and the ADR removal version', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { LEGACY_REMOVAL_VERSION } = require('../scripts/lib/dispatch-config');
    const adr = fs.readFileSync(path.join(__dirname, '../docs/adr/0020-provider-is-a-model-vendor-not-a-host-runtime.md'), 'utf8');
    const stringConfig = resolveDispatchConfig({ project: { worker_target: 'cursor-native/composer-2.5:medium' } });
    const providerObject = resolveDispatchConfig({ project: { worker_target: { provider: 'cursor-native', model_id: 'composer-2.5', effort: 'medium' } } });
    const agentObject = resolveDispatchConfig({ project: { worker_target: { target_agent: 'cursor-native', model_id: 'composer-2.5', effort: 'medium' } } });
    const expected = { target_agent: 'cursor', model_id: 'composer-2.5', effort: 'medium' };
    assert.deepStrictEqual(stringConfig.worker_target, expected);
    assert.deepStrictEqual(providerObject.worker_target, expected);
    assert.deepStrictEqual(agentObject.worker_target, expected);
    for (const config of [stringConfig, providerObject, agentObject]) {
      assert.ok(config.legacy_sources.some((entry) => entry.field === 'worker_target'
        && entry.diagnostic === 'legacy provider/route target spelling translated at input boundary'
        && entry.removal_version === '0.67.0')); // dhpk:historical-version-fixture
    }
    assert.strictEqual(LEGACY_REMOVAL_VERSION, '0.67.0'); // dhpk:historical-version-fixture
    assert.ok(adr.includes('0.67.0')); // dhpk:historical-version-fixture
    assert.ok(adr.includes('0.66.0 shipped'));
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

  test('effective role report presentation contract', () => {
    const claude = profiles.profiles.find((profile) => profile.host === 'claude-code');
    const config = resolveDispatchConfig({
      project: {
        worker_target: 'auto',
        reasoner_target: 'codex-cli/gpt-5.6-sol-high:high',
        planner_target: 'bare-model',
      },
    });
    const report = createDispatchConfigReport({ config, hostProfile: claude, catalog });
    const workerDefault = claude.role_defaults.worker;

    assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
    assert.strictEqual(report.orchestration_dispatch, 'on');
    assert.ok(report.targets);
    assert.ok(report.sources);
    assert.ok(Array.isArray(report.legacy_sources));
    assert.ok(Array.isArray(report.diagnostics));
    assert.strictEqual(report.status.catalog_support, 'NOT_RUN');
    assert.strictEqual(report.status.host_access, 'NOT_RUN');
    assert.strictEqual(report.status.runtime, 'NOT_RUN');
    assert.ok(Object.prototype.hasOwnProperty.call(report.status, 'fallback'));

    assert.strictEqual(report.roles.worker.configured_target, 'auto');
    assert.strictEqual(report.roles.worker.configured_source, 'project.worker_target');
    assert.strictEqual(report.roles.worker.effective_source, 'host_profile.role_defaults.worker');
    assert.notStrictEqual(report.roles.worker.configured_source, report.roles.worker.effective_source);
    assert.strictEqual(report.roles.worker.effective_target.target_agent, workerDefault.target_agent);
    assert.strictEqual(report.roles.worker.effective_target.provider, workerDefault.provider);
    assert.strictEqual(report.roles.worker.effective_target.model_id, workerDefault.model_id);
    assert.strictEqual(report.roles.worker.effective_target.effort, workerDefault.effort);
    assert.strictEqual(report.roles.worker.effective_target.route, workerDefault.route);

    assert.deepStrictEqual(report.roles.reasoner.configured_target, {
      target_agent: 'codex-cli',
      model_id: 'gpt-5.6-sol-high',
      effort: 'high',
    });
    assert.strictEqual(report.roles.reasoner.configured_source, 'project.reasoner_target');
    assert.strictEqual(report.roles.reasoner.effective_source, 'project.reasoner_target');
    assert.strictEqual(report.roles.reasoner.effective_target.target_agent, 'codex-cli');
    assert.strictEqual(report.roles.reasoner.effective_target.model_id, 'gpt-5.6-sol-high');
    assert.strictEqual(report.roles.reasoner.effective_target.effort, 'high');

    assert.notStrictEqual(report.roles.planner.configured_target, 'auto');
    assert.strictEqual(report.roles.planner.effective_target, null);
    assert.ok(report.diagnostics.some((entry) => entry.field === 'planner_target' && entry.status === 'BLOCKED'));
    assert.strictEqual(report.roles.worker.configured_target, 'auto');
    assert.deepStrictEqual(report.roles.reasoner.configured_target.target_agent, 'codex-cli');

    const unresolved = createDispatchConfigReport({ config });
    assert.strictEqual(unresolved.host.status, 'unresolved');
    assert.strictEqual(unresolved.host.execution, 'not executed');
    assert.strictEqual(unresolved.host.id, null);
    assert.strictEqual(unresolved.roles.worker.effective_target, null);

    assert.strictEqual(report.roles.worker.status.runtime, 'NOT_RUN');
    assert.notStrictEqual(report.roles.worker.status.runtime, 'AVAILABLE');
    assert.strictEqual(report.roles.worker.fallback.kind, 'candidate_policy');
    assert.strictEqual(report.roles.worker.fallback.selected, false);
    assert.strictEqual(report.roles.worker.fallback.executed, false);
    assert.ok(Array.isArray(report.roles.worker.fallback.candidates));
    assert.ok(report.roles.worker.fallback.candidates.length > 0);
    assert.strictEqual(report.roles.worker.fallback.allow, true);
  });

  test('applying a canonical role target keeps Effort top-level for the v2 request', () => {
    const config = resolveDispatchConfig({ project: { worker_target: 'codex-cli/gpt-5.6-luna-high:high', fallback_allow: true } });
    const applied = applyDispatchConfig({ config, role: 'worker', request: { task_id: 'task', effort: 'medium' } });
    assert.deepStrictEqual(applied.target, { target_agent: 'codex-cli', model_id: 'gpt-5.6-luna-high' });
    assert.strictEqual(applied.effort, 'high');
    assert.strictEqual(applied.fallback.allow, true);
  });

  const claude = profiles.profiles.find((profile) => profile.host === 'claude-code');

  test('architect keys are BLOCKED removed keys and do not change reasoner_target', () => {
    const config = resolveDispatchConfig({
      project: { architect_model: 'fable', architect_effort: 'low' },
    });
    assert.strictEqual(config.reasoner_target, null);
    assert.deepStrictEqual(config.diagnostics.map((entry) => [entry.status, entry.source, entry.replacement]), [
      ['BLOCKED', 'project.architect_model', 'reasoner_target'],
      ['BLOCKED', 'project.architect_effort', 'reasoner_target'],
    ]);
  });

  test('retired codex_deep_reasoner keys are BLOCKED removed keys naming reasoner_target', () => {
    const config = resolveDispatchConfig({
      project: { codex_deep_reasoner_model: 'gpt-6.1-sol', codex_deep_reasoner_effort: 'high' },
    });
    assert.strictEqual(config.reasoner_target, null);
    for (const key of ['codex_deep_reasoner_model', 'codex_deep_reasoner_effort']) {
      assert.ok(config.diagnostics.some((entry) => entry.status === 'BLOCKED' && entry.field === key
        && entry.source === `project.${key}` && /removed in 0\.69\.0; use reasoner_target/.test(entry.reason)));
    }
  });

  test('canonical reasoner_target still wins over a published Claude alias', () => {
    const config = resolveDispatchConfig({
      project: { reasoner_target: 'claude-code/opus5:high', deep_reasoner_model: 'sonnet' },
    });
    assert.deepStrictEqual(config.reasoner_target, { target_agent: 'claude-code', model_id: 'opus5', effort: 'high' });
    assert.strictEqual(config.source.reasoner_target, 'project.reasoner_target');
    const result = diagnoseDispatchConfig({
      config, catalog, hostProfile: claude, role: 'reasoner', authority: 'read-only', effort: 'high',
    });
    assert.strictEqual(result.catalog_support, 'SUPPORTED');
  });
}

// Source suite: dispatch-config-report.test.js
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { resolveDispatchConfig } = require('../scripts/lib/dispatch-config');
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

  function isolatedRoots() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-report-'));
    return {
      projectRoot,
      globalSettingsPath: path.join(projectRoot, 'missing-global-settings.json'),
      cleanup() { fs.rmSync(projectRoot, { recursive: true, force: true }); },
    };
  }

  function writePluginOptions(file, options) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ pluginConfigs: { 'dhpk@dhpk': { options } } })}\n`);
  }

  function readReport(environment, options) {
    const captured = captureStdout(() => main(environment, options));
    assert.strictEqual(captured.result, 0, captured.output);
    assert.ok(captured.output.endsWith('\n'), captured.output);
    const lines = captured.output.slice(0, -1).split(/\r?\n/u);
    assert.strictEqual(lines.length, 1, captured.output);
    return JSON.parse(lines[0]);
  }

  test('config report only emits for explicit non-default dispatch settings', () => {
    const roots = isolatedRoots();
    try {
      assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'auto' }), false);
      assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), true);
      assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL: 'sonnet' }), true);
      assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH: 'off' }), true);
      assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_FALLBACK_ALLOW: 'false' }), true);
      assert.strictEqual(shouldReport({ CLAUDE_PLUGIN_OPTION_PREFERENCE_ORDER: 'codex,claude' }), true);
      assert.strictEqual(shouldReport({
        CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'auto',
        CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH: 'on',
        CLAUDE_PLUGIN_OPTION_FALLBACK_ALLOW: 'true',
      }), false);
      assert.deepStrictEqual(environmentOptions({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }), {
        worker_target: 'codex-cli/sol5.6:high',
      });
      assert.deepStrictEqual(environmentOptions({
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL: 'sonnet',
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_EFFORT: 'high',
        CLAUDE_PLUGIN_OPTION_CODEX_DEEP_REASONER_MODEL: 'gpt-5.6-sol-high',
        CLAUDE_PLUGIN_OPTION_ARCHITECT_MODEL: 'opus',
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'codex,claude',
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'none',
      }), {
        fast_worker_model: 'sonnet',
        fast_worker_effort: 'high',
        codex_deep_reasoner_model: 'gpt-5.6-sol-high',
        architect_model: 'opus',
        fast_worker_backend_order: 'codex,claude',
        fast_worker_fallback: 'none',
      });
      const defaults = captureStdout(() => main({}, roots));
      assert.strictEqual(defaults.result, 0);
      assert.strictEqual(defaults.output, '');
    } finally {
      roots.cleanup();
    }
  });

  test('config report is bounded JSON and reports invalid values without failing startup', () => {
    const roots = isolatedRoots();
    try {
      const report = readReport({
        CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high',
      }, roots);
      assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
      assert.strictEqual(report.status.catalog_support, 'NOT_RUN');
      assert.strictEqual(report.status.runtime, 'NOT_RUN');
      assert.strictEqual(report.host.status, 'unresolved');
      assert.strictEqual(report.host.id, null);
      assert.deepStrictEqual(report.covered_inputs.layers, ['environment']);
      assert.strictEqual(report.covered_inputs.project, false);
      assert.strictEqual(report.covered_inputs.global, false);
      assert.strictEqual(report.covered_inputs.environment, true);
      assert.strictEqual(report.covered_inputs.complete, false);
      assert.strictEqual(report.covered_inputs.scope, 'environment-only');
      assert.strictEqual(report.covered_inputs.unreadable, undefined);

      const invalid = captureStdout(() => main({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'bare-model' }, roots));
      assert.strictEqual(invalid.result, 0);
      const invalidReport = JSON.parse(invalid.output);
      assert.strictEqual(invalidReport.schema, 'dhpk.dispatch.config-report.v1');
      assert.ok(invalidReport.diagnostics.some((entry) => entry.field === 'worker_target'));
    } finally {
      roots.cleanup();
    }
  });

  test('removed keys in project, global, and environment are BLOCKED in the report and never applied', () => {
    const roots = isolatedRoots();
    try {
      writePluginOptions(path.join(roots.projectRoot, '.claude', 'settings.local.json'), { fast_worker_model: 'sonnet' });
      writePluginOptions(roots.globalSettingsPath, { codex_worker_model: 'gpt-6-luna' });
      const report = readReport({ CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'codex' }, roots);
      assert.deepStrictEqual(
        report.diagnostics.map((entry) => [entry.status, entry.source, entry.replacement]).sort(),
        [
          ['BLOCKED', 'environment.fast_worker_backend', 'worker_target'],
          ['BLOCKED', 'global.codex_worker_model', 'worker_target'],
          ['BLOCKED', 'project.fast_worker_model', 'worker_target'],
        ],
      );
      assert.strictEqual(report.sources.worker_target, 'default');
      assert.strictEqual(report.targets.worker, null);
      assert.deepStrictEqual(report.legacy_sources, []);
      assert.strictEqual(report.roles.worker.configured_target, 'auto');
      assert.deepStrictEqual(report.covered_inputs.layers, ['project', 'global', 'environment']);
    } finally {
      roots.cleanup();
    }
  });

  test('a canonical key keeps its source while a removed key in a lower layer is still BLOCKED', () => {
    const roots = isolatedRoots();
    try {
      writePluginOptions(path.join(roots.projectRoot, '.claude', 'settings.local.json'), { worker_target: 'codex-cli/sol5.6:high' });
      writePluginOptions(roots.globalSettingsPath, { fast_worker_model: 'sonnet' });
      const report = readReport({ CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL: 'sonnet' }, roots);
      assert.strictEqual(report.sources.worker_target, 'project.worker_target');
      assert.deepStrictEqual(report.targets.worker, { target_agent: 'codex-cli', model_id: 'sol5.6', effort: 'high' });
      assert.deepStrictEqual(report.diagnostics.map((entry) => entry.source).sort(),
        ['environment.fast_worker_model', 'global.fast_worker_model']);
    } finally {
      roots.cleanup();
    }
  });

  test('environment removed keys are reported, and a project overlay is not relabeled as environment', () => {
    const roots = isolatedRoots();
    try {
      const report = readReport({ CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL: 'sonnet' }, roots);
      assert.deepStrictEqual(report.diagnostics.map((entry) => entry.source), ['environment.fast_worker_model']);

      writePluginOptions(path.join(roots.projectRoot, '.claude', 'settings.local.json'), {
        fast_worker_model: 'sonnet',
      });
      const overlaid = readReport({
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL: 'sonnet',
        DHPK_PROJECT_OPTION_FAST_WORKER_MODEL: 'sonnet',
      }, roots);
      assert.deepStrictEqual(overlaid.diagnostics.map((entry) => entry.source), ['project.fast_worker_model']);
    } finally {
      roots.cleanup();
    }
  });

  test('an empty-valued removed key in project settings still triggers a report', () => {
    const roots = isolatedRoots();
    try {
      writePluginOptions(path.join(roots.projectRoot, '.claude', 'settings.local.json'), { fast_worker_fallback: 'true' });
      const report = readReport({}, roots);
      assert.deepStrictEqual(report.diagnostics.map((entry) => entry.source), ['project.fast_worker_fallback']);
    } finally {
      roots.cleanup();
    }
  });

  test('removed keys block only themselves; invalid canonical values still block their role', () => {
    const roots = isolatedRoots();
    try {
      writePluginOptions(path.join(roots.projectRoot, '.claude', 'settings.local.json'), {
        worker_target: 'bare-model',
        reviewer_model: 'sonnet',
        codex_deep_reasoner_model: 'gpt-5.6-sol-high',
        architect_model: 'opus',
      });
      const report = readReport({}, roots);
      assert.ok(report.diagnostics.some((entry) => entry.field === 'worker_target' && entry.status === 'BLOCKED'));
      assert.strictEqual(report.roles.worker.configured_target, null);
      for (const key of ['reviewer_model', 'codex_deep_reasoner_model', 'architect_model']) {
        assert.ok(report.diagnostics.some((entry) => entry.field === key && entry.status === 'BLOCKED'), key);
      }
      assert.strictEqual(report.sources.reviewer_target, 'default');
      assert.strictEqual(report.roles.reviewer.configured_target, 'auto');
      assert.strictEqual(report.status.runtime, 'NOT_RUN');
      assert.strictEqual(report.host.status, 'unresolved');
    } finally {
      roots.cleanup();
    }
  });

  test('a missing settings file is absent, and an unreadable higher layer is not a complete result', () => {
    const missing = isolatedRoots();
    try {
      writePluginOptions(missing.globalSettingsPath, { worker_target: 'codex-cli/sol5.6:high' });
      const absent = readReport({}, missing);
      assert.strictEqual(absent.sources.worker_target, 'global.worker_target');
      assert.strictEqual(absent.covered_inputs.project, false);
      assert.strictEqual(absent.covered_inputs.global, true);
      assert.strictEqual(absent.covered_inputs.complete, false);
      assert.strictEqual(absent.covered_inputs.unreadable, undefined);
      assert.notStrictEqual(absent.covered_inputs.scope, 'incomplete');
      assert.notStrictEqual(absent.covered_inputs.scope, 'environment-only');
    } finally {
      missing.cleanup();
    }

    const invalid = isolatedRoots();
    try {
      fs.mkdirSync(path.join(invalid.projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(invalid.projectRoot, '.claude', 'settings.local.json'), '{');
      writePluginOptions(invalid.globalSettingsPath, { worker_target: 'codex-cli/sol5.6:high' });
      const report = readReport({ CLAUDE_PLUGIN_OPTION_REVIEWER_TARGET: 'codex-cli/sol5.6:high' }, invalid);
      assert.strictEqual(report.sources.worker_target, 'global.worker_target');
      assert.strictEqual(report.sources.reviewer_target, 'environment.reviewer_target');
      assert.strictEqual(report.covered_inputs.project, false);
      assert.strictEqual(report.covered_inputs.complete, false);
      assert.strictEqual(report.covered_inputs.scope, 'incomplete');
      assert.deepStrictEqual(report.covered_inputs.unreadable, [{ layer: 'project', reason: 'invalid-json' }]);
    } finally {
      invalid.cleanup();
    }
  });

  const SUMMARY_PREFIX = '[session-start] dispatch config: ';

  function readSummary(environment, options) {
    const captured = captureStdout(() => main(environment, { ...options, format: 'summary' }));
    assert.strictEqual(captured.result, 0, captured.output);
    assert.ok(captured.output.endsWith('\n'), captured.output);
    const body = captured.output.slice(0, -1);
    assert.ok(!body.includes('\n'), body);
    return body;
  }

  test('summary format fits 300 chars with prefix for four long roles plus legacy keys', () => {
    const roots = isolatedRoots();
    try {
      const long = 'x'.repeat(40);
      const body = readSummary({
        CLAUDE_PLUGIN_OPTION_PLANNER_TARGET: `claude-code/anthropic/planner-${long}:high`,
        CLAUDE_PLUGIN_OPTION_REASONER_TARGET: `codex-cli/openai/reasoner-${long}:xhigh`,
        CLAUDE_PLUGIN_OPTION_WORKER_TARGET: `agy/google/worker-${long}:medium`,
        CLAUDE_PLUGIN_OPTION_REVIEWER_TARGET: `codex-cli/openai/reviewer-${long}:high`,
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL: 'sonnet',
        CLAUDE_PLUGIN_OPTION_FAST_WORKER_EFFORT: 'high',
        CLAUDE_PLUGIN_OPTION_DEEP_REASONER_MODEL: 'opus',
        CLAUDE_PLUGIN_OPTION_PLANNER_MODEL: 'opus',
        CLAUDE_PLUGIN_OPTION_REVIEWER_MODEL: 'opus',
        CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH: 'off',
        CLAUDE_PLUGIN_OPTION_FALLBACK_ALLOW: 'false',
      }, roots);
      assert.ok(`${SUMMARY_PREFIX}${body}`.length <= 300, `${SUMMARY_PREFIX}${body}`.length);
      assert.ok(!body.includes('; full:'), body);
      assert.ok(body.includes('dispatch=off'), body);
      assert.ok(body.includes('fallback=deny'), body);
      assert.ok(body.includes('worker='), body);
      assert.ok(body.includes('blocked='), body);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format with every removed key stays within 300 chars and the full file lists them all', () => {
    const roots = isolatedRoots();
    try {
      const environment = {};
      for (const key of Object.keys(EXPECTED_REMOVED_KEYS)) environment[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] = 'x';
      const fullOut = path.join(roots.projectRoot, 'removed.json');
      const body = readSummary(environment, { ...roots, fullOut });
      assert.ok(`${SUMMARY_PREFIX}${body}`.length <= 300, `${SUMMARY_PREFIX}${body}`.length);
      assert.ok(body.includes(`blocked=${Object.keys(EXPECTED_REMOVED_KEYS).length}`), body);
      assert.ok(!body.includes('{'), body);
      const full = JSON.parse(fs.readFileSync(fullOut, 'utf8'));
      assert.deepStrictEqual(full.diagnostics.map((entry) => entry.key).sort(), Object.keys(EXPECTED_REMOVED_KEYS).sort());
    } finally {
      roots.cleanup();
    }
  });

  test('summary format with a clean configuration has no blocked token', () => {
    const roots = isolatedRoots();
    try {
      const body = readSummary({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }, roots);
      assert.ok(!body.includes('blocked='), body);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format names a configured role with agent, model and effort', () => {
    const roots = isolatedRoots();
    try {
      const body = readSummary({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }, roots);
      assert.ok(body.startsWith('worker=codex-cli/sol5.6:high'), body);
      assert.ok(!body.includes('{'), body);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format lists a lone removed key by layer with its replacement', () => {
    const roots = isolatedRoots();
    try {
      const envBody = readSummary({ CLAUDE_PLUGIN_OPTION_FAST_WORKER_EFFORT: 'high' }, roots);
      assert.ok(envBody.includes('blocked=environment.fast_worker_effort->worker_target'), envBody);
      assert.ok(!envBody.includes('legacy='), envBody);
      writePluginOptions(path.join(roots.projectRoot, '.claude', 'settings.local.json'), { fast_worker_effort: 'high' });
      const projectBody = readSummary({}, roots);
      assert.ok(projectBody.includes('blocked=project.fast_worker_effort->worker_target'), projectBody);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format marks an unreadable settings layer as incomplete scope', () => {
    const roots = isolatedRoots();
    try {
      fs.mkdirSync(path.join(roots.projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(roots.projectRoot, '.claude', 'settings.local.json'), '{');
      const body = readSummary({}, roots);
      assert.ok(body.includes('scope=incomplete(project:invalid-json)'), body);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format says defaults when forced with nothing non-default', () => {
    const roots = isolatedRoots();
    try {
      const body = readSummary({ DHPK_DISPATCH_CONFIG_REPORT: '1' }, roots);
      assert.ok(body.startsWith('defaults'), body);
      const silent = captureStdout(() => main({}, { ...roots, format: 'summary' }));
      assert.strictEqual(silent.output, '');
    } finally {
      roots.cleanup();
    }
  });

  test('summary format with fullOut writes the full JSON and names its relative path', () => {
    const roots = isolatedRoots();
    const cwd = process.cwd();
    try {
      const fullOut = path.join(cwd, 'tmp-dhpk-fullout-test', 'nested', 'dispatch-config.json');
      try {
        const body = readSummary({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }, { ...roots, fullOut });
        assert.ok(body.endsWith(`; full: ${path.relative(cwd, fullOut)}`), body);
        const raw = fs.readFileSync(fullOut, 'utf8');
        assert.ok(raw.endsWith('\n'), 'trailing newline');
        assert.strictEqual(JSON.parse(raw).schema, 'dhpk.dispatch.config-report.v1');
      } finally {
        fs.rmSync(path.join(cwd, 'tmp-dhpk-fullout-test'), { recursive: true, force: true });
      }
    } finally {
      roots.cleanup();
    }
  });

  test('summary format with an absolute fullOut outside cwd shows the absolute path', () => {
    const roots = isolatedRoots();
    try {
      const fullOut = path.join(roots.projectRoot, 'out', 'report.json');
      const body = readSummary({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }, { ...roots, fullOut });
      assert.ok(path.relative(process.cwd(), fullOut).startsWith('..') || path.isAbsolute(path.relative(process.cwd(), fullOut)));
      assert.ok(body.endsWith(`; full: ${fullOut}`), body);
      assert.ok(fs.existsSync(fullOut));
    } finally {
      roots.cleanup();
    }
  });

  test('summary format without fullOut carries no full-report hint', () => {
    const roots = isolatedRoots();
    try {
      const body = readSummary({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }, roots);
      assert.ok(!body.includes('full:'), body);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format omits the hint and still exits 0 when fullOut is unwritable', () => {
    const roots = isolatedRoots();
    try {
      const blocker = path.join(roots.projectRoot, 'regular-file');
      fs.writeFileSync(blocker, 'x');
      const body = readSummary({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' },
        { ...roots, fullOut: path.join(blocker, 'sub', 'report.json') });
      assert.ok(body.startsWith('worker=codex-cli/sol5.6:high'), body);
      assert.ok(!body.includes('full:'), body);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format keeps 300 chars with a long fullOut hint and drops the hint when it alone cannot fit', () => {
    const roots = isolatedRoots();
    try {
      const long = 'x'.repeat(40);
      const env = {
        CLAUDE_PLUGIN_OPTION_PLANNER_TARGET: `claude-code/anthropic/planner-${long}:high`,
        CLAUDE_PLUGIN_OPTION_WORKER_TARGET: `agy/google/worker-${long}:medium`,
      };
      const fullOut = path.join(roots.projectRoot, 'a'.repeat(40), 'report.json');
      const body = readSummary(env, { ...roots, fullOut });
      assert.ok(`${SUMMARY_PREFIX}${body}`.length <= 300, `${SUMMARY_PREFIX}${body}`.length);
      assert.ok(body.endsWith(`; full: ${fullOut}`), body);
      const huge = path.join(roots.projectRoot, 'b'.repeat(400), 'report.json');
      const dropped = readSummary(env, { ...roots, fullOut: huge });
      assert.ok(`${SUMMARY_PREFIX}${dropped}`.length <= 300, `${SUMMARY_PREFIX}${dropped}`.length);
      assert.ok(!dropped.includes('full:'), dropped);
    } finally {
      roots.cleanup();
    }
  });

  test('summary format with diagnostics prints full JSON and also writes fullOut', () => {
    const roots = isolatedRoots();
    try {
      const fullOut = path.join(roots.projectRoot, 'diag.json');
      const captured = captureStdout(() => main({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'bare-model' }, { ...roots, format: 'summary', fullOut }));
      assert.strictEqual(JSON.parse(captured.output).schema, 'dhpk.dispatch.config-report.v1');
      assert.strictEqual(JSON.parse(fs.readFileSync(fullOut, 'utf8')).schema, 'dhpk.dispatch.config-report.v1');
    } finally {
      roots.cleanup();
    }
  });

  test('summary format falls back to full JSON when diagnostics are present', () => {
    const roots = isolatedRoots();
    try {
      const captured = captureStdout(() => main({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'bare-model' }, { ...roots, format: 'summary' }));
      const parsed = JSON.parse(captured.output);
      assert.strictEqual(parsed.schema, 'dhpk.dispatch.config-report.v1');
      assert.ok(parsed.diagnostics.length > 0);
    } finally {
      roots.cleanup();
    }
  });

  test('default format keeps the full JSON report', () => {
    const roots = isolatedRoots();
    try {
      const report = readReport({ CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high' }, roots);
      assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
    } finally {
      roots.cleanup();
    }
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

  test('v1 compatibility translation preserves canonical provider role without pinning Provider', () => {
    const translated = translateLegacyRequest({
      schema: 'dhpk.cli.request.v1',
      host_profile: HOST_PROFILE,
      task_id: 'legacy-task-1',
      attempt_id: 'legacy-attempt-1',
      requested_role: 'codex-worker',
      mode: 'workspace-write',
      model: 'gpt-5.6-luna',
      effort: 'high',
      task: { description_digest: 'c'.repeat(64) },
      scope: request().scope,
    });
    assert.strictEqual(translated.request.schema, SCHEMAS.REQUEST);
    assert.strictEqual(translated.request.role, 'worker');
    assert.strictEqual(translated.request.target, undefined);
    assert.strictEqual(translated.compatibility.requested_alias, 'codex-worker');
    assert.strictEqual(translated.compatibility.canonical_role, 'worker');
    assert.strictEqual(translated.compatibility.provider_constraint, null);
    assert.strictEqual(translated.compatibility.deprecated, true);
  });

  test('the retired codex-bridge legacy request is rejected for every mode', () => {
    for (const mode of [undefined, 'read-only', 'workspace-write']) {
      assert.throws(() => translateLegacyRequest({
        schema: 'dhpk.cli.context.v1', host_profile: HOST_PROFILE,
        task_id: 'legacy-task-2', attempt_id: 'legacy-attempt-2',
        requested_role: 'codex-bridge', mode,
        task: { description_digest: 'd'.repeat(64) }, scope: request().scope,
      }), /unknown legacy role/);
    }
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
      requested_role: 'codex-worker',
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
      requested_role: 'codex-worker', mode: 'workspace-write', model: 'gpt-5.6-luna', effort: 'high',
      task: { description_digest: 'a'.repeat(64) },
      scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    });
    assert.strictEqual(translated.compatibility.provider_constraint, null);
    assert.strictEqual(translated.request.target, undefined);
    assert.match(translated.compatibility.diagnostic, /explicit target/i);
  });
}

// Source suite: issue-534-p1-failure-matrix.test.js
{
  const { test, assert } = require('./_lib/tinytest');
  const { resolveTarget, decideFallback, FAILURE_CLASSES } = require('../scripts/lib/dispatch-engine');
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

  test('partial writes, missing tools, and timeout stay on their safety paths', () => {
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

test('recovery candidates retain binding, authority, scope and strict target independently of the public Host policy', () => {
  const initialRequest = request(codexProfile, {
    role: 'worker', authority: 'workspace-write', strict_target: true, effort: 'max',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna' },
    execution_binding: { session_id: 'recovery-session', binding_id: 'recovery-binding' },
    scope: { workdir: '/workspace/project', assigned_files: ['src/receipt.js'],
      prompt_evidence: { path: '/workspace/project/prompt.txt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
  });
  const resolution = resolveTarget(initialRequest, { catalog });
  assert.strictEqual(resolution.status, 'RESOLVED');
  const normalized = resolution.request;
  const reconciliation = { status: 'PASSED', task_id: normalized.task_id, attempt_id: normalized.attempt_id,
    scope_contained: true, wip_preserved: true, diff_verified: true, out_of_scope: [] };
  for (const changes of [
    { target: { ...normalized.target, model_id: 'gpt-6.1-sol' } },
    { effort: 'high' },
    { execution_binding: { session_id: 'foreign-session', binding_id: 'foreign-binding' } },
    { authority: 'read-only' },
    { scope: { ...normalized.scope, assigned_files: ['src/receipt.js', 'outside.js'] } },
    { host_profile: { ...normalized.host_profile, native_model: 'gpt-6-sol' } },
  ]) {
    const candidate = { ...normalized, ...changes };
    const result = decideFallback({ request: normalized, resolution, catalog,
      failureClass: FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE, sideEffects: 'observed',
      candidate_request: candidate, reconciliation, recovery_action: 'repair' });
    assert.strictEqual(result.status, 'BLOCKED');
    assert.strictEqual(result.retry_budget_remaining, 1);
  }
});


function t7NativeEvidence(overrides = {}) {
  return { kind: 'host-executable-capability', state: 'EXPOSED', status: 'AVAILABLE', source: 'host-tool',
    observed_at: '2026-10-08T00:00:00Z', session_id: 't7-session', binding_id: 't7-binding', host: 'codex-cli',
    provider: 'openai', target_agent: 'codex-cli', model_id: null, role: 'reasoner', authority: 'read-only',
    effort: null, effort_binding: 'unsupported', route: 'native', transport: 'native-runtime', ...overrides };
}

test('T7 canonical executable evidence cannot override explicit Host refusal', () => {
  const result = resolveTarget(request({ ...codexProfile, access: { ...codexProfile.access,
    openai: { status: 'BLOCKED', evidence: 'refused' } } }, {
    target: { target_agent: 'codex-cli', provider: 'openai' }, effort: undefined,
    execution_binding: { session_id: 't7-session', binding_id: 't7-binding' }, capability_evidence: t7NativeEvidence(),
  }), { catalog });
  assert.strictEqual(result.status, 'BLOCKED');
});

test('T7 native null and exposed selector preserve unknown observations through adapters', () => {
  const { createExecutionTarget } = require('../scripts/lib/dispatch-contract');
  const { createExecutionAdapter } = require('../scripts/lib/provider-adapter');
  for (const model of [null, 'host-default-alias']) {
    const input = request(codexProfile, { target: { target_agent: 'codex-cli', provider: 'openai', model_id: model }, effort: undefined,
      execution_binding: { session_id: 't7-session', binding_id: 't7-binding' }, capability_evidence: t7NativeEvidence({ model_id: model }) });
    const resolved = resolveTarget(input, { catalog });
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.strictEqual(resolved.target.model_id, model); assert.strictEqual(resolved.target.native, true);
    assert.strictEqual(resolved.target.identity, model === null ? null : `codex-cli/${model}`);
    assert.strictEqual(resolved.capability.observed_model, null); assert.strictEqual(resolved.capability.observed_effort, null);
    const normalized = createExecutionTarget({ ...resolved.target, allow_unknown_model: true, allow_unknown_effort: true });
    assert.strictEqual(normalized.model_id, model);
    const adapter = createExecutionAdapter({ provider: 'openai', execute: () => ({ status: 'SUCCEEDED', verification: 'PASSED' }) });
    const receipt = adapter.execute(resolved.target, resolved.request).receipt;
    assert.strictEqual(receipt.resolved_target.model_id, model);
  }
  assert.strictEqual(createExecutionTarget({ target_agent: 'codex-cli', provider: 'openai', effort: 'high', transport: 'local-cli' }).model_id, 'unknown');
  assert.throws(() => createExecutionTarget({ target_agent: 'codex-cli', provider: 'openai', model_id: null, effort: 'high',
    transport: 'local-cli', allow_unknown_model: true }));
});


test('T7 explicit nullable foreign and transport-conflicting targets stay blocked', () => {
  for (const target of [
    { target_agent: 'codex-cli', provider: 'openai', model_id: null, transport: 'local-cli' },
    { target_agent: 'claude-code', provider: 'anthropic', model_id: null },
  ]) {
    const result = resolveTarget(request(codexProfile, { target, effort: undefined,
      execution_binding: { session_id: 't7-session', binding_id: 't7-binding' },
      capability_evidence: t7NativeEvidence({ target_agent: target.target_agent, provider: target.provider, model_id: 'concrete-host-selector' }),
    }), { catalog });
    assert.strictEqual(result.status, 'BLOCKED');
  }
});


test('T7 observed invocation availability keeps selector distinct from explicit observed identity', () => {
  for (const observed of [false, true]) {
    const result = resolveTarget(request(codexProfile, { target: { provider: 'openai', target_agent: 'codex-cli', model_id: 'dynamic-alias' }, effort: undefined,
      execution_binding: { session_id: 't7-session', binding_id: 't7-binding' },
      capability_evidence: t7NativeEvidence({ state: 'OBSERVED_AVAILABLE', model_id: 'dynamic-alias',
        ...(observed ? { observed_model: 'actual-host-model', observed_effort: 'high' } : {}) }),
    }), { catalog });
    assert.strictEqual(result.status, 'RESOLVED');
    assert.strictEqual(result.target.model_id, 'dynamic-alias');
    assert.strictEqual(result.capability.observed_model, observed ? 'actual-host-model' : null);
    assert.strictEqual(result.capability.observed_effort, observed ? 'high' : null);
  }
});

test('T7 explicit null Model cannot fall back to a static default without current bound capability', () => {
  const result = resolveTarget(request(codexProfile, { target: { target_agent: 'codex-cli', provider: 'openai', model_id: null } }), { catalog });
  assert.strictEqual(result.status, 'BLOCKED');
});

// Source suite: role-default-resolution-contract (tasks 5.3, 5.3a, 5.4, 5.5)
{
  const fs = require('node:fs');
  const path = require('node:path');
  const contract = require('../scripts/lib/dispatch-contract');
  const { test, assert } = require('./_lib/tinytest');
  const ROOT = path.join(__dirname, '..');
  const CLI_ROLE_AGENTS = ['codex-worker', 'codex-reasoner', 'codex-reviewer', 'agy-worker'];
  const RETIRED = [
    ['codex-fast-worker', 'codex-worker'],
    ['codex-deep-reasoner', 'codex-reasoner'],
    ['agy-fast-worker', 'agy-worker'],
  ];

  test('CLI Role Agents are absent from ROLE_ALIASES and the catalog role_aliases', () => {
    for (const name of CLI_ROLE_AGENTS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(contract.ROLE_ALIASES, name), `ROLE_ALIASES.${name}`);
      assert.ok(!Object.prototype.hasOwnProperty.call(catalog.role_aliases, name), `catalog.role_aliases.${name}`);
    }
  });

  test('LEGACY_ROLE_ALIASES is removed from the contract', () => {
    assert.strictEqual(contract.LEGACY_ROLE_ALIASES, undefined);
    assert.ok(!fs.readFileSync(path.join(ROOT, 'scripts/lib/dispatch-contract.js'), 'utf8').includes('LEGACY_ROLE_ALIASES'));
  });

  test('CLI Role Agent names still translate through a legacy request with canonical Role and authority only', () => {
    for (const [name, role, authority] of [['codex-worker', 'worker', 'workspace-write'], ['codex-reasoner', 'reasoner', 'read-only'], ['agy-worker', 'worker', 'workspace-write']]) {
      const translated = contract.translateLegacyRequest({
        schema: 'dhpk.cli.request.v1', host_profile: codexProfile, task_id: 'cli-role-1', attempt_id: 'cli-role-a1',
        requested_role: name, mode: authority, effort: 'high',
        task: { description_digest: 'a'.repeat(64) }, scope: request(codexProfile).scope,
      });
      assert.strictEqual(translated.request.role, role, name);
      assert.strictEqual(translated.compatibility.canonical_role, role, name);
      assert.strictEqual(translated.compatibility.provider_constraint, null, name);
    }
  });

  test('retired role names stay BLOCKED with the successor at the catalog and legacy request paths', () => {
    for (const [retired, successor] of RETIRED) {
      assert.deepStrictEqual(contract.RETIRED_ROLES[retired], successor);
      assert.throws(() => contract.translateLegacyRequest({ schema: 'dhpk.cli.request.v1', requested_role: retired }),
        new RegExp(`retired role ${retired}.*use ${successor}.*0\\.66\\.1`));
      assert.throws(() => contract.createProviderModelCatalog({ ...catalog, role_aliases: { [retired]: { role: 'worker', authority: 'workspace-write' } } }),
        new RegExp(`retired role ${retired}.*use ${successor}.*0\\.66\\.1`));
    }
  });

  test('retired role names are BLOCKED by the CLI role resolver and the selector', () => {
    const { resolveRole } = require('../scripts/cli-dispatch/dispatch-runtime/cli-role-resolver');
    const selector = require('../scripts/fast-worker-selector');
    for (const [retired, successor] of RETIRED) {
      const resolved = resolveRole({ requestedRole: retired, mode: retired.startsWith('codex-deep') ? 'read-only' : 'workspace-write' });
      assert.strictEqual(resolved.status, 'BLOCKED');
      assert.ok(resolved.reason.includes(successor));
      for (const result of [selector.select({ backend: retired }), selector.run(['--backend', retired], {})]) {
        assert.strictEqual(result.status, 'BLOCKED', retired);
        assert.ok(result.reason.includes(successor), result.reason);
        assert.ok(result.reason.includes('0.66.1'), result.reason);
      }
    }
  });

  test('the two alias tables are exported frozen from the contract with the specified entries', () => {
    assert.ok(Object.isFrozen(contract.TARGET_AGENT_ALIASES));
    assert.deepStrictEqual({ ...contract.TARGET_AGENT_ALIASES }, {
      claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex-cli', 'codex-cli': 'codex-cli', agy: 'agy', cursor: 'cursor',
    });
    assert.ok(Object.isFrozen(contract.AGENT_PROVIDER));
    assert.deepStrictEqual({ ...contract.AGENT_PROVIDER }, {
      'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', cursor: 'cursor',
    });
  });

  test('no module defines its own alias, vendor, or role-alias table', () => {
    const forbidden = [
      'PROVIDER_ALIASES', 'ADAPTER_PROVIDER_ALIASES', 'AGENT_PROVIDERS', 'LEGACY_VENDOR_MAP',
      'TARGET_AGENT_PROVIDERS', 'LEGACY_ROLE_ALIASES',
    ];
    const literals = [/'claude-code'\s*:\s*'anthropic'/, /'codex-cli'\s*:\s*'openai'/, /\bagy\s*:\s*'google'/, /\bcodex\s*:\s*'codex-cli'/, /\bclaude\s*:\s*'claude-code'/];
    const files = ['scripts/lib/dispatch-engine.js', 'scripts/lib/provider-adapter.js', 'scripts/lib/dispatch-config.js',
      'scripts/cli-dispatch/dispatch-runtime/cli-role-resolver.js', 'scripts/fast-worker-selector.js'];
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const name of forbidden) assert.ok(!source.includes(name), `${file} defines ${name}`);
      for (const pattern of literals) assert.ok(!pattern.test(source), `${file} repeats the alias/vendor table ${pattern}`);
    }
    const contractSource = fs.readFileSync(path.join(ROOT, 'scripts/lib/dispatch-contract.js'), 'utf8');
    for (const name of forbidden) assert.ok(!contractSource.includes(name), `dispatch-contract.js defines ${name}`);
    assert.strictEqual((contractSource.match(/'codex-cli'\s*:\s*'openai'/g) || []).length, 1, 'one vendor table in the contract');
  });

  const ROLE_DEFAULT_PINS = {
    cursor: {
      planner: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5-high', effort: 'high' },
      reasoner: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5-high', effort: 'high' },
      worker: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'medium' },
      reviewer: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', effort: 'high' },
    },
    agy: {
      planner: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.1-pro-high', effort: 'high' },
      reasoner: { target_agent: 'agy', provider: 'anthropic', model_id: 'claude-opus-4-6-thinking', effort: 'high' },
      worker: { target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high', effort: 'high' },
      reviewer: { target_agent: 'agy', provider: 'anthropic', model_id: 'claude-opus-4-6-thinking', effort: 'high' },
    },
  };

  // A mixed default names its target but stays NOT_RUN until session-bound capability evidence exists.
  const ROLE_DEFAULT_STATUS = {
    cursor: { planner: 'NOT_RUN', reasoner: 'NOT_RUN', worker: 'RESOLVED', reviewer: 'NOT_RUN' },
    agy: { planner: 'RESOLVED', reasoner: 'NOT_RUN', worker: 'RESOLVED', reviewer: 'NOT_RUN' },
  };

  test('cursor and agy mixed Role Defaults are pinned in the Host profiles', () => {
    for (const [host, roles] of Object.entries(ROLE_DEFAULT_PINS)) {
      const profile = profiles.profiles.find((entry) => entry.host === host);
      for (const [role, pin] of Object.entries(roles)) {
        const actual = profile.role_defaults[role];
        assert.deepStrictEqual({
          target_agent: actual.target_agent, provider: actual.provider, model_id: actual.model_id, effort: actual.effort,
        }, pin, `${host}.${role}`);
        assert.strictEqual(actual.route, 'native', `${host}.${role}.route`);
        assert.strictEqual(actual.transport, 'native-runtime', `${host}.${role}.transport`);
      }
    }
  });

  test('cursor and agy resolve their pinned Role Default per Role without an explicit target', () => {
    for (const [host, roles] of Object.entries(ROLE_DEFAULT_PINS)) {
      const profile = profiles.profiles.find((entry) => entry.host === host);
      for (const [role, pin] of Object.entries(roles)) {
        const result = resolveTarget(request(profile, {
          role, authority: role === 'worker' ? 'workspace-write' : 'read-only', effort: pin.effort,
        }), { catalog });
        assert.strictEqual(result.status, ROLE_DEFAULT_STATUS[host][role], `${host}.${role}: ${result.reason}`);
        assert.deepStrictEqual({
          target_agent: result.target.target_agent, provider: result.target.provider,
          model_id: result.target.model_id, effort: result.target.effort,
        }, pin, `${host}.${role}`);
      }
    }
  });
}


run('dispatch-engine');
