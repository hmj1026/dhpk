'use strict';

const path = require('node:path');

const MARKER_SCHEMA = 'dhpk.partial-cli-batch.v1';
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalizeFiles(files, label) {
  if (!Array.isArray(files)) throw new TypeError(`${label} must be an array`);
  const normalized = [...new Set(files)].sort();
  for (const file of normalized) {
    if (typeof file !== 'string' || !file || path.isAbsolute(file)
      || file.split(/[\\/]/).includes('..') || file.includes('\0')) {
      throw new TypeError(`${label} must contain repository-relative paths`);
    }
  }
  return normalized;
}

function difference(left, right) {
  const excluded = new Set(right);
  return left.filter((file) => !excluded.has(file));
}

function intersection(...lists) {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists.map((list) => new Set(list));
  return [...first].filter((file) => rest.every((set) => set.has(file))).sort();
}

function deriveCompletionLedger({
  assignedFiles,
  reportedFiles = [],
  changedFiles = [],
  attributableFiles = [],
} = {}) {
  const assigned = normalizeFiles(assignedFiles, 'assignedFiles');
  const reported = normalizeFiles(reportedFiles, 'reportedFiles');
  const changed = normalizeFiles(changedFiles, 'changedFiles');
  const attributable = normalizeFiles(attributableFiles, 'attributableFiles');
  const assignedSet = new Set(assigned);
  const confirmed = intersection(assigned, reported, changed, attributable);
  const claimed = intersection(assigned, [...new Set([...reported, ...changed])]);
  const unconfirmed = difference(claimed, confirmed);
  const remaining = difference(assigned, [...confirmed, ...unconfirmed]);
  const outOfScope = difference(
    [...new Set([...reported, ...changed])].sort(),
    assigned,
  );

  // Keep this explicit: callers must not mistake a sibling edit for a worker
  // result merely because it appeared in a global status/diff.
  return Object.freeze({
    assigned,
    confirmed,
    unconfirmed,
    remaining,
    out_of_scope: outOfScope,
    disjoint: new Set([...confirmed, ...unconfirmed, ...remaining]).size === assignedSet.size,
  });
}

function markerPath({ backend, sessionId, dispatchId } = {}) {
  for (const [label, value] of [['backend', backend], ['sessionId', sessionId], ['dispatchId', dispatchId]]) {
    if (typeof value !== 'string' || !SAFE_SLUG.test(value)) throw new TypeError(`${label} must be a safe slug`);
  }
  return `.claude/artifacts/sessions/.partial-cli-batch-${backend}-${sessionId}-${dispatchId}.json`;
}

function buildPartialMarker({
  backend,
  sessionId,
  dispatchId,
  ledger,
  timeoutObservations,
  nextAction,
} = {}) {
  if (!ledger || ledger.disjoint !== true) throw new TypeError('ledger must be disjoint before marker creation');
  if (!Array.isArray(timeoutObservations) || timeoutObservations.length < 2) {
    throw new TypeError('two timeout observations are required');
  }
  if (typeof nextAction !== 'string' || !nextAction) throw new TypeError('nextAction is required');
  return Object.freeze({
    schema: MARKER_SCHEMA,
    backend,
    session_id: sessionId,
    dispatch_id: dispatchId,
    assigned: ledger.assigned,
    confirmed: ledger.confirmed,
    remaining: ledger.remaining,
    unconfirmed: ledger.unconfirmed,
    timeout_observations: timeoutObservations,
    next_action: nextAction,
    marker_path: markerPath({ backend, sessionId, dispatchId }),
    control_plane: true,
    review_gate_verdict: null,
  });
}

function preparePartialHandoff({
  backend,
  sessionId,
  dispatchId,
  ledger,
  writerStopped,
  scopeVerified,
  diffVerified,
  timeoutObservations = [],
  nextAction = 'reconcile before continuation',
} = {}) {
  if (!writerStopped) return Object.freeze({ status: 'blocked', reason: 'old writer is not confirmed stopped' });
  if (!scopeVerified) return Object.freeze({ status: 'blocked', reason: 'assigned scope is not reconciled' });
  if (!diffVerified) return Object.freeze({ status: 'blocked', reason: 'path-scoped diff is not reconciled' });
  if (!ledger || ledger.disjoint !== true) return Object.freeze({ status: 'blocked', reason: 'completion ledger is not disjoint' });

  const result = ledger.confirmed.length > 0 ? 'PARTIAL' : 'BLOCKED';
  const marker = result === 'PARTIAL'
    ? buildPartialMarker({ backend, sessionId, dispatchId, ledger, timeoutObservations, nextAction })
    : null;
  return Object.freeze({
    status: 'ready',
    result,
    recovery_scope: [...ledger.unconfirmed, ...ledger.remaining].sort(),
    out_of_scope: ledger.out_of_scope,
    marker,
  });
}

module.exports = Object.freeze({
  MARKER_SCHEMA,
  buildPartialMarker,
  deriveCompletionLedger,
  markerPath,
  preparePartialHandoff,
});
