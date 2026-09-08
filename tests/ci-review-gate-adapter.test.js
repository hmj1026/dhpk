'use strict';

// RED contract for the CI -> Review Gate verification adapter (issue #371,
// ADR-0017 "CI results to verification receipts"; ADR-0013 "a passing test
// cannot satisfy semantic review"). The adapter never emits a `review`
// receipt, so its receipts can only ever satisfy verification lanes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  FIXTURE,
  clone,
  receiptsForHistory,
} = require('./_lib/workflow-coordinator-fixture');
const { WorkflowCoordinator } = require('../scripts/lib/workflow-coordinator');
const { ReceiptStore } = require('../scripts/lib/review-gate-receipt-store');
const {
  ADAPTER_NAME,
  CiReviewGateAdapter,
  CiReviewGateAdapterError,
} = require('../scripts/lib/ci-review-gate-adapter');

const INTEGRITY_KEY = 'ci-review-gate-test-integrity-key-371';
const NOW = () => '2026-09-07T00:00:00.000Z';

const IDENTITY = Object.freeze({
  workId: 'work-368',
  waveId: 'wave-368',
  planId: 'plan-368',
  decisionId: 'decision-368',
  sessionId: 'session-368',
});
const HEAD_IDENTITY = Object.freeze({
  commit: '3333333333333333333333333333333333333333',
  tree: '4444444444444444444444444444444444444444',
});
const POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';

function makeStore(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-review-gate-'));
  return new ReceiptStore({
    root,
    integrityKey: INTEGRITY_KEY,
    trustPolicy: {
      producers: [{
        producer: 'ci-review-gate',
        adapter: 'review-gate-adapter',
        eventTypes: ['CI_VERIFICATION_RECORDED'],
        receiptKinds: ['verification'],
      }],
    },
    ...overrides,
  });
}

function makeAdapter(overrides = {}) {
  return new CiReviewGateAdapter({
    store: makeStore(),
    activation: 'ACTIVE',
    now: NOW,
    ...overrides,
  });
}

function submissionInput(overrides = {}) {
  return {
    identity: IDENTITY,
    headIdentity: HEAD_IDENTITY,
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    verificationId: 'verification-local-gate',
    lane: 'unit',
    outcome: 'PASS',
    ...overrides,
  };
}

function expectRejected(fn, code, message) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CiReviewGateAdapterError, `${message}: expected CiReviewGateAdapterError, got ${error}`);
    assert.strictEqual(error.code, code, message);
    return;
  }
  throw new Error(`${message}: expected rejection ${code}`);
}

function workflowTrustPolicyWithCi() {
  return clone({
    producers: [
      ...FIXTURE.trustPolicy.producers,
      {
        producer: 'ci-review-gate',
        adapter: 'review-gate-adapter',
        receiptKinds: ['verification'],
      },
    ],
  });
}

test('capabilities report DISABLED while inactive and OBSERVE_ONLY once active', () => {
  const inactive = makeAdapter({ activation: 'INACTIVE' });
  assert.strictEqual(inactive.capabilities().adapter, ADAPTER_NAME);
  assert.strictEqual(inactive.capabilities().effect, 'DISABLED');
  const active = makeAdapter();
  assert.strictEqual(active.capabilities().effect, 'OBSERVE_ONLY');
  assert.strictEqual(active.capabilities().authority, 'SENTINEL');
  assert.strictEqual(active.capabilities().allowsTargetProgress, false);
});

test('refuses to record while inactive', () => {
  const adapter = makeAdapter({ activation: 'INACTIVE' });
  expectRejected(() => adapter.record(submissionInput()), 'ADAPTER_INACTIVE', 'inactive adapter must not submit');
});

test('appends a verification receipt for a passing CI run', () => {
  const adapter = makeAdapter();
  const { receipt, storeResult } = adapter.record(submissionInput());
  assert.strictEqual(storeResult.status, 'APPENDED');
  assert.strictEqual(receipt.kind, 'verification');
  assert.strictEqual(receipt.payload.evidenceType, 'LOCAL_GATE');
  assert.strictEqual(receipt.payload.outcome, 'PASS');
  assert.strictEqual(receipt.producer, 'ci-review-gate');
  assert.strictEqual(receipt.sourceCommit, HEAD_IDENTITY.commit);
});

test('rejects an unsupported verification outcome', () => {
  const adapter = makeAdapter();
  expectRejected(
    () => adapter.record(submissionInput({ outcome: 'APPROVE' })),
    'MALFORMED_INPUT',
    'only VERIFICATION_OUTCOMES may be recorded',
  );
});

test('rejects a malformed head identity', () => {
  const adapter = makeAdapter();
  expectRejected(
    () => adapter.record(submissionInput({ headIdentity: { commit: 'not-a-commit', tree: HEAD_IDENTITY.tree } })),
    'MALFORMED_INPUT',
    'a non-Git commit identity must fail closed',
  );
});

test('rejects an incomplete identity', () => {
  const adapter = makeAdapter();
  const { sessionId, ...withoutSession } = IDENTITY;
  expectRejected(
    () => adapter.record(submissionInput({ identity: withoutSession })),
    'MALFORMED_INPUT',
    'every identity field is required',
  );
});

test('a CI-emitted verification receipt satisfies the verification lane and reaches MERGE_READY', () => {
  const adapter = makeAdapter();
  const { receipt } = adapter.record(submissionInput());
  const receipts = receiptsForHistory('merge-ready')
    .filter((item) => item.receiptId !== 'receipt-local-gate-pass')
    .concat([receipt]);
  const projection = new WorkflowCoordinator({
    trustPolicy: workflowTrustPolicyWithCi(),
    featureControl: FIXTURE.featureControl.observe,
    evaluatedAt: FIXTURE.evaluatedAt,
  }).reduce(receipts);
  assert.strictEqual(projection.state, 'MERGE_READY');
  assert.strictEqual(projection.completion.implementation, 'COMPLETE');
});

test('a CI-emitted verification receipt cannot substitute for the required semantic review', () => {
  const adapter = makeAdapter();
  const { receipt } = adapter.record(submissionInput());
  const receipts = receiptsForHistory('merge-ready')
    .filter((item) => item.receiptId !== 'receipt-local-gate-pass' && item.receiptId !== 'receipt-review-pass')
    .concat([receipt]);
  const projection = new WorkflowCoordinator({
    trustPolicy: workflowTrustPolicyWithCi(),
    featureControl: FIXTURE.featureControl.observe,
    evaluatedAt: FIXTURE.evaluatedAt,
  }).reduce(receipts);
  assert.notStrictEqual(projection.state, 'MERGE_READY');
  assert.ok(projection.reviewLanes.includes('code-reviewer'));
});

test('a CI-emitted verification lane refreshes independently when governing inputs invalidate it', () => {
  const adapter = makeAdapter();
  const { receipt } = adapter.record(submissionInput());
  const freshness = {
    ...receipt,
    receiptId: 'receipt-freshness-ci-local-gate',
    recordedAt: '2026-09-07T00:00:01.000Z',
    payload: {
      schema: receipt.payload.schema,
      verificationId: 'verification-freshness-ci-local-gate',
      evidenceType: 'FRESHNESS',
      lane: 'unit',
      outcome: 'EXPIRED',
      targetReceiptId: receipt.receiptId,
      scopeDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      governingInputsHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      premiseHash: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      evidenceReferences: [`verification:${receipt.receiptId}`],
    },
  };
  const receipts = receiptsForHistory('merge-ready')
    .filter((item) => item.receiptId !== 'receipt-local-gate-pass')
    .concat([receipt, freshness]);
  const projection = new WorkflowCoordinator({
    trustPolicy: workflowTrustPolicyWithCi(),
    featureControl: FIXTURE.featureControl.observe,
    evaluatedAt: FIXTURE.evaluatedAt,
  }).reduce(receipts);
  assert.notStrictEqual(projection.state, 'MERGE_READY');
  assert.deepStrictEqual(projection.refreshLanes, ['unit']);
});

run('ci-review-gate-adapter');
