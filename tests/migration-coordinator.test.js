'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  MigrationCoordinator,
  validateMigrationObservationPayload,
} = require('../scripts/lib/migration-coordinator');
const {
  ReceiptStore,
  EVIDENCE_RECEIPT_SCHEMA,
  STORE_EVENT_SCHEMA,
} = require('../scripts/lib/review-gate-receipt-store');

const OBSERVATION_SCHEMA = 'dhpk.review-gate.migration-observation.v1';
const PROJECTION_SCHEMA = 'dhpk.review-gate-migration-projection.v1';
const EVENT_TYPE = 'MIGRATION_OBSERVATION_RECORDED';
const NOW = '2026-09-06T05:00:00.000Z';
const SOURCE_COMMIT = '1'.repeat(40);
const SOURCE_TREE = '2'.repeat(40);
const INTEGRITY_KEY = 'migration-coordinator-369-integrity-key';
const OBSERVATION_PRODUCER = 'claude-migration';
const OBSERVATION_ADAPTER = 'review-gate-adapter';
const OBSERVATION_ADAPTER_VERSION = 'claude-review-gate.v1';
const OBSERVATION_POLICY_VERSION = 'dhpk.migration-policy.v1';
const OBSERVATION_CONTRACT_VERSION = 'dhpk.review-gate.migration.v1';
const OBSERVATION_EVENT_ID = 'migration-event-369-1';
const OBSERVATION_RECEIPT_ID = 'migration-receipt-369-1';
const TRUST_POLICY = Object.freeze({
  producers: Object.freeze([Object.freeze({
    producer: 'claude-migration',
    adapter: 'review-gate-adapter',
    eventTypes: Object.freeze([EVENT_TYPE]),
    receiptKinds: Object.freeze(['migration-observation']),
  })]),
});

const DUAL_TRUST_POLICY = Object.freeze({
  producers: Object.freeze([
    ...TRUST_POLICY.producers,
    Object.freeze({
      producer: 'human-authority',
      adapter: 'migration-authority-adapter',
      eventTypes: Object.freeze(['MIGRATION_PHASE_TRANSITION_RECORDED']),
      receiptKinds: Object.freeze(['authority']),
    }),
  ]),
});

const PHASE_TRANSITION_SCHEMA = 'dhpk.review-gate.phase-transition-authority.v1';
const PHASE_TRANSITION_EVENT_TYPE = 'MIGRATION_PHASE_TRANSITION_RECORDED';

const deepClone = (value) => JSON.parse(JSON.stringify(value));

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function makeObservationPayload({
  phase = 'BASELINE',
  comparison = 'AGREE',
  sentinelStatus = 'PASS',
  reviewGateStatus = 'PASS',
  workId = 'work-369',
} = {}) {
  const observationEventId = phase === 'DUAL_ENFORCE' ? 'migration-event-369-dual-1'
    : phase === 'CUTOVER' ? 'migration-event-374-cutover-1' : OBSERVATION_EVENT_ID;
  const observationReceiptId = phase === 'DUAL_ENFORCE' ? 'migration-receipt-369-dual-1'
    : phase === 'CUTOVER' ? 'migration-receipt-374-cutover-1' : OBSERVATION_RECEIPT_ID;
  return {
    schema: OBSERVATION_SCHEMA,
    producer: OBSERVATION_PRODUCER,
    adapter: OBSERVATION_ADAPTER,
    adapterVersion: OBSERVATION_ADAPTER_VERSION,
    eventId: observationEventId,
    receiptId: observationReceiptId,
    sourceCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE,
    policyVersion: OBSERVATION_POLICY_VERSION,
    contractVersion: OBSERVATION_CONTRACT_VERSION,
    recordedAt: NOW,
    phase,
    authority: phase === 'DUAL_ENFORCE' ? 'SENTINEL_AND_REVIEW_GATE'
      : phase === 'CUTOVER' ? 'REVIEW_GATE' : 'SENTINEL',
    effect: phase === 'BASELINE' ? 'DISABLED'
      : (phase === 'DUAL_ENFORCE' || phase === 'CUTOVER') ? 'ENFORCE' : 'OBSERVE_ONLY',
    comparison,
    workId,
    decisionId: 'decision-369',
    planId: 'plan-369',
    waveId: 'wave-369',
    obligationId: 'obligation-code-review',
    lane: 'code-reviewer',
    taskId: 'task-369',
    attemptId: 'attempt-369',
    attempt: 1,
    sessionId: 'session-369',
    dispatchId: 'dispatch-369',
    scopeId: 'scope-369',
    diffId: 'diff-369',
    identity: {
      taskId: 'task-369',
      attemptId: 'attempt-369',
      attempt: 1,
      sessionId: 'session-369',
      dispatchId: 'dispatch-369',
      scopeId: 'scope-369',
      diffId: 'diff-369',
    },
    scope: {
      paths: ['scripts/lib/workflow-coordinator.js'],
      digest: `sha256:${'a'.repeat(64)}`,
    },
    diff: {
      digest: `sha256:${'b'.repeat(64)}`,
      reference: 'git-diff:issue-369',
    },
    sentinelStatus,
    reviewGateStatus,
    sentinelOutcome: {
      status: sentinelStatus,
      verdict: sentinelStatus,
      outcome: sentinelStatus,
      lifecycleEventId: 'verdicted-event-369',
    },
    reviewGate: {
      status: reviewGateStatus,
      ...(phase === 'OBSERVE' || phase === 'DUAL_ENFORCE' || phase === 'CUTOVER' ? { eventId: 'diagnostic-review-event-369' } : {}),
      ...(phase === 'DUAL_ENFORCE' || phase === 'CUTOVER' ? {
        accepted: reviewGateStatus === 'PASS',
        allowsProgress: reviewGateStatus === 'PASS',
        lifecycleStatus: reviewGateStatus === 'PASS' ? 'RESOLVED' : 'PENDING',
        executionStatus: reviewGateStatus === 'PASS' ? 'COMPLETE' : 'NOT_RUN',
        applicability: 'REQUIRED',
        semanticVerdict: reviewGateStatus,
        blockingReasons: reviewGateStatus === 'PASS' ? [] : ['REVIEW_BLOCKED'],
      } : {}),
    },
    acceptedOutcomeCost: {
      schema: 'dhpk.accepted-outcome-cost.v1',
      observationId: 'legacy-d84f9181ee7209e142684505b0dbb981',
      acceptedOutcome: sentinelStatus === 'PASS',
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
    },
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    allowsTargetProgress: phase === 'DUAL_ENFORCE'
      ? sentinelStatus === 'PASS' && reviewGateStatus === 'PASS'
      : phase === 'CUTOVER'
        ? comparison !== 'DISAGREE' && reviewGateStatus === 'PASS'
        : false,
    automaticPromotion: false,
    retirementEligible: false,
    liveness: 'COMPATIBILITY_ONLY',
    provenance: {
      digest: `sha256:${'c'.repeat(64)}`,
      reference: 'artifact:claude-migration-observation-369',
      producer: OBSERVATION_PRODUCER,
      adapter: OBSERVATION_ADAPTER,
      adapterVersion: OBSERVATION_ADAPTER_VERSION,
      eventId: observationEventId,
      receiptId: observationReceiptId,
      lifecycleEventId: 'verdicted-event-369',
      costObservationId: 'legacy-d84f9181ee7209e142684505b0dbb981',
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
      policyVersion: OBSERVATION_POLICY_VERSION,
      contractVersion: OBSERVATION_CONTRACT_VERSION,
      recordedAt: NOW,
      artifactDigest: `sha256:${'d'.repeat(64)}`,
      lifecycleEventIds: ['verdicted-event-369'],
      readinessEventIds: ['ready-event-369'],
    },
  };
}

function makeEvent(payload, overrides = {}) {
  return {
    schema: STORE_EVENT_SCHEMA,
    eventId: payload.eventId,
    eventType: EVENT_TYPE,
    workId: payload.workId,
    waveId: payload.waveId,
    planId: payload.planId,
    decisionId: payload.decisionId,
    obligationId: payload.obligationId,
    lane: payload.lane,
    producer: payload.producer,
    adapter: payload.adapter,
    adapterVersion: payload.adapterVersion,
    sessionId: payload.sessionId,
    taskId: payload.taskId,
    attemptId: payload.attemptId,
    attempt: payload.attempt,
    dispatchId: payload.dispatchId,
    scopeId: payload.scopeId,
    diffId: payload.diffId,
    sourceCommit: payload.sourceCommit,
    sourceTree: payload.sourceTree,
    policyVersion: payload.policyVersion,
    contractVersion: payload.contractVersion,
    recordedAt: payload.recordedAt,
    payload: deepClone(payload),
    ...overrides,
  };
}

function makeReceipt(payload, overrides = {}) {
  return {
    schema: EVIDENCE_RECEIPT_SCHEMA,
    receiptId: payload.receiptId,
    kind: 'migration-observation',
    workId: payload.workId,
    waveId: payload.waveId,
    planId: payload.planId,
    decisionId: payload.decisionId,
    obligationId: payload.obligationId,
    lane: payload.lane,
    producer: payload.producer,
    adapter: payload.adapter,
    adapterVersion: payload.adapterVersion,
    sessionId: payload.sessionId,
    taskId: payload.taskId,
    attemptId: payload.attemptId,
    attempt: payload.attempt,
    dispatchId: payload.dispatchId,
    scopeId: payload.scopeId,
    diffId: payload.diffId,
    sourceCommit: payload.sourceCommit,
    sourceTree: payload.sourceTree,
    policyVersion: payload.policyVersion,
    contractVersion: payload.contractVersion,
    recordedAt: payload.recordedAt,
    payload: deepClone(payload),
    ...overrides,
  };
}

function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-migration-coordinator-369-'));
  let currentNow = Date.parse(NOW);
  const store = new ReceiptStore({
    root,
    trustPolicy: options.trustPolicy || TRUST_POLICY,
    integrityKey: INTEGRITY_KEY,
    now: () => currentNow,
  });
  const coordinator = new MigrationCoordinator({
    receiptStore: store,
    phase: options.phase || 'BASELINE',
    now: () => currentNow,
  });
  return {
    root,
    store,
    coordinator,
    setNow: (value) => { currentNow = Date.parse(value); },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function makePhaseTransitionReceipt(payload, {
  action = 'PROMOTE',
  currentPhase = 'OBSERVE',
  targetPhase = 'DUAL_ENFORCE',
  transitionId = 'transition-373-1',
  eventId = 'phase-transition-event-373-1',
  receiptId = 'phase-transition-receipt-373-1',
  evidenceBundle = null,
  issuedAt = NOW,
  expiresAt = '2026-09-06T06:00:00.000Z',
} = {}) {
  return {
    schema: EVIDENCE_RECEIPT_SCHEMA,
    receiptId,
    kind: 'authority',
    workId: payload.workId,
    waveId: payload.waveId,
    planId: payload.planId,
    decisionId: payload.decisionId,
    producer: 'human-authority',
    adapter: 'migration-authority-adapter',
    adapterVersion: 'migration-authority.v1',
    sessionId: 'human-authority-session-373',
    taskId: payload.taskId,
    attemptId: payload.attemptId,
    attempt: payload.attempt,
    dispatchId: payload.dispatchId,
    scopeId: payload.scopeId,
    diffId: payload.diffId,
    sourceCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE,
    policyVersion: OBSERVATION_POLICY_VERSION,
    contractVersion: OBSERVATION_CONTRACT_VERSION,
    recordedAt: NOW,
    payload: {
      schema: PHASE_TRANSITION_SCHEMA,
      eventId,
      transitionId,
      action,
      currentPhase,
      targetPhase,
      evidenceBundle: evidenceBundle || {
        digest: `sha256:${'c'.repeat(64)}`,
        reference: 'artifact:claude-migration-observation-369',
      },
      reason: 'maintainer approved the bounded migration transition',
      approver: 'human:maintainer',
      issuedAt,
      expiresAt,
    },
  };
}

function makePhaseTransitionEvent(receipt, overrides = {}) {
  return {
    schema: STORE_EVENT_SCHEMA,
    eventId: receipt.payload.eventId,
    eventType: PHASE_TRANSITION_EVENT_TYPE,
    workId: receipt.workId,
    waveId: receipt.waveId,
    planId: receipt.planId,
    decisionId: receipt.decisionId,
    producer: receipt.producer,
    adapter: receipt.adapter,
    adapterVersion: receipt.adapterVersion,
    sessionId: receipt.sessionId,
    taskId: receipt.taskId,
    attemptId: receipt.attemptId,
    attempt: receipt.attempt,
    dispatchId: receipt.dispatchId,
    scopeId: receipt.scopeId,
    diffId: receipt.diffId,
    sourceCommit: receipt.sourceCommit,
    sourceTree: receipt.sourceTree,
    policyVersion: receipt.policyVersion,
    contractVersion: receipt.contractVersion,
    recordedAt: receipt.recordedAt,
    payload: { receipt },
    ...overrides,
  };
}

function withFixture(callback, options = {}) {
  const fixture = createFixture(options);
  try {
    return callback(fixture);
  } finally {
    fixture.cleanup();
  }
}

function recordInput(options = {}) {
  const payload = makeObservationPayload(options);
  return {
    expectedRevision: 0,
    expectedChainDigest: null,
    event: makeEvent(payload, options.eventOverrides),
    receipt: makeReceipt(payload, options.receiptOverrides),
  };
}

test('migration observations reject unknown top-level and nested raw evidence fields', () => {
  const cases = [
    ['command', 'digest:sha256:' + 'a'.repeat(64)],
    ['log', 'benign log summary'],
    ['path', 'scripts/lib/review-gate.js'],
    ['authorityHint', 'SENTINEL'],
    ['scope.command', 'digest:sha256:' + 'b'.repeat(64)],
    ['diff.log', 'benign log summary'],
    ['scope.path', 'scripts/lib/review-gate.js'],
    ['provenance.authority', 'SENTINEL'],
  ];
  for (const [pathName, value] of cases) {
    const payload = makeObservationPayload();
    const parts = pathName.split('.');
    const leaf = parts.pop();
    const parent = parts.reduce((record, key) => record[key], payload);
    parent[leaf] = value;
    assert.throws(
      () => validateMigrationObservationPayload(payload),
      /MALFORMED_RECEIPT|SENSITIVE_EVIDENCE|UNSUPPORTED_FIELD/,
      `unknown evidence field ${pathName} must fail closed`,
    );
  }

  for (const layer of ['event', 'receipt']) {
    const input = recordInput({ phase: 'BASELINE' });
    input[layer].note = 'raw envelope data';
    assert.throws(
      () => withFixture(({ coordinator }) => coordinator.record(input)),
      /MALFORMED_RECEIPT|UNSUPPORTED_FIELD/,
      `${layer} envelope must reject unknown fields`,
    );
  }
});

test('Accepted-Outcome Cost uses a closed canonical schema with redacted failures', () => {
  const cases = [
    (payload) => { payload.acceptedOutcomeCost.extra = 'unsupported'; },
    (payload) => { delete payload.acceptedOutcomeCost.metrics.modelTokens; },
    (payload) => { payload.acceptedOutcomeCost.metrics.extraMetric = 1; },
    (payload) => { payload.acceptedOutcomeCost.metrics.modelTokens = 'secret-token-value'; },
    (payload) => {
      payload.acceptedOutcomeCost.telemetryFailures = [{
        code: 'COLLECTOR_UNAVAILABLE',
        detail: 'secret failure detail',
      }];
      payload.acceptedOutcomeCost.telemetryFailureCount = 1;
      payload.acceptedOutcomeCost.telemetryStatus = 'FAILED';
    },
    (payload) => { payload.provenance.costObservationId = 'foreign-cost-observation'; },
    (payload) => { payload.provenance.lifecycleEventId = 'foreign-lifecycle-event'; },
  ];
  for (const mutate of cases) {
    const payload = makeObservationPayload();
    mutate(payload);
    let error;
    try {
      validateMigrationObservationPayload(payload);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'malformed Accepted-Outcome Cost evidence must fail closed');
    assert.match(String(error), /MALFORMED_RECEIPT|SENSITIVE_EVIDENCE|MIXED_IDENTITY|UNSUPPORTED_FIELD|sensitive observation data/);
    assert.doesNotMatch(String(error), /secret-token-value|secret failure detail/);
  }
});

test('Accepted-Outcome Cost remains bound to task, Sentinel acceptance, and terminal lifecycle evidence', () => {
  const cases = [
    (payload) => {
      payload.acceptedOutcomeCost.observationId = 'legacy-01f3eb374d9d2eb448470c432bfd1a66';
      payload.provenance.costObservationId = payload.acceptedOutcomeCost.observationId;
    },
    (payload) => { payload.acceptedOutcomeCost.acceptedOutcome = false; },
    (payload) => {
      payload.sentinelOutcome.lifecycleEventId = 'foreign-verdicted-event';
      payload.provenance.lifecycleEventId = 'foreign-verdicted-event';
    },
  ];
  for (const mutate of cases) {
    const payload = makeObservationPayload();
    mutate(payload);
    assert.throws(
      () => validateMigrationObservationPayload(payload),
      /MALFORMED_RECEIPT|MIXED_IDENTITY/,
    );
  }
});

test('BASELINE accepts the legacy no-lifecycle cost projection without enabling progress', () => {
  const payload = makeObservationPayload({ phase: 'BASELINE', sentinelStatus: 'PASS' });
  delete payload.sentinelOutcome.lifecycleEventId;
  delete payload.provenance.lifecycleEventId;
  payload.provenance.lifecycleEventIds = [];
  payload.sentinelOutcome.verdict = 'APPROVE';
  payload.sentinelOutcome.outcome = 'APPROVE';
  payload.sentinelOutcome.status = 'CLEARED';
  payload.sentinelOutcome.cost = {
    dispatchCount: 2,
    semanticReviewCount: 1,
    remediationRounds: 1,
    humanTurns: 0,
    elapsedMs: 42,
    receiptReuse: 3,
    falseBlocks: 0,
    unsafeClearance: 0,
    missedRequiredReview: 0,
    postMergeEscapes: 0,
  };
  payload.cost = payload.sentinelOutcome.cost;
  payload.acceptedOutcomeCost = {
    ...payload.acceptedOutcomeCost,
    metrics: {
      ...payload.acceptedOutcomeCost.metrics,
      modelTokens: null,
      falseBlockCount: 0,
      receiptReuseCount: 3,
    },
    acceptedOutcome: true,
    telemetryStatus: 'PARTIAL',
    retirementEligible: false,
  };

  withFixture(({ coordinator }) => {
    const result = coordinator.record({
      expectedRevision: 0,
      expectedChainDigest: null,
      observation: payload,
    });

    assert.strictEqual(result.phase, 'BASELINE');
    assert.strictEqual(result.allowsTargetProgress, false);
    assert.strictEqual(result.automaticPromotion, false);
    assert.strictEqual(result.lifecycleEventId, undefined);
    assert.strictEqual(result.acceptedOutcomeCost.acceptedOutcome, true);
  });
});

test('normalizes legacy Sentinel verdicts before persistence while Review Gate stays strict', () => {
  for (const [legacy, canonical] of [
    ['APPROVE', 'PASS'],
    ['WARNING', 'CHANGES_REQUIRED'],
    ['BLOCK', 'CHANGES_REQUIRED'],
  ]) {
    const payload = makeObservationPayload({
      phase: 'BASELINE',
      sentinelStatus: 'CLEARED',
    });
    payload.sentinelOutcome = {
      ...payload.sentinelOutcome,
      status: 'CLEARED',
      verdict: legacy,
      outcome: legacy,
    };
    payload.acceptedOutcomeCost.acceptedOutcome = legacy === 'APPROVE';

    withFixture(({ coordinator, store }) => {
      const result = coordinator.record({
        expectedRevision: 0,
        expectedChainDigest: null,
        observation: payload,
      });
      assert.strictEqual(result.sentinelStatus, 'CLEARED');
      assert.strictEqual(result.acceptedOutcomeCost.acceptedOutcome, legacy === 'APPROVE');
      const history = coordinator.inspect({
        workId: payload.workId,
        expectedRevision: result.revision,
        expectedChainDigest: result.chainDigest,
      });
      assert.strictEqual(history.sentinelStatus, 'CLEARED');
      const stored = store.inspect({
        workId: payload.workId,
        expectedRevision: result.revision,
        expectedChainDigest: result.chainDigest,
      });
      assert.strictEqual(stored.receipts[0].payload.sentinelOutcome.verdict, canonical);
      assert.strictEqual(stored.receipts[0].payload.sentinelOutcome.outcome, canonical);
    });
  }

  const reviewGatePayload = makeObservationPayload({ phase: 'OBSERVE' });
  reviewGatePayload.reviewGate.semanticVerdict = 'APPROVE';
  assert.throws(() => validateMigrationObservationPayload(reviewGatePayload), /MALFORMED_RECEIPT/);
});

test('event, receipt, payload, and provenance bindings reject foreign identity and metadata pairs', () => {
  const identityFields = ['taskId', 'attemptId', 'attempt', 'dispatchId', 'scopeId', 'diffId'];
  for (const field of identityFields) {
    const foreign = field === 'attempt' ? 99 : `foreign-${field}`;
    for (const layer of ['event', 'receipt', 'payload']) {
      const input = recordInput({ phase: 'BASELINE' });
      if (layer === 'event' || layer === 'receipt') {
        input[layer][field] = foreign;
      } else {
        input.event.payload[field] = foreign;
        input.receipt.payload[field] = foreign;
        input.event.payload.identity[field] = foreign;
        input.receipt.payload.identity[field] = foreign;
      }
      assert.throws(
        () => withFixture(({ coordinator }) => coordinator.record(input)),
        /MIXED_IDENTITY|FOREIGN_EVIDENCE|MALFORMED_RECEIPT|STALE_EVIDENCE/,
        `${layer}.${field} must remain bound to the canonical observation identity`,
      );
    }
  }

  for (const [layer, field, foreign] of [
    ['event', 'producer', 'foreign-producer'],
    ['receipt', 'adapter', 'foreign-adapter'],
    ['receipt', 'sourceCommit', 'f'.repeat(40)],
    ['receipt', 'sourceTree', 'e'.repeat(40)],
    ['receipt', 'policyVersion', 'foreign-policy'],
    ['receipt', 'contractVersion', 'foreign-contract'],
  ]) {
    const input = recordInput({ phase: 'BASELINE' });
    input[layer][field] = foreign;
    assert.throws(
      () => withFixture(({ coordinator }) => coordinator.record(input)),
      /MIXED_IDENTITY|FOREIGN_EVIDENCE|UNTRUSTED_PRODUCER|MALFORMED_RECEIPT|STALE_EVIDENCE/,
      `${layer}.${field} must match payload provenance metadata`,
    );
  }
});

test('oversized property keys fail closed without invoking getters or echoing secret values', () => {
  const oversizedKey = 'x'.repeat(4097);
  const getterPayload = makeObservationPayload();
  let getterInvoked = false;
  Object.defineProperty(getterPayload, oversizedKey, {
    enumerable: true,
    configurable: true,
    get() {
      getterInvoked = true;
      return 'secret-value-must-not-be-read';
    },
  });
  assert.throws(() => validateMigrationObservationPayload(getterPayload), (error) => {
    assert.strictEqual(error.code, 'MALFORMED_RECEIPT');
    assert.doesNotMatch(String(error), /secret-value-must-not-be-read/);
    return true;
  });
  assert.strictEqual(getterInvoked, false);

  const dataPayload = makeObservationPayload();
  dataPayload[oversizedKey] = 'secret-value-must-not-echo';
  let error;
  try {
    validateMigrationObservationPayload(dataPayload);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'oversized property keys must be rejected');
  assert.doesNotMatch(String(error), /secret-value-must-not-echo/);
});

for (const scenario of [
  { phase: 'BASELINE', comparison: 'AGREE', effect: 'DISABLED' },
  { phase: 'OBSERVE', comparison: 'DISAGREE', effect: 'OBSERVE_ONLY' },
]) {
  test(`${scenario.phase} records ${scenario.comparison} without acquiring enforcement authority`, () => {
    withFixture(({ coordinator, store }) => {
      const input = recordInput({ phase: scenario.phase, comparison: scenario.comparison });
      const result = coordinator.record(input);

      assert.strictEqual(result.schema, PROJECTION_SCHEMA);
      assert.strictEqual(result.phase, scenario.phase);
      assert.strictEqual(result.authority, 'SENTINEL');
      assert.strictEqual(result.effect, scenario.effect);
      assert.strictEqual(result.comparison, scenario.comparison);
      assert.strictEqual(result.allowsTargetProgress, false);
      assert.strictEqual(result.automaticPromotion, false);
      assert.strictEqual(result.retirementEligible, false);
      assert.strictEqual(result.authorizesApproval, false);
      assert.strictEqual(result.clearsSentinel, false);
      assert.strictEqual(result.blocksSentinel, false);
      assert.strictEqual(result.liveness, 'COMPATIBILITY_ONLY');
      assert.strictEqual(result.revision, 1);
      assert.match(result.chainDigest, /^sha256:[a-f0-9]{64}$/);
      assertDeepFrozen(result);

      const history = store.inspect({
        workId: 'work-369',
        expectedRevision: result.revision,
        expectedChainDigest: result.chainDigest,
      });
      assert.strictEqual(history.events.length, 1);
      assert.strictEqual(history.receipts.length, 1);
      assert.strictEqual(history.receipts[0].kind, 'migration-observation');
    }, { phase: scenario.phase });
  });
}

test('records an identical migration observation idempotently', () => {
  withFixture(({ coordinator, store }) => {
    const input = recordInput({ phase: 'OBSERVE', comparison: 'AGREE' });
    const first = coordinator.record(input);
    const duplicate = coordinator.record({
      ...input,
      event: deepClone(input.event),
      receipt: deepClone(input.receipt),
    });

    assert.deepStrictEqual(duplicate, first);
    assertDeepFrozen(duplicate);
    const history = store.inspect({
      workId: 'work-369',
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
    });
    assert.strictEqual(history.events.length, 1);
    assert.strictEqual(history.receipts.length, 1);
  }, { phase: 'OBSERVE' });
});

test('rejects a migration observation whose phase differs from the coordinator phase', () => {
  withFixture(({ coordinator }) => {
    assert.throws(
      () => coordinator.record(recordInput({ phase: 'OBSERVE' })),
      /phase|mismatch|stale/i,
    );
  }, { phase: 'BASELINE' });
});

test('rejects provenance fields outside the bounded observation allowlist', () => {
  withFixture(({ coordinator }) => {
    const input = recordInput({ phase: 'BASELINE' });
    input.receipt.payload.provenance.note = 'untrusted provenance text';
    assert.throws(
      () => coordinator.record(input),
      /MALFORMED_RECEIPT|UNSUPPORTED_FIELD|provenance/i,
    );
  });
});

test('rejects unsupported migration phases at construction', () => {
  withFixture(({ root, store }) => {
    for (const phase of ['RETIRE', 'CLEANUP', 'baseline', null]) {
      assert.throws(
        () => new MigrationCoordinator({
          receiptStore: store,
          phase,
          now: () => Date.parse(NOW),
        }),
        /phase|unsupported/i,
      );
    }
    assert.ok(root);
  });
});

test('DUAL_ENFORCE observations require a recorded promotion and stale coordinators cannot roll back the head', () => {
  withFixture(({ store }) => {
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    assert.throws(
      () => dualCoordinator.record({
        expectedRevision: 0,
        expectedChainDigest: null,
        observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'AGREE' }),
      }),
      /promotion|phase|stale/i,
    );

    const observeCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'OBSERVE',
      now: () => Date.parse(NOW),
    });
    const observed = observeCoordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = observeCoordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const stalePayload = makeObservationPayload({ phase: 'OBSERVE', comparison: 'AGREE' });
    stalePayload.eventId = 'migration-event-369-stale-observe';
    stalePayload.receiptId = 'migration-receipt-369-stale-observe';
    stalePayload.provenance.eventId = stalePayload.eventId;
    stalePayload.provenance.receiptId = stalePayload.receiptId;
    assert.throws(
      () => observeCoordinator.record({
        expectedRevision: promotion.revision,
        expectedChainDigest: promotion.chainDigest,
        observation: stalePayload,
      }),
      /phase|stale/i,
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('CUTOVER observations also require a recorded promotion, not just DUAL_ENFORCE', () => {
  withFixture(({ store }) => {
    const cutoverCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'CUTOVER',
      now: () => Date.parse(NOW),
    });
    assert.throws(
      () => cutoverCoordinator.record({
        expectedRevision: 0,
        expectedChainDigest: null,
        observation: makeObservationPayload({ phase: 'CUTOVER', comparison: 'AGREE' }),
      }),
      /promotion|phase|stale/i,
      'a first-ever observation must not be recordable directly at CUTOVER with no OBSERVE/DUAL_ENFORCE history',
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('inspection returns the stored immutable migration projection without a promotion surface', () => {
  withFixture(({ coordinator }) => {
    const first = coordinator.record(recordInput({ phase: 'BASELINE', comparison: 'AGREE' }));
    const inspected = coordinator.inspect({
      workId: 'work-369',
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
    });

    assert.strictEqual(inspected.schema, PROJECTION_SCHEMA);
    assert.strictEqual(inspected.phase, 'BASELINE');
    assert.strictEqual(inspected.authority, 'SENTINEL');
    assert.strictEqual(inspected.effect, 'DISABLED');
    assert.strictEqual(inspected.comparison, 'AGREE');
    assert.strictEqual(inspected.allowsTargetProgress, false);
    assertDeepFrozen(inspected);
  });

  assert.deepStrictEqual(
    Object.getOwnPropertyNames(MigrationCoordinator.prototype).sort(),
    ['_appendPhaseTransition', 'constructor', 'inspect', 'record', 'rollback', 'transition'],
  );
});

test('promotes OBSERVE to DUAL_ENFORCE only through a bound maintainer transition receipt', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const authorityReceipt = makePhaseTransitionReceipt(observed, {
      currentPhase: 'OBSERVE',
      targetPhase: 'DUAL_ENFORCE',
    });
    const transition = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(authorityReceipt),
      receipt: authorityReceipt,
    });

    assert.strictEqual(transition.phase, 'DUAL_ENFORCE');
    assert.strictEqual(transition.authority, 'SENTINEL_AND_REVIEW_GATE');
    assert.strictEqual(transition.effect, 'ENFORCE');
    assert.strictEqual(transition.allowsTargetProgress, false);
    assert.strictEqual(transition.automaticPromotion, false);
    assert.strictEqual(transition.authorizesApproval, false);
    assert.strictEqual(transition.clearsSentinel, false);
    assert.strictEqual(transition.revision, observed.revision + 1);
    assert.match(transition.chainDigest, /^sha256:[a-f0-9]{64}$/);
    assertDeepFrozen(transition);

    const history = store.inspect({
      workId: observed.workId,
      expectedRevision: transition.revision,
      expectedChainDigest: transition.chainDigest,
    });
    assert.strictEqual(history.events.length, 2);
    assert.strictEqual(history.receipts.length, 2);
    assert.strictEqual(history.receipts[1].kind, 'authority');
    assert.strictEqual(history.receipts[1].payload.schema, PHASE_TRANSITION_SCHEMA);
    const inspected = coordinator.inspect({
      workId: observed.workId,
      expectedRevision: transition.revision,
      expectedChainDigest: transition.chainDigest,
    });
    assert.strictEqual(inspected.phase, 'DUAL_ENFORCE');
    assert.strictEqual(inspected.authority, 'SENTINEL_AND_REVIEW_GATE');
    assert.strictEqual(inspected.effect, 'ENFORCE');
    assert.strictEqual(inspected.allowsTargetProgress, false);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('DUAL_ENFORCE allows progress only when both validated authorities pass', () => {
  withFixture(({ coordinator }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const authorityReceipt = makePhaseTransitionReceipt(observed);
    const transition = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(authorityReceipt),
      receipt: authorityReceipt,
    });
    const dual = new MigrationCoordinator({
      receiptStore: coordinator.receiptStore,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    }).record({
      expectedRevision: transition.revision,
      expectedChainDigest: transition.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'AGREE' }),
    });

    assert.strictEqual(dual.phase, 'DUAL_ENFORCE');
    assert.strictEqual(dual.authority, 'SENTINEL_AND_REVIEW_GATE');
    assert.strictEqual(dual.effect, 'ENFORCE');
    assert.strictEqual(dual.comparison, 'AGREE');
    assert.strictEqual(dual.allowsTargetProgress, true);
    assert.strictEqual(dual.authorizesApproval, false);
    assert.strictEqual(dual.clearsSentinel, false);
    assert.strictEqual(dual.blocksSentinel, false);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('DUAL_ENFORCE disagreement fails closed and manual rollback preserves receipts', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    const disagreement = dualCoordinator.record({
      expectedRevision: promotion.revision,
      expectedChainDigest: promotion.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });
    assert.strictEqual(disagreement.authority, 'SENTINEL_AND_REVIEW_GATE');
    assert.strictEqual(disagreement.effect, 'ENFORCE');
    assert.strictEqual(disagreement.allowsTargetProgress, false);

    const rollbackReceipt = makePhaseTransitionReceipt(disagreement, {
      action: 'ROLLBACK',
      currentPhase: 'DUAL_ENFORCE',
      targetPhase: 'OBSERVE',
      transitionId: 'transition-373-rollback-1',
      eventId: 'phase-transition-event-373-rollback-1',
      receiptId: 'phase-transition-receipt-373-rollback-1',
    });
    const rollback = dualCoordinator.rollback({
      expectedRevision: disagreement.revision,
      expectedChainDigest: disagreement.chainDigest,
      event: makePhaseTransitionEvent(rollbackReceipt),
      receipt: rollbackReceipt,
    });

    assert.strictEqual(rollback.phase, 'OBSERVE');
    assert.strictEqual(rollback.authority, 'SENTINEL');
    assert.strictEqual(rollback.effect, 'OBSERVE_ONLY');
    assert.strictEqual(rollback.allowsTargetProgress, false);
    assert.strictEqual(rollback.automaticPromotion, false);
    assert.strictEqual(rollback.clearsSentinel, false);
    assert.strictEqual(rollback.revision, disagreement.revision + 1);
    const history = store.inspect({
      workId: disagreement.workId,
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
    });
    assert.strictEqual(history.receipts.filter((receipt) => receipt.kind === 'migration-observation').length, 3);
    assert.strictEqual(history.receipts.filter((receipt) => receipt.kind === 'authority').length, 2);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('hard invariant rollback returns exactly one phase without synthetic Sentinel clearance', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    const dual = dualCoordinator.record({
      expectedRevision: promotion.revision,
      expectedChainDigest: promotion.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });
    const rollback = dualCoordinator.rollback({
      workId: dual.workId,
      expectedRevision: dual.revision,
      expectedChainDigest: dual.chainDigest,
      automatic: true,
      // A caller-supplied observation is only an optional work selector; the
      // rollback diagnostic must still be derived from the stored DUAL receipt.
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'AGREE' }),
      reasonCodes: ['IDENTITY_DISAGREEMENT'],
    });

    assert.strictEqual(rollback.phase, 'OBSERVE');
    assert.strictEqual(rollback.authority, 'SENTINEL');
    assert.strictEqual(rollback.effect, 'OBSERVE_ONLY');
    assert.strictEqual(rollback.allowsTargetProgress, false);
    assert.strictEqual(rollback.clearsSentinel, false);
    assert.strictEqual(rollback.revision, dual.revision + 1);
    const history = store.inspect({
      workId: dual.workId,
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
    });
    assert.strictEqual(history.receipts.filter((receipt) => receipt.kind === 'authority').length, 1);
    assert.strictEqual(history.receipts.filter((receipt) => receipt.kind === 'migration-observation').length, 3);
    const latest = history.receipts.filter((receipt) => receipt.kind === 'migration-observation').at(-1);
    assert.ok(latest.payload.reasonCodes.includes('IDENTITY_DISAGREEMENT'));
    assert.strictEqual(latest.payload.sentinelOutcome.lifecycleEventId, 'verdicted-event-369');
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('manual rollback retries remain idempotent after the rollback diagnostic advances the head', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    const dual = dualCoordinator.record({
      expectedRevision: promotion.revision,
      expectedChainDigest: promotion.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });
    const rollbackReceipt = makePhaseTransitionReceipt(dual, {
      action: 'ROLLBACK',
      currentPhase: 'DUAL_ENFORCE',
      targetPhase: 'OBSERVE',
      transitionId: 'transition-373-rollback-retry',
      eventId: 'phase-transition-event-373-rollback-retry',
      receiptId: 'phase-transition-receipt-373-rollback-retry',
    });
    const input = {
      expectedRevision: dual.revision,
      expectedChainDigest: dual.chainDigest,
      event: makePhaseTransitionEvent(rollbackReceipt),
      receipt: rollbackReceipt,
    };
    const first = dualCoordinator.rollback(input);
    const duplicate = dualCoordinator.rollback(input);
    assert.deepStrictEqual(duplicate, first);
    const history = store.inspect({
      workId: dual.workId,
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
    });
    assert.strictEqual(history.events.length, first.revision);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('automatic rollback retries remain idempotent with the original trusted head', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    const dual = dualCoordinator.record({
      expectedRevision: promotion.revision,
      expectedChainDigest: promotion.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });
    const input = {
      workId: dual.workId,
      expectedRevision: dual.revision,
      expectedChainDigest: dual.chainDigest,
      automatic: true,
      reasonCodes: ['IDENTITY_DISAGREEMENT'],
    };
    const first = dualCoordinator.rollback(input);
    const duplicate = dualCoordinator.rollback(input);
    assert.deepStrictEqual(duplicate, first);
    const history = store.inspect({
      workId: dual.workId,
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
    });
    assert.strictEqual(history.events.length, first.revision);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

function promoteToCutover(coordinator, store) {
  const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
  const dualReceipt = makePhaseTransitionReceipt(observed, {
    currentPhase: 'OBSERVE',
    targetPhase: 'DUAL_ENFORCE',
  });
  const dualTransition = coordinator.transition({
    expectedRevision: observed.revision,
    expectedChainDigest: observed.chainDigest,
    event: makePhaseTransitionEvent(dualReceipt),
    receipt: dualReceipt,
  });
  const dualCoordinator = new MigrationCoordinator({
    receiptStore: store,
    phase: 'DUAL_ENFORCE',
    now: () => Date.parse(NOW),
  });
  const dual = dualCoordinator.record({
    expectedRevision: dualTransition.revision,
    expectedChainDigest: dualTransition.chainDigest,
    observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'AGREE' }),
  });
  const cutoverReceipt = makePhaseTransitionReceipt(dual, {
    currentPhase: 'DUAL_ENFORCE',
    targetPhase: 'CUTOVER',
    transitionId: 'transition-374-cutover-1',
    eventId: 'phase-transition-event-374-cutover-1',
    receiptId: 'phase-transition-receipt-374-cutover-1',
  });
  const cutoverTransition = dualCoordinator.transition({
    expectedRevision: dual.revision,
    expectedChainDigest: dual.chainDigest,
    event: makePhaseTransitionEvent(cutoverReceipt),
    receipt: cutoverReceipt,
  });
  const cutoverCoordinator = new MigrationCoordinator({
    receiptStore: store,
    phase: 'CUTOVER',
    now: () => Date.parse(NOW),
  });
  return { cutoverCoordinator, cutoverTransition };
}

test('promotes DUAL_ENFORCE to CUTOVER only through a bound maintainer transition receipt', () => {
  withFixture(({ coordinator, store }) => {
    const { cutoverTransition } = promoteToCutover(coordinator, store);

    assert.strictEqual(cutoverTransition.phase, 'CUTOVER');
    assert.strictEqual(cutoverTransition.authority, 'REVIEW_GATE');
    assert.strictEqual(cutoverTransition.effect, 'ENFORCE');
    assert.strictEqual(cutoverTransition.allowsTargetProgress, false);
    assert.strictEqual(cutoverTransition.automaticPromotion, false);
    assert.strictEqual(cutoverTransition.authorizesApproval, false);
    assert.strictEqual(cutoverTransition.clearsSentinel, false);
    assertDeepFrozen(cutoverTransition);

    const history = store.inspect({
      workId: cutoverTransition.workId,
      expectedRevision: cutoverTransition.revision,
      expectedChainDigest: cutoverTransition.chainDigest,
    });
    assert.strictEqual(history.receipts.filter((receipt) => receipt.kind === 'authority').length, 2);
    assert.strictEqual(
      history.receipts.filter((receipt) => receipt.kind === 'migration-observation').length,
      2,
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('CUTOVER allows progress from Review Gate alone once Sentinel and Review Gate agree', () => {
  withFixture(({ coordinator, store }) => {
    const { cutoverCoordinator, cutoverTransition } = promoteToCutover(coordinator, store);
    const cutover = cutoverCoordinator.record({
      expectedRevision: cutoverTransition.revision,
      expectedChainDigest: cutoverTransition.chainDigest,
      observation: makeObservationPayload({ phase: 'CUTOVER', comparison: 'AGREE' }),
    });

    assert.strictEqual(cutover.phase, 'CUTOVER');
    assert.strictEqual(cutover.authority, 'REVIEW_GATE');
    assert.strictEqual(cutover.effect, 'ENFORCE');
    assert.strictEqual(cutover.comparison, 'AGREE');
    assert.strictEqual(cutover.allowsTargetProgress, true);
    assert.strictEqual(cutover.authorizesApproval, false);
    assert.strictEqual(cutover.clearsSentinel, false);
    assert.strictEqual(cutover.blocksSentinel, false);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('CUTOVER allows Review Gate progress when Sentinel is an indeterminate compatibility projection', () => {
  withFixture(({ coordinator, store }) => {
    const { cutoverCoordinator, cutoverTransition } = promoteToCutover(coordinator, store);
    const observation = makeObservationPayload({
      phase: 'CUTOVER',
      comparison: 'INDETERMINATE',
      sentinelStatus: 'UNKNOWN',
      reviewGateStatus: 'PASS',
    });
    observation.sentinelOutcome = {
      status: 'UNKNOWN',
      lifecycleEventId: observation.sentinelOutcome.lifecycleEventId,
    };
    const cutover = cutoverCoordinator.record({
      expectedRevision: cutoverTransition.revision,
      expectedChainDigest: cutoverTransition.chainDigest,
      observation,
    });

    assert.strictEqual(cutover.comparison, 'INDETERMINATE');
    assert.strictEqual(cutover.authority, 'REVIEW_GATE');
    assert.strictEqual(cutover.allowsTargetProgress, true);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('CUTOVER disagreement fails closed and automatically returns to DUAL_ENFORCE', () => {
  withFixture(({ coordinator, store }) => {
    const { cutoverCoordinator, cutoverTransition } = promoteToCutover(coordinator, store);
    const rollback = cutoverCoordinator.record({
      expectedRevision: cutoverTransition.revision,
      expectedChainDigest: cutoverTransition.chainDigest,
      observation: makeObservationPayload({ phase: 'CUTOVER', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });

    assert.strictEqual(rollback.phase, 'DUAL_ENFORCE');
    assert.strictEqual(rollback.authority, 'SENTINEL_AND_REVIEW_GATE');
    assert.strictEqual(rollback.effect, 'ENFORCE');
    assert.strictEqual(rollback.comparison, 'DISAGREE');
    assert.strictEqual(rollback.allowsTargetProgress, false);
    assert.strictEqual(rollback.automaticPromotion, false);
    assert.strictEqual(rollback.clearsSentinel, false);
    assert.strictEqual(rollback.revision, cutoverTransition.revision + 2);
    const history = store.inspect({
      workId: rollback.workId,
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
    });
    const observations = history.receipts.filter((receipt) => receipt.kind === 'migration-observation');
    assert.strictEqual(observations.length, 4);
    assert.ok(observations.at(-1).payload.reasonCodes.includes('MIGRATION_ROLLBACK'));
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('manual rollback from a passing CUTOVER remains fail-closed without synthetic Sentinel clearance', () => {
  withFixture(({ coordinator, store }) => {
    const { cutoverCoordinator, cutoverTransition } = promoteToCutover(coordinator, store);
    const cutover = cutoverCoordinator.record({
      expectedRevision: cutoverTransition.revision,
      expectedChainDigest: cutoverTransition.chainDigest,
      observation: makeObservationPayload({ phase: 'CUTOVER', comparison: 'AGREE' }),
    });
    const rollbackReceipt = makePhaseTransitionReceipt(cutover, {
      action: 'ROLLBACK',
      currentPhase: 'CUTOVER',
      targetPhase: 'DUAL_ENFORCE',
      transitionId: 'transition-374-rollback-pass-1',
      eventId: 'phase-transition-event-374-rollback-pass-1',
      receiptId: 'phase-transition-receipt-374-rollback-pass-1',
    });
    const rollback = cutoverCoordinator.rollback({
      expectedRevision: cutover.revision,
      expectedChainDigest: cutover.chainDigest,
      event: makePhaseTransitionEvent(rollbackReceipt),
      receipt: rollbackReceipt,
    });

    assert.strictEqual(rollback.phase, 'DUAL_ENFORCE');
    assert.strictEqual(rollback.authority, 'SENTINEL_AND_REVIEW_GATE');
    assert.strictEqual(rollback.effect, 'ENFORCE');
    assert.strictEqual(rollback.comparison, 'AGREE');
    assert.strictEqual(rollback.allowsTargetProgress, false);
    assert.strictEqual(rollback.clearsSentinel, false);
    assert.strictEqual(rollback.revision, cutover.revision + 1);
    assert.strictEqual(rollback.authorizesApproval, false);
    const history = store.inspect({
      workId: cutover.workId,
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
    });
    const latest = history.receipts.filter((receipt) => receipt.kind === 'migration-observation').at(-1);
    assert.ok(latest.payload.reasonCodes.includes('MIGRATION_ROLLBACK'));
    assert.strictEqual(latest.payload.phase, 'DUAL_ENFORCE');
    assert.strictEqual(latest.payload.comparison, 'AGREE');
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('automatic rollback from a passing CUTOVER is idempotent and preserves the source comparison', () => {
  withFixture(({ coordinator, store }) => {
    const { cutoverCoordinator, cutoverTransition } = promoteToCutover(coordinator, store);
    const cutover = cutoverCoordinator.record({
      expectedRevision: cutoverTransition.revision,
      expectedChainDigest: cutoverTransition.chainDigest,
      observation: makeObservationPayload({ phase: 'CUTOVER', comparison: 'AGREE' }),
    });
    const rollbackInput = {
      workId: cutover.workId,
      expectedRevision: cutover.revision,
      expectedChainDigest: cutover.chainDigest,
      automatic: true,
      reasonCodes: ['HARD_INVARIANT_ROLLBACK'],
    };
    const rollback = cutoverCoordinator.rollback(rollbackInput);

    assert.strictEqual(rollback.phase, 'DUAL_ENFORCE');
    assert.strictEqual(rollback.comparison, 'AGREE');
    assert.strictEqual(rollback.allowsTargetProgress, false);
    assert.strictEqual(rollback.revision, cutover.revision + 1);
    const duplicate = cutoverCoordinator.rollback(rollbackInput);
    assert.deepStrictEqual(duplicate, rollback);
    const history = store.inspect({
      workId: rollback.workId,
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
    });
    const latest = history.receipts.filter((receipt) => receipt.kind === 'migration-observation').at(-1);
    assert.ok(latest.payload.reasonCodes.includes('MIGRATION_ROLLBACK'));
    assert.strictEqual(latest.payload.comparison, 'AGREE');
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('late transition retries reject a superseded authority epoch', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    const dual = dualCoordinator.record({
      expectedRevision: promotion.revision,
      expectedChainDigest: promotion.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });
    const rollbackReceipt = makePhaseTransitionReceipt(dual, {
      action: 'ROLLBACK',
      currentPhase: 'DUAL_ENFORCE',
      targetPhase: 'OBSERVE',
      transitionId: 'transition-373-late-retry',
      eventId: 'phase-transition-event-373-late-retry',
      receiptId: 'phase-transition-receipt-373-late-retry',
    });
    const rollbackInput = {
      expectedRevision: dual.revision,
      expectedChainDigest: dual.chainDigest,
      event: makePhaseTransitionEvent(rollbackReceipt),
      receipt: rollbackReceipt,
    };
    const rollback = dualCoordinator.rollback(rollbackInput);

    const observeCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'OBSERVE',
      now: () => Date.parse(NOW),
    });
    const promotionTwoReceipt = makePhaseTransitionReceipt(rollback, {
      transitionId: 'transition-373-late-retry-promotion',
      eventId: 'phase-transition-event-373-late-retry-promotion',
      receiptId: 'phase-transition-receipt-373-late-retry-promotion',
    });
    const promotionTwo = observeCoordinator.transition({
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
      event: makePhaseTransitionEvent(promotionTwoReceipt),
      receipt: promotionTwoReceipt,
    });
    const dualTwoPayload = makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'AGREE' });
    dualTwoPayload.eventId = 'migration-event-369-dual-2';
    dualTwoPayload.receiptId = 'migration-receipt-369-dual-2';
    dualTwoPayload.provenance.eventId = dualTwoPayload.eventId;
    dualTwoPayload.provenance.receiptId = dualTwoPayload.receiptId;
    const dualTwo = dualCoordinator.record({
      expectedRevision: promotionTwo.revision,
      expectedChainDigest: promotionTwo.chainDigest,
      observation: dualTwoPayload,
    });
    assert.strictEqual(dualTwo.phase, 'DUAL_ENFORCE');

    assert.throws(
      () => dualCoordinator.rollback(rollbackInput),
      (error) => error && error.code === 'STALE_EVIDENCE',
    );
    const current = dualCoordinator.inspect({
      workId: dualTwo.workId,
      expectedRevision: dualTwo.revision,
      expectedChainDigest: dualTwo.chainDigest,
    });
    assert.strictEqual(current.phase, 'DUAL_ENFORCE');
    assert.strictEqual(current.revision, dualTwo.revision);
    assert.throws(
      () => coordinator.transition({
        expectedRevision: observed.revision,
        expectedChainDigest: observed.chainDigest,
        event: makePhaseTransitionEvent(promotionReceipt),
        receipt: promotionReceipt,
      }),
      (error) => error && error.code === 'STALE_EVIDENCE',
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('late automatic rollback retries reject after a new promotion epoch', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const promotionReceipt = makePhaseTransitionReceipt(observed);
    const promotion = coordinator.transition({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(promotionReceipt),
      receipt: promotionReceipt,
    });
    const dualCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'DUAL_ENFORCE',
      now: () => Date.parse(NOW),
    });
    const dual = dualCoordinator.record({
      expectedRevision: promotion.revision,
      expectedChainDigest: promotion.chainDigest,
      observation: makeObservationPayload({ phase: 'DUAL_ENFORCE', comparison: 'DISAGREE', reviewGateStatus: 'CHANGES_REQUIRED' }),
    });
    const rollbackInput = {
      workId: dual.workId,
      expectedRevision: dual.revision,
      expectedChainDigest: dual.chainDigest,
      automatic: true,
      reasonCodes: ['IDENTITY_DISAGREEMENT'],
    };
    const rollback = dualCoordinator.rollback(rollbackInput);
    const observeCoordinator = new MigrationCoordinator({
      receiptStore: store,
      phase: 'OBSERVE',
      now: () => Date.parse(NOW),
    });
    const promotionTwoReceipt = makePhaseTransitionReceipt(rollback, {
      transitionId: 'transition-373-auto-late-promotion',
      eventId: 'phase-transition-event-373-auto-late-promotion',
      receiptId: 'phase-transition-receipt-373-auto-late-promotion',
    });
    const promotionTwo = observeCoordinator.transition({
      expectedRevision: rollback.revision,
      expectedChainDigest: rollback.chainDigest,
      event: makePhaseTransitionEvent(promotionTwoReceipt),
      receipt: promotionTwoReceipt,
    });
    assert.strictEqual(promotionTwo.phase, 'DUAL_ENFORCE');
    assert.throws(
      () => dualCoordinator.rollback(rollbackInput),
      (error) => error && error.code === 'STALE_EVIDENCE',
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('phase transition receipt rejects stale, expired, and unsupported promotion attempts', () => {
  withFixture(({ coordinator }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const cases = [
      { name: 'wrong current phase', currentPhase: 'BASELINE', error: /phase|stale/i },
      { name: 'wrong target phase', targetPhase: 'CUTOVER', error: /phase|target|unsupported/i },
      { name: 'expired receipt', expiresAt: '2026-09-06T04:59:59.000Z', error: /expired|active|authority/i },
    ];
    for (const item of cases) {
      const receipt = makePhaseTransitionReceipt(observed, {
        currentPhase: item.currentPhase || 'OBSERVE',
        targetPhase: item.targetPhase || 'DUAL_ENFORCE',
        expiresAt: item.expiresAt || '2026-09-06T06:00:00.000Z',
        transitionId: `transition-373-${item.name.replace(/ /g, '-')}`,
        eventId: `phase-transition-event-373-${item.name.replace(/ /g, '-')}`,
        receiptId: `phase-transition-receipt-373-${item.name.replace(/ /g, '-')}`,
      });
      assert.throws(
        () => coordinator.transition({
          expectedRevision: observed.revision,
          expectedChainDigest: observed.chainDigest,
          event: makePhaseTransitionEvent(receipt),
          receipt,
        }),
        item.error,
        item.name,
      );
    }
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('phase transition authority is bound to the current source metadata and evidence bundle', () => {
  withFixture(({ coordinator }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const foreign = makePhaseTransitionReceipt(observed);
    foreign.sourceCommit = 'f'.repeat(40);
    foreign.payload.evidenceBundle = {
      digest: `sha256:${'e'.repeat(64)}`,
      reference: 'bundle:foreign-evidence',
    };
    assert.throws(
      () => coordinator.transition({
        expectedRevision: observed.revision,
        expectedChainDigest: observed.chainDigest,
        event: makePhaseTransitionEvent(foreign),
        receipt: foreign,
      }),
      /identity|evidence|stale|mixed/i,
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('inspection rejects a phase transition persisted outside the coordinator boundary', () => {
  withFixture(({ coordinator, store }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const expired = makePhaseTransitionReceipt(observed, {
      expiresAt: '2026-09-06T04:59:59.000Z',
    });
    const appended = store.append({
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(expired),
      receipts: [expired],
    });
    assert.throws(
      () => coordinator.inspect({
        workId: observed.workId,
        expectedRevision: appended.revision,
        expectedChainDigest: appended.chainDigest,
      }),
      /expired|stale|authority/i,
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('phase transition retries remain idempotent after the head advances', () => {
  withFixture(({ coordinator }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const receipt = makePhaseTransitionReceipt(observed);
    const input = {
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
      event: makePhaseTransitionEvent(receipt),
      receipt,
    };
    const first = coordinator.transition(input);
    const duplicate = coordinator.transition(input);
    assert.deepStrictEqual(duplicate, first);
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

test('phase transition aliases cannot carry conflicting authority receipts', () => {
  withFixture(({ coordinator }) => {
    const observed = coordinator.record(recordInput({ phase: 'OBSERVE', comparison: 'AGREE' }));
    const receipt = makePhaseTransitionReceipt(observed);
    const foreign = makePhaseTransitionReceipt(observed, {
      transitionId: 'transition-373-conflict',
      eventId: 'phase-transition-event-373-conflict',
      receiptId: 'phase-transition-receipt-373-conflict',
    });
    assert.throws(
      () => coordinator.transition({
        expectedRevision: observed.revision,
        expectedChainDigest: observed.chainDigest,
        event: makePhaseTransitionEvent(receipt),
        receipt,
        authorityReceipt: foreign,
      }),
      /identity|mixed|conflict/i,
    );
  }, { phase: 'OBSERVE', trustPolicy: DUAL_TRUST_POLICY });
});

run('migration-coordinator');
