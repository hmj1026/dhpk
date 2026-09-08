'use strict';

// Issue #375 retirement evidence is an explicit, read-only boundary. The
// builder consumes Receipt Bundles exported by a real consumer/control-plane;
// it never discovers local stores, mutates migration state, or manufactures a
// CUTOVER outcome from fixtures.

const {
  COMMIT,
  TREE,
  SAFE_ID,
  FINGERPRINT,
  canonicalJson,
  deepFreeze,
  sha256,
} = require('./receipt-primitives');
const { importBundle } = require('./review-gate-receipt-bundle');
const { WorkflowCoordinator } = require('./workflow-coordinator');
const { isTrusted, MAX_FUTURE_EVIDENCE_SKEW_MS } = require('./workflow-coordinator-evidence');
const { groupCostByCohort } = require('./review-gate-conformance');
const {
  PHASE_TRANSITION_SCHEMA,
  validatePhaseTransitionPayload,
} = require('./migration-coordinator');

const LEDGER_SCHEMA = 'dhpk.review-gate.retirement-ledger.v1';
const REPORT_SCHEMA = 'dhpk.review-gate.retirement-report.v1';
const MIN_ACCEPTED_OUTCOMES = 20;
// Issue #375 Option B (openspec/changes/adjust-review-gate-retirement-threshold):
// minimum gap between when a CUTOVER outcome was produced and when the same
// identity may authorize its own promotion, when no distinct-party reviewer
// is available. Time separation alone is not sufficient - it must also be
// corroborated by independently recorded CI verification evidence (see
// validateSingleMaintainerAuthorization).
const SINGLE_MAINTAINER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CI_VERIFICATION_SCHEMA = 'dhpk.workflow.verification.v1';
const MAX_BUNDLES = 1000;
const MAX_DISAGREEMENTS = 1000;
const COST_FIELDS = Object.freeze([
  'modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds',
  'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount',
]);

class RetirementReportError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RetirementReportError';
    this.code = code;
  }
}

const fail = (code) => { throw new RetirementReportError(code); };

const isRecord = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function requireRecord(value, code = 'MALFORMED_LEDGER') {
  if (!isRecord(value)) fail(code);
}

function requireArray(value, code = 'MALFORMED_LEDGER', max = MAX_BUNDLES) {
  if (!Array.isArray(value) || value.length > max) fail(code);
}

function requireText(value, code = 'MALFORMED_LEDGER', maxBytes = 4096) {
  if (typeof value !== 'string' || value.trim() === ''
    || /[\u0000-\u001f\u007f]/.test(value)
    || Buffer.byteLength(value, 'utf8') > maxBytes) fail(code);
}

function requireId(value, code = 'MALFORMED_LEDGER') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(code);
}

function requireDigest(value, code = 'MALFORMED_LEDGER') {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) fail(code);
}

function requireTimestamp(value, code = 'MALFORMED_LEDGER') {
  requireText(value, code, 128);
  if (!Number.isFinite(Date.parse(value))) fail(code);
}

function validateEvidenceLocation(location, ledger) {
  if (location === undefined || location === null) return false;
  requireRecord(location, 'MALFORMED_EVIDENCE_LOCATION');
  requireText(location.reference, 'MALFORMED_EVIDENCE_LOCATION', 256);
  requireDigest(location.digest, 'MALFORMED_EVIDENCE_LOCATION');
  if (/^(?:[A-Za-z]:[\\/]|\/|~[\\/])/.test(location.reference)
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(location.reference)) {
    fail('MALFORMED_EVIDENCE_LOCATION');
  }
  const { evidenceLocation: _ignored, ...content } = ledger;
  const expectedDigest = `sha256:${sha256(canonicalJson(content))}`;
  if (location.digest.toLowerCase() !== expectedDigest) fail('EVIDENCE_LOCATION_MISMATCH');
  return {
    reference: location.reference,
    digest: location.digest.toLowerCase(),
  };
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function identityForEvidence(evidence) {
  const identity = evidence && evidence.identity;
  const bindings = evidence && evidence.bindings;
  if (!isRecord(identity) || !isRecord(bindings)) fail('MALFORMED_BUNDLE');
  for (const field of ['workId', 'waveId', 'planId', 'decisionId']) requireId(identity[field]);
  if (!COMMIT.test(bindings.sourceCommit || '') || !TREE.test(bindings.sourceTree || '')) {
    fail('MALFORMED_BUNDLE');
  }
  return {
    workId: identity.workId,
    waveId: identity.waveId,
    planId: identity.planId,
    decisionId: identity.decisionId,
    sourceCommit: bindings.sourceCommit.toLowerCase(),
    sourceTree: bindings.sourceTree.toLowerCase(),
    policyVersion: bindings.policyVersion,
    contractVersion: bindings.contractVersion,
  };
}

function entryIdentity(entry) {
  requireRecord(entry);
  requireRecord(entry.bundle, 'MALFORMED_BUNDLE');
  requireRecord(entry.expectedIdentity, 'MALFORMED_BUNDLE');
  if (!COMMIT.test(entry.expectedIdentity.commit || '')
    || (entry.expectedIdentity.tree !== undefined && !TREE.test(entry.expectedIdentity.tree || ''))) {
    fail('MALFORMED_BUNDLE');
  }
  for (const field of ['workId', 'waveId', 'planId', 'decisionId']) {
    if (entry.expectedIdentity[field] !== undefined) requireId(entry.expectedIdentity[field], 'MALFORMED_BUNDLE');
  }
  if (entry.disagreements !== undefined) {
    requireArray(entry.disagreements, 'MALFORMED_LEDGER', MAX_DISAGREEMENTS);
    for (const disagreement of entry.disagreements) {
      requireRecord(disagreement, 'MALFORMED_LEDGER');
      requireId(disagreement.observationId, 'MALFORMED_LEDGER');
      requireId(disagreement.obligationId, 'MALFORMED_LEDGER');
      requireId(disagreement.lane, 'MALFORMED_LEDGER');
      if (typeof disagreement.attributed !== 'boolean'
        || typeof disagreement.resolved !== 'boolean'
        || !Array.isArray(disagreement.reasonCodes)
        || disagreement.reasonCodes.length === 0) {
        fail('MALFORMED_LEDGER');
      }
      disagreement.reasonCodes.forEach((code) => requireId(code, 'MALFORMED_LEDGER'));
    }
  }
  return entry.expectedIdentity;
}

function assertExpectedIdentity(expected, actual) {
  if (expected.commit.toLowerCase() !== actual.sourceCommit.toLowerCase()) fail('FOREIGN_IDENTITY');
  if (expected.tree !== undefined && expected.tree.toLowerCase() !== actual.sourceTree.toLowerCase()) {
    fail('FOREIGN_IDENTITY');
  }
  for (const field of ['workId', 'waveId', 'planId', 'decisionId']) {
    if (expected[field] !== undefined && expected[field] !== actual[field]) fail('FOREIGN_IDENTITY');
  }
}

function decisionFor(evidence) {
  const decision = evidence.decisionChain && evidence.decisionChain.latest;
  if (!decision || !decision.payload || decision.payload.fact !== 'DECISION_RESOLVED') {
    fail('MISSING_DECISION');
  }
  if (!Array.isArray(decision.payload.requiredReviews)
    || !Array.isArray(decision.payload.requiredVerifications)
    || typeof decision.payload.materialRisksHash !== 'string'
    || !Array.isArray(decision.payload.materialRisks)) {
    fail('MALFORMED_DECISION');
  }
  requireDigest(decision.payload.materialRisksHash, 'MALFORMED_DECISION');
  return decision;
}

function nonDiagnosticObservations(evidence, phases) {
  const allowed = new Set(Array.isArray(phases) ? phases : [phases]);
  return evidence.migrationObservations.filter((item) => (
    item.payload
      && allowed.has(item.payload.phase)
      && !(Array.isArray(item.payload.reasonCodes)
        && item.payload.reasonCodes.includes('MIGRATION_ROLLBACK'))
  ));
}

function diagnosticObservations(evidence, phase) {
  return evidence.migrationObservations.filter((item) => (
    item.payload
      && item.payload.phase === phase
      && Array.isArray(item.payload.reasonCodes)
      && item.payload.reasonCodes.includes('MIGRATION_ROLLBACK')
  ));
}

function validateCost(cost) {
  requireRecord(cost, 'MALFORMED_COST');
  if (cost.schema !== 'dhpk.accepted-outcome-cost.v1') fail('MALFORMED_COST');
  requireId(cost.observationId, 'MALFORMED_COST');
  if (typeof cost.acceptedOutcome !== 'boolean') fail('MALFORMED_COST');
  if (!isRecord(cost.metrics)) fail('MALFORMED_COST');
  for (const field of COST_FIELDS) {
    const value = cost.metrics[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('MALFORMED_COST');
  }
  if (!Array.isArray(cost.telemetryFailures)
    || !Number.isSafeInteger(cost.telemetryFailureCount)
    || cost.telemetryFailureCount < 0
    || cost.telemetryFailureCount !== cost.telemetryFailures.length
    || !['COMPLETE', 'PARTIAL', 'FAILED'].includes(cost.telemetryStatus)
    || typeof cost.retirementEligible !== 'boolean') {
    fail('MALFORMED_COST');
  }
  const complete = COST_FIELDS.every((field) => cost.metrics[field] !== null);
  const eligible = cost.acceptedOutcome
    && cost.telemetryStatus === 'COMPLETE'
    && cost.telemetryFailureCount === 0
    && complete;
  if (cost.retirementEligible !== eligible) fail('MALFORMED_COST');
  return cost;
}

function latestReviewMap(evidence) {
  const latest = new Map();
  for (const item of evidence.reviews) {
    const key = `${item.receipt.obligationId}:${item.receipt.lane}`;
    latest.set(key, item);
  }
  return latest;
}

function reviewRequirementsPass(evidence, decision) {
  const reviews = latestReviewMap(evidence);
  for (const requirement of decision.payload.requiredReviews) {
    const item = reviews.get(`${requirement.obligationId}:${requirement.lane}`);
    if (!item || item.payload.executionStatus !== 'COMPLETE'
      || item.payload.applicability !== 'REQUIRED'
      || item.payload.semanticVerdict !== 'PASS'
      || (Array.isArray(item.payload.findings)
        && item.payload.findings.some((finding) => finding && finding.disposition === 'MUST_FIX'))) {
      return false;
    }
  }
  const verifications = new Map(evidence.verifications.map((item) => [item.payload.verificationId, item]));
  for (const requirement of decision.payload.requiredVerifications) {
    const item = verifications.get(requirement.verificationId);
    if (!item) return false;
    const valid = requirement.evidenceType === 'IMPLEMENTATION'
      ? item.payload.outcome === 'COMPLETE'
      : ['PASS', 'COMPLETE'].includes(item.payload.outcome);
    if (!valid) return false;
  }
  return true;
}

function observationIdentity(observation) {
  const payload = observation.payload;
  const identity = payload.identity || {};
  return {
    workId: payload.workId,
    waveId: payload.waveId,
    decisionId: payload.decisionId,
    planId: payload.planId,
    taskId: payload.taskId || identity.taskId,
    attemptId: payload.attemptId || identity.attemptId,
    attempt: payload.attempt || identity.attempt,
    sessionId: payload.sessionId || identity.sessionId,
    dispatchId: payload.dispatchId || identity.dispatchId,
    scopeId: payload.scopeId || identity.scopeId,
    diffId: payload.diffId || identity.diffId,
    sourceCommit: payload.sourceCommit.toLowerCase(),
    sourceTree: payload.sourceTree.toLowerCase(),
    phase: payload.phase,
  };
}

function receiptIdentity(item) {
  const receipt = item.receipt;
  const identity = item.payload && item.payload.identity ? item.payload.identity : {};
  return {
    workId: receipt.workId,
    waveId: receipt.waveId,
    planId: receipt.planId,
    decisionId: receipt.decisionId,
    obligationId: receipt.obligationId,
    lane: receipt.lane,
    taskId: receipt.taskId || (item.payload && item.payload.taskId) || identity.taskId,
    attemptId: receipt.attemptId || (item.payload && item.payload.attemptId) || identity.attemptId,
    attempt: receipt.attempt || (item.payload && item.payload.attempt) || identity.attempt,
    sessionId: receipt.sessionId || (item.payload && item.payload.sessionId) || identity.sessionId,
    dispatchId: receipt.dispatchId || (item.payload && item.payload.dispatchId) || identity.dispatchId,
    scopeId: receipt.scopeId || (item.payload && item.payload.scopeId) || identity.scopeId,
    diffId: receipt.diffId || (item.payload && item.payload.diffId) || identity.diffId,
    sourceCommit: receipt.sourceCommit.toLowerCase(),
    sourceTree: receipt.sourceTree.toLowerCase(),
  };
}

const OBSERVATION_IDENTITY_FIELDS = Object.freeze([
  'workId', 'waveId', 'planId', 'decisionId', 'obligationId', 'lane',
  'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId',
]);

function sameObservationIdentity(left, right) {
  return OBSERVATION_IDENTITY_FIELDS.every((field) => left.payload[field] === right.payload[field]);
}

const AUTHORITY_IDENTITY_FIELDS = Object.freeze([
  'workId', 'waveId', 'planId', 'decisionId', 'taskId', 'attemptId', 'attempt',
  'dispatchId', 'scopeId', 'diffId',
]);

function authorityMatchesOutcome(authority, outcome, source) {
  if (!source || !source.payload || !source.payload.provenance) return false;
  const evidenceBundle = authority.payload && authority.payload.evidenceBundle;
  if (!isRecord(evidenceBundle)
    || evidenceBundle.digest !== source.payload.provenance.digest
    || evidenceBundle.reference !== source.payload.provenance.reference) {
    return false;
  }
  const sourcePayload = source.payload;
  return AUTHORITY_IDENTITY_FIELDS.every((field) => (
    authority[field] === outcome.observationIdentity[field]
      && authority[field] === sourcePayload[field]
  )) && authority.sourceCommit.toLowerCase() === outcome.observationIdentity.sourceCommit
    && authority.sourceCommit.toLowerCase() === sourcePayload.sourceCommit.toLowerCase()
    && authority.sourceTree.toLowerCase() === outcome.observationIdentity.sourceTree
    && authority.sourceTree.toLowerCase() === sourcePayload.sourceTree.toLowerCase();
}

function receiptsForObservation(evidence, target) {
  return evidence.records
    .filter((item) => item.kind !== 'migration-observation' || sameObservationIdentity(item, target))
    .map((item) => item.receipt);
}

function validateObservation(decision, phase, item, entry, reviewPass, allObservations) {
  const payload = item.payload;
  const decisionId = decision.receipt.decisionId;
  if (payload.decisionId !== decisionId) fail('MIXED_IDENTITY');
  const cost = validateCost(payload.acceptedOutcomeCost);
  const identity = observationIdentity(item);
  const safetyDelta = {
    unsafeClearanceCount: 0,
    missedRequiredReviewCount: 0,
    unresolvedDisagreementCount: 0,
    disagreements: [],
  };
  const requiredPairs = new Set(decision.payload.requiredReviews.map((requirement) => (
    `${requirement.obligationId}:${requirement.lane}`
  )));
  const observedPairs = new Set(allObservations.map((observation) => (
    `${observation.payload.obligationId}:${observation.payload.lane}`
  )));
  if (phase === 'CUTOVER' && [...requiredPairs].some((pair) => !observedPairs.has(pair))) {
    safetyDelta.missedRequiredReviewCount += 1;
  }
  if (payload.authorizesApproval || payload.clearsSentinel || payload.blocksSentinel
    || payload.automaticPromotion) safetyDelta.unsafeClearanceCount += 1;
  if (phase === 'CUTOVER' && (payload.allowsTargetProgress !== true || !reviewPass)) {
    safetyDelta.missedRequiredReviewCount += 1;
  }
  if (payload.comparison === 'DISAGREE') {
    const disagreement = entry.disagreements || [];
    const match = disagreement.find((candidate) => (
      candidate.observationId === payload.acceptedOutcomeCost.observationId
        && candidate.obligationId === payload.obligationId
        && candidate.lane === payload.lane
    ));
    if (!match || match.attributed !== true || match.resolved !== true) {
      safetyDelta.unresolvedDisagreementCount += 1;
    }
    safetyDelta.disagreements.push({
      observationId: payload.acceptedOutcomeCost.observationId,
      obligationId: payload.obligationId,
      lane: payload.lane,
      attributed: Boolean(match && match.attributed === true),
      resolved: Boolean(match && match.resolved === true),
      reasonCodes: match && Array.isArray(match.reasonCodes) ? [...match.reasonCodes] : [],
    });
  }
  return { cost, identity, safetyDelta };
}

function evaluateBundle(entry, collection, trustPolicy, generatedAt) {
  const expectedIdentity = entryIdentity(entry);
  const evidence = importBundle({
    bundle: entry.bundle,
    trustPolicy,
    expectedIdentity,
  });
  const identity = identityForEvidence(evidence);
  assertExpectedIdentity(expectedIdentity, {
    ...identity,
    sourceCommit: evidence.bindings.sourceCommit,
    sourceTree: evidence.bindings.sourceTree,
  });
  const decision = decisionFor(evidence);
  const allowedPhases = collection === 'cutover' ? ['CUTOVER'] : ['BASELINE', 'OBSERVE'];
  const phaseObservations = nonDiagnosticObservations(evidence, allowedPhases);
  if (phaseObservations.length === 0) fail('MISSING_MIGRATION_OBSERVATION');
  const phases = new Set(phaseObservations.map((item) => item.payload.phase));
  if (phases.size !== 1) fail('MIXED_PHASE');
  const phase = phaseObservations[0].payload.phase;
  const expectedPhaseControl = phase;
  const coordinator = new WorkflowCoordinator({
    trustPolicy,
    featureControl: { enabled: expectedPhaseControl !== 'BASELINE', phase: expectedPhaseControl === 'BASELINE' ? 'BASELINE' : expectedPhaseControl },
    evaluatedAt: generatedAt,
  });
  const reviewPass = reviewRequirementsPass(evidence, decision);
  const receiptIds = evidence.receipts.map((receipt) => receipt.receiptId);
  const outcomes = phaseObservations.map((item) => {
    const projection = coordinator.reduce(receiptsForObservation(evidence, item));
    const observation = validateObservation(
      decision,
      phase,
      item,
      entry,
      reviewPass,
      phaseObservations,
    );
    if (phase === 'CUTOVER' && (projection.state !== 'MERGE_READY' || !reviewPass)) {
      observation.safetyDelta.missedRequiredReviewCount += 1;
    }
    return {
      cost: observation.cost,
      observationIdentity: observation.identity,
      outcomeId: observation.cost.observationId,
      observationReceiptId: item.receipt.receiptId,
      cohort: decision.payload.materialRisksHash.toLowerCase(),
      materialRisks: decision.payload.materialRisks,
      receiptIds,
      projectionState: projection.state,
      safetyDelta: observation.safetyDelta,
      recordedAt: item.payload.recordedAt,
      sessionId: item.payload.sessionId,
      provenance: {
        digest: item.payload.provenance.digest,
        reference: item.payload.provenance.reference,
      },
    };
  });
  const receiptIdentities = Object.fromEntries(evidence.records.map((item) => [
    item.receipt.receiptId,
    canonicalJson(receiptIdentity(item)),
  ]));
  const receiptDigests = Object.fromEntries(evidence.records.map((item) => [
    item.receipt.receiptId,
    canonicalJson(item.receipt),
  ]));
  const authorityReceipts = evidence.phaseTransitions.map((item) => item.receipt);
  const collectionAuthorities = authorityReceipts.filter((receipt) => (
    receipt.payload.action === 'PROMOTE'
      && receipt.payload.currentPhase === 'DUAL_ENFORCE'
      && receipt.payload.targetPhase === 'CUTOVER'
  ));
  const authorityBindings = collectionAuthorities.map((receipt) => ({
    receiptId: receipt.receiptId,
    outcomeIds: outcomes.filter((outcome) => {
      const source = evidence.migrationObservations
        .filter((candidate) => candidate.payload.phase === 'DUAL_ENFORCE')
        .filter((candidate) => !(candidate.payload.reasonCodes || []).includes('MIGRATION_ROLLBACK'))
        .find((candidate) => authorityMatchesOutcome(receipt, outcome, candidate));
      return Boolean(source);
    })
      .map((outcome) => outcome.outcomeId),
  }));
  return {
    identity,
    decision,
    phase,
    outcomes,
    receiptIdentities,
    receiptDigests,
    authorityReceipts,
    authorityBindings,
  };
}

function validateCollectionAuthority(authority, generatedAt, trustedAuthorities, authorityBindings, eligibleOutcomeIds) {
  if (!authority) return false;
  const receipt = isRecord(authority.receipt) ? authority.receipt : authority;
  if (!isRecord(receipt) || receipt.kind !== 'authority' || !isRecord(receipt.payload)) return false;
  if (!SAFE_ID.test(receipt.receiptId || '') || !trustedAuthorities.has(receipt.receiptId)) return false;
  if (!same(receipt, trustedAuthorities.get(receipt.receiptId))) return false;
  const binding = authorityBindings.get(receipt.receiptId);
  if (!binding || !binding.some((outcomeId) => eligibleOutcomeIds.has(outcomeId))) return false;
  if (receipt.payload.schema !== PHASE_TRANSITION_SCHEMA) return false;
  try {
    validatePhaseTransitionPayload(receipt.payload, () => Date.parse(generatedAt));
  } catch (_) {
    return false;
  }
  return receipt.payload.action === 'PROMOTE'
    && receipt.payload.currentPhase === 'DUAL_ENFORCE'
    && receipt.payload.targetPhase === 'CUTOVER';
}

// Issue #375 Option B: validates the single-maintainer authorization track
// (openspec/changes/adjust-review-gate-retirement-threshold/specs/
// review-gate-retirement-evidence/spec.md, "Requirement: Single-maintainer
// authorization track"). Called only after the base
// validateCollectionAuthority checks (trust, binding, phase shape) already
// passed; this adds the two conditions a distinct-party reviewer would
// otherwise provide for free: the authorizing act must come from a
// different session/identity than the one that produced each outcome it
// authorizes, after a cool-down period, and must be corroborated by
// independently recorded CI verification evidence bound to the same
// outcome's provenance. `ciVerification` is passed as a raw receipt (not
// bundle-imported - see the fixture comment for why), so it is checked
// directly against `isTrusted(trustPolicy, ciReceipt)` here rather than
// through `importBundle`'s producer-trust boundary.
function validateSingleMaintainerAuthorization(authorityReceipt, ciVerification, boundOutcomeIds, outcomesById, trustPolicy, generatedAt) {
  if (boundOutcomeIds.length === 0) return false;
  if (!isRecord(ciVerification) || !isRecord(ciVerification.receipt)) return false;
  const ciReceipt = ciVerification.receipt;
  if (ciReceipt.kind !== 'verification' || !isRecord(ciReceipt.payload)) return false;
  if (!SAFE_ID.test(ciReceipt.receiptId || '')) return false;
  if (!isRecord(trustPolicy) || !isTrusted(trustPolicy, ciReceipt)) return false;
  if (ciReceipt.payload.schema !== CI_VERIFICATION_SCHEMA) return false;
  if (ciReceipt.payload.outcome !== 'PASS') return false;
  if (!isRecord(ciReceipt.payload.evidenceBundle)
    || typeof ciReceipt.payload.evidenceBundle.digest !== 'string'
    || typeof ciReceipt.payload.evidenceBundle.reference !== 'string') return false;
  const evaluatedAt = Date.parse(generatedAt);
  const latestAllowed = evaluatedAt + MAX_FUTURE_EVIDENCE_SKEW_MS;
  const ciRecordedAt = Date.parse(ciReceipt.recordedAt);
  if (!Number.isFinite(ciRecordedAt) || ciRecordedAt > latestAllowed) return false;
  const authorityRecordedAt = Date.parse(authorityReceipt.recordedAt);
  if (!Number.isFinite(authorityRecordedAt) || authorityRecordedAt > latestAllowed) return false;
  for (const outcomeId of boundOutcomeIds) {
    const outcome = outcomesById.get(outcomeId);
    if (!outcome) return false;
    if (authorityReceipt.sessionId === outcome.sessionId) return false;
    const outcomeRecordedAt = Date.parse(outcome.recordedAt);
    if (!Number.isFinite(outcomeRecordedAt) || outcomeRecordedAt > latestAllowed) return false;
    if (authorityRecordedAt - outcomeRecordedAt < SINGLE_MAINTAINER_COOLDOWN_MS) return false;
    if (ciReceipt.payload.evidenceBundle.digest.toLowerCase() !== outcome.provenance.digest.toLowerCase()
      || ciReceipt.payload.evidenceBundle.reference !== outcome.provenance.reference) return false;
  }
  return true;
}

function validateRollbackDrill(drill, trustPolicy, generatedAt) {
  if (!isRecord(drill) || !isRecord(drill.bundle) || !isRecord(drill.expectedIdentity)) return null;
  requireText(drill.isolationReference, 'MALFORMED_ROLLBACK_DRILL', 256);
  const expectedIdentity = entryIdentity(drill);
  const evidence = importBundle({
    bundle: drill.bundle,
    trustPolicy,
    expectedIdentity,
  });
  const identity = identityForEvidence(evidence);
  assertExpectedIdentity(expectedIdentity, {
    ...identity,
    sourceCommit: evidence.bindings.sourceCommit,
    sourceTree: evidence.bindings.sourceTree,
  });
  const rollback = evidence.phaseTransitions.filter((item) => (
    item.payload.action === 'ROLLBACK'
      && item.payload.currentPhase === 'CUTOVER'
      && item.payload.targetPhase === 'DUAL_ENFORCE'
  )).at(-1);
  const rollbackIndex = rollback
    ? evidence.records.findIndex((item) => item.receipt.receiptId === rollback.receipt.receiptId)
    : -1;
  const source = nonDiagnosticObservations(evidence, 'CUTOVER')
    .filter((item) => evidence.records.findIndex((candidate) => (
      candidate.receipt.receiptId === item.receipt.receiptId
    )) < rollbackIndex)
    .at(-1);
  if (!source || !rollback || rollbackIndex < 0) {
    return { passed: false, reason: 'ROLLBACK_AUTHORITY_REQUIRED', receiptIds: [] };
  }
  if (!same(rollback.payload.evidenceBundle, {
    digest: source.payload.provenance.digest,
    reference: source.payload.provenance.reference,
  })) {
    return { passed: false, reason: 'ROLLBACK_EVIDENCE_MISMATCH', receiptIds: [] };
  }
  const rollbackIdentityFields = [
    'workId', 'waveId', 'planId', 'decisionId', 'taskId', 'attemptId', 'attempt',
    'dispatchId', 'scopeId', 'diffId',
  ];
  if (rollbackIdentityFields.some((field) => rollback.receipt[field] !== source.payload[field])
    || rollback.receipt.sourceCommit.toLowerCase() !== source.payload.sourceCommit.toLowerCase()
    || rollback.receipt.sourceTree.toLowerCase() !== source.payload.sourceTree.toLowerCase()
    || rollback.receipt.policyVersion !== source.payload.policyVersion
    || rollback.receipt.contractVersion !== source.payload.contractVersion) {
    return { passed: false, reason: 'ROLLBACK_IDENTITY_MISMATCH', receiptIds: [] };
  }
  const diagnostic = diagnosticObservations(evidence, 'DUAL_ENFORCE').find((item) => (
    evidence.records.findIndex((candidate) => candidate.receipt.receiptId === item.receipt.receiptId) > rollbackIndex
  ));
  if (!diagnostic) return { passed: false, reason: 'ROLLBACK_DIAGNOSTIC_REQUIRED', receiptIds: [] };
  const payload = diagnostic.payload;
  const flagsSafe = payload.allowsTargetProgress === false
    && payload.clearsSentinel === false
    && payload.authorizesApproval === false;
  const identityFields = ['workId', 'waveId', 'planId', 'decisionId', 'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId'];
  const identityMatches = identityFields.every((field) => payload[field] === source.payload[field])
    && payload.acceptedOutcomeCost.observationId === source.payload.acceptedOutcomeCost.observationId
    && payload.sourceCommit.toLowerCase() === source.payload.sourceCommit.toLowerCase()
    && payload.sourceTree.toLowerCase() === source.payload.sourceTree.toLowerCase();
  if (!flagsSafe || payload.comparison !== source.payload.comparison || !identityMatches) {
    return { passed: false, reason: 'ROLLBACK_DIAGNOSTIC_MISMATCH', receiptIds: [] };
  }
  return {
    passed: true,
    reason: null,
    sourceReceiptId: source.receipt.receiptId,
    authorityReceiptId: rollback.receipt.receiptId,
    diagnosticReceiptId: diagnostic.receipt.receiptId,
    evaluatedAt: generatedAt,
  };
}

function aggregate(entries) {
  const baseline = groupCostByCohort(entries.filter((entry) => entry.phase !== 'CUTOVER')
    .filter((entry) => entry.cost.retirementEligible)
    .map((entry) => ({ cohort: entry.cohort, cost: entry.cost })));
  const cutover = groupCostByCohort(entries.filter((entry) => entry.phase === 'CUTOVER')
    .filter((entry) => entry.cost.retirementEligible)
    .map((entry) => ({ cohort: entry.cohort, cost: entry.cost })));
  const cohorts = {};
  const comparable = [];
  const unmatched = [];
  const regressions = [];
  let strictImprovement = false;
  const exactMetrics = (items) => {
    const result = {};
    for (const entry of items.filter((item) => item.cost.retirementEligible)) {
      if (!result[entry.cohort]) result[entry.cohort] = {};
      for (const field of COST_FIELDS) {
        const value = entry.cost.metrics[field];
        if (value === null) continue;
        if (!result[entry.cohort][field]) result[entry.cohort][field] = { sum: 0n, count: 0 };
        result[entry.cohort][field].sum += BigInt(value);
        result[entry.cohort][field].count += 1;
      }
    }
    return result;
  };
  const exactBaseline = exactMetrics(entries.filter((entry) => entry.phase !== 'CUTOVER'));
  const exactCutover = exactMetrics(entries.filter((entry) => entry.phase === 'CUTOVER'));
  for (const cohort of Object.keys(cutover)) {
    const current = cutover[cohort];
    const previous = baseline[cohort];
    const metrics = {};
    if (!previous) {
      unmatched.push(cohort);
      cohorts[cohort] = { baseline: null, cutover: current, metrics };
      continue;
    }
    comparable.push(cohort);
    for (const field of COST_FIELDS) {
      const before = exactBaseline[cohort] && exactBaseline[cohort][field];
      const after = exactCutover[cohort] && exactCutover[cohort][field];
      if (!before || !after || before.count === 0 || after.count === 0) {
        metrics[field] = 'NOT_COMPARABLE';
        continue;
      }
      const left = after.sum * before.count;
      const right = before.sum * after.count;
      const direction = left < right ? 'IMPROVED' : left > right ? 'REGRESSED' : 'UNCHANGED';
      metrics[field] = direction;
      if (direction === 'IMPROVED') strictImprovement = true;
      if (direction === 'REGRESSED') regressions.push({ cohort, field });
    }
    cohorts[cohort] = { baseline: previous, cutover: current, metrics };
  }
  return {
    baseline,
    cutover,
    cohorts,
    comparableCohorts: comparable,
    unmatchedCutoverCohorts: unmatched,
    regressions,
    strictImprovement,
  };
}

function buildRetirementReport({ ledger, trustPolicy, generatedAt } = {}) {
  requireTimestamp(generatedAt, 'MALFORMED_TIMESTAMP');
  requireRecord(ledger);
  if (ledger.schema !== LEDGER_SCHEMA) fail('UNSUPPORTED_SCHEMA');
  requireArray(ledger.baselineBundles);
  requireArray(ledger.cutoverBundles);
  if (!isRecord(trustPolicy)) fail('MALFORMED_TRUST_POLICY');
  const evidenceLocation = validateEvidenceLocation(ledger.evidenceLocation, ledger);

  const safety = {
    unsafeClearanceCount: 0,
    crossIdentityReuseCount: 0,
    missedRequiredReviewCount: 0,
    unresolvedDisagreementCount: 0,
    disagreements: [],
  };
  const entries = [];
  const seenOutcomeIds = new Map();
  const seenReceiptIds = new Map();
  const trustedAuthorities = new Map();
  const authorityBindings = new Map();
  const applySafetyDelta = (delta) => {
    safety.unsafeClearanceCount += delta.unsafeClearanceCount;
    safety.missedRequiredReviewCount += delta.missedRequiredReviewCount;
    safety.unresolvedDisagreementCount += delta.unresolvedDisagreementCount;
    for (const disagreement of delta.disagreements) {
      if (safety.disagreements.length >= MAX_DISAGREEMENTS) fail('MALFORMED_LEDGER');
      safety.disagreements.push(disagreement);
    }
  };
  const collect = (entry, collection) => {
    const evaluated = evaluateBundle(entry, collection, trustPolicy, generatedAt);
    for (const [receiptId, receiptIdentity] of Object.entries(evaluated.receiptIdentities)) {
      const previous = seenReceiptIds.get(receiptId);
      const receiptDigest = evaluated.receiptDigests[receiptId];
      if (previous && previous.identity !== receiptIdentity) {
        safety.crossIdentityReuseCount += 1;
        fail('CROSS_IDENTITY_RECEIPT_REUSE');
      }
      if (previous && previous.digest !== receiptDigest) fail('CONFLICTING_DUPLICATE_RECEIPT');
      seenReceiptIds.set(receiptId, { identity: receiptIdentity, digest: receiptDigest });
    }
    for (const authority of evaluated.authorityReceipts) {
      const previous = trustedAuthorities.get(authority.receiptId);
      if (previous && !same(previous, authority)) {
        safety.crossIdentityReuseCount += 1;
        fail('CROSS_IDENTITY_RECEIPT_REUSE');
      }
      trustedAuthorities.set(authority.receiptId, authority);
    }
    if (collection === 'cutover') {
      for (const binding of evaluated.authorityBindings) {
        const previous = authorityBindings.get(binding.receiptId) || [];
        authorityBindings.set(binding.receiptId, [...new Set([
          ...previous,
          ...binding.outcomeIds,
        ])]);
      }
    }
    for (const outcome of evaluated.outcomes) {
      const identityKey = canonicalJson(outcome.observationIdentity);
      const prior = seenOutcomeIds.get(outcome.outcomeId);
      if (prior) {
        if (prior.identityKey !== identityKey || prior.phase !== evaluated.phase) {
          safety.crossIdentityReuseCount += 1;
          fail('CROSS_IDENTITY_RECEIPT_REUSE');
        }
        if (prior.costKey !== canonicalJson(outcome.cost)) fail('CONFLICTING_COST_OBSERVATION');
        if (prior.safetyKey !== canonicalJson(outcome.safetyDelta)) {
          fail('CONFLICTING_OBSERVATION_SAFETY');
        }
        continue;
      }
      applySafetyDelta(outcome.safetyDelta);
      seenOutcomeIds.set(outcome.outcomeId, {
        identityKey,
        phase: evaluated.phase,
        costKey: canonicalJson(outcome.cost),
        safetyKey: canonicalJson(outcome.safetyDelta),
      });
      entries.push({
        ...outcome,
        phase: evaluated.phase,
      });
    }
  };
  for (const entry of ledger.baselineBundles) collect(entry, 'baseline');
  for (const entry of ledger.cutoverBundles) collect(entry, 'cutover');

  const eligibleCutover = entries.filter((entry) => entry.phase === 'CUTOVER'
    && entry.cost.retirementEligible && entry.cost.acceptedOutcome);
  const excludedCutover = entries.filter((entry) => entry.phase === 'CUTOVER'
    && !(entry.cost.retirementEligible && entry.cost.acceptedOutcome));
  const cost = aggregate(entries);
  const blockingReasons = [];
  if (eligibleCutover.length < MIN_ACCEPTED_OUTCOMES) blockingReasons.push('MINIMUM_ACCEPTED_OUTCOMES_NOT_MET');
  if (!evidenceLocation) blockingReasons.push('DURABLE_EVIDENCE_LOCATION_REQUIRED');
  const eligibleOutcomeIds = new Set(eligibleCutover.map((entry) => entry.outcomeId));
  const authorityBasePassed = validateCollectionAuthority(
    ledger.collectionAuthority,
    generatedAt,
    trustedAuthorities,
    authorityBindings,
    eligibleOutcomeIds,
  );
  const isSingleMaintainerTrack = isRecord(ledger.collectionAuthority)
    && ledger.collectionAuthority.track === 'SINGLE_MAINTAINER';
  let authorizationTrack = null;
  let authorityPassed = authorityBasePassed;
  if (authorityBasePassed && isSingleMaintainerTrack) {
    const authorityReceipt = isRecord(ledger.collectionAuthority.receipt)
      ? ledger.collectionAuthority.receipt
      : ledger.collectionAuthority;
    const boundOutcomeIds = (authorityBindings.get(authorityReceipt.receiptId) || [])
      .filter((outcomeId) => eligibleOutcomeIds.has(outcomeId));
    const outcomesById = new Map(eligibleCutover.map((entry) => [entry.outcomeId, entry]));
    authorityPassed = validateSingleMaintainerAuthorization(
      authorityReceipt,
      ledger.collectionAuthority.ciVerification,
      boundOutcomeIds,
      outcomesById,
      trustPolicy,
      generatedAt,
    );
    authorizationTrack = authorityPassed ? 'SINGLE_MAINTAINER' : null;
  } else if (authorityBasePassed) {
    authorizationTrack = 'INDEPENDENT_REVIEWER';
  }
  if (!authorityPassed) {
    blockingReasons.push('CUTOVER_COLLECTION_AUTHORITY_REQUIRED');
  }
  const rollback = validateRollbackDrill(ledger.rollbackDrill, trustPolicy, generatedAt);
  if (!rollback || !rollback.passed) blockingReasons.push('ROLLBACK_DRILL_REQUIRED');
  if (safety.unsafeClearanceCount > 0) blockingReasons.push('UNSAFE_CLEARANCE_DETECTED');
  if (safety.missedRequiredReviewCount > 0) blockingReasons.push('MISSED_REQUIRED_REVIEW');
  if (safety.unresolvedDisagreementCount > 0) blockingReasons.push('UNRESOLVED_DISAGREEMENT');
  if (cost.comparableCohorts.length === 0 || cost.unmatchedCutoverCohorts.length > 0) {
    blockingReasons.push('COST_COMPARATOR_UNAVAILABLE');
  }
  if (cost.regressions.length > 0) blockingReasons.push('COST_REGRESSION');
  if (!cost.strictImprovement) blockingReasons.push('NO_DIRECTIONAL_COST_IMPROVEMENT');

  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  const candidate = uniqueBlockingReasons.length === 0;
  const recommendation = candidate ? 'RETIRE_CANDIDATE' : 'DO_NOT_RETIRE';
  const report = {
    schema: REPORT_SCHEMA,
    generatedAt,
    status: candidate ? 'READY_FOR_DECISION' : 'BLOCKED',
    recommendation,
    retirementEligible: candidate,
    promotionEligible: false,
    phaseMutationPerformed: false,
    retireAuthority: 'REQUIRED_SEPARATELY',
    evidenceLocation,
    blockingReasons: uniqueBlockingReasons,
    eligibleAcceptedOutcomeCount: eligibleCutover.length,
    eligibleOutcomes: eligibleCutover.map((entry) => ({
      outcomeId: entry.outcomeId,
      cohort: entry.cohort,
      materialRisks: entry.materialRisks,
      identity: entry.observationIdentity,
      receiptIds: entry.receiptIds,
    })),
    excludedOutcomes: excludedCutover.map((entry) => ({
      outcomeId: entry.outcomeId,
      cohort: entry.cohort,
      telemetryStatus: entry.cost.telemetryStatus,
      retirementEligible: entry.cost.retirementEligible,
    })),
    safety: {
      unsafeClearanceCount: safety.unsafeClearanceCount,
      crossIdentityReuseCount: safety.crossIdentityReuseCount,
      missedRequiredReviewCount: safety.missedRequiredReviewCount,
      unresolvedDisagreementCount: safety.unresolvedDisagreementCount,
    },
    disagreements: safety.disagreements,
    cost: {
      baseline: cost.baseline,
      cutover: cost.cutover,
      cohorts: cost.cohorts,
      comparableCohorts: cost.comparableCohorts,
      unmatchedCutoverCohorts: cost.unmatchedCutoverCohorts,
      regressions: cost.regressions,
      strictImprovement: cost.strictImprovement,
    },
    rollbackDrill: rollback || { passed: false, reason: 'ROLLBACK_DRILL_REQUIRED' },
    decisionPacket: {
      recommendation,
      alternatives: ['CONTINUE_CUTOVER_COMPATIBILITY', 'ROLL_BACK_TO_DUAL_ENFORCE'],
      risks: uniqueBlockingReasons,
      deferredConsequences: ['Sentinel compatibility projection remains active until separate RETIRE authority.'],
      legacySurfaces: ['resumed-review reconciliation', 'stop-time reviewer reconciliation', 'pending and clear state'],
      authorizationTrack,
    },
  };
  return deepFreeze(report);
}

module.exports = {
  LEDGER_SCHEMA,
  REPORT_SCHEMA,
  MIN_ACCEPTED_OUTCOMES,
  SINGLE_MAINTAINER_COOLDOWN_MS,
  CI_VERIFICATION_SCHEMA,
  COST_FIELDS,
  RetirementReportError,
  buildRetirementReport,
};
