'use strict';

const { receipt } = require('./workflow-coordinator-fixture');

const MIGRATION_OBSERVATION_SCHEMA = 'dhpk.review-gate.migration-observation.v1';
const MIGRATION_PRODUCER = 'fixture-workflow';
const MIGRATION_ADAPTER = 'fixture-adapter';
const MIGRATION_ADAPTER_VERSION = 'claude-review-gate.v1';
const MIGRATION_EVENT_ID = 'migration-event-368';
const MIGRATION_SOURCE_COMMIT = '3'.repeat(40);
const MIGRATION_SOURCE_TREE = '4'.repeat(40);
const MIGRATION_POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const MIGRATION_CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';
const OBSERVE_MIGRATION_RECORDED_AT = '2026-09-06T04:07:00.000Z';
const MIGRATION_RECORDED_AT = '2026-09-06T04:12:00.000Z';
const DIAGNOSTIC_REVIEW_EVENT_ID = 'diagnostic-review-event-368';
const COST_OBSERVATION_ID = 'legacy-01f3eb374d9d2eb448470c432bfd1a66';
const PHASE_TRANSITION_SCHEMA = 'dhpk.review-gate.phase-transition-authority.v1';
const CUTOVER_TRANSITION_RECORDED_AT = '2026-09-06T04:13:00.000Z';
const CUTOVER_MIGRATION_RECORDED_AT = '2026-09-06T04:14:00.000Z';

function migrationObservationPayload(overrides = {}) {
  return {
    schema: MIGRATION_OBSERVATION_SCHEMA,
    producer: MIGRATION_PRODUCER,
    adapter: MIGRATION_ADAPTER,
    adapterVersion: MIGRATION_ADAPTER_VERSION,
    eventId: MIGRATION_EVENT_ID,
    receiptId: 'receipt-migration-observation',
    sourceCommit: MIGRATION_SOURCE_COMMIT,
    sourceTree: MIGRATION_SOURCE_TREE,
    policyVersion: MIGRATION_POLICY_VERSION,
    contractVersion: MIGRATION_CONTRACT_VERSION,
    recordedAt: MIGRATION_RECORDED_AT,
    phase: 'OBSERVE',
    authority: 'SENTINEL',
    effect: 'OBSERVE_ONLY',
    comparison: 'AGREE',
    workId: 'work-368',
    decisionId: 'decision-368',
    planId: 'plan-368',
    waveId: 'wave-368',
    obligationId: 'obligation-code-review',
    lane: 'code-reviewer',
    taskId: 'task-368',
    attemptId: 'attempt-368',
    attempt: 1,
    sessionId: 'session-368',
    dispatchId: 'dispatch-368',
    scopeId: 'scope-368',
    diffId: 'diff-368',
    identity: {
      taskId: 'task-368',
      attemptId: 'attempt-368',
      attempt: 1,
      sessionId: 'session-368',
      dispatchId: 'dispatch-368',
      scopeId: 'scope-368',
      diffId: 'diff-368',
    },
    scope: {
      paths: ['scripts/lib/workflow-coordinator.js'],
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    diff: {
      digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      reference: 'git-diff:issue-368',
    },
    sentinelStatus: 'PASS',
    reviewGateStatus: 'PASS',
    sentinelOutcome: {
      status: 'PASS',
      verdict: 'PASS',
      outcome: 'PASS',
      lifecycleEventId: 'verdicted-event-368',
    },
    reviewGate: {
      status: 'PASS',
      eventId: DIAGNOSTIC_REVIEW_EVENT_ID,
    },
    acceptedOutcomeCost: {
      schema: 'dhpk.accepted-outcome-cost.v1',
      observationId: COST_OBSERVATION_ID,
      acceptedOutcome: true,
      metrics: {
        modelTokens: null,
        dispatchCount: 1,
        semanticReviewCount: 1,
        remediationRounds: 0,
        humanTurns: null,
        elapsedMs: 42,
        falseBlockCount: null,
        receiptReuseCount: null,
      },
      telemetryFailures: [],
      telemetryFailureCount: 0,
      telemetryStatus: 'PARTIAL',
      retirementEligible: false,
    },
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    allowsTargetProgress: false,
    automaticPromotion: false,
    retirementEligible: false,
    liveness: 'COMPATIBILITY_ONLY',
    provenance: {
      digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      reference: 'artifact:claude-migration-observation-368',
      producer: MIGRATION_PRODUCER,
      adapter: MIGRATION_ADAPTER,
      adapterVersion: MIGRATION_ADAPTER_VERSION,
      eventId: MIGRATION_EVENT_ID,
      receiptId: 'receipt-migration-observation',
      lifecycleEventId: 'verdicted-event-368',
      costObservationId: COST_OBSERVATION_ID,
      sourceCommit: MIGRATION_SOURCE_COMMIT,
      sourceTree: MIGRATION_SOURCE_TREE,
      policyVersion: MIGRATION_POLICY_VERSION,
      contractVersion: MIGRATION_CONTRACT_VERSION,
      recordedAt: MIGRATION_RECORDED_AT,
      artifactDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      lifecycleEventIds: ['verdicted-event-368'],
      readinessEventIds: ['ready-event-368'],
    },
    ...overrides,
  };
}

function migrationObservationReceipt(receiptId = 'receipt-migration-observation') {
  const observation = receipt('receipt-local-gate-pass');
  const payload = migrationObservationPayload({ receiptId });
  payload.provenance.receiptId = receiptId;
  Object.assign(observation, {
    receiptId,
    kind: 'migration-observation',
    workId: payload.workId,
    waveId: payload.waveId,
    planId: payload.planId,
    decisionId: payload.decisionId,
    obligationId: payload.obligationId,
    lane: payload.lane,
    taskId: payload.taskId,
    attemptId: payload.attemptId,
    attempt: payload.attempt,
    sessionId: payload.sessionId,
    dispatchId: payload.dispatchId,
    scopeId: payload.scopeId,
    diffId: payload.diffId,
    producer: payload.producer,
    adapter: payload.adapter,
    adapterVersion: payload.adapterVersion,
    sourceCommit: payload.sourceCommit,
    sourceTree: payload.sourceTree,
    policyVersion: payload.policyVersion,
    contractVersion: payload.contractVersion,
    recordedAt: payload.recordedAt,
    payload,
  });
  return observation;
}

function observeMigrationObservationReceipt(receiptId = 'receipt-observe-migration-observation') {
  const observation = migrationObservationReceipt(receiptId);
  observation.recordedAt = OBSERVE_MIGRATION_RECORDED_AT;
  observation.payload.recordedAt = OBSERVE_MIGRATION_RECORDED_AT;
  observation.payload.provenance.recordedAt = OBSERVE_MIGRATION_RECORDED_AT;
  observation.payload.provenance.receiptId = receiptId;
  return observation;
}

function dualMigrationObservationReceipt(receiptId = 'receipt-dual-migration-observation', overrides = {}) {
  const observation = migrationObservationReceipt(receiptId);
  observation.payload = {
    ...observation.payload,
    phase: 'DUAL_ENFORCE',
    authority: 'SENTINEL_AND_REVIEW_GATE',
    effect: 'ENFORCE',
    comparison: 'AGREE',
    allowsTargetProgress: true,
    reviewGate: {
      status: 'PASS',
      accepted: true,
      allowsProgress: true,
      lifecycleStatus: 'RESOLVED',
      executionStatus: 'COMPLETE',
      applicability: 'REQUIRED',
      semanticVerdict: 'PASS',
      blockingReasons: [],
      eventId: 'review-event-368-pass',
    },
    ...overrides,
  };
  observation.payload.eventId = `${MIGRATION_EVENT_ID}-dual`;
  observation.payload.provenance = {
    ...observation.payload.provenance,
    digest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    reference: 'artifact:claude-migration-observation-368-dual',
    eventId: observation.payload.eventId,
    receiptId,
    recordedAt: MIGRATION_RECORDED_AT,
  };
  observation.recordedAt = MIGRATION_RECORDED_AT;
  observation.payload.recordedAt = MIGRATION_RECORDED_AT;
  return observation;
}

function cutoverMigrationObservationReceipt(receiptId = 'receipt-cutover-migration-observation', overrides = {}) {
  const observation = migrationObservationReceipt(receiptId);
  observation.recordedAt = CUTOVER_MIGRATION_RECORDED_AT;
  observation.payload = {
    ...observation.payload,
    phase: 'CUTOVER',
    authority: 'REVIEW_GATE',
    effect: 'ENFORCE',
    comparison: 'AGREE',
    allowsTargetProgress: true,
    reviewGate: {
      status: 'PASS',
      accepted: true,
      allowsProgress: true,
      lifecycleStatus: 'RESOLVED',
      executionStatus: 'COMPLETE',
      applicability: 'REQUIRED',
      semanticVerdict: 'PASS',
      blockingReasons: [],
      eventId: 'review-event-368-pass',
    },
    ...overrides,
  };
  observation.payload.eventId = `${MIGRATION_EVENT_ID}-cutover`;
  observation.payload.provenance = {
    ...observation.payload.provenance,
    digest: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    reference: 'artifact:claude-migration-observation-368-cutover',
    eventId: observation.payload.eventId,
    receiptId,
    recordedAt: CUTOVER_MIGRATION_RECORDED_AT,
  };
  observation.payload.recordedAt = CUTOVER_MIGRATION_RECORDED_AT;
  return observation;
}

function phaseTransitionAuthorityReceipt(receiptId = 'receipt-phase-transition-authority') {
  const source = receipt('receipt-local-gate-pass');
  return {
    ...source,
    receiptId,
    kind: 'authority',
    producer: 'human-authority',
    adapter: 'human-authority-adapter',
    adapterVersion: 'human-authority.v1',
    sessionId: 'human-authority-session-368',
    taskId: 'task-368',
    attemptId: 'attempt-368',
    attempt: 1,
    dispatchId: 'dispatch-368',
    scopeId: 'scope-368',
    diffId: 'diff-368',
    recordedAt: '2026-09-06T04:08:00.000Z',
    payload: {
      schema: PHASE_TRANSITION_SCHEMA,
      eventId: 'phase-transition-event-373',
      transitionId: 'transition-373',
      action: 'PROMOTE',
      currentPhase: 'OBSERVE',
      targetPhase: 'DUAL_ENFORCE',
      evidenceBundle: {
        digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        reference: 'artifact:claude-migration-observation-368',
      },
      reason: 'maintainer approved the migration phase',
      approver: 'human:maintainer',
      issuedAt: '2026-09-06T03:00:00.000Z',
      expiresAt: '2026-09-06T06:00:00.000Z',
    },
  };
}

function cutoverPhaseTransitionAuthorityReceipt(receiptId = 'receipt-phase-transition-cutover-authority') {
  const authority = phaseTransitionAuthorityReceipt(receiptId);
  authority.recordedAt = CUTOVER_TRANSITION_RECORDED_AT;
  authority.payload = {
    ...authority.payload,
    eventId: 'phase-transition-event-374',
    transitionId: 'transition-374',
    currentPhase: 'DUAL_ENFORCE',
    targetPhase: 'CUTOVER',
    evidenceBundle: {
      digest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      reference: 'artifact:claude-migration-observation-368-dual',
    },
  };
  return authority;
}

function rollbackPhaseTransitionAuthorityReceipt(receiptId, recordedAt, evidenceBundle) {
  const authority = phaseTransitionAuthorityReceipt(receiptId);
  authority.recordedAt = recordedAt;
  authority.payload = {
    ...authority.payload,
    eventId: `${receiptId}-event`,
    transitionId: `${receiptId}-transition`,
    action: 'ROLLBACK',
    currentPhase: 'CUTOVER',
    targetPhase: 'DUAL_ENFORCE',
    evidenceBundle,
  };
  return authority;
}

// Issue #375 Option B (openspec/changes/adjust-review-gate-retirement-threshold):
// the single-maintainer authorization track substitutes a time-separated,
// CI-corroborated self-authorization for a distinct-party phase-promotion
// authority. `singleMaintainerCutoverAuthorityReceipt` lets a test control
// the authorizing act's session/identity and timing independently of the
// CUTOVER outcome's own session/identity/timing (from
// `cutoverMigrationObservationReceipt`, sessionId 'session-368',
// recordedAt `CUTOVER_MIGRATION_RECORDED_AT`), so tests can assert same-
// session/immediate rejection versus time-separated acceptance without
// guessing the exact cool-down constant GREEN will configure.
function singleMaintainerCutoverAuthorityReceipt({
  receiptId = 'receipt-phase-transition-cutover-authority-single-maintainer',
  sessionId = 'human-authority-session-368',
  recordedAt = CUTOVER_TRANSITION_RECORDED_AT,
  issuedAt = '2026-09-06T04:00:00.000Z',
  expiresAt = '2026-09-06T06:00:00.000Z',
} = {}) {
  const authority = cutoverPhaseTransitionAuthorityReceipt(receiptId);
  authority.sessionId = sessionId;
  authority.recordedAt = recordedAt;
  authority.payload = {
    ...authority.payload,
    issuedAt,
    expiresAt,
  };
  return authority;
}

// Externally recorded CI verification evidence corroborating a CUTOVER
// outcome. Reuses the existing `verification`/PROVIDER_MERGE receipt shape
// already produced by `scripts/lib/git-provider-review-gate-adapter.js`
// (ADR-0017) rather than inventing a parallel CI-evidence schema; it is not
// routed through `exportBundle`/`importBundle` here because that boundary
// requires every verification to satisfy a decision's `requiredVerifications`
// (workflow-coordinator-evidence.js), which never lists PROVIDER_MERGE — CI
// corroboration for this track is external corroboration, not part of the
// reviewed obligation chain. `evidenceBundle` binds it to the CUTOVER
// outcome's own provenance (`cutoverMigrationObservationReceipt`'s
// `payload.provenance.digest`/`reference`).
function ciVerificationReceipt({
  receiptId = 'receipt-ci-verification-368',
  verificationId = 'verification-ci-provider-merge-368',
  outcome = 'PASS',
  recordedAt = '2026-09-06T04:16:00.000Z',
  evidenceBundle = {
    digest: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    reference: 'artifact:claude-migration-observation-368-cutover',
  },
} = {}) {
  const source = receipt('receipt-local-gate-pass');
  return {
    ...source,
    receiptId,
    kind: 'verification',
    producer: 'git-provider-review-gate',
    adapter: 'git-provider-review-gate-adapter',
    sessionId: 'ci-provider-review-gate-session-368',
    recordedAt,
    payload: {
      schema: 'dhpk.workflow.verification.v1',
      verificationId,
      lane: 'provider-merge',
      evidenceType: 'PROVIDER_MERGE',
      outcome,
      evidenceBundle,
    },
  };
}

// Wraps a phase-promotion authority receipt as a single-maintainer-track
// collection authority: `track: 'SINGLE_MAINTAINER'` marks the alternate
// path explicitly (per spec, it must be labeled wherever it is used), and
// `ciVerification` carries the corroborating receipt built above (or is
// omitted/null to exercise the "no CI corroboration" rejection scenario).
function singleMaintainerCollectionAuthority({ receipt: authorityReceipt, ciVerification = null } = {}) {
  return {
    receipt: authorityReceipt,
    track: 'SINGLE_MAINTAINER',
    ciVerification: ciVerification ? { receipt: ciVerification } : null,
  };
}

module.exports = {
  ciVerificationReceipt,
  cutoverMigrationObservationReceipt,
  cutoverPhaseTransitionAuthorityReceipt,
  dualMigrationObservationReceipt,
  migrationObservationReceipt,
  observeMigrationObservationReceipt,
  phaseTransitionAuthorityReceipt,
  rollbackPhaseTransitionAuthorityReceipt,
  singleMaintainerCollectionAuthority,
  singleMaintainerCutoverAuthorityReceipt,
};
