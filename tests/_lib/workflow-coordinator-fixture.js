'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WorkflowCoordinator } = require('../../scripts/lib/workflow-coordinator');

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'review-gate', 'workflow-coordinator-v1.json'),
  'utf8',
));

const RECEIPTS_BY_ID = new Map(FIXTURE.receipts.map((receipt) => [receipt.receiptId, receipt]));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function receiptsForIds(receiptIds) {
  return receiptIds.map((receiptId) => clone(RECEIPTS_BY_ID.get(receiptId)));
}

function receiptsForHistory(name) {
  const history = FIXTURE.histories.find((candidate) => candidate.name === name);
  if (!history) throw new Error(`Unknown workflow coordinator history: ${name}`);
  return receiptsForIds(history.receiptIds);
}

function receipt(receiptId) {
  if (!RECEIPTS_BY_ID.has(receiptId)) throw new Error(`Unknown workflow coordinator receipt: ${receiptId}`);
  return clone(RECEIPTS_BY_ID.get(receiptId));
}

function decisionReceipts(receipts) {
  return receipts.filter(({ kind }) => kind === 'decision');
}

function latestDecision(receipts) {
  return decisionReceipts(receipts).sort((left, right) => (
    left.payload.sequence - right.payload.sequence
  )).at(-1);
}

function withAuthorityTrustPolicy() {
  return clone({
    ...FIXTURE.trustPolicy,
    producers: [
      ...FIXTURE.trustPolicy.producers,
      {
        producer: 'human-authority',
        adapter: 'human-authority-adapter',
        receiptKinds: ['authority'],
      },
    ],
  });
}

function coordinator({
  featureControl = FIXTURE.featureControl.observe,
  trustPolicy = FIXTURE.trustPolicy,
  evaluatedAt = FIXTURE.evaluatedAt,
} = {}) {
  return new WorkflowCoordinator({ trustPolicy, featureControl, evaluatedAt });
}

function reduce(receipts, options = {}) {
  return coordinator(options).reduce(receipts);
}

function makeAuthorityReceipt({
  receiptId = 'receipt-authority-code-review',
  eventId = 'authority-event-code-review',
  obligationId = 'obligation-code-review',
  lane = 'code-reviewer',
  target = { type: 'OBLIGATION', obligationId },
  issuedAt = '2026-09-06T03:00:00.000Z',
  expiresAt = '2026-09-06T05:00:00.000Z',
} = {}) {
  const decision = receipt('receipt-decision-resolved');
  return {
    schema: 'dhpk.review-gate.evidence-receipt.v1',
    receiptId,
    kind: 'authority',
    workId: decision.workId,
    waveId: decision.waveId,
    planId: decision.planId,
    decisionId: decision.decisionId,
    ...(obligationId ? { obligationId, lane } : {}),
    producer: 'human-authority',
    adapter: 'human-authority-adapter',
    sessionId: 'human-authority-session-368',
    sourceCommit: decision.sourceCommit,
    sourceTree: decision.sourceTree,
    policyVersion: decision.policyVersion,
    contractVersion: decision.contractVersion,
    recordedAt: '2026-09-06T04:10:00.000Z',
    payload: {
      eventId,
      target,
      reason: 'approved exception for the named gate',
      risk: 'temporary review bypass is bounded by expiry and remediation',
      approver: 'human:architecture-owner',
      skippedGate: lane || 'review-wave',
      remediation: 'complete the skipped review before the next release',
      issuedAt,
      expiresAt,
    },
  };
}

function makeFreshnessReceipt({
  receiptId = 'receipt-freshness-review-expired',
  verificationId = 'verification-freshness-code-review',
  targetReceiptId = 'receipt-review-pass',
  lane = 'code-reviewer',
  outcome = 'EXPIRED',
} = {}) {
  const source = receipt('receipt-local-gate-pass');
  return {
    ...source,
    receiptId,
    recordedAt: '2026-09-06T04:06:30.000Z',
    payload: {
      ...source.payload,
      verificationId,
      evidenceType: 'FRESHNESS',
      lane,
      outcome,
      targetReceiptId,
      scopeDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      governingInputsHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      premiseHash: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      evidenceReferences: ['review:receipt-review-pass'],
    },
  };
}

module.exports = {
  FIXTURE,
  clone,
  coordinator,
  decisionReceipts,
  latestDecision,
  makeAuthorityReceipt,
  makeFreshnessReceipt,
  receipt,
  receiptsForHistory,
  receiptsForIds,
  reduce,
  withAuthorityTrustPolicy,
};
