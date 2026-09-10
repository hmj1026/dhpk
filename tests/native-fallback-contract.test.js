'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  FAILURE_CLASSES,
  createFallbackState,
  resolveFallbackDecision,
} = require('../scripts/lib/native-dispatch-policy');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const FALLBACK_CASES = [
  {
    name: 'CLI unavailable',
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    expectedStatus: 'fallback',
    expectedAction: 'dispatch',
    expectedBackend: 'claude',
  },
  {
    name: 'authentication or model unavailable',
    failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
    sideEffects: 'none',
    expectedStatus: 'fallback',
    expectedAction: 'dispatch',
    expectedBackend: 'claude',
  },
  {
    name: 'quota or rate limit',
    failureClass: FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT,
    sideEffects: 'none',
    affectedPool: 'pool-a',
    candidatePools: { codex: 'pool-a', claude: 'pool-a', agy: 'pool-b' },
    expectedStatus: 'fallback',
    expectedAction: 'dispatch',
    expectedBackend: 'agy',
  },
  {
    name: 'safety or user denial',
    failureClass: FAILURE_CLASSES.SAFETY_OR_USER_DENIAL,
    sideEffects: 'unknown',
    expectedStatus: 'blocked',
    expectedAction: 'stop',
    expectedBackend: 'codex',
  },
  {
    name: 'task or semantic failure',
    failureClass: FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE,
    sideEffects: 'unknown',
    expectedStatus: 'blocked',
    expectedAction: 'repair',
    expectedBackend: 'codex',
  },
  {
    name: 'timeout or interruption',
    failureClass: FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION,
    sideEffects: 'unknown',
    expectedStatus: 'blocked',
    expectedAction: 'reconcile',
    expectedBackend: 'codex',
  },
];

test('shared fallback contract is table-driven across all failure classes', () => {
  for (const scenario of FALLBACK_CASES) {
    const handoff = {
      task_scope: 'issue-421-contract',
      write_authority: 'existing-writer',
      review_obligation: 'required',
    };
    const decision = resolveFallbackDecision({
      role: 'worker',
      selectedBackend: 'codex',
      nativeBackend: 'claude',
      configuredOrder: ['codex', 'claude', 'agy'],
      crossProvider: true,
      failureClass: scenario.failureClass,
      sideEffects: scenario.sideEffects,
      affectedPool: scenario.affectedPool,
      candidatePools: scenario.candidatePools,
      state: createFallbackState({ retryBudget: 3 }),
      handoff,
    });

    assert.strictEqual(decision.status, scenario.expectedStatus, scenario.name);
    assert.strictEqual(decision.action, scenario.expectedAction, scenario.name);
    assert.strictEqual(decision.resolved_backend, scenario.expectedBackend, scenario.name);
    assert.deepStrictEqual(decision.handoff, handoff, scenario.name);
    assert.deepStrictEqual(decision.next_state.attempted_backends, ['codex'], scenario.name);
    assert.strictEqual(
      decision.retry_budget_remaining,
      scenario.expectedStatus === 'fallback' ? 2 : 3,
      scenario.name,
    );
  }
});

test('shared fallback contract preserves every delegated role and handoff scope', () => {
  const roles = [
    ['planner', 'dhpk:planner'],
    ['reasoner', 'dhpk:deep-reasoner'],
    ['worker', 'dhpk:fast-worker'],
    ['reviewer', 'dhpk:code-reviewer'],
  ];
  for (const [role, nativeAgent] of roles) {
    const decision = resolveFallbackDecision({
      role,
      selectedBackend: 'codex',
      failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
      sideEffects: 'none',
      crossProvider: false,
      handoff: { task_scope: 'same-scope', review_obligation: 'preserve' },
    });
    assert.strictEqual(decision.native_agent, nativeAgent, role);
    assert.strictEqual(decision.resolved_backend, 'claude', role);
    assert.deepStrictEqual(decision.handoff, { task_scope: 'same-scope', review_obligation: 'preserve' }, role);
  }
});

test('canonical policy documents all failure classes and state invariants', () => {
  const policy = read('rules/execution-policy.md');
  const dispatch = read('skills/flow-guide/references/implementation-dispatch.md');
  for (const failureClass of Object.values(FAILURE_CLASSES)) {
    assert.ok(policy.includes(`\`${failureClass}\``), `${failureClass} missing from policy`);
    assert.ok(dispatch.includes(`\`${failureClass}\``), `${failureClass} missing from dispatch guide`);
  }
  for (const field of ['attempted_backends', 'unavailable_backends', 'retry_budget']) {
    assert.ok(policy.includes(`\`${field}\``), `${field} missing from policy`);
    assert.ok(dispatch.includes(`\`${field}\``), `${field} missing from dispatch guide`);
  }
  assert.ok(policy.includes('It never chooses a new') && policy.includes('provider or silently retries'));
  assert.ok(policy.includes('preserves the role, task scope, read/write authority'));
});

test('delegated role documents inherit fallback policy without changing contracts', () => {
  for (const role of ['planner', 'deep-reasoner', 'fast-worker', 'code-reviewer']) {
    const document = read(`agents/${role}.md`);
    assert.ok(document.includes('Fallback'), `${role} missing fallback boundary`);
    assert.ok(document.includes('cross-provider'), `${role} missing cross-provider gate`);
  }
  for (const role of ['codex-worker', 'agy-worker', 'codex-reasoner', 'codex-deep-reasoner']) {
    const document = read(`agents/${role}.md`);
    assert.ok(document.includes('dispatcher'), `${role} must leave fallback selection to dispatcher`);
    assert.ok(document.includes('provider side effect'), `${role} must require no-side-effect evidence`);
  }
});

test('transport contract classifies failures but cannot select a provider', () => {
  const transport = read('skills/dhpk-cli-transport/SKILL.md');
  assert.ok(transport.includes('failure_class'));
  assert.ok(transport.includes('Requested and effective') && transport.includes('provider fields remain unchanged'));
  assert.ok(transport.includes('never emits a silent provider switch'));
});

run('native-fallback-contract');
