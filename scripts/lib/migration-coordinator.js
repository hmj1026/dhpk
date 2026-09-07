'use strict';
const {
  SAFE_ID,
  FINGERPRINT,
  canonicalJson,
  cloneBoundedJson,
  deepFreeze,
  sha256,
} = require('./receipt-primitives');
const {
  ReceiptStore,
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
} = require('./review-gate-receipt-store');
const {
  normalizeLegacyVerdictFields,
  validateLegacyCostProjection,
} = require('./claude-review-gate-legacy-observation');
const OBSERVATION_SCHEMA = 'dhpk.review-gate.migration-observation.v1';
const PROJECTION_SCHEMA = 'dhpk.review-gate-migration-projection.v1';
const EVENT_TYPE = 'MIGRATION_OBSERVATION_RECORDED';
const PHASES = Object.freeze(['BASELINE', 'OBSERVE', 'DUAL_ENFORCE', 'CUTOVER']);
const EFFECTS = Object.freeze({
  BASELINE: 'DISABLED', OBSERVE: 'OBSERVE_ONLY', DUAL_ENFORCE: 'ENFORCE', CUTOVER: 'ENFORCE',
});
const AUTHORITIES = Object.freeze({
  BASELINE: 'SENTINEL',
  OBSERVE: 'SENTINEL',
  DUAL_ENFORCE: 'SENTINEL_AND_REVIEW_GATE',
  CUTOVER: 'REVIEW_GATE',
});
const COMPARISONS = Object.freeze(['AGREE', 'DISAGREE', 'INDETERMINATE']);
const PHASE_TRANSITION_SCHEMA = 'dhpk.review-gate.phase-transition-authority.v1';
const PHASE_TRANSITION_EVENT_TYPE = 'MIGRATION_PHASE_TRANSITION_RECORDED';
const PHASE_TRANSITION_ACTIONS = Object.freeze(['PROMOTE', 'ROLLBACK']);
const PHASE_TRANSITION_PAYLOAD_FIELDS = Object.freeze([
  'schema', 'eventId', 'transitionId', 'action', 'currentPhase', 'targetPhase',
  'evidenceBundle', 'reason', 'approver', 'issuedAt', 'expiresAt',
]);
const PHASE_TRANSITION_EVIDENCE_FIELDS = Object.freeze(['digest', 'reference']);
const PHASE_TRANSITION_IDENTITY_FIELDS = Object.freeze([
  'workId', 'waveId', 'planId', 'decisionId', 'taskId', 'attemptId', 'attempt',
  'sessionId', 'dispatchId', 'scopeId', 'diffId',
]);
const PHASE_TRANSITION_METADATA_FIELDS = Object.freeze([
  'producer', 'adapter', 'adapterVersion', 'sourceCommit', 'sourceTree',
  'policyVersion', 'contractVersion', 'recordedAt',
]);
const PHASE_TRANSITION_EVENT_FIELDS = Object.freeze([
  'schema', 'eventId', 'eventType', ...PHASE_TRANSITION_IDENTITY_FIELDS,
  ...PHASE_TRANSITION_METADATA_FIELDS, 'payload',
]);
const PHASE_TRANSITION_RECEIPT_FIELDS = Object.freeze([
  'schema', 'receiptId', 'kind', ...PHASE_TRANSITION_IDENTITY_FIELDS,
  ...PHASE_TRANSITION_METADATA_FIELDS, 'payload',
]);
const ACCEPTED_OUTCOME_COST_SCHEMA = 'dhpk.accepted-outcome-cost.v1';
const ACCEPTED_OUTCOME_COST_FIELDS = Object.freeze([
  'schema', 'observationId', 'acceptedOutcome', 'metrics', 'telemetryFailures',
  'telemetryFailureCount', 'telemetryStatus', 'retirementEligible',
]);
const ACCEPTED_OUTCOME_COST_METRICS = Object.freeze([
  'modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds',
  'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount',
]);
const TELEMETRY_FAILURE_FIELDS = Object.freeze(['code', 'detail', 'detailSha256']);
const TELEMETRY_STATUSES = Object.freeze(['COMPLETE', 'PARTIAL', 'FAILED']);
const STATUS_VALUES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'PENDING', 'CLEARED', 'NOT_RUN', 'INTERRUPTED', 'UNAVAILABLE', 'CHANGES_REQUIRED', 'INDETERMINATE', 'UNKNOWN']);
const VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED', 'BLOCKED', 'NOT_RUN', 'INDETERMINATE']);
const IDENTITY_FIELDS = Object.freeze(['workId', 'waveId', 'planId', 'decisionId', 'obligationId', 'lane', 'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId']);
const ENVELOPE_IDENTITY_FIELDS = IDENTITY_FIELDS;
const ENVELOPE_METADATA_FIELDS = Object.freeze(['producer', 'adapter', 'adapterVersion', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt']);
const FALSE_FIELDS = Object.freeze(['authorizesApproval', 'clearsSentinel', 'blocksSentinel', 'allowsTargetProgress', 'automaticPromotion', 'retirementEligible']);
const PROVENANCE_FIELDS = Object.freeze(['digest', 'reference', 'producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'readinessEventId', 'lifecycleEventId', 'costObservationId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'artifactDigest', 'recordedAt', 'lifecycleEventIds', 'readinessEventIds']);
const PAYLOAD_FIELDS = Object.freeze(['schema', 'producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt', 'phase', 'authority', 'effect', 'comparison', 'workId', 'decisionId', 'planId', 'waveId', 'obligationId', 'lane', 'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId', 'identity', 'scope', 'diff', 'sentinelStatus', 'reviewGateStatus', 'sentinelOutcome', 'reviewGate', 'acceptedOutcomeCost', 'cost', 'reasonCodes', 'authorizesApproval', 'clearsSentinel', 'blocksSentinel', 'allowsTargetProgress', 'automaticPromotion', 'retirementEligible', 'liveness', 'processLivenessRole', 'provenance']);
const REQUIRED_PAYLOAD_FIELDS = Object.freeze(['schema', 'producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt', 'phase', 'authority', 'effect', 'comparison', ...IDENTITY_FIELDS, 'identity', 'scope', 'diff', 'sentinelStatus', 'reviewGateStatus', 'sentinelOutcome', 'reviewGate', 'acceptedOutcomeCost', 'provenance', ...FALSE_FIELDS]);
const NESTED_IDENTITY_FIELDS = Object.freeze(['taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId']);
const SCOPE_FIELDS = Object.freeze(['paths', 'digest', 'kinds']);
const DIFF_FIELDS = Object.freeze(['digest', 'reference', 'paths']);
const SENTINEL_FIELDS = Object.freeze(['status', 'verdict', 'outcome', 'lifecycleEventId', 'cost']);
const REVIEW_GATE_FIELDS = Object.freeze(['status', 'accepted', 'allowsProgress', 'lifecycleStatus', 'executionStatus', 'applicability', 'semanticVerdict', 'blockingReasons', 'eventId']);
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
function canonicalModelTokens(path, value, costSchema) {
  return path.slice(-3).join('.') === 'acceptedOutcomeCost.metrics.modelTokens'
    && costSchema === ACCEPTED_OUTCOME_COST_SCHEMA
    && (value === null || (Number.isSafeInteger(value) && value >= 0));
}
function forbiddenKey(key, path = [], value, costSchema = null) {
  const normalized = String(key);
  if (normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor') return true;
  const compact = normalized.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return compact === 'modeltokens'
    ? !canonicalModelTokens(path, value, costSchema)
    : FORBIDDEN_KEY.test(compact);
}
const MIGRATION_JSON_LIMITS = Object.freeze({
  maxNodes: MAX_NODES,
  maxDepth: MAX_DEPTH,
  maxStringBytes: MAX_STRING_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxKeys: MAX_KEYS,
  maxArrayKeys: MAX_KEYS + 1,
  maxKeyBytes: MAX_KEY_BYTES,
  maxArrayLength: MAX_KEYS,
});
function migrationContextPolicy({ path, descriptors, policyContext }) {
  if (path[path.length - 1] !== 'acceptedOutcomeCost') return policyContext;
  const schema = descriptors.schema;
  return {
    ...(policyContext || {}),
    costSchema: schema && hasOwn(schema, 'value') ? schema.value : null,
  };
}

function migrationPropertyPolicy({ key, path, descriptor, policyContext }) {
  const value = descriptor && hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (forbiddenKey(key, path, value, policyContext && policyContext.costSchema)) {
    fail('SENSITIVE_EVIDENCE', 'sensitive observation data is not allowed');
  }
  return true;
}

function migrationReject({ reason }) {
  const messages = {
    CYCLE: 'cyclic observation data is not allowed',
    FINITE_NUMBER: 'finite observation numbers are required',
    JSON_VALUE: 'JSON observation data is required',
    NON_PLAIN_PROTOTYPE: 'plain observation records are required',
    SYMBOL_KEY: 'symbol observation keys are not allowed',
    SPARSE_ARRAY: 'dense observation arrays are required',
    ACCESSOR: 'observation accessors are not allowed',
    NON_ENUMERABLE: 'observation accessors are not allowed',
    MAX_ARRAY_LENGTH: 'bounded observation arrays are required',
  };
  fail('MALFORMED_RECEIPT', messages[reason] || 'bounded observation data is required');
}

function cloneJson(value) {
  return cloneBoundedJson(value, {
    limits: MIGRATION_JSON_LIMITS,
    context: { costSchema: null },
    contextPolicy: migrationContextPolicy,
    propertyPolicy: migrationPropertyPolicy,
    onReject: migrationReject,
  });
}

function immutable(value) {
  const cloned = cloneJson(value);
  if (Buffer.byteLength(canonicalJson(cloned), 'utf8') > MAX_TOTAL_BYTES) {
    fail('MALFORMED_RECEIPT', 'bounded observation data is required');
  }
  return deepFreeze(cloned);
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
    'costObservationId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion', 'recordedAt',
    'lifecycleEventIds', 'readinessEventIds',
  ]);
  requireDigest(provenance.digest);
  requireReference(provenance.reference);
  for (const field of ['producer', 'adapter', 'adapterVersion', 'eventId', 'receiptId', 'readinessEventId', 'lifecycleEventId', 'costObservationId']) {
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
function validateAcceptedOutcomeCost(cost) {
  requireClosedRecord(cost, ACCEPTED_OUTCOME_COST_FIELDS, ACCEPTED_OUTCOME_COST_FIELDS);
  if (cost.schema !== ACCEPTED_OUTCOME_COST_SCHEMA || typeof cost.observationId !== 'string') fail('MALFORMED_RECEIPT');
  requireSafeId(cost.observationId);
  if (typeof cost.acceptedOutcome !== 'boolean') fail('MALFORMED_RECEIPT');
  requireClosedRecord(cost.metrics, ACCEPTED_OUTCOME_COST_METRICS, ACCEPTED_OUTCOME_COST_METRICS);
  for (const field of ACCEPTED_OUTCOME_COST_METRICS) {
    const value = cost.metrics[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('MALFORMED_RECEIPT');
  }
  if (!Array.isArray(cost.telemetryFailures) || cost.telemetryFailures.length > 20) fail('MALFORMED_RECEIPT');
  for (const failure of cost.telemetryFailures) {
    requireClosedRecord(failure, TELEMETRY_FAILURE_FIELDS, ['code', 'detail']);
    requireSafeId(failure.code);
    if (failure.detail !== '<redacted>') fail('SENSITIVE_EVIDENCE');
    if (hasOwn(failure, 'detailSha256')) requireDigest(failure.detailSha256);
  }
  if (!Number.isSafeInteger(cost.telemetryFailureCount) || cost.telemetryFailureCount < cost.telemetryFailures.length
    || cost.telemetryFailureCount > 10000) fail('MALFORMED_RECEIPT');
  requireVocabulary(cost.telemetryStatus, TELEMETRY_STATUSES);
  if (typeof cost.retirementEligible !== 'boolean') fail('MALFORMED_RECEIPT');
  const complete = cost.acceptedOutcome && cost.telemetryStatus === 'COMPLETE'
    && cost.telemetryFailureCount === 0 && cost.telemetryFailures.length === 0
    && ACCEPTED_OUTCOME_COST_METRICS.every((field) => cost.metrics[field] !== null);
  if (cost.retirementEligible !== complete) fail('MALFORMED_RECEIPT');
}
function normalizedIdentity(payload) {
  const identity = isRecord(payload.identity) ? payload.identity : {};
  const normalized = { ...payload };
  for (const field of IDENTITY_FIELDS) {
    if (!hasOwn(normalized, field) && hasOwn(identity, field)) normalized[field] = identity[field];
  }
  return normalized;
}
function validateNestedIdentityShape(payload) {
  if (!hasOwn(payload, 'identity')) return;
  requireClosedRecord(payload.identity, NESTED_IDENTITY_FIELDS, NESTED_IDENTITY_FIELDS);
  for (const field of NESTED_IDENTITY_FIELDS) {
    if (!same(payload.identity[field], payload[field])) fail('MIXED_IDENTITY');
  }
}

function validateReviewGateShape(reviewGate) {
  if (hasOwn(reviewGate, 'eventId')) requireSafeId(reviewGate.eventId);
  if (hasOwn(reviewGate, 'accepted') && typeof reviewGate.accepted !== 'boolean') {
    fail('MALFORMED_RECEIPT');
  }
  if (hasOwn(reviewGate, 'allowsProgress') && typeof reviewGate.allowsProgress !== 'boolean') {
    fail('MALFORMED_RECEIPT');
  }
  if (hasOwn(reviewGate, 'blockingReasons')) {
    if (!Array.isArray(reviewGate.blockingReasons) || reviewGate.blockingReasons.length > 64) {
      fail('MALFORMED_RECEIPT');
    }
    reviewGate.blockingReasons.forEach((reason) => requireSafeId(reason));
  }
}

function validateReasonCodes(payload) {
  if (!hasOwn(payload, 'reasonCodes')) return;
  if (!Array.isArray(payload.reasonCodes) || payload.reasonCodes.length > 64) fail('MALFORMED_RECEIPT');
  payload.reasonCodes.forEach((code) => requireSafeId(code));
}

function validateLegacyCost(value) {
  try {
    validateLegacyCostProjection(value);
  } catch (_) {
    fail('MALFORMED_RECEIPT');
  }
}

function validatePayloadShape(payload) {
  requireClosedRecord(payload, PAYLOAD_FIELDS, REQUIRED_PAYLOAD_FIELDS);
  if (!hasOwn(payload, 'liveness') && !hasOwn(payload, 'processLivenessRole')) {
    fail('MALFORMED_RECEIPT');
  }
  validateNestedIdentityShape(payload);
  validateSummary(payload.sentinelOutcome, STATUS_VALUES, SENTINEL_FIELDS);
  if (hasOwn(payload.sentinelOutcome, 'lifecycleEventId')) requireSafeId(payload.sentinelOutcome.lifecycleEventId);
  if (hasOwn(payload.sentinelOutcome, 'cost')) validateLegacyCost(payload.sentinelOutcome.cost);
  validateSummary(payload.reviewGate, STATUS_VALUES, REVIEW_GATE_FIELDS);
  validateAcceptedOutcomeCost(payload.acceptedOutcomeCost);
  validateReviewGateShape(payload.reviewGate);
  validateReasonCodes(payload);
  if (hasOwn(payload, 'cost')) validateLegacyCost(payload.cost);
}
function validateObservationSchemaAndIdentity(payload, envelope) {
  const safePayload = immutable(payload);
  requireRecord(safePayload);
  const normalized = normalizedIdentity(safePayload);
  if (isRecord(normalized.sentinelOutcome)) {
    normalized.sentinelOutcome = normalizeLegacyVerdictFields(normalized.sentinelOutcome);
  }
  validatePayloadShape(normalized);
  if (normalized.schema !== OBSERVATION_SCHEMA) {
    if (normalized.schema === undefined || normalized.schema === null) fail('MALFORMED_RECEIPT');
    fail('UNSUPPORTED_SCHEMA');
  }
  validateIdentity(isRecord(normalized.identity) ? normalized.identity : normalized, normalized);
  validateEnvelopeIdentity(normalized, envelope);
  return normalized;
}

function validateObservationPhaseAuthority(normalized) {
  requireVocabulary(normalized.phase, PHASES);
  requireVocabulary(normalized.comparison, COMPARISONS);
  if (normalized.authority !== AUTHORITIES[normalized.phase]) fail('MALFORMED_RECEIPT');
  if (normalized.effect !== EFFECTS[normalized.phase]) fail('MALFORMED_RECEIPT');
  if (normalized.phase === 'DUAL_ENFORCE' || normalized.phase === 'CUTOVER') {
    if (!hasOwn(normalized.reviewGate, 'blockingReasons')
      || !Array.isArray(normalized.reviewGate.blockingReasons)) {
      fail('MALFORMED_RECEIPT');
    }
    if (normalized.comparison !== comparisonForDual(normalized)) fail('MIXED_IDENTITY');
  }
}

function legacyVerdict(summary) {
  if (!isRecord(summary)) return null;
  for (const field of ['verdict', 'semanticVerdict', 'outcome', 'status']) {
    if (typeof summary[field] !== 'string') continue;
    const normalized = summary[field] === 'CLEARED'
      ? 'PASS'
      : normalizeLegacyVerdictFields({ verdict: summary[field] }).verdict;
    if (['PASS', 'CHANGES_REQUIRED', 'BLOCKED'].includes(normalized)) return normalized;
  }
  return null;
}

function comparisonForDual(normalized) {
  const sentinel = legacyVerdict(normalized.sentinelOutcome);
  const reviewGate = legacyVerdict(normalized.reviewGate);
  if (!sentinel || !reviewGate) return 'INDETERMINATE';
  return sentinel === reviewGate ? 'AGREE' : 'DISAGREE';
}

function isRollbackDiagnostic(normalized) {
  return Array.isArray(normalized.reasonCodes)
    && normalized.reasonCodes.includes('MIGRATION_ROLLBACK');
}

function dualAllowsProgress(normalized) {
  if (normalized.phase !== 'DUAL_ENFORCE'
    || isRollbackDiagnostic(normalized)
    || comparisonForDual(normalized) !== 'AGREE') return false;
  const sentinelPass = legacyVerdict(normalized.sentinelOutcome) === 'PASS'
    && ['PASS', 'CLEARED'].includes(normalized.sentinelStatus);
  const gate = normalized.reviewGate;
  const reviewPass = isRecord(gate)
    && gate.accepted === true
    && gate.allowsProgress === true
    && gate.lifecycleStatus === 'RESOLVED'
    && gate.executionStatus === 'COMPLETE'
    && gate.applicability === 'REQUIRED'
    && gate.semanticVerdict === 'PASS'
    && Array.isArray(gate.blockingReasons)
    && gate.blockingReasons.length === 0;
  return sentinelPass && reviewPass;
}

function cutoverAllowsProgress(normalized) {
  // At CUTOVER, Review Gate alone is the completion authority (AC: "Sentinel
  // continues only as a compatibility projection and cannot independently
  // manufacture target workflow completion"). Sentinel's outcome is still
  // compared for safety-disagreement detection, which is what triggers the
  // automatic rollback to DUAL_ENFORCE, but a Sentinel PASS is not required
  // for progress the way it is at DUAL_ENFORCE.
  if (normalized.phase !== 'CUTOVER'
    || isRollbackDiagnostic(normalized)
    || comparisonForDual(normalized) === 'DISAGREE') return false;
  const gate = normalized.reviewGate;
  return isRecord(gate)
    && gate.accepted === true
    && gate.allowsProgress === true
    && gate.lifecycleStatus === 'RESOLVED'
    && gate.executionStatus === 'COMPLETE'
    && gate.applicability === 'REQUIRED'
    && gate.semanticVerdict === 'PASS'
    && Array.isArray(gate.blockingReasons)
    && gate.blockingReasons.length === 0;
}

function validateObservationEvidenceBinding(normalized) {
  validateScope(normalized.scope);
  validateDiff(normalized.diff);
  validateProvenance(normalized.provenance);
  const sentinelLifecycleId = normalized.sentinelOutcome.lifecycleEventId;
  const provenanceLifecycleId = normalized.provenance.lifecycleEventId;
  if (hasOwn(normalized.sentinelOutcome, 'lifecycleEventId') !== hasOwn(normalized.provenance, 'lifecycleEventId')
    || sentinelLifecycleId !== provenanceLifecycleId
    || normalized.acceptedOutcomeCost.observationId !== normalized.provenance.costObservationId) {
    fail('MIXED_IDENTITY');
  }
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
}

function validateObservationStatusCoherence(normalized) {
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
  return {
    sentinelStatus,
    reviewGateStatus,
  };
}

function validateObservationCostCoherence(normalized, sentinelStatus) {
  validateAcceptedOutcomeCost(normalized.acceptedOutcomeCost);
  const costDigest = sha256(normalized.taskId);
  const validCostIds = [
    `legacy-${costDigest.slice(0, 32)}`,
    `legacy-sha256:${costDigest}`,
  ];
  const sentinelVerdicts = [normalized.sentinelOutcome.verdict, normalized.sentinelOutcome.outcome]
    .map((value) => normalizeLegacyVerdictFields({ verdict: value }).verdict)
    .filter((value) => ['PASS', 'CHANGES_REQUIRED', 'BLOCKED'].includes(value));
  if (new Set(sentinelVerdicts).size > 1) fail('MIXED_IDENTITY');
  const sentinelAccepted = (sentinelVerdicts[0] || sentinelStatus) === 'PASS';
  if (!validCostIds.includes(normalized.acceptedOutcomeCost.observationId)
    || normalized.acceptedOutcomeCost.acceptedOutcome !== sentinelAccepted
    || (hasOwn(normalized.sentinelOutcome, 'lifecycleEventId')
      && !normalized.provenance.lifecycleEventIds.includes(normalized.sentinelOutcome.lifecycleEventId))) {
    fail('MIXED_IDENTITY');
  }
}

function validateObservationPhaseEvidence(normalized) {
  if (normalized.phase === 'OBSERVE' || normalized.phase === 'DUAL_ENFORCE' || normalized.phase === 'CUTOVER') {
    if (!hasOwn(normalized.reviewGate, 'eventId') || !hasOwn(normalized.sentinelOutcome, 'lifecycleEventId')
      || !hasOwn(normalized.provenance, 'lifecycleEventId')) fail('MALFORMED_RECEIPT');
    return;
  }
  if (hasOwn(normalized.reviewGate, 'eventId')) fail('MALFORMED_RECEIPT');
  if (!hasOwn(normalized.sentinelOutcome, 'lifecycleEventId')
    && (normalized.provenance.lifecycleEventIds.length !== 0 || !hasOwn(normalized, 'cost'))) fail('MALFORMED_RECEIPT');
}

function validateObservationLiveness(normalized) {
  const liveness = normalized.liveness || normalized.processLivenessRole;
  requireVocabulary(liveness, ['COMPATIBILITY_ONLY']);
  if (hasOwn(normalized, 'liveness') && hasOwn(normalized, 'processLivenessRole')
    && normalized.liveness !== normalized.processLivenessRole) fail('MIXED_IDENTITY');

  for (const field of FALSE_FIELDS) {
    if (!hasOwn(normalized, field)) fail('MALFORMED_RECEIPT');
    if (field === 'allowsTargetProgress' && normalized.phase === 'DUAL_ENFORCE') {
      if (normalized[field] !== dualAllowsProgress(normalized)) fail('MIXED_IDENTITY');
      continue;
    }
    if (field === 'allowsTargetProgress' && normalized.phase === 'CUTOVER') {
      if (normalized[field] !== cutoverAllowsProgress(normalized)) fail('MIXED_IDENTITY');
      continue;
    }
    if (normalized[field] !== false) fail('MALFORMED_RECEIPT');
  }
}

function validateObservationOptionalMetadata(normalized) {
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
}

function validateMigrationObservationPayload(payload, envelope = null) {
  const normalized = validateObservationSchemaAndIdentity(payload, envelope);
  validateObservationPhaseAuthority(normalized);
  validateObservationEvidenceBinding(normalized);
  const statuses = validateObservationStatusCoherence(normalized);
  validateObservationCostCoherence(normalized, statuses.sentinelStatus);
  validateObservationPhaseEvidence(normalized);
  validateObservationLiveness(normalized);
  validateObservationOptionalMetadata(normalized);

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
function canonicalEnvelopeInput(input) {
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

function coordinatorBindings(payload, metadata, identity) {
  return {
    ...identity,
    producer: metadata.producer,
    adapter: metadata.adapter,
    adapterVersion: payload.adapterVersion || payload.provenance.adapterVersion || 'migration-coordinator.v1',
    sourceCommit: metadata.sourceCommit,
    sourceTree: metadata.sourceTree,
    policyVersion: metadata.policyVersion,
    contractVersion: metadata.contractVersion,
    recordedAt: metadata.recordedAt,
  };
}

function canonicalObservationInput(input, now) {
  const observation = immutable(input.observation);
  const payload = validateMigrationObservationPayload(observation);
  const metadata = metadataFromPayload(payload, now);
  const identity = extractIdentity(payload);
  const bindings = coordinatorBindings(payload, metadata, identity);
  const event = {
    schema: STORE_EVENT_SCHEMA,
    eventId: metadata.eventId,
    eventType: EVENT_TYPE,
    ...bindings,
    payload,
  };
  const receipt = {
    schema: EVIDENCE_RECEIPT_SCHEMA,
    receiptId: metadata.receiptId,
    kind: 'migration-observation',
    ...bindings,
    payload,
  };
  validateCoordinatorEnvelope(event, receipt, payload);
  return { event: immutable(event), receipt: immutable(receipt), payload };
}

function canonicalInput(input, now) {
  requireRecord(input);
  const hasEnvelope = hasOwn(input, 'event') || hasOwn(input, 'receipt');
  if (hasEnvelope && hasOwn(input, 'observation')) fail('MALFORMED_RECEIPT');
  if (hasEnvelope && (!hasOwn(input, 'event') || !hasOwn(input, 'receipt'))) fail('MALFORMED_RECEIPT');
  return hasEnvelope ? canonicalEnvelopeInput(input) : canonicalObservationInput(input, now);
}

function clockMs(now) {
  let value;
  try {
    value = now();
  } catch (_) {
    fail('MALFORMED_RECEIPT');
  }
  const milliseconds = value instanceof Date
    ? value.getTime()
    : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(milliseconds)) fail('MALFORMED_RECEIPT');
  return milliseconds;
}

function validatePhaseTransitionPayload(payload, now = null) {
  const normalized = immutable(payload);
  requireClosedRecord(normalized, PHASE_TRANSITION_PAYLOAD_FIELDS, PHASE_TRANSITION_PAYLOAD_FIELDS);
  if (normalized.schema !== PHASE_TRANSITION_SCHEMA) fail('UNSUPPORTED_SCHEMA');
  requireSafeId(normalized.eventId);
  requireSafeId(normalized.transitionId);
  requireVocabulary(normalized.action, PHASE_TRANSITION_ACTIONS);
  if (!PHASES.includes(normalized.currentPhase)) fail('STALE_EVIDENCE', 'current phase is unsupported');
  if (!PHASES.includes(normalized.targetPhase)) fail('STALE_EVIDENCE', 'target phase is unsupported');
  // Legal edges are exactly one phase forward (PROMOTE) or back (ROLLBACK),
  // and BASELINE never participates in a maintainer-authorized transition: a
  // merged, non-enforcing configuration starts directly at OBSERVE (ADR-0016).
  const currentIndex = PHASES.indexOf(normalized.currentPhase);
  const targetIndex = PHASES.indexOf(normalized.targetPhase);
  const legalPromotion = normalized.action === 'PROMOTE'
    && normalized.currentPhase !== 'BASELINE' && targetIndex === currentIndex + 1;
  const legalRollback = normalized.action === 'ROLLBACK'
    && normalized.targetPhase !== 'BASELINE' && targetIndex === currentIndex - 1;
  if (!legalPromotion && !legalRollback) fail('STALE_EVIDENCE', 'phase transition is not a legal one-phase edge');
  requireClosedRecord(normalized.evidenceBundle, PHASE_TRANSITION_EVIDENCE_FIELDS, PHASE_TRANSITION_EVIDENCE_FIELDS);
  requireDigest(normalized.evidenceBundle.digest);
  requireReference(normalized.evidenceBundle.reference);
  requireText(normalized.reason, MAX_STRING_BYTES);
  requireText(normalized.approver, MAX_STRING_BYTES);
  if (!/^(?:human|maintainer):[A-Za-z0-9._:-]+$/.test(normalized.approver)) {
    fail('UNTRUSTED_PRODUCER');
  }
  requireText(normalized.issuedAt, 128);
  requireText(normalized.expiresAt, 128);
  const issuedAt = Date.parse(normalized.issuedAt);
  const expiresAt = Date.parse(normalized.expiresAt);
  const evaluatedAt = now === null ? null : clockMs(now);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    fail('MALFORMED_RECEIPT');
  }
  if (expiresAt <= issuedAt) {
    if (evaluatedAt !== null && expiresAt <= evaluatedAt) fail('STALE_EVIDENCE', 'phase authority receipt has expired');
    if (evaluatedAt === null) fail('MALFORMED_RECEIPT');
    fail('MALFORMED_RECEIPT');
  }
  if (evaluatedAt !== null && (evaluatedAt < issuedAt || evaluatedAt >= expiresAt)) {
    fail('STALE_EVIDENCE', 'phase authority receipt is not active');
  }
  return normalized;
}

function validatePhaseTransitionBindings(event, receipt, payload) {
  requireClosedRecord(event, PHASE_TRANSITION_EVENT_FIELDS, PHASE_TRANSITION_EVENT_FIELDS);
  requireClosedRecord(receipt, PHASE_TRANSITION_RECEIPT_FIELDS, PHASE_TRANSITION_RECEIPT_FIELDS);
  if (event.schema !== STORE_EVENT_SCHEMA || event.eventType !== PHASE_TRANSITION_EVENT_TYPE) {
    fail('MALFORMED_RECEIPT');
  }
  if (receipt.schema !== EVIDENCE_RECEIPT_SCHEMA || receipt.kind !== 'authority') {
    fail('MALFORMED_RECEIPT');
  }
  requireClosedRecord(event.payload, ['receipt'], ['receipt']);
  if (!same(event.payload.receipt, receipt)) fail('MIXED_IDENTITY');
  if (!same(receipt.payload, payload)) fail('MIXED_IDENTITY');
  for (const field of PHASE_TRANSITION_IDENTITY_FIELDS) {
    if (!hasOwn(event, field) || !hasOwn(receipt, field)) fail('MALFORMED_RECEIPT');
    if (!same(event[field], receipt[field])) fail('MIXED_IDENTITY');
    if (field === 'attempt') {
      if (!Number.isSafeInteger(event[field]) || event[field] < 1) fail('MALFORMED_RECEIPT');
    } else {
      requireSafeId(event[field]);
    }
  }
  for (const field of PHASE_TRANSITION_METADATA_FIELDS) {
    if (!hasOwn(event, field) || !hasOwn(receipt, field)) fail('MALFORMED_RECEIPT');
    if (!same(event[field], receipt[field])) fail('MIXED_IDENTITY');
    if (field === 'sourceCommit' && !COMMIT.test(event[field])) fail('MALFORMED_RECEIPT');
    else if (field === 'sourceTree' && !TREE.test(event[field])) fail('MALFORMED_RECEIPT');
    else if (field === 'recordedAt') {
      requireText(event[field], 128);
      if (!Number.isFinite(Date.parse(event[field]))) fail('MALFORMED_RECEIPT');
    } else if (field === 'producer' || field === 'adapter') requireSafeId(event[field]);
    else if (field === 'adapterVersion' || field === 'policyVersion' || field === 'contractVersion') requireText(event[field], 128);
  }
  if (receipt.payload.eventId !== event.eventId) fail('MIXED_IDENTITY');
  if (receipt.receiptId === receipt.payload.eventId) fail('MALFORMED_RECEIPT');
  requireSafeId(event.eventId);
  requireSafeId(receipt.receiptId);
  return true;
}

function canonicalPhaseTransitionInput(input, now) {
  requireRecord(input);
  const event = immutable(input.event);
  if (input.receipt !== undefined && input.authorityReceipt !== undefined
    && !same(input.receipt, input.authorityReceipt)) {
    fail('MIXED_IDENTITY');
  }
  const receipt = immutable(input.receipt !== undefined ? input.receipt : input.authorityReceipt);
  requireRecord(event);
  requireRecord(receipt);
  const payload = validatePhaseTransitionPayload(receipt.payload, now);
  validatePhaseTransitionBindings(event, receipt, payload);
  return { event, receipt, payload };
}

function latestObservation(history) {
  const observations = history.receipts.filter((candidate) => candidate.kind === 'migration-observation');
  if (observations.length === 0) fail('MALFORMED_RECEIPT', 'migration phase has no observation');
  return observations[observations.length - 1];
}

function phaseTransitionReceipts(history) {
  return history.receipts.filter((candidate) => (
    candidate.kind === 'authority'
    && candidate.payload
    && candidate.payload.schema === PHASE_TRANSITION_SCHEMA
  ));
}

function validateTransitionHistory(history) {
  const transitions = phaseTransitionReceipts(history);
  for (const transitionReceipt of transitions) {
    const event = history.events.find((candidate) => candidate.eventId === transitionReceipt.payload.eventId);
    if (!event) fail('MALFORMED_RECEIPT', 'phase transition event is missing');
    const recordedAt = Date.parse(transitionReceipt.recordedAt);
    if (!Number.isFinite(recordedAt)) fail('MALFORMED_RECEIPT');
    const payload = validatePhaseTransitionPayload(
      transitionReceipt.payload,
      () => recordedAt,
    );
    validatePhaseTransitionBindings(event, transitionReceipt, payload);
    const transitionIndex = history.receipts.lastIndexOf(transitionReceipt);
    const source = history.receipts
      .slice(0, transitionIndex)
      .filter((candidate) => candidate.kind === 'migration-observation')
      .at(-1);
    if (!source) fail('STALE_EVIDENCE', 'phase transition has no preceding observation');
    validateTransitionAgainstObservation(payload, transitionReceipt, source, payload.currentPhase);
  }
  return transitions;
}

function effectivePhase(history) {
  const observation = latestObservation(history);
  const transitionReceipts = phaseTransitionReceipts(history);
  const latestTransition = transitionReceipts[transitionReceipts.length - 1];
  const observationIndex = history.receipts.lastIndexOf(observation);
  const transitionIndex = latestTransition ? history.receipts.lastIndexOf(latestTransition) : -1;
  return transitionIndex > observationIndex ? latestTransition.payload.targetPhase : observation.payload.phase;
}

function assertCoordinatorPhase(history, phase) {
  validateTransitionHistory(history);
  if (history.receipts.filter((candidate) => candidate.kind === 'migration-observation').length === 0) {
    if (PHASES.indexOf(phase) > PHASES.indexOf('OBSERVE')) {
      fail('STALE_EVIDENCE', `${phase} requires an active promotion receipt`);
    }
    return;
  }
  if (effectivePhase(history) !== phase) {
    fail('STALE_EVIDENCE', 'coordinator phase is not active at the trusted receipt head');
  }
}

function replayHead(receiptStore, workId) {
  if (typeof receiptStore._replay !== 'function') return null;
  return receiptStore._replay(workId);
}

function sequenceReceipts(receiptStore, history, eventIndex) {
  const replayed = Array.isArray(history.sequences)
    ? history
    : typeof receiptStore._replay === 'function' ? receiptStore._replay(history.workId) : history;
  const sequence = replayed.sequences && replayed.sequences[eventIndex];
  if (!sequence || typeof receiptStore._readObject !== 'function') return [];
  return sequence.receiptDigests.map((digest) => receiptStore._readObject(digest));
}

function receiptsThroughSequence(receiptStore, history, eventIndex) {
  const replayed = Array.isArray(history.sequences)
    ? history
    : typeof receiptStore._replay === 'function' ? receiptStore._replay(history.workId) : history;
  if (!Array.isArray(replayed.sequences) || typeof receiptStore._readObject !== 'function') {
    return history.receipts;
  }
  return replayed.sequences
    .slice(0, eventIndex + 1)
    .flatMap((sequence) => sequence.receiptDigests.map((digest) => receiptStore._readObject(digest)));
}

function historicalHistoryAt(receiptStore, history, eventIndex) {
  const replayed = Array.isArray(history.sequences)
    ? history
    : typeof receiptStore._replay === 'function' ? receiptStore._replay(history.workId) : history;
  const sequence = replayed.sequences && replayed.sequences[eventIndex];
  if (!sequence) return history;
  return {
    ...history,
    revision: sequence.revision,
    chainDigest: sequence.chainDigest,
    events: replayed.events.slice(0, eventIndex + 1),
    receipts: receiptsThroughSequence(receiptStore, replayed, eventIndex),
  };
}

function duplicateTransitionProjection(receiptStore, history, canonical, eventIndex) {
  const existingEvent = history.events[eventIndex];
  const existingReceipts = sequenceReceipts(receiptStore, history, eventIndex);
  const existingAuthority = existingReceipts.find((candidate) => (
    candidate.receiptId === canonical.receipt.receiptId
  ));
  if (!existingEvent || !same(existingEvent, canonical.event) || !existingAuthority
    || !same(existingAuthority, canonical.receipt)) {
    fail('IDEMPOTENCY_CONFLICT', 'event identity is already bound to different evidence');
  }
  const targetReceipt = canonical.payload.action === 'ROLLBACK'
    ? existingReceipts.find((candidate) => candidate.kind === 'migration-observation')
    : receiptsThroughSequence(receiptStore, history, eventIndex)
      .filter((candidate) => candidate.kind === 'migration-observation')
      .at(-1);
  if (!targetReceipt) fail('MALFORMED_RECEIPT', 'phase transition diagnostic is missing');
  const historicalHistory = historicalHistoryAt(receiptStore, history, eventIndex);
  return projectionFrom(targetReceipt.payload, historicalHistory, canonical.payload.targetPhase);
}

function validateTransitionAgainstObservation(transition, receipt, observation, currentPhase) {
  if (transition.currentPhase !== currentPhase || transition.currentPhase !== observation.payload.phase) {
    fail('STALE_EVIDENCE', 'phase transition current phase is stale');
  }
  const currentIndex = PHASES.indexOf(transition.currentPhase);
  if (transition.action === 'PROMOTE' && transition.targetPhase !== PHASES[currentIndex + 1]) {
    fail('STALE_EVIDENCE');
  }
  if (transition.action === 'ROLLBACK' && transition.targetPhase !== PHASES[currentIndex - 1]) {
    fail('STALE_EVIDENCE');
  }
  for (const field of PHASE_TRANSITION_IDENTITY_FIELDS) {
    if (field === 'sessionId') continue;
    if (!same(receipt[field], observation.payload[field])) fail('MIXED_IDENTITY');
  }
  for (const field of ['sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion']) {
    if (!same(receipt[field], observation.payload[field])) fail('MIXED_IDENTITY');
  }
  if (!same(receipt.payload.evidenceBundle, {
    digest: observation.payload.provenance.digest,
    reference: observation.payload.provenance.reference,
  })) {
    fail('STALE_EVIDENCE', 'phase authority receipt is not bound to the current evidence bundle');
  }
}

function diagnosticRollbackObservation(source, reasonCodes, now, sessionId = null) {
  const normalized = immutable(source.payload);
  const targetPhase = PHASES[PHASES.indexOf(normalized.phase) - 1];
  const eventId = `migration-rollback-${sha256(canonicalJson({
    sourceEventId: normalized.eventId,
    reasonCodes,
  })).slice(0, 32)}`;
  const reviewGate = { ...normalized.reviewGate };
  const provenance = {
    ...normalized.provenance,
    eventId,
    receiptId: `${eventId}:receipt`,
    recordedAt: new Date(clockMs(now)).toISOString(),
  };
  const identity = sessionId
    ? { ...normalized.identity, sessionId }
    : normalized.identity;
  // A rollback landing on DUAL_ENFORCE or CUTOVER still carries the same
  // Sentinel/Review Gate verdicts that triggered it, so the diagnostic must
  // report their real comparison rather than INDETERMINATE — otherwise it
  // would falsely claim the disagreement was resolved by rolling back.
  const targetRequiresComparison = targetPhase === 'DUAL_ENFORCE' || targetPhase === 'CUTOVER';
  const comparison = targetRequiresComparison
    ? comparisonForDual({ ...normalized, reviewGate })
    : 'INDETERMINATE';
  return {
    ...normalized,
    phase: targetPhase,
    authority: AUTHORITIES[targetPhase],
    effect: EFFECTS[targetPhase],
    comparison,
    reviewGate,
    sessionId: sessionId || normalized.sessionId,
    identity,
    reasonCodes: [...new Set(['MIGRATION_ROLLBACK', ...(normalized.reasonCodes || []), ...reasonCodes])],
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    allowsTargetProgress: false,
    automaticPromotion: false,
    retirementEligible: false,
    eventId,
    receiptId: `${eventId}:receipt`,
    recordedAt: provenance.recordedAt,
    provenance,
  };
}

function projectionFrom(payload, history, phaseOverride = null) {
  const normalized = validateMigrationObservationPayload(payload);
  const identity = extractIdentity(normalized);
  const phase = phaseOverride || normalized.phase;
  requireVocabulary(phase, PHASES);
  const projection = {
    schema: PROJECTION_SCHEMA,
    ...identity,
    phase,
    authority: AUTHORITIES[phase],
    effect: EFFECTS[phase],
    comparison: normalized.comparison,
    sentinelStatus: normalized.sentinelStatus || statusFrom(normalized.sentinelOutcome),
    costObservationId: normalized.acceptedOutcomeCost.observationId,
    acceptedOutcomeCost: normalized.acceptedOutcomeCost,
    reviewGateStatus: normalized.reviewGateStatus || statusFrom(normalized.reviewGate),
    liveness: 'COMPATIBILITY_ONLY',
    allowsTargetProgress: phase === 'DUAL_ENFORCE' ? dualAllowsProgress(normalized)
      : phase === 'CUTOVER' ? cutoverAllowsProgress(normalized) : false,
    automaticPromotion: false,
    retirementEligible: false,
    authorizesApproval: false,
    clearsSentinel: false,
    blocksSentinel: false,
    revision: history.revision,
    chainDigest: history.chainDigest,
  };
  if (hasOwn(normalized.sentinelOutcome, 'lifecycleEventId')) {
    projection.lifecycleEventId = normalized.sentinelOutcome.lifecycleEventId;
  }
  return immutable(projection);
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

function appendCanonicalObservation({ receiptStore, canonical, expectedRevision, expectedChainDigest, phaseGuard = true }) {
  const head = replayHead(receiptStore, canonical.event.workId);
  const duplicate = head && head.events.some((candidate) => candidate.eventId === canonical.event.eventId);
  if (phaseGuard && !duplicate) {
    const history = receiptStore.inspect({
      workId: canonical.event.workId,
      expectedRevision,
      expectedChainDigest,
    });
    assertCoordinatorPhase(history, canonical.payload.phase);
  }
  verifyExpectedHead(receiptStore, canonical.event, expectedRevision, expectedChainDigest);
  const appended = receiptStore.append({
    expectedRevision,
    expectedChainDigest,
    event: canonical.event,
    receipts: [canonical.receipt],
  });
  const history = receiptStore.inspect({
    workId: canonical.event.workId,
    expectedRevision: appended.revision,
    expectedChainDigest: appended.chainDigest,
  });
  const stored = history.receipts.find((candidate) => candidate.receiptId === canonical.receipt.receiptId);
  if (!stored) fail('MALFORMED_RECEIPT');
  return projectionFrom(stored.payload, history);
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
    const projection = appendCanonicalObservation({
      receiptStore: this.receiptStore,
      canonical,
      expectedRevision,
      expectedChainDigest,
    });
    if (this.phase === 'CUTOVER' && canonical.payload.comparison === 'DISAGREE') {
      return this.rollback({
        workId: canonical.event.workId,
        expectedRevision: projection.revision,
        expectedChainDigest: projection.chainDigest,
        automatic: true,
        reasonCodes: ['CUTOVER_DISAGREEMENT'],
      });
    }
    return projection;
  }

  transition({ expectedRevision, expectedChainDigest = null, event, receipt, authorityReceipt } = {}) {
    const canonical = canonicalPhaseTransitionInput({
      event,
      receipt,
      authorityReceipt,
    }, this.now);
    return this._appendPhaseTransition({
      expectedRevision,
      expectedChainDigest,
      canonical,
    });
  }

  rollback({
    expectedRevision,
    expectedChainDigest = null,
    workId = null,
    event,
    receipt,
    authorityReceipt,
    automatic = false,
    observation,
    reasonCodes = ['HARD_INVARIANT_ROLLBACK'],
  } = {}) {
    if (automatic) {
      if (!['DUAL_ENFORCE', 'CUTOVER'].includes(this.phase) || event || receipt || authorityReceipt) {
        fail('STALE_EVIDENCE', 'automatic rollback is only available from DUAL_ENFORCE or CUTOVER');
      }
      if (!Array.isArray(reasonCodes) || reasonCodes.length === 0 || reasonCodes.length > 64) {
        fail('MALFORMED_RECEIPT');
      }
      reasonCodes.forEach((code) => requireSafeId(code));
      const sourceWorkId = workId || (observation && observation.workId);
      requireSafeId(sourceWorkId);
      let history;
      try {
        history = this.receiptStore.inspect({
          workId: sourceWorkId,
          expectedRevision,
          expectedChainDigest,
        });
      } catch (error) {
        // A retry may carry the original trusted head while the diagnostic
        // event has already advanced it. Re-read the current head only to
        // discover that deterministic duplicate; a new rollback still has to
        // pass the caller's original head check below.
        if (!error || !['TAMPERED_EVIDENCE', 'REVISION_CONFLICT'].includes(error.code)) throw error;
        const current = replayHead(this.receiptStore, sourceWorkId);
        if (!current) throw error;
        history = this.receiptStore.inspect({
          workId: sourceWorkId,
          expectedRevision: current.revision,
          expectedChainDigest: current.chainDigest,
        });
      }
      const rollbackTargetPhase = PHASES[PHASES.indexOf(this.phase) - 1];
      const dualSources = history.receipts
        .filter((candidate) => candidate.kind === 'migration-observation'
          && candidate.payload && candidate.payload.phase === this.phase)
        .slice()
        .reverse();
      const source = dualSources[0];
      if (source) {
        const candidate = diagnosticRollbackObservation(source, reasonCodes, this.now);
        const eventIndex = history.events.findIndex((entry) => entry.eventId === candidate.eventId);
        if (eventIndex >= 0) {
          const superseded = phaseTransitionReceipts(history).some((transition) => {
            const transitionIndex = history.events.findIndex((entry) => (
              entry.eventId === transition.payload.eventId
            ));
            return transitionIndex > eventIndex;
          });
          if (superseded || effectivePhase(history) !== rollbackTargetPhase) {
            fail('STALE_EVIDENCE', 'automatic rollback has been superseded');
          }
          const stored = sequenceReceipts(this.receiptStore, history, eventIndex)
            .find((entry) => entry.kind === 'migration-observation');
          if (!stored) fail('MALFORMED_RECEIPT', 'rollback diagnostic is missing');
          return projectionFrom(stored.payload, historicalHistoryAt(this.receiptStore, history, eventIndex));
        }
      }
      const currentSource = latestObservation(history);
      if (currentSource.payload.phase !== this.phase) fail('STALE_EVIDENCE');
      // Automatic rollback diagnostics are always derived from the trusted source
      // observation. A caller-provided payload may identify the work above, but
      // it must never replace the coordinator-bound evidence.
      const diagnostic = diagnosticRollbackObservation(currentSource, reasonCodes, this.now);
      const canonical = canonicalObservationInput({ observation: diagnostic }, this.now);
      return appendCanonicalObservation({
        receiptStore: this.receiptStore,
        canonical,
        expectedRevision,
        expectedChainDigest,
        phaseGuard: false,
      });
    }
    const canonical = canonicalPhaseTransitionInput({
      event,
      receipt,
      authorityReceipt,
    }, this.now);
    if (canonical.payload.action !== 'ROLLBACK') fail('STALE_EVIDENCE');
    return this._appendPhaseTransition({
      expectedRevision,
      expectedChainDigest,
      canonical,
    });
  }

  _appendPhaseTransition({ expectedRevision, expectedChainDigest, canonical }) {
    const head = replayHead(this.receiptStore, canonical.event.workId);
    const duplicateIndex = head
      ? head.events.findIndex((candidate) => candidate.eventId === canonical.event.eventId)
      : -1;
    const duplicate = duplicateIndex >= 0;
    if (duplicate) {
      const history = this.receiptStore.inspect({
        workId: canonical.event.workId,
        expectedRevision: head.revision,
        expectedChainDigest: head.chainDigest,
      });
      const transitions = phaseTransitionReceipts(history);
      const latestTransition = transitions[transitions.length - 1];
      if (!latestTransition
        || latestTransition.receiptId !== canonical.receipt.receiptId
        || effectivePhase(history) !== canonical.payload.targetPhase) {
        fail('STALE_EVIDENCE', 'phase transition has been superseded');
      }
      return duplicateTransitionProjection(this.receiptStore, history, canonical, duplicateIndex);
    }
    const history = this.receiptStore.inspect({
      workId: canonical.event.workId,
      expectedRevision,
      expectedChainDigest,
    });
    const source = latestObservation(history);
    assertCoordinatorPhase(history, this.phase);
    validateTransitionAgainstObservation(canonical.payload, canonical.receipt, source, this.phase);
    verifyExpectedHead(
      this.receiptStore,
      canonical.event,
      expectedRevision,
      expectedChainDigest,
    );
    let targetPayload = source.payload;
    const receipts = [canonical.receipt];
    if (canonical.payload.action === 'ROLLBACK') {
      const diagnostic = diagnosticRollbackObservation(
        source,
        ['MAINTAINER_ROLLBACK'],
        this.now,
        canonical.receipt.sessionId,
      );
      const canonicalDiagnostic = canonicalObservationInput({ observation: diagnostic }, this.now);
      targetPayload = canonicalDiagnostic.payload;
      receipts.push(canonicalDiagnostic.receipt);
    }
    const appended = this.receiptStore.append({
      expectedRevision,
      expectedChainDigest,
      event: canonical.event,
      receipts,
    });
    const after = this.receiptStore.inspect({
      workId: canonical.event.workId,
      expectedRevision: appended.revision,
      expectedChainDigest: appended.chainDigest,
    });
    return projectionFrom(targetPayload, after, canonical.payload.targetPhase);
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
    const latestObservationReceipt = observations[observations.length - 1];
    const transitions = validateTransitionHistory(history, this.now);
    const latestTransition = transitions[transitions.length - 1];
    const observationIndex = history.receipts.lastIndexOf(latestObservationReceipt);
    const transitionIndex = latestTransition ? history.receipts.lastIndexOf(latestTransition) : -1;
    const phaseOverride = transitionIndex > observationIndex ? latestTransition.payload.targetPhase : null;
    return projectionFrom(latestObservationReceipt.payload, history, phaseOverride);
  }
}

module.exports = {
  MigrationCoordinator,
  MigrationCoordinatorError,
  validateMigrationObservationPayload,
  validatePhaseTransitionPayload,
  OBSERVATION_SCHEMA,
  PROJECTION_SCHEMA,
  EVENT_TYPE,
  PHASES,
  EFFECTS,
  AUTHORITIES,
  PHASE_TRANSITION_SCHEMA,
  PHASE_TRANSITION_EVENT_TYPE,
};
