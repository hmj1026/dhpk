'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { WorkflowCoordinator } = require('../scripts/lib/workflow-coordinator');

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'review-gate', 'workflow-coordinator-v1.json'),
  'utf8',
));
const RECEIPTS_BY_ID = new Map(FIXTURE.receipts.map((receipt) => [receipt.receiptId, receipt]));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function receiptsFor(history) {
  return history.receiptIds.map((receiptId) => cloneJson(RECEIPTS_BY_ID.get(receiptId)));
}

function observable(result) {
  return {
    schema: result.schema,
    evidenceAccepted: result.evidenceAccepted,
    state: result.state,
    control: result.control,
    condition: result.condition,
    workId: result.workId,
    decisionId: result.decisionId,
    waveId: result.waveId,
    owners: result.owners,
    routing: result.routing,
    reviewLanes: result.reviewLanes,
    verificationLanes: result.verificationLanes,
    refreshLanes: result.refreshLanes,
    evidenceReceiptIds: result.evidenceReceiptIds,
    decisionPacket: result.decisionPacket,
    completion: result.completion,
  };
}

const EXPECTED_REFRESH_LANES = {
  recorded: ['code-reviewer', 'implementation', 'unit'],
  'decision-pending': [],
  ready: ['code-reviewer', 'implementation', 'unit'],
  executing: ['code-reviewer', 'unit'],
  'evidence-pending': ['code-reviewer', 'unit'],
  'merge-ready': [],
  blocked: ['unit'],
  'decision-invalidated': [],
};

const EXPECTED_CONTROL = {
  baseline: {
    enabled: false,
    phase: 'BASELINE',
    authority: 'SENTINEL',
    effect: 'DISABLED',
    allowsTargetProgress: false,
  },
  observe: {
    enabled: true,
    phase: 'OBSERVE',
    authority: 'SENTINEL',
    effect: 'OBSERVE_ONLY',
    allowsTargetProgress: false,
  },
};

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function coordinator(featureControl) {
  return new WorkflowCoordinator({
    trustPolicy: FIXTURE.trustPolicy,
    featureControl,
    evaluatedAt: FIXTURE.evaluatedAt,
  });
}

function assertBlocked(result, reasonCode) {
  assert.strictEqual(result.schema, 'dhpk.workflow-projection.v1');
  assert.strictEqual(result.evidenceAccepted, false);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.strictEqual(result.workId, 'work-368');
  assert.strictEqual(result.decisionId, 'decision-368');
  assert.strictEqual(result.waveId, 'wave-368');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'EVIDENCE_PENDING',
    reasonCodes: [reasonCode],
  });
  assert.strictEqual(result.control.authority, 'SENTINEL');
  assert.strictEqual(result.control.allowsTargetProgress, false);
}

for (const [controlName, featureControl] of Object.entries(FIXTURE.featureControl)) {
  for (const history of FIXTURE.histories) {
    test(`${controlName} reduces ${history.name} history`, () => {
      const receipts = receiptsFor(history);
      const before = cloneJson(receipts);
      const result = coordinator(featureControl).reduce(receipts);
      const expected = cloneJson(history.expected);
      expected.schema = 'dhpk.workflow-projection.v1';
      expected.evidenceAccepted = true;
      expected.workId = 'work-368';
      expected.decisionId = 'decision-368';
      expected.waveId = 'wave-368';
      expected.refreshLanes = EXPECTED_REFRESH_LANES[history.name];
      expected.evidenceReceiptIds = history.receiptIds;
      expected.control = EXPECTED_CONTROL[controlName];

      assert.deepStrictEqual(observable(result), expected);
      assert.deepStrictEqual(receipts, before, 'reduce must not mutate receipts');
      assertDeepFrozen(result);
    });
  }
}

test('only constructor, reduce, and reduceDelivery are public coordinator operations', () => {
  assert.deepStrictEqual(
    Object.getOwnPropertyNames(WorkflowCoordinator.prototype).sort(),
    ['constructor', 'reduce', 'reduceDelivery'],
  );
});

test('receipt ordering is canonical and exact duplicates collapse', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'merge-ready'));
  const reordered = [...receipts].reverse();
  const duplicated = [...receipts, cloneJson(receipts[receipts.length - 1])];
  const expected = observable(coordinator(FIXTURE.featureControl.observe).reduce(receipts));

  assert.deepStrictEqual(observable(coordinator(FIXTURE.featureControl.observe).reduce(reordered)), expected);
  assert.deepStrictEqual(observable(coordinator(FIXTURE.featureControl.observe).reduce(duplicated)), expected);
});

test('sorts batchable authority requests into one decision packet', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'decision-pending'));
  const result = coordinator(FIXTURE.featureControl.observe).reduce(receipts);

  assert.deepStrictEqual(
    result.decisionPacket.items.map(({ requestId }) => requestId),
    ['authority-request-368-a', 'authority-request-368-b'],
  );
});

test('deep-freezes the output while preserving the caller input', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'merge-ready'));
  const before = cloneJson(receipts);
  const result = coordinator(FIXTURE.featureControl.observe).reduce(receipts);

  assert.deepStrictEqual(receipts, before);
  assertDeepFrozen(result);
});

test('rejects a conflicting duplicate receipt', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'merge-ready'));
  const conflicting = cloneJson(receipts[receipts.length - 1]);
  conflicting.payload.outcome = 'FAIL';

  const result = coordinator(FIXTURE.featureControl.observe).reduce([...receipts, conflicting]);
  assertBlocked(result, 'CONFLICTING_DUPLICATE_RECEIPT');
});

test('returns a blocked projection for malformed evidence', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'ready'));
  delete receipts[0].payload.schema;

  const result = coordinator(FIXTURE.featureControl.observe).reduce(receipts);
  assertBlocked(result, 'MALFORMED_RECEIPT');
});

test('rejects mixed work, decision, or wave identity', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'ready'));
  const foreign = cloneJson(receipts[receipts.length - 1]);
  foreign.receiptId = 'receipt-foreign-work';
  foreign.workId = 'work-foreign';
  foreign.payload.workId = 'work-foreign';

  const result = coordinator(FIXTURE.featureControl.observe).reduce([...receipts, foreign]);
  assertBlocked(result, 'MIXED_IDENTITY');
});

test('rejects unsupported feature controls', () => {
  for (const featureControl of [
    { enabled: true, phase: 'BASELINE' },
    { enabled: false, phase: 'OBSERVE' },
    { enabled: 'true', phase: 'OBSERVE' },
    { enabled: true, phase: 'RETIRE' },
    null,
  ]) {
    assert.throws(
      () => new WorkflowCoordinator({
        trustPolicy: FIXTURE.trustPolicy,
        featureControl,
        evaluatedAt: FIXTURE.evaluatedAt,
      }),
      /feature|phase|enabled|control/i,
    );
  }
});

function malformedDecisionHistory(mutator) {
  const history = FIXTURE.histories.find(({ name }) => name === 'ready');
  const receipts = receiptsFor(history);
  mutator(receipts[receipts.length - 1], receipts);
  return receipts;
}

test('fails closed on a decision sequence gap', () => {
  const receipts = malformedDecisionHistory((resolved) => {
    resolved.payload.sequence = 4;
  });
  const result = coordinator(FIXTURE.featureControl.observe).reduce(receipts);
  assertBlocked(result, 'DECISION_CHAIN_GAP');
});

test('fails closed on a decision chain fork', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'ready'));
  const fork = cloneJson(receipts[1]);
  fork.receiptId = 'receipt-decision-required-fork';
  fork.payload.supersedesReceiptId = 'receipt-work-recorded';
  receipts.push(fork);

  const result = coordinator(FIXTURE.featureControl.observe).reduce(receipts);
  assertBlocked(result, 'DECISION_CHAIN_FORK');
});

test('fails closed on stale decision resurrection after invalidation', () => {
  const receipts = receiptsFor(FIXTURE.histories.find(({ name }) => name === 'decision-invalidated'));
  const stale = cloneJson(RECEIPTS_BY_ID.get('receipt-decision-resolved'));
  stale.receiptId = 'receipt-stale-resurrection';
  stale.recordedAt = '2026-09-06T04:09:00.000Z';
  stale.payload.sequence = 5;
  stale.payload.supersedesReceiptId = 'receipt-decision-resolved';
  receipts.push(stale);

  const result = coordinator(FIXTURE.featureControl.observe).reduce(receipts);
  assertBlocked(result, 'STALE_DECISION_RESURRECTION');
});

run('workflow-coordinator');
