'use strict';

const {
  canonicalJson,
  SAFE_ID,
  sha256,
} = require('./receipt-primitives');
const {
  ACCEPTED_OUTCOME_COST_SCHEMA,
  COST_FIELDS,
  TELEMETRY_STATUSES,
  normalizeAcceptedOutcomeCost,
} = require('./review-gate-baseline');

const IDENTITY_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'attempt',
  'sessionId',
  'dispatchId',
  'scopeId',
  'diffId',
]);
const TERMINAL_STATES = Object.freeze(['verdicted']);
const TERMINAL_VERDICTS = Object.freeze([
  'PASS',
  'APPROVE',
  'CHANGES_REQUIRED',
  'BLOCKED',
  'BLOCK',
  'FAIL',
  'WARNING',
]);
const TERMINAL_VERDICT_SET = new Set(TERMINAL_VERDICTS);
const STATUS_VALUES = new Set([
  'PASS',
  'APPROVE',
  'CHANGES_REQUIRED',
  'BLOCKED',
  'BLOCK',
  'FAIL',
  'WARNING',
  'CLEARED',
  'PENDING',
  'UNKNOWN',
]);
const LEGACY_COST_FIELDS = Object.freeze([
  'dispatchCount', 'semanticReviewCount', 'remediationRounds', 'humanTurns', 'elapsedMs',
  'receiptReuse', 'falseBlocks', 'unsafeClearance', 'missedRequiredReview', 'postMergeEscapes',
]);
const LEGACY_METRIC_FIELDS = Object.freeze({
  modelTokens: null,
  dispatchCount: 'dispatchCount',
  semanticReviewCount: 'semanticReviewCount',
  remediationRounds: 'remediationRounds',
  humanTurns: 'humanTurns',
  elapsedMs: 'elapsedMs',
  falseBlockCount: 'falseBlocks',
  receiptReuseCount: 'receiptReuse',
});
const COLLECTOR_FALLBACK_CODE = 'COLLECTOR_UNAVAILABLE';
const REDACTED_DETAIL_HASH = `sha256:${sha256('<redacted>')}`;
const MAX_EVENTS = 10000;
const MAX_FAILURES = 20;
const MAX_FAILURE_COUNT = 10000;
const MAX_STRING_BYTES = 4096;

class LegacyObservationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LegacyObservationError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new LegacyObservationError(code);
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function descriptorValue(record, key, code = 'MALFORMED_LEGACY_OBSERVATION') {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function assertRecord(value, code = 'MALFORMED_LEGACY_OBSERVATION') {
  if (!isRecord(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  if (Object.getOwnPropertySymbols(value).length > 0) fail(code);
  for (const key of Object.keys(Object.getOwnPropertyDescriptors(value))) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail(code);
    if (Buffer.byteLength(key, 'utf8') > MAX_STRING_BYTES) fail(code);
  }
  return value;
}

function assertArray(value, code = 'MALFORMED_LEGACY_OBSERVATION') {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) fail(code);
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    fail(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  const expected = ['length', ...Array.from({ length: value.length }, (_, index) => String(index))];
  if (names.length !== expected.length || !expected.every((name) => names.includes(name))) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail(code);
  }
  return value;
}

function safeId(value, code = 'MALFORMED_IDENTITY') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(code);
  return value;
}

function safeAttempt(value, code = 'MALFORMED_IDENTITY') {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}

function identityOf(value) {
  const source = assertRecord(value);
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    const candidate = descriptorValue(source, field, 'MALFORMED_IDENTITY');
    identity[field] = field === 'attempt' ? safeAttempt(candidate) : safeId(candidate);
  }
  return identity;
}

function readAlias(record, aliases, code = 'MALFORMED_LIFECYCLE') {
  for (const alias of aliases) {
    if (hasOwn(record, alias)) return descriptorValue(record, alias, code);
  }
  fail(code);
}

function lifecycleIdentity(event) {
  const source = assertRecord(event, 'MALFORMED_LIFECYCLE');
  return {
    taskId: readAlias(source, ['task_id', 'taskId']),
    attemptId: readAlias(source, ['attempt_id', 'attemptId']),
    attempt: readAlias(source, ['attempt', 'dispatch_attempt']),
    sessionId: readAlias(source, ['session_id', 'sessionId']),
    dispatchId: readAlias(source, ['wave', 'dispatch_id', 'dispatchId']),
    scopeId: readAlias(source, ['scope_id', 'scopeId']),
    diffId: readAlias(source, ['diff_id', 'diffId']),
  };
}

function sameIdentity(expected, actual) {
  for (const field of IDENTITY_FIELDS) {
    const actualValue = field === 'attempt' ? safeAttempt(actual[field], 'FOREIGN_IDENTITY') : safeId(actual[field], 'FOREIGN_IDENTITY');
    if (actualValue !== expected[field]) fail('FOREIGN_IDENTITY');
  }
}

function canonicalVerdict(value) {
  if (value === 'PASS' || value === 'APPROVE') return 'PASS';
  if (value === 'CHANGES_REQUIRED' || value === 'WARNING' || value === 'FAIL') return 'CHANGES_REQUIRED';
  if (value === 'BLOCKED' || value === 'BLOCK') return 'BLOCKED';
  return null;
}

function legacyStatus(value) {
  return typeof value === 'string' && value.length <= 128 && SAFE_ID.test(value) ? value : null;
}

function normalizeStatus(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES || !STATUS_VALUES.has(value)) {
    fail('MALFORMED_SENTINEL');
  }
  return value;
}

function bindSentinelOutcome({ identity, lifecycleEvents, sentinelOutcome } = {}) {
  const expectedIdentity = identityOf(identity);
  const events = assertArray(lifecycleEvents, 'MALFORMED_LIFECYCLE');
  const sentinel = assertRecord(sentinelOutcome, 'MALFORMED_SENTINEL');
  const terminalEvents = [];

  for (const event of events) {
    const schemaVersion = descriptorValue(event, 'schema_version', 'MALFORMED_LIFECYCLE');
    const eventType = descriptorValue(event, 'event_type', 'MALFORMED_LIFECYCLE');
    const state = descriptorValue(event, 'state', 'MALFORMED_LIFECYCLE');
    if (schemaVersion !== 1 || eventType !== 'review-lifecycle' || typeof state !== 'string') {
      fail('MALFORMED_LIFECYCLE');
    }
    const eventIdentity = lifecycleIdentity(event);
    sameIdentity(expectedIdentity, eventIdentity);
    const eventId = safeId(descriptorValue(event, 'event_id', 'MALFORMED_LIFECYCLE'), 'MALFORMED_LIFECYCLE');
    if (state === TERMINAL_STATES[0]) {
      const verdict = descriptorValue(event, 'verdict', 'MALFORMED_LIFECYCLE');
      if (!TERMINAL_VERDICT_SET.has(verdict)) fail('MALFORMED_LIFECYCLE');
      terminalEvents.push({ eventId, verdict });
    }
  }

  if (terminalEvents.length !== 1) fail('TERMINAL_EVENT_BINDING');
  const terminal = terminalEvents[0];
  const lifecycleEventId = safeId(
    descriptorValue(sentinel, 'lifecycleEventId', 'MISSING_LIFECYCLE_EVENT'),
    'MISSING_LIFECYCLE_EVENT',
  );
  if (lifecycleEventId !== terminal.eventId) fail('FOREIGN_LIFECYCLE_EVENT');

  const explicitStatuses = ['status', 'verdict', 'outcome']
    .map((field) => normalizeStatus(hasOwn(sentinel, field) ? descriptorValue(sentinel, field, 'MALFORMED_SENTINEL') : undefined))
    .filter((value) => value !== null);
  const semanticStatuses = explicitStatuses.map(canonicalVerdict).filter(Boolean);
  if (semanticStatuses.some((value) => value !== semanticStatuses[0])) fail('CONTRADICTORY_VERDICT');
  const expectedVerdict = canonicalVerdict(terminal.verdict);
  if (semanticStatuses.length > 0 && semanticStatuses[0] !== expectedVerdict) fail('CONTRADICTORY_VERDICT');

  const normalizedSentinel = {};
  for (const field of ['status', 'verdict', 'outcome']) {
    if (hasOwn(sentinel, field)) normalizedSentinel[field] = descriptorValue(sentinel, field, 'MALFORMED_SENTINEL');
  }
  normalizedSentinel.lifecycleEventId = lifecycleEventId;
  return Object.freeze({
    identity: Object.freeze(expectedIdentity),
    lifecycleEventId,
    terminalVerdict: terminal.verdict,
    canonicalVerdict: expectedVerdict,
    sentinelOutcome: Object.freeze(normalizedSentinel),
  });
}

function taskDerivedObservationIds(taskId) {
  const digest = sha256(taskId);
  return new Set([
    `legacy-${digest.slice(0, 32)}`,
    `legacy-sha256:${digest}`,
  ]);
}

function normalizeLegacyCost(value) {
  validateLegacyCostProjection(value);
  const normalized = {};
  for (const field of LEGACY_COST_FIELDS) {
    if (!hasOwn(value, field)) continue;
    const candidate = descriptorValue(value, field, 'MALFORMED_SENTINEL');
    normalized[field] = candidate;
  }
  return Object.freeze(normalized);
}

function validateLegacyCostProjection(value) {
  assertRecord(value, 'MALFORMED_LEGACY_COST');
  for (const field of Object.keys(value)) {
    if (!LEGACY_COST_FIELDS.includes(field)) fail('MALFORMED_LEGACY_COST');
    const candidate = descriptorValue(value, field, 'MALFORMED_LEGACY_COST');
    if (!Number.isSafeInteger(candidate) || candidate < 0) fail('MALFORMED_LEGACY_COST');
  }
  return true;
}

function normalizeLegacyVerdictFields(value) {
  const normalized = { ...assertRecord(value, 'MALFORMED_SENTINEL') };
  for (const field of ['verdict', 'outcome']) {
    if (!hasOwn(normalized, field)) continue;
    const value = descriptorValue(normalized, field, 'MALFORMED_SENTINEL');
    const canonical = value === 'BLOCK' ? 'CHANGES_REQUIRED' : canonicalVerdict(value);
    if (canonical) normalized[field] = canonical;
  }
  return normalized;
}

function baselineAcceptedOutcomeCost(taskId, sentinel, legacyCost) {
  const semantic = canonicalVerdict(sentinel.verdict || sentinel.outcome || sentinel.status);
  const metrics = Object.fromEntries(Object.entries(LEGACY_METRIC_FIELDS).map(([field, legacyField]) => [
    field,
    legacyField === null || !hasOwn(legacyCost, legacyField) ? null : legacyCost[legacyField],
  ]));
  return normalizeAcceptedOutcomeCost({
    observationId: `legacy-${sha256(taskId).slice(0, 32)}`,
    acceptedOutcome: semantic === 'PASS',
    metrics,
    telemetryFailures: [],
  });
}

function normalizeBaselineLegacyObservation(source = {}) {
  assertRecord(source);
  const identity = identityOf(source.identity);
  if (!Array.isArray(source.lifecycleEvents) || source.lifecycleEvents.length !== 0) {
    fail('MALFORMED_LIFECYCLE');
  }
  const sentinel = assertRecord(source.sentinelOutcome, 'MALFORMED_SENTINEL');
  if (!hasOwn(sentinel, 'cost') || !isRecord(descriptorValue(sentinel, 'cost', 'MALFORMED_SENTINEL'))) {
    fail('MISSING_LEGACY_COST');
  }
  const normalizedSentinel = {};
  for (const field of ['status', 'verdict', 'outcome']) {
    if (!hasOwn(sentinel, field)) continue;
    const value = legacyStatus(descriptorValue(sentinel, field, 'MALFORMED_SENTINEL'));
    if (value) normalizedSentinel[field] = value;
  }
  if (Object.keys(normalizedSentinel).length === 0) normalizedSentinel.status = 'UNKNOWN';
  const legacyCost = normalizeLegacyCost(descriptorValue(sentinel, 'cost', 'MALFORMED_SENTINEL'));
  normalizedSentinel.cost = legacyCost;
  const acceptedOutcomeCost = baselineAcceptedOutcomeCost(identity.taskId, normalizedSentinel, legacyCost);
  return Object.freeze({
    identity: Object.freeze(identity),
    costObservationId: acceptedOutcomeCost.observationId,
    sentinelOutcome: Object.freeze(normalizedSentinel),
    acceptedOutcomeCost,
    legacyCost,
  });
}

function withCollectorFallbackHash(source) {
  if (!isRecord(source) || !Array.isArray(source.telemetryFailures)) return null;
  let changed = false;
  const telemetryFailures = source.telemetryFailures.map((failure) => {
    if (!isRecord(failure) || Object.keys(failure).length !== 2
      || failure.code !== COLLECTOR_FALLBACK_CODE || failure.detail !== '<redacted>'
      || hasOwn(failure, 'detailSha256')) return failure;
    changed = true;
    return { ...failure, detailSha256: REDACTED_DETAIL_HASH };
  });
  return changed ? { ...source, telemetryFailures } : null;
}

function normalizeCost({ taskId, acceptedOutcomeCost, expectedVerdict }) {
  if (acceptedOutcomeCost === undefined || acceptedOutcomeCost === null) fail('MISSING_ACCEPTED_OUTCOME_COST');
  let normalized;
  try {
    normalized = normalizeAcceptedOutcomeCost(acceptedOutcomeCost);
  } catch (_) {
    fail('MALFORMED_ACCEPTED_OUTCOME_COST');
  }
  const compatible = withCollectorFallbackHash(acceptedOutcomeCost);
  if (canonicalJson(normalized) !== canonicalJson(acceptedOutcomeCost)
    && (!compatible || canonicalJson(normalized) !== canonicalJson(compatible))) {
    fail('MALFORMED_ACCEPTED_OUTCOME_COST');
  }
  if (!taskDerivedObservationIds(taskId).has(normalized.observationId)) fail('FOREIGN_COST_OBSERVATION');
  const expectedAccepted = expectedVerdict === 'PASS';
  if (normalized.acceptedOutcome !== expectedAccepted) fail('CONTRADICTORY_COST_OUTCOME');
  if (!Array.isArray(normalized.telemetryFailures) || normalized.telemetryFailures.length > MAX_FAILURES) {
    fail('MALFORMED_ACCEPTED_OUTCOME_COST');
  }
  if (!Number.isSafeInteger(normalized.telemetryFailureCount)
    || normalized.telemetryFailureCount < 0 || normalized.telemetryFailureCount > MAX_FAILURE_COUNT) {
    fail('MALFORMED_ACCEPTED_OUTCOME_COST');
  }
  if (!TELEMETRY_STATUSES.includes(normalized.telemetryStatus)) fail('MALFORMED_ACCEPTED_OUTCOME_COST');
  for (const field of COST_FIELDS) {
    const value = normalized.metrics[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('MALFORMED_ACCEPTED_OUTCOME_COST');
  }
  const failures = normalized.telemetryFailures.map((failure) => {
    const copy = { code: safeId(failure.code, 'MALFORMED_ACCEPTED_OUTCOME_COST'), detail: '<redacted>' };
    if (hasOwn(failure, 'detailSha256')) copy.detailSha256 = failure.detailSha256;
    return Object.freeze(copy);
  });
  return Object.freeze({
    schema: ACCEPTED_OUTCOME_COST_SCHEMA,
    observationId: normalized.observationId,
    acceptedOutcome: normalized.acceptedOutcome,
    metrics: Object.freeze(Object.fromEntries(COST_FIELDS.map((field) => [field, normalized.metrics[field]]))),
    telemetryFailures: Object.freeze(failures),
    telemetryFailureCount: normalized.telemetryFailureCount,
    telemetryStatus: normalized.telemetryStatus,
    retirementEligible: normalized.retirementEligible === true,
  });
}

function normalizeLegacyObservation(source = {}) {
  assertRecord(source);
  const binding = bindSentinelOutcome(source);
  const acceptedOutcomeCost = normalizeCost({
    taskId: binding.identity.taskId,
    acceptedOutcomeCost: hasOwn(source, 'acceptedOutcomeCost')
      ? descriptorValue(source, 'acceptedOutcomeCost') : undefined,
    expectedVerdict: binding.canonicalVerdict,
  });
  return Object.freeze({
    identity: binding.identity,
    lifecycleEventId: binding.lifecycleEventId,
    costObservationId: acceptedOutcomeCost.observationId,
    sentinelOutcome: binding.sentinelOutcome,
    acceptedOutcomeCost,
  });
}

module.exports = {
  ACCEPTED_OUTCOME_COST_SCHEMA,
  LEGACY_COST_FIELDS,
  LegacyObservationError,
  normalizeBaselineLegacyObservation,
  normalizeLegacyVerdictFields,
  normalizeLegacyObservation,
  validateLegacyCostProjection,
};
