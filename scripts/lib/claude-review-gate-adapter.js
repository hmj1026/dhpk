'use strict';

const {
  canonicalJson,
  cloneBoundedJson,
  immutableJson,
  FINGERPRINT,
  SAFE_ID,
  sha256,
} = require('./receipt-primitives');
const {
  REVIEWER_CONTRACT_VERSION,
} = require('./reviewer-contract');
const {
  STORE_EVENT_SCHEMA,
} = require('./review-gate-receipt-store');
const {
  REVIEW_RESULT_RECORDED,
} = require('./review-gate');
const {
  normalizeBaselineLegacyObservation,
  normalizeLegacyObservation,
} = require('./claude-review-gate-legacy-observation');

const ADAPTER_NAME = 'claude-review-gate';
const OBSERVATION_SCHEMA = 'dhpk.review-gate.migration-observation.v1';
const MIGRATION_POLICY_VERSION = 'dhpk.migration-policy.v1';
const MIGRATION_CONTRACT_VERSION = 'dhpk.review-gate.migration.v1';
const MIGRATION_EVENT_TYPE = 'MIGRATION_OBSERVATION_RECORDED';
const MIGRATION_RECEIPT_KIND = 'migration-observation';
const MAX_EVENTS = 10000;
const MAX_STRING_BYTES = 4096;
const MAX_ID_LENGTH = 128;
const MAX_COMMANDS = 32;
const ADAPTER_JSON_LIMITS = Object.freeze({
  maxNodes: 4096,
  maxDepth: 32,
  maxStringBytes: MAX_STRING_BYTES,
  maxTotalBytes: 1024 * 1024,
  maxKeys: 200,
  maxArrayKeys: MAX_EVENTS + 1,
  maxKeyBytes: 4096,
  maxArrayLength: MAX_EVENTS,
});
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMAND_DIGEST = /^digest:sha256:[a-f0-9]{64}$/;
const COMMAND_OUTCOMES = new Set([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'BLOCKED',
  'UNAVAILABLE',
]);
const IDENTITY_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'attempt',
  'sessionId',
  'dispatchId',
  'scopeId',
  'diffId',
]);
const REVIEW_VERDICTS = new Set(['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);
const PHASES = new Set(['BASELINE', 'OBSERVE', 'DUAL_ENFORCE', 'CUTOVER']);
const LIFECYCLE_STATES = new Set([
  'planned',
  'dispatched',
  'started',
  'artifact-ready',
  'verdicted',
  'failed-start',
  'quota-blocked',
  'blocked',
  'incomplete',
  'retrying',
]);
const LIFECYCLE_VERDICTS = new Set([
  'PASS',
  'APPROVE',
  'CHANGES_REQUIRED',
  'BLOCKED',
  'BLOCK',
  'FAIL',
  'WARNING',
]);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

class ClaudeReviewGateAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ClaudeReviewGateAdapterError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new ClaudeReviewGateAdapterError(code);
};

const clone = (value) => cloneBoundedJson(value, {
  limits: ADAPTER_JSON_LIMITS,
  undefinedPolicy: 'allow',
  onReject: () => fail('BOUNDED_INPUT'),
});

const immutable = (value) => immutableJson(value, {
  limits: ADAPTER_JSON_LIMITS,
  undefinedPolicy: 'allow',
  onReject: () => fail('BOUNDED_INPUT'),
});

const assertBoundedInput = (value) => clone(value);

const assertRecord = (value, code = 'MALFORMED_INPUT') => {
  if (!isRecord(value)) fail(code);
};

const assertText = (value, { code = 'MALFORMED_INPUT', safe = false } = {}) => {
  if (typeof value !== 'string' || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES
    || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(code);
  }
  if (safe && (!SAFE_ID.test(value) || value.length > MAX_ID_LENGTH)) fail(code);
  return value;
};

const safeId = (value, code = 'MALFORMED_INPUT') => assertText(value, { code, safe: true });

const assertAttempt = (value, code = 'MALFORMED_INPUT') => {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
};

const assertExpectedRevision = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) fail('MALFORMED_INPUT');
  return value;
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

const normalizeDigest = (value, code = 'MALFORMED_INPUT') => {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) fail(code);
  return `sha256:${value.replace(/^sha256:/i, '').toLowerCase()}`;
};

const readAlias = (record, aliases) => {
  for (const alias of aliases) {
    if (hasOwn(record, alias)) return record[alias];
  }
  return undefined;
};

const assertIdentity = (value, code = 'MALFORMED_IDENTITY') => {
  assertRecord(value, code);
  safeId(value.taskId, code);
  safeId(value.attemptId, code);
  assertAttempt(value.attempt, code);
  safeId(value.sessionId, code);
  safeId(value.dispatchId, code);
  safeId(value.scopeId, code);
  safeId(value.diffId, code);
  return {
    taskId: value.taskId,
    attemptId: value.attemptId,
    attempt: value.attempt,
    sessionId: value.sessionId,
    dispatchId: value.dispatchId,
    scopeId: value.scopeId,
    diffId: value.diffId,
  };
};

const eventIdentity = (event) => {
  assertRecord(event, 'MALFORMED_LIFECYCLE');
  return {
    taskId: readAlias(event, ['task_id', 'taskId']),
    attemptId: readAlias(event, ['attempt_id', 'attemptId']),
    attempt: readAlias(event, ['attempt', 'dispatch_attempt']),
    sessionId: readAlias(event, ['session_id', 'sessionId']),
    dispatchId: readAlias(event, ['wave', 'dispatch_id', 'dispatchId']),
    scopeId: readAlias(event, ['scope_id', 'scopeId']),
    diffId: readAlias(event, ['diff_id', 'diffId']),
  };
};

const assertSameIdentity = (expected, actual) => {
  for (const field of IDENTITY_FIELDS) {
    if (field === 'attempt') {
      assertAttempt(actual[field], 'FOREIGN_IDENTITY');
    } else {
      safeId(actual[field], 'FOREIGN_IDENTITY');
    }
    if (actual[field] !== expected[field]) fail('FOREIGN_IDENTITY');
  }
};

const validateEvidenceEvents = (events, identity, { readiness = false } = {}) => {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) fail('BOUNDED_INPUT');
  let readyDigest = null;
  let terminalVerdict = false;
  for (const event of events) {
    assertRecord(event, readiness ? 'MALFORMED_READINESS' : 'MALFORMED_LIFECYCLE');
    if (event.schema_version !== 1) fail(readiness ? 'MALFORMED_READINESS' : 'MALFORMED_LIFECYCLE');
    if (readiness) {
      if (event.state !== 'artifact-ready') fail('MALFORMED_READINESS');
      if (!hasOwn(event, 'artifact_sha256')) fail('MISSING_READINESS');
    } else {
      if (event.event_type !== 'review-lifecycle') fail('MALFORMED_LIFECYCLE');
      if (!LIFECYCLE_STATES.has(event.state)) fail('MALFORMED_LIFECYCLE');
      if (event.state === 'verdicted') {
        if (!LIFECYCLE_VERDICTS.has(event.verdict)) fail('MALFORMED_LIFECYCLE');
        terminalVerdict = true;
      }
    }
    const eventIds = eventIdentity(event);
    assertSameIdentity(identity, eventIds);
    if (readiness) {
      const digest = normalizeDigest(event.artifact_sha256, 'MALFORMED_READINESS');
      if (readyDigest && readyDigest !== digest) fail('MIXED_READINESS');
      readyDigest = digest;
    }
  }
  if (readiness && !readyDigest) fail('MISSING_READINESS');
  if (!readiness && !terminalVerdict) fail('MISSING_VERDICT');
  return readiness ? readyDigest : terminalVerdict;
};

const normalizeScope = (plan) => {
  assertRecord(plan, 'MALFORMED_PLAN');
  assertRecord(plan.scope, 'MALFORMED_PLAN');
  if (!Array.isArray(plan.scope.paths) || plan.scope.paths.length === 0
    || plan.scope.paths.length > 200) fail('MALFORMED_PLAN');
  const paths = plan.scope.paths.map((value) => assertText(value, { code: 'MALFORMED_PLAN' }));
  const digest = normalizeDigest(plan.scope.digest, 'MALFORMED_PLAN');
  return { paths, digest };
};

const normalizeDiff = (plan) => {
  assertRecord(plan.diff, 'MALFORMED_PLAN');
  const digest = normalizeDigest(plan.diff.digest, 'MALFORMED_PLAN');
  const reference = assertText(plan.diff.reference, { code: 'MALFORMED_PLAN' });
  return { digest, reference };
};

function selectObligation(plan, reviewResult) {
  if (reviewResult === undefined) {
    if (plan.obligations.length !== 1) fail('MALFORMED_REVIEW');
    return plan.obligations[0];
  }
  assertRecord(reviewResult, 'MALFORMED_REVIEW');
  const obligation = plan.obligations.find((candidate) => isRecord(candidate)
    && candidate.obligationId === reviewResult.obligationId
    && candidate.lane === reviewResult.lane);
  if (!obligation) fail('MALFORMED_REVIEW');
  return obligation;
}

function evidenceCollection(input, field, code) {
  if (!hasOwn(input, field)) return [];
  if (!Array.isArray(input[field])) fail(code);
  return input[field];
}

const normalizeStatus = (value) => {
  if (typeof value !== 'string' || value.length > 128 || !SAFE_CODE.test(value)) return null;
  return value;
};

const canonicalVerdict = (value) => {
  if (value === 'APPROVE' || value === 'PASS') return 'PASS';
  if (value === 'WARNING' || value === 'BLOCK' || value === 'FAIL') return 'CHANGES_REQUIRED';
  return REVIEW_VERDICTS.has(value) ? value : null;
};

const normalizeReasons = (value) => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map(normalizeStatus).filter(Boolean);
};

const normalizeGate = (gateResult, eventId = null) => {
  const decision = gateResult && isRecord(gateResult.decision) ? gateResult.decision : {};
  const semanticVerdict = canonicalVerdict(decision.semanticVerdict || gateResult && gateResult.semanticVerdict);
  const result = {
    status: semanticVerdict || 'NOT_RUN',
    accepted: gateResult ? gateResult.accepted === true : false,
    allowsProgress: decision.allowsProgress === true,
    lifecycleStatus: normalizeStatus(decision.lifecycleStatus) || 'UNKNOWN',
    executionStatus: normalizeStatus(decision.executionStatus) || 'UNKNOWN',
    applicability: normalizeStatus(decision.applicability) || 'UNKNOWN',
    blockingReasons: normalizeReasons(decision.blockingReasons),
  };
  if (eventId !== null) result.eventId = eventId;
  if (semanticVerdict) result.semanticVerdict = semanticVerdict;
  return result;
};

const normalizeCommands = (commands) => {
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > MAX_COMMANDS) {
    fail('MALFORMED_COMMANDS');
  }
  return commands.map((command) => {
    assertRecord(command, 'MALFORMED_COMMANDS');
    assertText(command.command, { code: 'MALFORMED_COMMANDS' });
    if (!COMMAND_OUTCOMES.has(command.outcome)) fail('MALFORMED_COMMANDS');
    const result = {
      command: COMMAND_DIGEST.test(command.command)
        ? command.command
        : `digest:sha256:${sha256(command.command)}`,
      outcome: command.outcome,
    };
    for (const field of ['durationMs', 'exitCode']) {
      if (command[field] === undefined) continue;
      if (!Number.isSafeInteger(command[field]) || command[field] < 0) fail('MALFORMED_COMMANDS');
      result[field] = command[field];
    }
    return result;
  });
};

const comparisonFor = (sentinel, gate) => {
  const sentinelVerdict = canonicalVerdict(sentinel.verdict || sentinel.outcome || sentinel.status);
  const gateVerdict = canonicalVerdict(gate.semanticVerdict);
  if (!sentinelVerdict || !gateVerdict) return 'INDETERMINATE';
  return sentinelVerdict === gateVerdict ? 'AGREE' : 'DISAGREE';
};

const dualAllowsProgress = (context, gate, comparison) => (
  context.input.phase === 'DUAL_ENFORCE'
  && comparison === 'AGREE'
  && canonicalVerdict(context.sentinel.verdict || context.sentinel.outcome || context.sentinel.status) === 'PASS'
  && ['PASS', 'CLEARED'].includes(context.sentinel.status)
  && gate.accepted === true
  && gate.allowsProgress === true
  && gate.lifecycleStatus === 'RESOLVED'
  && gate.executionStatus === 'COMPLETE'
  && gate.applicability === 'REQUIRED'
  && gate.semanticVerdict === 'PASS'
  && gate.blockingReasons.length === 0
);

const cutoverAllowsProgress = (context, gate, comparison) => (
  context.input.phase === 'CUTOVER'
  && comparison !== 'DISAGREE'
  && gate.accepted === true
  && gate.allowsProgress === true
  && gate.lifecycleStatus === 'RESOLVED'
  && gate.executionStatus === 'COMPLETE'
  && gate.applicability === 'REQUIRED'
  && gate.semanticVerdict === 'PASS'
  && gate.blockingReasons.length === 0
);

const identityDigest = (
  identity,
  phase,
  adapter,
  version,
  lifecycleEvents,
  readinessEvents,
  gate,
  sentinel,
  acceptedOutcomeCost,
) => {
  const compact = {
    identity,
    phase,
    adapter,
    version,
    lifecycleEventIds: lifecycleEvents.map((event) => normalizeStatus(readAlias(event, ['event_id', 'eventId'])) || 'unknown'),
    readinessEventIds: readinessEvents.map((event) => normalizeStatus(readAlias(event, ['event_id', 'eventId'])) || 'unknown'),
    gate: {
      accepted: gate.accepted,
      semanticVerdict: gate.semanticVerdict || null,
      lifecycleStatus: gate.lifecycleStatus,
    },
    sentinel: {
      status: sentinel.status || null,
      verdict: sentinel.verdict || null,
      outcome: sentinel.outcome || null,
      lifecycleEventId: sentinel.lifecycleEventId || null,
    },
    acceptedOutcomeCost: {
      observationId: acceptedOutcomeCost.observationId,
      acceptedOutcome: acceptedOutcomeCost.acceptedOutcome,
      metrics: acceptedOutcomeCost.metrics,
      telemetryStatus: acceptedOutcomeCost.telemetryStatus,
      telemetryFailureCount: acceptedOutcomeCost.telemetryFailureCount,
    },
  };
  return `sha256:${sha256(canonicalJson(compact))}`;
};

const boundedEventIds = (events) => events
  .slice(0, 200)
  .map((event) => normalizeStatus(readAlias(event, ['event_id', 'eventId'])))
  .filter(Boolean);

const readinessArtifactDigest = (events) => {
  let digest = null;
  for (const event of events) {
    const candidate = normalizeDigest(event.artifact_sha256, 'MALFORMED_READINESS');
    if (digest && digest !== candidate) fail('MIXED_READINESS');
    digest = candidate;
  }
  return digest;
};

const requireArtifactEvidence = (reviewResult, artifactDigest) => {
  assertRecord(reviewResult, 'MALFORMED_REVIEW');
  if (!Array.isArray(reviewResult.evidenceReferences) || reviewResult.evidenceReferences.length === 0) {
    fail('MISSING_ARTIFACT_EVIDENCE');
  }
  const expected = artifactDigest.replace(/^sha256:/, '').toLowerCase();
  const matches = reviewResult.evidenceReferences.some((reference) => (
    typeof reference === 'string'
    && /^artifact-sha256:[a-f0-9]{64}$/i.test(reference)
    && reference.slice('artifact-sha256:'.length).toLowerCase() === expected
  ));
  if (!matches) fail('MISSING_ARTIFACT_EVIDENCE');
};

const makeEventId = (observation, producer, adapter) => (
  `migration-observation-${sha256(canonicalJson({
    phase: observation.phase,
    workId: observation.workId,
    planId: observation.planId,
    waveId: observation.waveId,
    taskId: observation.taskId,
    attemptId: observation.attemptId,
    sessionId: observation.sessionId,
    dispatchId: observation.dispatchId,
    obligationId: observation.obligationId,
    lane: observation.lane,
    comparison: observation.comparison,
    producer,
    adapter,
  }))}`
);

function normalizeObservationContext(rawInput) {
  assertRecord(rawInput, 'MALFORMED_INPUT');
  const input = assertBoundedInput(rawInput);
  if (!PHASES.has(input.phase)) fail('UNSUPPORTED_PHASE');
  const identity = assertIdentity(input.identity);
  const plan = input.plan;
  assertRecord(plan, 'MALFORMED_PLAN');
  for (const field of ['workId', 'decisionId', 'planId', 'waveId']) safeId(plan[field], 'MALFORMED_PLAN');
  const scope = normalizeScope(plan);
  const diff = normalizeDiff(plan);
  if (!Array.isArray(plan.obligations) || plan.obligations.length === 0) fail('MALFORMED_PLAN');
  const obligation = selectObligation(plan, input.reviewResult);
  assertRecord(obligation, 'MALFORMED_PLAN');
  safeId(obligation.obligationId, 'MALFORMED_PLAN');
  safeId(obligation.lane, 'MALFORMED_PLAN');
  const lifecycleEvents = evidenceCollection(input, 'lifecycleEvents', 'MALFORMED_LIFECYCLE');
  const readinessEvents = evidenceCollection(input, 'readinessEvents', 'MALFORMED_READINESS');
  const legacyBaseline = input.phase === 'BASELINE'
    && lifecycleEvents.length === 0 && readinessEvents.length === 0;
  if (legacyBaseline && input.acceptedOutcomeCost !== undefined) fail('MALFORMED_INPUT');
  if (!legacyBaseline) {
    if (lifecycleEvents.length === 0) fail('MISSING_LIFECYCLE');
    validateEvidenceEvents(lifecycleEvents, identity);
    validateEvidenceEvents(readinessEvents, identity, { readiness: true });
  }
  const artifactDigest = legacyBaseline ? null : readinessArtifactDigest(readinessEvents);
  const legacyObservation = legacyBaseline
    ? normalizeBaselineLegacyObservation({
      identity,
      lifecycleEvents,
      sentinelOutcome: input.sentinelOutcome,
    })
    : normalizeLegacyObservation({
      identity,
      lifecycleEvents,
      sentinelOutcome: input.sentinelOutcome,
      acceptedOutcomeCost: input.acceptedOutcomeCost,
    });
  return {
    input,
    identity,
    plan,
    scope,
    diff,
    obligation,
    lifecycleEvents,
    readinessEvents,
    artifactDigest,
    sentinel: legacyObservation.sentinelOutcome,
    acceptedOutcomeCost: legacyObservation.acceptedOutcomeCost,
    lifecycleEventId: legacyObservation.lifecycleEventId,
    costObservationId: legacyObservation.costObservationId,
    legacyCost: legacyObservation.legacyCost,
  };
}

function buildReviewGateEvent(adapter, context, executedCommands) {
  const { input, plan, identity, obligation } = context;
  return {
    schema: STORE_EVENT_SCHEMA,
    eventId: makeEventId({
      phase: input.phase,
      workId: plan.workId,
      planId: plan.planId,
      waveId: plan.waveId,
      taskId: identity.taskId,
      attemptId: identity.attemptId,
      sessionId: identity.sessionId,
      dispatchId: identity.dispatchId,
      obligationId: obligation.obligationId,
      lane: obligation.lane,
      comparison: 'pending',
    }, adapter.producer, adapter.adapter),
    eventType: REVIEW_RESULT_RECORDED,
    effect: ['DUAL_ENFORCE', 'CUTOVER'].includes(input.phase) ? 'ENFORCE' : 'OBSERVE_ONLY',
    workId: plan.workId,
    waveId: plan.waveId,
    planId: plan.planId,
    decisionId: plan.decisionId,
    obligationId: input.reviewResult.obligationId,
    lane: input.reviewResult.lane,
    producer: adapter.producer,
    adapter: adapter.adapter,
    sessionId: identity.sessionId,
    sourceCommit: plan.headIdentity && plan.headIdentity.commit,
    sourceTree: plan.headIdentity && plan.headIdentity.tree,
    policyVersion: plan.policyVersion,
    contractVersion: plan.contractVersion || REVIEWER_CONTRACT_VERSION,
    recordedAt: normalizeTimestamp(adapter.now),
    payload: { request: input.reviewRequest, result: input.reviewResult, executedCommands },
  };
}

function invokeReviewGate(adapter, context, event) {
  const { input } = context;
  let gateResult;
  try {
    gateResult = adapter.reviewGate.handle({
      expectedRevision: input.expectedRevision === undefined ? 0 : assertExpectedRevision(input.expectedRevision),
      expectedChainDigest: input.expectedChainDigest === undefined ? null : input.expectedChainDigest,
      event,
    });
  } catch (_) {
    fail('REVIEW_GATE_FAILED');
  }
  return gateResult;
}

function recordReviewGateObservation(adapter, context) {
  if (!['OBSERVE', 'DUAL_ENFORCE', 'CUTOVER'].includes(context.input.phase)) {
    return { gateResult: null, gate: normalizeGate(null) };
  }
  const { input, artifactDigest } = context;
  assertRecord(input.reviewRequest, 'MALFORMED_REVIEW');
  assertRecord(input.reviewResult, 'MALFORMED_REVIEW');
  requireArtifactEvidence(input.reviewResult, artifactDigest);
  const event = buildReviewGateEvent(adapter, context, normalizeCommands(input.executedCommands));
  try {
    const gateResult = invokeReviewGate(adapter, context, event);
    return { gateResult, gate: normalizeGate(gateResult, event.eventId), reasonCodes: [] };
  } catch (error) {
    // Enforcement phases must leave a durable, fail-closed diagnostic when
    // the authority cannot produce a trusted result. OBSERVE retains its
    // historical rejection behavior.
    if (!['DUAL_ENFORCE', 'CUTOVER'].includes(context.input.phase)) throw error;
    return {
      gateResult: null,
      gate: normalizeGate(null, event.eventId),
      reasonCodes: [error && SAFE_CODE.test(error.code) ? error.code : 'REVIEW_GATE_FAILED'],
    };
  }
}

function buildObservationProvenance(adapter, context, gate, eventId, recordedAt) {
  const provenance = {
    digest: identityDigest(
      context.identity,
      context.input.phase,
      adapter.adapter,
      adapter.adapterVersion,
      context.lifecycleEvents,
      context.readinessEvents,
      gate,
      context.sentinel,
      context.acceptedOutcomeCost,
    ),
    reference: `adapter:${ADAPTER_NAME}`,
    producer: adapter.producer,
    adapter: adapter.adapter,
    adapterVersion: adapter.adapterVersion,
    eventId,
    receiptId: `${eventId}:receipt`,
    policyVersion: MIGRATION_POLICY_VERSION,
    contractVersion: MIGRATION_CONTRACT_VERSION,
    sourceCommit: context.plan.headIdentity && context.plan.headIdentity.commit,
    sourceTree: context.plan.headIdentity && context.plan.headIdentity.tree,
    recordedAt,
    lifecycleEventIds: boundedEventIds(context.lifecycleEvents),
    readinessEventIds: boundedEventIds(context.readinessEvents),
    costObservationId: context.costObservationId,
  };
  if (context.lifecycleEventId) provenance.lifecycleEventId = context.lifecycleEventId;
  if (context.artifactDigest) provenance.artifactDigest = context.artifactDigest;
  return provenance;
}

function observationHeader(context, comparison) {
  const { input } = context;
  return {
    schema: OBSERVATION_SCHEMA,
    phase: input.phase,
    comparison,
    authority: input.phase === 'DUAL_ENFORCE'
      ? 'SENTINEL_AND_REVIEW_GATE' : input.phase === 'CUTOVER' ? 'REVIEW_GATE' : 'SENTINEL',
    effect: input.phase === 'BASELINE'
      ? 'DISABLED' : ['DUAL_ENFORCE', 'CUTOVER'].includes(input.phase) ? 'ENFORCE' : 'OBSERVE_ONLY',
    automaticPromotion: false,
    retirementEligible: false,
  };
}

function observationMetadata(adapter, context, eventId, recordedAt) {
  const { input, plan } = context;
  return {
    producer: adapter.producer,
    adapter: adapter.adapter,
    adapterVersion: adapter.adapterVersion,
    policyVersion: MIGRATION_POLICY_VERSION,
    contractVersion: MIGRATION_CONTRACT_VERSION,
    sourceCommit: plan.headIdentity && plan.headIdentity.commit,
    sourceTree: plan.headIdentity && plan.headIdentity.tree,
    recordedAt,
    eventId,
    receiptId: `${eventId}:receipt`,
  };
}

function observationIdentity(context) {
  const { plan, identity, obligation } = context;
  return {
    workId: plan.workId,
    decisionId: plan.decisionId,
    planId: plan.planId,
    waveId: plan.waveId,
    obligationId: obligation.obligationId,
    lane: obligation.lane,
    taskId: identity.taskId,
    attemptId: identity.attemptId,
    attempt: identity.attempt,
    sessionId: identity.sessionId,
    dispatchId: identity.dispatchId,
    scopeId: identity.scopeId,
    diffId: identity.diffId,
    identity,
  };
}

function observationEvidence(context, gate) {
  const { scope, diff, sentinel, acceptedOutcomeCost } = context;
  const evidence = {
    scope,
    diff,
    sentinelStatus: normalizeStatus(sentinel.status || sentinel.outcome || sentinel.verdict)
      || canonicalVerdict(sentinel.verdict || sentinel.outcome || sentinel.status)
      || 'UNKNOWN',
    reviewGateStatus: gate.status || 'NOT_RUN',
    sentinelOutcome: sentinel,
    reviewGate: gate,
    acceptedOutcomeCost,
  };
  if (context.legacyCost) evidence.cost = context.legacyCost;
  return evidence;
}

function buildMigrationObservation(adapter, context, gate, comparison, provenance, eventId, recordedAt, reasonCodes = []) {
  return immutable({
    ...observationHeader(context, comparison),
    ...observationMetadata(adapter, context, eventId, recordedAt),
    ...observationIdentity(context),
    ...observationEvidence(context, gate),
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    allowsTargetProgress: context.input.phase === 'CUTOVER'
      ? cutoverAllowsProgress(context, gate, comparison)
      : dualAllowsProgress(context, gate, comparison),
    ...(reasonCodes.length > 0 ? { reasonCodes: [...new Set(reasonCodes)] } : {}),
    liveness: 'COMPATIBILITY_ONLY',
    processLivenessRole: 'COMPATIBILITY_ONLY',
    provenance,
  });
}

function persistMigrationObservation(adapter, context, observation, gateResult) {
  const { input } = context;
  const expectedRevision = input.expectedRevision === undefined ? 0 : assertExpectedRevision(input.expectedRevision);
  const expectedChainDigest = input.expectedChainDigest === undefined ? null : input.expectedChainDigest;
  const coordinatorRevision = ['OBSERVE', 'DUAL_ENFORCE', 'CUTOVER'].includes(input.phase)
    && gateResult && Number.isSafeInteger(gateResult.revision) && gateResult.revision >= 0
    ? gateResult.revision : expectedRevision;
  const coordinatorChainDigest = ['OBSERVE', 'DUAL_ENFORCE', 'CUTOVER'].includes(input.phase)
    && gateResult && typeof gateResult.chainDigest === 'string'
    ? gateResult.chainDigest : expectedChainDigest;
  let recording;
  try {
    recording = adapter.migrationCoordinator.record({
      expectedRevision: coordinatorRevision,
      expectedChainDigest: coordinatorChainDigest,
      observation,
    });
  } catch (_) {
    fail('RECORDING_FAILED');
  }
  return isRecord(recording)
    ? { ...recording, observation, reviewGate: gateResult }
    : { status: 'RECORDED', observation, reviewGate: gateResult };
}

class ClaudeReviewGateAdapter {
  constructor({
    reviewGate,
    migrationCoordinator,
    producer = 'claude-migration',
    adapter = 'review-gate-adapter',
    adapterVersion = 'claude-review-gate.v1',
    now = () => Date.now(),
  } = {}) {
    if (!reviewGate || typeof reviewGate.handle !== 'function') fail('CONFIGURATION');
    if (!migrationCoordinator || typeof migrationCoordinator.record !== 'function') fail('CONFIGURATION');
    if (typeof now !== 'function') fail('CONFIGURATION');
    safeId(producer, 'CONFIGURATION');
    safeId(adapter, 'CONFIGURATION');
    assertText(adapterVersion, { code: 'CONFIGURATION' });
    this.reviewGate = reviewGate;
    this.migrationCoordinator = migrationCoordinator;
    this.producer = producer;
    this.adapter = adapter;
    this.adapterVersion = adapterVersion;
    this.now = now;
    this._capabilities = immutable({
      adapter: ADAPTER_NAME,
      version: adapterVersion,
      storeEventSchema: STORE_EVENT_SCHEMA,
      migrationObservationReceiptKind: MIGRATION_RECEIPT_KIND,
      reviewerContractVersion: REVIEWER_CONTRACT_VERSION,
      phases: ['BASELINE', 'OBSERVE', 'DUAL_ENFORCE', 'CUTOVER'],
      authority: 'SENTINEL',
      authorities: {
        BASELINE: 'SENTINEL',
        OBSERVE: 'SENTINEL',
        DUAL_ENFORCE: 'SENTINEL_AND_REVIEW_GATE',
        CUTOVER: 'REVIEW_GATE',
      },
      effects: {
        BASELINE: 'DISABLED', OBSERVE: 'OBSERVE_ONLY', DUAL_ENFORCE: 'ENFORCE', CUTOVER: 'ENFORCE',
      },
      explicitInvocationOnly: true,
      processLivenessRole: 'COMPATIBILITY_ONLY',
    });
  }

  capabilities() {
    return this._capabilities;
  }

  observe(input = {}) {
    const context = normalizeObservationContext(input);
    const { gateResult, gate, reasonCodes } = recordReviewGateObservation(this, context);
    const comparison = context.input.phase === 'BASELINE' ? 'INDETERMINATE' : comparisonFor(context.sentinel, gate);
    const eventId = makeEventId({
      phase: context.input.phase,
      workId: context.plan.workId,
      planId: context.plan.planId,
      waveId: context.plan.waveId,
      taskId: context.identity.taskId,
      attemptId: context.identity.attemptId,
      sessionId: context.identity.sessionId,
      dispatchId: context.identity.dispatchId,
      obligationId: context.obligation.obligationId,
      lane: context.obligation.lane,
      comparison,
    }, this.producer, this.adapter);
    const recordedAt = normalizeTimestamp(this.now);
    const provenance = buildObservationProvenance(this, context, gate, eventId, recordedAt);
    const diagnosticReasons = (
      (context.input.phase === 'DUAL_ENFORCE' && comparison !== 'AGREE')
      || (context.input.phase === 'CUTOVER' && comparison === 'DISAGREE')
    ) ? [...reasonCodes, 'DUAL_ENFORCEMENT_DISAGREEMENT'] : reasonCodes;
    const observation = buildMigrationObservation(
      this,
      context,
      gate,
      comparison,
      provenance,
      eventId,
      recordedAt,
      diagnosticReasons,
    );
    return persistMigrationObservation(this, context, observation, gateResult);
  }
}

module.exports = {
  ADAPTER_NAME,
  OBSERVATION_SCHEMA,
  MIGRATION_POLICY_VERSION,
  MIGRATION_CONTRACT_VERSION,
  MIGRATION_EVENT_TYPE,
  MIGRATION_RECEIPT_KIND,
  ClaudeReviewGateAdapter,
  ClaudeReviewGateAdapterError,
};
