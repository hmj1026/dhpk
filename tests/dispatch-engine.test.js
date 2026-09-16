'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  FAILURE_CLASSES,
  decideFallback,
  resolveTarget,
} = require('../scripts/lib/dispatch-engine');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');
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
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-thinking-high', route: 'native', transport: 'native-runtime' },
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.deepStrictEqual(result.target, {
    target_agent: 'claude-code',
    provider: 'anthropic',
    model_id: 'claude-opus-5-thinking-high',
    model: 'claude-opus-5-thinking-high',
    effort: 'high',
    route: 'native',
    transport: 'native-runtime',
    native: false,
    identity: 'claude-code/claude-opus-5-thinking-high',
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
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-thinking-high', route: 'native', transport: 'native-runtime' },
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
  assert.strictEqual(result.target.identity, 'claude-code/claude-opus-5-thinking-high');
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
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'opus5', route: 'headless-cli', transport: 'local-cli' },
  }), { catalog });
  const result = decideFallback({
    request: initial.request,
    resolution: initial,
    failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'codex-cli/gpt-5.6-sol');
  assert.strictEqual(result.target.native, true);
});

run('dispatch-engine');
