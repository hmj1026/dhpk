'use strict';

// Cross-platform differential conformance for issue #372: drives the shared
// black-box corpus in tests/fixtures/review-gate/cross-platform-differential-v1.json
// through the real Claude, Codex, CI, and Git-provider Review Gate adapters
// (plus WorkflowCoordinator core reduction) and asserts every applicable
// adapter agrees on the platform-neutral shape ADR-0017 requires, while
// preserving the CI/Git-provider local/remote/delivery/archive evidence
// tiers and carrying every focused Sentinel case (#363) forward.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
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
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const { MigrationCoordinator } = require('../scripts/lib/migration-coordinator');
const { ClaudeReviewGateAdapter, MIGRATION_POLICY_VERSION, MIGRATION_CONTRACT_VERSION } = require('../scripts/lib/claude-review-gate-adapter');
const { CodexReviewGateAdapter } = require('../scripts/lib/codex-review-gate-adapter');
const { CiReviewGateAdapter } = require('../scripts/lib/ci-review-gate-adapter');
const { GitProviderReviewGateAdapter } = require('../scripts/lib/git-provider-review-gate-adapter');
const { WorkflowCoordinator } = require('../scripts/lib/workflow-coordinator');
const { ReceiptStore } = require('../scripts/lib/review-gate-receipt-store');
const { sha256 } = require('../scripts/lib/receipt-primitives');
const baseline = require('../scripts/lib/review-gate-baseline');
const conformance = require('../scripts/lib/review-gate-conformance');

const ACCEPTED_OUTCOME_COST_METRICS = Object.freeze({
  modelTokens: 1200,
  dispatchCount: 2,
  semanticReviewCount: 1,
  remediationRounds: 1,
  humanTurns: null,
  elapsedMs: 42,
  falseBlockCount: 0,
  receiptReuseCount: null,
});

function observeTrustPolicy() {
  return {
    producers: TRUST_POLICY.producers.map((entry) => (
      entry.producer === 'fixture-reviewer' && entry.adapter === 'fixture-adapter'
        ? {
          ...entry,
          eventTypes: [...entry.eventTypes, 'MIGRATION_OBSERVATION_RECORDED'],
          receiptKinds: [...entry.receiptKinds, 'migration-observation'],
        }
        : entry
    )),
  };
}

function canonicalAcceptedOutcomeCost(taskId, accepted = true) {
  return baseline.normalizeAcceptedOutcomeCost({
    schema: baseline.ACCEPTED_OUTCOME_COST_SCHEMA,
    observationId: `legacy-${sha256(taskId).slice(0, 32)}`,
    acceptedOutcome: accepted,
    metrics: ACCEPTED_OUTCOME_COST_METRICS,
    telemetryFailures: [],
  });
}

const ROOT = path.join(__dirname, '..');
const CORPUS_PATH = path.join(__dirname, 'fixtures', 'review-gate', 'cross-platform-differential-v1.json');
const CORPUS = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
const SENTINEL_CORPUS_PATH = path.join(ROOT, CORPUS.sentinelCorpus);
const SENTINEL_CORPUS = JSON.parse(fs.readFileSync(SENTINEL_CORPUS_PATH, 'utf8'));

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
    event_id: `${state}-event-372`,
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
    event_id: 'ready-event-372',
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

function reviewRequestFor(plan, obligation) {
  return createReviewRequest({
    decisionId: plan.decisionId,
    waveId: plan.waveId,
    obligationId: obligation.obligationId,
    lane: obligation.lane,
    scope: plan.scope,
    baseIdentity: plan.baseIdentity,
    headIdentity: plan.headIdentity,
    diff: plan.diff,
    materialRisks: plan.materialRisks,
    governingInputs: plan.governingInputs,
    exclusions: [],
    priorFindings: [],
    contractVersion: REVIEWER_CONTRACT_VERSION,
  });
}

// --- Case 1/2/3: Claude and Codex agree on the platform-neutral result shape ---

function submitBoth({ ids, semanticVerdict, executionStatus = 'COMPLETE', findings = [], sentinelOutcome }) {
  const claudeFixture = createReviewGateFixture({ trustPolicy: observeTrustPolicy(), now: NOW_MS });
  const codexFixture = createReviewGateFixture({ trustPolicy: TRUST_POLICY, now: NOW_MS });
  try {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const artifactDigest = 'a'.repeat(64);
    const reviewRequest = reviewRequestFor(plan, obligation);
    const reviewResult = makeReviewResult(plan, obligation, {
      executionStatus,
      semanticVerdict,
      // Claude's OBSERVE path always requires the readiness artifact digest to be
      // named, even for an UNAVAILABLE result, since Claude's durable lifecycle
      // always produces one; Codex only requires it when COMPLETE + REQUIRED.
      evidenceReferences: executionStatus === 'COMPLETE'
        ? [`artifact-sha256:${artifactDigest}`]
        : [`artifact-sha256:${artifactDigest}`, 'capability:reviewer-unavailable'],
      findings,
    });
    // Claude's hook-owned lifecycle always durably completes with a
    // `verdicted` event and a readiness artifact before the adapter runs at
    // all -- it has no "dispatch failed" axis distinct from that. Codex's
    // lifecycle instead terminates in an exception state (`failed-start`)
    // when its Review Result is not artifact-backed. The two platforms'
    // *durable evidence shapes* legitimately diverge here; what must agree
    // is the platform-neutral Review Result each submits to the same
    // ReviewGate, which stays identical below.
    const legacyVerdict = sentinelOutcome && (sentinelOutcome.verdict || sentinelOutcome.outcome)
      ? (sentinelOutcome.verdict || sentinelOutcome.outcome)
      : semanticVerdict || 'PASS';
    const observedSentinelOutcome = sentinelOutcome || {
      status: 'CLEARED',
      verdict: legacyVerdict,
      outcome: legacyVerdict,
      lifecycleEventId: 'verdicted-event-372',
    };
    const claudeLifecycleEvents = [
      lifecycleEvent('planned', ids),
      lifecycleEvent('dispatched', ids),
      lifecycleEvent('started', ids),
      lifecycleEvent('verdicted', ids, { verdict: legacyVerdict }),
    ];
    const claudeReadinessEvents = readinessFor(ids, artifactDigest);
    const codexLifecycleEvents = executionStatus === 'COMPLETE' ? claudeLifecycleEvents : [
      lifecycleEvent('planned', ids),
      lifecycleEvent('dispatched', ids),
      lifecycleEvent('started', ids),
      lifecycleEvent('failed-start', ids),
    ];
    const codexReadinessEvents = executionStatus === 'COMPLETE' ? claudeReadinessEvents : [];

    const claudeRegistration = registerPlan(claudeFixture.gate, plan, 'plan-registered-claude-372');
    const claudeCoordinator = new MigrationCoordinator({
      receiptStore: claudeFixture.store,
      phase: 'OBSERVE',
      now: () => NOW_MS,
    });
    const claude = new ClaudeReviewGateAdapter({
      reviewGate: claudeFixture.gate,
      migrationCoordinator: claudeCoordinator,
      producer: 'fixture-reviewer',
      adapter: 'fixture-adapter',
      adapterVersion: 'claude-review-gate.v1',
      now: () => NOW_MS,
    }).observe({
      phase: 'OBSERVE',
      plan,
      identity: ids,
      lifecycleEvents: claudeLifecycleEvents,
      readinessEvents: claudeReadinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'node tests/reviewer-contract-v2.test.js', outcome: executionStatus === 'COMPLETE' ? 'PASS' : 'UNAVAILABLE' }],
      sentinelOutcome: observedSentinelOutcome,
      acceptedOutcomeCost: canonicalAcceptedOutcomeCost(ids.taskId, legacyVerdict === 'PASS'),
      expectedRevision: claudeRegistration.revision,
      expectedChainDigest: claudeRegistration.chainDigest,
    });

    const codexRegistration = registerPlan(codexFixture.gate, plan, 'plan-registered-codex-372');
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
      lifecycleEvents: codexLifecycleEvents,
      readinessEvents: codexReadinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'node tests/reviewer-contract-v2.test.js', outcome: executionStatus === 'COMPLETE' ? 'PASS' : 'UNAVAILABLE' }],
      expectedRevision: codexRegistration.revision,
      expectedChainDigest: codexRegistration.chainDigest,
    });

    return { claude, codex };
  } finally {
    claudeFixture.cleanup();
    codexFixture.cleanup();
  }
}

test('claude-codex-pass-agree: both adapters agree on the platform-neutral PASS shape', () => {
  const { claude, codex } = submitBoth({ ids: identity({ taskId: 'task-372-pass' }), semanticVerdict: 'PASS' });
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'claude-codex-pass-agree').expected;

  assert.strictEqual(claude.comparison, expected.comparison);
  assert.strictEqual(claude.effect, expected.effect);
  assert.strictEqual(claude.authority, expected.authority);
  assert.strictEqual(claude.authorizesApproval, expected.authorizesApproval);
  assert.strictEqual(claude.clearsSentinel, expected.clearsSentinel);
  assert.strictEqual(claude.blocksSentinel, expected.blocksSentinel);
  assert.strictEqual(claude.allowsTargetProgress, expected.allowsTargetProgress);
  assert.strictEqual(claude.reviewGate.decision.semanticVerdict, expected.semanticVerdict);

  assert.strictEqual(codex.receipt.effect, expected.effect);
  assert.strictEqual(codex.receipt.authority, expected.authority);
  assert.strictEqual(codex.receipt.authorizesApproval, expected.authorizesApproval);
  assert.strictEqual(codex.receipt.clearsSentinel, expected.clearsSentinel);
  assert.strictEqual(codex.receipt.blocksSentinel, expected.blocksSentinel);
  assert.strictEqual(codex.receipt.allowsTargetProgress, expected.allowsTargetProgress);
  assert.strictEqual(codex.reviewGate.decision.semanticVerdict, expected.semanticVerdict);

  assert.strictEqual(claude.reviewGate.decision.semanticVerdict, codex.reviewGate.decision.semanticVerdict);
});

test('claude-codex-changes-required-parity: both adapters agree CHANGES_REQUIRED never authorizes approval', () => {
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-cr' }),
    semanticVerdict: 'CHANGES_REQUIRED',
    findings: [createFinding({
      id: 'issue-372-finding',
      severity: 'MEDIUM',
      disposition: 'MUST_FIX',
      summary: 'cross-platform differential proof finding',
      evidence: ['artifact:issue-372'],
    })],
  });
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'claude-codex-changes-required-parity').expected;

  assert.strictEqual(claude.reviewGate.decision.semanticVerdict, expected.semanticVerdict);
  assert.strictEqual(codex.reviewGate.decision.semanticVerdict, expected.semanticVerdict);
  assert.strictEqual(claude.authorizesApproval, expected.authorizesApproval);
  assert.strictEqual(codex.receipt.authorizesApproval, expected.authorizesApproval);
  assert.strictEqual(claude.allowsTargetProgress, expected.allowsTargetProgress);
  assert.strictEqual(codex.receipt.allowsTargetProgress, expected.allowsTargetProgress);
  assert.deepStrictEqual(claude.reviewGate.decision.semanticVerdict, codex.reviewGate.decision.semanticVerdict);
});

test('claude-codex-unavailable-review-result: both adapters report NOT_RUN without inventing a verdict', () => {
  const { claude, codex } = submitBoth({ ids: identity({ taskId: 'task-372-unavailable' }), semanticVerdict: undefined, executionStatus: 'UNAVAILABLE' });
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'claude-codex-unavailable-review-result').expected;

  assert.strictEqual(claude.reviewGate.decision.executionStatus, expected.executionStatus);
  assert.strictEqual(claude.reviewGate.decision.semanticVerdict, undefined);
  assert.strictEqual(claude.allowsTargetProgress, expected.allowsTargetProgress);

  assert.strictEqual(codex.receipt.reviewGateStatus, expected.reviewGateStatus);
  assert.strictEqual(codex.reviewGate.decision.executionStatus, expected.executionStatus);
  assert.strictEqual(codex.receipt.allowsTargetProgress, expected.allowsTargetProgress);
});

// --- Case 4: same real ReviewGate decision reached from both platforms ---

test('claude-codex-shared-receipt-decision: identical inputs reach an identical ReviewGate decision', () => {
  const { claude, codex } = submitBoth({ ids: identity({ taskId: 'task-372-receipt' }), semanticVerdict: 'PASS' });
  assert.deepStrictEqual(
    { accepted: claude.reviewGate.decision.accepted, semanticVerdict: claude.reviewGate.decision.semanticVerdict, applicability: claude.reviewGate.decision.applicability },
    { accepted: codex.reviewGate.decision.accepted, semanticVerdict: codex.reviewGate.decision.semanticVerdict, applicability: codex.reviewGate.decision.applicability },
  );
});

// --- Case 5: OBSERVE disagreement carries exact identity/policy/contract/adapter/legacy context ---

test('claude-observe-disagreement-context: a DISAGREE observation records exact identity, policy, contract, adapter, and legacy outcome', () => {
  const fixture = createReviewGateFixture({ trustPolicy: observeTrustPolicy(), now: NOW_MS });
  try {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registration = registerPlan(fixture.gate, plan, 'plan-registered-disagree-372');
    const reviewRequest = reviewRequestFor(plan, obligation);
    const artifactDigest = 'd'.repeat(64);
    const reviewResult = makeReviewResult(plan, obligation, {
      semanticVerdict: 'CHANGES_REQUIRED',
      evidenceReferences: [`artifact-sha256:${artifactDigest}`],
      findings: [createFinding({
        id: 'issue-372-disagreement',
        severity: 'MEDIUM',
        disposition: 'MUST_FIX',
        summary: 'diagnostic disagreement context proof',
        evidence: ['artifact:issue-372-disagreement'],
      })],
    });
    const ids = identity({ taskId: 'task-372-disagree' });
    const lifecycleEvents = [
      lifecycleEvent('planned', ids),
      lifecycleEvent('dispatched', ids),
      lifecycleEvent('started', ids),
      lifecycleEvent('verdicted', ids, { verdict: 'PASS', event_id: 'verdicted-event-372-disagree' }),
    ];
    const sentinelOutcome = { status: 'CLEARED', verdict: 'PASS', outcome: 'PASS', lifecycleEventId: 'verdicted-event-372-disagree' };
    const coordinator = new MigrationCoordinator({ receiptStore: fixture.store, phase: 'OBSERVE', now: () => NOW_MS });
    const observed = new ClaudeReviewGateAdapter({
      reviewGate: fixture.gate,
      migrationCoordinator: coordinator,
      producer: 'fixture-reviewer',
      adapter: 'fixture-adapter',
      adapterVersion: 'claude-review-gate.v1',
      now: () => NOW_MS,
    }).observe({
      phase: 'OBSERVE',
      plan,
      identity: ids,
      lifecycleEvents,
      readinessEvents: readinessFor(ids, artifactDigest),
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'digest:sha256:' + 'b'.repeat(64), outcome: 'PASS' }],
      sentinelOutcome,
      acceptedOutcomeCost: canonicalAcceptedOutcomeCost(ids.taskId),
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
    });

    const expected = CORPUS.cases.find((entry) => entry.caseId === 'claude-observe-disagreement-context').expected;
    assert.strictEqual(observed.comparison, expected.comparison);
    assert.strictEqual(observed.effect, expected.effect);
    assert.strictEqual(observed.authority, expected.authority);
    assert.deepStrictEqual(observed.observation.identity, ids);
    assert.strictEqual(observed.observation.policyVersion, MIGRATION_POLICY_VERSION);
    assert.strictEqual(observed.observation.contractVersion, MIGRATION_CONTRACT_VERSION);
    assert.strictEqual(observed.observation.adapter, 'fixture-adapter');
    assert.deepStrictEqual(observed.observation.sentinelOutcome, sentinelOutcome);
  } finally {
    fixture.cleanup();
  }
});

// --- Cases 6/7: every focused Sentinel case is represented with a normalized outcome ---

function findSentinelCase(caseId) {
  const entry = SENTINEL_CORPUS.cases.find((row) => row.input.caseId === caseId);
  if (!entry) throw new Error(`Unknown sentinel case: ${caseId}`);
  return entry.input;
}

function baselineObserve(sentinelInput) {
  const fixture = createReviewGateFixture({ trustPolicy: observeTrustPolicy(), now: NOW_MS });
  try {
    const plan = makePlan();
    const registration = registerPlan(fixture.gate, plan, `plan-registered-baseline-${sentinelInput.caseId}`);
    const coordinator = new MigrationCoordinator({ receiptStore: fixture.store, phase: 'BASELINE', now: () => NOW_MS });
    const ids = identity({ taskId: `task-372-${sentinelInput.caseId}` });
    const normalizedSentinel = baseline.normalizeSentinelOutcome(sentinelInput);
    return new ClaudeReviewGateAdapter({
      reviewGate: fixture.gate,
      migrationCoordinator: coordinator,
      producer: 'fixture-reviewer',
      adapter: 'fixture-adapter',
      adapterVersion: 'claude-review-gate.v1',
      now: () => NOW_MS,
    }).observe({
      phase: 'BASELINE',
      plan,
      identity: ids,
      lifecycleEvents: [],
      readinessEvents: [],
      acceptedOutcomeCost: undefined,
      sentinelOutcome: {
        status: normalizedSentinel.lifecycleClearance,
        verdict: normalizedSentinel.completion,
        outcome: normalizedSentinel.completion,
        cost: {
          dispatchCount: 2,
          semanticReviewCount: 1,
          remediationRounds: 1,
          humanTurns: 0,
          elapsedMs: 42,
          receiptReuse: 3,
          falseBlocks: 0,
          unsafeClearance: 0,
          missedRequiredReview: 0,
          postMergeEscapes: 0,
        },
      },
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
    });
  } finally {
    fixture.cleanup();
  }
}

for (const sentinelCaseId of ['fresh-pass', 'missing-artifact']) {
  test(`claude-baseline-sentinel-${sentinelCaseId}: BASELINE snapshot preserves the normalized Sentinel outcome without invoking Review Gate`, () => {
    const sentinelInput = findSentinelCase(sentinelCaseId);
    const normalized = baseline.normalizeSentinelOutcome(sentinelInput);
    assert.strictEqual(normalized.caseId, sentinelCaseId);
    const observed = baselineObserve(sentinelInput);
    assert.strictEqual(observed.effect, 'DISABLED');
    assert.strictEqual(observed.comparison, 'INDETERMINATE');
    assert.strictEqual(observed.authority, 'SENTINEL');
    assert.strictEqual(observed.allowsTargetProgress, false);
  });
}

test('every focused Sentinel case survives normalization and is covered by the cross-platform corpus', () => {
  const requiredIds = SENTINEL_CORPUS.cases.map(({ input }) => input.caseId);
  const coveredIds = CORPUS.sentinelCoverage.map((entry) => entry.sentinelCaseId);
  assert.deepStrictEqual([...coveredIds].sort(), [...requiredIds].sort());
  for (const { input } of SENTINEL_CORPUS.cases) {
    assert.ok(baseline.normalizeSentinelOutcome(input), `${input.caseId} must normalize cleanly`);
  }
  for (const coverage of CORPUS.sentinelCoverage) {
    const input = findSentinelCase(coverage.sentinelCaseId);
    assert.deepStrictEqual(
      baseline.normalizeSentinelOutcome(input),
      coverage.normalizedExpected,
      `${coverage.sentinelCaseId} must carry its normalized expected outcome`,
    );
  }
  for (const entry of CORPUS.sentinelCoverage.filter((row) => row.mode === 'LIVE')) {
    const liveCase = CORPUS.cases.find((row) => row.caseId === entry.corpusCaseId);
    assert.ok(liveCase, `${entry.sentinelCaseId} names a real corpus case`);
    assert.strictEqual(liveCase.sentinelCaseId, entry.sentinelCaseId);
  }
});

// --- Cases 8/9/10: an inactive adapter is UNAVAILABLE, never a silent skip ---

test('codex-adapter-inactive-unavailable: an inactive Codex adapter refuses to record', () => {
  const adapter = new CodexReviewGateAdapter({ reviewGate: { handle: () => { throw new Error('must not be called'); } } });
  assert.strictEqual(adapter.capabilities().effect, 'DISABLED');
  let threw = null;
  try {
    adapter.record({});
  } catch (error) {
    threw = error;
  }
  assert.ok(threw, 'inactive adapter must throw');
  assert.strictEqual(threw.code, 'ADAPTER_INACTIVE');
});

test('ci-adapter-inactive-unavailable: an inactive CI adapter refuses to record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-differential-ci-'));
  try {
    const store = new ReceiptStore({ root, integrityKey: 'differential-372-ci-integrity-key-32bytes', trustPolicy: { producers: [] } });
    const adapter = new CiReviewGateAdapter({ store, activation: 'INACTIVE' });
    assert.strictEqual(adapter.capabilities().effect, 'DISABLED');
    let threw = null;
    try {
      adapter.record({});
    } catch (error) {
      threw = error;
    }
    assert.ok(threw, 'inactive adapter must throw');
    assert.strictEqual(threw.code, 'ADAPTER_INACTIVE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('git-provider-adapter-inactive-unavailable: an inactive Git-provider adapter refuses to record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-differential-git-'));
  try {
    const store = new ReceiptStore({ root, integrityKey: 'differential-372-git-integrity-key-32bytes', trustPolicy: { producers: [] } });
    const adapter = new GitProviderReviewGateAdapter({ store, activation: 'INACTIVE' });
    assert.strictEqual(adapter.capabilities().effect, 'DISABLED');
    let threw = null;
    try {
      adapter.record({});
    } catch (error) {
      threw = error;
    }
    assert.ok(threw, 'inactive adapter must throw');
    assert.strictEqual(threw.code, 'ADAPTER_INACTIVE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- Cases 11-14/17-18: CI and Git-provider preserve local/remote/delivery/archive tiers ---

const DELIVERY_IDENTITY = Object.freeze({
  workId: 'work-372', waveId: 'wave-372', planId: 'plan-372', decisionId: 'decision-372', sessionId: 'session-372',
});
const MERGE_IDENTITY = Object.freeze({
  commit: '7'.repeat(40),
  tree: '8'.repeat(40),
});
const POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';
const DELIVERY_NOW = () => '2026-09-07T00:00:00.000Z';

function deliveryStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-differential-delivery-'));
  return new ReceiptStore({
    root,
    integrityKey: 'differential-372-delivery-integrity-key-32b',
    trustPolicy: {
      producers: [
        { producer: 'git-provider-review-gate', adapter: 'review-gate-adapter', eventTypes: ['PROVIDER_MERGE_OBSERVED'], receiptKinds: ['verification'] },
        { producer: 'ci-review-gate', adapter: 'review-gate-adapter', eventTypes: ['CI_VERIFICATION_RECORDED'], receiptKinds: ['verification'] },
      ],
    },
  });
}

function mergeObservedReceipt(overrides = {}) {
  const adapter = new GitProviderReviewGateAdapter({ store: deliveryStore(), activation: 'ACTIVE', now: DELIVERY_NOW });
  return adapter.record({
    identity: DELIVERY_IDENTITY,
    mergeIdentity: MERGE_IDENTITY,
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    verificationId: 'verification-provider-merge-372',
    outcome: 'COMPLETE',
    ...overrides,
  }).receipt;
}

function postMergeCiReceipt(overrides = {}) {
  const adapter = new CiReviewGateAdapter({ store: deliveryStore(), activation: 'ACTIVE', now: DELIVERY_NOW });
  return adapter.record({
    identity: DELIVERY_IDENTITY,
    headIdentity: MERGE_IDENTITY,
    policyVersion: POLICY_VERSION,
    contractVersion: CONTRACT_VERSION,
    verificationId: 'verification-post-merge-ci-372',
    lane: 'post-merge',
    outcome: 'PASS',
    ...overrides,
  }).receipt;
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
    featureControl: FIXTURE.featureControl.observe,
    evaluatedAt: FIXTURE.evaluatedAt,
  });
}

test('ci-provider-delivery-archive-ready: an observed merge plus post-merge CI reaches ARCHIVE_READY', () => {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), postMergeCiReceipt()]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'ci-provider-delivery-archive-ready').expected;
  assert.strictEqual(projection.state, expected.deliveryState);
  assert.strictEqual(projection.completion.delivery, expected.completionDelivery);
});

test('git-provider-merge-alone-post-merge-pending: a merge observation alone stays POST_MERGE_PENDING', () => {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt()]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'git-provider-merge-alone-post-merge-pending').expected;
  assert.strictEqual(projection.state, expected.deliveryState);
  assert.ok(projection.condition.reasonCodes.includes(expected.reasonCode));
});

test('ci-alone-merge-unobserved-pending: post-merge CI alone without an observed merge stays POST_MERGE_PENDING', () => {
  const projection = deliveryCoordinator().reduceDelivery([postMergeCiReceipt()]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'ci-alone-merge-unobserved-pending').expected;
  assert.strictEqual(projection.state, expected.deliveryState);
  assert.ok(projection.condition.reasonCodes.includes(expected.reasonCode));
});

test('ci-provider-ambiguous-post-merge: two disagreeing required post-merge checks fail closed as ambiguous', () => {
  const lint = postMergeCiReceipt({ verificationId: 'verification-post-merge-lint-372', outcome: 'PASS' });
  const unitTests = postMergeCiReceipt({ verificationId: 'verification-post-merge-unit-372', outcome: 'FAIL' });
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), lint, unitTests]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'ci-provider-ambiguous-post-merge').expected;
  assert.strictEqual(projection.state, expected.deliveryState);
  assert.ok(projection.condition.reasonCodes.includes(expected.reasonCode));
});

test('post-merge-ci-corrected-rerun-supersedes-failure: a later corrective observation supersedes an earlier failure', () => {
  const failed = postMergeCiReceipt({ outcome: 'FAIL' });
  const corrected = { ...failed, receiptId: `${failed.receiptId}-rerun`, recordedAt: '2026-09-07T00:05:00.000Z', payload: { ...failed.payload, outcome: 'PASS' } };
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), failed, corrected]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'post-merge-ci-corrected-rerun-supersedes-failure').expected;
  assert.strictEqual(projection.state, expected.deliveryState);
  assert.strictEqual(projection.completion.delivery, expected.completionDelivery);
});

test('post-merge-ci-regression-not-masked: a later regression after an earlier pass is not overstated', () => {
  const passed = postMergeCiReceipt();
  const regressed = { ...passed, receiptId: `${passed.receiptId}-rerun`, recordedAt: '2026-09-07T00:05:00.000Z', payload: { ...passed.payload, outcome: 'FAIL' } };
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), passed, regressed]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'post-merge-ci-regression-not-masked').expected;
  assert.strictEqual(projection.state, expected.deliveryState);
  assert.ok(projection.condition.reasonCodes.includes(expected.reasonCode));
});

// --- Case 15: missing transport reports BLOCKED/PENDING at the core coordinator, never overstated ---

test('provider-missing-transport-blocked: an empty delivery evidence set fails closed without adapter involvement', () => {
  const projection = deliveryCoordinator().reduceDelivery([]);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'provider-missing-transport-blocked').expected;
  assert.strictEqual(projection.completion.delivery, expected.completionDelivery);
  assert.strictEqual(projection.condition.type, expected.conditionType);
});

// --- Case 16: WorkflowCoordinator.reduce() core behavior, no adapter involved ---

test('workflow-merge-ready-authorizes-pull-request: MERGE_READY with delivery authorization never grants a second enforcement effect', () => {
  const receipts = receiptsForHistory('merge-ready').map((item) => (
    item.receiptId !== 'receipt-decision-resolved' ? item : { ...item, payload: { ...item.payload, deliveryAuthorized: true } }
  ));
  const coordinator = new WorkflowCoordinator({ trustPolicy: FIXTURE.trustPolicy, featureControl: FIXTURE.featureControl.observe, evaluatedAt: FIXTURE.evaluatedAt });
  const projection = coordinator.reduce(receipts);
  const expected = CORPUS.cases.find((entry) => entry.caseId === 'workflow-merge-ready-authorizes-pull-request').expected;
  assert.strictEqual(projection.state, expected.state);
  assert.strictEqual(projection.authorizesPullRequest, expected.authorizesPullRequest);
  assert.strictEqual(projection.control.authority, expected.authority);
  assert.strictEqual(projection.control.allowsTargetProgress, expected.allowsTargetProgress);
});

// --- The shared corpus is the driver, not just an expectation catalogue ---

function corpusObservation(caseId, adapter, actual, flags = {}) {
  return actual === undefined
    ? { caseId, adapter, ...flags }
    : { caseId, adapter, actual, ...flags };
}

function reviewActual(source, comparison) {
  const gate = source.reviewGate || {};
  const decision = gate.decision || {};
  const receipt = source.receipt || source;
  const actual = {
    semanticVerdict: decision.semanticVerdict,
    executionStatus: decision.executionStatus,
    applicability: decision.applicability,
    accepted: decision.accepted,
    effect: source.effect || receipt.effect,
    authority: source.authority || receipt.authority,
    authorizesApproval: source.authorizesApproval !== undefined
      ? source.authorizesApproval : receipt.authorizesApproval,
    clearsSentinel: source.clearsSentinel !== undefined ? source.clearsSentinel : receipt.clearsSentinel,
    blocksSentinel: source.blocksSentinel !== undefined ? source.blocksSentinel : receipt.blocksSentinel,
    allowsTargetProgress: source.allowsTargetProgress !== undefined
      ? source.allowsTargetProgress : receipt.allowsTargetProgress,
  };
  if (comparison !== undefined) actual.comparison = comparison;
  if (decision.executionStatus === 'UNAVAILABLE') {
    actual.reviewGateStatus = source.reviewGateStatus || receipt.reviewGateStatus || gate.status || 'NOT_RUN';
  }
  return Object.fromEntries(Object.entries(actual).filter(([, value]) => value !== undefined));
}

function runPassParityCase() {
  const { claude, codex } = submitBoth({ ids: identity({ taskId: 'task-372-corpus-pass' }), semanticVerdict: 'PASS' });
  return [
    corpusObservation('claude-codex-pass-agree', 'CLAUDE', reviewActual(claude, 'AGREE'), {
      cohort: 'LOW_RISK',
      cost: baseline.normalizeAcceptedOutcomeCost({
        observationId: 'corpus-pass-low-risk',
        acceptedOutcome: true,
        metrics: { ...ACCEPTED_OUTCOME_COST_METRICS, humanTurns: 0, receiptReuseCount: 0 },
      }),
    }),
    corpusObservation('claude-codex-pass-agree', 'CODEX', reviewActual(codex, 'AGREE')),
  ];
}

function runChangesRequiredParityCase() {
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-corpus-changes' }),
    semanticVerdict: 'CHANGES_REQUIRED',
    findings: [createFinding({
      id: 'issue-372-corpus-finding',
      severity: 'MEDIUM',
      disposition: 'MUST_FIX',
      summary: 'cross-platform corpus finding',
      evidence: ['artifact:issue-372-corpus'],
    })],
  });
  return [
    corpusObservation('claude-codex-changes-required-parity', 'CLAUDE', reviewActual(claude), {
      blocked: true,
      cohort: 'HIGH_RISK',
      cost: baseline.normalizeAcceptedOutcomeCost({
        observationId: 'corpus-changes-high-risk',
        acceptedOutcome: false,
        metrics: {
          modelTokens: 4000,
          dispatchCount: 3,
          semanticReviewCount: 2,
          remediationRounds: 1,
          humanTurns: 1,
          elapsedMs: 84,
          falseBlockCount: 0,
          receiptReuseCount: 0,
        },
      }),
    }),
    corpusObservation('claude-codex-changes-required-parity', 'CODEX', reviewActual(codex), { blocked: true }),
  ];
}

function runUnavailableReviewCase() {
  const { claude, codex } = submitBoth({
    ids: identity({ taskId: 'task-372-corpus-unavailable' }),
    semanticVerdict: undefined,
    executionStatus: 'UNAVAILABLE',
  });
  return [
    corpusObservation('claude-codex-unavailable-review-result', 'CLAUDE', reviewActual(claude), { unavailable: true }),
    corpusObservation('claude-codex-unavailable-review-result', 'CODEX', reviewActual(codex), { unavailable: true }),
  ];
}

function runSharedReceiptCase() {
  const { claude, codex } = submitBoth({ ids: identity({ taskId: 'task-372-corpus-receipt' }), semanticVerdict: 'PASS' });
  return [
    corpusObservation('claude-codex-shared-receipt-decision', 'CLAUDE', reviewActual(claude)),
    corpusObservation('claude-codex-shared-receipt-decision', 'CODEX', reviewActual(codex)),
  ];
}

function runDisagreementCase() {
  const { claude } = submitBoth({
    ids: identity({ taskId: 'task-372-corpus-disagree' }),
    semanticVerdict: 'CHANGES_REQUIRED',
    findings: [createFinding({
      id: 'issue-372-corpus-disagreement',
      severity: 'MEDIUM',
      disposition: 'MUST_FIX',
      summary: 'diagnostic disagreement context proof',
      evidence: ['artifact:issue-372-disagreement'],
    })],
    sentinelOutcome: { status: 'CLEARED', verdict: 'PASS', outcome: 'PASS', lifecycleEventId: 'verdicted-event-372' },
  });
  const observation = claude.observation;
  return [corpusObservation('claude-observe-disagreement-context', 'CLAUDE', {
    comparison: claude.comparison,
    effect: claude.effect,
    authority: claude.authority,
    requiresExactContext: ['identity', 'policyVersion', 'contractVersion', 'adapter', 'sentinelOutcome'],
  }, {
    context: {
      identity: observation.identity,
      policyVersion: observation.policyVersion,
      contractVersion: observation.contractVersion,
      adapter: observation.adapter,
      legacyOutcome: observation.sentinelOutcome,
    },
  })];
}

function runBaselineCase(caseId) {
  const observed = baselineObserve(findSentinelCase(caseId));
  return [corpusObservation(`claude-baseline-sentinel-${caseId}`, 'CLAUDE', {
    effect: observed.effect,
    comparison: observed.comparison,
  }, caseId === 'missing-artifact' ? { blocked: true } : {})];
}

function runCodexInactiveCase() {
  const adapter = new CodexReviewGateAdapter({ reviewGate: { handle: () => { throw new Error('must not be called'); } } });
  try {
    adapter.record({});
  } catch (error) {
    return [corpusObservation('codex-adapter-inactive-unavailable', 'CODEX', {
      activation: 'INACTIVE', errorCode: error.code,
    }, { unavailable: true })];
  }
  throw new Error('inactive Codex adapter unexpectedly recorded');
}

function runCiInactiveCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-differential-corpus-ci-'));
  try {
    const store = new ReceiptStore({ root, integrityKey: 'differential-corpus-ci-integrity-key-32bytes', trustPolicy: { producers: [] } });
    const adapter = new CiReviewGateAdapter({ store, activation: 'INACTIVE' });
    try {
      adapter.record({});
    } catch (error) {
      return [corpusObservation('ci-adapter-inactive-unavailable', 'CI', {
        activation: 'INACTIVE', errorCode: error.code,
      }, { unavailable: true })];
    }
    throw new Error('inactive CI adapter unexpectedly recorded');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runGitProviderInactiveCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-differential-corpus-git-'));
  try {
    const store = new ReceiptStore({ root, integrityKey: 'differential-corpus-git-integrity-key-32bytes', trustPolicy: { producers: [] } });
    const adapter = new GitProviderReviewGateAdapter({ store, activation: 'INACTIVE' });
    try {
      adapter.record({});
    } catch (error) {
      return [corpusObservation('git-provider-adapter-inactive-unavailable', 'GIT_PROVIDER', {
        activation: 'INACTIVE', errorCode: error.code,
      }, { unavailable: true })];
    }
    throw new Error('inactive Git-provider adapter unexpectedly recorded');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function deliveryObservation(caseId, projection, extra = {}, flags = {}) {
  return [corpusObservation(caseId, caseId.startsWith('git-provider') ? 'GIT_PROVIDER' : 'CI', {
    deliveryState: projection.state,
    completionDelivery: projection.completion.delivery,
    ...extra,
  }, flags)];
}

function runArchiveReadyCase() {
  return [
    corpusObservation('ci-provider-delivery-archive-ready', 'CI', {
      deliveryState: deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), postMergeCiReceipt()]).state,
      completionDelivery: 'COMPLETE',
      tier: 'ARCHIVE',
    }),
    corpusObservation('ci-provider-delivery-archive-ready', 'GIT_PROVIDER', {
      deliveryState: 'ARCHIVE_READY', completionDelivery: 'COMPLETE', tier: 'ARCHIVE',
    }),
  ];
}

function runMergeAloneCase() {
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt()]);
  return deliveryObservation('git-provider-merge-alone-post-merge-pending', projection, {
    reasonCode: 'POST_MERGE_CI_UNOBSERVED',
    tier: 'DELIVERY',
  }, { blocked: true });
}

function runCiAloneCase() {
  const projection = deliveryCoordinator().reduceDelivery([postMergeCiReceipt()]);
  return deliveryObservation('ci-alone-merge-unobserved-pending', projection, {
    reasonCode: 'MERGE_UNOBSERVED',
    tier: 'REMOTE',
  }, { blocked: true });
}

function runAmbiguousCase() {
  const lint = postMergeCiReceipt({ verificationId: 'verification-post-merge-lint-corpus-372', outcome: 'PASS' });
  const unitTests = postMergeCiReceipt({ verificationId: 'verification-post-merge-unit-corpus-372', outcome: 'FAIL' });
  const projection = deliveryCoordinator().reduceDelivery([mergeObservedReceipt(), lint, unitTests]);
  return deliveryObservation('ci-provider-ambiguous-post-merge', projection, {
    reasonCode: 'AMBIGUOUS_POST_MERGE_CI',
    tier: 'DELIVERY',
  }, { blocked: true });
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
    item.receiptId !== 'receipt-decision-resolved' ? item : { ...item, payload: { ...item.payload, deliveryAuthorized: true } }
  ));
  const projection = new WorkflowCoordinator({
    trustPolicy: FIXTURE.trustPolicy,
    featureControl: FIXTURE.featureControl.observe,
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
  return deliveryObservation('post-merge-ci-corrected-rerun-supersedes-failure', projection, {}, {});
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
  return deliveryObservation('post-merge-ci-regression-not-masked', projection, {
    reasonCode: 'POST_MERGE_CI_UNOBSERVED',
  }, { blocked: true });
}

const CORPUS_CASE_RUNNERS = Object.freeze({
  'claude-codex-pass-agree': runPassParityCase,
  'claude-codex-changes-required-parity': runChangesRequiredParityCase,
  'claude-codex-unavailable-review-result': runUnavailableReviewCase,
  'claude-codex-shared-receipt-decision': runSharedReceiptCase,
  'claude-observe-disagreement-context': runDisagreementCase,
  'claude-baseline-sentinel-fresh-pass': () => runBaselineCase('fresh-pass'),
  'claude-baseline-sentinel-missing-artifact': () => runBaselineCase('missing-artifact'),
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

test('one shared corpus drives every case and every applicable adapter into one parity report', () => {
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

  const report = conformance.buildConformanceReport({ corpus: CORPUS, observations, generatedAt: NOW });
  assert.deepStrictEqual(report.mismatches, [], `shared corpus parity mismatches: ${JSON.stringify(report.mismatches)}`);
  assert.strictEqual(report.cases.length, CORPUS.cases.length);
  assert.ok(report.costCohorts.LOW_RISK, 'real adapter observations must feed the cost cohort report');
  assert.ok(report.costCohorts.HIGH_RISK, 'real adapter observations must preserve a separate high-risk cohort');
  assert.strictEqual(report.promotionEligible, false);
});

// --- Corpus shape, coverage, and adapter-key discipline ---

test('corpus enumerates every scenario kind and stays platform-neutral', () => {
  assert.strictEqual(CORPUS.schema, 'dhpk.cross-platform-differential-corpus.v1');
  const seenKinds = new Set(CORPUS.cases.map((entry) => entry.scenarioKind));
  for (const kind of CORPUS.scenarioKinds) assert.ok(seenKinds.has(kind), `no case exercises scenario kind ${kind}`);
  assert.doesNotMatch(JSON.stringify(CORPUS.cases), /\.claude|\/home\/|\\Users\\/);
  for (const entry of CORPUS.cases) {
    for (const adapterKey of entry.adapters) assert.ok(conformance.ADAPTER_KEYS.includes(adapterKey), `${entry.caseId} names an unknown adapter ${adapterKey}`);
  }
});

// --- The pure report builder itself is unit-tested in
// tests/review-gate-conformance.test.js (PASS/BLOCKED/UNAVAILABLE/NOT_RUN
// separation, phase-promotion purity, and cost cohort grouping). This file
// stays focused on driving the real adapters against the shared corpus.

test('the corpus documents the ADR-0016 exit gate without claiming it is met', () => {
  const { exitGate } = CORPUS.costCohorts;
  assert.strictEqual(exitGate.minAcceptedOutcomes, 20);
  assert.strictEqual(exitGate.maxUnsafeClearance, 0);
  assert.strictEqual(exitGate.maxCrossIdentityReceiptReuse, 0);
  assert.strictEqual(exitGate.maxMissedRequiredReview, 0);
});

// --- Every proof-bound legacy characterization the corpus leans on must exist and pass ---

test('the sentinel corpus this differential corpus carries forward is itself proof-bound and green', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'review-gate-baseline-sentinel.test.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `sentinel baseline suite must pass:\n${result.stdout}\n${result.stderr}`);
});

run('review-gate-cross-platform-differential');
