'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256, SAFE_ID } = require('./receipt-primitives');
const { createReviewRequest } = require('./reviewer-contract');
const {
  ReceiptStore,
  STORE_EVENT_SCHEMA,
} = require('./review-gate-receipt-store');
const {
  PLAN_REGISTERED,
  ReviewGate,
} = require('./review-gate');
const {
  MIGRATION_EVENT,
  PLAN_CHECKPOINT_SCHEMA,
  PLAN_DIRECTORY,
  SCHEMA,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_EVENTS,
  MAX_STDIN_BYTES,
  assertSafeId,
  assertPhysicalDirectory,
  clone,
  isRecord,
  parseJson,
  physicalPath,
  readPhysicalFile,
  writePrivateImmutable,
} = require('./review-gate-runtime-storage');
const { fail } = require('./review-gate-runtime-errors');

const IDENTITY_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'attempt',
  'sessionId',
  'dispatchId',
  'scopeId',
  'diffId',
]);

const listEventNames = (storeRoot, eventsPath) => {
  physicalPath(storeRoot, eventsPath, 'STATE_CORRUPT');
  let handle;
  const names = [];
  try {
    handle = fs.opendirSync(eventsPath);
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (names.length >= MAX_EVIDENCE_EVENTS) fail('STATE_CORRUPT');
      names.push(entry.name);
    }
  } catch (error) {
    if (error && error.name === 'ReviewGateRuntimeError') throw error;
    fail('STATE_CORRUPT');
  } finally {
    if (handle !== undefined) {
      try { handle.closeSync(); } catch (_) { /* preserve the bounded enumeration error */ }
    }
  }
  physicalPath(storeRoot, eventsPath, 'STATE_CORRUPT');
  return names;
};

const createPlanRegisteredEvent = (plan, config, now = () => Date.now()) => {
  const identity = {
    workId: plan.workId,
    waveId: plan.waveId,
    planId: plan.planId,
    decisionId: plan.decisionId,
    producer: config.producer,
    adapter: config.adapter,
  };
  const eventId = `plan-registered-${sha256(canonicalJson(identity))}`;
  const sessionId = `runtime-session-${sha256(canonicalJson({
    workId: plan.workId,
    waveId: plan.waveId,
  }))}`;
  const timestamp = now instanceof Date
    ? now.getTime()
    : typeof now === 'string' ? Date.parse(now)
      : typeof now === 'number' ? now
        : Number(now());
  if (!Number.isFinite(timestamp)) fail('INVALID_CLOCK');
  return {
    schema: STORE_EVENT_SCHEMA,
    eventId,
    eventType: PLAN_REGISTERED,
    workId: plan.workId,
    waveId: plan.waveId,
    planId: plan.planId,
    decisionId: plan.decisionId,
    producer: config.producer,
    adapter: config.adapter,
    sessionId,
    sourceCommit: plan.headIdentity.commit,
    sourceTree: plan.headIdentity.tree,
    policyVersion: plan.policyVersion,
    contractVersion: plan.contractVersion,
    recordedAt: new Date(timestamp).toISOString(),
    payload: { plan },
  };
};

const reviewHistory = (history) => ({
  ...history,
  events: history.events.filter((event) => event.eventType !== MIGRATION_EVENT),
  receipts: history.receipts.filter((receipt) => receipt.kind !== 'migration-observation'),
});

const createReviewGateStoreView = (store) => ({
  append: (input) => store.append(input),
  replay: (input) => reviewHistory(store.replay(input)),
  inspect: (input) => reviewHistory(store.inspect(input)),
});

const createReviewGateFacade = (gate) => ({
  handle: (input) => {
    const result = gate.handle(input);
    if (!result || !result.decision || result.decision.accepted !== true) {
      fail('REVIEW_GATE_FAILED');
    }
    return { ...result, accepted: true };
  },
});

const createStoreAndGate = ({ storeRoot, integrityKey, config, now }) => {
  const store = new ReceiptStore({
    root: storeRoot,
    integrityKey,
    trustPolicy: config.trustPolicy,
    now,
  });
  const reviewStore = createReviewGateStoreView(store);
  const gate = new ReviewGate({
    receiptStore: reviewStore,
    trustPolicy: config.trustPolicy,
    now,
  });
  return { store, reviewStore, gate, reviewGate: createReviewGateFacade(gate) };
};

const currentStoreHistory = (store, storeRoot, workId) => {
  const eventsPath = path.join(storeRoot, 'works', workId, 'events');
  let stat;
  try {
    stat = fs.lstatSync(eventsPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return store.replay({ workId, expectedRevision: 0, expectedChainDigest: null });
    }
    fail('STATE_CORRUPT');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('STATE_CORRUPT');
  const names = listEventNames(storeRoot, eventsPath);
  let revision = 0;
  let foundRevision = false;
  for (const name of names) {
    if (!/^\d{12}\.json$/.test(name)) continue;
    const candidate = Number(name.slice(0, -'.json'.length));
    if (!foundRevision || candidate > revision) revision = candidate;
    foundRevision = true;
  }
  if (!foundRevision) {
    return store.replay({ workId, expectedRevision: 0, expectedChainDigest: null });
  }
  const sequencePath = path.join(eventsPath, `${String(revision).padStart(12, '0')}.json`);
  physicalPath(storeRoot, sequencePath, 'STATE_CORRUPT');
  let sequence;
  try {
    sequence = JSON.parse(readPhysicalFile(
      sequencePath,
      MAX_EVIDENCE_BYTES,
      'STATE_CORRUPT',
      { privateFile: true, physicalRoot: storeRoot },
    ).toString('utf8'));
  } catch (error) {
    if (error && error.name === 'ReviewGateRuntimeError') throw error;
    fail('STATE_CORRUPT');
  }
  if (!isRecord(sequence) || !/^sha256:[a-f0-9]{64}$/.test(sequence.chainDigest || '')) {
    fail('STATE_CORRUPT');
  }
  return store.replay({
    workId,
    expectedRevision: revision,
    expectedChainDigest: sequence.chainDigest,
  });
};

const planCheckpointPath = (storeRoot, workId) => {
  assertSafeId(workId, 'workId');
  const plans = path.join(storeRoot, PLAN_DIRECTORY);
  assertPhysicalDirectory(plans, 'SETUP_REQUIRED');
  return path.join(plans, `${workId}.json`);
};

const planDigest = (plan) => `sha256:${sha256(canonicalJson(plan))}`;
const digestJson = (value) => `sha256:${sha256(canonicalJson(value))}`;

const readPlanCheckpoint = (storeRoot, workId) => {
  const file = planCheckpointPath(storeRoot, workId);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail('STATE_CORRUPT');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) fail('STATE_CORRUPT');
  physicalPath(storeRoot, file, 'STATE_CORRUPT');
  let content;
  try {
    content = readPhysicalFile(
      file,
      MAX_STDIN_BYTES,
      'STATE_CORRUPT',
      { privateFile: true, physicalRoot: storeRoot },
    );
  } catch (error) {
    if (error && error.name === 'ReviewGateRuntimeError') throw error;
    fail('STATE_CORRUPT');
  }
  const checkpoint = parseJson(content.toString('utf8'), 'STATE_CORRUPT');
  if (!isRecord(checkpoint)
    || checkpoint.schema !== PLAN_CHECKPOINT_SCHEMA
    || checkpoint.workId !== workId
    || !SAFE_ID.test(checkpoint.planId)
    || !SAFE_ID.test(checkpoint.waveId)
    || !SAFE_ID.test(checkpoint.decisionId)
    || !Number.isSafeInteger(checkpoint.revision)
    || checkpoint.revision < 1
    || !/^sha256:[a-f0-9]{64}$/.test(checkpoint.chainDigest || '')
    || !/^sha256:[a-f0-9]{64}$/.test(checkpoint.planDigest || '')
    || typeof checkpoint.recordedAt !== 'string'
    || !Number.isFinite(Date.parse(checkpoint.recordedAt))) {
    fail('STATE_CORRUPT');
  }
  return checkpoint;
};

const writePlanCheckpoint = (storeRoot, plan, projection, event) => {
  const file = planCheckpointPath(storeRoot, plan.workId);
  const checkpoint = {
    schema: PLAN_CHECKPOINT_SCHEMA,
    workId: plan.workId,
    waveId: plan.waveId,
    planId: plan.planId,
    decisionId: plan.decisionId,
    revision: projection.revision,
    chainDigest: projection.chainDigest,
    planDigest: planDigest(plan),
    recordedAt: event.recordedAt,
  };
  if (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1
    || !/^sha256:[a-f0-9]{64}$/.test(checkpoint.chainDigest || '')) fail('STATE_CORRUPT');
  const created = writePrivateImmutable(file, checkpoint, 'STATE_WRITE_FAILED', storeRoot);
  if (!created) {
    const existing = readPlanCheckpoint(storeRoot, plan.workId);
    if (canonicalJson(existing) !== canonicalJson(checkpoint)) fail('STATE_CONFLICT');
  }
  return checkpoint;
};

const registeredPlanFromHistory = (history, checkpoint) => {
  const events = history.events.filter((event) => (
    event.eventType === PLAN_REGISTERED
      && event.workId === checkpoint.workId
      && event.waveId === checkpoint.waveId
  ));
  if (events.length === 0) fail('STATE_CORRUPT');
  const plan = events[events.length - 1].payload && events[events.length - 1].payload.plan;
  if (!isRecord(plan) || planDigest(plan) !== checkpoint.planDigest) fail('STATE_CORRUPT');
  for (const field of ['planId', 'decisionId', 'waveId']) {
    if (plan[field] !== checkpoint[field]) fail('STATE_CORRUPT');
  }
  return plan;
};

const reviewRequestFor = (plan, history, obligation) => {
  const priorReceipt = [...history.receipts].reverse().find((receipt) => (
    receipt.kind === 'review'
      && receipt.workId === plan.workId
      && receipt.waveId === plan.waveId
      && receipt.obligationId === obligation.obligationId
      && receipt.lane === obligation.lane
      && receipt.payload
      && isRecord(receipt.payload.request)
  ));
  if (priorReceipt) return clone(priorReceipt.payload.request);
  try {
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
      contractVersion: plan.contractVersion,
    });
  } catch (_) {
    fail('STATE_CORRUPT');
  }
};

const observationMatches = (observation, plan, obligation, identity) => (
  isRecord(observation)
    && observation.workId === plan.workId
    && observation.waveId === plan.waveId
    && observation.obligationId === obligation.obligationId
    && observation.lane === obligation.lane
    && IDENTITY_FIELDS.every((field) => observation[field] === identity[field])
);

const observeResultFromObservation = (observation, state, revision, chainDigest) => ({
  schema: SCHEMA,
  command: 'observe',
  status: 'OBSERVED',
  phase: state.config.phase,
  workId: observation.workId,
  waveId: observation.waveId,
  decisionId: observation.decisionId,
  planId: observation.planId,
  obligationId: observation.obligationId,
  lane: observation.lane,
  comparison: observation.comparison,
  effect: observation.effect,
  authority: observation.authority,
  telemetryStatus: observation.acceptedOutcomeCost.telemetryStatus,
  retirementEligible: false,
  clearsSentinel: false,
  revision,
  chainDigest,
  eventId: observation.eventId,
  receiptId: observation.receiptId,
  diagnostics: observation.reasonCodes || [],
});

const reviewProjectionFromHistory = ({ history, state, workId, waveId, now }) => {
  const snapshotStore = {
    append: () => fail('STATUS_UNAVAILABLE'),
    inspect: () => history,
    replay: () => history,
  };
  const reviewGate = new ReviewGate({
    receiptStore: createReviewGateStoreView(snapshotStore),
    trustPolicy: state.config.trustPolicy,
    now,
  });
  return reviewGate.inspect({
    workId,
    waveId,
    expectedRevision: history.revision,
    expectedChainDigest: history.chainDigest,
  });
};

module.exports = {
  createPlanRegisteredEvent,
  createReviewGateFacade,
  createStoreAndGate,
  currentStoreHistory,
  digestJson,
  observationMatches,
  observeResultFromObservation,
  planDigest,
  readPlanCheckpoint,
  registeredPlanFromHistory,
  reviewHistory,
  reviewProjectionFromHistory,
  reviewRequestFor,
  writePlanCheckpoint,
};
