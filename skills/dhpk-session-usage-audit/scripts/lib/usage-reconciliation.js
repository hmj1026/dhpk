'use strict';

const crypto = require('node:crypto');
const { createScalar, VOCABULARY } = require('./usage-contract');

const { counters: COUNTERS, identities: IDENTITIES } = VOCABULARY;
const EVIDENCE = /^evidence:[a-f0-9]{64}$/;
const IDENTITY = /^id:[a-f0-9]{64}$/;
const STATUSES = new Set(VOCABULARY.statuses);
const REASONS = new Set(VOCABULARY.reasons);
const RULES = new Set(VOCABULARY.rules);
const PROFILE_IDS = new Set(['claude.sdk-assistant.v0.2.163', 'codex-token-count.snapshot']);
const PROFILE_VERSIONS = new Set(['schema-v0.2.163', 'protocol-schema-v0.160.0']);
const BRANDED = new WeakSet();

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function safeRefs(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && EVIDENCE.test(item)))];
}

function emptyScalar(field, status = 'unsupported', reason = 'adapter-not-supported') {
  return createScalar({ field, value: null, status, evidence_refs: [], reason });
}

function copyScalar(field, value) {
  if (!plain(value) || !STATUSES.has(value.status)) return emptyScalar(field);
  const refs = safeRefs(value.evidence_refs);
  const reason = REASONS.has(value.reason) ? value.reason : null;
  if (!['observed', 'derived'].includes(value.status) || value.value === null) {
    return createScalar({
      field, value: null, status: value.status, evidence_refs: refs,
      ...(reason ? { reason } : {}),
    });
  }
  const valid = COUNTERS.includes(field)
    ? Number.isSafeInteger(value.value) && value.value >= 0
    : typeof value.value === 'string' && IDENTITY.test(value.value);
  if (!valid || refs.length === 0) return emptyScalar(field, 'conflict', 'invalid-counter');
  let derivation = null;
  if (value.status === 'derived') {
    if (!plain(value.derivation) || !RULES.has(value.derivation.rule)) return emptyScalar(field, 'conflict', 'conflicting-evidence');
    const inputs = safeRefs(value.derivation.inputs);
    if (!inputs.length) return emptyScalar(field, 'conflict', 'conflicting-evidence');
    derivation = { rule: value.derivation.rule, inputs };
  }
  if (!COUNTERS.includes(field)) {
    return freeze({ value: value.value, status: value.status, evidence_refs: refs, derivation, reason: null });
  }
  return createScalar({
    field, value: value.value, status: value.status, evidence_refs: refs,
    ...(derivation ? { derivation } : {}),
  });
}

function scalarValue(value) {
  return plain(value) && ['observed', 'derived'].includes(value.status)
    && Number.isSafeInteger(value.value) && value.value >= 0 ? value.value : null;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeProfile(value, supported) {
  if (supported && typeof value === 'string' && PROFILE_IDS.has(value)) return value;
  if (typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-z][a-z0-9._-]*$/.test(value)) {
    return `id:${hash(`profile:${value}`)}`;
  }
  return 'unsupported-profile';
}

function safeVersion(value, supported) {
  return supported && typeof value === 'string' && PROFILE_VERSIONS.has(value) ? value : 'unknown';
}

function instant(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function dateAt(value, timeZone) {
  const normalized = instant(value);
  if (!normalized || typeof timeZone !== 'string' || timeZone.length > 100) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(normalized));
    const part = Object.fromEntries(parts.filter((item) => ['year', 'month', 'day'].includes(item.type))
      .map((item) => [item.type, item.value]));
    return `${part.year}-${part.month}-${part.day}`;
  } catch (_error) {
    return null;
  }
}

function inDateRange(value, selection) {
  const range = plain(selection) && plain(selection.dateRange) ? selection.dateRange : null;
  const from = validDate(range?.from);
  const to = validDate(range?.to);
  const date = dateAt(value, selection?.timeZone);
  return Boolean(from && to && from <= to && date && date >= from && date <= to);
}

function safeInterval(value) {
  if (!plain(value) || Object.keys(value).some((key) => !['from', 'to'].includes(key))) return null;
  const from = instant(value.from);
  const to = instant(value.to);
  return from && to && from < to ? { from, to } : null;
}

function copyMetrics(value) {
  const source = plain(value) ? value : {};
  return Object.fromEntries(COUNTERS.map((field) => [field, copyScalar(field, source[field])]));
}

function copyIdentities(value) {
  const source = plain(value) ? value : {};
  return Object.fromEntries(IDENTITIES.map((field) => [field, copyScalar(field, source[field])]));
}

function safeSemantics(value) {
  const source = plain(value) ? value : {};
  const relation = ['inclusive', 'disjoint', 'unknown'].includes(source.input_relation) ? source.input_relation : 'unknown';
  const basis = ['per-event', 'cumulative-snapshot', 'aggregate', 'unknown'].includes(source.basis) ? source.basis : 'unknown';
  const refs = safeRefs(source.included_observation_refs);
  return {
    input_relation: relation,
    basis,
    stream: typeof source.stream === 'string' && IDENTITY.test(source.stream) ? source.stream : null,
    epoch: typeof source.epoch === 'string' && IDENTITY.test(source.epoch) ? source.epoch : null,
    observed_at: instant(source.observed_at),
    covered_interval: safeInterval(source.covered_interval),
    continuity_verified: source.continuity_verified === true,
    date_allocation_verified: source.date_allocation_verified === true,
    baseline_ref: typeof source.baseline_ref === 'string' && EVIDENCE.test(source.baseline_ref) ? source.baseline_ref : null,
    interval_proof_ref: typeof source.interval_proof_ref === 'string' && EVIDENCE.test(source.interval_proof_ref)
      ? source.interval_proof_ref : null,
    descendant_inclusion: ['includes', 'excludes', 'unknown'].includes(source.descendant_inclusion)
      ? source.descendant_inclusion : 'unknown',
    complete_aggregate: source.complete_aggregate === true,
    membership_proof_ref: typeof source.membership_proof_ref === 'string' && EVIDENCE.test(source.membership_proof_ref)
      ? source.membership_proof_ref : null,
    included_observation_refs: refs,
    mirror_origin_ref: typeof source.mirror_origin_ref === 'string' && EVIDENCE.test(source.mirror_origin_ref)
      ? source.mirror_origin_ref : null,
    mirror_proof_ref: typeof source.mirror_proof_ref === 'string' && EVIDENCE.test(source.mirror_proof_ref)
      ? source.mirror_proof_ref : null,
  };
}

function semanticIdentity(value, evidenceRefs) {
  const present = typeof value === 'string' && IDENTITY.test(value);
  const refs = present ? safeRefs(evidenceRefs) : [];
  return freeze({
    value: present && refs.length ? value : null,
    status: present && refs.length ? 'observed' : 'unsupported',
    evidence_refs: refs,
    derivation: null,
    reason: present && refs.length ? null : 'adapter-not-supported',
  });
}

function outputSemantics(entry) {
  return {
    ...entry.semantics,
    stream: semanticIdentity(entry.semantics.stream, entry.evidence_refs),
    epoch: semanticIdentity(entry.semantics.epoch, entry.evidence_refs),
  };
}

function removeContributionsForRefs(contributions, refs) {
  const targets = new Set(refs);
  const removed = contributions.filter((item) => item.observation_refs.some((ref) => targets.has(ref)));
  const removeRefs = new Set(removed.flatMap((item) => item.observation_refs));
  for (let index = contributions.length - 1; index >= 0; index -= 1) {
    if (removed.includes(contributions[index])) contributions.splice(index, 1);
  }
  return removeRefs;
}

function expandRelatedRefs(entries, refs) {
  const expanded = new Set(refs);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (expanded.has(entry.observation_ref)) continue;
      if (entry.reconciliation.related_observation_refs.some((ref) => expanded.has(ref))) {
        expanded.add(entry.observation_ref);
        changed = true;
      }
    }
  }
  return expanded;
}

function normalizedObservation(value) {
  const source = plain(value) ? value : {};
  const ref = typeof source.observation_ref === 'string' && EVIDENCE.test(source.observation_ref)
    ? source.observation_ref : null;
  const profileId = safeProfile(source.adapter_id, PROFILE_IDS.has(source.adapter_id));
  const profileVersion = safeVersion(source.adapter_version, PROFILE_VERSIONS.has(source.adapter_version));
  const identities = copyIdentities(source.identities);
  const metrics = copyMetrics(source.metrics);
  const total = copyScalar('reported_total', source.total);
  const contextRef = typeof source.context_ref === 'string' && EVIDENCE.test(source.context_ref) ? source.context_ref : null;
  return {
    observation_ref: ref,
    evidence_refs: safeRefs(source.evidence_refs).length ? safeRefs(source.evidence_refs) : (ref ? [ref] : []),
    adapter_id: profileId,
    adapter_version: profileVersion,
    identities,
    metrics,
    total,
    semantics: safeSemantics(source.semantics),
    context_ref: contextRef,
    reconciliation: { disposition: 'unresolved', contribution_ref: null, related_observation_refs: [], reason: null },
    attribution: 'unattributed',
    _eligible: Boolean(contextRef && ref),
    _original: source,
  };
}

function compatibleScalar(left, right) {
  if (left?.status === 'conflict' || right?.status === 'conflict') return false;
  const a = scalarValue(left);
  const b = scalarValue(right);
  return a === null || b === null || a === b;
}

function mergeScalar(field, left, right) {
  const a = scalarValue(left);
  const b = scalarValue(right);
  if (a !== null && b !== null && a !== b) return emptyScalar(field, 'conflict', 'conflicting-evidence');
  const selected = a !== null ? left : right;
  if (!selected || scalarValue(selected) === null) return emptyScalar(field, 'unavailable', 'missing-evidence');
  const refs = [...new Set([...safeRefs(left?.evidence_refs), ...safeRefs(right?.evidence_refs)])];
  if (selected.status === 'derived') {
    const derivation = plain(selected.derivation) && RULES.has(selected.derivation.rule)
      ? { rule: selected.derivation.rule, inputs: [...new Set([...safeRefs(selected.derivation.inputs), ...refs])] } : null;
    if (!derivation) return copyScalar(field, selected);
    return createScalar({ field, value: selected.value, status: 'derived', evidence_refs: refs, derivation });
  }
  return createScalar({ field, value: selected.value, status: 'observed', evidence_refs: refs });
}

function countersCompatible(left, right) {
  return COUNTERS.every((field) => compatibleScalar(left.metrics[field], right.metrics[field]))
    && compatibleScalar(left.total, right.total);
}

function mergeMeasurements(entries) {
  const first = entries[0];
  const metrics = Object.fromEntries(COUNTERS.map((field) => [
    field,
    entries.slice(1).reduce((value, item) => mergeScalar(field, value, item.metrics[field]), first.metrics[field]),
  ]));
  const total = entries.slice(1).reduce((value, item) => mergeScalar('reported_total', value, item.total), first.total);
  return { metrics, total };
}

function identityValue(entry, field) {
  const value = entry.identities[field];
  return plain(value) && ['observed', 'derived'].includes(value.status) && IDENTITY.test(value.value) ? value.value : null;
}

function logicalKey(entry) {
  if (!entry._eligible || entry.semantics.basis !== 'per-event' || entry.semantics.input_relation === 'unknown') return null;
  const session = identityValue(entry, 'session_id');
  const logical = ['request_id', 'message_id', 'event_id'].map((field) => [field, identityValue(entry, field)])
    .filter(([, value]) => value !== null);
  if (!session || logical.length === 0) return null;
  const attempt = identityValue(entry, 'attempt_id');
  return JSON.stringify([entry.adapter_id, entry.adapter_version, session, logical, attempt]);
}

function membershipKey(entry) {
  return logicalKey(entry) || `physical:${entry.observation_ref}`;
}

function makeContribution(entries, measurements, reason = null) {
  const refs = [...new Set(entries.map((entry) => entry.observation_ref).filter((ref) => ref && EVIDENCE.test(ref)))].sort();
  if (refs.length === 0 || scalarValue(measurements.total) === null) return null;
  const contributionRef = `evidence:${hash(`contribution:${refs.join('|')}`)}`;
  const representative = entries[0];
  return {
    contribution_ref: contributionRef,
    observation_refs: refs,
    metrics: copyMetrics(measurements.metrics),
    total: copyScalar('reported_total', measurements.total),
    group: {
      provider: copyScalar('provider', representative.identities.provider),
      model: copyScalar('model', representative.identities.model),
      semantic_profile: semanticIdentity(
        `id:${hash(`${representative.adapter_id}@${representative.adapter_version}`)}`,
        representative.evidence_refs,
      ),
    },
    attribution: 'unattributed',
    reason,
  };
}

function assign(entries, disposition, contributionRef = null, reason = null, related = entries) {
  const refs = [...new Set(related.map((entry) => entry.observation_ref).filter((ref) => ref && EVIDENCE.test(ref)))].sort();
  for (const entry of entries) {
    entry.reconciliation = {
      disposition,
      contribution_ref: contributionRef,
      related_observation_refs: refs,
      reason,
    };
  }
}

function withinSelectedInterval(interval, selection) {
  return interval && inDateRange(interval.from, selection) && inDateRange(interval.to, selection);
}

function deltaScalar(field, end, start) {
  const endValue = scalarValue(end);
  const startValue = scalarValue(start);
  if (endValue === null || startValue === null) return emptyScalar(field, 'unavailable', 'missing-evidence');
  const difference = endValue - startValue;
  const refs = [...new Set([...safeRefs(end.evidence_refs), ...safeRefs(start.evidence_refs)])];
  if (!Number.isSafeInteger(difference) || difference < 0) return emptyScalar(field, 'conflict', 'conflicting-evidence');
  return createScalar({
    field, value: difference, status: 'derived', evidence_refs: refs,
    derivation: { rule: 'cumulative-delta', inputs: refs },
  });
}

function deltaMeasurements(end, start) {
  const metrics = Object.fromEntries(COUNTERS.map((field) => [field, deltaScalar(field, end.metrics[field], start.metrics[field])]));
  const total = deltaScalar('reported_total', end.total, start.total);
  return { metrics, total };
}

function intervalMatches(left, right) {
  const a = left?.semantics.covered_interval;
  const b = right?.semantics.covered_interval;
  return Boolean(a && b && a.from === b.from && a.to === b.to);
}

function intervalsOverlap(left, right) {
  const a = left?.semantics.covered_interval;
  const b = right?.semantics.covered_interval;
  return Boolean(a && b && a.from < b.to && b.from < a.to);
}

function cumulativeReason(target, byRef, selection, partial, omitted) {
  const semantics = target.semantics;
  const baseline = byRef.get(semantics.baseline_ref);
  const interval = semantics.covered_interval;
  const targetTime = semantics.observed_at;
  if (!target._eligible || semantics.input_relation === 'unknown' || scalarValue(target.total) === null) {
    return { reason: 'missing-evidence', baseline };
  }
  if (!semantics.stream || !semantics.epoch || !baseline) return { reason: 'interval-baseline-missing', baseline };
  if (baseline.semantics.basis !== 'cumulative-snapshot'
    || baseline.semantics.stream !== semantics.stream || baseline.semantics.epoch !== semantics.epoch) {
    return { reason: 'interval-epoch-changed', baseline };
  }
  if (!semantics.continuity_verified || !semantics.date_allocation_verified
    || !semantics.interval_proof_ref || partial === true || (Array.isArray(omitted) && omitted.length > 0)) {
    return { reason: 'interval-gap', baseline };
  }
  if (!targetTime || !baseline.semantics.observed_at || !interval
    || interval.from !== baseline.semantics.observed_at || interval.to !== targetTime
    || interval.from >= interval.to) return { reason: 'interval-gap', baseline };
  if (!withinSelectedInterval(interval, selection) || !inDateRange(baseline.semantics.observed_at, selection)) {
    return { reason: 'date-boundary-unallocated', baseline };
  }
  return { reason: null, baseline };
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function reasonCounts(statuses, truncated, omitted) {
  const rows = statuses.map((status) => status || 'missing-evidence');
  return {
    unsupported: rows.filter((status) => status === 'unsupported' || status === 'adapter-not-supported').length,
    missing: rows.filter((status) => status === 'unavailable' || status === 'missing-evidence').length,
    conflicting: rows.filter((status) => status === 'conflict' || status === 'conflicting-evidence').length,
    truncated: safeCount(truncated),
    omitted: safeCount(omitted),
  };
}

function safeCoverage(status, count, reason, counts = {}) {
  return { status, complete: false, reason, count, ...counts, counts };
}

function coverageFor(observations, contributions, partial, omitted, collector = {}) {
  const reconciliationStatuses = observations.map((entry) => entry.reconciliation.disposition);
  const collectorCounts = plain(collector) ? collector : {};
  const truncated = safeCount(collectorCounts.truncated);
  const extractorFailures = safeCount(collectorCounts.failures);
  const omittedCount = safeCount(omitted);
  const countStatus = observations.length ? 'observed' : 'unsupported';
  const reason = partial || omittedCount || truncated ? 'scan-truncation-unverified'
    : observations.length ? null : 'adapter-not-supported';
  const extractionCounts = reasonCounts(observations.map((entry) => (
    entry.adapter_id === 'unsupported-profile' ? 'unsupported'
      : COUNTERS.some((field) => scalarValue(entry.metrics[field]) !== null) || scalarValue(entry.total) !== null
        ? 'observed' : 'missing'
  )), truncated + extractorFailures, omittedCount);
  extractionCounts.unsupported += safeCount(collectorCounts.unsupported);
  if (partial && extractionCounts.truncated === 0) extractionCounts.truncated = 1;
  extractionCounts.omitted = omittedCount;
  const semanticCounts = reasonCounts(observations.map((entry) => (
    entry.semantics.input_relation === 'unknown' || entry.semantics.basis === 'unknown' ? 'unsupported' : 'observed'
  )), truncated, omittedCount);
  const reconcileCounts = {
    ...reasonCounts(reconciliationStatuses, truncated, omittedCount),
    included: reconciliationStatuses.filter((value) => value === 'included').length,
    duplicates: reconciliationStatuses.filter((value) => value === 'duplicate').length,
    conflicts: reconciliationStatuses.filter((value) => value === 'conflict').length,
    unresolved: reconciliationStatuses.filter((value) => value === 'unresolved').length,
    excluded_overlap: reconciliationStatuses.filter((value) => value === 'excluded-overlap').length,
    corroborating: reconciliationStatuses.filter((value) => value === 'corroborating').length,
  };
  const observedCounters = (field) => observations.filter((entry) => scalarValue(entry.metrics[field]) !== null).length;
  const categoryCoverage = (field) => {
    const statuses = observations.map((entry) => entry.metrics[field]?.status);
    const counts = reasonCounts(statuses, truncated, omittedCount);
    return safeCoverage(observedCounters(field) ? 'observed' : 'unsupported', observedCounters(field),
      observedCounters(field) ? reason : 'adapter-not-supported', counts);
  };
  return {
    usage_extraction: safeCoverage(countStatus, observations.length, reason, extractionCounts),
    semantics: safeCoverage(observations.length ? 'observed' : 'unsupported', observations.length - semanticCounts.unsupported,
      semanticCounts.unsupported ? 'adapter-not-supported' : reason, semanticCounts),
    reconciliation: safeCoverage(reconcileCounts.conflicts ? 'conflict' : contributions.length ? 'observed' : 'unavailable', contributions.length,
      reconcileCounts.conflicts ? 'conflicting-evidence' : contributions.length ? reason : 'missing-evidence', reconcileCounts),
    attribution: safeCoverage('unavailable', observations.length, 'adapter-not-supported', {
      planner: 0, descendants: 0, unattributed: contributions.length, unresolved: observations.length,
    }),
    cache_categories: {
      ...safeCoverage(observations.length ? 'observed' : 'unsupported', observations.length, reason, reasonCounts(
        observations.map((entry) => ['fresh_input', 'cache_read_input', 'cache_write_input']
          .some((field) => scalarValue(entry.metrics[field]) !== null) ? 'observed' : 'unsupported'), truncated, omittedCount,
      )),
      categories: Object.fromEntries(['fresh_input', 'cache_read_input', 'cache_write_input'].map((field) => [field, categoryCoverage(field)])),
    },
  };
}

function reconcileUsage(observations, { selection = {}, partial = false, omitted = [], collector = {} } = {}) {
  const inputs = Array.isArray(observations) ? observations : [];
  const entries = inputs.map(normalizedObservation);
  const byRef = new Map(entries.filter((entry) => entry.observation_ref).map((entry) => [entry.observation_ref, entry]));
  const contributions = [];
  let conflicts = 0;
  const consumed = new Set();

  const perEventGroups = new Map();
  for (const entry of entries) {
    const key = logicalKey(entry);
    if (!key) continue;
    if (!perEventGroups.has(key)) perEventGroups.set(key, []);
    perEventGroups.get(key).push(entry);
  }

  for (const pendingGroup of perEventGroups.values()) {
    const group = pendingGroup.filter((entry) => !consumed.has(entry));
    if (group.length === 0) continue;
    if (group.length > 1 && group.some((entry, index) => group.slice(index + 1).some((other) => !countersCompatible(entry, other)))) {
      assign(group, 'conflict', null, 'conflicting-evidence');
      conflicts += group.length;
      group.forEach((entry) => consumed.add(entry));
      continue;
    }
    const mirrors = [];
    for (const candidate of entries) {
      if (consumed.has(candidate) || group.includes(candidate) || !candidate.semantics.mirror_origin_ref) continue;
      const origin = byRef.get(candidate.semantics.mirror_origin_ref);
      if (!origin || !group.includes(origin)) continue;
      if (!candidate.semantics.mirror_proof_ref) continue;
      if (identityValue(candidate, 'session_id') !== identityValue(origin, 'session_id')) continue;
      if (!countersCompatible(group[0], candidate)) {
        assign([...group, candidate], 'conflict', null, 'conflicting-evidence');
        conflicts += group.length + 1;
        group.forEach((entry) => consumed.add(entry));
        consumed.add(candidate);
        mirrors.length = 0;
        break;
      }
      mirrors.push(candidate);
    }
    if (group.every((entry) => consumed.has(entry))) continue;
    const all = [...group, ...mirrors];
    const measurements = mergeMeasurements(group);
    const contribution = makeContribution(group, measurements);
    if (!contribution) {
      assign(all, 'unresolved', null, 'missing-evidence');
      all.forEach((entry) => consumed.add(entry));
      continue;
    }
    contributions.push(contribution);
    const duplicateEntries = all.filter((entry, index) => index > 0 || mirrors.includes(entry));
    assign(group.filter((entry) => !duplicateEntries.includes(entry)), 'included', contribution.contribution_ref, null, all);
    assign(duplicateEntries, 'duplicate', contribution.contribution_ref, 'duplicate-observation', all);
    all.forEach((entry) => consumed.add(entry));
  }

  const cumulativeTargets = entries.filter((entry) => !consumed.has(entry) && entry.semantics.basis === 'cumulative-snapshot');
  const cumulativeProofs = new Map(cumulativeTargets.map((target) => [
    target,
    cumulativeReason(target, byRef, selection, partial, omitted),
  ]));
  const overlappingTargets = new Set();
  for (let leftIndex = 0; leftIndex < cumulativeTargets.length; leftIndex += 1) {
    const left = cumulativeTargets[leftIndex];
    const leftProof = cumulativeProofs.get(left);
    if (leftProof.reason || !leftProof.baseline) continue;
    const leftRange = left.semantics.covered_interval;
    for (const right of cumulativeTargets.slice(leftIndex + 1)) {
      const rightProof = cumulativeProofs.get(right);
      if (rightProof.reason || !rightProof.baseline
        || left.semantics.stream !== right.semantics.stream || left.semantics.epoch !== right.semantics.epoch) continue;
      const rightRange = right.semantics.covered_interval;
      if (leftRange.from < rightRange.to && rightRange.from < leftRange.to) {
        overlappingTargets.add(left);
        overlappingTargets.add(right);
      }
    }
  }
  for (const target of cumulativeTargets) {
    const semantics = target.semantics;
    const proof = cumulativeProofs.get(target);
    const baseline = proof.baseline;
    const reason = overlappingTargets.has(target) ? 'interval-overlap' : proof.reason;
    if (reason) {
      assign([target], 'unresolved', null, reason, baseline ? [baseline, target] : [target]);
      consumed.add(target);
      continue;
    }
    const measurements = deltaMeasurements(target, baseline);
    const metricConflict = COUNTERS.some((field) => measurements.metrics[field].status === 'conflict'
      || baseline.metrics[field].status === 'conflict' || target.metrics[field].status === 'conflict');
    if (scalarValue(measurements.total) === null || metricConflict) {
      assign([baseline, target], 'conflict', null, 'conflicting-evidence');
      conflicts += 1;
      consumed.add(baseline);
      consumed.add(target);
      continue;
    }
    const intervalCandidates = entries.filter((entry) => entry.semantics.basis === 'per-event'
      && entry._eligible && entry.semantics.input_relation !== 'unknown'
      && entry.semantics.stream === semantics.stream && entry.semantics.epoch === semantics.epoch
      && scalarValue(entry.total) !== null && intervalsOverlap(entry, target));
    const partialCandidates = intervalCandidates.filter((entry) => !intervalMatches(entry, target));
    if (partialCandidates.length) {
      const candidateRefs = expandRelatedRefs(entries, partialCandidates.map((entry) => entry.observation_ref));
      const candidateGroup = entries.filter((entry) => candidateRefs.has(entry.observation_ref));
      removeContributionsForRefs(contributions, [...candidateRefs]);
      assign(candidateGroup, 'unresolved', null, 'conflicting-evidence');
      assign([baseline, target], 'unresolved', null, 'conflicting-evidence', [baseline, target, ...candidateGroup]);
      [...candidateGroup, baseline, target].forEach((entry) => consumed.add(entry));
      continue;
    }
    const alternatives = entries.filter((entry) => entry !== target
      && entry.semantics.basis === 'per-event' && entry.semantics.stream === semantics.stream
      && entry.semantics.epoch === semantics.epoch && intervalMatches(entry, target));
    if (alternatives.some((entry) => scalarValue(entry.total) !== scalarValue(measurements.total))) {
      removeContributionsForRefs(contributions, alternatives.map((entry) => entry.observation_ref));
      assign([baseline, target, ...alternatives], 'conflict', null, 'conflicting-evidence');
      conflicts += 1 + alternatives.length;
      [baseline, target, ...alternatives].forEach((entry) => consumed.add(entry));
      continue;
    }
    removeContributionsForRefs(contributions, alternatives.map((entry) => entry.observation_ref));
    const related = [baseline, target, ...alternatives];
    const contribution = makeContribution(related, measurements);
    if (contribution) contributions.push(contribution);
    assign([target], 'included', contribution?.contribution_ref || null, null, related);
    assign([baseline], 'baseline', contribution?.contribution_ref || null, 'cumulative-baseline', related);
    assign(alternatives, 'corroborating', contribution?.contribution_ref || null, 'interval-corroboration', related);
    related.forEach((entry) => consumed.add(entry));
  }

  const aggregates = entries.filter((entry) => !consumed.has(entry) && entry.semantics.basis === 'aggregate');
  const aggregateBlocked = new Set();
  const aggregateMembers = new Map(aggregates.map((entry) => [
    entry,
    entry.semantics.included_observation_refs.map((ref) => byRef.get(ref)).filter(Boolean),
  ]));
  // Snapshot proof-bound aliases before aggregate dispositions replace related refs.
  const aggregateMemberKeys = new Map(aggregates.map((entry) => [
    entry,
    new Set([...expandRelatedRefs(entries, aggregateMembers.get(entry).map((member) => member.observation_ref))]
      .map((ref) => byRef.get(ref)).filter(Boolean).map(membershipKey)),
  ]));
  const overlappingAggregates = new Set();
  for (let leftIndex = 0; leftIndex < aggregates.length; leftIndex += 1) {
    const left = aggregates[leftIndex];
    const leftMembers = aggregateMembers.get(left);
    const leftValid = left.semantics.complete_aggregate && left.semantics.membership_proof_ref
      && leftMembers.length === left.semantics.included_observation_refs.length && leftMembers.length > 0;
    if (!leftValid || left.semantics.descendant_inclusion !== 'includes') continue;
    for (const right of aggregates.slice(leftIndex + 1)) {
      const rightMembers = aggregateMembers.get(right);
      const rightValid = right.semantics.complete_aggregate && right.semantics.membership_proof_ref
        && rightMembers.length === right.semantics.included_observation_refs.length && rightMembers.length > 0;
      if (!rightValid || right.semantics.descendant_inclusion !== 'includes') continue;
      const rightKeys = aggregateMemberKeys.get(right);
      if ([...aggregateMemberKeys.get(left)].some((key) => rightKeys.has(key))) {
        overlappingAggregates.add(left);
        overlappingAggregates.add(right);
      }
    }
  }
  for (const aggregate of aggregates) {
    const semantics = aggregate.semantics;
    const memberRefs = semantics.included_observation_refs;
    const members = aggregateMembers.get(aggregate);
    const membershipValid = semantics.complete_aggregate && semantics.membership_proof_ref
      && memberRefs.length > 0 && members.length === memberRefs.length;
    if (!aggregate._eligible || semantics.input_relation === 'unknown' || scalarValue(aggregate.total) === null) {
      assign([aggregate], 'unresolved', null, 'missing-evidence');
      consumed.add(aggregate);
      continue;
    }
    if (overlappingAggregates.has(aggregate)) {
      const refs = [...new Set([aggregate, ...members].map((entry) => entry.observation_ref))];
      const removed = removeContributionsForRefs(contributions, refs);
      const allRefs = expandRelatedRefs(entries, [...refs, ...removed]);
      const related = entries.filter((entry) => allRefs.has(entry.observation_ref));
      assign([aggregate], 'conflict', null, 'conflicting-evidence', [aggregate, ...related]);
      assign(related.filter((entry) => entry.semantics.basis !== 'aggregate'), 'excluded-overlap', null, 'conflicting-evidence', [aggregate, ...related]);
      conflicts += 1;
      [...members, ...related, aggregate].forEach((entry) => consumed.add(entry));
      continue;
    }
    if (semantics.descendant_inclusion === 'includes' && membershipValid) {
      const refs = members.map((entry) => entry.observation_ref);
      const removed = removeContributionsForRefs(contributions, refs);
      const memberGroupRefs = expandRelatedRefs(entries, [...refs, ...removed]);
      const memberGroup = entries.filter((entry) => memberGroupRefs.has(entry.observation_ref));
      const contribution = makeContribution([aggregate], { metrics: aggregate.metrics, total: aggregate.total });
      if (contribution) contributions.push(contribution);
      assign([aggregate], 'included', contribution?.contribution_ref || null, null, [aggregate, ...memberGroup]);
      for (const member of memberGroup) {
        assign([member], 'excluded-overlap', contribution?.contribution_ref || null, 'aggregate-inclusion-verified', [aggregate, ...memberGroup]);
        consumed.add(member);
      }
      consumed.add(aggregate);
      continue;
    }
    if (semantics.descendant_inclusion === 'unknown') {
      if (membershipValid) {
        const refs = [...new Set([aggregate, ...members].map((entry) => entry.observation_ref))];
        const removed = removeContributionsForRefs(contributions, refs);
        const allRefs = expandRelatedRefs(entries, [...refs, ...removed]);
        entries.filter((entry) => allRefs.has(entry.observation_ref)).forEach((entry) => aggregateBlocked.add(entry));
      }
      const unresolved = membershipValid
        ? entries.filter((entry) => aggregateBlocked.has(entry))
        : [aggregate];
      assign(unresolved, 'unresolved', null, 'aggregate-inclusion-unknown');
      unresolved.forEach((entry) => consumed.add(entry));
      continue;
    }
    if (semantics.descendant_inclusion === 'excludes') {
      const contribution = makeContribution([aggregate], { metrics: aggregate.metrics, total: aggregate.total });
      if (contribution) contributions.push(contribution);
      assign([aggregate], 'included', contribution?.contribution_ref || null, null);
      consumed.add(aggregate);
      continue;
    }
    assign([aggregate], 'unresolved', null, 'aggregate-inclusion-unknown');
    consumed.add(aggregate);
  }

  for (const entry of entries) {
    if (consumed.has(entry)) continue;
    if (entry.semantics.basis !== 'per-event') {
      assign([entry], 'unresolved', null, entry.semantics.basis === 'unknown' ? 'adapter-not-supported' : 'missing-evidence');
      consumed.add(entry);
      continue;
    }
    if (!entry._eligible || entry.semantics.input_relation === 'unknown') {
      assign([entry], 'unresolved', null, entry.context_ref ? 'adapter-not-supported' : 'usage-unselected-context');
      consumed.add(entry);
      continue;
    }
    const key = logicalKey(entry);
    if (!key) {
      assign([entry], 'unresolved', null, 'logical-identity-missing');
      consumed.add(entry);
      continue;
    }
    if (aggregateBlocked.has(entry)) {
      assign([entry], 'unresolved', null, 'aggregate-inclusion-unknown');
      consumed.add(entry);
      continue;
    }
    if (entry.semantics.observed_at && !inDateRange(entry.semantics.observed_at, selection)) {
      assign([entry], 'unresolved', null, 'date-boundary-unallocated');
      consumed.add(entry);
      continue;
    }
    const contribution = makeContribution([entry], { metrics: entry.metrics, total: entry.total });
    if (!contribution) {
      assign([entry], 'unresolved', null, 'missing-evidence');
    } else {
      contributions.push(contribution);
      assign([entry], 'included', contribution.contribution_ref, null);
    }
    consumed.add(entry);
  }

  const totalValues = contributions.map((item) => item.total.value);
  let sum = 0;
  let overflow = false;
  for (const value of totalValues) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) {
      overflow = true;
      break;
    }
    sum += value;
  }
  const subtotal = totalValues.length
    ? overflow ? emptyScalar('reported_total', 'conflict', 'invalid-counter')
      : (() => {
        const refs = [...new Set(contributions.flatMap((item) => item.observation_refs))];
        return createScalar({
          field: 'reported_total', value: sum, status: 'derived', evidence_refs: refs,
          derivation: { rule: 'subtotal-sum', inputs: refs },
        });
      })()
    : emptyScalar('reported_total', entries.length ? 'unavailable' : 'unsupported', entries.length ? 'missing-evidence' : 'adapter-not-supported');
  const unavailableTotal = emptyScalar('reported_total', 'unsupported', 'adapter-not-supported');
  const outputObservations = entries.map((entry) => ({
    observation_ref: entry.observation_ref,
    evidence_refs: entry.evidence_refs,
    adapter_id: entry.adapter_id,
    adapter_version: entry.adapter_version,
    identities: entry.identities,
    metrics: entry.metrics,
    total: entry.total,
    semantics: outputSemantics(entry),
    context_ref: entry.context_ref,
    reconciliation: entry.reconciliation,
    attribution: 'unattributed',
  }));
  const byTotals = (key) => ({
    known_subtotal: key === 'unattributed' ? subtotal : emptyScalar('reported_total'),
    complete_total: unavailableTotal,
    complete: false,
  });
  const result = {
    observations: outputObservations,
    contributions,
    totals: { planner: byTotals('planner'), descendants: byTotals('descendants'), unattributed: byTotals('unattributed') },
    coverage: coverageFor(entries, contributions, partial === true,
      Array.isArray(omitted) ? omitted.length : 0, collector),
  };
  freeze(result);
  BRANDED.add(result);
  return result;
}

function isReconciledUsage(value) {
  return Boolean(value && typeof value === 'object' && BRANDED.has(value));
}

module.exports = { reconcileUsage, isReconciledUsage };
