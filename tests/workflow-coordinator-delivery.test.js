'use strict';

// RED contract for issue #371 AC5-AC7:
//   AC5 - reaching MERGE_READY with an authorized Work Record surfaces
//         authorizesPullRequest without granting a second enforcement effect.
//   AC6 - Delivery Complete/archive eligibility requires an observed merge
//         commit AND required post-merge CI, evaluated as a second receipt
//         set bound to the merge commit identity (ADR-0013's STALE_EVIDENCE
//         invariant forbids mixing it with the pre-merge evidence set).
//   AC7 - missing transport/provider evidence reports PENDING/BLOCKED and
//         never overstates local Implementation Complete.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  FIXTURE,
  receipt,
  receiptsForHistory,
} = require('./_lib/workflow-coordinator-fixture');
const { WorkflowCoordinator } = require('../scripts/lib/workflow-coordinator');
const { ReceiptStore } = require('../scripts/lib/review-gate-receipt-store');
const { GitProviderReviewGateAdapter } = require('../scripts/lib/git-provider-review-gate-adapter');
const { CiReviewGateAdapter } = require('../scripts/lib/ci-review-gate-adapter');

const INTEGRITY_KEY = 'workflow-coordinator-delivery-test-key-371';
const NOW = () => '2026-09-07T00:00:00.000Z';
const IDENTITY = Object.freeze({
  workId: 'work-368', waveId: 'wave-368', planId: 'plan-368', decisionId: 'decision-368', sessionId: 'session-368',
});
const MERGE_IDENTITY = Object.freeze({
  commit: '5555555555555555555555555555555555555555',
  tree: '6666666666666666666666666666666666666666',
});
const POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';

function providerTrustPolicy() {
  return {
    producers: [
      { producer: 'git-provider-review-gate', adapter: 'review-gate-adapter', receiptKinds: ['verification'] },
      { producer: 'ci-review-gate', adapter: 'review-gate-adapter', receiptKinds: ['verification'] },
    ],
  };
}

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-workflow-delivery-'));
  return new ReceiptStore({
    root,
    integrityKey: INTEGRITY_KEY,
    trustPolicy: {
      producers: [
        {
          producer: 'git-provider-review-gate',
          adapter: 'review-gate-adapter',
          eventTypes: ['PROVIDER_MERGE_OBSERVED'],
          receiptKinds: ['verification'],
        },
        {
          producer: 'ci-review-gate',
          adapter: 'review-gate-adapter',
          eventTypes: ['CI_VERIFICATION_RECORDED'],
          receiptKinds: ['verification'],
        },
      ],
    },
  });
}

function mergeObservedReceipt(store, overrides = {}) {
  const adapter = new GitProviderReviewGateAdapter({ store, activation: 'ACTIVE', now: NOW });
  return adapter.record({
    identity: IDENTITY,
    mergeIdentity: MERGE_IDENTITY,
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    verificationId: 'verification-provider-merge',
    outcome: 'COMPLETE',
    ...overrides,
  }).receipt;
}

function postMergeCiReceipt(store, overrides = {}) {
  const adapter = new CiReviewGateAdapter({ store, activation: 'ACTIVE', now: NOW });
  return adapter.record({
    identity: IDENTITY,
    headIdentity: MERGE_IDENTITY,
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    verificationId: 'verification-post-merge-ci',
    lane: 'post-merge',
    outcome: 'PASS',
    ...overrides,
  }).receipt;
}

function deliveryCoordinator(trustPolicy = providerTrustPolicy()) {
  return new WorkflowCoordinator({
    trustPolicy,
    featureControl: FIXTURE.featureControl.observe,
    evaluatedAt: FIXTURE.evaluatedAt,
  });
}

function deliveryAuthorizedMergeReadyReceipts() {
  const receipts = receiptsForHistory('merge-ready');
  return receipts.map((item) => {
    if (item.receiptId !== 'receipt-decision-resolved') return item;
    return { ...item, payload: { ...item.payload, deliveryAuthorized: true } };
  });
}

test('MERGE_READY without an authorized Work Record does not authorize PR creation', () => {
  const projection = deliveryCoordinator(FIXTURE.trustPolicy).reduce(receiptsForHistory('merge-ready'));
  assert.strictEqual(projection.state, 'MERGE_READY');
  assert.strictEqual(projection.authorizesPullRequest, false);
});

test('MERGE_READY with an authorized Work Record authorizes PR creation without a second enforcement effect', () => {
  const projection = deliveryCoordinator(FIXTURE.trustPolicy).reduce(deliveryAuthorizedMergeReadyReceipts());
  assert.strictEqual(projection.state, 'MERGE_READY');
  assert.strictEqual(projection.authorizesPullRequest, true);
  assert.strictEqual(projection.control.authority, 'SENTINEL');
  assert.strictEqual(projection.control.allowsTargetProgress, false);
});

test('authorizesPullRequest stays false before MERGE_READY even when delivery is authorized', () => {
  const receipts = deliveryAuthorizedMergeReadyReceipts()
    .filter((item) => item.receiptId !== 'receipt-review-pass' && item.receiptId !== 'receipt-local-gate-pass');
  const projection = deliveryCoordinator(FIXTURE.trustPolicy).reduce(receipts);
  assert.notStrictEqual(projection.state, 'MERGE_READY');
  assert.strictEqual(projection.authorizesPullRequest, false);
});

test('Delivery Complete requires both an observed merge commit and post-merge CI', () => {
  const receipts = [mergeObservedReceipt(makeStore()), postMergeCiReceipt(makeStore())];
  const projection = deliveryCoordinator().reduceDelivery(receipts);
  assert.strictEqual(projection.state, 'ARCHIVE_READY');
  assert.strictEqual(projection.completion.delivery, 'COMPLETE');
});

test('a merge observation alone is not Delivery Complete', () => {
  const store = makeStore();
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(store)]);
  assert.strictEqual(projection.state, 'POST_MERGE_PENDING');
  assert.strictEqual(projection.completion.delivery, 'PENDING');
  assert.ok(projection.condition.reasonCodes.includes('POST_MERGE_CI_UNOBSERVED'));
});

test('post-merge CI alone without an observed merge is not Delivery Complete', () => {
  const store = makeStore();
  const projection = deliveryCoordinator().reduceDelivery([postMergeCiReceipt(store)]);
  assert.strictEqual(projection.state, 'POST_MERGE_PENDING');
  assert.ok(projection.condition.reasonCodes.includes('MERGE_UNOBSERVED'));
});

test('missing transport reports BLOCKED/PENDING and never overstates delivery', () => {
  const projection = deliveryCoordinator().reduceDelivery([]);
  assert.strictEqual(projection.completion.delivery, 'PENDING');
  assert.strictEqual(projection.condition.type, 'BLOCKED');
});

test('missing post-merge transport does not overstate the already-observed Implementation Complete', () => {
  const implementationProjection = deliveryCoordinator(FIXTURE.trustPolicy).reduce(receiptsForHistory('merge-ready'));
  assert.strictEqual(implementationProjection.completion.implementation, 'COMPLETE');

  const deliveryProjection = deliveryCoordinator().reduceDelivery([]);
  assert.strictEqual(deliveryProjection.completion.delivery, 'PENDING');
});

test('a pre-merge verification receipt cannot masquerade as the merge-commit delivery set', () => {
  const preMergeLocalGate = receipt('receipt-local-gate-pass');
  const projection = deliveryCoordinator(FIXTURE.trustPolicy).reduceDelivery([preMergeLocalGate]);
  assert.strictEqual(projection.completion.delivery, 'PENDING');
});

run('workflow-coordinator-delivery');
