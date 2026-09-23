'use strict';

const REVIEWER_CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';

const REVIEW_REQUEST_FIELDS = Object.freeze([
  'decisionId',
  'waveId',
  'obligationId',
  'lane',
  'scope',
  'baseIdentity',
  'headIdentity',
  'diff',
  'materialRisks',
  'governingInputs',
  'exclusions',
  'priorFindings',
  'contractVersion',
]);
const EXECUTION_STATUSES = Object.freeze(['COMPLETE', 'NOT_RUN', 'INTERRUPTED', 'UNAVAILABLE']);
const APPLICABILITIES = Object.freeze(['REQUIRED', 'NOT_APPLICABLE']);
const SEMANTIC_VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);
const FINDING_SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const FINDING_DISPOSITIONS = Object.freeze(['MUST_FIX', 'FOLLOW_UP', 'NOTE']);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
};

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const fail = (field, message) => {
  throw new TypeError(`Reviewer Contract v2 ${field}: ${message}`);
};

const requireRecord = (value, field) => {
  if (!isRecord(value)) fail(field, 'must be an object');
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') fail(field, 'must be a non-empty string');
};

const requireArray = (value, field) => {
  if (!Array.isArray(value)) fail(field, 'must be an array');
};

const requireStringFields = (value, field, fields) => {
  requireRecord(value, field);
  for (const child of fields) requireString(value[child], `${field}.${child}`);
};

const requireMember = (value, vocabulary, field) => {
  if (!vocabulary.includes(value)) fail(field, `must be one of ${vocabulary.join('|')}`);
};

const requireContractVersion = (value) => {
  if (value !== REVIEWER_CONTRACT_VERSION) {
    fail('contractVersion', `must equal ${REVIEWER_CONTRACT_VERSION}`);
  }
};

const createReviewRequest = (input) => {
  requireRecord(input, 'request');
  for (const field of REVIEW_REQUEST_FIELDS) {
    if (!hasOwn(input, field)) fail(field, 'is required');
  }
  for (const field of ['decisionId', 'waveId', 'obligationId', 'lane']) {
    requireString(input[field], field);
  }
  requireRecord(input.scope, 'scope');
  requireArray(input.scope.paths, 'scope.paths');
  if (input.scope.paths.length === 0) fail('scope.paths', 'must identify at least one changed path');
  for (const changedPath of input.scope.paths) requireString(changedPath, 'scope.paths[]');
  requireString(input.scope.digest, 'scope.digest');
  requireStringFields(input.baseIdentity, 'baseIdentity', ['commit', 'tree']);
  requireStringFields(input.headIdentity, 'headIdentity', ['commit', 'tree']);
  requireStringFields(input.diff, 'diff', ['digest', 'reference']);
  for (const field of ['materialRisks', 'governingInputs', 'exclusions', 'priorFindings']) {
    requireArray(input[field], field);
  }
  requireContractVersion(input.contractVersion);
  return freeze(clone(input));
};

const createFinding = (input) => {
  requireRecord(input, 'finding');
  for (const field of ['id', 'severity', 'disposition', 'summary', 'evidence']) {
    if (!hasOwn(input, field)) fail(`finding.${field}`, 'is required');
  }
  requireString(input.id, 'finding.id');
  requireString(input.summary, 'finding.summary');
  requireArray(input.evidence, 'finding.evidence');
  requireMember(input.severity, FINDING_SEVERITIES, 'finding.severity');
  requireMember(input.disposition, FINDING_DISPOSITIONS, 'finding.disposition');

  if (['CRITICAL', 'HIGH'].includes(input.severity) && input.disposition !== 'MUST_FIX') {
    fail('finding.disposition', `${input.severity} findings must be MUST_FIX`);
  }
  if (input.severity === 'MEDIUM' && input.disposition === 'NOTE') {
    fail('finding.disposition', 'MEDIUM findings cannot be NOTE');
  }
  if (input.severity === 'MEDIUM' && input.disposition === 'FOLLOW_UP') {
    requireString(input.decisionReceipt, 'finding.decisionReceipt');
  }
  return freeze(clone(input));
};

const createReviewResult = (input) => {
  requireRecord(input, 'result');
  for (const field of [
    'contractVersion', 'obligationId', 'lane', 'executionStatus', 'applicability',
    'findings', 'inspectedScope', 'evidenceReferences',
  ]) {
    if (!hasOwn(input, field)) fail(`result.${field}`, 'is required');
  }
  requireContractVersion(input.contractVersion);
  requireString(input.obligationId, 'result.obligationId');
  requireString(input.lane, 'result.lane');
  requireMember(input.executionStatus, EXECUTION_STATUSES, 'result.executionStatus');
  requireMember(input.applicability, APPLICABILITIES, 'result.applicability');
  requireArray(input.findings, 'result.findings');
  requireArray(input.inspectedScope, 'result.inspectedScope');
  requireArray(input.evidenceReferences, 'result.evidenceReferences');

  const semanticVerdict = input.semanticVerdict;
  const requiresVerdict = input.executionStatus === 'COMPLETE' && input.applicability === 'REQUIRED';
  if (requiresVerdict) {
    requireMember(semanticVerdict, SEMANTIC_VERDICTS, 'result.semanticVerdict');
  } else if (semanticVerdict !== undefined && semanticVerdict !== null) {
    fail('result.semanticVerdict', 'must be absent when execution is incomplete or review is not applicable');
  }

  const result = clone(input);
  result.findings = input.findings.map(createFinding);
  if (!requiresVerdict) delete result.semanticVerdict;
  if (requiresVerdict && semanticVerdict === 'PASS'
      && result.findings.some((finding) => finding.disposition === 'MUST_FIX')) {
    fail('result.semanticVerdict', 'PASS cannot include a MUST_FIX finding');
  }
  return freeze(result);
};

module.exports = {
  REVIEWER_CONTRACT_VERSION,
  REVIEW_REQUEST_FIELDS,
  EXECUTION_STATUSES,
  APPLICABILITIES,
  SEMANTIC_VERDICTS,
  FINDING_SEVERITIES,
  FINDING_DISPOSITIONS,
  createReviewRequest,
  createFinding,
  createReviewResult,
};
