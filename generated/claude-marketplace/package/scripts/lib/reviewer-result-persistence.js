'use strict';

// Pure contract for return-only reviewer roles (ADR 0025): the child returns a
// Review Result, an authorized parent persists it verbatim with a sha256 of the
// returned text.  A failed or mismatched save is UNRESOLVED, never a pass, and
// the contract never asks for a re-dispatch.  No filesystem, process, or
// network access: persistence is a caller-injected synchronous `save`.

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const STRING_FIELDS = Object.freeze([
  'contractVersion', 'reviewerRole', 'reviewerRunId', 'implementerId', 'treeId', 'verdict',
]);

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isJsonSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch (_error) {
    return false;
  }
}

function outcome(status, reasons, extra = {}) {
  return deepFreeze({ status, reasons: [...reasons], ...extra });
}

function malformedReasons(result) {
  const reasons = [];
  if (!isNonEmptyString(result.text)) reasons.push('invalid-field:text');
  for (const field of STRING_FIELDS) {
    if (!isNonEmptyString(result[field])) reasons.push(`invalid-field:${field}`);
  }
  if (!Array.isArray(result.findings) || !isJsonSerializable(result.findings)) {
    reasons.push('invalid-field:findings');
  }
  return reasons;
}

function evaluateReturnedReviewResult({ result, expected } = {}) {
  if (result === null || result === undefined) return outcome('NO_RESULT', ['no-result']);
  if (typeof result !== 'object') return outcome('MALFORMED_RESULT', ['invalid-result']);
  const malformed = malformedReasons(result);
  if (malformed.length > 0) return outcome('MALFORMED_RESULT', malformed);
  const want = expected || {};
  if (result.reviewerRole !== want.reviewerRole) return outcome('MALFORMED_RESULT', ['role-mismatch']);
  const stale = [];
  if (result.treeId !== want.treeId) stale.push('tree-mismatch');
  if (result.contractVersion !== want.contractVersion) stale.push('contract-version-mismatch');
  if (result.implementerId !== want.implementerId) stale.push('implementer-mismatch');
  if (stale.length > 0) return outcome('STALE_IDENTITY', stale);
  if (result.reviewerRunId === want.implementerId) return outcome('SELF_REVIEW', ['self-review']);
  return outcome('VALID', []);
}

function buildRecord(result) {
  return {
    resultText: result.text,
    resultSha256: sha256(result.text),
    contractVersion: result.contractVersion,
    reviewerRole: result.reviewerRole,
    reviewerRunId: result.reviewerRunId,
    implementerId: result.implementerId,
    treeId: result.treeId,
    verdict: result.verdict,
    findings: cloneJson(result.findings),
  };
}

const RECORD_STRING_FIELDS = Object.freeze(['resultText', 'resultSha256', ...STRING_FIELDS]);

// A stored copy (read-back or recovery) matches only when every record field is
// identical and its hash is the hash of its own text.
function storedMatches(stored, record) {
  if (!stored || typeof stored !== 'object') return false;
  if (typeof stored.resultText !== 'string') return false;
  return stored.resultSha256 === sha256(stored.resultText)
    && RECORD_STRING_FIELDS.every((key) => stored[key] === record[key])
    && isDeepStrictEqual(stored.findings, record.findings);
}

// `save` receives its own copy, so it cannot alter the record it is checked against.
function attemptSave(save, record) {
  try {
    return typeof save === 'function' ? save(cloneJson(record)) : undefined;
  } catch (_error) {
    return undefined;
  }
}

function persistReviewResult({ result, expected, contract, save, existing } = {}) {
  const evaluation = evaluateReturnedReviewResult({ result, expected });
  if (evaluation.status !== 'VALID') return outcome(evaluation.status, evaluation.reasons, { redispatch: false });
  if (!contract || contract.persistence !== 'inline-only') {
    return persistValid({ result, contract, save, existing });
  }
  return outcome('VALIDATED_INLINE', [], { redispatch: false });
}

function persistValid({ result, contract, save, existing }) {
  if (!contract || contract.persistence !== 'required') {
    return outcome('UNRESOLVED', ['invalid-persistence-contract'], { redispatch: false });
  }
  const record = deepFreeze(buildRecord(result));
  if (storedMatches(existing, record)) return outcome('REUSED', [], { record, redispatch: false });
  const saved = attemptSave(save, record);
  if (!saved || saved.ok !== true) return outcome('UNRESOLVED', ['save-failed'], { record, redispatch: false });
  if (!storedMatches(saved.persisted, record)) {
    return outcome('UNRESOLVED', ['persisted-mismatch'], { record, redispatch: false });
  }
  return outcome('RECORDED', [], { record, redispatch: false });
}

module.exports = { evaluateReturnedReviewResult, persistReviewResult };
