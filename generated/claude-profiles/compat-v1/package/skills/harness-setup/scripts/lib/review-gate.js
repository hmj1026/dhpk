'use strict';

const {
  canonicalJson,
} = require('./receipt-primitives');
const {
  ReviewGateEvidence,
  REVIEW_GATE_EVENT_TYPES,
} = require('./review-gate-evidence');

const {
  PLAN_REGISTERED,
  REVIEW_RESULT_RECORDED,
  INPUTS_INVALIDATED,
  AUTHORITY_OVERRIDE_RECORDED,
} = REVIEW_GATE_EVENT_TYPES;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const gateError = (code, message) => {
  const error = new Error(message);
  error.name = 'ReviewGateError';
  error.code = code;
  return error;
};

const fail = (code, message) => {
  throw gateError(code, message);
};

const same = (left, right, field, code = 'FOREIGN_EVIDENCE') => {
  if (canonicalJson(left) !== canonicalJson(right)) fail(code, `${field} does not match`);
};

const sortReasons = (reasons) => [...new Set(reasons.filter((reason) => typeof reason === 'string' && reason))].sort();

const readHistory = (receiptStore, workId, expectedRevision, expectedChainDigest) => {
  if (typeof receiptStore.inspect !== 'function') fail('STORE_CONFIG', 'receipt store inspect is required');
  return receiptStore.inspect({ workId, expectedRevision, expectedChainDigest });
};

const recordedAt = (now) => {
  const timestamp = clockMs(now);
  return new Date(timestamp).toISOString();
};

const clockMs = (now) => {
  const value = now();
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(timestamp)) throw new TypeError('Review Gate clock returned an invalid time');
  return timestamp;
};

const planRecordAt = (records, waveId) => {
  const matches = records.filter((record) => record.plan.waveId === waveId);
  if (matches.length === 0) fail('MISSING_PLAN', 'no Review Plan is registered for this wave');
  return matches[matches.length - 1];
};

const latestPlanRecord = (records) => {
  if (records.length === 0) fail('MISSING_PLAN', 'no Review Plan is registered');
  return records[records.length - 1];
};

const planTimeline = (history, evidence) => {
  const records = [];
  const byWave = new Map();
  const seenPlanIds = new Set();
  let current = null;
  for (const [index, event] of history.events.entries()) {
    evidence.validateEventType(event.eventType);
    if (event.eventType !== PLAN_REGISTERED && event.eventType !== INPUTS_INVALIDATED) continue;
    if (!evidence.trustedProducer(event, event.eventType)) {
      fail('UNTRUSTED_PRODUCER', 'plan event producer is not trusted for this event type');
    }
    const plan = event.eventType === PLAN_REGISTERED
      ? evidence.validatePlanEvent(event)
      : evidence.validateInputsInvalidatedEvent(event, current && current.plan);
    if (event.eventType === PLAN_REGISTERED) {
      if (current && canonicalJson(current.plan) !== canonicalJson(plan)) {
        fail('STALE_EVIDENCE', 'PLAN_REGISTERED cannot replace the current active plan');
      }
    } else if (seenPlanIds.has(plan.planId)) {
      fail('STALE_EVIDENCE', 'INPUTS_INVALIDATED cannot reopen a superseded plan');
    }
    if (event.eventType === INPUTS_INVALIDATED && current) {
      same(plan.workId, current.plan.workId, 'invalidation workId');
      same(plan.decisionId, current.plan.decisionId, 'invalidation decisionId');
    }
    const existing = byWave.get(plan.waveId);
    if (existing && event.eventType === PLAN_REGISTERED) same(existing.plan, plan, 'Review Plan registration');
    const record = { event, plan, index };
    records.push(record);
    byWave.set(plan.waveId, record);
    current = record;
    seenPlanIds.add(plan.planId);
  }
  auditLaneRemovalDebt(history, { records, byWave, current }, evidence);
  return { records, byWave, current };
};

const bindingFor = (plan, obligation, evidence) => ({
  workId: plan.workId,
  decisionId: plan.decisionId,
  lane: obligation.lane,
  baseIdentity: plan.baseIdentity,
  headIdentity: plan.headIdentity,
  diff: plan.diff,
  scopeDigest: plan.scope.digest,
  governingInputsHash: evidence.digest(plan.governingInputs),
  reasonSignalsHash: evidence.digest(obligation.reasonSignals),
  policyVersion: plan.policyVersion,
  policyDigest: plan.policyDigest,
  contractVersion: plan.contractVersion,
});

const sameBinding = (left, right) => canonicalJson(left) === canonicalJson(right);

const unresolvedFindings = (findings) => (
  Array.isArray(findings)
    ? findings.filter((finding) => isRecord(finding) && finding.disposition === 'MUST_FIX')
    : []
);

const canonicalFindings = (findings) => [...new Map(unresolvedFindings(findings)
  .map((finding) => [`${finding.id}:${canonicalJson(finding)}`, finding])).values()]
  .sort((left, right) => `${left.id}:${canonicalJson(left)}`.localeCompare(`${right.id}:${canonicalJson(right)}`));

const mergeFindings = (prior, current) => canonicalFindings([...(prior || []), ...(current || [])]);

const assertNoUnresolvedRemovedLanes = (nextPlan, accumulatedByLane) => {
  const nextLanes = new Set(nextPlan.obligations.map((obligation) => obligation.lane));
  for (const [lane, findings] of accumulatedByLane.entries()) {
    if (findings.length > 0 && !nextLanes.has(lane)) {
      fail('UNRESOLVED_MUST_FIX', `lane ${lane} has unresolved MUST_FIX findings`);
    }
  }
};

const resultKey = (waveId, obligationId) => `${waveId}:${obligationId}`;

const planRecordForEvent = (timeline, waveId, eventIndex) => {
  for (let index = timeline.records.length - 1; index >= 0; index -= 1) {
    const candidate = timeline.records[index];
    if (candidate.plan.waveId === waveId && candidate.index <= eventIndex) return candidate;
  }
  return null;
};

const activePlanRecordBefore = (timeline, eventIndex) => {
  for (let index = timeline.records.length - 1; index >= 0; index -= 1) {
    const candidate = timeline.records[index];
    if (candidate.index <= eventIndex) return candidate;
  }
  return null;
};

const receiptFor = (history, event, plan, validated, evidence) => {
  const matches = history.receipts.filter((receipt) => receipt.payload
    && receipt.payload.eventId === event.eventId
    && receipt.obligationId === validated.obligation.obligationId);
  if (matches.length !== 1 || !evidence.receiptMatches(matches[0], event, plan, validated)) {
    fail('MISSING_EVIDENCE', 'review result does not have one fresh evidence receipt');
  }
  return matches[0];
};

const collectResults = (history, timeline, cutoff, evidence) => {
  const results = [];
  const latestByLane = new Map();
  const accumulatedByLane = new Map();
  const latestByWaveObligation = new Map();
  for (const [index, event] of history.events.entries()) {
    if (index > cutoff || event.eventType !== REVIEW_RESULT_RECORDED) continue;
    const planRecord = activePlanRecordBefore(timeline, index);
    if (!planRecord || planRecord.index > index) fail('MISSING_PLAN', 'review result has no preceding Review Plan');
    same(event.waveId, planRecord.plan.waveId, 'review result waveId', 'STALE_EVIDENCE');
    same(event.planId, planRecord.plan.planId, 'review result planId', 'STALE_EVIDENCE');
    if (!evidence.trustedProducer(event, event.eventType)) {
      fail('UNTRUSTED_PRODUCER', 'event producer is not trusted for this event type');
    }
    const priorFindings = accumulatedByLane.get(event.lane) || [];
    const validated = evidence.validateReviewEvent(event, planRecord.plan, priorFindings);
    if (!evidence.trustedProducer(event, event.eventType, validated.obligation.lane)) {
      fail('UNTRUSTED_LANE', 'review producer is not trusted for the requested lane');
    }
    const receipt = receiptFor(history, event, planRecord.plan, validated, evidence);
    const entry = {
      event,
      plan: planRecord.plan,
      planIndex: planRecord.index,
      validated,
      receipt,
      index,
    };
    results.push(entry);
    latestByLane.set(validated.obligation.lane, entry);
    const nextFindings = mergeFindings(priorFindings, validated.result.findings);
    const clearsFindings = validated.result.executionStatus === 'COMPLETE'
      && validated.result.applicability === 'REQUIRED'
      && validated.result.semanticVerdict === 'PASS';
    accumulatedByLane.set(validated.obligation.lane, clearsFindings ? [] : nextFindings);
    latestByWaveObligation.set(resultKey(event.waveId, validated.obligation.obligationId), entry);
  }
  return { results, latestByLane, accumulatedByLane, latestByWaveObligation };
};

const auditLaneRemovalDebt = (history, timeline, evidence) => {
  for (const record of timeline.records) {
    if (record.event.eventType !== INPUTS_INVALIDATED) continue;
    const previous = timeline.records
      .filter((candidate) => candidate.index < record.index)
      .at(-1);
    if (!previous) fail('MISSING_PLAN', 'inputs invalidation has no preceding Review Plan');
    const collected = collectResults(history, timeline, record.index - 1, evidence);
    assertNoUnresolvedRemovedLanes(record.plan, collected.accumulatedByLane);
  }
};

const collectAuthorities = (history, timeline, cutoff, evidence, evaluationMs) => {
  const authorities = [];
  for (const [index, event] of history.events.entries()) {
    if (index > cutoff || event.eventType !== AUTHORITY_OVERRIDE_RECORDED) continue;
    const planRecord = activePlanRecordBefore(timeline, index);
    if (!planRecord || planRecord.index > index) fail('MISSING_PLAN', 'authority event has no preceding Review Plan');
    same(event.waveId, planRecord.plan.waveId, 'authority waveId', 'STALE_EVIDENCE');
    same(event.planId, planRecord.plan.planId, 'authority planId', 'STALE_EVIDENCE');
    if (!evidence.trustedProducer(event, event.eventType)) {
      fail('UNTRUSTED_PRODUCER', 'authority producer is not trusted for this event type');
    }
    const validated = evidence.validateAuthorityEvent(event, planRecord.plan, {
      nowMs: evaluationMs,
      checkActive: false,
    });
    if (validated.obligation) {
      if (!evidence.trustedProducer(event, event.eventType, validated.obligation.lane)) {
        fail('UNTRUSTED_LANE', 'authority producer is not trusted for the obligation lane');
      }
    } else if (validated.target.type === 'WAVE') {
      for (const obligation of planRecord.plan.obligations) {
        if (!evidence.trustedProducer(event, event.eventType, obligation.lane)) {
          fail('UNTRUSTED_LANE', 'authority producer is not trusted for the wave lanes');
        }
      }
    }
    authorities.push({ event, plan: planRecord.plan, validated, index });
  }
  return authorities;
};

const qualifiesPass = (entry) => entry.validated.result.executionStatus === 'COMPLETE'
  && entry.validated.result.applicability === 'REQUIRED'
  && entry.validated.result.semanticVerdict === 'PASS';

const previousLaneResult = (results, planRecord, lane) => {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const candidate = results[index];
    if (candidate.index < planRecord.index && candidate.validated.obligation.lane === lane) return candidate;
  }
  return null;
};

const reusableLaneResult = (results, planRecord, obligation, accumulatedFindings, evidence) => {
  const expected = bindingFor(planRecord.plan, obligation, evidence);
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const candidate = results[index];
    if (candidate.index >= planRecord.index || candidate.validated.obligation.lane !== obligation.lane) continue;
    const candidateBinding = bindingFor(candidate.plan, candidate.validated.obligation, evidence);
    if (accumulatedFindings.length > 0) return null;
    return sameBinding(candidateBinding, expected) && qualifiesPass(candidate) ? candidate : null;
  }
  return null;
};

const aggregateExecutionStatus = (statuses) => {
  if (statuses.every((status) => status === 'COMPLETE')) return 'COMPLETE';
  if (statuses.includes('INTERRUPTED')) return 'INTERRUPTED';
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  return 'NOT_RUN';
};

const project = (history, timeline, planRecord, evaluatedAt, evaluationMs, resolutionHint, evidence) => {
  const nextPlan = timeline.records.find((candidate) => candidate.index > planRecord.index);
  const cutoff = nextPlan ? nextPlan.index - 1 : history.events.length - 1;
  const collected = collectResults(history, timeline, cutoff, evidence);
  const authorities = collectAuthorities(history, timeline, cutoff, evidence, evaluationMs);
  const plan = planRecord.plan;
  const currentAuthorities = authorities.filter((entry) => (
    entry.plan.planId === plan.planId && entry.plan.waveId === plan.waveId
  ));
  const activeAuthorities = currentAuthorities.filter(({ validated }) => validated.active);
  const inactiveAuthorityTargets = currentAuthorities.filter(({ validated }) => !validated.active);
  const waveOverride = activeAuthorities.some(({ validated }) => validated.target.type === 'WAVE');
  const overriddenObligations = new Set(activeAuthorities
    .filter(({ validated }) => validated.target.type === 'OBLIGATION')
    .map(({ validated }) => validated.obligation.obligationId));
  const authorityApplied = waveOverride || overriddenObligations.size > 0;
  const obligations = plan.obligations.map((obligation) => ({
    ...obligation,
    lifecycleStatus: 'PENDING',
  }));
  const semanticVerdicts = [];
  const executionStatuses = [];
  let reusedCount = 0;
  let currentResultCount = 0;

  for (const [index, obligation] of plan.obligations.entries()) {
    const direct = collected.latestByWaveObligation.get(resultKey(plan.waveId, obligation.obligationId));
    const accumulatedFindings = collected.accumulatedByLane.get(obligation.lane) || [];
    const reused = direct
      ? null
      : reusableLaneResult(collected.results, planRecord, obligation, accumulatedFindings, evidence);
    const current = direct || reused;
    const overridden = waveOverride || overriddenObligations.has(obligation.obligationId);
    if (!current && !overridden) {
      obligations[index] = {
        ...obligations[index],
        executionStatus: 'NOT_RUN',
        applicability: obligation.applicability,
        ...(accumulatedFindings.length > 0 ? { findings: accumulatedFindings } : {}),
      };
      executionStatuses.push('NOT_RUN');
      continue;
    }
    if (!current && overridden) {
      obligations[index] = {
        ...obligations[index],
        executionStatus: 'NOT_RUN',
        applicability: obligation.applicability,
        lifecycleStatus: 'RESOLVED',
      };
      executionStatuses.push('NOT_RUN');
      continue;
    }
    if (reused) reusedCount += 1;
    else currentResultCount += 1;
    const { result } = current.validated;
    const passed = qualifiesPass(current);
    obligations[index] = {
      ...obligations[index],
      executionStatus: result.executionStatus,
      applicability: result.applicability,
      ...(result.semanticVerdict === undefined ? {} : { semanticVerdict: result.semanticVerdict }),
      findings: accumulatedFindings.length > 0 ? accumulatedFindings : result.findings,
      lifecycleStatus: overridden || passed ? 'RESOLVED' : 'PENDING',
    };
    executionStatuses.push(result.executionStatus);
    if (result.semanticVerdict !== undefined) semanticVerdicts.push(result.semanticVerdict);
  }

  const allResolved = plan.obligations.length > 0
    && obligations.every((obligation) => obligation.lifecycleStatus === 'RESOLVED');
  const isEmpty = plan.applicability === 'NOT_APPLICABLE';
  const lifecycleStatus = isEmpty ? 'NOT_APPLICABLE' : allResolved ? 'RESOLVED' : 'PENDING';
  const semanticVerdict = isEmpty
    ? undefined
    : semanticVerdicts.includes('CHANGES_REQUIRED')
      ? 'CHANGES_REQUIRED'
      : semanticVerdicts.includes('BLOCKED')
        ? 'BLOCKED'
        : allResolved
          && semanticVerdicts.length === plan.obligations.length
          && semanticVerdicts.every((verdict) => verdict === 'PASS') ? 'PASS' : undefined;
  const executionStatus = isEmpty ? undefined : aggregateExecutionStatus(executionStatuses);
  const inactiveApplies = ({ validated }) => {
    if (validated.target.type === 'WAVE') return !waveOverride && !allResolved;
    const targetObligation = obligations.find(({ obligationId }) => obligationId === validated.obligation.obligationId);
    return !waveOverride && !overriddenObligations.has(validated.obligation.obligationId)
      && targetObligation && targetObligation.lifecycleStatus !== 'RESOLVED';
  };
  const blockingReasons = sortReasons([
    ...(inactiveAuthorityTargets.some(({ validated }) => validated.expiresAt <= evaluationMs
      && inactiveApplies({ validated })) ? ['OVERRIDE_EXPIRED'] : []),
    ...(inactiveAuthorityTargets.some(({ validated }) => validated.issuedAt > evaluationMs
      && inactiveApplies({ validated })) ? ['OVERRIDE_NOT_ACTIVE'] : []),
  ]);
  const resolution = isEmpty
    ? 'EMPTY_DIFF'
    : allResolved
      ? (authorityApplied
        ? 'AUTHORITY_OVERRIDE'
        : resolutionHint || (timeline.records.some((candidate) => candidate.index < planRecord.index
        && candidate.plan.planId === plan.planId)
        || (reusedCount > 0 && currentResultCount === 0)
        ? 'RECEIPT_REUSE'
        : 'REVIEW_PASS'))
      : undefined;
  const reviewRequests = isEmpty
    ? []
    : plan.obligations
    .map((obligation, index) => {
        if (obligations[index].lifecycleStatus === 'RESOLVED') return null;
        const priorFindings = collected.accumulatedByLane.get(obligation.lane) || [];
        return evidence.buildReviewRequest(plan, obligation, priorFindings);
      })
      .filter(Boolean);

  const status = {
    workId: plan.workId,
    waveId: plan.waveId,
    revision: history.revision,
    chainDigest: history.chainDigest,
    evaluatedAt: evaluatedAt || undefined,
    decision: {
      accepted: true,
      allowsProgress: isEmpty || allResolved,
      lifecycleStatus,
      semanticVerdict,
      resolution,
      executionStatus,
      applicability: plan.applicability,
      obligations,
      blockingReasons,
    },
    reviewRequests,
    receipts: history.receipts,
  };
  status.lifecycleStatus = status.decision.lifecycleStatus;
  status.semanticVerdict = status.decision.semanticVerdict;
  status.resolution = status.decision.resolution;
  status.executionStatus = status.decision.executionStatus;
  status.applicability = status.decision.applicability;
  return evidence.immutable(status);
};

const rejection = (evidence, expectedRevision, expectedChainDigest, reasons, event = null) => evidence.immutable({
  workId: event && event.workId,
  waveId: event && event.waveId,
  revision: Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 ? expectedRevision : null,
  chainDigest: expectedChainDigest === null || typeof expectedChainDigest === 'string'
    ? expectedChainDigest
    : null,
  decision: {
    accepted: false,
    allowsProgress: false,
    lifecycleStatus: 'PENDING',
    blockingReasons: sortReasons(reasons),
    obligations: [],
  },
  reviewRequests: [],
  receipts: [],
});

const appendAndProject = ({ gate, event, expectedRevision, expectedChainDigest, receipts, resolutionHint = null }) => {
  const appended = gate.receiptStore.append({ expectedRevision, event, receipts });
  const history = readHistory(gate.receiptStore, event.workId, appended.revision, appended.chainDigest);
  const timeline = planTimeline(history, gate.evidence);
  const planRecord = planRecordAt(timeline.records, event.waveId);
  const projected = project(
    history,
    timeline,
    planRecord,
    undefined,
    clockMs(gate.now),
    resolutionHint,
    gate.evidence,
  );
  return gate.evidence.immutable({
    ...projected,
    receipts: appended.status === 'APPENDED' ? receipts : [],
  });
};

class ReviewGate {
  constructor({ receiptStore, trustPolicy, now = () => Date.now() } = {}) {
    if (!receiptStore || typeof receiptStore.append !== 'function'
      || typeof receiptStore.replay !== 'function' || typeof receiptStore.inspect !== 'function') {
      throw new TypeError('Review Gate receiptStore must expose append, replay, and inspect');
    }
    if (typeof now !== 'function') throw new TypeError('Review Gate clock must be a function');
    this.receiptStore = receiptStore;
    this.evidence = new ReviewGateEvidence({ trustPolicy });
    this.now = now;
  }

  handle({ expectedRevision, expectedChainDigest, event } = {}) {
    try {
      this.evidence.validateCommonEvent(event);
      this.evidence.validateEventType(event.eventType);
      if (!this.evidence.trustedProducer(event, event.eventType)) {
        fail('UNTRUSTED_PRODUCER', 'event producer is not trusted for this event type');
      }
      const history = readHistory(this.receiptStore, event.workId, expectedRevision, expectedChainDigest);
      const timeline = planTimeline(history, this.evidence);
      if (event.eventType === PLAN_REGISTERED) {
        const plan = this.evidence.validatePlanEvent(event);
        const current = timeline.current;
        if (current && canonicalJson(current.plan) !== canonicalJson(plan)) {
          fail('STALE_EVIDENCE', 'PLAN_REGISTERED cannot replace the current active plan');
        }
        const existing = timeline.records.filter((candidate) => candidate.plan.waveId === event.waveId);
        if (existing.length > 0) same(existing[existing.length - 1].plan, plan, 'Review Plan registration');
        return appendAndProject({
          gate: this,
          event,
          expectedRevision,
          expectedChainDigest,
          receipts: [],
          resolutionHint: existing.length > 0 ? 'RECEIPT_REUSE' : null,
        });
      }

      if (event.eventType === INPUTS_INVALIDATED) {
        const current = latestPlanRecord(timeline.records);
        const duplicate = history.events.find((candidate) => candidate.eventId === event.eventId);
        const plan = duplicate
          ? (same(duplicate, event, 'event identity'), this.evidence.validatePlan(event.payload.plan))
          : this.evidence.validateInputsInvalidatedEvent(event, current.plan);
        if (duplicate) same(plan.workId, current.plan.workId, 'invalidation workId');
        if (!duplicate && timeline.records.some((candidate) => candidate.plan.planId === plan.planId)) {
          fail('STALE_EVIDENCE', 'INPUTS_INVALIDATED cannot reopen a superseded plan');
        }
        if (!duplicate) {
          const collected = collectResults(history, timeline, history.events.length - 1, this.evidence);
          assertNoUnresolvedRemovedLanes(plan, collected.accumulatedByLane);
        }
        return appendAndProject({
          gate: this,
          event,
          expectedRevision,
          expectedChainDigest,
          receipts: [],
        });
      }

      if (event.eventType === AUTHORITY_OVERRIDE_RECORDED) {
        const planRecord = latestPlanRecord(timeline.records);
        same(event.waveId, planRecord.plan.waveId, 'authority waveId', 'STALE_EVIDENCE');
        same(event.planId, planRecord.plan.planId, 'authority planId', 'STALE_EVIDENCE');
        const validated = this.evidence.validateAuthorityEvent(event, planRecord.plan, {
          nowMs: clockMs(this.now),
        });
        if (validated.obligation) {
          if (!this.evidence.trustedProducer(event, event.eventType, validated.obligation.lane)) {
            fail('UNTRUSTED_LANE', 'authority producer is not trusted for the obligation lane');
          }
        } else if (validated.target.type === 'WAVE') {
          for (const obligation of planRecord.plan.obligations) {
            if (!this.evidence.trustedProducer(event, event.eventType, obligation.lane)) {
              fail('UNTRUSTED_LANE', 'authority producer is not trusted for the wave lanes');
            }
          }
        }
        return appendAndProject({
          gate: this,
          event,
          expectedRevision,
          expectedChainDigest,
          receipts: [validated.receipt],
        });
      }

      const planRecord = latestPlanRecord(timeline.records);
      same(event.waveId, planRecord.plan.waveId, 'review result waveId', 'STALE_EVIDENCE');
      same(event.planId, planRecord.plan.planId, 'review result planId', 'STALE_EVIDENCE');
      const duplicateIndex = history.events.findIndex((candidate) => candidate.eventId === event.eventId);
      const collected = collectResults(
        history,
        timeline,
        duplicateIndex >= 0 ? duplicateIndex - 1 : history.events.length - 1,
        this.evidence,
      );
      const priorFindings = collected.accumulatedByLane.get(event.lane) || [];
      const validated = this.evidence.validateReviewEvent(event, planRecord.plan, priorFindings);
      if (!this.evidence.trustedProducer(event, event.eventType, validated.obligation.lane)) {
        fail('UNTRUSTED_LANE', 'event producer is not trusted for the requested lane');
      }
      const normalizedEvent = this.evidence.normalizeReviewEvent(event, validated);
      if (duplicateIndex >= 0) {
        same(history.events[duplicateIndex], normalizedEvent, 'event identity', 'IDEMPOTENCY_CONFLICT');
      }
      const receipt = duplicateIndex >= 0
        ? receiptFor(history, normalizedEvent, planRecord.plan, validated, this.evidence)
        : this.evidence.buildReceipt(normalizedEvent, planRecord.plan, validated, recordedAt(this.now));
      return appendAndProject({
        gate: this,
        event: normalizedEvent,
        expectedRevision,
        expectedChainDigest,
        receipts: [receipt],
      });
    } catch (error) {
      return rejection(
        this.evidence,
        expectedRevision,
        expectedChainDigest,
        [error && error.code ? error.code : 'MALFORMED_EVIDENCE'],
        event && isRecord(event) ? event : null,
      );
    }
  }

  inspect({ workId, waveId = null, expectedRevision, expectedChainDigest, evaluatedAt } = {}) {
    try {
      if (typeof workId !== 'string' || workId.trim() === '') fail('MALFORMED_EVIDENCE', 'workId is required');
      if (waveId !== null && waveId !== undefined
        && (typeof waveId !== 'string' || waveId.trim() === '')) {
        fail('MALFORMED_EVIDENCE', 'waveId is invalid');
      }
      if (evaluatedAt !== undefined && evaluatedAt !== null
        && (typeof evaluatedAt !== 'string' || !Number.isFinite(Date.parse(evaluatedAt)))) {
        fail('MALFORMED_EVIDENCE', 'evaluatedAt is invalid');
      }
      const history = readHistory(this.receiptStore, workId, expectedRevision, expectedChainDigest);
      const timeline = planTimeline(history, this.evidence);
      const planRecord = waveId ? planRecordAt(timeline.records, waveId) : latestPlanRecord(timeline.records);
      const evaluationMs = clockMs(this.now);
      return project(history, timeline, planRecord, evaluatedAt, evaluationMs, null, this.evidence);
    } catch (error) {
      return rejection(
        this.evidence,
        expectedRevision,
        expectedChainDigest,
        [error && error.code ? error.code : 'MALFORMED_EVIDENCE'],
        workId ? { workId, waveId } : null,
      );
    }
  }
}

module.exports = {
  ReviewGate,
  PLAN_REGISTERED,
  REVIEW_RESULT_RECORDED,
  INPUTS_INVALIDATED,
  AUTHORITY_OVERRIDE_RECORDED,
  REVIEW_GATE_EVENT_TYPES,
};
