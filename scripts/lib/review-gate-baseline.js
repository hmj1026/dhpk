'use strict';

const fs = require('node:fs');
const { canonicalJson, sha256 } = require('./harness-receipt');

const SENTINEL_OUTCOME_SCHEMA = 'dhpk.sentinel-outcome.v1';
const ACCEPTED_OUTCOME_COST_SCHEMA = 'dhpk.accepted-outcome-cost.v1';
const SENTINEL_AUTHORITY = 'SENTINEL';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

const EVIDENCE_CONDITIONS = deepFreeze([
  'NO_OP', 'FRESH_PASS', 'MISSING', 'STALE', 'MALFORMED_NATIVE', 'MISPLACED',
  'FOREIGN_IDENTITY', 'CONCURRENT_SESSION', 'RESUMED_PASS', 'RESUMED_INTERMEDIATE',
  'RESUMED_MALFORMED', 'INTERRUPTED', 'RETRY_ALLOWED', 'RETRY_EXHAUSTED',
  'FAIL_VERDICT', 'RESUMED_BLOCK', 'CLEAN_FOLLOW_UP',
]);
const LIFECYCLE_CLEARANCES = deepFreeze(['NOT_APPLICABLE', 'PENDING', 'CLEARED']);
const SEMANTIC_APPROVALS = deepFreeze([
  'NOT_APPLICABLE', 'NOT_ESTABLISHED', 'APPROVED', 'CHANGES_REQUIRED',
]);
const COMPLETION_STATES = deepFreeze(['PASS', 'BLOCKED']);
const REASON_CODES = deepFreeze([
  'NO_REVIEW_OBLIGATION', 'FRESH_PASSING_ARTIFACT', 'MISSING_ARTIFACT',
  'STALE_ARTIFACT', 'MALFORMED_VERDICT', 'MISPLACED_ARTIFACT', 'FOREIGN_IDENTITY',
  'FOREIGN_SESSION', 'RESUMED_FRESH_PASS', 'RESUMED_INCOMPLETE',
  'REVIEWER_INTERRUPTED', 'CORRECTED_RETRY_PENDING', 'RETRY_EXHAUSTED',
  'REVIEWER_FAIL', 'RESUMED_BLOCK', 'RESOLVED_FOLLOW_UP',
]);
const TELEMETRY_STATUSES = deepFreeze(['COMPLETE', 'PARTIAL', 'FAILED']);
const MAX_TELEMETRY_FAILURES = 20;
const MAX_JSON_NODES = 512;
const MAX_JSON_ARRAY_LENGTH = 256;
const MAX_JSON_STRING_BYTES = 16 * 1024;
const MAX_LIFECYCLE_BYTES = 1024 * 1024;
const MAX_LIFECYCLE_EVENTS = 10_000;
const COST_FIELDS = deepFreeze([
  'modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds',
  'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount',
]);
const SCHEMAS = deepFreeze({ sentinelOutcome: SENTINEL_OUTCOME_SCHEMA, acceptedOutcomeCost: ACCEPTED_OUTCOME_COST_SCHEMA });
const SENTINEL_VOCABULARY = deepFreeze({
  authority: SENTINEL_AUTHORITY,
  evidenceConditions: EVIDENCE_CONDITIONS,
  lifecycleClearances: LIFECYCLE_CLEARANCES,
  semanticApprovals: SEMANTIC_APPROVALS,
  completionStates: COMPLETION_STATES,
  reasonCodes: REASON_CODES,
});
const ACCEPTED_OUTCOME_COST_VOCABULARY = deepFreeze({ telemetryStatuses: TELEMETRY_STATUSES });
const OPTIONAL_METRIC_ENV = deepFreeze({
  modelTokens: 'DHPK_ACCEPTED_OUTCOME_MODEL_TOKENS',
  humanTurns: 'DHPK_ACCEPTED_OUTCOME_HUMAN_TURNS',
  falseBlockCount: 'DHPK_ACCEPTED_OUTCOME_FALSE_BLOCK_COUNT',
  receiptReuseCount: 'DHPK_ACCEPTED_OUTCOME_RECEIPT_REUSE_COUNT',
});

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COLLECTOR_FAILURE_CODE = /^COLLECTOR_FAILED(?:_[1-9][0-9]{0,2})?$/;
const KNOWN_FAILURE_CODES = new Set([
  'INVALID_MODEL_TOKENS', 'INVALID_HUMAN_TURNS', 'INVALID_FALSE_BLOCK_COUNT',
  'INVALID_RECEIPT_REUSE_COUNT', 'INVALID_LIFECYCLE_TIMESTAMP',
  'MALFORMED_LIFECYCLE_EVENT', 'LIFECYCLE_SOURCE_TOO_LARGE',
  'LIFECYCLE_EVENT_LIMIT', 'COLLECTOR_UNAVAILABLE',
]);

function assertJsonData(value, name, seen = new WeakSet(), budget = { nodes: 0, bytes: 0 }) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`${name} must contain bounded JSON-compatible data`);
    }
    return value;
  }
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > MAX_JSON_STRING_BYTES) {
      throw new TypeError(`${name} must contain bounded JSON-compatible data`);
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} must contain bounded JSON-compatible data`);
  }
  if (seen.has(value)) throw new TypeError(`${name} must contain bounded JSON-compatible data`);
  seen.add(value);
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${name} must contain bounded JSON-compatible data`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > MAX_JSON_ARRAY_LENGTH) {
      throw new TypeError(`${name} must contain bounded JSON-compatible data`);
    }
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain record`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_JSON_NODES || keys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${name} must contain bounded JSON-compatible data`);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
        throw new TypeError(`${name} must contain bounded JSON-compatible data`);
      }
    }
  }
  for (const key of keys) {
    if (key === 'length' && Array.isArray(value)) continue;
    budget.bytes += Buffer.byteLength(key, 'utf8');
    if (budget.bytes > MAX_JSON_STRING_BYTES) {
      throw new TypeError(`${name} must contain bounded JSON-compatible data`);
    }
    if (Array.isArray(value)
      && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
      throw new TypeError(`${name} must contain bounded JSON-compatible data`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError(`${name} must contain bounded JSON-compatible data`);
    }
    const childName = key === 'metrics' ? 'metrics' : name;
    assertJsonData(descriptor.value, childName, seen, budget);
  }
  return value;
}

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain record`);
  }
  assertJsonData(value, name);
  return value;
}

function ownValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor ? descriptor.value : undefined;
}

function assertStableId(value, name) {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    throw new Error(`${name} must be a stable identifier`);
  }
  return value;
}

function assertVocabulary(value, allowed, name) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${name} is unsupported`);
  }
  return value;
}

function assertOutcomeCoherence({ lifecycle, semantic, completion, unresolved }) {
  if (completion === 'PASS' && lifecycle === 'PENDING') {
    throw new Error('passing completion cannot have pending lifecycle clearance');
  }
  if (completion === 'PASS' && unresolved) {
    throw new Error('passing completion cannot have unresolved verdict evidence');
  }
  if (completion === 'PASS' && !['APPROVED', 'NOT_APPLICABLE'].includes(semantic)) {
    throw new Error('passing completion requires established semantic approval');
  }
  if (completion === 'BLOCKED' && semantic === 'APPROVED') {
    throw new Error('blocked completion cannot have approved semantics');
  }
  if (lifecycle === 'NOT_APPLICABLE' && (semantic !== 'NOT_APPLICABLE' || completion !== 'PASS')) {
    throw new Error('not-applicable lifecycle requires a not-applicable passing outcome');
  }
  if (semantic === 'CHANGES_REQUIRED' && !unresolved) {
    throw new Error('changes-required semantics require unresolved verdict evidence');
  }
}

function assertReasonCodes(reasonCodes) {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    throw new TypeError('reasonCodes must be a non-empty array');
  }
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < reasonCodes.length; index += 1) {
    const code = ownValue(reasonCodes, String(index));
    assertVocabulary(code, REASON_CODES, 'reason code');
    if (seen.has(code)) throw new Error('reason code is duplicated');
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
}

function normalizeSentinelOutcome(input) {
  const source = assertRecord(input, 'Sentinel outcome');
  const schema = ownValue(source, 'schema');
  const sentinelAuthority = ownValue(source, 'sentinelAuthority');
  if (schema !== undefined && schema !== SENTINEL_OUTCOME_SCHEMA) {
    throw new Error(`Sentinel outcome schema must be ${SENTINEL_OUTCOME_SCHEMA}`);
  }
  if (sentinelAuthority !== undefined && sentinelAuthority !== true) {
    throw new Error('Sentinel authority is fixed to true');
  }
  const lifecycle = assertVocabulary(ownValue(source, 'lifecycleClearance'), LIFECYCLE_CLEARANCES, 'lifecycle clearance');
  const semantic = assertVocabulary(ownValue(source, 'semanticApproval'), SEMANTIC_APPROVALS, 'semantic approval');
  const completion = assertVocabulary(ownValue(source, 'completion'), COMPLETION_STATES, 'completion');
  const unresolvedVerdict = ownValue(source, 'unresolvedVerdict');
  if (typeof unresolvedVerdict !== 'boolean') throw new TypeError('unresolvedVerdict must be boolean');
  assertOutcomeCoherence({ lifecycle, semantic, completion, unresolved: unresolvedVerdict });
  const result = {
    schema: SENTINEL_OUTCOME_SCHEMA,
    caseId: assertStableId(ownValue(source, 'caseId'), 'caseId'),
    evidenceCondition: assertVocabulary(ownValue(source, 'evidenceCondition'), EVIDENCE_CONDITIONS, 'evidence condition'),
    lifecycleClearance: lifecycle,
    semanticApproval: semantic,
    completion,
    sentinelAuthority: true,
    unresolvedVerdict,
    reasonCodes: assertReasonCodes(ownValue(source, 'reasonCodes')),
  };
  return deepFreeze(result);
}

function normalizeMetric(metrics, field) {
  const value = ownValue(metrics, field);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nullable nonnegative safe integer`);
  }
  return value;
}

function normalizeFailure(failure, index) {
  if (failure && typeof failure === 'object' && !Array.isArray(failure)) {
    const proposedCode = ownValue(failure, 'code');
    const detail = ownValue(failure, 'detail');
    const normalized = {
      code: typeof proposedCode === 'string'
        && (KNOWN_FAILURE_CODES.has(proposedCode) || COLLECTOR_FAILURE_CODE.test(proposedCode))
        ? proposedCode : `TELEMETRY_FAILURE_${index + 1}`,
      detail: '<redacted>',
    };
    if (typeof detail === 'string') normalized.detailSha256 = `sha256:${sha256(detail)}`;
    return normalized;
  }
  const normalized = { code: `TELEMETRY_FAILURE_${index + 1}`, detail: '<redacted>' };
  if (typeof failure === 'string') normalized.detailSha256 = `sha256:${sha256(failure)}`;
  return normalized;
}

function normalizeAcceptedOutcomeCost(input) {
  const source = assertRecord(input, 'Accepted-Outcome Cost observation');
  const schema = ownValue(source, 'schema');
  const acceptedOutcome = ownValue(source, 'acceptedOutcome');
  if (schema !== undefined && schema !== ACCEPTED_OUTCOME_COST_SCHEMA) {
    throw new Error(`Accepted-Outcome Cost schema must be ${ACCEPTED_OUTCOME_COST_SCHEMA}`);
  }
  if (typeof acceptedOutcome !== 'boolean') throw new TypeError('acceptedOutcome must be boolean');
  const sourceMetrics = ownValue(source, 'metrics');
  const metrics = sourceMetrics === undefined || sourceMetrics === null
    ? {} : assertRecord(sourceMetrics, 'metrics');
  const normalizedMetrics = Object.fromEntries(
    COST_FIELDS.map((field) => [field, normalizeMetric(metrics, field)])
  );
  const failuresValue = ownValue(source, 'telemetryFailures');
  if (failuresValue !== undefined && failuresValue !== null
    && !Array.isArray(failuresValue)) throw new TypeError('telemetryFailures must be an array');
  const sourceFailures = failuresValue || [];
  const telemetryFailures = Array.prototype.slice.call(sourceFailures, 0, MAX_TELEMETRY_FAILURES).map(normalizeFailure);
  const allMetricsPresent = COST_FIELDS.every((field) => normalizedMetrics[field] !== null);
  const telemetryStatus = sourceFailures.length > 0 ? 'FAILED' : allMetricsPresent ? 'COMPLETE' : 'PARTIAL';
  return deepFreeze({
    schema: ACCEPTED_OUTCOME_COST_SCHEMA,
    observationId: assertStableId(ownValue(source, 'observationId'), 'observationId'),
    acceptedOutcome,
    metrics: normalizedMetrics,
    telemetryFailures,
    telemetryFailureCount: sourceFailures.length,
    telemetryStatus,
    retirementEligible: acceptedOutcome && telemetryStatus === 'COMPLETE' && telemetryFailures.length === 0,
  });
}

function pushFailure(failures, code) {
  if (!failures.some((failure) => ownValue(failure, 'code') === code)) failures.push({ code });
}

function optionalMetric(value, code, failures) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    pushFailure(failures, code);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    pushFailure(failures, code);
    return null;
  }
  return parsed;
}

function failedLegacyObservation(taskId, verdict, failures) {
  return normalizeAcceptedOutcomeCost({
    observationId: `legacy-${sha256(taskId).slice(0, 32)}`,
    acceptedOutcome: ['PASS', 'APPROVE'].includes(verdict),
    metrics: Object.fromEntries(COST_FIELDS.map((field) => [field, null])),
    telemetryFailures: failures,
  });
}

function collectLegacyAcceptedOutcomeCost(serializedEvents, options = {}) {
  const config = assertRecord(options, 'legacy collector options');
  const configuredTask = ownValue(config, 'taskId');
  const configuredVerdict = ownValue(config, 'verdict');
  const configuredMeasurements = ownValue(config, 'measurements');
  const configuredFailures = ownValue(config, 'failures');
  const taskId = typeof configuredTask === 'string' && configuredTask.length <= 256 ? configuredTask : '';
  const verdict = typeof configuredVerdict === 'string' && configuredVerdict.length <= 32
    ? configuredVerdict.toUpperCase() : '';
  const measurements = configuredMeasurements === undefined || configuredMeasurements === null
    ? {} : assertRecord(configuredMeasurements, 'measurements');
  const failures = [];
  if (configuredFailures !== undefined && configuredFailures !== null) {
    if (!Array.isArray(configuredFailures)) throw new TypeError('collector failures must be an array');
    for (const failure of configuredFailures.slice(0, MAX_TELEMETRY_FAILURES)) {
      if (failure && typeof failure === 'object' && !Array.isArray(failure)) {
        const code = ownValue(failure, 'code');
        if (KNOWN_FAILURE_CODES.has(code)) pushFailure(failures, code);
      }
    }
  }
  const eventText = typeof serializedEvents === 'string' ? serializedEvents : '';
  if (Buffer.byteLength(eventText, 'utf8') > MAX_LIFECYCLE_BYTES) {
    pushFailure(failures, 'LIFECYCLE_SOURCE_TOO_LARGE');
    return failedLegacyObservation(taskId, verdict, failures);
  }
  let eventCount = 0;
  let dispatchCount = 0;
  let semanticReviewCount = 0;
  let remediationRounds = 0;
  let earliest = null;
  let latest = null;
  for (const line of eventText.split('\n')) {
    if (!line.trim()) continue;
    eventCount += 1;
    if (eventCount > MAX_LIFECYCLE_EVENTS) {
      pushFailure(failures, 'LIFECYCLE_EVENT_LIMIT');
      break;
    }
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event) || event.task_id !== taskId) continue;
      if (event.state === 'dispatched') dispatchCount += 1;
      if (event.state === 'verdicted') semanticReviewCount += 1;
      if (event.state === 'retrying') remediationRounds += 1;
      if (typeof event.occurred_at !== 'string') {
        pushFailure(failures, 'INVALID_LIFECYCLE_TIMESTAMP');
        continue;
      }
      const timestamp = Date.parse(event.occurred_at);
      if (!Number.isFinite(timestamp)) {
        pushFailure(failures, 'INVALID_LIFECYCLE_TIMESTAMP');
        continue;
      }
      earliest = earliest === null || timestamp < earliest ? timestamp : earliest;
      latest = latest === null || timestamp > latest ? timestamp : latest;
    } catch (_) {
      pushFailure(failures, 'MALFORMED_LIFECYCLE_EVENT');
    }
  }
  const elapsedMs = earliest === null ? null : latest - earliest;
  const metrics = {
    modelTokens: optionalMetric(ownValue(measurements, 'modelTokens'), 'INVALID_MODEL_TOKENS', failures),
    dispatchCount,
    semanticReviewCount,
    remediationRounds,
    humanTurns: optionalMetric(ownValue(measurements, 'humanTurns'), 'INVALID_HUMAN_TURNS', failures),
    elapsedMs,
    falseBlockCount: optionalMetric(ownValue(measurements, 'falseBlockCount'), 'INVALID_FALSE_BLOCK_COUNT', failures),
    receiptReuseCount: optionalMetric(ownValue(measurements, 'receiptReuseCount'), 'INVALID_RECEIPT_REUSE_COUNT', failures),
  };
  return normalizeAcceptedOutcomeCost({
    observationId: `legacy-${sha256(taskId).slice(0, 32)}`,
    acceptedOutcome: ['PASS', 'APPROVE'].includes(verdict),
    metrics,
    telemetryFailures: failures,
  });
}

function readBoundedStdin() {
  const chunks = [];
  const buffer = Buffer.alloc(8192);
  let total = 0;
  for (;;) {
    const bytes = fs.readSync(0, buffer, 0, buffer.length, null);
    if (bytes === 0) break;
    total += bytes;
    if (total > MAX_LIFECYCLE_BYTES) return { text: '', tooLarge: true };
    chunks.push(Buffer.from(buffer.subarray(0, bytes)));
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false };
}

function cli() {
  const [mode, taskId = '', verdict = ''] = process.argv.slice(2);
  if (mode !== '--collect-legacy') return 2;
  const input = readBoundedStdin();
  const measurements = Object.fromEntries(
    Object.entries(OPTIONAL_METRIC_ENV)
      .filter(([, name]) => process.env[name] !== undefined)
      .map(([field, name]) => [field, process.env[name]])
  );
  const observation = collectLegacyAcceptedOutcomeCost(input.text, {
    taskId,
    verdict,
    measurements,
    failures: input.tooLarge ? [{ code: 'LIFECYCLE_SOURCE_TOO_LARGE' }] : [],
  });
  process.stdout.write(`${canonicalJson(observation)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = cli();

module.exports = {
  SENTINEL_OUTCOME_SCHEMA,
  ACCEPTED_OUTCOME_COST_SCHEMA,
  SENTINEL_AUTHORITY,
  SCHEMAS,
  SENTINEL_VOCABULARY,
  ACCEPTED_OUTCOME_COST_VOCABULARY,
  EVIDENCE_CONDITIONS,
  LIFECYCLE_CLEARANCES,
  SEMANTIC_APPROVALS,
  COMPLETION_STATES,
  REASON_CODES,
  TELEMETRY_STATUSES,
  COST_FIELDS,
  OPTIONAL_METRIC_ENV,
  normalizeSentinelOutcome,
  normalizeAcceptedOutcomeCost,
  collectLegacyAcceptedOutcomeCost,
};
