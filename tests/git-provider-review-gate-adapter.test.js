'use strict';

// RED contract for the Git-provider -> Review Gate merge-observation adapter
// (issue #371, ADR-0017 "Git-provider merge and check observations to
// authority or verification receipts."). A merge observation is bound to
// the merge commit itself, never the reviewed head commit, and it is never
// an Override Authority Receipt.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { ReceiptStore } = require('../scripts/lib/review-gate-receipt-store');
const {
  ADAPTER_NAME,
  GitProviderReviewGateAdapter,
  GitProviderReviewGateAdapterError,
} = require('../scripts/lib/git-provider-review-gate-adapter');

const INTEGRITY_KEY = 'git-provider-review-gate-test-integrity-key-371';
const NOW = () => '2026-09-07T00:00:00.000Z';

const IDENTITY = Object.freeze({
  workId: 'work-368',
  waveId: 'wave-368',
  planId: 'plan-368',
  decisionId: 'decision-368',
  sessionId: 'session-368',
});
const MERGE_IDENTITY = Object.freeze({
  commit: '5555555555555555555555555555555555555555',
  tree: '6666666666666666666666666666666666666666',
});
const POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-git-provider-review-gate-'));
  return new ReceiptStore({
    root,
    integrityKey: INTEGRITY_KEY,
    trustPolicy: {
      producers: [{
        producer: 'git-provider-review-gate',
        adapter: 'review-gate-adapter',
        eventTypes: ['PROVIDER_MERGE_OBSERVED'],
        receiptKinds: ['verification'],
      }],
    },
  });
}

function makeAdapter(overrides = {}) {
  return new GitProviderReviewGateAdapter({
    store: makeStore(),
    activation: 'ACTIVE',
    now: NOW,
    ...overrides,
  });
}

function submissionInput(overrides = {}) {
  return {
    identity: IDENTITY,
    mergeIdentity: MERGE_IDENTITY,
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    verificationId: 'verification-provider-merge',
    outcome: 'COMPLETE',
    ...overrides,
  };
}

function expectRejected(fn, code, message) {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof GitProviderReviewGateAdapterError,
      `${message}: expected GitProviderReviewGateAdapterError, got ${error}`,
    );
    assert.strictEqual(error.code, code, message);
    return;
  }
  throw new Error(`${message}: expected rejection ${code}`);
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

test('appends a PROVIDER_MERGE verification receipt bound to the merge commit', () => {
  const adapter = makeAdapter();
  const { receipt, storeResult } = adapter.record(submissionInput());
  assert.strictEqual(storeResult.status, 'APPENDED');
  assert.strictEqual(receipt.kind, 'verification');
  assert.strictEqual(receipt.payload.evidenceType, 'PROVIDER_MERGE');
  assert.strictEqual(receipt.payload.outcome, 'COMPLETE');
  assert.strictEqual(receipt.producer, 'git-provider-review-gate');
  assert.strictEqual(receipt.sourceCommit, MERGE_IDENTITY.commit);
  assert.strictEqual(receipt.sourceTree, MERGE_IDENTITY.tree);
});

test('never emits an authority receipt', () => {
  const adapter = makeAdapter();
  const { receipt } = adapter.record(submissionInput());
  assert.notStrictEqual(receipt.kind, 'authority');
});

test('rejects an outcome outside the accepted merge-observed set', () => {
  const adapter = makeAdapter();
  expectRejected(
    () => adapter.record(submissionInput({ outcome: 'STARTED' })),
    'MALFORMED_INPUT',
    'a merge observation can only report PASS or COMPLETE',
  );
});

test('rejects a malformed merge identity', () => {
  const adapter = makeAdapter();
  expectRejected(
    () => adapter.record(submissionInput({ mergeIdentity: { commit: 'not-a-commit', tree: MERGE_IDENTITY.tree } })),
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

run('git-provider-review-gate-adapter');
