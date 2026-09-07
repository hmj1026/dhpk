'use strict';

// End-to-end proof for issue #370: a Codex-produced Review Request/Result
// submitted through CodexReviewGateAdapter reaches the SAME real ReviewGate
// and ReceiptStore that #367/#368/#369 already exercise, and produces
// durable evidence -- without ever becoming authoritative over Sentinel.

const { test, run, assert } = require('./_lib/tinytest');
const {
  createFinding,
  makePlan,
  makeReviewResult,
  registerPlan,
  TRUST_POLICY,
  NOW,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  createReviewGateFixture,
} = require('./_lib/review-gate-fixture');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const { CodexReviewGateAdapter } = require('../scripts/lib/codex-review-gate-adapter');

const ADAPTER_VERSION = 'codex-review-gate.v1';

function identity(overrides = {}) {
  return {
    taskId: 'task-370-e2e',
    attemptId: 'task-370-e2e:attempt:1',
    attempt: 1,
    sessionId: 'session-370-e2e',
    dispatchId: 'dispatch-370-e2e',
    scopeId: 'scope-370-e2e',
    diffId: 'diff-370-e2e',
    ...overrides,
  };
}

function lifecycleEvent(state, ids, overrides = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-event-370-e2e`,
    event_type: 'review-lifecycle',
    state,
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'codex-reviewer',
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: NOW,
    ...overrides,
  };
}

function makeAdapter(reviewGate) {
  return new CodexReviewGateAdapter({
    reviewGate,
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    adapterVersion: ADAPTER_VERSION,
    activation: 'ACTIVE',
    now: () => NOW_MS,
  });
}

test('a Codex PASS submission reaches the real Review Gate and is durably recorded', () => {
  const fixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  try {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    let state = registerPlan(fixture.gate, plan);

    const reviewRequest = createReviewRequest({
      decisionId: plan.decisionId,
      waveId: plan.waveId,
      obligationId: obligation.obligationId,
      lane: obligation.lane,
      scope: plan.scope,
      baseIdentity: plan.baseIdentity,
      headIdentity: plan.headIdentity,
      diff: plan.diff,
      materialRisks: plan.materialRisks,
      governingInputs: plan.governingInputs,
      exclusions: [],
      priorFindings: [],
      contractVersion: REVIEWER_CONTRACT_VERSION,
    });
    const artifactDigest = `${'a'.repeat(64)}`;
    const reviewResult = makeReviewResult(plan, obligation, {
      semanticVerdict: 'PASS',
      evidenceReferences: [`artifact-sha256:${artifactDigest}`],
    });
    const ids = identity();
    const lifecycleEvents = [
      lifecycleEvent('planned', ids),
      lifecycleEvent('dispatched', ids),
      lifecycleEvent('started', ids),
      lifecycleEvent('verdicted', ids, { verdict: 'PASS' }),
    ];
    const readinessEvents = [{
      schema_version: 1,
      event_id: 'ready-event-370-e2e',
      state: 'artifact-ready',
      task_id: ids.taskId,
      attempt_id: ids.attemptId,
      session_id: ids.sessionId,
      attempt: ids.attempt,
      scope_id: ids.scopeId,
      diff_id: ids.diffId,
      wave: ids.dispatchId,
      occurred_at: NOW,
      artifact_sha256: `sha256:${artifactDigest}`,
    }];

    const adapter = makeAdapter(fixture.gate);
    const { receipt, reviewGate } = adapter.record({
      plan,
      identity: ids,
      lifecycleEvents,
      readinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'node tests/reviewer-contract-v2.test.js', outcome: 'PASS' }],
      expectedRevision: state.revision,
      expectedChainDigest: state.chainDigest,
    });

    assert.strictEqual(receipt.reviewGateStatus, 'PASS');
    assert.strictEqual(receipt.authorizesApproval, false);
    assert.strictEqual(receipt.clearsSentinel, false);
    assert.strictEqual(receipt.authority, 'SENTINEL');
    assert.ok(reviewGate.decision.accepted, 'real Review Gate must accept a well-formed Codex PASS submission');
    assert.strictEqual(reviewGate.decision.semanticVerdict, 'PASS');
    assert.ok(reviewGate.revision > state.revision, 'the receipt store head must advance');
  } finally {
    fixture.cleanup();
  }
});

test('a Codex UNAVAILABLE result reaches the real Review Gate without artifact result binding', () => {
  const fixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  try {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registration = registerPlan(fixture.gate, plan, 'plan-registered-unavailable');
    const reviewRequest = createReviewRequest({
      decisionId: plan.decisionId,
      waveId: plan.waveId,
      obligationId: obligation.obligationId,
      lane: obligation.lane,
      scope: plan.scope,
      baseIdentity: plan.baseIdentity,
      headIdentity: plan.headIdentity,
      diff: plan.diff,
      materialRisks: plan.materialRisks,
      governingInputs: plan.governingInputs,
      exclusions: [],
      priorFindings: [],
      contractVersion: REVIEWER_CONTRACT_VERSION,
    });
    const reviewResult = makeReviewResult(plan, obligation, {
      executionStatus: 'UNAVAILABLE',
      evidenceReferences: ['capability:reviewer-unavailable'],
    });
    const ids = identity({
      taskId: 'task-370-e2e-unavailable',
      attemptId: 'task-370-e2e-unavailable:attempt:1',
      sessionId: 'session-370-e2e-unavailable',
    });
    const lifecycleEvents = [
      lifecycleEvent('planned', ids),
      lifecycleEvent('dispatched', ids),
      lifecycleEvent('started', ids),
      lifecycleEvent('failed-start', ids),
    ];
    const readinessEvents = [];

    const adapter = makeAdapter(fixture.gate);
    const { receipt, reviewGate } = adapter.record({
      plan,
      identity: ids,
      lifecycleEvents,
      readinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'codex review --bounded', outcome: 'UNAVAILABLE' }],
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
    });

    assert.strictEqual(receipt.reviewGateStatus, 'NOT_RUN');
    assert.strictEqual(reviewGate.decision.accepted, true);
    assert.strictEqual(reviewGate.decision.executionStatus, 'UNAVAILABLE');
    assert.strictEqual(reviewGate.decision.applicability, 'REQUIRED');
    assert.strictEqual(reviewGate.decision.semanticVerdict, undefined);
    assert.strictEqual(reviewGate.receipts.length, 1);
    assert.strictEqual(reviewGate.receipts[0].kind, 'review');
    assert.strictEqual(reviewGate.receipts[0].payload.executionStatus, 'UNAVAILABLE');
    assert.deepStrictEqual(reviewGate.receipts[0].payload.evidenceReferences, ['capability:reviewer-unavailable']);
  } finally {
    fixture.cleanup();
  }
});

test('a canonical empty Codex plan is NOT_APPLICABLE at registration without review evidence', () => {
  const fixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  try {
    const plan = makePlan({ empty: true });
    const registration = registerPlan(fixture.gate, plan, 'plan-registered-empty-codex');

    assert.strictEqual(registration.decision.accepted, true);
    assert.strictEqual(registration.decision.allowsProgress, true);
    assert.strictEqual(registration.decision.lifecycleStatus, 'NOT_APPLICABLE');
    assert.strictEqual(registration.decision.semanticVerdict, undefined);
    assert.strictEqual(registration.decision.resolution, 'EMPTY_DIFF');
    assert.deepStrictEqual(registration.reviewRequests, []);
    assert.deepStrictEqual(registration.receipts, []);
  } finally {
    fixture.cleanup();
  }
});

test('a Codex CHANGES_REQUIRED submission is recorded without being treated as approval', () => {
  const fixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  try {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const state = registerPlan(fixture.gate, plan);

    const reviewRequest = createReviewRequest({
      decisionId: plan.decisionId,
      waveId: plan.waveId,
      obligationId: obligation.obligationId,
      lane: obligation.lane,
      scope: plan.scope,
      baseIdentity: plan.baseIdentity,
      headIdentity: plan.headIdentity,
      diff: plan.diff,
      materialRisks: plan.materialRisks,
      governingInputs: plan.governingInputs,
      exclusions: [],
      priorFindings: [],
      contractVersion: REVIEWER_CONTRACT_VERSION,
    });
    const artifactDigest = `${'c'.repeat(64)}`;
    const reviewResult = makeReviewResult(plan, obligation, {
      semanticVerdict: 'CHANGES_REQUIRED',
      evidenceReferences: [`artifact-sha256:${artifactDigest}`],
      findings: [createFinding({
        id: 'issue-370-e2e-finding',
        severity: 'MEDIUM',
        disposition: 'MUST_FIX',
        summary: 'codex e2e changes-required proof',
        evidence: ['artifact:issue-370'],
      })],
    });
    const ids = identity({ taskId: 'task-370-e2e-cr', attemptId: 'task-370-e2e-cr:attempt:1' });
    const lifecycleEvents = [
      lifecycleEvent('planned', ids),
      lifecycleEvent('dispatched', ids),
      lifecycleEvent('started', ids),
      lifecycleEvent('verdicted', ids, { verdict: 'CHANGES_REQUIRED' }),
    ];
    const readinessEvents = [{
      schema_version: 1,
      event_id: 'ready-event-370-e2e-cr',
      state: 'artifact-ready',
      task_id: ids.taskId,
      attempt_id: ids.attemptId,
      session_id: ids.sessionId,
      attempt: ids.attempt,
      scope_id: ids.scopeId,
      diff_id: ids.diffId,
      wave: ids.dispatchId,
      occurred_at: NOW,
      artifact_sha256: `sha256:${artifactDigest}`,
    }];

    const adapter = makeAdapter(fixture.gate);
    const { receipt } = adapter.record({
      plan,
      identity: ids,
      lifecycleEvents,
      readinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'node tests/reviewer-contract-v2.test.js', outcome: 'FAIL' }],
      expectedRevision: state.revision,
      expectedChainDigest: state.chainDigest,
    });

    assert.strictEqual(receipt.reviewGateStatus, 'CHANGES_REQUIRED');
    assert.strictEqual(receipt.authorizesApproval, false);
    assert.strictEqual(receipt.allowsTargetProgress, false);
  } finally {
    fixture.cleanup();
  }
});

run();
