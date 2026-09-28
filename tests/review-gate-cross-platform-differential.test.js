'use strict';

// Cross-platform differential conformance for the active Review Gate contract
// (issue #372). The corpus drives the Claude and Codex semantic-review
// adapters, the CI and Git-provider verification adapters, and the
// WorkflowCoordinator delivery projection. Retired compatibility paths are
// intentionally outside this test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { findTests } = require('./run-all');
const {
  createFinding,
  makePlan,
  makeReviewResult,
  registerPlan,
  TRUST_POLICY,
  NOW,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  createReviewGateFixture,
} = require('./_lib/review-gate-fixture');
const { FIXTURE, receiptsForHistory } = require('./_lib/workflow-coordinator-fixture');
const { ClaudeReviewGateAdapter } = require('../scripts/lib/claude-review-gate-adapter');
const { CodexReviewGateAdapter } = require('../scripts/lib/codex-review-gate-adapter');
const { CiReviewGateAdapter } = require('../scripts/lib/ci-review-gate-adapter');
const { GitProviderReviewGateAdapter } = require('../scripts/lib/git-provider-review-gate-adapter');
const { WorkflowCoordinator } = require('../scripts/lib/workflow-coordinator');
const { ReceiptStore } = require('../scripts/lib/review-gate-receipt-store');
const conformance = require('../scripts/lib/review-gate-conformance');

const ROOT = path.join(__dirname, '..');
const CORPUS_PATH = path.join(__dirname, 'fixtures', 'review-gate', 'cross-platform-differential-v1.json');
const SENTINEL_CORPUS_PATH = path.join(__dirname, 'fixtures', 'review-gate', 'sentinel-differential-v1.json');
const CORPUS = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
const SENTINEL_CORPUS = JSON.parse(fs.readFileSync(SENTINEL_CORPUS_PATH, 'utf8'));
const TEST_DISCOVERY_SCRIPT = String.raw`
const Module = require('node:module');
const path = require('node:path');
const tests = [];
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === './_lib/tinytest' && parent
      && parent.filename.startsWith(path.join(process.cwd(), 'tests') + path.sep)) {
    return {
      test: (name, fn) => tests.push({ name, source: Function.prototype.toString.call(fn) }),
      run: () => {},
      assert: require('node:assert'),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
require(path.resolve(process.argv[1]));
process.stdout.write(JSON.stringify(tests));
`;
const EXPECTED_SCENARIO_KINDS = ['FAILURE', 'PROVIDER', 'RECEIPT', 'REPLAY', 'RESULT', 'WORKFLOW'];
const EXPECTED_ADAPTER_KEYS = ['CI', 'CLAUDE', 'CODEX', 'CORE', 'GIT_PROVIDER'];
const EXPECTED_ACTIVE_CASES = {
  'claude-codex-pass-agree': {
    scenarioKind: 'RESULT', adapters: ['CLAUDE', 'CODEX'],
    expected: { semanticVerdict: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED', accepted: true, lifecycleStatus: 'RESOLVED', allowsTargetProgress: true },
  },
  'claude-codex-changes-required-parity': {
    scenarioKind: 'RESULT', adapters: ['CLAUDE', 'CODEX'],
    expected: { semanticVerdict: 'CHANGES_REQUIRED', executionStatus: 'COMPLETE', applicability: 'REQUIRED', accepted: true, lifecycleStatus: 'PENDING', allowsTargetProgress: false },
  },
  'claude-codex-unavailable-review-result': {
    scenarioKind: 'RESULT', adapters: ['CLAUDE', 'CODEX'],
    expected: { executionStatus: 'UNAVAILABLE', applicability: 'REQUIRED', accepted: true, lifecycleStatus: 'PENDING', allowsTargetProgress: false },
  },
  'claude-codex-shared-receipt-decision': {
    scenarioKind: 'RECEIPT', adapters: ['CLAUDE', 'CODEX'],
    expected: { semanticVerdict: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED', accepted: true, lifecycleStatus: 'RESOLVED', allowsTargetProgress: true },
  },
  'codex-adapter-inactive-unavailable': {
    scenarioKind: 'FAILURE', adapters: ['CODEX'],
    expected: { activation: 'INACTIVE', errorCode: 'ADAPTER_INACTIVE' },
  },
  'ci-adapter-inactive-unavailable': {
    scenarioKind: 'FAILURE', adapters: ['CI'],
    expected: { activation: 'INACTIVE', errorCode: 'ADAPTER_INACTIVE' },
  },
  'git-provider-adapter-inactive-unavailable': {
    scenarioKind: 'FAILURE', adapters: ['GIT_PROVIDER'],
    expected: { activation: 'INACTIVE', errorCode: 'ADAPTER_INACTIVE' },
  },
  'ci-provider-delivery-archive-ready': {
    scenarioKind: 'PROVIDER', adapters: ['CI', 'GIT_PROVIDER'],
    expected: { deliveryState: 'ARCHIVE_READY', completionDelivery: 'COMPLETE', tier: 'ARCHIVE' },
  },
  'git-provider-merge-alone-post-merge-pending': {
    scenarioKind: 'PROVIDER', adapters: ['GIT_PROVIDER'],
    expected: { deliveryState: 'POST_MERGE_PENDING', completionDelivery: 'PENDING', reasonCode: 'POST_MERGE_CI_UNOBSERVED', tier: 'DELIVERY' },
  },
  'ci-alone-merge-unobserved-pending': {
    scenarioKind: 'PROVIDER', adapters: ['CI'],
    expected: { deliveryState: 'POST_MERGE_PENDING', completionDelivery: 'PENDING', reasonCode: 'MERGE_UNOBSERVED', tier: 'REMOTE' },
  },
  'ci-provider-ambiguous-post-merge': {
    scenarioKind: 'PROVIDER', adapters: ['CI'],
    expected: { deliveryState: 'POST_MERGE_PENDING', completionDelivery: 'PENDING', reasonCode: 'AMBIGUOUS_POST_MERGE_CI', tier: 'DELIVERY' },
  },
  'provider-missing-transport-blocked': {
    scenarioKind: 'FAILURE', adapters: ['CORE'],
    expected: { completionDelivery: 'PENDING', conditionType: 'BLOCKED', tier: 'LOCAL' },
  },
  'workflow-merge-ready-authorizes-pull-request': {
    scenarioKind: 'WORKFLOW', adapters: ['CORE'],
    expected: { state: 'MERGE_READY', authorizesPullRequest: true, authority: 'REVIEW_GATE', allowsTargetProgress: true },
  },
  'post-merge-ci-corrected-rerun-supersedes-failure': {
    scenarioKind: 'REPLAY', adapters: ['CI'],
    expected: { deliveryState: 'ARCHIVE_READY', completionDelivery: 'COMPLETE' },
  },
  'post-merge-ci-regression-not-masked': {
    scenarioKind: 'REPLAY', adapters: ['CI'],
    expected: { deliveryState: 'POST_MERGE_PENDING', completionDelivery: 'PENDING', reasonCode: 'POST_MERGE_CI_UNOBSERVED' },
  },
};
const EXPECTED_SENTINEL_COVERAGE = {
  'no-op-not-applicable': {
    currentMatch: 'ANALOGUE',
    activeOwners: [{ file: 'tests/review-gate.test.js', test: 'an exact empty plan is NOT_APPLICABLE with EMPTY_DIFF and no review work' }],
  },
  'fresh-pass': {
    currentMatch: 'DIRECT',
    activeOwners: [{ file: 'tests/review-gate.test.js', test: 'trusted same-lane PASS persists a typed receipt and replay derives RESOLVED/REVIEW_PASS' }],
  },
  'missing-artifact': {
    currentMatch: 'ANALOGUE',
    activeOwners: [{ file: 'tests/review-gate-runtime-companion-security.test.js', test: 'observe reports MISSING_ARTIFACT when the requested review artifact is absent' }],
  },
  'stale-artifact': {
    currentMatch: 'DIRECT',
    activeOwners: [
      { file: 'tests/review-gate-runtime-observe-security.test.js', test: 'observe rejects a tampered artifact digest without creating a receipt' },
      { file: 'tests/review-gate-runtime-observe-security.test.js', test: 'observe rejects stale readiness digest before recording a review receipt' },
    ],
  },
  'malformed-native-artifact': {
    currentMatch: 'ANALOGUE',
    activeOwners: [
      { file: 'tests/review-gate-runtime-companion-security.test.js', test: 'observe rejects an invalid structured semantic verdict after authenticating its companion' },
      { file: 'tests/reviewer-contract-v2.test.js', test: 'v2 keeps execution, applicability, and semantic verdict axes distinct' },
    ],
  },
  'misplaced-artifact': {
    currentMatch: 'DIRECT',
    activeOwners: [{ file: 'tests/review-gate-runtime-companion-security.test.js', test: 'observe rejects a valid companion file stored outside its artifact sibling path' }],
  },
  'foreign-identity': {
    currentMatch: 'DIRECT',
    activeOwners: [{ file: 'tests/review-gate-runtime-observe-security.test.js', test: 'observe rejects a sidecar identity mismatch without recording evidence' }],
  },
  'concurrent-session': {
    currentMatch: 'ANALOGUE',
    activeOwners: [
      { file: 'tests/review-gate-evidence-continuity.test.js', test: 'foreign-session receipt evidence cannot clear a pending review before a trusted same-lane PASS' },
      { file: 'tests/review-gate-receipt-store.test.js', test: 'receipts from a foreign session cannot bind to an event' },
    ],
  },
  'resumed-pass': {
    currentMatch: 'ANALOGUE',
    activeOwners: [
      { file: 'tests/review-gate-runtime-consumer-e2e.test.js', test: 'materialized package records a direct review observation in an isolated consumer' },
      { file: 'tests/review-gate-runtime-host-attestation-security.test.js', test: 'observe permits an exact host-attested retry without a second receipt' },
    ],
  },
  'resumed-intermediate': {
    currentMatch: 'ANALOGUE',
    activeOwners: [{ file: 'tests/review-gate-runtime-cli.test.js', test: 'prepare reads a bounded Work Request from stdin and status returns its bounded projection' }],
  },
  'resumed-malformed': {
    currentMatch: 'HISTORICAL_ONLY',
    activeOwners: [],
  },
  'interrupted-reviewer': {
    currentMatch: 'DIRECT',
    activeOwners: [{ file: 'tests/review-gate.test.js', test: 'non-passing or non-complete results remain PENDING with independent axes' }],
  },
  'retry-allowed': {
    currentMatch: 'HISTORICAL_ONLY',
    activeOwners: [],
  },
  'retry-exhausted': {
    currentMatch: 'HISTORICAL_ONLY',
    activeOwners: [],
  },
  'unresolved-fail': {
    currentMatch: 'DIRECT',
    activeOwners: [{ file: 'tests/review-gate-security.test.js', test: 'MUST_FIX findings survive every intermediate result and cannot be laundered from the next request' }],
  },
  'unresolved-resumed-block': {
    currentMatch: 'HISTORICAL_ONLY',
    activeOwners: [],
  },
  'unresolved-clean-follow-up': {
    currentMatch: 'DIRECT',
    activeOwners: [{ file: 'tests/review-gate-security.test.js', test: 'MUST_FIX findings survive every intermediate result and cannot be laundered from the next request' }],
  },
};

function registeredExecutableTests(file) {
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  const result = spawnSync(process.execPath, ['-e', TEST_DISCOVERY_SCRIPT, file], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  return new Map(JSON.parse(result.stdout).map(({ name, source }) => [name, source]));
}

function identity(overrides = {}) {
  return {
    taskId: 'task-372',
    attemptId: 'task-372:attempt:1',
    attempt: 1,
    sessionId: 'session-372',
    dispatchId: 'dispatch-372',
    scopeId: 'scope-372',
    diffId: 'diff-372',
    ...overrides,
  };
}

function lifecycleEvent(state, ids, overrides = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-event-372-${ids.taskId}`,
    event_type: 'review-lifecycle',
    state,
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'reviewer',
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: NOW,
    ...overrides,
  };
}

function readinessFor(ids, artifactDigest) {
  return [{
    schema_version: 1,
    event_id: `ready-event-372-${ids.taskId}`,
    state: 'artifact-ready',
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: NOW,
    artifact_sha256: `sha256:${artifactDigest}`,
  }];
}

function caseById(caseId) {
  const corpusCase = CORPUS.cases.find((entry) => entry.caseId === caseId);
  if (!corpusCase) throw new Error(`Unknown differential case: ${caseId}`);
  return corpusCase;
}

function submitBoth({ ids, semanticVerdict, executionStatus = 'COMPLETE', findings = [] }) {
  const claudeFixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  const codexFixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  try {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registrationOptions = { producer: 'fixture-reviewer', adapter: 'fixture-adapter' };
    const claudeRegistration = registerPlan(
      claudeFixture.gate,
      plan,
      'plan-registered-claude-372',
      registrationOptions,
    );
    const codexRegistration = registerPlan(
      codexFixture.gate,
      plan,
      'plan-registered-codex-372',
      registrationOptions,
    );
    const artifactDigest = 'a'.repeat(64);
    const reviewRequest = claudeRegistration.reviewRequests[0];
    const reviewResult = makeReviewResult(plan, obligation, {
      executionStatus,
      semanticVerdict,
      evidenceReferences: executionStatus === 'COMPLETE'
        ? [`artifact-sha256:${artifactDigest}`]
        : ['capability:reviewer-unavailable'],
      findings,
    });
    const evidence = executionStatus === 'COMPLETE'
      ? {
        lifecycleEvents: [
          lifecycleEvent('planned', ids),
          lifecycleEvent('dispatched', ids),
          lifecycleEvent('started', ids),
          lifecycleEvent('verdicted', ids, { verdict: semanticVerdict }),
        ],
        readinessEvents: readinessFor(ids, artifactDigest),
      }
      : {
        lifecycleEvents: [
          lifecycleEvent('planned', ids),
          lifecycleEvent('dispatched', ids),
          lifecycleEvent('started', ids),
          lifecycleEvent('failed-start', ids),
        ],
        readinessEvents: [],
      };
    const commands = [{
      command: 'node tests/reviewer-contract-v2.test.js',
      outcome: executionStatus === 'COMPLETE' ? 'PASS' : 'UNAVAILABLE',
    }];
    const claude = new ClaudeReviewGateAdapter({
      reviewGate: claudeFixture.gate,
      producer: 'fixture-reviewer',
      adapter: 'fixture-adapter',
      adapterVersion: 'claude-review-gate.v1',
      now: () => NOW_MS,
    }).record({
      plan,
      identity: ids,
      ...evidence,
      reviewRequest,
      reviewResult,
      executedCommands: commands,
      expectedRevision: claudeRegistration.revision,
      expectedChainDigest: claudeRegistration.chainDigest,
    });
    const codex = new CodexReviewGateAdapter({
      reviewGate: codexFixture.gate,
      producer: 'fixture-reviewer',
      adapter: 'fixture-adapter',
      adapterVersion: 'codex-review-gate.v1',
      activation: 'ACTIVE',
      now: () => NOW_MS,
    }).record({
      plan,
      identity: ids,
      ...evidence,
      reviewRequest,
      reviewResult,
      executedCommands: commands,
      expectedRevision: codexRegistration.revision,
      expectedChainDigest: codexRegistration.chainDigest,
    });
    return { claude, codex };
  } finally {
    claudeFixture.cleanup();
    codexFixture.cleanup();
  }
}

function reviewActual(submission) {
  const decision = submission.reviewGate && submission.reviewGate.decision;
  if (!decision) throw new Error('adapter did not return a Review Gate decision');
  return Object.fromEntries(Object.entries({
    semanticVerdict: decision.semanticVerdict,
    executionStatus: decision.executionStatus,
    applicability: decision.applicability,
    accepted: decision.accepted,
    lifecycleStatus: decision.lifecycleStatus,
    allowsTargetProgress: decision.allowsProgress,
  }).filter(([, value]) => value !== undefined));
}

test('claude-codex-pass-agree: both semantic-review adapters produce the same direct PASS shape', () => {
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-pass' }),
    semanticVerdict: 'PASS',
  });
  const expected = caseById('claude-codex-pass-agree').expected;
  assert.deepStrictEqual(reviewActual(claude), expected);
  assert.deepStrictEqual(reviewActual(codex), expected);
  assert.strictEqual(claude.receipt.reviewGateStatus, 'PASS');
  assert.strictEqual(codex.receipt.reviewGateStatus, 'PASS');
  for (const receipt of [claude.receipt, codex.receipt]) {
    assert.strictEqual(
      Object.keys(receipt).some((key) => /^(?:authority|blocks?|clears?|comparison|migration|phase)/i.test(key)),
      false,
    );
  }
});

test('claude-codex-changes-required-parity: remediation remains pending on both adapters', () => {
  const finding = createFinding({
    id: 'issue-372-finding',
    severity: 'MEDIUM',
    disposition: 'MUST_FIX',
    summary: 'cross-platform differential proof finding',
    evidence: ['artifact:issue-372'],
  });
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-changes' }),
    semanticVerdict: 'CHANGES_REQUIRED',
    findings: [finding],
  });
  const expected = caseById('claude-codex-changes-required-parity').expected;
  assert.deepStrictEqual(reviewActual(claude), expected);
  assert.deepStrictEqual(reviewActual(codex), expected);
});

test('claude-codex-unavailable-review-result: neither adapter manufactures a semantic verdict', () => {
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-unavailable' }),
    executionStatus: 'UNAVAILABLE',
  });
  const expected = caseById('claude-codex-unavailable-review-result').expected;
  assert.deepStrictEqual(reviewActual(claude), expected);
  assert.deepStrictEqual(reviewActual(codex), expected);
});

test('claude-codex-shared-receipt-decision: both adapters reach the same Review Gate axes', () => {
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-receipt' }),
    semanticVerdict: 'PASS',
  });
  const expected = caseById('claude-codex-shared-receipt-decision').expected;
  assert.deepStrictEqual(
    {
      ...reviewActual(claude),
      accepted: claude.reviewGate.decision.accepted,
    },
    {
      ...expected,
      lifecycleStatus: 'RESOLVED',
      allowsTargetProgress: true,
    },
  );
  assert.deepStrictEqual(reviewActual(claude), reviewActual(codex));
});

test('codex-adapter-inactive-unavailable: inactive Codex cannot submit a semantic review', () => {
  const adapter = new CodexReviewGateAdapter({
    reviewGate: { handle: () => { throw new Error('must not be called'); } },
  });
  let error = null;
  try {
    adapter.record({});
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.strictEqual(error.code, 'ADAPTER_INACTIVE');
  assert.strictEqual(adapter.capabilities().authority, 'REVIEW_GATE');
  assert.strictEqual(adapter.capabilities().effect, 'DISABLED');
});

function deliveryStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-differential-delivery-'));
  const store = new ReceiptStore({
    root,
    integrityKey: 'differential-372-delivery-integrity-key-32b',
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
  return { root, store };
}

const DELIVERY_IDENTITY = Object.freeze({
  workId: 'work-372',
  waveId: 'wave-372',
  planId: 'plan-372',
  decisionId: 'decision-372',
  sessionId: 'session-372',
});
const MERGE_IDENTITY = Object.freeze({ commit: '7'.repeat(40), tree: '8'.repeat(40) });
const POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';
const DELIVERY_NOW = () => '2026-09-07T00:00:00.000Z';

function mergeObservedReceipt(overrides = {}) {
  const fixture = deliveryStore();
  try {
    return new GitProviderReviewGateAdapter({
      store: fixture.store,
      activation: 'ACTIVE',
      now: DELIVERY_NOW,
    }).record({
      identity: DELIVERY_IDENTITY,
      mergeIdentity: MERGE_IDENTITY,
      policyVersion: POLICY_VERSION,
      contractVersion: CONTRACT_VERSION,
      verificationId: 'verification-provider-merge-372',
      outcome: 'COMPLETE',
      ...overrides,
    }).receipt;
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function postMergeCiReceipt(overrides = {}) {
  const fixture = deliveryStore();
  try {
    return new CiReviewGateAdapter({
      store: fixture.store,
      activation: 'ACTIVE',
      now: DELIVERY_NOW,
    }).record({
      identity: DELIVERY_IDENTITY,
      headIdentity: MERGE_IDENTITY,
      policyVersion: POLICY_VERSION,
      contractVersion: CONTRACT_VERSION,
      verificationId: 'verification-post-merge-ci-372',
      lane: 'post-merge',
      outcome: 'PASS',
      ...overrides,
    }).receipt;
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function providerTrustPolicy() {
  return {
    producers: [
      { producer: 'git-provider-review-gate', adapter: 'review-gate-adapter', receiptKinds: ['verification'] },
      { producer: 'ci-review-gate', adapter: 'review-gate-adapter', receiptKinds: ['verification'] },
    ],
  };
}

function deliveryCoordinator() {
  return new WorkflowCoordinator({
    trustPolicy: providerTrustPolicy(),
    featureControl: FIXTURE.featureControl,
    evaluatedAt: FIXTURE.evaluatedAt,
  });
}

function deliveryActual(projection, extra = {}) {
  return {
    deliveryState: projection.state,
    completionDelivery: projection.completion.delivery,
    ...extra,
  };
}

test('ci-provider-delivery-archive-ready: merge and post-merge CI evidence reaches ARCHIVE_READY', () => {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), postMergeCiReceipt()]);
  const expected = caseById('ci-provider-delivery-archive-ready').expected;
  assert.deepStrictEqual(deliveryActual(projection, { tier: 'ARCHIVE' }), expected);
});

test('git-provider-merge-alone-post-merge-pending: merge evidence requires post-merge CI', () => {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt()]);
  const expected = caseById('git-provider-merge-alone-post-merge-pending').expected;
  assert.deepStrictEqual(deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
    tier: 'DELIVERY',
  }), expected);
});

test('ci-alone-merge-unobserved-pending: post-merge CI evidence requires a merge observation', () => {
  const projection = deliveryCoordinator().reduceDelivery([postMergeCiReceipt()]);
  const expected = caseById('ci-alone-merge-unobserved-pending').expected;
  assert.deepStrictEqual(deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
    tier: 'REMOTE',
  }), expected);
});

test('ci-provider-ambiguous-post-merge: disagreeing post-merge checks fail closed', () => {
  const lint = postMergeCiReceipt({ verificationId: 'verification-post-merge-lint-372', outcome: 'PASS' });
  const unitTests = postMergeCiReceipt({ verificationId: 'verification-post-merge-unit-372', outcome: 'FAIL' });
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), lint, unitTests]);
  const expected = caseById('ci-provider-ambiguous-post-merge').expected;
  assert.deepStrictEqual(deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
    tier: 'DELIVERY',
  }), expected);
});

test('post-merge-ci-corrected-rerun-supersedes-failure: a later pass restores archive readiness', () => {
  const failed = postMergeCiReceipt({ outcome: 'FAIL' });
  const corrected = {
    ...failed,
    receiptId: `${failed.receiptId}-rerun`,
    recordedAt: '2026-09-07T00:05:00.000Z',
    payload: { ...failed.payload, outcome: 'PASS' },
  };
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), failed, corrected]);
  const expected = caseById('post-merge-ci-corrected-rerun-supersedes-failure').expected;
  assert.deepStrictEqual(deliveryActual(projection), expected);
});

test('post-merge-ci-regression-not-masked: a later failing check reopens delivery', () => {
  const passed = postMergeCiReceipt();
  const regressed = {
    ...passed,
    receiptId: `${passed.receiptId}-rerun`,
    recordedAt: '2026-09-07T00:05:00.000Z',
    payload: { ...passed.payload, outcome: 'FAIL' },
  };
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), passed, regressed]);
  const expected = caseById('post-merge-ci-regression-not-masked').expected;
  assert.deepStrictEqual(deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
  }), expected);
});

test('provider-missing-transport-blocked: no delivery evidence remains blocked', () => {
  const projection = deliveryCoordinator().reduceDelivery([]);
  const expected = caseById('provider-missing-transport-blocked').expected;
  assert.deepStrictEqual({
    completionDelivery: projection.completion.delivery,
    conditionType: projection.condition.type,
    tier: 'LOCAL',
  }, expected);
});

test('workflow-merge-ready-authorizes-pull-request: direct Review Gate authority authorizes delivery', () => {
  const receipts = receiptsForHistory('merge-ready').map((item) => (
    item.receiptId !== 'receipt-decision-resolved'
      ? item
      : { ...item, payload: { ...item.payload, deliveryAuthorized: true } }
  ));
  const projection = new WorkflowCoordinator({
    trustPolicy: FIXTURE.trustPolicy,
    featureControl: FIXTURE.featureControl,
    evaluatedAt: FIXTURE.evaluatedAt,
  }).reduce(receipts);
  const expected = caseById('workflow-merge-ready-authorizes-pull-request').expected;
  assert.deepStrictEqual({
    state: projection.state,
    authorizesPullRequest: projection.authorizesPullRequest,
    authority: projection.control.authority,
    allowsTargetProgress: projection.control.allowsTargetProgress,
  }, expected);
});

function corpusObservation(caseId, adapter, actual, flags = {}) {
  return { caseId, adapter, actual, ...flags };
}

function runReviewCase(caseId, options) {
  const { claude, codex } = submitBoth(options);
  return [
    corpusObservation(caseId, 'CLAUDE', reviewActual(claude), options.executionStatus === 'UNAVAILABLE' ? { unavailable: true } : {}),
    corpusObservation(caseId, 'CODEX', reviewActual(codex), options.executionStatus === 'UNAVAILABLE' ? { unavailable: true } : {}),
  ];
}

function runCodexInactiveCase() {
  const adapter = new CodexReviewGateAdapter({ reviewGate: { handle: () => { throw new Error('must not be called'); } } });
  try {
    adapter.record({});
  } catch (error) {
    return [corpusObservation('codex-adapter-inactive-unavailable', 'CODEX', {
      activation: adapter.capabilities().activation,
      errorCode: error.code,
    }, { unavailable: true })];
  }
  throw new Error('inactive Codex adapter unexpectedly recorded');
}

function runCiInactiveCase() {
  const fixture = deliveryStore();
  try {
    const adapter = new CiReviewGateAdapter({ store: fixture.store, activation: 'INACTIVE' });
    try {
      adapter.record({});
    } catch (error) {
      return [corpusObservation('ci-adapter-inactive-unavailable', 'CI', {
        activation: adapter.capabilities().activation,
        errorCode: error.code,
      }, { unavailable: true })];
    }
    throw new Error('inactive CI adapter unexpectedly recorded');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function runGitProviderInactiveCase() {
  const fixture = deliveryStore();
  try {
    const adapter = new GitProviderReviewGateAdapter({ store: fixture.store, activation: 'INACTIVE' });
    try {
      adapter.record({});
    } catch (error) {
      return [corpusObservation('git-provider-adapter-inactive-unavailable', 'GIT_PROVIDER', {
        activation: adapter.capabilities().activation,
        errorCode: error.code,
      }, { unavailable: true })];
    }
    throw new Error('inactive Git-provider adapter unexpectedly recorded');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function runArchiveReadyCase() {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), postMergeCiReceipt()]);
  return [
    corpusObservation('ci-provider-delivery-archive-ready', 'CI', deliveryActual(projection, { tier: 'ARCHIVE' })),
    corpusObservation('ci-provider-delivery-archive-ready', 'GIT_PROVIDER', deliveryActual(projection, { tier: 'ARCHIVE' })),
  ];
}

function runMergeAloneCase() {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt()]);
  return [corpusObservation('git-provider-merge-alone-post-merge-pending', 'GIT_PROVIDER', deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
    tier: 'DELIVERY',
  }), { blocked: true })];
}

function runCiAloneCase() {
  const projection = deliveryCoordinator().reduceDelivery([postMergeCiReceipt()]);
  return [corpusObservation('ci-alone-merge-unobserved-pending', 'CI', deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
    tier: 'REMOTE',
  }), { blocked: true })];
}

function runAmbiguousCase() {
  const lint = postMergeCiReceipt({ verificationId: 'verification-post-merge-lint-corpus-372', outcome: 'PASS' });
  const unitTests = postMergeCiReceipt({ verificationId: 'verification-post-merge-unit-corpus-372', outcome: 'FAIL' });
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), lint, unitTests]);
  return [corpusObservation('ci-provider-ambiguous-post-merge', 'CI', deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
    tier: 'DELIVERY',
  }), { blocked: true })];
}

function runMissingTransportCase() {
  const projection = deliveryCoordinator().reduceDelivery([]);
  return [corpusObservation('provider-missing-transport-blocked', 'CORE', {
    completionDelivery: projection.completion.delivery,
    conditionType: projection.condition.type,
    tier: 'LOCAL',
  }, { blocked: true })];
}

function runWorkflowCase() {
  const receipts = receiptsForHistory('merge-ready').map((item) => (
    item.receiptId !== 'receipt-decision-resolved'
      ? item
      : { ...item, payload: { ...item.payload, deliveryAuthorized: true } }
  ));
  const projection = new WorkflowCoordinator({
    trustPolicy: FIXTURE.trustPolicy,
    featureControl: FIXTURE.featureControl,
    evaluatedAt: FIXTURE.evaluatedAt,
  }).reduce(receipts);
  return [corpusObservation('workflow-merge-ready-authorizes-pull-request', 'CORE', {
    state: projection.state,
    authorizesPullRequest: projection.authorizesPullRequest,
    authority: projection.control.authority,
    allowsTargetProgress: projection.control.allowsTargetProgress,
  })];
}

function runCorrectedRerunCase() {
  const failed = postMergeCiReceipt({ outcome: 'FAIL' });
  const corrected = {
    ...failed,
    receiptId: `${failed.receiptId}-corpus-rerun`,
    recordedAt: '2026-09-07T00:05:00.000Z',
    payload: { ...failed.payload, outcome: 'PASS' },
  };
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), failed, corrected]);
  return [corpusObservation('post-merge-ci-corrected-rerun-supersedes-failure', 'CI', deliveryActual(projection))];
}

function runRegressionCase() {
  const passed = postMergeCiReceipt();
  const regressed = {
    ...passed,
    receiptId: `${passed.receiptId}-corpus-rerun`,
    recordedAt: '2026-09-07T00:05:00.000Z',
    payload: { ...passed.payload, outcome: 'FAIL' },
  };
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), passed, regressed]);
  return [corpusObservation('post-merge-ci-regression-not-masked', 'CI', deliveryActual(projection, {
    reasonCode: projection.condition.reasonCodes[0],
  }), { blocked: true })];
}

const CORPUS_CASE_RUNNERS = Object.freeze({
  'claude-codex-pass-agree': () => runReviewCase('claude-codex-pass-agree', {
    ids: identity({ taskId: 'task-372-corpus-pass' }),
    semanticVerdict: 'PASS',
  }),
  'claude-codex-changes-required-parity': () => runReviewCase('claude-codex-changes-required-parity', {
    ids: identity({ taskId: 'task-372-corpus-changes' }),
    semanticVerdict: 'CHANGES_REQUIRED',
    findings: [createFinding({
      id: 'issue-372-corpus-finding',
      severity: 'MEDIUM',
      disposition: 'MUST_FIX',
      summary: 'cross-platform corpus finding',
      evidence: ['artifact:issue-372-corpus'],
    })],
  }),
  'claude-codex-unavailable-review-result': () => runReviewCase('claude-codex-unavailable-review-result', {
    ids: identity({ taskId: 'task-372-corpus-unavailable' }),
    executionStatus: 'UNAVAILABLE',
  }),
  'claude-codex-shared-receipt-decision': () => runReviewCase('claude-codex-shared-receipt-decision', {
    ids: identity({ taskId: 'task-372-corpus-receipt' }),
    semanticVerdict: 'PASS',
  }),
  'codex-adapter-inactive-unavailable': runCodexInactiveCase,
  'ci-adapter-inactive-unavailable': runCiInactiveCase,
  'git-provider-adapter-inactive-unavailable': runGitProviderInactiveCase,
  'ci-provider-delivery-archive-ready': runArchiveReadyCase,
  'git-provider-merge-alone-post-merge-pending': runMergeAloneCase,
  'ci-alone-merge-unobserved-pending': runCiAloneCase,
  'ci-provider-ambiguous-post-merge': runAmbiguousCase,
  'provider-missing-transport-blocked': runMissingTransportCase,
  'workflow-merge-ready-authorizes-pull-request': runWorkflowCase,
  'post-merge-ci-corrected-rerun-supersedes-failure': runCorrectedRerunCase,
  'post-merge-ci-regression-not-masked': runRegressionCase,
});

test('one active corpus drives every applicable adapter into one direct parity report', () => {
  const corpusCaseIds = CORPUS.cases.map((entry) => entry.caseId).sort();
  assert.deepStrictEqual(Object.keys(CORPUS_CASE_RUNNERS).sort(), corpusCaseIds);
  const observations = [];
  for (const corpusCase of CORPUS.cases) {
    const runner = CORPUS_CASE_RUNNERS[corpusCase.caseId];
    assert.strictEqual(typeof runner, 'function');
    const rows = runner();
    assert.ok(Array.isArray(rows) && rows.length > 0, `${corpusCase.caseId} must execute a real scenario`);
    assert.deepStrictEqual(
      rows.map((row) => row.adapter).sort(),
      [...corpusCase.adapters].sort(),
      `${corpusCase.caseId} must execute every applicable adapter exactly once`,
    );
    observations.push(...rows);
  }

  const report = conformance.buildConformanceReport({
    corpus: CORPUS,
    observations,
    generatedAt: NOW,
  });
  assert.deepStrictEqual(report.mismatches, [], `active corpus parity mismatches: ${JSON.stringify(report.mismatches)}`);
  assert.strictEqual(report.cases.length, CORPUS.cases.length);
  assert.strictEqual(report.promotionEligible, false);
});

test('corpus binds independent scenario, adapter, active-case, and historical Sentinel contracts', () => {
  assert.strictEqual(CORPUS.schema, 'dhpk.cross-platform-differential-corpus.v1');
  assert.deepStrictEqual([...CORPUS.scenarioKinds].sort(), EXPECTED_SCENARIO_KINDS);
  assert.deepStrictEqual([...CORPUS.adapterKeys].sort(), EXPECTED_ADAPTER_KEYS);
  assert.deepStrictEqual(
    Object.fromEntries(CORPUS.cases.map(({ caseId, scenarioKind, adapters, expected }) => (
      [caseId, { scenarioKind, adapters: [...adapters].sort(), expected }]
    ))),
    Object.fromEntries(Object.entries(EXPECTED_ACTIVE_CASES).map(([caseId, value]) => (
      [caseId, { ...value, adapters: [...value.adapters].sort() }]
    ))),
  );
  assert.deepStrictEqual(
    [...new Set(CORPUS.cases.map(({ scenarioKind }) => scenarioKind))].sort(),
    EXPECTED_SCENARIO_KINDS,
  );
  assert.deepStrictEqual(
    [...new Set(CORPUS.cases.flatMap(({ adapters }) => adapters))].sort(),
    EXPECTED_ADAPTER_KEYS,
  );
  assert.doesNotMatch(JSON.stringify(CORPUS.cases), /\.claude|\/home\/|\\Users\\/);
  for (const entry of CORPUS.cases) {
    for (const adapterKey of entry.adapters) {
      assert.ok(EXPECTED_ADAPTER_KEYS.includes(adapterKey), `${entry.caseId} names an unknown adapter`);
    }
  }

  const historicalIds = SENTINEL_CORPUS.cases.map(({ input }) => input.caseId).sort();
  assert.deepStrictEqual(Object.keys(CORPUS.sentinelCoverage).sort(), historicalIds);
  const historicalOnlyIds = [
    'resumed-malformed',
    'retry-allowed',
    'retry-exhausted',
    'unresolved-resumed-block',
  ];
  assert.deepStrictEqual(
    Object.entries(CORPUS.sentinelCoverage)
      .filter(([, row]) => row.currentMatch === 'HISTORICAL_ONLY')
      .map(([caseId]) => caseId)
      .sort(),
    historicalOnlyIds,
  );
  const discoveredTests = new Set(findTests(path.join(ROOT, 'tests')).map((file) => (
    path.relative(ROOT, file).split(path.sep).join('/')
  )));
  const executableTestsByFile = new Map();
  for (const sentinelCase of SENTINEL_CORPUS.cases) {
    const { input } = sentinelCase;
    const coverage = CORPUS.sentinelCoverage[input.caseId];
    const expectedCoverage = EXPECTED_SENTINEL_COVERAGE[input.caseId];
    assert.ok(expectedCoverage, `${input.caseId} must have an independent match expectation`);
    assert.deepStrictEqual({
      currentMatch: coverage.currentMatch,
      activeOwners: coverage.activeOwners,
    }, expectedCoverage);
    const expectedKeys = [
      'caseId', 'completion', 'evidenceCondition', 'lifecycleClearance',
      'reasonCodes', 'schema', 'semanticApproval', 'sentinelAuthority', 'unresolvedVerdict',
    ];
    assert.deepStrictEqual(Object.keys(coverage.normalizedExpected).sort(), expectedKeys);
    assert.deepStrictEqual(coverage.normalizedExpected, {
      schema: 'dhpk.sentinel-outcome.v1',
      caseId: input.caseId,
      evidenceCondition: input.evidenceCondition,
      lifecycleClearance: input.lifecycleClearance,
      semanticApproval: input.semanticApproval,
      completion: input.completion,
      sentinelAuthority: true,
      unresolvedVerdict: input.unresolvedVerdict,
      reasonCodes: input.reasonCodes,
    });
    assert.strictEqual(
      coverage.currentMatch === 'HISTORICAL_ONLY',
      historicalOnlyIds.includes(input.caseId),
      `${input.caseId} must keep the reasoned active-match classification`,
    );
    if (coverage.currentMatch === 'HISTORICAL_ONLY') {
      assert.deepStrictEqual(coverage.activeOwners, []);
      assert.ok(coverage.gap, `${input.caseId} must explain its historical-only status`);
      continue;
    }
    assert.ok(coverage.activeOwners.length > 0, `${input.caseId} needs a current test owner`);
    for (const owner of coverage.activeOwners) {
      assert.ok(discoveredTests.has(owner.file), `${owner.file} must remain in the test runner`);
      if (!executableTestsByFile.has(owner.file)) {
        executableTestsByFile.set(owner.file, registeredExecutableTests(owner.file));
      }
      const assertionSource = executableTestsByFile.get(owner.file).get(owner.test);
      assert.ok(assertionSource, `${owner.file} must register the named test: ${owner.test}`);
      assert.match(
        assertionSource,
        /\bassert\.[A-Za-z]+\s*\(|\bassert[A-Z][A-Za-z0-9_]*\s*\(/,
        `${owner.file} test must execute an assertion: ${owner.test}`,
      );
    }
  }

  const expectedProtections = [
    ['secret', 'tests/pre-edit-guard.test.js', 'Write/Edit to .env is blocked'],
    ['path', 'tests/pre-edit-guard.test.js', '.git/ internals are blocked'],
    ['shell', 'tests/pre-bash-guard.test.js', 'rm -rf /home is blocked (whole-home deletion)'],
    ['session-health', 'tests/session-start.test.js', 'configured modules are validated and reported without lifecycle diagnostics'],
  ];
  assert.deepStrictEqual(
    SENTINEL_CORPUS.deterministicProtections.map(({ kind, file, test: title }) => [kind, file, title]),
    expectedProtections,
  );
  for (const [, file, title] of expectedProtections) {
    assert.ok(discoveredTests.has(file), `${file} must remain in the test runner`);
    if (!executableTestsByFile.has(file)) {
      executableTestsByFile.set(file, registeredExecutableTests(file));
    }
    const assertionSource = executableTestsByFile.get(file).get(title);
    assert.ok(assertionSource, `${file} must register the protection test: ${title}`);
    assert.match(
      assertionSource,
      /\bassert\.[A-Za-z]+\s*\(|\bassert[A-Z][A-Za-z0-9_]*\s*\(/,
      `${title} must execute an assertion`,
    );
  }
});

run('review-gate-cross-platform-differential');
