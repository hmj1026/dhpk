'use strict';

const {
  canonicalJson,
  sha256,
} = require('./receipt-primitives');
const { REVIEWER_CONTRACT_VERSION } = require('./reviewer-contract');

const WORK_REQUEST_VERSION = 'dhpk.work-request.v1';
const WORK_RECORD_VERSION = 'dhpk.work-record.v1';
const REVIEW_PLAN_VERSION = 'dhpk.review-plan.v1';
const RISK_POLICY_VERSION = 'dhpk.risk-policy.initial.v1';
const EMPTY_DIFF_DIGEST = `sha256:${sha256(Buffer.alloc(0))}`;

const MATERIAL_RISK_SIGNALS = Object.freeze([
  'BEHAVIOR_CHANGE',
  'PUBLIC_CONTRACT',
  'ARCHITECTURE_CHANGE',
  'CROSS_MODULE',
  'MULTI_WAVE',
  'IRREVERSIBLE_ACTION',
  'EXTERNAL_ACTION',
  'SECURITY',
  'PRIVACY',
  'AUTHENTICATION',
  'MONEY',
  'DATABASE',
  'SCHEMA',
  'MIGRATION',
  'RELEASE',
  'COMPATIBILITY',
  'CROSS_DOMAIN',
  'SHARED_STATE',
  'MULTI_WRITER',
  'HIGH_UNCERTAINTY',
  'UNKNOWN_ROOT_CAUSE',
  'FAILED_VERIFICATION',
]);
const SCOPE_KINDS = Object.freeze(['SOURCE', 'FRONTEND', 'DATABASE', 'MIGRATION', 'DOCUMENTATION']);
const LANE_ORDER = Object.freeze([
  'code-reviewer',
  'security-reviewer',
  'database-reviewer',
  'migration-reviewer',
  'frontend-reviewer',
  'doc-reviewer',
]);

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

const INITIAL_RISK_POLICY = freeze({
  version: RISK_POLICY_VERSION,
  contractVersion: REVIEWER_CONTRACT_VERSION,
  scopeLanes: {
    SOURCE: ['code-reviewer'],
    FRONTEND: ['code-reviewer', 'frontend-reviewer'],
    DATABASE: ['code-reviewer', 'database-reviewer'],
    MIGRATION: ['code-reviewer', 'database-reviewer', 'migration-reviewer'],
    DOCUMENTATION: ['doc-reviewer'],
  },
  riskLanes: {
    SECURITY: ['security-reviewer'],
    PRIVACY: ['security-reviewer'],
    AUTHENTICATION: ['security-reviewer'],
    MONEY: ['security-reviewer'],
    DATABASE: ['database-reviewer'],
    SCHEMA: ['database-reviewer', 'migration-reviewer'],
    MIGRATION: ['database-reviewer', 'migration-reviewer'],
  },
});

const fail = (field, message) => {
  throw new TypeError(`Risk Router ${field}: ${message}`);
};

const requireRecord = (value, field) => {
  if (!isRecord(value)) fail(field, 'must be an object');
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') fail(field, 'must be a non-empty string');
};

const requireDigest = (value, field) => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail(field, 'must be a sha256 digest');
  }
};

const requireGitIdentity = (value, field) => {
  requireRecord(value, field);
  for (const child of ['commit', 'tree']) {
    if (typeof value[child] !== 'string' || !/^[a-f0-9]{40}$/.test(value[child])) {
      fail(`${field}.${child}`, 'must be a 40-character lowercase Git object id');
    }
  }
};

const orderedSet = (values, vocabulary, field) => {
  if (!Array.isArray(values)) fail(field, 'must be an array');
  for (const value of values) {
    if (!vocabulary.includes(value)) fail(field, `contains unknown value ${String(value)}`);
  }
  return vocabulary.filter((value) => values.includes(value));
};

const normalizePaths = (paths) => {
  if (!Array.isArray(paths)) fail('scope.paths', 'must be an array');
  for (const item of paths) {
    requireString(item, 'scope.paths[]');
    if (item.startsWith('/') || item.includes('\\') || item.split('/').some((part) => part === '..')) {
      fail('scope.paths[]', 'must be a repository-relative path');
    }
  }
  return [...new Set(paths)].sort();
};

const normalizeReferences = (values, field, requiredFields) => {
  if (!Array.isArray(values)) fail(field, 'must be an array');
  const normalized = values.map((value, index) => {
    requireRecord(value, `${field}[${index}]`);
    for (const child of requiredFields) requireString(value[child], `${field}[${index}].${child}`);
    if (requiredFields.includes('digest')) requireDigest(value.digest, `${field}[${index}].digest`);
    return clone(value);
  });
  return normalized.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
};

const normalizeObservations = (observations) => {
  requireRecord(observations, 'observations');
  const result = {};
  for (const field of ['fileCount', 'lineCount', 'taskCount', 'availableAgentCount']) {
    if (!Number.isSafeInteger(observations[field]) || observations[field] < 0) {
      fail(`observations.${field}`, 'must be a non-negative safe integer');
    }
    result[field] = observations[field];
  }
  return result;
};

const normalizeExtensions = (extensions) => {
  requireRecord(extensions, 'extensions');
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (value, depth) => {
    if (depth > 12) fail('extensions', 'must not exceed 12 nested levels');
    nodes += 1;
    if (nodes > 2048) fail('extensions', 'must not exceed 2048 JSON values');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') fail('extensions', 'must contain plain JSON values');
    if (seen.has(value)) fail('extensions', 'must not contain cycles');
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map((child) => visit(child, depth + 1));
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        fail('extensions', 'must contain plain JSON objects');
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        fail('extensions', 'must not contain symbol keys');
      }
      result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, depth + 1)]));
    }
    seen.delete(value);
    return result;
  };
  const normalized = visit(extensions, 0);
  if (Buffer.byteLength(canonicalJson(normalized), 'utf8') > 65536) {
    fail('extensions', 'must not exceed 65536 canonical JSON bytes');
  }
  return normalized;
};

const stableId = (prefix, value) => `${prefix}-${sha256(canonicalJson(value))}`;
const digest = (value) => `sha256:${sha256(canonicalJson(value))}`;

const createWorkRecord = (workRequest) => {
  requireRecord(workRequest, 'workRequest');
  if (workRequest.schemaVersion !== WORK_REQUEST_VERSION) fail('schemaVersion', `must equal ${WORK_REQUEST_VERSION}`);
  requireString(workRequest.requestId, 'requestId');
  requireString(workRequest.decisionKey, 'decisionKey');
  requireRecord(workRequest.scope, 'scope');

  const paths = normalizePaths(workRequest.scope.paths);
  const kinds = orderedSet(workRequest.scope.kinds, SCOPE_KINDS, 'scope.kinds');
  if (paths.length > 0 && kinds.length === 0) fail('scope.kinds', 'must classify a non-empty scope');
  requireGitIdentity(workRequest.scope.baseIdentity, 'scope.baseIdentity');
  requireGitIdentity(workRequest.scope.headIdentity, 'scope.headIdentity');
  requireRecord(workRequest.scope.diff, 'scope.diff');
  requireDigest(workRequest.scope.diff.digest, 'scope.diff.digest');
  requireString(workRequest.scope.diff.reference, 'scope.diff.reference');
  const emptySignals = [
    paths.length === 0,
    workRequest.scope.baseIdentity.tree === workRequest.scope.headIdentity.tree,
    workRequest.scope.diff.digest === EMPTY_DIFF_DIGEST,
  ];
  if (emptySignals.some(Boolean) && !emptySignals.every(Boolean)) {
    fail('scope', 'empty diff paths, tree identity, and digest must agree');
  }
  requireRecord(workRequest.ownership, 'ownership');
  requireString(workRequest.ownership.judgmentOwner, 'ownership.judgmentOwner');
  requireString(workRequest.ownership.implementationOwner, 'ownership.implementationOwner');

  const materialRisks = orderedSet(workRequest.materialRisks, MATERIAL_RISK_SIGNALS, 'materialRisks');
  const scopeDigest = digest({ paths, kinds });
  const decisionId = stableId('decision', {
    requestId: workRequest.requestId,
    decisionKey: workRequest.decisionKey,
  });
  const record = {
    schemaVersion: WORK_RECORD_VERSION,
    workId: stableId('work', { requestId: workRequest.requestId }),
    decisionId,
    waveId: stableId('wave', {
      decisionId,
      scopeDigest,
      baseIdentity: workRequest.scope.baseIdentity,
      headIdentity: workRequest.scope.headIdentity,
      diffDigest: workRequest.scope.diff.digest,
    }),
    requestId: workRequest.requestId,
    decisionKey: workRequest.decisionKey,
    scope: {
      paths,
      kinds,
      digest: scopeDigest,
      baseIdentity: clone(workRequest.scope.baseIdentity),
      headIdentity: clone(workRequest.scope.headIdentity),
      diff: clone(workRequest.scope.diff),
    },
    ownership: clone(workRequest.ownership),
    materialRisks,
    governingInputs: normalizeReferences(workRequest.governingInputs, 'governingInputs', ['reference', 'digest']),
    outcomeReferences: normalizeReferences(workRequest.outcomeReferences, 'outcomeReferences', ['kind', 'reference']),
    observations: normalizeObservations(workRequest.observations),
    extensions: normalizeExtensions(workRequest.extensions || {}),
  };
  return freeze(record);
};

const policyDigest = digest(INITIAL_RISK_POLICY);

const lanesFor = (workRecord) => {
  const lanes = new Set();
  for (const kind of workRecord.scope.kinds) {
    for (const lane of INITIAL_RISK_POLICY.scopeLanes[kind]) lanes.add(lane);
  }
  for (const risk of workRecord.materialRisks) {
    for (const lane of INITIAL_RISK_POLICY.riskLanes[risk] || []) lanes.add(lane);
  }
  return LANE_ORDER.filter((lane) => lanes.has(lane));
};

const reasonSignalsFor = (workRecord, lane) => {
  const scopeLanes = new Set();
  for (const kind of workRecord.scope.kinds) {
    for (const scopeLane of INITIAL_RISK_POLICY.scopeLanes[kind]) scopeLanes.add(scopeLane);
  }
  const baselineLane = LANE_ORDER.find((candidate) => scopeLanes.has(candidate));
  return workRecord.materialRisks.filter((risk) => {
    const riskLanes = INITIAL_RISK_POLICY.riskLanes[risk] || [];
    return riskLanes.includes(lane) || (riskLanes.length === 0 && lane === baselineLane);
  });
};

const validateWorkRecord = (workRecord) => {
  requireRecord(workRecord, 'workRecord');
  if (workRecord.schemaVersion !== WORK_RECORD_VERSION) {
    fail('workRecord.schemaVersion', `must equal ${WORK_RECORD_VERSION}`);
  }
  requireRecord(workRecord.scope, 'workRecord.scope');
  const normalized = createWorkRecord({
    schemaVersion: WORK_REQUEST_VERSION,
    requestId: workRecord.requestId,
    decisionKey: workRecord.decisionKey,
    scope: {
      paths: workRecord.scope.paths,
      kinds: workRecord.scope.kinds,
      baseIdentity: workRecord.scope.baseIdentity,
      headIdentity: workRecord.scope.headIdentity,
      diff: workRecord.scope.diff,
    },
    ownership: workRecord.ownership,
    materialRisks: workRecord.materialRisks,
    governingInputs: workRecord.governingInputs,
    outcomeReferences: workRecord.outcomeReferences,
    observations: workRecord.observations,
    extensions: workRecord.extensions,
  });
  if (canonicalJson(normalized) !== canonicalJson(workRecord)) {
    fail('workRecord', 'must be a canonical Work Record with valid stable identities');
  }
  return normalized;
};

class RiskRouter {
  plan(workRecord, policy = INITIAL_RISK_POLICY) {
    const record = validateWorkRecord(workRecord);
    if (canonicalJson(policy) !== canonicalJson(INITIAL_RISK_POLICY)) {
      fail('policy', `must equal the registered ${RISK_POLICY_VERSION} policy`);
    }

    const planIdentity = {
      workId: record.workId,
      decisionId: record.decisionId,
      waveId: record.waveId,
      scope: record.scope,
      materialRisks: record.materialRisks,
      governingInputs: record.governingInputs,
      policyVersion: policy.version,
      policyDigest,
      contractVersion: policy.contractVersion,
    };
    const planId = stableId('review-plan', planIdentity);
    const applicability = record.scope.paths.length === 0 ? 'NOT_APPLICABLE' : 'REQUIRED';
    const obligations = (applicability === 'REQUIRED' ? lanesFor(record) : []).map((lane) => ({
      obligationId: stableId('obligation', { planId, kind: 'SEMANTIC_REVIEW', lane }),
      kind: 'SEMANTIC_REVIEW',
      lane,
      applicability,
      reasonSignals: reasonSignalsFor(record, lane),
      scopeDigest: record.scope.digest,
      contractVersion: policy.contractVersion,
    }));

    return freeze({
      schemaVersion: REVIEW_PLAN_VERSION,
      planId,
      workId: record.workId,
      decisionId: record.decisionId,
      waveId: record.waveId,
      policyVersion: policy.version,
      policyDigest,
      contractVersion: policy.contractVersion,
      applicability,
      materialRisks: clone(record.materialRisks),
      governingInputs: clone(record.governingInputs),
      scope: {
        paths: clone(record.scope.paths),
        digest: record.scope.digest,
      },
      baseIdentity: clone(record.scope.baseIdentity),
      headIdentity: clone(record.scope.headIdentity),
      diff: clone(record.scope.diff),
      obligations,
      reasonCodes: applicability === 'NOT_APPLICABLE' ? ['EMPTY_DIFF'] : [],
      extensions: clone(record.extensions),
    });
  }
}

module.exports = {
  WORK_REQUEST_VERSION,
  WORK_RECORD_VERSION,
  REVIEW_PLAN_VERSION,
  RISK_POLICY_VERSION,
  MATERIAL_RISK_SIGNALS,
  SCOPE_KINDS,
  INITIAL_RISK_POLICY,
  createWorkRecord,
  RiskRouter,
};
