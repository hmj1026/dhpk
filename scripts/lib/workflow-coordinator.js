'use strict';

const {
  WorkflowCoordinatorEvidence,
  immutableEvidence,
} = require('./workflow-coordinator-evidence');
const {
  cloneBoundedJson,
  immutableJson,
} = require('./receipt-primitives');

const PROJECTION_SCHEMA = 'dhpk.workflow-projection.v1';
const DELIVERY_PROJECTION_SCHEMA = 'dhpk.workflow-delivery-projection.v1';
const PROVIDER_MERGE = 'PROVIDER_MERGE';
const DELIVERY_VERIFICATION_OUTCOMES = Object.freeze(['PASS', 'COMPLETE']);
const BASELINE_CONTROL = Object.freeze({
  enabled: false,
  phase: 'BASELINE',
  authority: 'SENTINEL',
  effect: 'DISABLED',
  allowsTargetProgress: false,
});
const OBSERVE_CONTROL = Object.freeze({
  enabled: true,
  phase: 'OBSERVE',
  authority: 'SENTINEL',
  effect: 'OBSERVE_ONLY',
  allowsTargetProgress: false,
});
const DUAL_ENFORCE_CONTROL = Object.freeze({
  enabled: true,
  phase: 'DUAL_ENFORCE',
  authority: 'SENTINEL_AND_REVIEW_GATE',
  effect: 'ENFORCE',
  allowsTargetProgress: true,
});
const CUTOVER_CONTROL = Object.freeze({
  enabled: true,
  phase: 'CUTOVER',
  authority: 'REVIEW_GATE',
  effect: 'ENFORCE',
  allowsTargetProgress: true,
});
// Enforcement-gated phases: the source phase a promotion into this phase must
// be bound to, and the authority/effect every observation in this phase must
// carry. DUAL_ENFORCE requires both Sentinel and Review Gate; CUTOVER makes
// Review Gate the sole authority while Sentinel remains a compatibility
// projection (see docs/adr/0016-phase-and-roll-back-review-gate-migration.md).
const DUAL_ENFORCEMENT_CONFIG = Object.freeze({
  DUAL_ENFORCE: Object.freeze({ sourcePhase: 'OBSERVE', authority: 'SENTINEL_AND_REVIEW_GATE', effect: 'ENFORCE' }),
  CUTOVER: Object.freeze({ sourcePhase: 'DUAL_ENFORCE', authority: 'REVIEW_GATE', effect: 'ENFORCE' }),
});
const MIGRATION_PHASE_ORDER = Object.freeze(['BASELINE', 'OBSERVE', 'DUAL_ENFORCE', 'CUTOVER']);
const FEATURE_KEYS = Object.freeze(['enabled', 'phase']);
const REVIEW_PASS = 'PASS';
const IMPLEMENTATION = 'IMPLEMENTATION';
const LOCAL_GATE = 'LOCAL_GATE';
const PROJECTION_JSON_OPTIONS = Object.freeze({ undefinedPolicy: 'allow' });

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cloneProjection = (value) => cloneBoundedJson(value, PROJECTION_JSON_OPTIONS);
const immutableProjection = (value) => immutableJson(value, PROJECTION_JSON_OPTIONS);

function assertFeatureControl(featureControl) {
  if (!isRecord(featureControl)) throw new TypeError('Workflow Coordinator feature control must be an object');
  const keys = Object.keys(featureControl).sort();
  if (keys.length !== FEATURE_KEYS.length || keys.some((key, index) => key !== FEATURE_KEYS.slice().sort()[index])) {
    throw new TypeError('Workflow Coordinator feature control has unsupported fields');
  }
  const valid = (featureControl.enabled === false && featureControl.phase === 'BASELINE')
    || (featureControl.enabled === true && ['OBSERVE', 'DUAL_ENFORCE', 'CUTOVER'].includes(featureControl.phase));
  if (!valid) throw new TypeError('Workflow Coordinator feature control is unsupported');
}

function controlFor(featureControl) {
  if (featureControl.phase === 'BASELINE') return BASELINE_CONTROL;
  if (featureControl.phase === 'DUAL_ENFORCE') return DUAL_ENFORCE_CONTROL;
  if (featureControl.phase === 'CUTOVER') return CUTOVER_CONTROL;
  return OBSERVE_CONTROL;
}

function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function identityDefaults(context = {}) {
  return {
    workId: context.workId === undefined ? null : context.workId,
    decisionId: context.decisionId === undefined ? null : context.decisionId,
    waveId: context.waveId === undefined ? null : context.waveId,
    planId: context.planId === undefined ? null : context.planId,
  };
}

function lanesFrom(requirements, idField) {
  const result = [];
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const lane = requirement && requirement.lane;
    if (typeof lane === 'string' && !result.includes(lane)) result.push(lane);
    if (idField && requirement && requirement[idField] === undefined) continue;
  }
  return result;
}

function mapLatest(records, keyFor) {
  const result = new Map();
  for (const record of records) {
    const key = keyFor(record);
    if (key !== null && key !== undefined) result.set(key, record);
  }
  return result;
}

function requiredVerification(requirements, evidenceType, lane = null) {
  return (Array.isArray(requirements) ? requirements : []).find((requirement) => (
    requirement.evidenceType === evidenceType && (lane === null || requirement.lane === lane)
  )) || null;
}

function resultReasonCodes(record, fallback) {
  const codes = record && record.payload && record.payload.reasonCodes;
  if (Array.isArray(codes) && codes.length > 0) return [...codes];
  return [fallback];
}

function decisionPacket(decision) {
  if (!decision || !Array.isArray(decision.payload.authorityRequests)) return null;
  const requests = decision.payload.authorityRequests
    .filter((request) => request.urgency === 'BATCHABLE')
    .map(cloneProjection)
    .sort((left, right) => left.requestId.localeCompare(right.requestId));
  return requests.length === 0 ? null : { items: requests };
}

function activeAuthorityFor(requirement, authorities, evaluatedAt) {
  return authorities.some((item) => {
    const target = item.payload && item.payload.target;
    if (!target || target.type !== 'OBLIGATION' || target.obligationId !== requirement.obligationId) return false;
    if (item.receipt.lane !== undefined && item.receipt.lane !== requirement.lane) return false;
    const issuedAt = parseTime(item.payload.issuedAt);
    const expiresAt = parseTime(item.payload.expiresAt);
    return Number.isFinite(issuedAt) && Number.isFinite(expiresAt)
      && evaluatedAt >= issuedAt && evaluatedAt < expiresAt;
  });
}

function reviewSatisfied(requirement, item, authorities, evaluatedAt) {
  if (activeAuthorityFor(requirement, authorities, evaluatedAt)) return true;
  if (!item || item.payload.executionStatus !== 'COMPLETE'
    || item.payload.applicability !== 'REQUIRED'
    || item.payload.semanticVerdict !== REVIEW_PASS) return false;
  return !(Array.isArray(item.payload.findings)
    && item.payload.findings.some((finding) => finding && finding.disposition === 'MUST_FIX'));
}

function allRequirementsPass(reviewRequirements, verificationRequirements, latestReviews, latestVerifications, authorities, evaluatedAt) {
  const reviewsPass = (reviewRequirements || []).every((requirement) => {
    const item = latestReviews.get(requirement.obligationId);
    return reviewSatisfied(requirement, item, authorities, evaluatedAt);
  });
  const verificationsPass = (verificationRequirements || []).every((requirement) => {
    const item = latestVerifications.get(requirement.verificationId);
    if (!item) return false;
    if (requirement.evidenceType === IMPLEMENTATION) return item.payload.outcome === 'COMPLETE';
    return item.payload.outcome === 'PASS' || item.payload.outcome === 'COMPLETE';
  });
  return reviewsPass && verificationsPass;
}

function dualEnforcementStatus(evidence, control, evaluatedAt) {
  const config = DUAL_ENFORCEMENT_CONFIG[control.phase];
  if (!config) return { ready: true, reason: null };
  const targetPhase = control.phase;
  const { sourcePhase, authority, effect } = config;
  const migrationObservations = evidence.migrationObservations || [];
  const records = evidence.records || [];
  const recordIndex = (item) => records.indexOf(item);
  const isRollbackDiagnostic = (item) => (
    item && item.payload && Array.isArray(item.payload.reasonCodes)
      && item.payload.reasonCodes.includes('MIGRATION_ROLLBACK')
  );
  const bundleMatches = (item, bundle) => (
    item && item.payload && item.payload.provenance && bundle
      && item.payload.provenance.digest === bundle.digest
      && item.payload.provenance.reference === bundle.reference
  );
  if (!migrationObservations.some((item) => (
    item.payload && item.payload.phase === targetPhase && !isRollbackDiagnostic(item)
  ))) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_UNOBSERVED' };
  }
  const transitions = evidence.phaseTransitions || [];
  // A rollback receipt must be chronologically anchored to the source-phase
  // evidence it is rolling back. Binding to the target phase would allow a
  // CUTOVER -> DUAL_ENFORCE rollback to reuse an older DUAL observation and
  // would make the rollback boundary ambiguous.
  for (const transition of transitions.filter((item) => item.payload.action === 'ROLLBACK')) {
    const rollbackIndex = recordIndex(transition);
    const rollbackRecordedAt = parseTime(transition.receipt.recordedAt);
    const bundle = transition.payload.evidenceBundle;
    const anchored = migrationObservations
      .filter((item) => item.payload && item.payload.phase === transition.payload.currentPhase)
      .filter((item) => recordIndex(item) < rollbackIndex)
      .filter((item) => parseTime(item.receipt.recordedAt) <= rollbackRecordedAt)
      .filter((item) => bundleMatches(item, bundle))
      .at(-1);
    if (!anchored) return { ready: false, reason: 'DUAL_ENFORCEMENT_UNAUTHORIZED' };
  }

  const latestTransition = transitions[transitions.length - 1];

  // Automatic rollback appends a diagnostic observation in the target phase
  // without a phase-transition authority receipt. That diagnostic is the new
  // epoch boundary; a later target-phase observation must be fresh evidence.
  const latestTransitionIndex = latestTransition ? recordIndex(latestTransition) : -1;
  const latestTransitionIsTargetRollback = latestTransition
    && latestTransition.payload.action === 'ROLLBACK'
    && latestTransition.payload.targetPhase === targetPhase;
  const automaticBoundary = latestTransitionIsTargetRollback ? null : migrationObservations
    .filter((item) => item.payload && item.payload.phase === targetPhase)
    .filter((item) => recordIndex(item) > latestTransitionIndex)
    .filter(isRollbackDiagnostic)
    .at(-1);

  let boundary = automaticBoundary;
  let boundaryTransition = null;
  let source = null;
  if (boundary) {
    const targetIndex = MIGRATION_PHASE_ORDER.indexOf(targetPhase);
    const rollbackSourcePhase = MIGRATION_PHASE_ORDER[targetIndex + 1];
    source = migrationObservations
      .filter((item) => item.payload && item.payload.phase === rollbackSourcePhase)
      .filter((item) => recordIndex(item) < recordIndex(boundary))
      .at(-1);
    if (!source) return { ready: false, reason: 'DUAL_ENFORCEMENT_UNAUTHORIZED' };
  } else {
    // The latest transition must enter the requested phase. A historical
    // promotion cannot authorize an epoch after a later CUTOVER transition.
    if (!latestTransition || latestTransition.payload.targetPhase !== targetPhase) {
      return { ready: false, reason: 'DUAL_ENFORCEMENT_UNAUTHORIZED' };
    }
    boundaryTransition = latestTransition;
    boundary = latestTransition;
    const transitionSourcePhase = latestTransition.payload.currentPhase;
    source = migrationObservations
      .filter((item) => item.payload && item.payload.phase === transitionSourcePhase)
      .filter((item) => recordIndex(item) < recordIndex(boundary))
      .at(-1);
    // The authority receipt must bind the latest source observation, not any
    // older observation carrying the same historical evidence bundle.
    if (!source || !bundleMatches(source, latestTransition.payload.evidenceBundle)) {
      return { ready: false, reason: 'DUAL_ENFORCEMENT_UNAUTHORIZED' };
    }
  }

  const boundaryIndex = recordIndex(boundary);
  const postBoundaryObservations = migrationObservations
    .filter((item) => recordIndex(item) > boundaryIndex);
  if (postBoundaryObservations.length === 0) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_UNOBSERVED' };
  }
  // A diagnostic in a lower phase is evidence that the active target epoch
  // was rolled back. It cannot be ignored merely because it is a diagnostic.
  if (postBoundaryObservations.some((item) => item.payload.phase !== targetPhase)) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_UNAUTHORIZED' };
  }
  const observations = postBoundaryObservations.filter((item) => (
    item.payload && item.payload.phase === targetPhase && !isRollbackDiagnostic(item)
  ));
  if (observations.length === 0) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_UNOBSERVED' };
  }

  if (boundaryTransition) {
    const transitionSourcePhase = boundaryTransition.payload.currentPhase;
    if (boundaryTransition.payload.targetPhase !== targetPhase
      || !transitionSourcePhase
      || transitionSourcePhase !== source.payload.phase
      || (boundaryTransition.payload.action === 'PROMOTE' && transitionSourcePhase !== sourcePhase)) {
      return { ready: false, reason: 'DUAL_ENFORCEMENT_UNAUTHORIZED' };
    }
    const issuedAt = parseTime(boundaryTransition.payload.issuedAt);
    const expiresAt = parseTime(boundaryTransition.payload.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
      || evaluatedAt < issuedAt || evaluatedAt >= expiresAt) {
      return { ready: false, reason: 'STALE_EVIDENCE' };
    }
  }

  const latest = observations[observations.length - 1];
  const payload = latest.payload;
  const boundIdentityFields = [
    'workId', 'waveId', 'planId', 'decisionId', 'obligationId', 'lane',
    'taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId',
  ];
  const transitionIdentityFields = [
    'workId', 'waveId', 'planId', 'decisionId', 'taskId', 'attemptId', 'attempt',
    'dispatchId', 'scopeId', 'diffId',
  ];
  if (boundIdentityFields.some((field) => payload[field] !== source.payload[field])
    || payload.scope.digest !== source.payload.scope.digest
    || payload.diff.digest !== source.payload.diff.digest
    || payload.diff.reference !== source.payload.diff.reference) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_IDENTITY_MISMATCH' };
  }
  if (boundaryTransition && (
    transitionIdentityFields.some((field) => boundaryTransition.receipt[field] !== source.payload[field])
    || boundaryTransition.receipt.sourceCommit !== source.payload.sourceCommit
    || boundaryTransition.receipt.sourceTree !== source.payload.sourceTree
    || boundaryTransition.receipt.policyVersion !== source.payload.policyVersion
    || boundaryTransition.receipt.contractVersion !== source.payload.contractVersion
  )) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_IDENTITY_MISMATCH' };
  }
  if (observations.some((item) => (
    item.payload.authority !== authority
    || item.payload.effect !== effect
  ))) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_AUTHORITY_MISMATCH' };
  }
  // allowsTargetProgress is already validated upstream (migration-coordinator.js
  // dualAllowsProgress / cutoverAllowsProgress) to encode each phase's own
  // agreement rule — DUAL_ENFORCE requires literal AGREE, CUTOVER also accepts
  // INDETERMINATE (Sentinel as a non-participating compatibility projection).
  // A separate literal 'AGREE' check here would re-impose DUAL_ENFORCE's
  // stricter rule on CUTOVER and block legitimate CUTOVER completions.
  if (observations.some((item) => item.payload.allowsTargetProgress !== true)) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_DISAGREEMENT' };
  }
  const review = (evidence.reviews || []).find((item) => (
    item.payload
      && item.payload.effect === effect
      && item.receipt.obligationId === payload.obligationId
      && item.receipt.lane === payload.lane
      && item.payload.eventId === payload.reviewGate.eventId
  ));
  if (!review
    || review.payload.scopeDigest !== payload.scope.digest
    || !review.payload.diff
    || review.payload.diff.digest !== payload.diff.digest
    || review.payload.diff.reference !== payload.diff.reference) {
    return { ready: false, reason: 'DUAL_ENFORCEMENT_IDENTITY_MISMATCH' };
  }
  return { ready: true, reason: null };
}

function blockedReasonForLane(lane, latestReviews, latestVerifications) {
  const review = [...latestReviews.values()].find((item) => item.receipt.lane === lane);
  if (review) {
    if (review.payload.semanticVerdict === 'BLOCKED') return 'REVIEW_BLOCKED';
    if (review.payload.executionStatus === 'UNAVAILABLE') return 'REVIEW_UNAVAILABLE';
  }
  const verification = [...latestVerifications.values()].find((item) => item.payload.lane === lane);
  if (verification) {
    if (verification.payload.evidenceType === LOCAL_GATE) {
      const supplied = resultReasonCodes(verification, 'LOCAL_GATE_UNAVAILABLE');
      return supplied[0];
    }
    return resultReasonCodes(verification, 'EVIDENCE_UNAVAILABLE')[0];
  }
  return 'EVIDENCE_UNAVAILABLE';
}

function requirementLanes(decision) {
  const reviews = decision ? decision.payload.requiredReviews : [];
  const verifications = decision ? decision.payload.requiredVerifications : [];
  return {
    reviewLanes: lanesFrom(reviews, 'obligationId'),
    verificationLanes: lanesFrom(verifications, 'verificationId'),
  };
}

function computeRefreshLanes({ state, decision, latestReviews, latestVerifications, authorities, evaluatedAt, blockedLanes }) {
  if (!decision || state === 'DECISION_PENDING' || state === 'MERGE_READY') return [];
  if (blockedLanes.length > 0) return [...new Set(blockedLanes)];
  const lanes = [];
  if (state === 'RECORDED' || state === 'READY') {
    return requirementLanes(decision).reviewLanes.concat(requirementLanes(decision).verificationLanes);
  }
  for (const requirement of decision.payload.requiredReviews || []) {
    const review = latestReviews.get(requirement.obligationId);
    if (!reviewSatisfied(requirement, review, authorities, evaluatedAt)) lanes.push(requirement.lane);
  }
  for (const requirement of decision.payload.requiredVerifications || []) {
    if (requirement.evidenceType === IMPLEMENTATION) continue;
    const verification = latestVerifications.get(requirement.verificationId);
    if (!verification || !['PASS', 'COMPLETE'].includes(verification.payload.outcome)) lanes.push(requirement.lane);
  }
  return [...new Set(lanes)];
}

function baseProjection(context, control, evidenceAccepted, evidenceReceiptIds = []) {
  const identity = identityDefaults(context);
  return {
    schema: PROJECTION_SCHEMA,
    evidenceAccepted,
    state: 'EVIDENCE_PENDING',
    condition: null,
    ...identity,
    owners: context.owners === undefined ? null : cloneProjection(context.owners),
    routing: context.routing === undefined ? null : cloneProjection(context.routing),
    reviewLanes: context.reviewLanes === undefined ? [] : [...context.reviewLanes],
    verificationLanes: context.verificationLanes === undefined ? [] : [...context.verificationLanes],
    refreshLanes: [],
    evidenceReceiptIds: [...evidenceReceiptIds],
    decisionPacket: null,
    authorizesPullRequest: false,
    completion: {
      implementation: 'PENDING',
      delivery: 'PENDING',
      workflow: 'PENDING',
    },
    control: cloneProjection(control),
  };
}

function blockedProjection(error, control) {
  const context = error && isRecord(error.context) ? error.context : {};
  const result = baseProjection(context, control, false, []);
  result.condition = {
    type: 'BLOCKED',
    resumeState: 'EVIDENCE_PENDING',
    reasonCodes: [typeof error.code === 'string' ? error.code : 'MALFORMED_RECEIPT'],
  };
  if (Array.isArray(context.evidenceReceiptIds)) result.evidenceReceiptIds = context.evidenceReceiptIds.slice();
  return result;
}

function reduceAccepted(evidence, control, evaluatedAt) {
  const decision = evidence.decisionChain.latest;
  const context = decision ? {
    ...evidence.identity,
    planId: evidence.identity.planId,
    owners: decision.payload.ownership,
    routing: decision.payload.routing,
  } : evidence.identity;
  const result = baseProjection(context, control, true, evidence.records.map((item) => item.receipt.receiptId));
  result.planId = evidence.identity.planId;

  if (!decision) {
    result.condition = { type: 'BLOCKED', resumeState: 'EVIDENCE_PENDING', reasonCodes: ['NO_DECISION'] };
    return result;
  }

  const requiredReviews = decision.payload.requiredReviews || [];
  const requiredVerifications = decision.payload.requiredVerifications || [];
  const lanes = requirementLanes(decision);
  result.reviewLanes = lanes.reviewLanes;
  result.verificationLanes = lanes.verificationLanes;
  result.decisionPacket = ['DECISION_REQUIRED', 'DECISION_INVALIDATED'].includes(decision.payload.fact)
    ? decisionPacket(decision)
    : null;

  const latestReviews = mapLatest(evidence.reviews, (item) => item.receipt.obligationId);
  const latestVerifications = mapLatest(evidence.verifications, (item) => item.payload.verificationId);
  const freshnessTargets = new Set(evidence.verifications
    .filter((item) => item.payload.evidenceType === 'FRESHNESS')
    .map((item) => item.payload.targetReceiptId));
  for (const [key, item] of latestReviews.entries()) {
    if (freshnessTargets.has(item.receipt.receiptId)) latestReviews.delete(key);
  }
  for (const [key, item] of latestVerifications.entries()) {
    if (freshnessTargets.has(item.receipt.receiptId)) latestVerifications.delete(key);
  }
  const authorities = evidence.authorities;
  const dualStatus = dualEnforcementStatus(evidence, control, evaluatedAt);

  const immediateRequests = (decision.payload.authorityRequests || []).filter((request) => (
    request.urgency === 'IMMEDIATE_STOP' && request.blocking !== false
  ));
  if (immediateRequests.length > 0
    && ['DECISION_REQUIRED', 'DECISION_INVALIDATED'].includes(decision.payload.fact)) {
    result.state = 'DECISION_PENDING';
    result.decisionPacket = null;
    result.condition = {
      type: 'BLOCKED',
      resumeState: 'DECISION_PENDING',
      reasonCodes: ['IMMEDIATE_AUTHORITY_REQUIRED'],
    };
    result.refreshLanes = [];
    return result;
  }

  if (decision.payload.fact === 'WORK_RECORDED') {
    result.state = 'RECORDED';
    result.refreshLanes = computeRefreshLanes({
      state: result.state, decision, latestReviews, latestVerifications, authorities, evaluatedAt, blockedLanes: [],
    });
    return result;
  }
  if (decision.payload.fact === 'DECISION_REQUIRED' || decision.payload.fact === 'DECISION_INVALIDATED') {
    result.state = 'DECISION_PENDING';
    result.refreshLanes = [];
    return result;
  }

  const implementationRequirement = requiredVerification(requiredVerifications, IMPLEMENTATION);
  const implementation = implementationRequirement
    ? latestVerifications.get(implementationRequirement.verificationId)
    : null;
  const implementationOutcome = implementation && implementation.payload.outcome;
  if (!implementation) {
    const implementationExpired = implementationRequirement
      && evidence.verifications.some((item) => item.payload.verificationId === implementationRequirement.verificationId
        && freshnessTargets.has(item.receipt.receiptId));
    result.state = implementationExpired ? 'EVIDENCE_PENDING' : 'READY';
    result.refreshLanes = implementationExpired ? [implementationRequirement.lane] : computeRefreshLanes({
      state: result.state, decision, latestReviews, latestVerifications, authorities, evaluatedAt, blockedLanes: [],
    });
    return result;
  }
  if (implementationOutcome === 'STARTED') {
    result.state = 'EXECUTING';
    result.refreshLanes = computeRefreshLanes({
      state: result.state, decision, latestReviews, latestVerifications, authorities, evaluatedAt, blockedLanes: [],
    });
    return result;
  }
  if (implementationOutcome !== 'COMPLETE') {
    result.state = implementationOutcome === 'FAIL' || implementationOutcome === 'CHANGES_REQUIRED'
      ? 'EXECUTING' : 'EVIDENCE_PENDING';
    const blockedLanes = ['BLOCKED', 'UNAVAILABLE'].includes(implementationOutcome)
      ? [implementationRequirement.lane] : [];
    if (blockedLanes.length > 0) {
      result.condition = {
        type: 'BLOCKED',
        resumeState: 'EVIDENCE_PENDING',
        reasonCodes: resultReasonCodes(implementation, 'IMPLEMENTATION_UNAVAILABLE'),
      };
    }
    result.refreshLanes = computeRefreshLanes({
      state: result.state, decision, latestReviews, latestVerifications, authorities, evaluatedAt, blockedLanes,
    });
    return result;
  }

  const blockedLanes = [];
  const failure = [];
  for (const requirement of requiredReviews) {
    const review = latestReviews.get(requirement.obligationId);
    if (reviewSatisfied(requirement, review, authorities, evaluatedAt)) continue;
    if (!review) continue;
    const verdict = review.payload.semanticVerdict;
    if (verdict === 'BLOCKED' || review.payload.executionStatus === 'UNAVAILABLE') blockedLanes.push(requirement.lane);
    if (verdict === 'CHANGES_REQUIRED') failure.push(requirement.lane);
  }
  for (const requirement of requiredVerifications) {
    if (requirement.evidenceType === IMPLEMENTATION) continue;
    const verification = latestVerifications.get(requirement.verificationId);
    if (!verification) continue;
    const outcome = verification.payload.outcome;
    if (['BLOCKED', 'UNAVAILABLE'].includes(outcome)) blockedLanes.push(requirement.lane);
    if (['FAIL', 'CHANGES_REQUIRED'].includes(outcome)) failure.push(requirement.lane);
  }
  if (blockedLanes.length > 0) {
    result.state = 'EVIDENCE_PENDING';
    result.condition = {
      type: 'BLOCKED',
      resumeState: 'EVIDENCE_PENDING',
      reasonCodes: [...new Set(blockedLanes.map((lane) => (
        blockedReasonForLane(lane, latestReviews, latestVerifications)
      )))],
    };
  } else if (failure.length > 0) {
    result.state = 'EXECUTING';
  } else if (!dualStatus.ready) {
    result.state = 'EVIDENCE_PENDING';
    result.condition = {
      type: 'BLOCKED',
      resumeState: 'EVIDENCE_PENDING',
      reasonCodes: [dualStatus.reason],
    };
  } else if (allRequirementsPass(requiredReviews, requiredVerifications, latestReviews, latestVerifications, authorities, evaluatedAt)) {
    result.state = 'MERGE_READY';
    result.completion.implementation = 'COMPLETE';
    result.authorizesPullRequest = decision.payload.deliveryAuthorized === true;
  } else {
    result.state = 'EVIDENCE_PENDING';
  }
  result.refreshLanes = computeRefreshLanes({
    state: result.state,
    decision,
    latestReviews,
    latestVerifications,
    authorities,
    evaluatedAt,
    blockedLanes,
  });
  return result;
}

function baseDeliveryProjection(context, control) {
  const identity = identityDefaults(context);
  return {
    schema: DELIVERY_PROJECTION_SCHEMA,
    state: 'POST_MERGE_PENDING',
    condition: null,
    ...identity,
    completion: { delivery: 'PENDING', workflow: 'PENDING' },
    control: cloneProjection(control),
  };
}

function blockedDeliveryProjection(error, control) {
  const context = error && isRecord(error.context) ? error.context : {};
  const result = baseDeliveryProjection(context, control);
  result.condition = {
    type: 'BLOCKED',
    resumeState: 'POST_MERGE_PENDING',
    reasonCodes: [typeof error.code === 'string' ? error.code : 'MALFORMED_RECEIPT'],
  };
  return result;
}

// `evidence.verifications` is in canonical (ascending recordedAt, then
// receiptId) order, so the last match for an evidenceType is the latest
// observation. Distinct verificationIds for the same evidenceType mean two
// different post-merge checks are in play with no decision-declared list to
// enumerate them against (this receipt set carries no `decision`), so that
// case fails closed as ambiguous rather than picking one arbitrarily.
function latestByEvidenceType(verifications, evidenceType) {
  const matches = verifications.filter((item) => item.payload.evidenceType === evidenceType);
  if (matches.length === 0) return { item: null, ambiguous: false };
  const distinctIds = new Set(matches.map((item) => item.payload.verificationId));
  if (distinctIds.size > 1) return { item: null, ambiguous: true };
  return { item: matches[matches.length - 1], ambiguous: false };
}

function reduceDeliveryAccepted(evidence, control) {
  const result = baseDeliveryProjection(evidence.identity, control);
  const merge = latestByEvidenceType(evidence.verifications, PROVIDER_MERGE);
  const postMergeCi = latestByEvidenceType(evidence.verifications, 'LOCAL_GATE');
  const mergeObserved = !merge.ambiguous && Boolean(merge.item)
    && DELIVERY_VERIFICATION_OUTCOMES.includes(merge.item.payload.outcome);
  const ciObserved = !postMergeCi.ambiguous && Boolean(postMergeCi.item)
    && DELIVERY_VERIFICATION_OUTCOMES.includes(postMergeCi.item.payload.outcome);
  if (mergeObserved && ciObserved) {
    result.state = 'ARCHIVE_READY';
    result.completion.delivery = 'COMPLETE';
    return result;
  }
  const reasonCodes = [];
  if (merge.ambiguous) reasonCodes.push('AMBIGUOUS_MERGE_OBSERVATION');
  else if (!mergeObserved) reasonCodes.push('MERGE_UNOBSERVED');
  if (postMergeCi.ambiguous) reasonCodes.push('AMBIGUOUS_POST_MERGE_CI');
  else if (!ciObserved) reasonCodes.push('POST_MERGE_CI_UNOBSERVED');
  result.condition = { type: 'BLOCKED', resumeState: 'POST_MERGE_PENDING', reasonCodes };
  return result;
}

class WorkflowCoordinator {
  constructor(options = {}) {
    const safeOptions = immutableEvidence(options);
    if (!isRecord(safeOptions)) throw new TypeError('Workflow Coordinator options must be an object');
    const safeFeatureControl = immutableEvidence(safeOptions.featureControl);
    assertFeatureControl(safeFeatureControl);
    this.evidence = new WorkflowCoordinatorEvidence({
      trustPolicy: safeOptions.trustPolicy,
      evaluatedAt: safeOptions.evaluatedAt,
    });
    this.control = immutableProjection(controlFor(safeFeatureControl));
    this.evaluatedAt = parseTime(safeOptions.evaluatedAt);
    Object.freeze(this);
  }

  reduce(receipts) {
    try {
      const evidence = this.evidence.evaluate(receipts);
      return immutableProjection(reduceAccepted(evidence, this.control, this.evaluatedAt));
    } catch (error) {
      return immutableProjection(blockedProjection(error, this.control));
    }
  }

  reduceDelivery(receipts) {
    try {
      const evidence = this.evidence.evaluate(receipts);
      return immutableProjection(reduceDeliveryAccepted(evidence, this.control));
    } catch (error) {
      return immutableProjection(blockedDeliveryProjection(error, this.control));
    }
  }
}

module.exports = {
  WorkflowCoordinator,
};
