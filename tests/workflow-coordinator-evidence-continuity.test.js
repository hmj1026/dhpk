'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  FIXTURE,
  clone,
  makeAuthorityReceipt,
  makeFreshnessReceipt,
  receipt,
  receiptsForHistory,
  reduce,
  withAuthorityTrustPolicy,
} = require('./_lib/workflow-coordinator-fixture');

const MERGE_READY = 'merge-ready';

function assertState(result, state, refreshLanes, condition = null) {
  assert.strictEqual(result.state, state);
  assert.deepStrictEqual(result.refreshLanes, refreshLanes);
  assert.deepStrictEqual(result.condition, condition);
}

function assertBlocked(result, resumeState, reasonCode) {
  assert.strictEqual(result.evidenceAccepted, true);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState,
    reasonCodes: [reasonCode],
  });
}

function assertRejected(result, reasonCode) {
  assert.strictEqual(result.evidenceAccepted, false);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'EVIDENCE_PENDING',
    reasonCodes: [reasonCode],
  });
}

function receiptById(receipts, receiptId) {
  const found = receipts.find((candidate) => candidate.receiptId === receiptId);
  if (!found) throw new Error(`Receipt not present in scenario: ${receiptId}`);
  return found;
}

function missingReviewWithLocalPass() {
  return [
    ...receiptsForHistory('evidence-pending'),
    receipt('receipt-local-gate-pass'),
  ];
}

test('current review CHANGES_REQUIRED reopens only its review lane', () => {
  const receipts = receiptsForHistory(MERGE_READY);
  const review = receiptById(receipts, 'receipt-review-pass');
  review.payload.semanticVerdict = 'CHANGES_REQUIRED';
  review.payload.findings = [{
    id: 'finding-current-review',
    severity: 'HIGH',
    disposition: 'MUST_FIX',
    summary: 'the current review still requires a change',
    evidence: ['artifact:finding-current-review'],
  }];

  const result = reduce(receipts);

  assertState(result, 'EXECUTING', ['code-reviewer']);
  assert.strictEqual(result.completion.implementation, 'PENDING');
});

test('current required LOCAL_GATE FAIL reopens only its verification lane', () => {
  const receipts = receiptsForHistory(MERGE_READY);
  receiptById(receipts, 'receipt-local-gate-pass').payload.outcome = 'FAIL';

  const result = reduce(receipts);

  assertState(result, 'EXECUTING', ['unit']);
  assert.strictEqual(result.completion.implementation, 'PENDING');
});

for (const executionStatus of ['NOT_RUN', 'INTERRUPTED']) {
  test(`review ${executionStatus} remains evidence pending`, () => {
    const receipts = receiptsForHistory(MERGE_READY);
    const review = receiptById(receipts, 'receipt-review-pass');
    review.payload.executionStatus = executionStatus;
    delete review.payload.semanticVerdict;

    const result = reduce(receipts);

    assertState(result, 'EVIDENCE_PENDING', ['code-reviewer']);
  });
}

test('review BLOCKED is resumably blocked without changing canonical state', () => {
  const receipts = receiptsForHistory(MERGE_READY);
  const review = receiptById(receipts, 'receipt-review-pass');
  review.payload.semanticVerdict = 'BLOCKED';

  const result = reduce(receipts);

  assertBlocked(result, 'EVIDENCE_PENDING', 'REVIEW_BLOCKED');
  assert.deepStrictEqual(result.refreshLanes, ['code-reviewer']);
});

test('review UNAVAILABLE is resumably blocked without changing canonical state', () => {
  const receipts = receiptsForHistory(MERGE_READY);
  const review = receiptById(receipts, 'receipt-review-pass');
  review.payload.executionStatus = 'UNAVAILABLE';
  delete review.payload.semanticVerdict;

  const result = reduce(receipts);

  assertBlocked(result, 'EVIDENCE_PENDING', 'REVIEW_UNAVAILABLE');
  assert.deepStrictEqual(result.refreshLanes, ['code-reviewer']);
});

test('required local BLOCKED remains a resumable blocked condition', () => {
  const result = reduce(receiptsForHistory('blocked'));

  assertBlocked(result, 'EVIDENCE_PENDING', 'LOCAL_GATE_UNAVAILABLE');
  assert.deepStrictEqual(result.refreshLanes, ['unit']);
});

test('required local UNAVAILABLE remains a resumable blocked condition', () => {
  const receipts = receiptsForHistory(MERGE_READY);
  const localGate = receiptById(receipts, 'receipt-local-gate-pass');
  localGate.payload.outcome = 'UNAVAILABLE';

  const result = reduce(receipts);

  assertBlocked(result, 'EVIDENCE_PENDING', 'LOCAL_GATE_UNAVAILABLE');
  assert.deepStrictEqual(result.refreshLanes, ['unit']);
});

test('explicit FRESHNESS expiry invalidates only its exact target receipt and lane', () => {
  const receipts = [
    ...receiptsForHistory(MERGE_READY),
    makeFreshnessReceipt(),
  ];

  const result = reduce(receipts);

  assertState(result, 'EVIDENCE_PENDING', ['code-reviewer']);
  assert.ok(result.evidenceReceiptIds.includes('receipt-freshness-review-expired'));
});

test('implementation freshness expiry refreshes only the implementation lane', () => {
  const freshness = makeFreshnessReceipt({
    targetReceiptId: 'receipt-implementation-complete',
    lane: 'implementation',
  });
  const result = reduce([...receiptsForHistory(MERGE_READY), freshness]);

  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.deepStrictEqual(result.refreshLanes, ['implementation']);
  assert.strictEqual(result.completion.implementation, 'PENDING');
  assert.ok(result.evidenceReceiptIds.includes('receipt-review-pass'));
  assert.ok(result.evidenceReceiptIds.includes('receipt-local-gate-pass'));
});

test('FRESHNESS expiry must target the exact receipt and lane', () => {
  const receipts = [
    ...receiptsForHistory(MERGE_READY),
    makeFreshnessReceipt({
      targetReceiptId: 'receipt-local-gate-pass',
      lane: 'code-reviewer',
    }),
  ];

  const result = reduce(receipts);

  assert.strictEqual(result.evidenceAccepted, false);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'EVIDENCE_PENDING',
    reasonCodes: ['FRESHNESS_BINDING_MISMATCH'],
  });
});

test('FRESHNESS evidence requires scope, governing-input, premise, and reference bindings', () => {
  const freshness = makeFreshnessReceipt();
  delete freshness.payload.premiseHash;

  const result = reduce([...receiptsForHistory(MERGE_READY), freshness]);

  assert.strictEqual(result.evidenceAccepted, false);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'EVIDENCE_PENDING',
    reasonCodes: ['MALFORMED_RECEIPT'],
  });
});

test('an expiresAt field alone never derives evidence expiry', () => {
  const receipts = receiptsForHistory(MERGE_READY);
  receiptById(receipts, 'receipt-local-gate-pass').payload.expiresAt = '2026-09-06T03:00:00.000Z';

  const result = reduce(receipts);

  assertState(result, 'MERGE_READY', []);
  assert.deepStrictEqual(result.completion, {
    implementation: 'COMPLETE',
    delivery: 'PENDING',
    workflow: 'PENDING',
  });
});

test('a later eligible same-lane replacement restores freshness satisfaction', () => {
  const replacement = receipt('receipt-review-pass');
  replacement.receiptId = 'receipt-review-pass-replacement';
  replacement.recordedAt = '2026-09-06T04:11:00.000Z';
  replacement.payload.eventId = 'review-event-368-pass-replacement';
  replacement.payload.resultDigest = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
  const receipts = [
    ...receiptsForHistory(MERGE_READY),
    makeFreshnessReceipt(),
    replacement,
  ];

  const result = reduce(receipts);

  assertState(result, 'MERGE_READY', []);
  assert.ok(result.evidenceReceiptIds.includes('receipt-freshness-review-expired'));
  assert.ok(result.evidenceReceiptIds.includes('receipt-review-pass-replacement'));
  assert.ok(!result.refreshLanes.includes('unit'));
});

test('governing or premise invalidation returns to decision pending despite complete evidence', () => {
  const receipts = [
    ...receiptsForHistory('decision-invalidated'),
    receipt('receipt-implementation-complete'),
    receipt('receipt-review-pass'),
    receipt('receipt-local-gate-pass'),
  ];
  const invalidated = receiptById(receipts, 'receipt-decision-invalidated');
  invalidated.payload.governingInputsHash = 'sha256:abababababababababababababababababababababababababababababababab';
  invalidated.payload.premiseHash = 'sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';

  const result = reduce(receipts);

  assertState(result, 'DECISION_PENDING', []);
  assert.deepStrictEqual(result.decisionPacket.items.map(({ requestId }) => requestId), [
    'authority-request-368-a',
    'authority-request-368-b',
  ]);
  assert.deepStrictEqual(result.completion, {
    implementation: 'PENDING',
    delivery: 'PENDING',
    workflow: 'PENDING',
  });
});

test('IMMEDIATE_STOP authority request blocks before batch packet construction', () => {
  const receipts = receiptsForHistory('decision-pending');
  const decision = receiptById(receipts, 'receipt-decision-required');
  decision.payload.authorityRequests[0].urgency = 'IMMEDIATE_STOP';

  const result = reduce(receipts);

  assert.strictEqual(result.evidenceAccepted, true);
  assert.strictEqual(result.state, 'DECISION_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'DECISION_PENDING',
    reasonCodes: ['IMMEDIATE_AUTHORITY_REQUIRED'],
  });
  assert.strictEqual(result.state, 'DECISION_PENDING');
  assert.strictEqual(result.decisionPacket, null);
});

test('DECISION_INVALIDATED with blocking IMMEDIATE_STOP remains decision pending and blocked', () => {
  const receipts = receiptsForHistory('decision-invalidated');
  const decision = receiptById(receipts, 'receipt-decision-invalidated');
  decision.payload.authorityRequests[0].urgency = 'IMMEDIATE_STOP';

  const result = reduce(receipts);

  assert.strictEqual(result.evidenceAccepted, true);
  assert.strictEqual(result.state, 'DECISION_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'DECISION_PENDING',
    reasonCodes: ['IMMEDIATE_AUTHORITY_REQUIRED'],
  });
  assert.strictEqual(result.decisionPacket, null);
});

for (const scenario of [
  {
    label: 'premise hash',
    mutate: (decision) => {
      decision.payload.premiseHash = 'sha256:abababababababababababababababababababababababababababababababab';
    },
  },
  {
    label: 'governing inputs hash',
    mutate: (decision) => {
      decision.payload.governingInputsHash = 'sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
    },
  },
  {
    label: 'governing inputs',
    mutate: (decision) => {
      decision.payload.governingInputs = [{
        reference: 'docs/adr/foreign-input.md',
        digest: 'sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef',
      }];
    },
  },
]) {
  test(`ready decision ${scenario.label} change fails premise continuity`, () => {
    const receipts = receiptsForHistory('ready');
    scenario.mutate(receiptById(receipts, 'receipt-decision-resolved'));

    assertRejected(reduce(receipts), 'DECISION_PREMISE_CONTINUITY');
  });
}

test('an active trusted obligation override satisfies only its exact obligation', () => {
  const authority = makeAuthorityReceipt();
  const result = reduce(
    [...missingReviewWithLocalPass(), authority],
    { trustPolicy: withAuthorityTrustPolicy() },
  );

  assertState(result, 'MERGE_READY', []);
  assert.ok(result.evidenceReceiptIds.includes(authority.receiptId));
  assert.ok(!result.evidenceReceiptIds.includes('receipt-review-pass'));
  assert.strictEqual(result.reviewLanes.includes('code-reviewer'), true);
  assert.deepStrictEqual(result.completion, {
    implementation: 'COMPLETE',
    delivery: 'PENDING',
    workflow: 'PENDING',
  });
});

test('foreign obligation authority cannot satisfy a required review', () => {
  const authority = makeAuthorityReceipt({
    receiptId: 'receipt-authority-foreign-obligation',
    eventId: 'authority-event-foreign-obligation',
    obligationId: 'obligation-foreign',
    lane: 'foreign-reviewer',
  });
  const result = reduce(
    [...missingReviewWithLocalPass(), authority],
    { trustPolicy: withAuthorityTrustPolicy() },
  );

  assertState(result, 'EVIDENCE_PENDING', ['code-reviewer']);
  assert.ok(!result.evidenceReceiptIds.includes('receipt-review-pass'));
});

test('expired obligation authority cannot satisfy a required review', () => {
  const authority = makeAuthorityReceipt({
    receiptId: 'receipt-authority-expired',
    eventId: 'authority-event-expired',
    expiresAt: '2026-09-06T03:59:59.000Z',
  });
  const result = reduce(
    [...missingReviewWithLocalPass(), authority],
    { trustPolicy: withAuthorityTrustPolicy() },
  );

  assertState(result, 'EVIDENCE_PENDING', ['code-reviewer']);
});

test('wave-wide authority cannot satisfy an exact required review obligation', () => {
  const authority = makeAuthorityReceipt({
    receiptId: 'receipt-authority-wave-wide',
    eventId: 'authority-event-wave-wide',
    obligationId: null,
    lane: null,
    target: { type: 'WAVE', waveId: 'wave-368' },
  });
  const result = reduce(
    [...missingReviewWithLocalPass(), authority],
    { trustPolicy: withAuthorityTrustPolicy() },
  );

  assertState(result, 'EVIDENCE_PENDING', ['code-reviewer']);
});

test('migration observation never satisfies a required gate or changes control', () => {
  const observation = receipt('receipt-local-gate-pass');
  observation.receiptId = 'receipt-migration-observation';
  observation.kind = 'migration-observation';
  observation.recordedAt = '2026-09-06T04:12:00.000Z';
  observation.payload = {
    schema: 'dhpk.migration-observation.v1',
    observedState: 'MERGE_READY',
    allowsTargetProgress: true,
  };

  const result = reduce([...receiptsForHistory('evidence-pending'), observation]);

  assertState(result, 'EVIDENCE_PENDING', ['code-reviewer', 'unit']);
  assert.strictEqual(result.control.authority, 'SENTINEL');
  assert.strictEqual(result.control.allowsTargetProgress, false);
  assert.deepStrictEqual(result.completion, {
    implementation: 'PENDING',
    delivery: 'PENDING',
    workflow: 'PENDING',
  });
});

test('only MERGE_READY marks implementation complete while delivery and workflow stay pending', () => {
  const result = reduce(receiptsForHistory(MERGE_READY));

  assertState(result, 'MERGE_READY', []);
  assert.deepStrictEqual(result.completion, {
    implementation: 'COMPLETE',
    delivery: 'PENDING',
    workflow: 'PENDING',
  });
  assert.strictEqual(result.control.allowsTargetProgress, false);
});

run('workflow-coordinator-evidence-continuity');
