'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { sha256 } = require('../scripts/lib/receipt-primitives');
const {
  normalizeLegacyObservation,
} = require('../scripts/lib/claude-review-gate-legacy-observation');

const TASK_ID = 'task-legacy-observation-369';
const IDENTITY = Object.freeze({
  taskId: TASK_ID,
  attemptId: 'attempt-legacy-observation-369',
  attempt: 1,
  sessionId: 'session-legacy-observation-369',
  dispatchId: 'dispatch-legacy-observation-369',
  scopeId: 'scope-legacy-observation-369',
  diffId: 'diff-legacy-observation-369',
});

function lifecycleEvent(state, overrides = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-legacy-observation-369`,
    event_type: 'review-lifecycle',
    state,
    task_id: IDENTITY.taskId,
    attempt_id: IDENTITY.attemptId,
    attempt: IDENTITY.attempt,
    session_id: IDENTITY.sessionId,
    wave: IDENTITY.dispatchId,
    scope_id: IDENTITY.scopeId,
    diff_id: IDENTITY.diffId,
    occurred_at: '2026-09-06T04:00:00.000Z',
    ...overrides,
  };
}

function acceptedOutcomeCost(overrides = {}) {
  return {
    schema: 'dhpk.accepted-outcome-cost.v1',
    observationId: `legacy-${sha256(TASK_ID).slice(0, 32)}`,
    acceptedOutcome: true,
    metrics: {
      modelTokens: null,
      dispatchCount: 1,
      semanticReviewCount: 1,
      remediationRounds: 0,
      humanTurns: null,
      elapsedMs: 42,
      falseBlockCount: null,
      receiptReuseCount: null,
    },
    telemetryFailures: [],
    telemetryFailureCount: 0,
    telemetryStatus: 'PARTIAL',
    retirementEligible: false,
    ...overrides,
  };
}

function source(overrides = {}) {
  const terminal = lifecycleEvent('verdicted', { verdict: 'PASS' });
  return {
    identity: { ...IDENTITY },
    lifecycleEvents: [
      lifecycleEvent('planned'),
      lifecycleEvent('dispatched'),
      lifecycleEvent('started'),
      terminal,
    ],
    sentinelOutcome: {
      status: 'CLEARED',
      verdict: 'PASS',
      outcome: 'PASS',
      lifecycleEventId: terminal.event_id,
    },
    acceptedOutcomeCost: acceptedOutcomeCost(),
    ...overrides,
  };
}

test('normalizes a same-identity terminal Sentinel outcome and canonical cost record', () => {
  const normalized = normalizeLegacyObservation(source());

  assert.deepStrictEqual(normalized.identity, IDENTITY);
  assert.strictEqual(normalized.lifecycleEventId, 'verdicted-legacy-observation-369');
  assert.strictEqual(normalized.sentinelOutcome.verdict, 'PASS');
  assert.strictEqual(normalized.acceptedOutcomeCost.metrics.modelTokens, null);
  assert.ok(Object.isFrozen(normalized));
});

test('rejects a foreign task-derived cost observation even when its schema is canonical', () => {
  const input = source({
    acceptedOutcomeCost: acceptedOutcomeCost({
      observationId: `legacy-${sha256('foreign-task-369').slice(0, 32)}`,
    }),
  });

  assert.throws(() => normalizeLegacyObservation(input), /FOREIGN_COST_OBSERVATION/);
});

test('rejects a Sentinel terminal reference that is absent from the lifecycle stream', () => {
  const input = source();
  input.sentinelOutcome.lifecycleEventId = 'foreign-terminal-event-369';

  assert.throws(() => normalizeLegacyObservation(input), /FOREIGN_LIFECYCLE_EVENT/);
});

test('normalizes the unchanged collector fallback with its redacted detail hash', () => {
  const input = source({
    acceptedOutcomeCost: {
      schema: 'dhpk.accepted-outcome-cost.v1',
      observationId: `legacy-${sha256(TASK_ID).slice(0, 32)}`,
      acceptedOutcome: true,
      metrics: {
        modelTokens: null,
        dispatchCount: null,
        semanticReviewCount: null,
        remediationRounds: null,
        humanTurns: null,
        elapsedMs: null,
        falseBlockCount: null,
        receiptReuseCount: null,
      },
      telemetryFailures: [{ code: 'COLLECTOR_UNAVAILABLE', detail: '<redacted>' }],
      telemetryFailureCount: 1,
      telemetryStatus: 'FAILED',
      retirementEligible: false,
    },
  });

  const normalized = normalizeLegacyObservation(input);

  assert.strictEqual(
    normalized.acceptedOutcomeCost.telemetryFailures[0].detailSha256,
    `sha256:${sha256('<redacted>')}`,
  );
  assert.strictEqual(normalized.acceptedOutcomeCost.telemetryStatus, 'FAILED');
});

test('rejects a collector failure that changes the fallback shape', () => {
  const input = source({
    acceptedOutcomeCost: {
      schema: 'dhpk.accepted-outcome-cost.v1',
      observationId: `legacy-${sha256(TASK_ID).slice(0, 32)}`,
      acceptedOutcome: true,
      metrics: {
        modelTokens: null,
        dispatchCount: null,
        semanticReviewCount: null,
        remediationRounds: null,
        humanTurns: null,
        elapsedMs: null,
        falseBlockCount: null,
        receiptReuseCount: null,
      },
      telemetryFailures: [{ code: 'COLLECTOR_UNAVAILABLE', detail: '<redacted>', extra: 'x' }],
      telemetryFailureCount: 1,
      telemetryStatus: 'FAILED',
      retirementEligible: false,
    },
  });

  assert.throws(() => normalizeLegacyObservation(input), /MALFORMED_ACCEPTED_OUTCOME_COST/);
});

run('claude-review-gate-legacy-observation');
