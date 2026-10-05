'use strict';

const crypto = require('node:crypto');

const COUNTERS = Object.freeze([
  'reported_input', 'fresh_input', 'cache_read_input', 'cache_write_input',
  'output', 'reported_total', 'normalized_input',
]);
const IDENTITIES = Object.freeze([
  'session_id', 'parent_session_id', 'request_id', 'message_id', 'event_id',
  'task_id', 'attempt_id', 'producer_id', 'wave_id', 'scope_id', 'scope_digest',
  'adapter_id', 'stage', 'source_commit', 'source_tree', 'plan_fingerprint',
  'artifact_fingerprint', 'host', 'target_agent', 'provider', 'model',
  'requested_role', 'observed_role', 'requested_effort', 'observed_effort',
]);
const STATUSES = Object.freeze(['observed', 'derived', 'unavailable', 'unsupported', 'conflict']);
const REASONS = Object.freeze([
  'missing-evidence', 'adapter-not-supported', 'invalid-counter', 'invalid-identity',
  'conflicting-evidence', 'scan-truncation-unverified', 'content-fingerprint-unavailable',
]);
const RULES = Object.freeze([
  'inclusive-input-minus-cache', 'disjoint-input-sum', 'input-plus-output', 'cumulative-delta', 'subtotal-sum',
]);
const SOURCE_KINDS = Object.freeze([
  'claude-transcript', 'claude-artifact', 'codex-transcript', 'orca-trace',
  'orca-transcript', 'orca-codex-session', 'codex-state', 'orca-state',
  'project-codex-transcript', 'project-claude-artifact',
]);
const SCAN_COUNTS = Object.freeze([
  'lines', 'matched', 'dhpkMatched', 'nonDhpk', 'malformed', 'missingTimestamp',
  'skippedDate', 'unsupported', 'typedFailures', 'bytes',
]);
const OMITTED_STATUSES = Object.freeze(['UNAVAILABLE', 'UNREADABLE', 'UNSUPPORTED', 'OMITTED']);

function opaque(namespace, value) {
  return `${namespace}:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function references(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== 'string' || !/^evidence:[a-f0-9]{64}$/.test(value)
  ))) throw new Error('Invalid telemetry evidence reference');
  return [...new Set(values)];
}

// These are typed contract values, not vendor-record adapters. No caller object
// is spread into an artifact, and no requested identity supplies an observed one.
function createScalar({ field, value = null, status = 'unavailable', evidence_refs = [], derivation = null, reason } = {}) {
  if (!COUNTERS.includes(field) && !IDENTITIES.includes(field)) throw new Error('Unknown telemetry field');
  if (!STATUSES.includes(status)) throw new Error('Invalid telemetry status');
  const refs = references(evidence_refs);
  const present = ['observed', 'derived'].includes(status);
  const valid = COUNTERS.includes(field)
    ? Number.isSafeInteger(value) && value >= 0
    : typeof value === 'string' && value.length > 0 && value.length <= 4096;
  const resolvedStatus = present && value !== null && !valid ? 'conflict'
    : present && value === null ? 'unavailable' : status;
  if (present && valid && refs.length === 0) throw new Error('Telemetry value requires evidence');
  let resolvedDerivation = null;
  if (resolvedStatus === 'derived') {
    if (!derivation || !RULES.includes(derivation.rule)) throw new Error('Invalid telemetry derivation');
    const inputs = references(derivation.inputs);
    if (inputs.length === 0) throw new Error('Telemetry derivation requires inputs');
    resolvedDerivation = { rule: derivation.rule, inputs };
  }
  const resolvedValue = ['observed', 'derived'].includes(resolvedStatus)
    ? COUNTERS.includes(field) ? value : opaque('id', value)
    : null;
  const defaultReason = resolvedStatus === 'unsupported' ? 'adapter-not-supported'
    : resolvedStatus === 'conflict' ? (present && !valid
      ? COUNTERS.includes(field) ? 'invalid-counter' : 'invalid-identity'
      : 'conflicting-evidence')
      : 'missing-evidence';
  return freeze({
    value: resolvedValue,
    status: resolvedStatus,
    evidence_refs: refs,
    derivation: resolvedDerivation,
    reason: resolvedValue !== null ? null : REASONS.includes(reason) ? reason : defaultReason,
  });
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sum(sources, key) {
  const values = sources.map((source) => source.stats[key]);
  if (values.some((value) => value === null)) return null;
  return count(values.reduce((total, value) => total + value, 0));
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function timezone(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch (_error) { return null; }
}

function unsupported() {
  return { status: 'unsupported', complete: false, reason: 'adapter-not-supported', count: null };
}

function nullableFields(fields) {
  return Object.fromEntries(fields.map((field) => [field, createScalar({ field, status: 'unsupported' })]));
}

function buildTelemetry({ selection = {}, sourceStats = [], omittedSources = [], partial = false, usage } = {}) {
  // Only the immutable, allowlisted reconciliation result may cross this seam.
  // Loading here avoids a cycle with the scalar constructors used by adapters.
  const reconciled = usage && require('./usage-reconciliation').isReconciledUsage(usage) ? usage : null;
  const sources = (Array.isArray(sourceStats) ? sourceStats : []).map((source) => ({
    locator: typeof source?.path === 'string' && source.path ? opaque('source', source.path) : null,
    kind: SOURCE_KINDS.includes(source?.kind) ? source.kind : 'unsupported',
    adapter_version: 'contract-only.v1',
    content_fingerprint: createScalar({ field: 'source_tree', reason: 'content-fingerprint-unavailable' }),
    stats: Object.fromEntries(SCAN_COUNTS.map((key) => [key, count(source?.stats?.[key])])),
    partial: typeof source?.stats?.partial === 'boolean' ? source.stats.partial : null,
    limit_reached: typeof source?.stats?.limitReached === 'boolean' ? source.stats.limitReached : null,
  }));
  const omitted = (Array.isArray(omittedSources) ? omittedSources : []).map((source) => ({
    locator: typeof source?.path === 'string' && source.path ? opaque('source', source.path) : null,
    kind: SOURCE_KINDS.includes(source?.kind) ? source.kind : 'unsupported',
    status: OMITTED_STATUSES.includes(source?.status) ? source.status : 'UNSUPPORTED',
    reason: ['configured-active-account-missing', 'active-account-not-selected'].includes(source?.reason)
      ? source.reason : 'source-omitted',
  }));
  const legacyScanComplete = partial === false && sources.every((source) => source.partial === false);
  const selected = {
    date_range: { from: date(selection.dateRange?.from), to: date(selection.dateRange?.to) },
    time_zone: timezone(selection.timeZone),
    source_filter: ['auto', 'claude', 'codex', 'orca'].includes(selection.source) ? selection.source : null,
    agent_filters: (Array.isArray(selection.agents) ? selection.agents : [])
      .filter((agent) => typeof agent === 'string' && agent.length > 0).map((agent) => opaque('id', agent)),
    max_bytes: count(selection.maxBytes),
    max_sessions: count(selection.maxSessions),
  };
  return freeze({
    schema: 'dhpk.session-usage-audit.telemetry.v1',
    claim_boundary: 'local-usage-only',
    selection: selected,
    reusable: false,
    reuse_reason: 'content-fingerprint-unavailable',
    sources,
    omitted_sources: omitted,
    metrics: nullableFields(COUNTERS),
    identities: nullableFields(IDENTITIES),
    observations: reconciled ? reconciled.observations : [],
    ...(reconciled ? { contributions: reconciled.contributions } : {}),
    coverage: {
      scan: {
        status: 'unavailable', complete: null, reason: 'scan-truncation-unverified',
        legacy_scan_complete: legacyScanComplete,
        scanned_sources: sources.length,
        malformed: sum(sources, 'malformed'),
        missing_timestamp: sum(sources, 'missingTimestamp'),
        unsupported_records: sum(sources, 'unsupported'),
        partial_sources: sources.filter((source) => source.partial === true).length,
        omitted_sources: omitted.length,
        truncated: null,
      },
      source: {
        status: omitted.length ? 'unavailable' : 'observed',
        complete: legacyScanComplete && omitted.length === 0 && sum(sources, 'unsupported') === 0,
        reason: omitted.length ? 'source-omitted' : 'legacy-source-inventory-only',
        omitted: omitted.length,
      },
      usage_extraction: reconciled ? reconciled.coverage.usage_extraction : unsupported(),
      semantics: reconciled ? reconciled.coverage.semantics : unsupported(),
      reconciliation: reconciled ? reconciled.coverage.reconciliation : unsupported(),
      attribution: reconciled ? reconciled.coverage.attribution : unsupported(),
      cache_categories: reconciled ? reconciled.coverage.cache_categories : {
        ...unsupported(),
        categories: Object.fromEntries(['fresh_input', 'cache_read_input', 'cache_write_input'].map((key) => [key, unsupported()])),
      },
    },
    totals: reconciled ? reconciled.totals : Object.fromEntries(['planner', 'descendants', 'unattributed'].map((key) => [key, {
      known_subtotal: createScalar({ field: 'reported_total', status: 'unsupported' }),
      complete_total: createScalar({ field: 'reported_total', status: 'unsupported' }),
      complete: false,
    }])),
  });
}

const VOCABULARY = Object.freeze({
  counters: COUNTERS, identities: IDENTITIES, statuses: STATUSES, reasons: REASONS, rules: RULES,
});

module.exports = { createScalar, buildTelemetry, VOCABULARY };
