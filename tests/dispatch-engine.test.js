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

const request = (hostProfile, overrides = {}) => ({
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
});

test('explicit Cursor to Codex Sol 5.6 target preserves the neutral Role', () => {
  const availableCursor = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      'codex-cli': { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = resolveTarget(request(availableCursor, {
    target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' },
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.capability.status, 'AVAILABLE');
  assert.deepStrictEqual(result.target, {
    provider: 'codex-cli',
    model: 'sol5.6',
    effort: 'high',
    transport: 'local-cli',
    native: false,
    identity: 'codex-cli/sol5.6',
  });
  assert.strictEqual(result.request.role, 'reasoner');
});

test('explicit Cursor to Claude Code Opus 5 target preserves Provider-scoped Model and Transport', () => {
  const availableCursor = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      'claude-code': { status: 'AVAILABLE', evidence: 'bounded Claude CLI probe' },
    },
  };
  const result = resolveTarget(request(availableCursor, {
    target: { provider: 'claude-code', model: 'opus5', transport: 'local-cli' },
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.deepStrictEqual(result.target, {
    provider: 'claude-code',
    model: 'opus5',
    effort: 'high',
    transport: 'local-cli',
    native: false,
    identity: 'claude-code/opus5',
  });
  assert.strictEqual(result.request.role, 'reasoner');
  assert.strictEqual(result.request.authority, 'read-only');
});

test('explicit target is blocked when the Host policy denies its Provider', () => {
  const denied = {
    ...cursorProfile,
    allowed_providers: ['cursor-native', 'codex-cli'],
    access: {
      ...cursorProfile.access,
      'claude-code': { status: 'BLOCKED', evidence: 'Host policy denies Claude Code' },
    },
  };
  const result = resolveTarget(request(denied, {
    target: { provider: 'claude-code', model: 'opus5', transport: 'local-cli' },
  }), { catalog });

  assert.strictEqual(result.status, 'BLOCKED');
  assert.ok(result.reason.includes('does not allow Provider claude-code'));
  assert.strictEqual(result.probe_performed, false);
});

test('automatic selection prefers the declared Host-native target when available', () => {
  const availableNative = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      'cursor-native': { status: 'AVAILABLE', evidence: 'native runtime ready' },
      'codex-cli': { status: 'AVAILABLE', evidence: 'external CLI ready' },
    },
  };
  const result = resolveTarget(request(availableNative, {
    role: 'worker',
    authority: 'workspace-write',
  }), { catalog });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'cursor-native/cursor-default');
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
    provider: 'agy',
    model: 'gemini-3.8-flash-high',
    effort: 'high',
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

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'cursor-native/cursor-default');
  assert.ok(result.rejected_candidates.some((candidate) => candidate.provider === 'codex-cli' && candidate.status === 'NOT_RUN'));
});

test('configured external preference selects an available Codex target', () => {
  const available = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      'codex-cli': { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = resolveTarget(request(available), {
    catalog,
    preferenceOrder: ['codex-cli', 'cursor-native'],
  });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(result.request.role, 'reasoner');
});

test('Provider-scoped preference entries may carry an explicit normalized Effort', () => {
  const available = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      'codex-cli': { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = resolveTarget(request(available), {
    catalog,
    preferenceOrder: [{ provider: 'codex-cli', model: 'sol5.6', effort: 'high' }, 'cursor-native'],
  });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(result.target.effort, 'high');
});

test('explicit unknown Model is unavailable and is never inferred from another Provider', () => {
  const result = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, 'codex-cli': { status: 'AVAILABLE', evidence: 'ready' } },
  }, {
    target: { provider: 'codex-cli', model: 'opus5', transport: 'local-cli' },
  }), { catalog });

  assert.strictEqual(result.status, 'UNAVAILABLE');
  assert.ok(result.reason.includes('codex-cli/opus5'));
});

test('automatic selection requires Host policy opt-in for an external Provider', () => {
  const restricted = {
    ...cursorProfile,
    allowed_providers: ['cursor-native'],
    access: {
      'cursor-native': { status: 'AVAILABLE', evidence: 'native runtime ready' },
    },
    quota_pools: { 'cursor-native': 'native' },
    concurrency_limits: { native: 1 },
  };
  const result = resolveTarget(request(restricted), {
    catalog,
    preferenceOrder: ['codex-cli', 'cursor-native'],
  });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.target.identity, 'cursor-native/cursor-default');
  assert.strictEqual(result.rejected_candidates[0].status, 'BLOCKED');
});

test('unsupported Role and Effort are reported instead of silently downgraded', () => {
  const roleResult = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, agy: { status: 'AVAILABLE', evidence: 'ready' } },
  }, {
    role: 'reviewer',
    authority: 'read-only',
    target: { provider: 'agy', model: 'gemini-3.8-flash-high', transport: 'local-cli' },
  }), { catalog });
  assert.strictEqual(roleResult.status, 'UNAVAILABLE');

  const effortResult = resolveTarget(request({
    ...cursorProfile,
    access: { ...cursorProfile.access, agy: { status: 'AVAILABLE', evidence: 'ready' } },
  }, {
    role: 'worker',
    authority: 'workspace-write',
    effort: 'max',
    target: { provider: 'agy', model: 'gemini-3.8-flash-high', transport: 'local-cli' },
  }), { catalog });
  assert.strictEqual(effortResult.status, 'UNAVAILABLE');
  assert.ok(/effort/i.test(effortResult.reason));
});

test('unavailable explicit target may use contextual native fallback before side effects', () => {
  const unavailable = {
    ...cursorProfile,
    access: {
      ...cursorProfile.access,
      'codex-cli': { status: 'UNAVAILABLE', evidence: 'missing executable: codex' },
    },
  };
  const initial = resolveTarget(request(unavailable, {
    target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' },
  }), { catalog });
  const result = decideFallback({
    request: initial.request,
    resolution: initial,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'cursor-native/cursor-default');
  assert.strictEqual(result.fallback_history[0].provider, 'codex-cli');
  assert.strictEqual(result.retry_budget_remaining, 0);
});

test('fallback enters reconciliation after an observed side effect', () => {
  const result = decideFallback({
    request: request(cursorProfile, { target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } }),
    resolution: { status: 'UNAVAILABLE', reason: 'timeout after launch', target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' } },
    failureClass: FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION,
    sideEffects: 'unknown',
    catalog,
  });

  assert.strictEqual(result.status, 'RECONCILIATION_REQUIRED');
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.retry_budget_remaining, 1);
});

test('Codex Host native fallback is derived from its Host profile', () => {
  const unavailable = {
    ...codexProfile,
    access: {
      ...codexProfile.access,
      'claude-code': { status: 'UNAVAILABLE', evidence: 'missing claude CLI' },
    },
  };
  const initial = resolveTarget(request(unavailable, {
    target: { provider: 'claude-code', model: 'opus5', transport: 'local-cli' },
  }), { catalog });
  const result = decideFallback({
    request: initial.request,
    resolution: initial,
    failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
    sideEffects: 'none',
    catalog,
  });

  assert.strictEqual(result.status, 'FALLBACK');
  assert.strictEqual(result.target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(result.target.native, true);
});

run('dispatch-engine');
