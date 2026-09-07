'use strict';

const {
  canonicalJson,
  sha256,
} = require('./receipt-primitives');
const {
  createReviewRequest,
  createReviewResult,
  REVIEWER_CONTRACT_VERSION,
} = require('./reviewer-contract');
const {
  validateReviewPlan,
} = require('./risk-router');
const {
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
} = require('./review-gate-receipt-store');

const PLAN_REGISTERED = 'PLAN_REGISTERED';
const REVIEW_RESULT_RECORDED = 'REVIEW_RESULT_RECORDED';
const INPUTS_INVALIDATED = 'INPUTS_INVALIDATED';
const AUTHORITY_OVERRIDE_RECORDED = 'AUTHORITY_OVERRIDE_RECORDED';
const REVIEW_GATE_EVENT_TYPES = Object.freeze({
  PLAN_REGISTERED,
  REVIEW_RESULT_RECORDED,
  INPUTS_INVALIDATED,
  AUTHORITY_OVERRIDE_RECORDED,
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const GIT_ID = /^[a-f0-9]{40}$/;
const COMMAND_OUTCOMES = Object.freeze([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'BLOCKED',
  'UNAVAILABLE',
]);
const EVENT_FIELDS = Object.freeze([
  'schema',
  'eventId',
  'eventType',
  'workId',
  'waveId',
  'planId',
  'decisionId',
  'producer',
  'adapter',
  'sessionId',
  'sourceCommit',
  'sourceTree',
  'policyVersion',
  'contractVersion',
  'recordedAt',
  'payload',
]);
const AUTHORITY_RECEIPT_FIELDS = Object.freeze([
  'schema',
  'receiptId',
  'kind',
  'workId',
  'waveId',
  'planId',
  'decisionId',
  'producer',
  'adapter',
  'sessionId',
  'sourceCommit',
  'sourceTree',
  'policyVersion',
  'contractVersion',
  'recordedAt',
  'payload',
]);
const AUTHORITY_PAYLOAD_FIELDS = Object.freeze([
  'eventId',
  'target',
  'reason',
  'risk',
  'approver',
  'skippedGate',
  'remediation',
  'issuedAt',
  'expiresAt',
]);
const COMMAND_DIGEST = /^digest:sha256:[a-f0-9]{64}$/;
const OBSERVE_ONLY = 'OBSERVE_ONLY';
const ENFORCE = 'ENFORCE';
const REVIEW_EFFECTS = Object.freeze([OBSERVE_ONLY, ENFORCE]);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const gateError = (code, message) => {
  const error = new Error(message);
  error.name = 'ReviewGateError';
  error.code = code;
  return error;
};

const fail = (code, message) => {
  throw gateError(code, message);
};

const clone = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) fail('MALFORMED_EVIDENCE', 'cyclic evidence is not supported');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((child) => clone(child, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('MALFORMED_EVIDENCE', 'evidence must contain plain JSON records');
    }
    result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child, seen)]));
  }
  seen.delete(value);
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
const digest = (value) => `sha256:${sha256(canonicalJson(value))}`;

const requireRecord = (value, field) => {
  if (!isRecord(value)) fail('MALFORMED_EVIDENCE', `${field} must be a record`);
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('MALFORMED_EVIDENCE', `${field} must be a non-empty string`);
  }
};

const requireSafeId = (value, field) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail('MALFORMED_EVIDENCE', `${field} is not a safe identifier`);
  }
};

const requireGitIdentity = (value, field) => {
  requireString(value, field);
  if (!GIT_ID.test(value)) fail('MALFORMED_EVIDENCE', `${field} is not a Git identity`);
};

const requireTimestamp = (value, field) => {
  requireString(value, field);
  if (!Number.isFinite(Date.parse(value))) fail('MALFORMED_EVIDENCE', `${field} is not a timestamp`);
};

const exactKeys = (value, expected, field) => {
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(orderedExpected)) {
    fail('MALFORMED_EVIDENCE', `${field} must contain exactly ${orderedExpected.join(', ')}`);
  }
};

const same = (left, right, field, code = 'FOREIGN_EVIDENCE') => {
  if (canonicalJson(left) !== canonicalJson(right)) fail(code, `${field} does not match`);
};

const eventIdentity = (event, plan) => {
  same(event.workId, plan.workId, 'workId');
  same(event.waveId, plan.waveId, 'waveId');
  same(event.planId, plan.planId, 'planId');
  same(event.decisionId, plan.decisionId, 'decisionId');
  same(event.sourceCommit, plan.headIdentity.commit, 'sourceCommit', 'STALE_EVIDENCE');
  same(event.sourceTree, plan.headIdentity.tree, 'sourceTree', 'STALE_EVIDENCE');
  same(event.policyVersion, plan.policyVersion, 'policyVersion', 'STALE_EVIDENCE');
  same(event.contractVersion, plan.contractVersion, 'contractVersion', 'STALE_EVIDENCE');
};

const validateCommonEvent = (event) => {
  requireRecord(event, 'event');
  if (event.schema !== STORE_EVENT_SCHEMA) fail('UNSUPPORTED_SCHEMA', 'event schema is unsupported');
  for (const field of ['eventId', 'workId', 'waveId', 'planId', 'decisionId', 'producer', 'adapter', 'sessionId']) {
    requireSafeId(event[field], `event.${field}`);
  }
  requireGitIdentity(event.sourceCommit, 'event.sourceCommit');
  requireGitIdentity(event.sourceTree, 'event.sourceTree');
  requireString(event.policyVersion, 'event.policyVersion');
  requireString(event.contractVersion, 'event.contractVersion');
  requireTimestamp(event.recordedAt, 'event.recordedAt');
  requireRecord(event.payload, 'event.payload');
};

const validateCommandSummaries = (commands) => {
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > 32) {
    fail('MALFORMED_EVIDENCE', 'executedCommands must be a non-empty bounded array');
  }
  return commands.map((summary, index) => {
    requireRecord(summary, `executedCommands[${index}]`);
    const allowed = ['command', 'outcome', 'durationMs', 'exitCode', 'reference'];
    const actualKeys = Object.keys(summary);
    if (!Object.prototype.hasOwnProperty.call(summary, 'command')
      || !Object.prototype.hasOwnProperty.call(summary, 'outcome')) {
      fail('MALFORMED_EVIDENCE', `executedCommands[${index}] requires command and outcome`);
    }
    if (actualKeys.some((key) => !allowed.includes(key))) {
      fail('MALFORMED_EVIDENCE', `executedCommands[${index}] contains an unsupported field`);
    }
    if (typeof summary.command !== 'string' || summary.command.trim() === ''
      || summary.command.length > 512 || /[\u0000-\u001f\u007f]/.test(summary.command)) {
      fail('MALFORMED_EVIDENCE', `executedCommands[${index}].command is invalid`);
    }
    if (!COMMAND_OUTCOMES.includes(summary.outcome)) {
      fail('MALFORMED_EVIDENCE', `executedCommands[${index}].outcome is invalid`);
    }
    if (summary.durationMs !== undefined
      && (!Number.isSafeInteger(summary.durationMs) || summary.durationMs < 0)) {
      fail('MALFORMED_EVIDENCE', `executedCommands[${index}].durationMs is invalid`);
    }
    if (summary.exitCode !== undefined
      && (!Number.isSafeInteger(summary.exitCode) || summary.exitCode < 0)) {
      fail('MALFORMED_EVIDENCE', `executedCommands[${index}].exitCode is invalid`);
    }
    if (summary.reference !== undefined) requireString(summary.reference, `executedCommands[${index}].reference`);
    const sanitizedCommand = COMMAND_DIGEST.test(summary.command)
      ? summary.command
      : `digest:sha256:${sha256(summary.command)}`;
    return {
      ...clone(summary),
      command: sanitizedCommand,
    };
  });
};

const validateEvidenceReferences = (result) => {
  if (!Array.isArray(result.evidenceReferences) || result.evidenceReferences.length > 64) {
    fail('MALFORMED_EVIDENCE', 'result.evidenceReferences is not bounded');
  }
  for (const [index, reference] of result.evidenceReferences.entries()) {
    requireString(reference, `result.evidenceReferences[${index}]`);
    if (reference.length > 512) fail('MALFORMED_EVIDENCE', 'evidence reference is too long');
  }
  if (result.executionStatus === 'COMPLETE' && result.applicability === 'REQUIRED'
    && result.evidenceReferences.length === 0) {
    fail('MISSING_EVIDENCE', 'a completed required result needs evidence references');
  }
};

const buildReviewRequest = (plan, obligation, priorFindings = []) => createReviewRequest({
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
  priorFindings,
  contractVersion: REVIEWER_CONTRACT_VERSION,
});

const planObligation = (plan, obligationId) => {
  const obligation = plan.obligations.find((candidate) => candidate.obligationId === obligationId);
  if (!obligation) fail('FOREIGN_EVIDENCE', 'result obligation is not declared by the Review Plan');
  return obligation;
};

const validateResultScope = (inspectedScope, plannedPaths) => {
  if (!Array.isArray(inspectedScope)) fail('MALFORMED_EVIDENCE', 'result.inspectedScope must be an array');
  const inspected = new Set();
  for (const [index, path] of inspectedScope.entries()) {
    requireString(path, `result.inspectedScope[${index}]`);
    inspected.add(path);
  }
  for (const plannedPath of plannedPaths) {
    if (!inspected.has(plannedPath)) {
      fail('MISSING_SCOPE', `result.inspectedScope is missing planned path ${plannedPath}`);
    }
  }
};

const buildReceiptPayload = (event, plan, validated) => {
  const { request, result, executedCommands, obligation } = validated;
  const materialRisksHash = digest(plan.materialRisks);
  const reasonSignalsHash = digest(obligation.reasonSignals);
  const payload = {
    eventId: event.eventId,
    decisionId: plan.decisionId,
    planId: plan.planId,
    obligationId: obligation.obligationId,
    lane: obligation.lane,
    scopeDigest: plan.scope.digest,
    baseIdentity: plan.baseIdentity,
    headIdentity: plan.headIdentity,
    diff: plan.diff,
    materialRisks: plan.materialRisks,
    materialRisksHash,
    reasonSignals: obligation.reasonSignals,
    reasonSignalsHash,
    governingInputs: plan.governingInputs,
    governingInputsHash: digest(plan.governingInputs),
    policyVersion: plan.policyVersion,
    policyDigest: plan.policyDigest,
    contractVersion: plan.contractVersion,
    requestDigest: digest(request),
    resultDigest: digest(result),
    executionStatus: result.executionStatus,
    applicability: result.applicability,
    findings: result.findings,
    inspectedScope: result.inspectedScope,
    evidenceReferences: result.evidenceReferences,
    executedCommands,
  };
  if (REVIEW_EFFECTS.includes(event.effect)) payload.effect = event.effect;
  if (result.semanticVerdict !== undefined) payload.semanticVerdict = result.semanticVerdict;
  return payload;
};

class ReviewGateEvidence {
  constructor({ trustPolicy } = {}) {
    if (!isRecord(trustPolicy) || !Array.isArray(trustPolicy.producers)) {
      throw new TypeError('Review Gate trustPolicy.producers must be an array');
    }
    this.trustPolicy = immutable(trustPolicy);
  }

  immutable(value) {
    return immutable(value);
  }

  digest(value) {
    return digest(value);
  }

  validatePlan(plan) {
    return validateReviewPlan(plan);
  }

  validateCommonEvent(event) {
    validateCommonEvent(event);
  }

  validateEventType(eventType) {
    if (!Object.values(REVIEW_GATE_EVENT_TYPES).includes(eventType)) {
      fail('UNSUPPORTED_EVENT_TYPE', `event type ${String(eventType)} is not supported in this Review Gate slice`);
    }
  }

  trustedProducer(event, eventType, lane = null) {
    return this.trustPolicy.producers.some((entry) => (
      isRecord(entry)
      && entry.producer === event.producer
      && entry.adapter === event.adapter
      && Array.isArray(entry.eventTypes)
      && entry.eventTypes.includes(eventType)
      && (lane === null || (Array.isArray(entry.lanes) && entry.lanes.includes(lane)))
    ));
  }

  trustedReceipt(receipt, kind) {
    return this.trustPolicy.producers.some((entry) => (
      isRecord(entry)
      && entry.producer === receipt.producer
      && entry.adapter === receipt.adapter
      && Array.isArray(entry.receiptKinds)
      && entry.receiptKinds.includes(kind)
    ));
  }

  validatePlanEvent(event) {
    validateCommonEvent(event);
    this.validateEventType(event.eventType);
    if (event.eventType !== PLAN_REGISTERED) fail('MALFORMED_EVIDENCE', 'event is not a plan registration');
    exactKeys(event, EVENT_FIELDS, 'PLAN_REGISTERED event');
    exactKeys(event.payload, ['plan'], 'PLAN_REGISTERED payload');
    const plan = validateReviewPlan(event.payload.plan);
    eventIdentity(event, plan);
    if (event.sourceCommit !== plan.headIdentity.commit || event.sourceTree !== plan.headIdentity.tree) {
      fail('STALE_EVIDENCE', 'plan registration source identity is stale');
    }
    return plan;
  }

  validateInputsInvalidatedEvent(event, currentPlan = null) {
    validateCommonEvent(event);
    this.validateEventType(event.eventType);
    if (event.eventType !== INPUTS_INVALIDATED) {
      fail('MALFORMED_EVIDENCE', 'event is not an inputs invalidation');
    }
    exactKeys(event, EVENT_FIELDS, 'INPUTS_INVALIDATED event');
    exactKeys(event.payload, ['plan'], 'INPUTS_INVALIDATED payload');
    const plan = validateReviewPlan(event.payload.plan);
    eventIdentity(event, plan);
    if (currentPlan) {
      same(plan.workId, currentPlan.workId, 'invalidation workId');
      same(plan.decisionId, currentPlan.decisionId, 'invalidation decisionId');
      if (plan.planId === currentPlan.planId) {
        fail('STALE_EVIDENCE', 'inputs invalidation must introduce a new canonical plan');
      }
    }
    return plan;
  }

  buildReviewRequest(plan, obligation, priorFindings = []) {
    return buildReviewRequest(plan, obligation, priorFindings);
  }

  validateReviewEvent(event, plan, priorFindings = []) {
    validateCommonEvent(event);
    this.validateEventType(event.eventType);
    if (event.eventType !== REVIEW_RESULT_RECORDED) fail('MALFORMED_EVIDENCE', 'event is not a review result');
    const eventFields = [...EVENT_FIELDS, 'obligationId', 'lane'];
    if (hasOwn(event, 'effect')) eventFields.push('effect');
    exactKeys(event, eventFields, 'REVIEW_RESULT_RECORDED event');
    if (hasOwn(event, 'effect') && !REVIEW_EFFECTS.includes(event.effect)) {
      fail('MALFORMED_EVIDENCE', 'review event effect is unsupported');
    }
    exactKeys(event.payload, ['request', 'result', 'executedCommands'], 'REVIEW_RESULT_RECORDED payload');
    eventIdentity(event, plan);
    const result = createReviewResult(event.payload.result);
    const obligation = planObligation(plan, result.obligationId);
    same(event.obligationId, obligation.obligationId, 'event.obligationId');
    same(event.lane, obligation.lane, 'event.lane');
    same(result.lane, obligation.lane, 'result.lane');
    same(result.applicability, obligation.applicability, 'result.applicability');
    validateResultScope(result.inspectedScope, plan.scope.paths);
    const request = createReviewRequest(event.payload.request);
    const expectedRequest = buildReviewRequest(plan, obligation, priorFindings);
    same(request, expectedRequest, 'review request');
    validateEvidenceReferences(result);
    const executedCommands = validateCommandSummaries(event.payload.executedCommands);
    return {
      obligation,
      request,
      result,
      executedCommands,
    };
  }

  normalizeReviewEvent(event, validated) {
    const normalized = clone(event);
    normalized.payload = {
      request: validated.request,
      result: validated.result,
      executedCommands: validated.executedCommands,
    };
    return immutable(normalized);
  }

  validateAuthorityEvent(event, plan, { nowMs, checkActive = true } = {}) {
    validateCommonEvent(event);
    this.validateEventType(event.eventType);
    if (event.eventType !== AUTHORITY_OVERRIDE_RECORDED) {
      fail('MALFORMED_EVIDENCE', 'event is not an authority override');
    }
    exactKeys(event, EVENT_FIELDS, 'AUTHORITY_OVERRIDE_RECORDED event');
    exactKeys(event.payload, ['receipt'], 'AUTHORITY_OVERRIDE_RECORDED payload');
    eventIdentity(event, plan);

    const receipt = event.payload.receipt;
    requireRecord(receipt, 'authority receipt');
    if (receipt.kind !== 'authority') fail('UNTRUSTED_PRODUCER', 'receipt kind is not trusted authority evidence');
    if (!this.trustedReceipt(receipt, 'authority')) {
      fail('UNTRUSTED_PRODUCER', 'authority receipt producer is not trusted for this receipt kind');
    }
    const hasObligationId = Object.prototype.hasOwnProperty.call(receipt, 'obligationId');
    const hasLane = Object.prototype.hasOwnProperty.call(receipt, 'lane');
    if (hasObligationId !== hasLane) {
      fail('MALFORMED_EVIDENCE', 'authority receipt obligationId and lane must be supplied together');
    }
    exactKeys(
      receipt,
      hasObligationId ? [...AUTHORITY_RECEIPT_FIELDS, 'obligationId', 'lane'] : AUTHORITY_RECEIPT_FIELDS,
      'authority receipt',
    );
    if (receipt.schema !== EVIDENCE_RECEIPT_SCHEMA) fail('UNSUPPORTED_SCHEMA', 'authority receipt schema is unsupported');
    for (const field of ['receiptId', 'workId', 'waveId', 'planId', 'decisionId', 'producer', 'adapter', 'sessionId']) {
      requireSafeId(receipt[field], `authority receipt.${field}`);
    }
    requireGitIdentity(receipt.sourceCommit, 'authority receipt.sourceCommit');
    requireGitIdentity(receipt.sourceTree, 'authority receipt.sourceTree');
    requireString(receipt.policyVersion, 'authority receipt.policyVersion');
    requireString(receipt.contractVersion, 'authority receipt.contractVersion');
    requireTimestamp(receipt.recordedAt, 'authority receipt.recordedAt');
    exactKeys(receipt.payload, AUTHORITY_PAYLOAD_FIELDS, 'authority receipt.payload');
    for (const field of ['reason', 'risk', 'approver', 'skippedGate', 'remediation']) {
      requireString(receipt.payload[field], `authority receipt.payload.${field}`);
    }
    requireSafeId(receipt.payload.eventId, 'authority receipt.payload.eventId');
    same(receipt.payload.eventId, event.eventId, 'authority receipt eventId');
    requireTimestamp(receipt.payload.issuedAt, 'authority receipt.payload.issuedAt');
    requireTimestamp(receipt.payload.expiresAt, 'authority receipt.payload.expiresAt');
    const issuedAt = Date.parse(receipt.payload.issuedAt);
    const expiresAt = Date.parse(receipt.payload.expiresAt);
    if (!Number.isFinite(nowMs)) fail('MALFORMED_EVIDENCE', 'authority evaluation time is invalid');
    const active = nowMs >= issuedAt && nowMs < expiresAt;
    if (checkActive && nowMs < issuedAt) fail('OVERRIDE_NOT_ACTIVE', 'authority override is not active yet');
    if (checkActive && expiresAt < nowMs) fail('OVERRIDE_EXPIRED', 'authority override has expired');
    if (!(expiresAt > issuedAt)) {
      fail('MALFORMED_EVIDENCE', 'authority receipt expiresAt must be after issuedAt');
    }
    if (checkActive && !active) fail('OVERRIDE_EXPIRED', 'authority override has expired');

    for (const field of ['workId', 'waveId', 'producer', 'adapter', 'sessionId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion']) {
      same(receipt[field], event[field], `authority receipt.${field}`);
    }
    same(receipt.recordedAt, event.recordedAt, 'authority receipt.recordedAt');
    same(receipt.planId, plan.planId, 'authority receipt.planId');
    same(receipt.decisionId, plan.decisionId, 'authority receipt.decisionId');
    same(receipt.sourceCommit, plan.headIdentity.commit, 'authority receipt.sourceCommit', 'STALE_EVIDENCE');
    same(receipt.sourceTree, plan.headIdentity.tree, 'authority receipt.sourceTree', 'STALE_EVIDENCE');
    same(receipt.policyVersion, plan.policyVersion, 'authority receipt.policyVersion', 'STALE_EVIDENCE');
    same(receipt.contractVersion, plan.contractVersion, 'authority receipt.contractVersion', 'STALE_EVIDENCE');

    const target = receipt.payload.target;
    requireRecord(target, 'authority receipt.payload.target');
    let obligation = null;
    if (target.type === 'OBLIGATION') {
      exactKeys(target, ['type', 'obligationId'], 'authority obligation target');
      requireSafeId(target.obligationId, 'authority target.obligationId');
      obligation = planObligation(plan, target.obligationId);
      if (hasObligationId) same(receipt.obligationId, obligation.obligationId, 'authority receipt.obligationId');
      if (hasLane) same(receipt.lane, obligation.lane, 'authority receipt.lane');
    } else if (target.type === 'WAVE') {
      exactKeys(target, ['type', 'waveId'], 'authority wave target');
      requireSafeId(target.waveId, 'authority target.waveId');
      same(target.waveId, plan.waveId, 'authority target.waveId');
      if (hasObligationId) fail('MALFORMED_EVIDENCE', 'WAVE authority receipts cannot carry obligation fields');
    } else {
      fail('MALFORMED_EVIDENCE', 'authority target type is invalid');
    }
    return {
      receipt,
      target,
      obligation,
      active,
      issuedAt,
      expiresAt,
    };
  }

  buildReceipt(event, plan, validated, recordedAt) {
    const payload = buildReceiptPayload(event, plan, validated);
    const receiptId = `review-receipt-${sha256(canonicalJson({
      eventId: event.eventId,
      workId: plan.workId,
      waveId: plan.waveId,
      obligationId: validated.obligation.obligationId,
      requestDigest: payload.requestDigest,
      resultDigest: payload.resultDigest,
    }))}`;
    return {
      schema: EVIDENCE_RECEIPT_SCHEMA,
      receiptId,
      kind: 'review',
      workId: plan.workId,
      waveId: plan.waveId,
      planId: plan.planId,
      decisionId: plan.decisionId,
      obligationId: validated.obligation.obligationId,
      lane: validated.obligation.lane,
      producer: event.producer,
      adapter: event.adapter,
      sessionId: event.sessionId,
      sourceCommit: plan.headIdentity.commit,
      sourceTree: plan.headIdentity.tree,
      policyVersion: plan.policyVersion,
      contractVersion: plan.contractVersion,
      recordedAt,
      payload,
    };
  }

  receiptMatches(receipt, event, plan, validated) {
    const expectedPayload = buildReceiptPayload(event, plan, validated);
    try {
      same(receipt.schema, EVIDENCE_RECEIPT_SCHEMA, 'receipt.schema');
      same(receipt.workId, plan.workId, 'receipt.workId');
      same(receipt.waveId, plan.waveId, 'receipt.waveId');
      same(receipt.planId, plan.planId, 'receipt.planId');
      same(receipt.decisionId, plan.decisionId, 'receipt.decisionId');
      same(receipt.obligationId, validated.obligation.obligationId, 'receipt.obligationId');
      same(receipt.lane, validated.obligation.lane, 'receipt.lane');
      same(receipt.producer, event.producer, 'receipt.producer');
      same(receipt.adapter, event.adapter, 'receipt.adapter');
      same(receipt.sessionId, event.sessionId, 'receipt.sessionId');
      same(receipt.sourceCommit, plan.headIdentity.commit, 'receipt.sourceCommit');
      same(receipt.sourceTree, plan.headIdentity.tree, 'receipt.sourceTree');
      same(receipt.policyVersion, plan.policyVersion, 'receipt.policyVersion');
      same(receipt.contractVersion, plan.contractVersion, 'receipt.contractVersion');
      same(receipt.payload, expectedPayload, 'receipt freshness binding');
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = {
  ReviewGateEvidence,
  REVIEW_GATE_EVENT_TYPES,
};
