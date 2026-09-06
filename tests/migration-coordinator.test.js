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
  return {
    schema: OBSERVATION_SCHEMA,
    producer: OBSERVATION_PRODUCER,
    adapter: OBSERVATION_ADAPTER,
    adapterVersion: OBSERVATION_ADAPTER_VERSION,
    eventId: OBSERVATION_EVENT_ID,
    receiptId: OBSERVATION_RECEIPT_ID,
    sourceCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE,
    policyVersion: OBSERVATION_POLICY_VERSION,
    contractVersion: OBSERVATION_CONTRACT_VERSION,
    recordedAt: NOW,
    phase,
    authority: 'SENTINEL',
    effect: phase === 'BASELINE' ? 'DISABLED' : 'OBSERVE_ONLY',
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
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    allowsTargetProgress: false,
    automaticPromotion: false,
    retirementEligible: false,
    liveness: 'COMPATIBILITY_ONLY',
    provenance: {
      digest: `sha256:${'c'.repeat(64)}`,
      reference: 'artifact:claude-migration-observation-369',
      producer: OBSERVATION_PRODUCER,
      adapter: OBSERVATION_ADAPTER,
      adapterVersion: OBSERVATION_ADAPTER_VERSION,
      eventId: OBSERVATION_EVENT_ID,
      receiptId: OBSERVATION_RECEIPT_ID,
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
    trustPolicy: TRUST_POLICY,
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
  assert.throws(
    () => validateMigrationObservationPayload(getterPayload),
    /MALFORMED_RECEIPT|SENSITIVE_EVIDENCE|accessors/,
  );
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
    for (const phase of ['DUAL_ENFORCE', 'CUTOVER', 'RETIRE', 'CLEANUP', 'baseline', null]) {
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
    ['constructor', 'inspect', 'record'],
  );
});

run('migration-coordinator');
