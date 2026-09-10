'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  DEFAULT_CROSS_PROVIDER,
  FAILURE_CLASSES,
  ROLE_POLICY,
  createFallbackState,
  resolveFallbackDecision,
  resolveDispatchPlan,
} = require('../scripts/lib/native-dispatch-policy');

const ROOT = path.join(__dirname, '..');

test('all delegated roles share the native-only default dispatch plan', () => {
  assert.strictEqual(DEFAULT_CROSS_PROVIDER, false);

  for (const role of ['planner', 'reasoner', 'worker', 'reviewer']) {
    const plan = resolveDispatchPlan({
      role,
      requestedBackend: 'auto',
      configuredOrder: ['codex', 'agy', 'claude'],
    });

    assert.deepStrictEqual(plan, {
      role,
      native_backend: 'claude',
      requested_backend: 'auto',
      candidate_scope: 'native-only',
      candidates: ['claude'],
      suppressed_candidates: [
        { backend: 'codex', reason: 'cross-provider disabled' },
        { backend: 'agy', reason: 'cross-provider disabled' },
      ],
      native_agent: ROLE_POLICY[role].native_agent,
    });
  }
});

test('explicit targets remain directional while automatic cross-provider expansion stays opt-in', () => {
  assert.deepStrictEqual(resolveDispatchPlan({
    role: 'worker',
    requestedBackend: 'codex',
    configuredOrder: ['claude', 'codex', 'agy'],
  }), {
    role: 'worker',
    native_backend: 'claude',
    requested_backend: 'codex',
    candidate_scope: 'explicit',
    candidates: ['codex'],
    suppressed_candidates: [],
    native_agent: 'dhpk:fast-worker',
  });

  assert.deepStrictEqual(resolveDispatchPlan({
    role: 'reasoner',
    requestedBackend: 'auto',
    configuredOrder: ['claude', 'codex', 'agy'],
    crossProvider: true,
  }), {
    role: 'reasoner',
    native_backend: 'claude',
    requested_backend: 'auto',
    candidate_scope: 'cross-provider',
    candidates: ['claude', 'codex', 'agy'],
    suppressed_candidates: [],
    native_agent: 'dhpk:deep-reasoner',
  });
});

test('unknown roles fail closed before a dispatch plan can be created', () => {
  assert.throws(
    () => resolveDispatchPlan({ role: 'architect', requestedBackend: 'auto' }),
    /unknown delegated role: architect/,
  );
});

test('delegated role definitions point to the shared native dispatch policy', () => {
  for (const role of ['planner', 'deep-reasoner', 'fast-worker', 'code-reviewer']) {
    const document = fs.readFileSync(path.join(ROOT, 'agents', `${role}.md`), 'utf8');
    assert.ok(document.includes('Native dispatch baseline'), `${role} missing native dispatch policy reference`);
    assert.ok(document.includes('${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md'), `${role} missing execution policy reference`);
  }
});

test('fallback decisions are native-first, role-preserving, and opt-in for other providers', () => {
  const state = createFallbackState({ retryBudget: 2 });
  const handoff = {
    mode: 'workspace-write',
    assigned_files: ['src/a.js'],
    review_contract: 'required-code-review',
  };

  const result = resolveFallbackDecision({
    role: 'worker',
    selectedBackend: 'codex',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: false,
    failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
    sideEffects: 'none',
    state,
    handoff,
  });

  assert.deepStrictEqual(result, {
    status: 'fallback',
    action: 'dispatch',
    role: 'worker',
    native_agent: 'dhpk:fast-worker',
    requested_backend: 'codex',
    resolved_backend: 'claude',
    failure_class: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE',
    fallback_reason: 'codex unavailable without confirmed side effects; native fallback selected',
    retry_budget_remaining: 1,
    candidate_scope: 'native-only',
    handoff,
    next_state: {
      retry_budget: 1,
      attempted_backends: ['codex'],
      unavailable_backends: ['codex'],
    },
  });
});

test('cross-provider fallback remembers unavailable targets and never loops or resets the budget', () => {
  const first = resolveFallbackDecision({
    role: 'reviewer',
    selectedBackend: 'codex',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    state: createFallbackState({ retryBudget: 2 }),
  });
  assert.strictEqual(first.resolved_backend, 'claude');
  assert.strictEqual(first.retry_budget_remaining, 1);

  const second = resolveFallbackDecision({
    role: 'reviewer',
    selectedBackend: 'claude',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    state: {
      ...first.next_state,
      unavailable_backends: [...first.next_state.unavailable_backends, 'claude'],
    },
  });
  assert.strictEqual(second.resolved_backend, 'agy');
  assert.strictEqual(second.retry_budget_remaining, 0);
  assert.deepStrictEqual(second.next_state.attempted_backends, ['codex', 'claude']);
  assert.deepStrictEqual(second.next_state.unavailable_backends, ['codex', 'claude']);

  const exhausted = resolveFallbackDecision({
    role: 'reviewer',
    selectedBackend: 'agy',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    state: second.next_state,
  });
  assert.strictEqual(exhausted.status, 'blocked');
  assert.strictEqual(exhausted.action, 'stop');
  assert.strictEqual(exhausted.retry_budget_remaining, 0);
});

test('failure classes that are not availability failures stop without provider switching', () => {
  for (const [failureClass, action] of [
    [FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT, 'stop'],
    [FAILURE_CLASSES.SAFETY_OR_USER_DENIAL, 'stop'],
    [FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE, 'repair'],
    [FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION, 'reconcile'],
  ]) {
    const result = resolveFallbackDecision({
      role: 'worker',
      selectedBackend: 'codex',
      nativeBackend: 'claude',
      configuredOrder: ['codex', 'agy', 'claude'],
      crossProvider: true,
      failureClass,
      sideEffects: 'unknown',
      state: createFallbackState({ retryBudget: 3 }),
    });
    assert.strictEqual(result.status, 'blocked', failureClass);
    assert.strictEqual(result.action, action, failureClass);
    assert.strictEqual(result.resolved_backend, 'codex', failureClass);
    assert.strictEqual(result.retry_budget_remaining, 3, failureClass);
  }
});

test('quota fallback requires cross-provider opt-in and avoids the affected pool', () => {
  const result = resolveFallbackDecision({
    role: 'worker',
    selectedBackend: 'codex',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT,
    affectedPool: 'account-a',
    candidatePools: { codex: 'account-a', claude: 'account-a', agy: 'account-b' },
    state: createFallbackState({ retryBudget: 2 }),
  });

  assert.strictEqual(result.status, 'fallback');
  assert.strictEqual(result.resolved_backend, 'agy');
  assert.strictEqual(result.retry_budget_remaining, 1);
  assert.deepStrictEqual(result.next_state.unavailable_backends, ['codex']);

  const unverifiedPool = resolveFallbackDecision({
    role: 'worker',
    selectedBackend: 'codex',
    crossProvider: true,
    failureClass: FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT,
    affectedPool: 'account-a',
    state: createFallbackState({ retryBudget: 2 }),
  });
  assert.strictEqual(unverifiedPool.status, 'blocked');
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

run('native-dispatch-policy');
