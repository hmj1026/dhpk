'use strict';

const {
  INITIAL_RISK_POLICY,
  RiskRouter,
  createWorkRecord,
} = require('./risk-router');
const { sha256 } = require('./receipt-primitives');
const {
  ADAPTER_VERSION: CLAUDE_ADAPTER_VERSION,
  ClaudeReviewGateAdapter,
  runtimeObservationProvenanceDigest,
} = require('./claude-review-gate-adapter');
const { MigrationCoordinator } = require('./migration-coordinator');
const { RuntimeError, fail } = require('./review-gate-runtime-errors');
const {
  CLAUDE_ADAPTER,
  CLAUDE_PRODUCER,
  MAX_EVIDENCE_BYTES,
  SCHEMA,
  assertSafeId,
  clone,
  createIntegrityKey,
  defaultConfig,
  runtimeState,
  writeDiagnostic,
} = require('./review-gate-runtime-storage');
const {
  assertSameIdentity,
  digestJson,
  eventIdentity,
  normalizeCostSidecar,
  readCompanion,
  readEvidenceFile,
  readJsonLinesSidecar,
  readJsonSidecar,
  readStdinWorkRequest,
} = require('./review-gate-runtime-evidence');
const {
  createPlanRegisteredEvent,
  createStoreAndGate,
  currentStoreHistory,
  observationMatches,
  observeResultFromObservation,
  planDigest,
  readPlanCheckpoint,
  registeredPlanFromHistory,
  reviewProjectionFromHistory,
  reviewRequestFor,
  writePlanCheckpoint,
} = require('./review-gate-runtime-checkpoint');

const init = ({ repoRoot } = {}) => {
  const initialized = createIntegrityKey(repoRoot);
  return {
    command: 'init',
    schema: SCHEMA,
    status: initialized ? 'INITIALIZED' : 'ALREADY_INITIALIZED',
    initialized,
  };
};

const observe = ({
  repoRoot,
  workId,
  waveId,
  artifact,
  companion,
  lifecycleEvents,
  readinessEvents,
  acceptedOutcomeCost,
  sentinelOutcome,
  now = () => Date.now(),
} = {}) => {
  assertSafeId(workId, 'workId');
  assertSafeId(waveId, 'waveId');
  const state = runtimeState(repoRoot);
  const checkpoint = readPlanCheckpoint(state.storeRoot, workId);
  if (!checkpoint) fail('PLAN_NOT_FOUND');
  if (checkpoint.waveId !== waveId) fail('FOREIGN_EVIDENCE');

  const { store, reviewGate } = createStoreAndGate({
    storeRoot: state.storeRoot,
    integrityKey: state.integrityKey,
    config: state.config,
    now,
  });
  const history = currentStoreHistory(store, state.storeRoot, workId);
  const plan = registeredPlanFromHistory(history, checkpoint);
  const artifactFile = readEvidenceFile(repoRoot, artifact, MAX_EVIDENCE_BYTES, 'MISSING_ARTIFACT');
  const companionEvidence = readCompanion(repoRoot, artifactFile, companion);
  const artifactDigest = `sha256:${sha256(artifactFile.content)}`;
  if (artifactDigest !== companionEvidence.artifact.sha256) fail('STALE_ARTIFACT');

  const lifecycle = readJsonLinesSidecar(repoRoot, lifecycleEvents, 'MALFORMED_LIFECYCLE');
  const readiness = readJsonLinesSidecar(repoRoot, readinessEvents, 'MALFORMED_READINESS');
  if (!lifecycle || lifecycle.length === 0) fail('MISSING_LIFECYCLE');
  if (!readiness || readiness.length === 0) fail('MISSING_READINESS');
  const identity = companionEvidence.artifact.identity;
  for (const event of lifecycle) assertSameIdentity(identity, eventIdentity(event), 'FOREIGN_IDENTITY');
  for (const event of readiness) assertSameIdentity(identity, eventIdentity(event), 'FOREIGN_IDENTITY');
  const readinessDigests = readiness.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event) || event.state !== 'artifact-ready') {
      fail('MALFORMED_READINESS');
    }
    const value = event.artifact_sha256;
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('MALFORMED_READINESS');
    return value;
  });
  if (readinessDigests.some((digest) => digest !== artifactDigest)) fail('STALE_ARTIFACT');

  const sentinel = readJsonSidecar(repoRoot, sentinelOutcome, 'MALFORMED_SENTINEL');
  if (!sentinel || typeof sentinel !== 'object' || Array.isArray(sentinel)) fail('MALFORMED_SENTINEL');
  const costSidecar = readJsonLinesSidecar(
    repoRoot,
    acceptedOutcomeCost,
    'MALFORMED_ACCEPTED_OUTCOME_COST',
    true,
  );
  const cost = normalizeCostSidecar(identity, lifecycle, costSidecar);

  const obligation = plan.obligations.find((candidate) => (
    candidate.obligationId === companionEvidence.reviewResult.obligationId
      && candidate.lane === companionEvidence.reviewResult.lane
  ));
  if (!obligation) fail('FOREIGN_EVIDENCE');
  const reviewRequest = reviewRequestFor(plan, history, obligation);
  if (digestJson(reviewRequest) !== companionEvidence.requestDigest) fail('STALE_EVIDENCE');
  if (reviewRequest.obligationId !== companionEvidence.reviewResult.obligationId
    || reviewRequest.lane !== companionEvidence.reviewResult.lane) {
    fail('FOREIGN_EVIDENCE');
  }

  const previousReview = [...history.receipts].reverse().find((receipt) => (
    receipt.kind === 'review'
      && receipt.workId === plan.workId
      && receipt.waveId === plan.waveId
      && receipt.obligationId === obligation.obligationId
      && receipt.lane === obligation.lane
  ));
  if (previousReview && previousReview.payload
    && (previousReview.payload.requestDigest !== digestJson(reviewRequest)
      || previousReview.payload.resultDigest !== digestJson(companionEvidence.reviewResult))) {
    fail('IDEMPOTENCY_CONFLICT');
  }
  const adapterInput = {
    phase: state.config.phase,
    plan,
    identity,
    artifactReference: artifactFile.relative,
    lifecycleEvents: lifecycle,
    readinessEvents: readiness,
    reviewRequest,
    reviewResult: companionEvidence.reviewResult,
    executedCommands: [{
      command: `digest:${companionEvidence.command.sha256}`,
      outcome: companionEvidence.command.outcome,
    }],
    sentinelOutcome: sentinel,
    acceptedOutcomeCost: cost,
    expectedRevision: history.revision,
    expectedChainDigest: history.chainDigest,
  };
  const previousObservation = [...history.receipts].reverse().find((receipt) => (
    receipt.kind === 'migration-observation'
      && observationMatches(receipt.payload, plan, obligation, identity)
  ));
  if (previousObservation) {
    const previousArtifactDigest = previousObservation.payload.provenance
      && previousObservation.payload.provenance.artifactDigest;
    if (previousArtifactDigest !== artifactDigest) fail('STALE_ARTIFACT');
    let currentProvenanceDigest;
    try {
      currentProvenanceDigest = runtimeObservationProvenanceDigest({
        input: adapterInput,
        gate: previousObservation.payload.reviewGate,
        adapter: CLAUDE_ADAPTER,
        adapterVersion: CLAUDE_ADAPTER_VERSION,
      });
    } catch (_) {
      fail('IDEMPOTENCY_CONFLICT');
    }
    if (!previousObservation.payload.provenance
      || previousObservation.payload.provenance.digest !== currentProvenanceDigest) {
      fail('IDEMPOTENCY_CONFLICT');
    }
    return observeResultFromObservation(
      previousObservation.payload,
      state,
      history.revision,
      history.chainDigest,
    );
  }

  const migrationCoordinator = new MigrationCoordinator({
    receiptStore: store,
    phase: state.config.phase,
    now,
  });
  const adapter = new ClaudeReviewGateAdapter({
    reviewGate,
    migrationCoordinator,
    producer: CLAUDE_PRODUCER,
    adapter: CLAUDE_ADAPTER,
    now,
  });
  let recorded;
  try {
    recorded = adapter.observe(adapterInput);
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    fail(error && error.code ? error.code : 'OBSERVATION_FAILED');
  }
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)
    || !recorded.observation || typeof recorded.observation !== 'object') {
    fail('OBSERVATION_FAILED');
  }
  if (recorded.reviewGate && recorded.reviewGate.accepted === false) fail('REVIEW_GATE_FAILED');
  const observation = recorded.observation;
  return observeResultFromObservation(observation, state, recorded.revision, recorded.chainDigest);
};

const prepare = ({ repoRoot, input, now = () => Date.now() } = {}) => {
  const state = runtimeState(repoRoot);
  const workRequest = readStdinWorkRequest(input);
  const workRecord = createWorkRecord(workRequest);
  const plan = new RiskRouter().plan(workRecord, INITIAL_RISK_POLICY);
  const checkpoint = readPlanCheckpoint(state.storeRoot, plan.workId);
  if (checkpoint && checkpoint.planDigest !== planDigest(plan)) fail('STATE_CONFLICT');
  const { store, gate } = createStoreAndGate({
    storeRoot: state.storeRoot,
    integrityKey: state.integrityKey,
    config: state.config,
    now,
  });
  const current = currentStoreHistory(store, state.storeRoot, plan.workId);
  if (checkpoint) {
    const registeredPlan = registeredPlanFromHistory(current, checkpoint);
    const projection = reviewProjectionFromHistory({
      history: current,
      state,
      workId: registeredPlan.workId,
      waveId: registeredPlan.waveId,
      now,
    });
    if (!projection || !projection.decision || projection.decision.accepted !== true) {
      fail('PLAN_REGISTRATION_FAILED');
    }
    if (projection.workId !== checkpoint.workId || projection.waveId !== checkpoint.waveId) {
      fail('STATE_CORRUPT');
    }
    return {
      schema: SCHEMA,
      command: 'prepare',
      status: 'PREPARED',
      phase: state.config.phase,
      workId: checkpoint.workId,
      waveId: checkpoint.waveId,
      decisionId: checkpoint.decisionId,
      planId: checkpoint.planId,
      revision: current.revision,
      chainDigest: current.chainDigest,
      reviewRequests: clone(projection.reviewRequests),
    };
  }
  const expectedRevision = current.revision;
  const expectedChainDigest = current.chainDigest;
  const event = createPlanRegisteredEvent(
    plan,
    state.config,
    now,
  );
  const projection = gate.handle({
    expectedRevision,
    expectedChainDigest,
    event,
  });
  if (!projection || !projection.decision || projection.decision.accepted !== true) {
    fail('PLAN_REGISTRATION_FAILED');
  }
  if (!checkpoint) writePlanCheckpoint(state.storeRoot, plan, projection, event);
  return {
    schema: SCHEMA,
    command: 'prepare',
    status: 'PREPARED',
    phase: state.config.phase,
    workId: plan.workId,
    waveId: plan.waveId,
    decisionId: plan.decisionId,
    planId: plan.planId,
    revision: projection.revision,
    chainDigest: projection.chainDigest,
    reviewRequests: clone(projection.reviewRequests),
  };
};

const status = ({ repoRoot, workId, waveId = null, now = () => Date.now() } = {}) => {
  assertSafeId(workId, 'workId');
  if (waveId !== null && waveId !== undefined) assertSafeId(waveId, 'waveId');
  const state = runtimeState(repoRoot);
  const checkpoint = readPlanCheckpoint(state.storeRoot, workId);
  if (!checkpoint) fail('PLAN_NOT_FOUND');
  const { store } = createStoreAndGate({
    storeRoot: state.storeRoot,
    integrityKey: state.integrityKey,
    config: state.config,
    now,
  });
  const history = currentStoreHistory(store, state.storeRoot, workId);
  const projection = reviewProjectionFromHistory({
    history,
    state,
    workId,
    waveId: waveId || checkpoint.waveId,
    now,
  });
  if (!projection || !projection.decision || projection.decision.accepted !== true) {
    fail('STATUS_UNAVAILABLE');
  }
  if (projection.workId !== checkpoint.workId || projection.waveId !== checkpoint.waveId) {
    fail('FOREIGN_EVIDENCE');
  }
  const receiptCounts = history.receipts.reduce((counts, receipt) => {
    const kind = receipt && receipt.kind;
    if (typeof kind === 'string') counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {});
  const receiptSummary = {
    total: history.receipts.length,
    byKind: Object.fromEntries(Object.entries(receiptCounts).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))),
  };
  let migrationObservation = null;
  if (history.receipts.some((receipt) => receipt.kind === 'migration-observation')) {
    try {
      migrationObservation = new MigrationCoordinator({
        receiptStore: store,
        phase: state.config.phase,
        now,
      }).inspect({
        workId,
        waveId: waveId || checkpoint.waveId,
        expectedRevision: history.revision,
        expectedChainDigest: history.chainDigest,
      });
    } catch (_) {
      fail('STATUS_UNAVAILABLE');
    }
  }
  return {
    schema: SCHEMA,
    command: 'status',
    status: projection.lifecycleStatus,
    phase: state.config.phase,
    workId: checkpoint.workId,
    waveId: checkpoint.waveId,
    decisionId: checkpoint.decisionId,
    planId: checkpoint.planId,
    revision: history.revision,
    chainDigest: history.chainDigest,
    semanticVerdict: projection.semanticVerdict,
    executionStatus: projection.executionStatus,
    applicability: projection.applicability,
    reviewRequests: clone(projection.reviewRequests),
    receiptSummary,
    migrationObservation: migrationObservation ? clone(migrationObservation) : null,
  };
};

module.exports = {
  defaultConfig,
  init,
  observe,
  prepare,
  status,
  writeDiagnostic,
};
