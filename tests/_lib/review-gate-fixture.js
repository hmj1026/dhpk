'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createFinding,
  createReviewResult,
  REVIEWER_CONTRACT_VERSION,
} = require('../../scripts/lib/reviewer-contract');
const {
  INITIAL_RISK_POLICY,
  RiskRouter,
  createWorkRecord,
} = require('../../scripts/lib/risk-router');
const {
  EVIDENCE_RECEIPT_SCHEMA,
  ReceiptStore,
  STORE_EVENT_SCHEMA,
} = require('../../scripts/lib/review-gate-receipt-store');
const {
  AUTHORITY_OVERRIDE_RECORDED,
  ReviewGate,
} = require('../../scripts/lib/review-gate');

const NOW = '2026-09-06T04:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const INTEGRITY_KEY = 'review-gate-issue-367-integrity-key';
const EMPTY_DIFF_DIGEST = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const BASE_PRODUCERS = [
  {
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    eventTypes: ['PLAN_REGISTERED', 'REVIEW_RESULT_RECORDED', 'INPUTS_INVALIDATED'],
    receiptKinds: ['review'],
    lanes: ['code-reviewer', 'security-reviewer'],
  },
  {
    producer: 'replacement-reviewer',
    adapter: 'replacement-adapter',
    eventTypes: ['REVIEW_RESULT_RECORDED'],
    receiptKinds: ['review'],
    lanes: ['code-reviewer'],
  },
];

const AUTHORITY_PRODUCER = Object.freeze({
  producer: 'human-authority',
  adapter: 'human-authority-adapter',
  eventTypes: Object.freeze([AUTHORITY_OVERRIDE_RECORDED]),
  receiptKinds: Object.freeze(['authority']),
  lanes: Object.freeze(['code-reviewer', 'security-reviewer']),
});

const makeTrustPolicy = ({ authority = false } = {}) => Object.freeze({
  producers: Object.freeze([
    ...BASE_PRODUCERS.map((entry) => Object.freeze({
      ...entry,
      eventTypes: Object.freeze([...entry.eventTypes]),
      receiptKinds: Object.freeze([...entry.receiptKinds]),
      lanes: Object.freeze([...entry.lanes]),
    })),
    ...(authority ? [AUTHORITY_PRODUCER] : []),
  ]),
});

const TRUST_POLICY = makeTrustPolicy();
const AUTHORITY_TRUST_POLICY = makeTrustPolicy({ authority: true });

const makePlan = ({
  empty = false,
  materialRisks = ['BEHAVIOR_CHANGE'],
  paths = ['scripts/lib/review-gate.js'],
  kinds = ['SOURCE'],
  baseIdentity = { commit: '1'.repeat(40), tree: '2'.repeat(40) },
  headIdentity = { commit: '3'.repeat(40), tree: '4'.repeat(40) },
  diff = {
    digest: `sha256:${'5'.repeat(64)}`,
    reference: 'git-diff:issue-367',
  },
  governingInputs = [{
    reference: 'docs/adr/0017-implement-review-gate-as-a-local-event-module.md',
    digest: `sha256:${'6'.repeat(64)}`,
  }],
  requestId = 'github:issue:367',
  decisionKey = 'first-review-gate-lifecycle',
} = {}) => {
  const request = {
    schemaVersion: 'dhpk.work-request.v1',
    requestId,
    decisionKey,
    scope: {
      paths: [...paths],
      kinds: [...kinds],
      baseIdentity: { ...baseIdentity },
      headIdentity: { ...headIdentity },
      diff: { ...diff },
    },
    ownership: {
      judgmentOwner: 'architect',
      implementationOwner: 'worker:issue-367',
    },
    materialRisks: [...materialRisks],
    governingInputs: governingInputs.map((input) => ({ ...input })),
    outcomeReferences: [{ kind: 'ISSUE', reference: 'github:issue:367' }],
    observations: {
      fileCount: 1,
      lineCount: 1,
      taskCount: 1,
      availableAgentCount: 1,
    },
    extensions: {},
  };
  if (empty) {
    request.scope.paths = [];
    request.scope.kinds = [];
    request.scope.headIdentity = {
      ...request.scope.headIdentity,
      tree: request.scope.baseIdentity.tree,
    };
    request.scope.diff.digest = EMPTY_DIFF_DIGEST;
  }
  return new RiskRouter().plan(createWorkRecord(request), INITIAL_RISK_POLICY);
};

const makeEvent = (plan, {
  eventId,
  eventType,
  payload,
  producer = 'fixture-reviewer',
  adapter = 'fixture-adapter',
  sessionId = 'session-367',
  obligationId,
  lane,
  recordedAt = NOW,
  sourceCommit = plan.headIdentity.commit,
  sourceTree = plan.headIdentity.tree,
  policyVersion = plan.policyVersion,
  contractVersion = REVIEWER_CONTRACT_VERSION,
} = {}) => ({
  schema: STORE_EVENT_SCHEMA,
  eventId,
  eventType,
  workId: plan.workId,
  waveId: plan.waveId,
  planId: plan.planId,
  decisionId: plan.decisionId,
  ...(obligationId ? { obligationId } : {}),
  ...(lane ? { lane } : {}),
  producer,
  adapter,
  sessionId,
  sourceCommit,
  sourceTree,
  policyVersion,
  contractVersion,
  recordedAt,
  payload,
});

const makePlanEvent = (plan, eventId = 'plan-registered-1', options = {}) => makeEvent(plan, {
  ...options,
  eventId,
  eventType: 'PLAN_REGISTERED',
  payload: { plan },
});

const makeReviewResult = (plan, obligation, {
  executionStatus = 'COMPLETE',
  applicability = 'REQUIRED',
  semanticVerdict,
  lane = obligation.lane,
  findings = [],
  inspectedScope = plan.scope.paths,
  evidenceReferences = ['artifact:review-367'],
} = {}) => {
  const input = {
    contractVersion: REVIEWER_CONTRACT_VERSION,
    obligationId: obligation.obligationId,
    lane,
    executionStatus,
    applicability,
    findings,
    inspectedScope,
    evidenceReferences,
  };
  if (semanticVerdict !== undefined) input.semanticVerdict = semanticVerdict;
  return createReviewResult(input);
};

const makeReviewEvent = (plan, obligation, request, options = {}) => {
  const result = makeReviewResult(plan, obligation, options);
  return makeEvent(plan, {
    eventId: options.eventId || `review-result-${result.executionStatus.toLowerCase()}`,
    eventType: 'REVIEW_RESULT_RECORDED',
    obligationId: obligation.obligationId,
    lane: result.lane,
    payload: {
      request,
      result,
      executedCommands: options.executedCommands || [{
        command: 'node tests/reviewer-contract-v2.test.js',
        outcome: 'PASS',
      }],
    },
    producer: options.producer || 'fixture-reviewer',
    adapter: options.adapter || 'fixture-adapter',
    sessionId: options.sessionId || 'session-367',
    recordedAt: options.recordedAt || NOW,
    sourceCommit: options.sourceCommit || plan.headIdentity.commit,
    sourceTree: options.sourceTree || plan.headIdentity.tree,
    policyVersion: options.policyVersion || plan.policyVersion,
    contractVersion: options.contractVersion || REVIEWER_CONTRACT_VERSION,
  });
};

const makeInputsInvalidatedEvent = (plan, eventId = 'inputs-invalidated-1', options = {}) => makeEvent(plan, {
  eventId,
  eventType: 'INPUTS_INVALIDATED',
  payload: { plan },
  producer: options.producer || 'fixture-reviewer',
  adapter: options.adapter || 'fixture-adapter',
  sessionId: options.sessionId || 'session-367',
  recordedAt: options.recordedAt || NOW,
});

const makeAuthorityReceipt = (plan, {
  obligation = null,
  target = obligation
    ? { type: 'OBLIGATION', obligationId: obligation.obligationId }
    : { type: 'WAVE', waveId: plan.waveId },
  eventId = 'authority-override-1',
  receiptId = `authority-receipt-${eventId}`,
  reason = 'approved exception for the named gate',
  risk = 'temporary review bypass is bounded by expiry and remediation',
  approver = 'human:architecture-owner',
  skippedGate = obligation ? obligation.lane : 'review-wave',
  remediation = 'complete the skipped review before the next release',
  issuedAt = NOW,
  expiresAt = '2026-09-06T05:00:00.000Z',
  producer = 'human-authority',
  adapter = 'human-authority-adapter',
  sessionId = 'human-authority-session-367',
  kind = 'authority',
  overrides = {},
} = {}) => ({
  schema: EVIDENCE_RECEIPT_SCHEMA,
  receiptId,
  kind,
  workId: plan.workId,
  waveId: plan.waveId,
  planId: plan.planId,
  decisionId: plan.decisionId,
  ...(obligation ? { obligationId: obligation.obligationId, lane: obligation.lane } : {}),
  producer,
  adapter,
  sessionId,
  sourceCommit: plan.headIdentity.commit,
  sourceTree: plan.headIdentity.tree,
  policyVersion: plan.policyVersion,
  contractVersion: plan.contractVersion,
  recordedAt: NOW,
  payload: {
    eventId,
    target,
    reason,
    risk,
    approver,
    skippedGate,
    remediation,
    issuedAt,
    expiresAt,
    ...overrides,
  },
});

const makeAuthorityEvent = (plan, {
  obligation = null,
  receipt,
  eventId = receipt && receipt.payload ? receipt.payload.eventId : 'authority-override-1',
  producer = 'human-authority',
  adapter = 'human-authority-adapter',
  sessionId = receipt && receipt.sessionId ? receipt.sessionId : 'human-authority-session-367',
  recordedAt = NOW,
  ...overrides
} = {}) => makeEvent(plan, {
  ...overrides,
  eventId,
  eventType: AUTHORITY_OVERRIDE_RECORDED,
  payload: { receipt },
  producer,
  adapter,
  sessionId,
  recordedAt,
});

const makeStore = (root, { trustPolicy = TRUST_POLICY, now = () => NOW_MS } = {}) => new ReceiptStore({
  root,
  trustPolicy,
  integrityKey: INTEGRITY_KEY,
  now,
});

const makeGate = (root, { trustPolicy = TRUST_POLICY, now = () => NOW_MS } = {}) => new ReviewGate({
  receiptStore: makeStore(root, { trustPolicy, now }),
  trustPolicy,
  now,
});

const createReviewGateFixture = ({ trustPolicy = TRUST_POLICY, now = NOW_MS } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-367-'));
  let currentNow = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  const clock = () => currentNow;
  const store = makeStore(root, { trustPolicy, now: clock });
  const gate = new ReviewGate({ receiptStore: store, trustPolicy, now: clock });
  return {
    root,
    gate,
    store,
    now: () => currentNow,
    setNow: (value) => {
      currentNow = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
    },
    makeStore: () => makeStore(root, { trustPolicy, now: clock }),
    makeGate: () => new ReviewGate({ receiptStore: makeStore(root, { trustPolicy, now: clock }), trustPolicy, now: clock }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

const withGate = (callback, options = {}) => {
  const fixture = createReviewGateFixture(options);
  try {
    return callback(fixture);
  } finally {
    fixture.cleanup();
  }
};

const registerPlan = (gate, plan, eventId = 'plan-registered-1', options = {}) => gate.handle({
  expectedRevision: 0,
  expectedChainDigest: null,
  event: makePlanEvent(plan, eventId, options),
});

const requestFor = (state, obligation) => state.reviewRequests.find((request) => (
  request.obligationId === obligation.obligationId
));

const recordPasses = (gate, plan, state, eventPrefix = 'review-result-pass') => {
  let current = state;
  for (const [index, obligation] of plan.obligations.entries()) {
    current = gate.handle({
      expectedRevision: current.revision,
      expectedChainDigest: current.chainDigest,
      event: makeReviewEvent(plan, obligation, requestFor(current, obligation), {
        eventId: `${eventPrefix}-${obligation.lane}-${index}`,
        semanticVerdict: 'PASS',
      }),
    });
  }
  return current;
};

const inspectHead = (store, plan, revision, chainDigest) => store.inspect({
  workId: plan.workId,
  waveId: plan.waveId,
  expectedRevision: revision,
  expectedChainDigest: chainDigest,
});

const isDeepFrozen = (value) => (
  !value
  || typeof value !== 'object'
  || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen))
);

module.exports = {
  AUTHORITY_PRODUCER,
  AUTHORITY_TRUST_POLICY,
  EVIDENCE_RECEIPT_SCHEMA,
  EMPTY_DIFF_DIGEST,
  INTEGRITY_KEY,
  NOW,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  STORE_EVENT_SCHEMA,
  TRUST_POLICY,
  createFinding,
  createReviewGateFixture,
  inspectHead,
  isDeepFrozen,
  makeAuthorityEvent,
  makeAuthorityReceipt,
  makeEvent,
  makeInputsInvalidatedEvent,
  makeGate,
  makePlan,
  makePlanEvent,
  makeReviewEvent,
  makeReviewResult,
  makeStore,
  makeTrustPolicy,
  recordPasses,
  registerPlan,
  requestFor,
  withGate,
};
