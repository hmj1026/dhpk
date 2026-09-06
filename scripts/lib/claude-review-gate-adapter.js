'use strict';

const {
  canonicalJson,
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

const ADAPTER_NAME = 'claude-review-gate';
const OBSERVATION_SCHEMA = 'dhpk.review-gate.migration-observation.v1';
const MIGRATION_POLICY_VERSION = 'dhpk.migration-policy.v1';
const MIGRATION_CONTRACT_VERSION = 'dhpk.review-gate.migration.v1';
const MIGRATION_EVENT_TYPE = 'MIGRATION_OBSERVATION_RECORDED';
const MIGRATION_RECEIPT_KIND = 'migration-observation';
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_EVENTS = 10000;
const MAX_STRING_BYTES = 4096;
const MAX_ID_LENGTH = 128;
const MAX_NODES = 4096;
const MAX_DEPTH = 32;
const MAX_OBJECT_KEYS = 200;
const MAX_KEY_BYTES = 4096;
const MAX_COMMANDS = 32;
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
const COST_FIELDS = Object.freeze([
  'dispatchCount',
  'semanticReviewCount',
  'remediationRounds',
  'humanTurns',
  'elapsedMs',
  'receiptReuse',
  'falseBlocks',
  'unsafeClearance',
  'missedRequiredReview',
  'postMergeEscapes',
]);
const REVIEW_VERDICTS = new Set(['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);
const PHASES = new Set(['BASELINE', 'OBSERVE']);
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

const clone = (value) => {
  const state = {
    nodes: 0,
    bytes: 0,
    seen: new WeakSet(),
    snapshots: new WeakMap(),
  };

  const inspect = (candidate, depth = 0) => {
    state.nodes += 1;
    if (state.nodes > MAX_NODES || depth > MAX_DEPTH) fail('BOUNDED_INPUT');
    if (candidate === null || typeof candidate === 'boolean') return;
    if (candidate === undefined) return;
    if (typeof candidate === 'string') {
      state.bytes += Buffer.byteLength(candidate, 'utf8');
      if (Buffer.byteLength(candidate, 'utf8') > MAX_STRING_BYTES
        || state.bytes > MAX_INPUT_BYTES) fail('BOUNDED_INPUT');
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) fail('BOUNDED_INPUT');
      return;
    }
    if (typeof candidate !== 'object' || typeof candidate === 'function') fail('BOUNDED_INPUT');
    if (state.seen.has(candidate)) fail('BOUNDED_INPUT');
    state.seen.add(candidate);

    const array = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!array && prototype !== Object.prototype && prototype !== null)
      || (array && prototype !== Array.prototype)) fail('BOUNDED_INPUT');
    if (Object.getOwnPropertySymbols(candidate).length > 0) fail('BOUNDED_INPUT');
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if ((!array && keys.length > MAX_OBJECT_KEYS) || (array && keys.length > MAX_EVENTS + 1)) {
      fail('BOUNDED_INPUT');
    }
    for (const key of keys) {
      const keyBytes = Buffer.byteLength(key, 'utf8');
      if (keyBytes > MAX_KEY_BYTES || state.bytes + keyBytes > MAX_INPUT_BYTES) {
        fail('BOUNDED_INPUT');
      }
      state.bytes += keyBytes;
    }

    if (array) {
      if (candidate.length > MAX_EVENTS) fail('BOUNDED_INPUT');
      const expected = ['length', ...Array.from({ length: candidate.length }, (_, index) => String(index))];
      if (keys.length !== expected.length || !expected.every((name) => keys.includes(name))) {
        fail('BOUNDED_INPUT');
      }
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || hasOwn(lengthDescriptor, 'get') || !hasOwn(lengthDescriptor, 'value')) {
        fail('BOUNDED_INPUT');
      }
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('BOUNDED_INPUT');
      }
    } else {
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !hasOwn(descriptor, 'value')) fail('BOUNDED_INPUT');
      }
    }
    state.snapshots.set(candidate, { descriptors, keys, array });
    for (const key of keys) {
      if (key === 'length' && array) continue;
      inspect(descriptors[key].value, depth + 1);
    }
    state.seen.delete(candidate);
  };

  const copy = (candidate) => {
    if (candidate === null || typeof candidate !== 'object') return candidate;
    const snapshot = state.snapshots.get(candidate);
    if (!snapshot) fail('BOUNDED_INPUT');
    const result = snapshot.array ? [] : {};
    for (const key of snapshot.keys) {
      if (key === 'length' && snapshot.array) continue;
      Object.defineProperty(result, key, {
        value: copy(snapshot.descriptors[key].value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  };

  inspect(value);
  let result;
  try {
    result = copy(value);
    const serialized = JSON.stringify(result);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) {
      fail('BOUNDED_INPUT');
    }
  } catch (_) {
    fail('BOUNDED_INPUT');
  }
  return result;
};

const freeze = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};

const immutable = (value) => freeze(clone(value));

const assertBoundedInput = (value) => {
  return clone(value);
};

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

const normalizeCost = (sentinelOutcome) => {
  const source = isRecord(sentinelOutcome.cost) ? sentinelOutcome.cost : {};
  const cost = {};
  for (const field of COST_FIELDS) {
    if (!hasOwn(source, field)) continue;
    if (!Number.isSafeInteger(source[field]) || source[field] < 0) continue;
    cost[field] = source[field];
  }
  return cost;
};

const normalizeStatus = (value) => {
  if (typeof value !== 'string' || value.length > 128 || !SAFE_CODE.test(value)) return null;
  return value;
};

const normalizeSentinel = (value) => {
  assertRecord(value, 'MALFORMED_SENTINEL');
  const result = {};
  for (const field of ['status', 'verdict', 'outcome']) {
    const normalized = normalizeStatus(value[field]);
    if (normalized) result[field] = normalized;
  }
  if (Object.keys(result).length === 0) result.status = 'UNKNOWN';
  result.cost = normalizeCost(value);
  return result;
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

const normalizeGate = (gateResult) => {
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

const identityDigest = (identity, phase, adapter, version, lifecycleEvents, readinessEvents, gate, sentinel) => {
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
    comparison: observation.comparison,
    producer,
    adapter,
  }))}`
);

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
      phases: ['BASELINE', 'OBSERVE'],
      authority: 'SENTINEL',
      effects: { BASELINE: 'DISABLED', OBSERVE: 'OBSERVE_ONLY' },
      explicitInvocationOnly: true,
      processLivenessRole: 'COMPATIBILITY_ONLY',
    });
  }

  capabilities() {
    return this._capabilities;
  }

  observe(input = {}) {
    assertRecord(input, 'MALFORMED_INPUT');
    input = assertBoundedInput(input);
    if (!PHASES.has(input.phase)) fail('UNSUPPORTED_PHASE');

    const identity = assertIdentity(input.identity);
    const plan = input.plan;
    assertRecord(plan, 'MALFORMED_PLAN');
    for (const field of ['workId', 'decisionId', 'planId', 'waveId']) safeId(plan[field], 'MALFORMED_PLAN');
    const scope = normalizeScope(plan);
    const diff = normalizeDiff(plan);
    if (!Array.isArray(plan.obligations) || plan.obligations.length === 0) fail('MALFORMED_PLAN');
    const obligation = plan.obligations.find((candidate) => isRecord(candidate)
      && isRecord(input.reviewResult)
      && candidate.obligationId === input.reviewResult.obligationId)
      || plan.obligations[0];
    assertRecord(obligation, 'MALFORMED_PLAN');
    safeId(obligation.obligationId, 'MALFORMED_PLAN');
    safeId(obligation.lane, 'MALFORMED_PLAN');

    const lifecycleEvents = Array.isArray(input.lifecycleEvents) ? input.lifecycleEvents : [];
    const readinessEvents = Array.isArray(input.readinessEvents) ? input.readinessEvents : [];
    let artifactDigest = null;
    if (input.phase === 'OBSERVE') {
      if (lifecycleEvents.length === 0) fail('MISSING_LIFECYCLE');
      validateEvidenceEvents(lifecycleEvents, identity);
      validateEvidenceEvents(readinessEvents, identity, { readiness: true });
      artifactDigest = readinessArtifactDigest(readinessEvents);
    } else {
      if (lifecycleEvents.length > MAX_EVENTS || readinessEvents.length > MAX_EVENTS) fail('BOUNDED_INPUT');
    }

    const sentinel = normalizeSentinel(input.sentinelOutcome);
    let gateResult = null;
    let gate = normalizeGate(null);
    if (input.phase === 'OBSERVE') {
      assertRecord(input.reviewRequest, 'MALFORMED_REVIEW');
      assertRecord(input.reviewResult, 'MALFORMED_REVIEW');
      requireArtifactEvidence(input.reviewResult, artifactDigest);
      const executedCommands = normalizeCommands(input.executedCommands);
      const event = {
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
          comparison: 'pending',
        }, this.producer, this.adapter),
        eventType: REVIEW_RESULT_RECORDED,
        workId: plan.workId,
        waveId: plan.waveId,
        planId: plan.planId,
        decisionId: plan.decisionId,
        obligationId: input.reviewResult.obligationId,
        lane: input.reviewResult.lane,
        producer: this.producer,
        adapter: this.adapter,
        sessionId: identity.sessionId,
        sourceCommit: plan.headIdentity && plan.headIdentity.commit,
        sourceTree: plan.headIdentity && plan.headIdentity.tree,
        policyVersion: plan.policyVersion,
        contractVersion: plan.contractVersion || REVIEWER_CONTRACT_VERSION,
        recordedAt: normalizeTimestamp(this.now),
        payload: {
          request: input.reviewRequest,
          result: input.reviewResult,
          executedCommands,
        },
      };
      try {
        gateResult = this.reviewGate.handle({
          expectedRevision: input.expectedRevision === undefined ? 0 : assertExpectedRevision(input.expectedRevision),
          expectedChainDigest: input.expectedChainDigest === undefined ? null : input.expectedChainDigest,
          event,
        });
      } catch (_) {
        fail('REVIEW_GATE_FAILED');
      }
      gate = normalizeGate(gateResult);
    }

    const sentinelStatus = normalizeStatus(sentinel.status || sentinel.outcome || sentinel.verdict)
      || canonicalVerdict(sentinel.verdict || sentinel.outcome || sentinel.status)
      || 'UNKNOWN';
    const reviewGateStatus = gate.status || 'NOT_RUN';
    const comparison = input.phase === 'BASELINE' ? 'INDETERMINATE' : comparisonFor(sentinel, gate);
    const recordedAt = normalizeTimestamp(this.now);
    const eventId = makeEventId({
      phase: input.phase,
      workId: plan.workId,
      planId: plan.planId,
      waveId: plan.waveId,
      taskId: identity.taskId,
      attemptId: identity.attemptId,
      sessionId: identity.sessionId,
      dispatchId: identity.dispatchId,
      comparison,
    }, this.producer, this.adapter);
    const provenance = {
      digest: identityDigest(
        identity,
        input.phase,
        this.adapter,
        this.adapterVersion,
        lifecycleEvents,
        readinessEvents,
        gate,
        sentinel,
      ),
      reference: `adapter:${ADAPTER_NAME}`,
      producer: this.producer,
      adapter: this.adapter,
      adapterVersion: this.adapterVersion,
      eventId,
      receiptId: `${eventId}:receipt`,
      policyVersion: MIGRATION_POLICY_VERSION,
      contractVersion: MIGRATION_CONTRACT_VERSION,
      sourceCommit: plan.headIdentity && plan.headIdentity.commit,
      sourceTree: plan.headIdentity && plan.headIdentity.tree,
      recordedAt,
      lifecycleEventIds: boundedEventIds(lifecycleEvents),
      readinessEventIds: boundedEventIds(readinessEvents),
    };
    if (artifactDigest) provenance.artifactDigest = artifactDigest;
    const observation = immutable({
      schema: OBSERVATION_SCHEMA,
      phase: input.phase,
      comparison,
      authority: 'SENTINEL',
      effect: input.phase === 'BASELINE' ? 'DISABLED' : 'OBSERVE_ONLY',
      automaticPromotion: false,
      retirementEligible: false,
      producer: this.producer,
      adapter: this.adapter,
      adapterVersion: this.adapterVersion,
      policyVersion: MIGRATION_POLICY_VERSION,
      contractVersion: MIGRATION_CONTRACT_VERSION,
      sourceCommit: plan.headIdentity && plan.headIdentity.commit,
      sourceTree: plan.headIdentity && plan.headIdentity.tree,
      recordedAt,
      eventId,
      receiptId: `${eventId}:receipt`,
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
      scope,
      diff,
      sentinelStatus,
      reviewGateStatus,
      sentinelOutcome: sentinel,
      reviewGate: gate,
      cost: sentinel.cost,
      authorizesApproval: false,
      clearsSentinel: false,
      blocksSentinel: false,
      allowsTargetProgress: false,
      liveness: 'COMPATIBILITY_ONLY',
      processLivenessRole: 'COMPATIBILITY_ONLY',
      provenance,
    });

    const expectedRevision = input.expectedRevision === undefined
      ? 0
      : assertExpectedRevision(input.expectedRevision);
    const expectedChainDigest = input.expectedChainDigest === undefined
      ? null
      : input.expectedChainDigest;
    const coordinatorRevision = input.phase === 'OBSERVE'
      && gateResult
      && Number.isSafeInteger(gateResult.revision)
      && gateResult.revision >= 0
      ? gateResult.revision
      : expectedRevision;
    const coordinatorChainDigest = input.phase === 'OBSERVE'
      && gateResult
      && typeof gateResult.chainDigest === 'string'
      ? gateResult.chainDigest
      : expectedChainDigest;
    let recording;
    try {
      recording = this.migrationCoordinator.record({
        expectedRevision: coordinatorRevision,
        expectedChainDigest: coordinatorChainDigest,
        observation,
      });
    } catch (_) {
      fail('RECORDING_FAILED');
    }
    if (isRecord(recording)) {
      return { ...recording, observation, reviewGate: gateResult };
    }
    return { status: 'RECORDED', observation, reviewGate: gateResult };
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
