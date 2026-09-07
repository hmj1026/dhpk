'use strict';
const {
  COMMIT,
  TREE,
  SAFE_ID,
  FINGERPRINT,
  canonicalJson,
  cloneBoundedJson,
  deepFreeze,
} = require('./receipt-primitives');
const { createFinding } = require('./reviewer-contract');
const {
  validateMigrationObservationPayload,
  validatePhaseTransitionPayload,
  PHASE_TRANSITION_SCHEMA,
} = require('./migration-coordinator');
const RECEIPT_SCHEMA = 'dhpk.review-gate.evidence-receipt.v1';
const DECISION_SCHEMA = 'dhpk.workflow.decision.v1';
const VERIFICATION_SCHEMA = 'dhpk.workflow.verification.v1';
const RECEIPT_KINDS = Object.freeze(['decision', 'review', 'verification', 'authority', 'migration-observation']);
const DECISION_FACTS = Object.freeze(['WORK_RECORDED', 'DECISION_REQUIRED', 'DECISION_RESOLVED', 'DECISION_INVALIDATED']);
const VERIFICATION_TYPES = Object.freeze(['IMPLEMENTATION', 'LOCAL_GATE', 'FRESHNESS', 'PROVIDER_MERGE']);
const VERIFICATION_OUTCOMES = Object.freeze(['STARTED', 'COMPLETE', 'PASS', 'FAIL', 'CHANGES_REQUIRED', 'BLOCKED', 'EXPIRED', 'NOT_RUN', 'UNAVAILABLE']);
const ACCEPTED_OUTCOME_COST_SCHEMA = 'dhpk.accepted-outcome-cost.v1';
const COMMAND_OUTCOMES = Object.freeze(['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE']);
const REVIEW_EXECUTION_STATUSES = Object.freeze(['COMPLETE', 'NOT_RUN', 'INTERRUPTED', 'UNAVAILABLE']);
const REVIEW_APPLICABILITIES = Object.freeze(['REQUIRED', 'NOT_APPLICABLE']);
const REVIEW_VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);
const AUTHORITY_URGENCIES = Object.freeze(['BATCHABLE', 'IMMEDIATE_STOP']);
const ROUTING_ROLES = Object.freeze(['planner', 'reasoner', 'tdd-guide']);
const MAX_FUTURE_EVIDENCE_SKEW_MS = 60 * 60 * 1000;
const FORBIDDEN_KEY = /(?:prompt|message|chainofthought|thought|reasoning|transcript|fullsource|sourcecode|fulllog|rawlog|stdout|stderr|authorization|proxy.?authorization|token|password|secret|api.?key|private.?key|signing.?key|cookie|credential)/i;
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/@+-]+$/;
class WorkflowCoordinatorEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WorkflowCoordinatorEvidenceError';
    this.code = code;
    this.context = null;
  }
}
const fail = (code) => {
  throw new WorkflowCoordinatorEvidenceError(code);
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isSafeId = (value) => typeof value === 'string' && SAFE_ID.test(value);
const isFingerprint = (value) => typeof value === 'string' && FINGERPRINT.test(value);
function rejectKey(key, path = [], value, costSchema = null) {
  const normalized = String(key);
  if (normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor') return true;
  const compact = normalized.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const canonicalMetric = path.slice(-3).join('.') === 'acceptedOutcomeCost.metrics.modelTokens'
    && costSchema === ACCEPTED_OUTCOME_COST_SCHEMA
    && (value === null || (Number.isSafeInteger(value) && value >= 0));
  return compact === 'modeltokens' ? !canonicalMetric : FORBIDDEN_KEY.test(compact);
}

const WORKFLOW_JSON_LIMITS = Object.freeze({
  maxNodes: 4000,
  maxDepth: 12,
  maxStringBytes: 4096,
  maxTotalBytes: 1024 * 1024,
  maxKeys: 200,
  maxArrayKeys: 201,
  maxKeyBytes: 4096,
  maxArrayLength: 200,
});

function workflowContextPolicy({ path, descriptors, policyContext }) {
  if (path[path.length - 1] !== 'acceptedOutcomeCost') return policyContext;
  const schema = descriptors.schema;
  return {
    ...(policyContext || {}),
    costSchema: schema && hasOwn(schema, 'value') ? schema.value : null,
  };
}

function workflowPropertyPolicy({ key, path, descriptor, policyContext }) {
  const value = descriptor && hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (rejectKey(key, path, value, policyContext && policyContext.costSchema)) {
    fail('SENSITIVE_EVIDENCE');
  }
  return true;
}

function workflowReject() {
  fail('MALFORMED_RECEIPT');
}

function cloneJson(value) {
  return cloneBoundedJson(value, {
    limits: WORKFLOW_JSON_LIMITS,
    context: { costSchema: null },
    contextPolicy: workflowContextPolicy,
    propertyPolicy: workflowPropertyPolicy,
    onReject: workflowReject,
  });
}

function immutable(value) {
  return deepFreeze(cloneJson(value));
}
function requireRecord(value, code = 'MALFORMED_RECEIPT') {
  if (!isRecord(value)) fail(code);
}
function requireSafe(value, code = 'MALFORMED_RECEIPT') {
  if (!isSafeId(value)) fail(code);
}
function requireText(value, code = 'MALFORMED_RECEIPT') {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
}
function requireTimestamp(value, code = 'MALFORMED_RECEIPT') {
  requireText(value, code);
  if (!Number.isFinite(Date.parse(value))) fail(code);
}
function requireDigest(value, code = 'MALFORMED_RECEIPT') {
  if (!isFingerprint(value)) fail(code);
}
function requireGitIdentity(value, code = 'MALFORMED_RECEIPT') {
  requireRecord(value, code);
  if (!COMMIT.test(value.commit || '') || !TREE.test(value.tree || '')) fail(code);
}
function requireStringArray(value, code = 'MALFORMED_RECEIPT') {
  if (!Array.isArray(value) || value.length > 200) fail(code);
  value.forEach((entry) => requireText(entry, code));
}
function validateReviewEvidence(payload) {
  if (!Array.isArray(payload.evidenceReferences) || payload.evidenceReferences.length === 0) fail('MISSING_REVIEW_EVIDENCE');
  if (payload.evidenceReferences.length > 32) fail('MALFORMED_RECEIPT');
  payload.evidenceReferences.forEach((reference) => requireText(reference));
  if (!Array.isArray(payload.executedCommands) || payload.executedCommands.length === 0) fail('MISSING_REVIEW_EVIDENCE');
  if (payload.executedCommands.length > 32) fail('MALFORMED_RECEIPT');
  const fields = ['command', 'outcome', 'durationMs', 'exitCode', 'reference'];
  for (const summary of payload.executedCommands) {
    requireRecord(summary);
    if (!hasOwn(summary, 'command') || !hasOwn(summary, 'outcome')
      || Object.keys(summary).some((field) => !fields.includes(field))) fail('MALFORMED_RECEIPT');
    if (typeof summary.command !== 'string' || !/^digest:sha256:[a-f0-9]{64}$/.test(summary.command)
      || !COMMAND_OUTCOMES.includes(summary.outcome)) fail('MALFORMED_RECEIPT');
    for (const field of ['durationMs', 'exitCode']) {
      if (summary[field] !== undefined
        && (!Number.isSafeInteger(summary[field]) || summary[field] < 0)) fail('MALFORMED_RECEIPT');
    }
    if (summary.reference !== undefined) requireText(summary.reference);
  }
}
function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function assertSame(left, right, code) {
  if (!same(left, right)) fail(code);
}
function validatePath(value) {
  requireText(value);
  if (!SAFE_PATH.test(value)) fail('MALFORMED_RECEIPT');
}
function validateTrustPolicy(policy) {
  requireRecord(policy);
  if (!Array.isArray(policy.producers) || policy.producers.length > 200) fail('MALFORMED_RECEIPT');
  for (const producer of policy.producers) {
    requireRecord(producer);
    requireSafe(producer.producer);
    requireSafe(producer.adapter);
    if (!Array.isArray(producer.receiptKinds)) fail('MALFORMED_RECEIPT');
    producer.receiptKinds.forEach((kind) => {
      if (!RECEIPT_KINDS.includes(kind)) fail('MALFORMED_RECEIPT');
    });
  }
}
function isTrusted(policy, receipt) {
  return policy.producers.some((producer) => (
    producer.producer === receipt.producer
      && producer.adapter === receipt.adapter
      && Array.isArray(producer.receiptKinds)
      && producer.receiptKinds.includes(receipt.kind)
  ));
}
function validateEnvelope(receipt, policy) {
  requireRecord(receipt);
  if (receipt.schema === undefined) fail('MALFORMED_RECEIPT');
  if (receipt.schema !== RECEIPT_SCHEMA) fail('UNSUPPORTED_SCHEMA');
  for (const field of [
    'receiptId', 'workId', 'waveId', 'planId', 'decisionId',
    'producer', 'adapter', 'sessionId',
  ]) requireSafe(receipt[field]);
  if (receipt.kind === undefined) fail('MALFORMED_RECEIPT');
  if (!RECEIPT_KINDS.includes(receipt.kind)) fail('UNSUPPORTED_KIND');
  if (!COMMIT.test(receipt.sourceCommit || '') || !TREE.test(receipt.sourceTree || '')) fail('MALFORMED_RECEIPT');
  requireText(receipt.policyVersion);
  requireText(receipt.contractVersion);
  requireTimestamp(receipt.recordedAt);
  requireRecord(receipt.payload);
  if (!isTrusted(policy, receipt)) fail('UNTRUSTED_PRODUCER');
}
function validateSharedPayloadIdentity(receipt, payload) {
  for (const field of ['workId', 'waveId', 'planId', 'decisionId']) {
    if (hasOwn(payload, field)) assertSame(payload[field], receipt[field], 'MIXED_IDENTITY');
  }
}
function validateRouting(routing, materialRisks) {
  requireRecord(routing);
  if (!Array.isArray(routing.assistants) || !Array.isArray(routing.writers)) fail('MALFORMED_RECEIPT');
  for (const assistant of routing.assistants) {
    requireRecord(assistant);
    requireSafe(assistant.role);
    if (!ROUTING_ROLES.includes(assistant.role)) fail('ROUTING_ROLE_INVALID');
    requireSafe(assistant.owner);
    if (!Array.isArray(assistant.reasonSignals)) fail('MALFORMED_RECEIPT');
    assistant.reasonSignals.forEach((signal) => {
      requireText(signal);
      if (!materialRisks.includes(signal)) fail('ROUTING_REASON_SIGNAL_MISMATCH');
    });
  }
  if (routing.writers.length === 0) fail('MALFORMED_RECEIPT');
  const declaredPaths = new Set();
  for (const writer of routing.writers) {
    requireRecord(writer);
    requireSafe(writer.owner);
    if (!Array.isArray(writer.paths) || writer.paths.length === 0) fail('MALFORMED_RECEIPT');
    writer.paths.forEach((path) => {
      validatePath(path);
      if (declaredPaths.has(path)) fail('WRITER_PATH_OVERLAP');
      declaredPaths.add(path);
    });
  }
  if (routing.writers.length > 1 && !materialRisks.includes('MULTI_WRITER')) {
    fail('MULTI_WRITER_REQUIRED');
  }
  if (!isSafeId(routing.reconciliationOwner)) {
    if (routing.writers.length > 1) fail('RECONCILIATION_OWNER_REQUIRED');
    fail('MALFORMED_RECEIPT');
  }
  if (routing.writers.length > 1
    && !routing.writers.some((writer) => writer.owner === routing.reconciliationOwner)) {
    fail('RECONCILIATION_OWNER_REQUIRED');
  }
}
function validateReviewRequirements(value) {
  if (!Array.isArray(value) || value.length > 200) fail('MALFORMED_RECEIPT');
  const seen = new Set();
  value.forEach((requirement) => {
    requireRecord(requirement);
    requireSafe(requirement.obligationId);
    if (seen.has(requirement.obligationId)) fail('DUPLICATE_REQUIREMENT');
    seen.add(requirement.obligationId);
    requireSafe(requirement.lane);
  });
}
function validateVerificationRequirements(value) {
  if (!Array.isArray(value) || value.length > 200) fail('MALFORMED_RECEIPT');
  const seen = new Set();
  value.forEach((requirement) => {
    requireRecord(requirement);
    requireSafe(requirement.verificationId);
    if (seen.has(requirement.verificationId)) fail('DUPLICATE_REQUIREMENT');
    seen.add(requirement.verificationId);
    requireSafe(requirement.lane);
    if (!['IMPLEMENTATION', 'LOCAL_GATE'].includes(requirement.evidenceType)) fail('MALFORMED_RECEIPT');
  });
}
function validateAuthorityRequests(value) {
  if (!Array.isArray(value) || value.length > 200) fail('MALFORMED_RECEIPT');
  value.forEach((request) => {
    requireRecord(request);
    requireSafe(request.requestId);
    for (const field of ['question', 'recommendation', 'impact', 'deferralConsequence']) {
      requireText(request[field]);
    }
    if (!AUTHORITY_URGENCIES.includes(request.urgency)) {
      fail('MALFORMED_RECEIPT');
    }
    if (typeof request.blocking !== 'boolean') fail('MALFORMED_RECEIPT');
    if (!Array.isArray(request.alternatives) || request.alternatives.length > 32) fail('MALFORMED_RECEIPT');
    request.alternatives.forEach((alternative) => {
      requireRecord(alternative);
      requireText(alternative.option);
      requireText(alternative.impact);
    });
  });
}
function validateDecision(receipt) {
  const payload = receipt.payload;
  if (payload.schema === undefined || payload.schema === null) fail('MALFORMED_RECEIPT');
  if (payload.schema !== DECISION_SCHEMA) fail('UNSUPPORTED_SCHEMA');
  if (!DECISION_FACTS.includes(payload.fact)) fail('MALFORMED_RECEIPT');
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence <= 0) fail('MALFORMED_RECEIPT');
  if (payload.supersedesReceiptId !== null) requireSafe(payload.supersedesReceiptId);
  validateSharedPayloadIdentity(receipt, payload);
  requireRecord(payload.ownership);
  requireSafe(payload.ownership.judgmentOwner);
  requireSafe(payload.ownership.implementationOwner);
  requireStringArray(payload.materialRisks);
  validateRouting(payload.routing, payload.materialRisks);
  requireDigest(payload.materialRisksHash);
  if (!Array.isArray(payload.governingInputs) || payload.governingInputs.length > 200) fail('MALFORMED_RECEIPT');
  payload.governingInputs.forEach((input) => {
    requireRecord(input);
    requireText(input.reference);
    requireDigest(input.digest);
  });
  requireDigest(payload.governingInputsHash);
  requireDigest(payload.premiseHash);
  requireRecord(payload.scope);
  if (!Array.isArray(payload.scope.paths) || payload.scope.paths.length === 0) fail('MALFORMED_RECEIPT');
  payload.scope.paths.forEach(validatePath);
  requireStringArray(payload.scope.kinds);
  requireDigest(payload.scope.digest);
  requireGitIdentity(payload.baseIdentity);
  requireGitIdentity(payload.headIdentity);
  requireRecord(payload.diff);
  requireDigest(payload.diff.digest);
  requireText(payload.diff.reference);
  validateReviewRequirements(payload.requiredReviews);
  validateVerificationRequirements(payload.requiredVerifications);
  validateAuthorityRequests(payload.authorityRequests);
  if (typeof payload.deliveryAuthorized !== 'boolean') fail('MALFORMED_RECEIPT');
  if (receipt.sourceCommit.toLowerCase() !== payload.headIdentity.commit.toLowerCase()
    || receipt.sourceTree.toLowerCase() !== payload.headIdentity.tree.toLowerCase()) fail('STALE_EVIDENCE');
  return {
    receipt,
    payload,
    type: 'decision',
  };
}
function validateVerification(receipt) {
  const payload = receipt.payload;
  if (payload.schema === undefined || payload.schema === null) fail('MALFORMED_RECEIPT');
  if (payload.schema !== VERIFICATION_SCHEMA) fail('UNSUPPORTED_SCHEMA');
  requireSafe(payload.verificationId);
  requireSafe(payload.lane);
  if (!VERIFICATION_TYPES.includes(payload.evidenceType)) fail('UNSUPPORTED_EVIDENCE_TYPE');
  if (!VERIFICATION_OUTCOMES.includes(payload.outcome)) fail('MALFORMED_RECEIPT');
  if (payload.evidenceType === 'FRESHNESS' && payload.outcome !== 'EXPIRED') fail('MALFORMED_RECEIPT');
  validateSharedPayloadIdentity(receipt, payload);
  if (payload.owner !== undefined) requireSafe(payload.owner);
  if (payload.reasonCodes !== undefined) {
    requireStringArray(payload.reasonCodes);
    payload.reasonCodes.forEach(requireSafe);
  }
  for (const field of ['expiresAt', 'validUntil']) {
    if (payload[field] !== undefined) requireTimestamp(payload[field]);
  }
  if (payload.evidenceType === 'FRESHNESS') {
    requireSafe(payload.targetReceiptId);
    if (payload.outcome !== 'EXPIRED') fail('MALFORMED_RECEIPT');
    requireDigest(payload.scopeDigest);
    requireDigest(payload.governingInputsHash);
    requireDigest(payload.premiseHash);
    if (!Array.isArray(payload.evidenceReferences) || payload.evidenceReferences.length === 0) {
      fail('MALFORMED_RECEIPT');
    }
    payload.evidenceReferences.forEach((reference) => requireText(reference));
  }
  return {
    receipt,
    payload,
    type: 'verification',
  };
}
function validateReview(receipt) {
  requireSafe(receipt.obligationId);
  requireSafe(receipt.lane);
  const payload = receipt.payload;
  if (hasOwn(payload, 'effect') && !['OBSERVE_ONLY', 'ENFORCE'].includes(payload.effect)) fail('MALFORMED_RECEIPT');
  const required = [
    'eventId', 'decisionId', 'planId', 'obligationId', 'lane', 'scopeDigest',
    'baseIdentity', 'headIdentity', 'diff', 'materialRisks', 'materialRisksHash',
    'reasonSignals', 'reasonSignalsHash', 'governingInputs', 'governingInputsHash',
    'policyVersion', 'policyDigest', 'contractVersion', 'requestDigest',
    'resultDigest', 'executionStatus', 'applicability', 'findings', 'inspectedScope',
    'evidenceReferences', 'executedCommands',
  ];
  for (const field of required) if (!hasOwn(payload, field)) fail('MALFORMED_RECEIPT');
  requireSafe(payload.eventId);
  requireSafe(payload.decisionId);
  requireSafe(payload.planId);
  requireSafe(payload.obligationId);
  requireSafe(payload.lane);
  assertSame(payload.decisionId, receipt.decisionId, 'MIXED_IDENTITY');
  assertSame(payload.planId, receipt.planId, 'MIXED_IDENTITY');
  assertSame(payload.obligationId, receipt.obligationId, 'MIXED_IDENTITY');
  assertSame(payload.lane, receipt.lane, 'MIXED_IDENTITY');
  requireDigest(payload.scopeDigest);
  requireGitIdentity(payload.baseIdentity);
  requireGitIdentity(payload.headIdentity);
  requireRecord(payload.diff);
  requireDigest(payload.diff.digest);
  requireText(payload.diff.reference);
  requireStringArray(payload.materialRisks);
  requireDigest(payload.materialRisksHash);
  requireStringArray(payload.reasonSignals);
  requireDigest(payload.reasonSignalsHash);
  if (!Array.isArray(payload.governingInputs)) fail('MALFORMED_RECEIPT');
  payload.governingInputs.forEach((input) => {
    requireRecord(input);
    requireText(input.reference);
    requireDigest(input.digest);
  });
  requireDigest(payload.governingInputsHash);
  requireText(payload.policyVersion);
  requireDigest(payload.policyDigest);
  requireText(payload.contractVersion);
  for (const field of ['requestDigest', 'resultDigest']) requireDigest(payload[field]);
  if (!REVIEW_EXECUTION_STATUSES.includes(payload.executionStatus)
    || !REVIEW_APPLICABILITIES.includes(payload.applicability)) fail('MALFORMED_RECEIPT');
  if (!Array.isArray(payload.findings) || !Array.isArray(payload.inspectedScope)
    || !Array.isArray(payload.evidenceReferences) || !Array.isArray(payload.executedCommands)) {
    fail('MALFORMED_RECEIPT');
  }
  try {
    payload.findings.forEach((finding) => createFinding(finding));
  } catch (_) {
    fail('MALFORMED_RECEIPT');
  }
  if (payload.semanticVerdict !== undefined
    && !REVIEW_VERDICTS.includes(payload.semanticVerdict)) fail('MALFORMED_RECEIPT');
  if (payload.executionStatus === 'COMPLETE' && payload.applicability === 'REQUIRED'
    && !REVIEW_VERDICTS.includes(payload.semanticVerdict)) fail('MALFORMED_RECEIPT');
  if (payload.semanticVerdict === 'PASS'
    && payload.findings.some((finding) => finding.disposition === 'MUST_FIX')) fail('MALFORMED_RECEIPT');
  if (payload.executionStatus === 'COMPLETE' && payload.applicability === 'REQUIRED'
    && payload.semanticVerdict === 'PASS') validateReviewEvidence(payload);
  return {
    receipt,
    payload,
    type: 'review',
  };
}
function validateAuthority(receipt) {
  const payload = receipt.payload;
  const fields = ['eventId', 'target', 'reason', 'risk', 'approver', 'skippedGate', 'remediation', 'issuedAt', 'expiresAt'];
  if (!isRecord(payload) || fields.some((field) => !hasOwn(payload, field))) fail('MALFORMED_RECEIPT');
  if (canonicalJson(Object.keys(payload).sort()) !== canonicalJson(fields.slice().sort())) fail('MALFORMED_RECEIPT');
  requireSafe(payload.eventId);
  requireRecord(payload.target);
  for (const field of ['reason', 'risk', 'approver', 'skippedGate', 'remediation']) requireText(payload[field]);
  requireTimestamp(payload.issuedAt);
  requireTimestamp(payload.expiresAt);
  if (Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)) fail('MALFORMED_RECEIPT');
  const targetKeys = Object.keys(payload.target).sort();
  if (payload.target.type === 'OBLIGATION') {
    if (canonicalJson(targetKeys) !== canonicalJson(['obligationId', 'type'])) fail('MALFORMED_RECEIPT');
    requireSafe(payload.target.obligationId);
    const hasObligation = hasOwn(receipt, 'obligationId');
    const hasLane = hasOwn(receipt, 'lane');
    if (hasObligation !== hasLane) fail('MALFORMED_RECEIPT');
    if (hasObligation) {
      requireSafe(receipt.obligationId);
      requireSafe(receipt.lane);
      if (receipt.obligationId !== payload.target.obligationId) fail('MALFORMED_RECEIPT');
    }
  } else if (payload.target.type === 'WAVE') {
    if (canonicalJson(targetKeys) !== canonicalJson(['type', 'waveId'])) fail('MALFORMED_RECEIPT');
    requireSafe(payload.target.waveId);
    if (hasOwn(receipt, 'obligationId') || hasOwn(receipt, 'lane')) fail('MALFORMED_RECEIPT');
  } else {
    fail('MALFORMED_RECEIPT');
  }
  return { receipt, payload, type: 'authority' };
}
function validateMigrationObservation(receipt) {
  const payload = validateMigrationObservationPayload(receipt.payload, receipt);
  return { receipt, payload, type: 'migration-observation' };
}

function validatePhaseTransitionAuthority(receipt) {
  const payload = validatePhaseTransitionPayload(receipt.payload);
  for (const field of [
    'taskId', 'attemptId', 'dispatchId', 'scopeId', 'diffId',
  ]) requireSafe(receipt[field]);
  if (!Number.isSafeInteger(receipt.attempt) || receipt.attempt < 1) fail('MALFORMED_RECEIPT');
  requireText(receipt.adapterVersion);
  if (receipt.receiptId === payload.eventId) fail('MIXED_IDENTITY');
  return { receipt, payload, type: 'phase-transition-authority' };
}
function validateTypedReceipt(receipt, policy) {
  validateEnvelope(receipt, policy);
  switch (receipt.kind) {
    case 'decision': return validateDecision(receipt);
    case 'verification': return validateVerification(receipt);
    case 'review': return validateReview(receipt);
    case 'authority':
      return receipt.payload && receipt.payload.schema === PHASE_TRANSITION_SCHEMA
        ? validatePhaseTransitionAuthority(receipt)
        : validateAuthority(receipt);
    case 'migration-observation': return validateMigrationObservation(receipt);
    default: fail('MALFORMED_RECEIPT');
  }
}
function safeContext(receipt) {
  if (!isRecord(receipt)) return {};
  const result = {};
  for (const field of ['workId', 'waveId', 'planId', 'decisionId']) {
    if (isSafeId(receipt[field])) result[field] = receipt[field];
  }
  if (isRecord(receipt.payload)) {
    for (const field of ['ownership', 'routing', 'requiredReviews', 'requiredVerifications']) {
      if (result[field] === undefined && receipt.kind === 'decision' && receipt.payload[field] !== undefined) {
        try { result[field] = immutable(receipt.payload[field]); } catch (_) { /* hostile context is omitted */ }
      }
    }
  }
  return result;
}
function identityFor(receipt) {
  const result = {};
  for (const field of ['workId', 'waveId', 'planId', 'decisionId']) {
    if (isSafeId(receipt && receipt[field])) result[field] = receipt[field];
    else result[field] = null;
  }
  return result;
}
function attachContext(error, context) {
  if (error && error.context === null) error.context = context;
  return error;
}
function canonicalReceiptOrder(left, right) {
  const byTime = Date.parse(left.receipt.recordedAt) - Date.parse(right.receipt.recordedAt);
  if (byTime !== 0) return byTime;
  return left.receipt.receiptId.localeCompare(right.receipt.receiptId);
}
function validateIdentity(records) {
  if (records.length === 0) return { workId: null, waveId: null, planId: null, decisionId: null };
  const identity = identityFor(records[0].receipt);
  for (const item of records.slice(1)) {
    const next = identityFor(item.receipt);
    for (const field of ['workId', 'waveId', 'planId', 'decisionId']) {
      if (identity[field] !== next[field]) fail('MIXED_IDENTITY');
    }
  }
  return identity;
}
function validateDecisionChain(decisions) {
  if (decisions.length === 0) return { latest: null };
  const bySequence = new Map();
  for (const item of decisions) {
    const sequence = item.payload.sequence;
    if (bySequence.has(sequence)) fail('DECISION_CHAIN_FORK');
    bySequence.set(sequence, item);
  }
  const ordered = [...bySequence.entries()].sort(([left], [right]) => left - right).map(([, item]) => item);
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    if (item.payload.sequence !== index + 1) fail('DECISION_CHAIN_GAP');
    if (index === 0) {
      if (item.payload.supersedesReceiptId !== null) fail('DECISION_CHAIN_FORK');
    } else {
      const previous = ordered[index - 1];
      if (item.payload.fact !== 'DECISION_INVALIDATED' && previous.payload.fact === 'DECISION_INVALIDATED'
        && item.payload.supersedesReceiptId !== previous.receipt.receiptId) {
        fail('STALE_DECISION_RESURRECTION');
      }
      if (item.payload.supersedesReceiptId !== previous.receipt.receiptId) fail('DECISION_CHAIN_FORK');
      const premiseChanged = !same(item.payload.governingInputs, previous.payload.governingInputs)
        || !same(item.payload.governingInputsHash, previous.payload.governingInputsHash)
        || !same(item.payload.premiseHash, previous.payload.premiseHash);
      if (premiseChanged && item.payload.fact !== 'DECISION_INVALIDATED') {
        fail('DECISION_PREMISE_CONTINUITY');
      }
    }
  }
  return { latest: ordered[ordered.length - 1], ordered };
}
function validateOwnershipChain(decisionChain) {
  if (!decisionChain.ordered || decisionChain.ordered.length === 0) return;
  const first = decisionChain.ordered[0].payload.ownership;
  for (const item of decisionChain.ordered.slice(1)) {
    if (!same(item.payload.ownership, first)) fail('OWNERSHIP_CHAIN_CONFLICT');
  }
}
function validateDecisionBinding(review, decision) {
  if (!decision) fail('DECISION_BINDING_MISMATCH');
  const snapshot = decision.payload;
  const payload = review.payload;
  const requirement = snapshot.requiredReviews.find((candidate) => (
    candidate.obligationId === review.receipt.obligationId
  ));
  if (!requirement || requirement.lane !== review.receipt.lane) fail('DECISION_BINDING_MISMATCH');
  const bindings = [
    [payload.scopeDigest, snapshot.scope.digest],
    [payload.baseIdentity, snapshot.baseIdentity],
    [payload.headIdentity, snapshot.headIdentity],
    [payload.diff, snapshot.diff],
    [payload.materialRisks, snapshot.materialRisks],
    [payload.materialRisksHash, snapshot.materialRisksHash],
    [payload.governingInputs, snapshot.governingInputs],
    [payload.governingInputsHash, snapshot.governingInputsHash],
    [payload.policyVersion, decision.receipt.policyVersion],
    [payload.contractVersion, decision.receipt.contractVersion],
  ];
  if (bindings.some(([left, right]) => !same(left, right))) fail('DECISION_BINDING_MISMATCH');
  if (payload.executionStatus === 'COMPLETE' && payload.applicability === 'REQUIRED'
    && payload.semanticVerdict === 'PASS'
    && !snapshot.scope.paths.every((path) => payload.inspectedScope.includes(path))) {
    fail('DECISION_BINDING_MISMATCH');
  }
}
function validateVerificationBinding(item, decision) {
  const payload = item.payload;
  if (payload.evidenceType === 'FRESHNESS') return;
  const requirement = decision.payload.requiredVerifications.find((candidate) => (
    candidate.verificationId === payload.verificationId
  ));
  if (!requirement || requirement.evidenceType !== payload.evidenceType || requirement.lane !== payload.lane) {
    fail('VERIFICATION_BINDING_MISMATCH');
  }
  const outcomes = requirement.evidenceType === 'IMPLEMENTATION'
    ? ['STARTED', 'COMPLETE']
    : ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'BLOCKED'];
  if (!outcomes.includes(payload.outcome)) fail('MALFORMED_RECEIPT');
  if (payload.evidenceType === 'IMPLEMENTATION') {
    requireSafe(payload.owner);
    if (payload.owner !== decision.payload.ownership.implementationOwner) {
      fail('IMPLEMENTATION_OWNER_MISMATCH');
    }
  }
}
function validateFreshnessBinding(item, records, decision) {
  const payload = item.payload;
  if (!decision) fail('FRESHNESS_BINDING_MISMATCH');
  const target = records.find((candidate) => candidate.receipt.receiptId === payload.targetReceiptId);
  if (!target || !['review', 'verification'].includes(target.kind)
    || target.receipt.receiptId === item.receipt.receiptId
    || Date.parse(target.receipt.recordedAt) >= Date.parse(item.receipt.recordedAt)) {
    fail('FRESHNESS_BINDING_MISMATCH');
  }
  const targetLane = target.kind === 'review' ? target.receipt.lane : target.payload.lane;
  if (targetLane !== payload.lane) fail('FRESHNESS_BINDING_MISMATCH');
  const snapshot = decision.payload;
  if (!same(payload.scopeDigest, snapshot.scope.digest)
    || !same(payload.governingInputsHash, snapshot.governingInputsHash)
    || !same(payload.premiseHash, snapshot.premiseHash)) {
    fail('FRESHNESS_BINDING_MISMATCH');
  }
}
function validateSnapshotBindings(records, decisionChain) {
  const decision = decisionChain.latest;
  if (!decision) return;
  validateOwnershipChain(decisionChain);
  if (decision.payload.fact === 'DECISION_INVALIDATED') return;
  for (const item of records) {
    if (item.kind === 'review') validateDecisionBinding(item, decision);
    if (item.kind === 'verification') {
      validateVerificationBinding(item, decision);
      if (item.payload.evidenceType === 'FRESHNESS') {
        validateFreshnessBinding(item, records, decision);
      }
    }
  }
}
function evaluateReceipts(input, policy) {
  let receipts;
  try {
    receipts = cloneJson(input);
  } catch (error) {
    throw attachContext(error, {});
  }
  if (!Array.isArray(receipts)) {
    const error = new WorkflowCoordinatorEvidenceError('MALFORMED_RECEIPT');
    error.context = {};
    throw error;
  }
  const unique = new Map();
  const records = [];
  let context = {};
  try {
    for (const receipt of receipts) {
      const nextContext = safeContext(receipt);
      for (const [field, value] of Object.entries(nextContext)) {
        if (context[field] === undefined) context[field] = value;
      }
      validateTypedReceipt(receipt, policy);
      const existing = unique.get(receipt.receiptId);
      const digest = canonicalJson(receipt);
      if (existing) {
        if (existing.digest !== digest) fail('CONFLICTING_DUPLICATE_RECEIPT');
        continue;
      }
      const item = {
        receipt,
        digest,
        kind: receipt.kind,
        payload: receipt.payload,
      };
      unique.set(receipt.receiptId, item);
      records.push(item);
    }
    records.sort(canonicalReceiptOrder);
    if (records.length === 0) fail('MALFORMED_RECEIPT');
    const identity = validateIdentity(records);
    const bindings = {
      sourceCommit: records[0].receipt.sourceCommit,
      sourceTree: records[0].receipt.sourceTree,
      policyVersion: records[0].receipt.policyVersion,
      contractVersion: records[0].receipt.contractVersion,
    };
    for (const item of records.slice(1)) {
      const receipt = item.receipt;
      if (receipt.sourceCommit.toLowerCase() !== bindings.sourceCommit.toLowerCase()
        || receipt.sourceTree.toLowerCase() !== bindings.sourceTree.toLowerCase()
        || receipt.policyVersion !== bindings.policyVersion
        || receipt.contractVersion !== bindings.contractVersion) {
        fail('STALE_EVIDENCE');
      }
    }
    const decisions = records.filter((item) => item.kind === 'decision');
    const decisionChain = validateDecisionChain(decisions);
    validateSnapshotBindings(records, decisionChain);
    return {
      accepted: true,
      identity,
      bindings,
      records,
      receipts: records.map((item) => item.receipt),
      decisionChain,
      decisions,
      reviews: records.filter((item) => item.kind === 'review'),
      verifications: records.filter((item) => item.kind === 'verification'),
      authorities: records.filter((item) => item.kind === 'authority'),
      phaseTransitions: records.filter((item) => item.kind === 'authority'
        && item.payload && item.payload.schema === PHASE_TRANSITION_SCHEMA),
      migrationObservations: records.filter((item) => item.kind === 'migration-observation'),
    };
  } catch (error) {
    throw attachContext(error, context);
  }
}
class WorkflowCoordinatorEvidence {
  constructor(options = {}) {
    const safeOptions = immutable(options);
    requireRecord(safeOptions);
    const safeTrustPolicy = immutable(safeOptions.trustPolicy === undefined
      ? { producers: [] } : safeOptions.trustPolicy);
    validateTrustPolicy(safeTrustPolicy);
    const evaluatedAt = safeOptions.evaluatedAt;
    if (evaluatedAt === undefined || evaluatedAt === null) fail('MALFORMED_RECEIPT');
    if (typeof evaluatedAt === 'string') requireTimestamp(evaluatedAt);
    else if (typeof evaluatedAt !== 'number' || !Number.isFinite(evaluatedAt)) fail('MALFORMED_RECEIPT');
    this.trustPolicy = safeTrustPolicy;
    this.evaluatedAt = evaluatedAt;
    Object.freeze(this);
  }

  evaluate(receipts) {
    const evidence = evaluateReceipts(receipts, this.trustPolicy);
    const evaluatedAt = typeof this.evaluatedAt === 'string'
      ? Date.parse(this.evaluatedAt)
      : this.evaluatedAt;
    const latestAllowed = evaluatedAt + MAX_FUTURE_EVIDENCE_SKEW_MS;
    for (const item of evidence.phaseTransitions) {
      const recordedAt = Date.parse(item.receipt.recordedAt);
      if (recordedAt > latestAllowed) fail('STALE_EVIDENCE');
      validatePhaseTransitionPayload(item.payload, () => recordedAt);
    }
    for (const item of evidence.migrationObservations) {
      if (['DUAL_ENFORCE', 'CUTOVER'].includes(item.payload.phase)
        && Date.parse(item.receipt.recordedAt) > latestAllowed) {
        fail('STALE_EVIDENCE');
      }
    }
    return {
      ...evidence,
      reviews: evidence.reviews.filter((item) => item.payload.effect !== 'OBSERVE_ONLY'),
    };
  }
}

module.exports = {
  WorkflowCoordinatorEvidence,
  WorkflowCoordinatorEvidenceError,
  evaluateReceipts,
  RECEIPT_SCHEMA,
  DECISION_SCHEMA,
  VERIFICATION_SCHEMA,
  DECISION_FACTS,
  VERIFICATION_TYPES,
  VERIFICATION_OUTCOMES,
  immutableEvidence: immutable,
};
