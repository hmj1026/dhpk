'use strict';

const {
  SAFE_ID,
  FINGERPRINT,
  canonicalJson,
} = require('./receipt-primitives');
const {
  ReceiptStore,
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
} = require('./review-gate-receipt-store');

const OBSERVATION_SCHEMA = 'dhpk.review-gate.migration-observation.v1';
const PROJECTION_SCHEMA = 'dhpk.review-gate-migration-projection.v1';
const EVENT_TYPE = 'MIGRATION_OBSERVATION_RECORDED';
const PHASES = Object.freeze(['BASELINE', 'OBSERVE']);
const EFFECTS = Object.freeze({ BASELINE: 'DISABLED', OBSERVE: 'OBSERVE_ONLY' });
const COMPARISONS = Object.freeze(['AGREE', 'DISAGREE', 'INDETERMINATE']);
const STATUS_VALUES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'PENDING', 'CLEARED', 'NOT_RUN', 'INTERRUPTED', 'UNAVAILABLE', 'CHANGES_REQUIRED', 'INDETERMINATE', 'UNKNOWN']);
const VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED', 'BLOCKED', 'NOT_RUN', 'INDETERMINATE']);
const IDENTITY_FIELDS = Object.freeze(['workId', 'waveId', 'planId', 'decisionId', 'obligationId', 'lane', 'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId']);
const ENVELOPE_IDENTITY_FIELDS = IDENTITY_FIELDS;
const ENVELOPE_METADATA_FIELDS = Object.freeze(['producer', 'adapter', 'adapterVersion', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt']);
const FALSE_FIELDS = Object.freeze(['authorizesApproval', 'clearsSentinel', 'blocksSentinel', 'allowsTargetProgress', 'automaticPromotion', 'retirementEligible']);
const PROVENANCE_FIELDS = Object.freeze(['digest', 'reference', 'producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'readinessEventId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'artifactDigest', 'recordedAt', 'lifecycleEventIds', 'readinessEventIds']);
const PAYLOAD_FIELDS = Object.freeze(['schema', 'producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt', 'phase', 'authority', 'effect', 'comparison', 'workId', 'decisionId', 'planId', 'waveId', 'obligationId', 'lane', 'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId', 'identity', 'scope', 'diff', 'sentinelStatus', 'reviewGateStatus', 'sentinelOutcome', 'reviewGate', 'cost', 'reasonCodes', 'authorizesApproval', 'clearsSentinel', 'blocksSentinel', 'allowsTargetProgress', 'automaticPromotion', 'retirementEligible', 'liveness', 'processLivenessRole', 'provenance']);
const NESTED_IDENTITY_FIELDS = Object.freeze(['taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId']);
const SCOPE_FIELDS = Object.freeze(['paths', 'digest', 'kinds']);
const DIFF_FIELDS = Object.freeze(['digest', 'reference', 'paths']);
const SENTINEL_FIELDS = Object.freeze(['status', 'verdict', 'outcome', 'cost']);
const COST_FIELDS = Object.freeze(['modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds', 'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount', 'receiptReuse', 'falseBlocks', 'unsafeClearance', 'missedRequiredReview', 'postMergeEscapes']);
const REVIEW_GATE_FIELDS = Object.freeze(['status', 'accepted', 'allowsProgress', 'lifecycleStatus', 'executionStatus', 'applicability', 'semanticVerdict', 'blockingReasons']);
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/@+-]+$/;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const COMMIT = /^[a-f0-9]{40}$/i;
const TREE = /^[a-f0-9]{40}$/i;
const FORBIDDEN_KEY = /(?:prompt|message|chainofthought|thought|reasoning|transcript|fullsource|sourcecode|fulllog|rawlog|stdout|stderr|authorization|proxy.?authorization|token|password|secret|api.?key|private.?key|signing.?key|cookie|credential)/i;
const MAX_NODES = 4096;
const MAX_DEPTH = 12;
const MAX_STRING_BYTES = 4096;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_KEYS = 200;
const MAX_KEY_BYTES = 4096;

class MigrationCoordinatorError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'MigrationCoordinatorError';
    this.code = code;
  }
}

const fail = (code, message = code) => {
  throw new MigrationCoordinatorError(code, message);
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function forbiddenKey(key) {
  const normalized = String(key);
  if (normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor') return true;
  return FORBIDDEN_KEY.test(normalized.replace(/[^A-Za-z0-9]/g, '').toLowerCase());
}

function cloneJson(value, state = { nodes: 0, bytes: 0, seen: new WeakSet() }, key = '', depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) fail('MALFORMED_RECEIPT', 'bounded observation data is required');
  if (forbiddenKey(key)) fail('SENSITIVE_EVIDENCE', 'sensitive observation data is not allowed');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8');
    state.bytes += bytes;
    if (bytes > MAX_STRING_BYTES || state.bytes > MAX_TOTAL_BYTES) {
      fail('MALFORMED_RECEIPT', 'bounded observation data is required');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('MALFORMED_RECEIPT', 'finite observation numbers are required');
    return value;
  }
  if (!value || typeof value !== 'object') fail('MALFORMED_RECEIPT', 'JSON observation data is required');
  if (state.seen.has(value)) fail('MALFORMED_RECEIPT', 'cyclic observation data is not allowed');
  state.seen.add(value);

  let result;
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0 || value.length > MAX_KEYS) {
      fail('MALFORMED_RECEIPT', 'bounded observation arrays are required');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.keys(descriptors);
    const expected = ['length', ...Array.from({ length: value.length }, (_, index) => String(index))];
    if (names.length !== expected.length || !expected.every((name) => names.includes(name))) {
      fail('MALFORMED_RECEIPT', 'dense observation arrays are required');
    }
    for (const name of names) {
      const keyBytes = Buffer.byteLength(name, 'utf8');
      if (keyBytes > MAX_KEY_BYTES || state.bytes + keyBytes > MAX_TOTAL_BYTES) {
        fail('MALFORMED_RECEIPT', 'bounded observation data is required');
      }
      state.bytes += keyBytes;
    }
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || hasOwn(lengthDescriptor, 'get') || !hasOwn(lengthDescriptor, 'value')) {
      fail('MALFORMED_RECEIPT', 'observation accessors are not allowed');
    }
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail('MALFORMED_RECEIPT', 'observation accessors are not allowed');
      }
      result.push(cloneJson(descriptor.value, state, key, depth + 1));
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('MALFORMED_RECEIPT', 'plain observation records are required');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail('MALFORMED_RECEIPT', 'symbol observation keys are not allowed');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_KEYS) fail('MALFORMED_RECEIPT', 'bounded observation records are required');
    result = {};
    for (const entryKey of keys) {
      const descriptor = descriptors[entryKey];
      if (!descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        fail('MALFORMED_RECEIPT', 'observation accessors are not allowed');
      }
      if (forbiddenKey(entryKey)) fail('SENSITIVE_EVIDENCE', 'sensitive observation data is not allowed');
      const keyBytes = Buffer.byteLength(entryKey, 'utf8');
      if (keyBytes > MAX_KEY_BYTES || state.bytes + keyBytes > MAX_TOTAL_BYTES) {
        fail('MALFORMED_RECEIPT', 'bounded observation data is required');
      }
      state.bytes += keyBytes;
      Object.defineProperty(result, entryKey, {
        value: cloneJson(descriptor.value, state, entryKey, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  state.seen.delete(value);
  return result;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

function immutable(value) {
  const cloned = cloneJson(value);
  if (Buffer.byteLength(canonicalJson(cloned), 'utf8') > MAX_TOTAL_BYTES) {
    fail('MALFORMED_RECEIPT', 'bounded observation data is required');
  }
  return freeze(cloned);
}

function requireRecord(value, code = 'MALFORMED_RECEIPT') {
  if (!isRecord(value)) fail(code);
}

function requireClosedRecord(value, allowed, required = []) {
  requireRecord(value);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('UNSUPPORTED_FIELD');
  }
  for (const key of required) {
    if (!hasOwn(value, key)) fail('MALFORMED_RECEIPT');
  }
}

function requireSafeId(value, code = 'MALFORMED_RECEIPT') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(code);
}

function requireText(value, maxBytes = MAX_STRING_BYTES, code = 'MALFORMED_RECEIPT') {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)
    || Buffer.byteLength(value, 'utf8') > maxBytes) fail(code);
}

function requireDigest(value, code = 'MALFORMED_RECEIPT') {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) fail(code);
}

function requireReference(value) {
  requireText(value, 256);
  if (!SAFE_REFERENCE.test(value)) fail('MALFORMED_RECEIPT');
}

function requireVocabulary(value, allowed, code = 'MALFORMED_RECEIPT') {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(code);
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validatePath(value) {
  requireText(value);
  if (!SAFE_PATH.test(value)) fail('MALFORMED_RECEIPT');
}

function validateIdentity(identity, payload) {
  requireRecord(identity);
  for (const field of IDENTITY_FIELDS) {
    if (hasOwn(identity, field) && hasOwn(payload, field) && !same(identity[field], payload[field])) {
      fail('MIXED_IDENTITY');
    }
  }
  for (const field of IDENTITY_FIELDS) {
    const value = hasOwn(payload, field) ? payload[field] : identity[field];
    if (field === 'attempt') {
      if (!Number.isSafeInteger(value) || value < 1) fail('MALFORMED_RECEIPT');
    } else {
      requireSafeId(value);
    }
  }
}

function validateEnvelopeIdentity(payload, envelope) {
  if (!envelope) return;
  requireClosedRecord(envelope, RECEIPT_ENVELOPE_FIELDS, RECEIPT_ENVELOPE_FIELDS);
  for (const field of ENVELOPE_IDENTITY_FIELDS) {
    if (!hasOwn(envelope, field)) fail('MALFORMED_RECEIPT');
    if (!hasOwn(payload, field) || !same(envelope[field], payload[field])) fail('MIXED_IDENTITY');
    if (field === 'attempt') {
      if (!Number.isSafeInteger(envelope[field]) || envelope[field] < 1) fail('MALFORMED_RECEIPT');
    } else {
      requireSafeId(envelope[field]);
    }
  }
  for (const field of ENVELOPE_METADATA_FIELDS) {
    if (!hasOwn(payload, field) || !hasOwn(payload.provenance, field)
      || !same(envelope[field], payload[field])
      || !same(envelope[field], payload.provenance[field])) fail('MIXED_IDENTITY');
  }
  if (envelope.receiptId !== payload.receiptId
    || envelope.receiptId !== payload.provenance.receiptId) fail('MIXED_IDENTITY');
}

function validateScope(scope) {
  requireClosedRecord(scope, SCOPE_FIELDS, ['paths', 'digest']);
  if (!Array.isArray(scope.paths) || scope.paths.length === 0 || scope.paths.length > 200) {
    fail('MALFORMED_RECEIPT');
  }
  scope.paths.forEach(validatePath);
  requireDigest(scope.digest);
  if (hasOwn(scope, 'kinds')) {
    if (!Array.isArray(scope.kinds) || scope.kinds.length > 200) fail('MALFORMED_RECEIPT');
    scope.kinds.forEach((kind) => requireText(kind, 128));
  }
}

function validateDiff(diff) {
  requireClosedRecord(diff, DIFF_FIELDS, ['digest', 'reference']);
  requireDigest(diff.digest);
  requireReference(diff.reference);
  if (hasOwn(diff, 'paths')) {
    if (!Array.isArray(diff.paths) || diff.paths.length > 200) fail('MALFORMED_RECEIPT');
    diff.paths.forEach(validatePath);
  }
}

function validateProvenance(provenance) {
  requireClosedRecord(provenance, PROVENANCE_FIELDS, [
    'digest', 'reference', 'producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId',
    'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt',
    'lifecycleEventIds', 'readinessEventIds',
  ]);
  requireDigest(provenance.digest);
  requireReference(provenance.reference);
  for (const field of ['producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'readinessEventId']) {
    if (hasOwn(provenance, field)) requireSafeId(provenance[field]);
  }
  if (hasOwn(provenance, 'sourceCommit') && !COMMIT.test(provenance.sourceCommit)) fail('MALFORMED_RECEIPT');
  if (hasOwn(provenance, 'sourceTree') && !TREE.test(provenance.sourceTree)) fail('MALFORMED_RECEIPT');
  for (const field of ['policyVersion', 'contractVersion']) {
    if (hasOwn(provenance, field)) requireText(provenance[field], 128);
  }
  if (hasOwn(provenance, 'recordedAt')) {
    requireText(provenance.recordedAt, 128);
    if (!Number.isFinite(Date.parse(provenance.recordedAt))) fail('MALFORMED_RECEIPT');
  }
  if (hasOwn(provenance, 'artifactDigest')) requireDigest(provenance.artifactDigest);
  for (const field of ['lifecycleEventIds', 'readinessEventIds']) {
    if (hasOwn(provenance, field)) {
      if (!Array.isArray(provenance[field]) || provenance[field].length > 200) fail('MALFORMED_RECEIPT');
      provenance[field].forEach((value) => requireSafeId(value));
    }
  }
}

function statusFrom(value) {
  if (!isRecord(value)) return null;
  if (typeof value.status === 'string') return value.status;
  if (typeof value.verdict === 'string') return value.verdict;
  if (typeof value.semanticVerdict === 'string') return value.semanticVerdict;
  if (typeof value.outcome === 'string') return value.outcome;
  return null;
}

function summaryStatuses(summary) {
  if (!isRecord(summary)) return [];
  return ['status', 'verdict', 'semanticVerdict', 'outcome']
    .filter((field) => typeof summary[field] === 'string')
    .map((field) => summary[field]);
}

function validateSummary(summary, allowedStatuses, allowedFields = null) {
  if (summary === undefined) return null;
  if (allowedFields) requireClosedRecord(summary, allowedFields);
  else requireRecord(summary);
  const status = statusFrom(summary);
  if (status !== null) requireVocabulary(status, allowedStatuses);
  if (hasOwn(summary, 'verdict')) requireVocabulary(summary.verdict, VERDICTS);
  if (hasOwn(summary, 'semanticVerdict')) requireVocabulary(summary.semanticVerdict, VERDICTS);
  if (hasOwn(summary, 'outcome')) requireVocabulary(summary.outcome, STATUS_VALUES);
  if (hasOwn(summary, 'status')) requireVocabulary(summary.status, STATUS_VALUES);
  return status;
}

function validateCost(cost) {
  if (cost === undefined) return;
  requireClosedRecord(cost, COST_FIELDS);
  for (const field of [
    'modelTokens',
    'dispatchCount',
    'semanticReviewCount',
    'remediationRounds',
    'humanTurns',
    'elapsedMs',
    'falseBlockCount',
    'receiptReuseCount',
  ]) {
    if (hasOwn(cost, field)
      && cost[field] !== null
      && (!Number.isSafeInteger(cost[field]) || cost[field] < 0)) fail('MALFORMED_RECEIPT');
  }
}

function normalizedIdentity(payload) {
  const identity = isRecord(payload.identity) ? payload.identity : {};
  const normalized = { ...payload };
  for (const field of IDENTITY_FIELDS) {
    if (!hasOwn(normalized, field) && hasOwn(identity, field)) normalized[field] = identity[field];
  }
  return normalized;
}

function validatePayloadShape(payload) {
  requireClosedRecord(payload, PAYLOAD_FIELDS, [
    'schema',
    'producer',
    'adapter',
    'adapterVersion',
    'eventId',
    'receiptId',
    'sourceCommit',
    'sourceTree',
    'policyVersion',
    'contractVersion',
    'recordedAt',
    'phase',
    'authority',
    'effect',
    'comparison',
    ...IDENTITY_FIELDS,
    'identity',
    'scope',
    'diff',
    'sentinelStatus',
    'reviewGateStatus',
    'provenance',
    ...FALSE_FIELDS,
  ]);
  if (!hasOwn(payload, 'liveness') && !hasOwn(payload, 'processLivenessRole')) {
    fail('MALFORMED_RECEIPT');
  }
  if (hasOwn(payload, 'identity')) {
    requireClosedRecord(payload.identity, NESTED_IDENTITY_FIELDS, NESTED_IDENTITY_FIELDS);
    for (const field of NESTED_IDENTITY_FIELDS) {
      if (!same(payload.identity[field], payload[field])) fail('MIXED_IDENTITY');
    }
  }
  if (hasOwn(payload, 'sentinelOutcome')) {
    validateSummary(payload.sentinelOutcome, STATUS_VALUES, SENTINEL_FIELDS);
    if (hasOwn(payload.sentinelOutcome, 'cost')) validateCost(payload.sentinelOutcome.cost);
  }
  if (hasOwn(payload, 'reviewGate')) {
    validateSummary(payload.reviewGate, STATUS_VALUES, REVIEW_GATE_FIELDS);
    if (hasOwn(payload.reviewGate, 'accepted') && typeof payload.reviewGate.accepted !== 'boolean') {
      fail('MALFORMED_RECEIPT');
    }
    if (hasOwn(payload.reviewGate, 'allowsProgress') && typeof payload.reviewGate.allowsProgress !== 'boolean') {
      fail('MALFORMED_RECEIPT');
    }
    if (hasOwn(payload.reviewGate, 'blockingReasons')) {
      if (!Array.isArray(payload.reviewGate.blockingReasons) || payload.reviewGate.blockingReasons.length > 64) {
        fail('MALFORMED_RECEIPT');
      }
      payload.reviewGate.blockingReasons.forEach((reason) => requireSafeId(reason));
    }
  }
  if (hasOwn(payload, 'reasonCodes')) {
    if (!Array.isArray(payload.reasonCodes) || payload.reasonCodes.length > 64) fail('MALFORMED_RECEIPT');
    payload.reasonCodes.forEach((code) => requireSafeId(code));
  }
}

function validateMigrationObservationPayload(payload, envelope = null) {
  const safePayload = immutable(payload);
  requireRecord(safePayload);
  validatePayloadShape(safePayload);
  if (safePayload.schema !== OBSERVATION_SCHEMA) {
    if (safePayload.schema === undefined || safePayload.schema === null) fail('MALFORMED_RECEIPT');
    fail('UNSUPPORTED_SCHEMA');
  }

  const normalized = normalizedIdentity(safePayload);
  validateIdentity(isRecord(safePayload.identity) ? safePayload.identity : normalized, normalized);
  validateEnvelopeIdentity(normalized, envelope);

  requireVocabulary(normalized.phase, PHASES);
  requireVocabulary(normalized.comparison, COMPARISONS);
  if (normalized.authority !== 'SENTINEL') fail('MALFORMED_RECEIPT');
  if (normalized.effect !== EFFECTS[normalized.phase]) fail('MALFORMED_RECEIPT');

  validateScope(normalized.scope);
  validateDiff(normalized.diff);
  validateProvenance(normalized.provenance);
  for (const field of [
    'producer',
    'adapter',
    'adapterVersion',
    'eventId',
    'receiptId',
    'sourceCommit',
    'sourceTree',
    'policyVersion',
    'contractVersion',
    'recordedAt',
  ]) {
    if (hasOwn(normalized, field) && hasOwn(normalized.provenance, field)
      && !same(normalized[field], normalized.provenance[field])) fail('MIXED_IDENTITY');
  }

  const sentinelStatus = normalized.sentinelStatus || statusFrom(normalized.sentinelOutcome);
  const reviewGateStatus = normalized.reviewGateStatus || statusFrom(normalized.reviewGate);
  requireVocabulary(sentinelStatus, STATUS_VALUES);
  requireVocabulary(reviewGateStatus, STATUS_VALUES);
  if (hasOwn(normalized, 'sentinelStatus') && normalized.sentinelOutcome) {
    const nestedStatuses = summaryStatuses(normalized.sentinelOutcome);
    if (nestedStatuses.length > 0 && !nestedStatuses.includes(normalized.sentinelStatus)) fail('MIXED_IDENTITY');
  }
  if (hasOwn(normalized, 'reviewGateStatus') && normalized.reviewGate) {
    const nestedStatuses = summaryStatuses(normalized.reviewGate);
    if (nestedStatuses.length > 0 && !nestedStatuses.includes(normalized.reviewGateStatus)) fail('MIXED_IDENTITY');
  }
  validateSummary(normalized.sentinelOutcome, STATUS_VALUES, SENTINEL_FIELDS);
  validateSummary(normalized.reviewGate, STATUS_VALUES, REVIEW_GATE_FIELDS);
  validateCost(normalized.cost);

  const liveness = normalized.liveness || normalized.processLivenessRole;
  requireVocabulary(liveness, ['COMPATIBILITY_ONLY']);
  if (hasOwn(normalized, 'liveness') && hasOwn(normalized, 'processLivenessRole')
    && normalized.liveness !== normalized.processLivenessRole) fail('MIXED_IDENTITY');

  for (const field of FALSE_FIELDS) {
    if (!hasOwn(normalized, field) || normalized[field] !== false) fail('MALFORMED_RECEIPT');
  }

  if (hasOwn(normalized, 'reasonCodes')) {
    if (!Array.isArray(normalized.reasonCodes) || normalized.reasonCodes.length > 64) fail('MALFORMED_RECEIPT');
    normalized.reasonCodes.forEach((code) => requireSafeId(code));
  }
  if (hasOwn(normalized, 'eventId')) requireSafeId(normalized.eventId);
  if (hasOwn(normalized, 'receiptId')) requireSafeId(normalized.receiptId);
  for (const field of ['producer', 'adapter', 'policyVersion', 'contractVersion']) {
    if (hasOwn(normalized, field)) requireText(normalized[field], 128);
  }
  for (const field of ['sourceCommit', 'sourceTree']) {
    if (hasOwn(normalized, field)) {
      if (field === 'sourceCommit' && !COMMIT.test(normalized[field])) fail('MALFORMED_RECEIPT');
      if (field === 'sourceTree' && !TREE.test(normalized[field])) fail('MALFORMED_RECEIPT');
    }
  }
  if (hasOwn(normalized, 'recordedAt')) requireText(normalized.recordedAt, 128);

  return immutable(normalized);
}

function extractIdentity(payload) {
  const normalized = normalizedIdentity(payload);
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, normalized[field]]));
}

function metadataFromPayload(payload, now) {
  const provenance = payload.provenance;
  const producer = payload.producer || provenance.producer;
  const adapter = payload.adapter || provenance.adapter;
  const sourceCommit = payload.sourceCommit || provenance.sourceCommit;
  const sourceTree = payload.sourceTree || provenance.sourceTree;
  const policyVersion = payload.policyVersion || provenance.policyVersion || 'dhpk.migration-policy.v1';
  const contractVersion = payload.contractVersion || provenance.contractVersion || 'dhpk.review-gate.migration.v1';
  let recordedAt = payload.recordedAt;
  if (!recordedAt && typeof now === 'function') {
    let nowValue;
    try {
      nowValue = now();
    } catch (_) {
      fail('MALFORMED_RECEIPT');
    }
    const nowMs = nowValue instanceof Date
      ? nowValue.getTime()
      : typeof nowValue === 'string' ? Date.parse(nowValue) : Number(nowValue);
    if (!Number.isFinite(nowMs)) fail('MALFORMED_RECEIPT');
    recordedAt = new Date(nowMs).toISOString();
  }
  requireSafeId(producer);
  requireSafeId(adapter);
  if (!COMMIT.test(sourceCommit || '') || !TREE.test(sourceTree || '')) fail('MALFORMED_RECEIPT');
  requireText(policyVersion, 128);
  requireText(contractVersion, 128);
  requireText(recordedAt, 128);
  if (!Number.isFinite(Date.parse(recordedAt))) fail('MALFORMED_RECEIPT');
  const eventId = payload.eventId || provenance.eventId
    || `migration-observation:${payload.workId}:${payload.attemptId}:${payload.phase.toLowerCase()}`;
  const receiptId = payload.receiptId || provenance.receiptId || `${eventId}:receipt`;
  requireSafeId(eventId);
  requireSafeId(receiptId);
  return {
    eventId,
    receiptId,
    producer,
    adapter,
    sourceCommit,
    sourceTree,
    policyVersion,
    contractVersion,
    recordedAt,
  };
}

const COORDINATOR_BINDING_FIELDS = Object.freeze([
  ...IDENTITY_FIELDS,
  'producer',
  'adapter',
  'adapterVersion',
  'sourceCommit',
  'sourceTree',
  'policyVersion',
  'contractVersion',
  'recordedAt',
]);
const EVENT_ENVELOPE_FIELDS = Object.freeze(['schema', 'eventId', 'eventType', ...COORDINATOR_BINDING_FIELDS, 'payload']);
const RECEIPT_ENVELOPE_FIELDS = Object.freeze(['schema', 'receiptId', 'kind', ...COORDINATOR_BINDING_FIELDS, 'payload']);

function validateCoordinatorEnvelope(event, receipt, payload) {
  requireClosedRecord(event, EVENT_ENVELOPE_FIELDS, EVENT_ENVELOPE_FIELDS);
  requireClosedRecord(receipt, RECEIPT_ENVELOPE_FIELDS, RECEIPT_ENVELOPE_FIELDS);
  requireRecord(event.payload);
  requireRecord(receipt.payload);
  if (JSON.stringify(event.payload) !== JSON.stringify(receipt.payload)) {
    fail('MIXED_IDENTITY');
  }
  for (const field of COORDINATOR_BINDING_FIELDS) {
    if (!hasOwn(event, field) || !hasOwn(receipt, field) || !hasOwn(payload, field)) {
      fail('MALFORMED_RECEIPT');
    }
    if (!same(event[field], receipt[field]) || !same(event[field], payload[field])) {
      fail('MIXED_IDENTITY');
    }
    if (field === 'attempt') {
      if (!Number.isSafeInteger(event[field]) || event[field] < 1) fail('MALFORMED_RECEIPT');
    } else if (field === 'sourceCommit') {
      if (!COMMIT.test(event[field])) fail('MALFORMED_RECEIPT');
    } else if (field === 'sourceTree') {
      if (!TREE.test(event[field])) fail('MALFORMED_RECEIPT');
    } else if (field === 'policyVersion' || field === 'contractVersion' || field === 'recordedAt') {
      requireText(event[field], 128);
    } else {
      requireSafeId(event[field]);
    }
  }
  for (const field of ['producer', 'adapter', 'adapterVersion']) {
    if (!same(payload[field], payload.provenance[field])) fail('MIXED_IDENTITY');
  }
  for (const field of ['sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt']) {
    if (!same(payload[field], payload.provenance[field])) fail('MIXED_IDENTITY');
  }
  if (!hasOwn(event, 'eventId') || !hasOwn(payload, 'eventId')
    || !hasOwn(receipt, 'receiptId') || !hasOwn(payload, 'receiptId')
    || !hasOwn(payload.provenance, 'eventId') || !hasOwn(payload.provenance, 'receiptId')) {
    fail('MALFORMED_RECEIPT');
  }
  if (event.eventId !== payload.eventId || payload.eventId !== payload.provenance.eventId) {
    fail('MIXED_IDENTITY');
  }
  if (receipt.receiptId !== payload.receiptId || payload.receiptId !== payload.provenance.receiptId) {
    fail('MIXED_IDENTITY');
  }
  if (event.eventId !== payload.eventId) fail('MIXED_IDENTITY');
}

function canonicalInput(input, now) {
  requireRecord(input);
  const hasEnvelope = hasOwn(input, 'event') || hasOwn(input, 'receipt');
  if (hasEnvelope && hasOwn(input, 'observation')) fail('MALFORMED_RECEIPT');
  if (hasEnvelope && (!hasOwn(input, 'event') || !hasOwn(input, 'receipt'))) fail('MALFORMED_RECEIPT');
  if (hasEnvelope) {
    const event = immutable(input.event);
    const receipt = immutable(input.receipt);
    requireRecord(event);
    requireRecord(receipt);
    if (event.eventType !== EVENT_TYPE) fail('MALFORMED_RECEIPT');
    if (event.schema !== STORE_EVENT_SCHEMA || receipt.schema !== EVIDENCE_RECEIPT_SCHEMA
      || receipt.kind !== 'migration-observation') fail('MALFORMED_RECEIPT');
    const payload = validateMigrationObservationPayload(receipt.payload, receipt);
    validateCoordinatorEnvelope(event, receipt, payload);
    for (const field of ENVELOPE_IDENTITY_FIELDS) {
      if (!same(event[field], receipt[field])) fail('MIXED_IDENTITY');
    }
    if (hasOwn(payload, 'eventId') && payload.eventId !== event.eventId) fail('MIXED_IDENTITY');
    return { event, receipt, payload };
  }

  const observation = immutable(input.observation);
  const payload = validateMigrationObservationPayload(observation);
  const metadata = metadataFromPayload(payload, now);
  const identity = extractIdentity(payload);
  const event = {
    schema: STORE_EVENT_SCHEMA,
    eventId: metadata.eventId,
    eventType: EVENT_TYPE,
    ...identity,
    producer: metadata.producer,
    adapter: metadata.adapter,
    adapterVersion: payload.adapterVersion || payload.provenance.adapterVersion || 'migration-coordinator.v1',
    sourceCommit: metadata.sourceCommit,
    sourceTree: metadata.sourceTree,
    policyVersion: metadata.policyVersion,
    contractVersion: metadata.contractVersion,
    recordedAt: metadata.recordedAt,
    payload,
  };
  const receipt = {
    schema: EVIDENCE_RECEIPT_SCHEMA,
    receiptId: metadata.receiptId,
    kind: 'migration-observation',
    ...identity,
    producer: metadata.producer,
    adapter: metadata.adapter,
    adapterVersion: payload.adapterVersion || payload.provenance.adapterVersion || 'migration-coordinator.v1',
    sourceCommit: metadata.sourceCommit,
    sourceTree: metadata.sourceTree,
    policyVersion: metadata.policyVersion,
    contractVersion: metadata.contractVersion,
    recordedAt: metadata.recordedAt,
    payload,
  };
  validateCoordinatorEnvelope(event, receipt, payload);
  return { event: immutable(event), receipt: immutable(receipt), payload };
}

function projectionFrom(payload, history) {
  const normalized = validateMigrationObservationPayload(payload);
  const identity = extractIdentity(normalized);
  return immutable({
    schema: PROJECTION_SCHEMA,
    ...identity,
    phase: normalized.phase,
    authority: 'SENTINEL',
    effect: EFFECTS[normalized.phase],
    comparison: normalized.comparison,
    sentinelStatus: normalized.sentinelStatus || statusFrom(normalized.sentinelOutcome),
    reviewGateStatus: normalized.reviewGateStatus || statusFrom(normalized.reviewGate),
    liveness: 'COMPATIBILITY_ONLY',
    allowsTargetProgress: false,
    automaticPromotion: false,
    retirementEligible: false,
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    revision: history.revision,
    chainDigest: history.chainDigest,
  });
}

function verifyExpectedHead(receiptStore, event, expectedRevision, expectedChainDigest) {
  // ReceiptStore.append enforces the revision but intentionally does not consume
  // a chain digest. Verify the trusted head before allowing a new event through.
  // An exact event duplicate remains idempotent even when the caller retries its
  // original head, so it is allowed to reach append's duplicate path.
  if (typeof receiptStore._replay === 'function') {
    const current = receiptStore._replay(event.workId);
    if (current.events.some((candidate) => candidate.eventId === event.eventId)) return;
  }
  receiptStore.inspect({
    workId: event.workId,
    expectedRevision,
    expectedChainDigest,
  });
}

class MigrationCoordinator {
  constructor({ receiptStore, phase, now = () => Date.now() } = {}) {
    if (!(receiptStore instanceof ReceiptStore)
      && (!receiptStore || typeof receiptStore.append !== 'function' || typeof receiptStore.inspect !== 'function')) {
      throw new TypeError('Migration Coordinator receiptStore must expose append and inspect');
    }
    if (!PHASES.includes(phase)) throw new TypeError('Migration Coordinator phase is unsupported');
    if (typeof now !== 'function') throw new TypeError('Migration Coordinator clock must be a function');
    this.receiptStore = receiptStore;
    this.phase = phase;
    this.now = now;
    Object.freeze(this);
  }

  record({ expectedRevision, expectedChainDigest = null, observation, event, receipt } = {}) {
    const input = observation === undefined ? { event, receipt } : { observation };
    const canonical = canonicalInput(input, this.now);
    if (canonical.payload.phase !== this.phase) fail('STALE_EVIDENCE', 'observation phase does not match coordinator phase');
    verifyExpectedHead(
      this.receiptStore,
      canonical.event,
      expectedRevision,
      expectedChainDigest,
    );
    const appended = this.receiptStore.append({
      expectedRevision,
      expectedChainDigest,
      event: canonical.event,
      receipts: [canonical.receipt],
    });
    const history = this.receiptStore.inspect({
      workId: canonical.event.workId,
      expectedRevision: appended.revision,
      expectedChainDigest: appended.chainDigest,
    });
    const stored = history.receipts.find((candidate) => candidate.receiptId === canonical.receipt.receiptId);
    if (!stored) fail('MALFORMED_RECEIPT');
    return projectionFrom(stored.payload, history);
  }

  inspect({ workId, waveId = null, expectedRevision, expectedChainDigest } = {}) {
    const history = this.receiptStore.inspect({
      workId,
      waveId,
      expectedRevision,
      expectedChainDigest,
    });
    const observations = history.receipts.filter((candidate) => candidate.kind === 'migration-observation');
    if (observations.length === 0) fail('MALFORMED_RECEIPT');
    return projectionFrom(observations[observations.length - 1].payload, history);
  }
}

module.exports = {
  MigrationCoordinator,
  MigrationCoordinatorError,
  validateMigrationObservationPayload,
  OBSERVATION_SCHEMA,
  PROJECTION_SCHEMA,
  EVENT_TYPE,
};
