'use strict';

// Git-provider -> Review Gate merge-observation adapter (issue #371,
// ADR-0017 "Platform Adapters may translate only: ... Git-provider merge and
// check observations to authority or verification receipts."). A merge
// observation is not an Override Authority Receipt (ADR-0017's `authority`
// kind is fixed to the hard-rule-exception shape: reason/risk/approver/
// skippedGate/remediation), so this adapter emits a `verification`/
// PROVIDER_MERGE receipt instead, bound to the merge commit itself rather
// than the reviewed head commit.

const {
  canonicalJson,
  sha256,
  SAFE_ID,
  COMMIT,
  TREE,
} = require('./receipt-primitives');
const {
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
} = require('./review-gate-receipt-store');
const {
  VERIFICATION_SCHEMA,
  VERIFICATION_OUTCOMES,
} = require('./workflow-coordinator-evidence');

const ADAPTER_NAME = 'git-provider-review-gate';
const EVENT_TYPE = 'PROVIDER_MERGE_OBSERVED';
const EVIDENCE_TYPE = 'PROVIDER_MERGE';
const ACTIVATION_STATES = new Set(['INACTIVE', 'ACTIVE']);
const ACTIVATION_EFFECTS = Object.freeze({ INACTIVE: 'DISABLED', ACTIVE: 'OBSERVE_ONLY' });
const IDENTITY_FIELDS = Object.freeze(['workId', 'waveId', 'planId', 'decisionId', 'sessionId']);
const MERGE_OUTCOMES = new Set(['PASS', 'COMPLETE']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSafeId = (value) => typeof value === 'string' && SAFE_ID.test(value);

class GitProviderReviewGateAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GitProviderReviewGateAdapterError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new GitProviderReviewGateAdapterError(code);
};

const requireRecord = (value, code = 'MALFORMED_INPUT') => {
  if (!isRecord(value)) fail(code);
};

const requireSafe = (value, code = 'MALFORMED_INPUT') => {
  if (!isSafeId(value)) fail(code);
};

const requireVersionText = (value, code = 'MALFORMED_INPUT') => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) fail(code);
};

const requireGitIdentity = (value, code = 'MALFORMED_INPUT') => {
  requireRecord(value, code);
  if (!COMMIT.test(value.commit || '') || !TREE.test(value.tree || '')) fail(code);
};

const requireIdentity = (value, code = 'MALFORMED_INPUT') => {
  requireRecord(value, code);
  IDENTITY_FIELDS.forEach((field) => requireSafe(value[field], code));
};

const normalizeTimestamp = (now) => {
  let value;
  try {
    value = now();
  } catch (_) {
    fail('INVALID_CLOCK');
  }
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(timestamp)) fail('INVALID_CLOCK');
  return new Date(timestamp).toISOString();
};

function makeEventId(producer, adapter, identity, mergeIdentity, verificationId) {
  return `git-provider-review-gate-${sha256(canonicalJson({
    producer, adapter, ...identity, commit: mergeIdentity.commit, tree: mergeIdentity.tree, verificationId,
  }))}`;
}

class GitProviderReviewGateAdapter {
  constructor({
    store,
    producer = 'git-provider-review-gate',
    adapter = 'review-gate-adapter',
    adapterVersion = 'git-provider-review-gate.v1',
    activation = 'INACTIVE',
    now = () => Date.now(),
  } = {}) {
    if (!store || typeof store.append !== 'function') fail('CONFIGURATION');
    if (!ACTIVATION_STATES.has(activation)) fail('CONFIGURATION');
    if (typeof now !== 'function') fail('CONFIGURATION');
    requireSafe(producer, 'CONFIGURATION');
    requireSafe(adapter, 'CONFIGURATION');
    requireVersionText(adapterVersion, 'CONFIGURATION');
    this.store = store;
    this.producer = producer;
    this.adapter = adapter;
    this.adapterVersion = adapterVersion;
    this.activation = activation;
    this.now = now;
    this._capabilities = Object.freeze({
      adapter: ADAPTER_NAME,
      version: adapterVersion,
      storeEventSchema: STORE_EVENT_SCHEMA,
      receiptSchema: EVIDENCE_RECEIPT_SCHEMA,
      evidenceType: EVIDENCE_TYPE,
      activation,
      effect: ACTIVATION_EFFECTS[activation],
      authority: 'SENTINEL',
      allowsTargetProgress: false,
    });
  }

  capabilities() {
    return this._capabilities;
  }

  record({
    identity,
    mergeIdentity,
    policyVersion,
    contractVersion,
    verificationId,
    outcome,
    expectedRevision = 0,
  } = {}) {
    if (this.activation !== 'ACTIVE') fail('ADAPTER_INACTIVE');
    requireIdentity(identity);
    requireGitIdentity(mergeIdentity);
    requireVersionText(policyVersion);
    requireVersionText(contractVersion);
    requireSafe(verificationId);
    if (!VERIFICATION_OUTCOMES.includes(outcome) || !MERGE_OUTCOMES.has(outcome)) fail('MALFORMED_INPUT');

    const recordedAt = normalizeTimestamp(this.now);
    const eventId = makeEventId(this.producer, this.adapter, identity, mergeIdentity, verificationId);
    const payload = {
      schema: VERIFICATION_SCHEMA,
      verificationId,
      lane: 'provider-merge',
      evidenceType: EVIDENCE_TYPE,
      outcome,
    };
    const shared = {
      workId: identity.workId,
      waveId: identity.waveId,
      producer: this.producer,
      adapter: this.adapter,
      sessionId: identity.sessionId,
      sourceCommit: mergeIdentity.commit,
      sourceTree: mergeIdentity.tree,
      policyVersion,
      contractVersion,
      recordedAt,
    };
    const event = {
      schema: STORE_EVENT_SCHEMA,
      eventId,
      eventType: EVENT_TYPE,
      ...shared,
      payload,
    };
    const receipt = {
      schema: EVIDENCE_RECEIPT_SCHEMA,
      receiptId: `${eventId}:receipt`,
      kind: 'verification',
      planId: identity.planId,
      decisionId: identity.decisionId,
      ...shared,
      payload,
    };

    const storeResult = this.store.append({ expectedRevision, event, receipts: [receipt] });
    return { receipt, event, storeResult };
  }
}

module.exports = {
  ADAPTER_NAME,
  GitProviderReviewGateAdapter,
  GitProviderReviewGateAdapterError,
};
