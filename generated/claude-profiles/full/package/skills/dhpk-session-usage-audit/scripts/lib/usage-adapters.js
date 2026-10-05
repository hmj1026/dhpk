'use strict';

const { createScalar, VOCABULARY } = require('./usage-contract');

const { counters: COUNTERS, identities: IDENTITIES } = VOCABULARY;
const EVIDENCE = /^evidence:[a-f0-9]{64}$/;
const IDENTITY = /^id:[a-f0-9]{64}$/;
const COMPLETE_STOP_REASONS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use']);
const SDK_SOURCE_KINDS = new Set(['claude-transcript', 'claude-artifact']);
const SDK_PROFILE = Object.freeze({
  id: 'claude.sdk-assistant.v0.2.163',
  version: 'schema-v0.2.163',
  verified: true,
  input_relation: 'disjoint',
  cache_categories: ['fresh_input', 'cache_read_input', 'cache_write_input'],
  total_definition: 'input-plus-output',
  output_subcategories_included: ['reasoning_output'],
});

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function refsFor(evidence, field) {
  const candidate = plain(evidence) ? evidence[field] : null;
  if (!Array.isArray(candidate)) return [];
  return [...new Set(candidate.filter((item) => typeof item === 'string' && EVIDENCE.test(item)))];
}

function scalar(field, value, status, evidence, options = {}) {
  return createScalar({
    field,
    value,
    status,
    evidence_refs: evidence,
    ...(options.derivation ? { derivation: options.derivation } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  });
}

function absent(field, reason = 'missing-evidence', status = 'unavailable') {
  return scalar(field, null, status, [], { reason });
}

function present(field, counters, evidence) {
  if (!plain(counters) || !Object.prototype.hasOwnProperty.call(counters, field) || counters[field] === null) {
    return ['fresh_input', 'cache_read_input', 'cache_write_input'].includes(field)
      ? absent(field, 'adapter-not-supported', 'unsupported')
      : absent(field);
  }
  const refs = refsFor(evidence, field);
  if (Number.isSafeInteger(counters[field]) && counters[field] >= 0 && refs.length === 0) return absent(field);
  return scalar(field, counters[field], 'observed', refs);
}

function isValue(value) {
  return value && ['observed', 'derived'].includes(value.status) && Number.isSafeInteger(value.value) && value.value >= 0;
}

function evidenceOf(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value?.evidence_refs) ? value.evidence_refs : []))]
    .filter((reference) => EVIDENCE.test(reference));
}

function derived(field, value, inputs, rule) {
  const evidence = evidenceOf(...inputs);
  if (evidence.length === 0) return absent(field);
  return scalar(field, value, 'derived', evidence, {
    derivation: { rule, inputs: evidence },
  });
}

function conflict(field, evidence = []) {
  return scalar(field, null, 'conflict', evidence.filter((reference) => EVIDENCE.test(reference)), {
    reason: 'conflicting-evidence',
  });
}

function safeSum(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}

function normalizeUsage({ counters = {}, profile = {}, evidence = {} } = {}) {
  const raw = Object.fromEntries(COUNTERS.filter((field) => field !== 'normalized_input')
    .map((field) => [field, present(field, counters, evidence)]));
  const verified = plain(profile) && profile.verified === true;
  const relation = verified && ['inclusive', 'disjoint', 'unknown'].includes(profile.input_relation)
    ? profile.input_relation : 'unknown';
  const categories = Array.isArray(profile.cache_categories) ? profile.cache_categories : [];
  const validCategories = categories.length <= 3
    && categories.every((category) => ['fresh_input', 'cache_read_input', 'cache_write_input'].includes(category))
    && new Set(categories).size === categories.length;
  const semanticsKnown = verified && validCategories && relation !== 'unknown';
  let fresh = raw.fresh_input;
  let normalized = absent('normalized_input', 'adapter-not-supported', 'unsupported');

  if (semanticsKnown && relation === 'inclusive') {
    normalized = isValue(raw.reported_input)
      ? scalar('normalized_input', raw.reported_input.value, 'observed', raw.reported_input.evidence_refs)
      : raw.reported_input.status === 'conflict'
        ? conflict('normalized_input', raw.reported_input.evidence_refs)
        : absent('normalized_input');

    const included = categories.filter((category) => category === 'cache_read_input' || category === 'cache_write_input');
    const required = included.map((category) => raw[category]);
    if (raw.reported_input.status === 'conflict' || required.some((value) => value.status === 'conflict')) {
      fresh = conflict('fresh_input', evidenceOf(raw.reported_input, ...required));
    } else if (isValue(raw.reported_input) && required.every(isValue)) {
      const subset = safeSum(required.map((value) => value.value));
      const value = subset === null ? null : raw.reported_input.value - subset;
      if (value === null || value < 0 || !Number.isSafeInteger(value)) {
        fresh = conflict('fresh_input', evidenceOf(raw.reported_input, ...required));
        normalized = conflict('normalized_input', evidenceOf(raw.reported_input, ...required));
      } else if (isValue(raw.fresh_input) && raw.fresh_input.value !== value) {
        fresh = conflict('fresh_input', evidenceOf(raw.reported_input, ...required, raw.fresh_input));
      } else {
        fresh = derived('fresh_input', value, [raw.reported_input, ...required], 'inclusive-input-minus-cache');
      }
    } else {
      fresh = absent('fresh_input');
    }
  } else if (semanticsKnown && relation === 'disjoint') {
    const requiredCategories = [...new Set(['fresh_input', ...categories])];
    const required = requiredCategories.map((category) => raw[category]);
    if (required.length === 0) {
      normalized = absent('normalized_input');
    } else if (required.some((value) => value.status === 'conflict')) {
      normalized = conflict('normalized_input', evidenceOf(...required));
    } else if (required.every(isValue)) {
      const value = safeSum(required.map((item) => item.value));
      normalized = value === null
        ? conflict('normalized_input', evidenceOf(...required))
        : derived('normalized_input', value, required, 'disjoint-input-sum');
    } else {
      normalized = absent('normalized_input');
    }
  }

  const metrics = { ...raw, fresh_input: fresh, normalized_input: normalized };
  const output = metrics.output;
  const reportedTotal = metrics.reported_total;
  let total = absent('reported_total', 'adapter-not-supported', 'unsupported');
  const reasoning = plain(counters) ? counters.reasoning_output : null;
  const reasoningIncluded = plain(profile)
    && Array.isArray(profile.output_subcategories_included)
    && profile.output_subcategories_included.includes('reasoning_output');

  if (semanticsKnown && profile.total_definition === 'input-plus-output') {
    if (reasoningIncluded && reasoning !== undefined && reasoning !== null
      && (!Number.isSafeInteger(reasoning) || reasoning < 0 || (isValue(output) && reasoning > output.value))) {
      total = conflict('reported_total', evidenceOf(output, reportedTotal));
    } else if (normalized.status === 'conflict' || metrics.fresh_input.status === 'conflict'
      || output.status === 'conflict' || reportedTotal.status === 'conflict') {
      total = conflict('reported_total', evidenceOf(normalized, output, reportedTotal));
    } else if (isValue(normalized) && isValue(output)) {
      const value = safeSum([normalized.value, output.value]);
      if (value === null) {
        total = conflict('reported_total', evidenceOf(normalized, output));
      } else if (isValue(reportedTotal) && reportedTotal.value !== value) {
        total = conflict('reported_total', evidenceOf(normalized, output, reportedTotal));
      } else {
        total = derived('reported_total', value, [normalized, output, ...(isValue(reportedTotal) ? [reportedTotal] : [])], 'input-plus-output');
      }
    } else {
      total = absent('reported_total');
    }
  }

  return Object.freeze({ metrics: Object.freeze(metrics), total });
}

function identity(field, value, ref) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || !EVIDENCE.test(ref)) {
    return absent(field);
  }
  return scalar(field, value, 'observed', [ref]);
}

function emptyIdentities() {
  return Object.fromEntries(IDENTITIES.map((field) => [field, absent(field, 'adapter-not-supported', 'unsupported')]));
}

function observationRef(context) {
  const value = plain(context) ? context.observation_ref || context.physicalEvidenceRef : null;
  return typeof value === 'string' && EVIDENCE.test(value) ? value : null;
}

function usageCounters(usage) {
  if (!plain(usage)) return null;
  const hasKnownField = [
    'input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
    'output_tokens',
  ].some((field) => Object.prototype.hasOwnProperty.call(usage, field));
  if (!hasKnownField) return null;
  const counters = {};
  if (Object.prototype.hasOwnProperty.call(usage, 'input_tokens')) {
    counters.reported_input = usage.input_tokens;
    counters.fresh_input = usage.input_tokens;
  }
  if (Object.prototype.hasOwnProperty.call(usage, 'cache_read_input_tokens')) counters.cache_read_input = usage.cache_read_input_tokens;
  if (Object.prototype.hasOwnProperty.call(usage, 'cache_creation_input_tokens')) counters.cache_write_input = usage.cache_creation_input_tokens;
  if (Object.prototype.hasOwnProperty.call(usage, 'output_tokens')) counters.output = usage.output_tokens;
  return counters;
}

function evidenceForCounters(counters, ref) {
  return Object.fromEntries(Object.keys(counters).filter((field) => COUNTERS.includes(field) && field !== 'normalized_input')
    .map((field) => [field, [ref]]));
}

function instant(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function adaptSdkRecord(record, context, ref, sourceKind) {
  if (!plain(record) || !SDK_SOURCE_KINDS.has(sourceKind) || record.type !== 'assistant'
    || typeof record.session_id !== 'string') return null;
  const message = record.message;
  if (!plain(message) || message.type !== 'message' || message.role !== 'assistant'
    || typeof message.id !== 'string' || typeof message.model !== 'string') return null;
  const counters = usageCounters(message.usage);
  if (!counters) return null;
  const completed = COMPLETE_STOP_REASONS.has(message.stop_reason);
  const profile = completed ? SDK_PROFILE : { verified: false, input_relation: 'unknown' };
  const evidence = evidenceForCounters(counters, ref);
  const normalized = normalizeUsage({ counters, profile, evidence });
  const ids = emptyIdentities();
  ids.session_id = identity('session_id', record.session_id, ref);
  ids.message_id = identity('message_id', message.id, ref);
  ids.model = identity('model', message.model, ref);
  ids.adapter_id = identity('adapter_id', SDK_PROFILE.id, ref);
  const session = ids.session_id.value;
  const metrics = completed ? normalized.metrics : Object.freeze({
    ...normalized.metrics,
    normalized_input: absent('normalized_input', 'adapter-not-supported', 'unsupported'),
  });
  const total = completed ? normalized.total : absent('reported_total', 'adapter-not-supported', 'unsupported');
  return Object.freeze({
    observation_ref: ref,
    evidence_refs: Object.freeze([ref]),
    adapter_id: SDK_PROFILE.id,
    adapter_version: SDK_PROFILE.version,
    selected_context_id: IDENTITY.test(session) ? session : null,
    identities: Object.freeze(ids),
    metrics,
    total,
    semantics: Object.freeze({
      input_relation: completed ? 'disjoint' : 'unknown',
      basis: completed ? 'per-event' : 'unknown',
      stream: null,
      epoch: null,
      observed_at: instant(record.timestamp),
      covered_interval: null,
      descendant_inclusion: 'unknown',
      included_observation_refs: Object.freeze([]),
      mirror_origin_ref: null,
    }),
    context_ref: plain(context) && typeof context.selectedContextRef === 'string' && EVIDENCE.test(context.selectedContextRef)
      ? context.selectedContextRef : null,
    eligible: completed,
  });
}

function adaptCodexSnapshot(record, ref, sourceKind) {
  if (sourceKind !== 'codex-transcript' || !plain(record) || record.type !== 'event_msg') return null;
  const payload = record.payload;
  if (!plain(payload) || payload.type !== 'token_count' || !plain(payload.info)
    || !plain(payload.info.last_token_usage)) return null;
  const usage = payload.info.last_token_usage;
  const counters = {};
  if (Object.prototype.hasOwnProperty.call(usage, 'input_tokens')) counters.reported_input = usage.input_tokens;
  if (Object.prototype.hasOwnProperty.call(usage, 'cached_input_tokens')) counters.cache_read_input = usage.cached_input_tokens;
  if (Object.prototype.hasOwnProperty.call(usage, 'output_tokens')) counters.output = usage.output_tokens;
  if (Object.prototype.hasOwnProperty.call(usage, 'total_tokens')) counters.reported_total = usage.total_tokens;
  if (Object.prototype.hasOwnProperty.call(usage, 'reasoning_output_tokens')) counters.reasoning_output = usage.reasoning_output_tokens;
  if (Object.keys(counters).length === 0) return null;
  const evidence = evidenceForCounters(counters, ref);
  const normalized = normalizeUsage({ counters, profile: { verified: false, input_relation: 'unknown' }, evidence });
  const ids = emptyIdentities();
  ids.adapter_id = identity('adapter_id', 'codex-token-count.snapshot', ref);
  return Object.freeze({
    observation_ref: ref,
    evidence_refs: Object.freeze([ref]),
    adapter_id: 'codex-token-count.snapshot',
    adapter_version: 'protocol-schema-v0.160.0',
    selected_context_id: null,
    identities: Object.freeze(ids),
    metrics: normalized.metrics,
    total: normalized.total,
    semantics: Object.freeze({
      input_relation: 'unknown',
      basis: 'unknown',
      stream: null,
      epoch: null,
      observed_at: instant(record.timestamp),
      covered_interval: null,
      descendant_inclusion: 'unknown',
      included_observation_refs: Object.freeze([]),
      mirror_origin_ref: null,
    }),
    context_ref: null,
    eligible: false,
  });
}

function adaptUsageRecord(record, context = {}) {
  const ref = observationRef(context);
  if (!ref || !plain(context) || typeof context.sourceKind !== 'string') return null;
  return adaptSdkRecord(record, context, ref, context.sourceKind)
    || adaptCodexSnapshot(record, ref, context.sourceKind);
}

module.exports = { normalizeUsage, adaptUsageRecord };
