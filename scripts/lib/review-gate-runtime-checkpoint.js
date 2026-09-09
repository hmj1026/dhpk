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

const createReviewGateStoreView = (store) => ({
  append: (input) => store.append(input),
  replay: (input) => store.replay(input),
  inspect: (input) => store.inspect(input),
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

const unresolvedFindings = (findings) => (
  Array.isArray(findings)
    ? findings.filter((finding) => isRecord(finding) && finding.disposition === 'MUST_FIX')
    : []
);

const accumulatedFindingsFor = (history, lane) => {
  const findings = new Map();
  for (const event of history.events) {
    if (event.eventType !== 'REVIEW_RESULT_RECORDED' || event.lane !== lane) continue;
    const payload = event.payload;
    const result = payload && payload.result;
    if (!isRecord(result)) continue;
    const clearsFindings = result.executionStatus === 'COMPLETE'
      && result.applicability === 'REQUIRED'
      && result.semanticVerdict === 'PASS';
    if (clearsFindings) {
      findings.clear();
      continue;
    }
    for (const finding of unresolvedFindings(result.findings)) {
      findings.set(`${finding.id}:${canonicalJson(finding)}`, finding);
    }
  }
  return [...findings.values()].sort((left, right) => (
    `${left.id}:${canonicalJson(left)}`.localeCompare(`${right.id}:${canonicalJson(right)}`)
  ));
};

const reviewRequestFor = (plan, history, obligation, expectedDigest = null) => {
  const priorEvent = [...history.events].reverse().find((event) => (
    event.eventType === 'REVIEW_RESULT_RECORDED'
      && event.workId === plan.workId
      && event.waveId === plan.waveId
      && event.obligationId === obligation.obligationId
      && event.lane === obligation.lane
      && event.payload
      && isRecord(event.payload.request)
  ));
  if (priorEvent && (expectedDigest === null
    || digestJson(priorEvent.payload.request) === expectedDigest)) {
    return clone(priorEvent.payload.request);
  }
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
      priorFindings: accumulatedFindingsFor(history, obligation.lane),
      contractVersion: plan.contractVersion,
    });
  } catch (_) {
    fail('STATE_CORRUPT');
  }
};

const observeResultFromProjection = (
  projection,
  state,
  revision,
  chainDigest,
  { plan = null, obligation = null, receipt = null } = {},
) => ({
  schema: SCHEMA,
  command: 'observe',
  status: 'OBSERVED',
  workId: projection.workId,
  waveId: projection.waveId,
  ...(plan ? { decisionId: plan.decisionId, planId: plan.planId } : {}),
  ...(obligation ? {
    obligationId: obligation.obligationId,
    lane: obligation.lane,
  } : {}),
  semanticVerdict: projection.semanticVerdict,
  executionStatus: projection.executionStatus,
  applicability: projection.applicability,
  lifecycleStatus: projection.lifecycleStatus,
  resolution: projection.resolution,
  revision,
  chainDigest,
  ...(receipt && receipt.eventId ? { eventId: receipt.eventId } : {}),
  ...(receipt && receipt.receiptId ? { receiptId: receipt.receiptId } : {}),
  ...(receipt && receipt.provenance ? { provenance: clone(receipt.provenance) } : {}),
  diagnostics: projection.condition && projection.condition.reasonCodes
    ? projection.condition.reasonCodes : [],
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
  observeResultFromProjection,
  planDigest,
  readPlanCheckpoint,
  registeredPlanFromHistory,
  reviewProjectionFromHistory,
  reviewRequestFor,
  writePlanCheckpoint,
};
