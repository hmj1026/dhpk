'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  sha256,
  SAFE_ID,
} = require('./receipt-primitives');
const {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_EVENTS,
  MAX_STDIN_BYTES,
  clone,
  exactKeys,
  isRecord,
  parseJson,
  physicalPath,
  readPhysicalFile,
} = require('./review-gate-runtime-storage');
const { fail } = require('./review-gate-runtime-errors');
const { createReviewResult } = require('./reviewer-contract');

const COMPANION_SCHEMA = 'dhpk.claude-review-result.v1';
const COMMAND_OUTCOMES = new Set([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'BLOCKED',
  'UNAVAILABLE',
]);
const IDENTITY_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'attempt',
  'sessionId',
  'dispatchId',
  'scopeId',
  'diffId',
]);
const MAX_REFERENCE_BYTES = 4096;
const SENSITIVE_REFERENCE = /(?:^|[\s:/_-])(?:stdout|stderr|raw[-_ ]?log|authorization|proxy[-_.]?authorization|token|password|secret|api[-_.]?key|private[-_.]?key|signing[-_.]?key|cookie|credential|prompt|transcript)(?:$|[\s:/_-])/i;

const assertDigest = (value, code = 'MALFORMED_EVIDENCE') => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail(code);
  return value;
};

const assertRelativeEvidenceReference = (value, code = 'MALFORMED_EVIDENCE') => {
  if (typeof value !== 'string'
    || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > MAX_REFERENCE_BYTES
    || value.includes('\u0000')
    || /[\u0001-\u001f\u007f]/.test(value)
    || value.includes('\\')
    || path.isAbsolute(value)
    || /^[A-Za-z]:(?:\/|\\)/.test(value)
    || value.split('/').some((segment) => segment === '..')
    || SENSITIVE_REFERENCE.test(value)) fail(code);
  return value;
};

const resolveEvidencePath = (
  repoRoot,
  value,
  code = 'MALFORMED_EVIDENCE',
  { allowMissingFinal = false } = {},
) => {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\\') || value.includes('\u0000')) {
    fail(code);
  }
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(code);
  }
  physicalPath(root, absolute, code, { allowMissingFinal });
  return {
    absolute,
    relative: relative.split(path.sep).join('/'),
  };
};

const readEvidenceFile = (repoRoot, value, maxBytes, code = 'MALFORMED_EVIDENCE') => {
  const resolved = resolveEvidencePath(repoRoot, value, code);
  const content = readPhysicalFile(
    resolved.absolute,
    maxBytes,
    code,
    { physicalRoot: path.resolve(repoRoot) },
  );
  return { ...resolved, content };
};

const readOptionalEvidenceFile = (repoRoot, value, maxBytes, code = 'MALFORMED_EVIDENCE') => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(code);
  const resolved = resolveEvidencePath(repoRoot, value, code, { allowMissingFinal: true });
  let stat;
  try {
    stat = fs.lstatSync(resolved.absolute);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail(code);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  const content = readPhysicalFile(
    resolved.absolute,
    maxBytes,
    code,
    { physicalRoot: path.resolve(repoRoot) },
  );
  return { ...resolved, content };
};

const parseJsonLines = (content, code) => {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    if (values.length >= MAX_EVIDENCE_EVENTS) fail('BOUNDED_INPUT');
    values.push(parseJson(line, code));
  }
  return values;
};

const readJsonSidecar = (repoRoot, value, code) => {
  const file = readEvidenceFile(repoRoot, value, MAX_EVIDENCE_BYTES, code);
  return parseJson(file.content.toString('utf8'), code);
};

const readJsonLinesSidecar = (repoRoot, value, code, optional = false) => {
  const file = optional
    ? readOptionalEvidenceFile(repoRoot, value, MAX_EVIDENCE_BYTES, code)
    : readEvidenceFile(repoRoot, value, MAX_EVIDENCE_BYTES, code);
  if (!file) return null;
  return parseJsonLines(file.content, code);
};

const normalizeIdentity = (value, code = 'FOREIGN_IDENTITY') => {
  exactKeys(value, IDENTITY_FIELDS, [], code);
  for (const field of IDENTITY_FIELDS) {
    if (field === 'attempt') {
      if (!Number.isSafeInteger(value[field]) || value[field] < 1) fail(code);
    } else if (typeof value[field] !== 'string' || !SAFE_ID.test(value[field])) {
      fail(code);
    }
  }
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, value[field]]));
};

const assertSameIdentity = (expected, actual, code = 'FOREIGN_IDENTITY') => {
  const normalized = normalizeIdentity(actual, code);
  for (const field of IDENTITY_FIELDS) {
    if (normalized[field] !== expected[field]) fail(code);
  }
  return normalized;
};

const readIdentityAlias = (event, aliases, code) => {
  const present = aliases.filter((alias) => Object.prototype.hasOwnProperty.call(event, alias));
  if (present.length === 0) fail(code);
  const values = present.map((alias) => event[alias]);
  if (values.some((candidate) => candidate !== values[0])) fail(code);
  return values[0];
};

const eventIdentity = (event, code = 'FOREIGN_IDENTITY') => normalizeIdentity({
  taskId: readIdentityAlias(event, ['task_id', 'taskId'], code),
  attemptId: readIdentityAlias(event, ['attempt_id', 'attemptId'], code),
  attempt: readIdentityAlias(event, ['attempt', 'dispatch_attempt'], code),
  sessionId: readIdentityAlias(event, ['session_id', 'sessionId'], code),
  dispatchId: readIdentityAlias(event, ['wave', 'dispatch_id', 'dispatchId'], code),
  scopeId: readIdentityAlias(event, ['scope_id', 'scopeId'], code),
  diffId: readIdentityAlias(event, ['diff_id', 'diffId'], code),
}, code);

const assertSafeText = (value, code = 'MALFORMED_COMPANION') => {
  if (typeof value !== 'string'
    || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > MAX_REFERENCE_BYTES
    || /[\u0000-\u001f\u007f]/.test(value)
    || SENSITIVE_REFERENCE.test(value)) fail(code);
  return value;
};

const validateReviewResultShape = (value) => {
  exactKeys(
    value,
    ['contractVersion', 'obligationId', 'lane', 'executionStatus', 'applicability', 'findings', 'inspectedScope', 'evidenceReferences'],
    ['semanticVerdict'],
    'MALFORMED_COMPANION',
  );
  if (!Array.isArray(value.findings) || !Array.isArray(value.inspectedScope)
    || !Array.isArray(value.evidenceReferences)
    || value.findings.length > 200 || value.inspectedScope.length > 200
    || value.evidenceReferences.length > 200) fail('MALFORMED_COMPANION');
  if (value.semanticVerdict !== undefined && value.semanticVerdict !== null) {
    assertSafeText(value.semanticVerdict);
  }
  for (const finding of value.findings) {
    exactKeys(
      finding,
      ['id', 'severity', 'disposition', 'summary', 'evidence'],
      ['decisionReceipt'],
      'MALFORMED_COMPANION',
    );
    assertSafeText(finding.id);
    assertSafeText(finding.summary);
    if (finding.decisionReceipt !== undefined) assertSafeText(finding.decisionReceipt);
    if (!Array.isArray(finding.evidence) || finding.evidence.length > 200) {
      fail('MALFORMED_COMPANION');
    }
    finding.evidence.forEach((reference) => assertRelativeEvidenceReference(reference, 'MALFORMED_COMPANION'));
  }
  for (const reference of [...value.inspectedScope, ...value.evidenceReferences]) {
    assertRelativeEvidenceReference(reference, 'MALFORMED_COMPANION');
  }
  let normalized;
  try {
    normalized = createReviewResult(value);
  } catch (_) {
    fail('MALFORMED_COMPANION');
  }
  return clone(normalized);
};

const validateCompanion = (artifact, companion) => {
  if (!artifact || typeof artifact.relative !== 'string' || !artifact.relative.endsWith('.md')) {
    fail('MALFORMED_COMPANION');
  }
  exactKeys(companion, ['schema', 'requestDigest', 'reviewResult', 'artifact', 'command'], [], 'MALFORMED_COMPANION');
  if (companion.schema !== COMPANION_SCHEMA) fail('UNSUPPORTED_SCHEMA');
  assertDigest(companion.requestDigest, 'MALFORMED_COMPANION');
  const reviewResult = validateReviewResultShape(companion.reviewResult);
  exactKeys(companion.artifact, ['sha256', 'identity'], [], 'MALFORMED_COMPANION');
  assertDigest(companion.artifact.sha256, 'MALFORMED_COMPANION');
  const identity = normalizeIdentity(companion.artifact.identity, 'MALFORMED_COMPANION');
  exactKeys(companion.command, ['sha256', 'outcome'], [], 'MALFORMED_COMPANION');
  assertDigest(companion.command.sha256, 'MALFORMED_COMPANION');
  if (!COMMAND_OUTCOMES.has(companion.command.outcome)) fail('MALFORMED_COMPANION');
  const expectedRelative = `${artifact.relative.slice(0, -'.md'.length)}.result.json`;
  return {
    requestDigest: companion.requestDigest,
    reviewResult,
    artifact: { sha256: companion.artifact.sha256, identity },
    command: { sha256: companion.command.sha256, outcome: companion.command.outcome },
    expectedRelative,
  };
};

const readCompanion = (repoRoot, artifact, companionValue) => {
  if (!artifact.relative.endsWith('.md')) fail('MALFORMED_COMPANION');
  const companion = readJsonSidecar(repoRoot, companionValue, 'MALFORMED_COMPANION');
  const companionFile = resolveEvidencePath(repoRoot, companionValue, 'MALFORMED_COMPANION');
  const normalized = validateCompanion(artifact, companion);
  if (companionFile.relative !== normalized.expectedRelative) fail('FOREIGN_EVIDENCE');
  delete normalized.expectedRelative;
  return normalized;
};

const readStdinWorkRequest = (input) => {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) fail('BOUNDED_INPUT');
  const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input, 'utf8');
  if (bytes.length === 0 || bytes.length > MAX_STDIN_BYTES) fail('BOUNDED_INPUT');
  return parseJson(bytes.toString('utf8'), 'MALFORMED_WORK_REQUEST');
};

module.exports = {
  COMPANION_SCHEMA,
  IDENTITY_FIELDS,
  assertDigest,
  assertRelativeEvidenceReference,
  assertSameIdentity,
  digestJson: (value) => `sha256:${sha256(canonicalJson(value))}`,
  eventIdentity,
  normalizeIdentity,
  observationIdentityFields: IDENTITY_FIELDS,
  readCompanion,
  validateCompanion,
  readEvidenceFile,
  readJsonLinesSidecar,
  readJsonSidecar,
  readOptionalEvidenceFile,
  readStdinWorkRequest,
  resolveEvidencePath,
};
