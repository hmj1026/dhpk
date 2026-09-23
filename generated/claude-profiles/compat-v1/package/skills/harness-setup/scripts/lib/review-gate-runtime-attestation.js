'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { canonicalJson, SAFE_ID, sha256 } = require('./receipt-primitives');
const { readPhysicalFile } = require('./physical-file');
const { fail } = require('./review-gate-runtime-errors');

const HOST_ATTESTATION_SCHEMA = 'dhpk.review-gate.host-attestation.v1';
const HOST_SUBJECT_SCHEMA = 'dhpk.review-gate.observe-subject.v1';
const HOST_TRUST_SCHEMA = 'dhpk.review-gate.host-trust.v1';
const ALGORITHM = 'Ed25519';
const SIGNATURE_DOMAIN = `${HOST_ATTESTATION_SCHEMA}\u0000`;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const MAX_ATTESTATION_BYTES = 1024 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const KEY_ID = /^sha256:[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SUBJECT_FIELDS = Object.freeze([
  'schema',
  'producer',
  'adapter',
  'eventType',
  'effect',
  'workId',
  'waveId',
  'planId',
  'decisionId',
  'obligationId',
  'lane',
  'sourceCommit',
  'sourceTree',
  'policyVersion',
  'contractVersion',
  'identity',
  'requestDigest',
  'resultDigest',
  'artifactDigest',
  'lifecycleDigest',
  'readinessDigest',
  'executedCommandsDigest',
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
const ENVELOPE_FIELDS = Object.freeze(['schema', 'algorithm', 'keyId', 'subject', 'signature']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const exactKeys = (value, expected, code = 'MALFORMED_HOST_ATTESTATION') => {
  if (!isRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    fail(code);
  }
  return value;
};

const boundedText = (value, code = 'MALFORMED_HOST_ATTESTATION') => {
  if (typeof value !== 'string' || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
  return value;
};

const safeId = (value, code = 'MALFORMED_HOST_ATTESTATION') => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(code);
  return value;
};

const decodeBase64Url = (value, expectedBytes, code = 'MALFORMED_HOST_ATTESTATION') => {
  if (typeof value !== 'string' || !BASE64URL.test(value)) fail(code);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedBytes && expectedBytes !== undefined) fail(code);
  if (decoded.toString('base64url') !== value) fail(code);
  return decoded;
};

const publicKeyMaterial = (value, code = 'MALFORMED_HOST_ATTESTATION') => {
  let key;
  try {
    key = crypto.createPublicKey({ key: value, format: 'der', type: 'spki' });
  } catch (_) {
    fail(code);
  }
  if (key.asymmetricKeyType !== 'ed25519') fail(code);
  const der = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(der) || der.length === 0 || der.length > MAX_PUBLIC_KEY_BYTES) fail(code);
  return { key, der };
};

const keyIdForDer = (der) => `sha256:${sha256(der)}`;

const normalizeHostTrust = (value, code = 'MALFORMED_HOST_ATTESTATION') => {
  if (value === null || value === undefined) return null;
  exactKeys(value, ['schema', 'algorithm', 'keyId', 'publicKeySpki'], code);
  if (value.schema !== HOST_TRUST_SCHEMA || value.algorithm !== ALGORITHM) fail(code);
  if (!KEY_ID.test(value.keyId)) fail(code);
  const der = decodeBase64Url(value.publicKeySpki, undefined, code);
  let material;
  try {
    material = publicKeyMaterial(der, code);
  } catch (error) {
    if (error && error.code) throw error;
    fail(code);
  }
  if (keyIdForDer(material.der) !== value.keyId) fail(code);
  if (material.der.toString('base64url') !== value.publicKeySpki) fail(code);
  return {
    schema: HOST_TRUST_SCHEMA,
    algorithm: ALGORITHM,
    keyId: value.keyId,
    publicKeySpki: value.publicKeySpki,
  };
};

const resolveHostPublicKey = (file, repoRoot, code) => {
  if (typeof file !== 'string' || file.trim() === '') fail(code);
  if (path.isAbsolute(file)) {
    const target = path.resolve(file);
    return { root: path.dirname(target), target };
  }
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') fail(code);
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, file);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) fail(code);
  return { root, target };
};

const readHostPublicKey = (file, repoRoot = null, code = 'MALFORMED_HOST_ATTESTATION') => {
  const { root, target } = resolveHostPublicKey(file, repoRoot, code);
  let content;
  try {
    content = readPhysicalFile(root, target, MAX_PUBLIC_KEY_BYTES);
  } catch (_) {
    fail(code);
  }
  return parseHostPublicKey(content, code);
};

const parseHostPublicKey = (content, code = 'MALFORMED_HOST_ATTESTATION') => {
  if (!Buffer.isBuffer(content) || content.length > MAX_PUBLIC_KEY_BYTES) fail(code);
  let material;
  try {
    let key;
    try {
      key = crypto.createPublicKey({ key: content, format: 'der', type: 'spki' });
    } catch (_) {
      key = crypto.createPublicKey({
        key: content.toString('utf8'),
        format: 'pem',
        type: 'spki',
      });
    }
    if (key.asymmetricKeyType !== 'ed25519') fail(code);
    const der = key.export({ format: 'der', type: 'spki' });
    material = publicKeyMaterial(der, code);
  } catch (_) {
    fail(code);
  }
  return {
    schema: HOST_TRUST_SCHEMA,
    algorithm: ALGORITHM,
    keyId: keyIdForDer(material.der),
    publicKeySpki: material.der.toString('base64url'),
  };
};

const buildHostTrust = (publicKeyPath, expectedKeyId, repoRoot = null) => {
  const code = 'MALFORMED_HOST_TRUST';
  if (typeof expectedKeyId !== 'string' || !KEY_ID.test(expectedKeyId)) fail(code);
  const trust = readHostPublicKey(publicKeyPath, repoRoot, code);
  if (trust.keyId !== expectedKeyId) fail('HOST_TRUST_MISMATCH');
  return trust;
};

const digestJson = (value) => `sha256:${sha256(canonicalJson(value))}`;

const buildObserveSubject = ({
  plan,
  obligation,
  identity,
  reviewRequest,
  reviewResult,
  artifactDigest,
  lifecycleEvents,
  readinessEvents,
  executedCommands,
} = {}) => {
  if (!isRecord(plan) || !isRecord(obligation) || !isRecord(identity)
    || !isRecord(reviewRequest) || !isRecord(reviewResult)
    || !Array.isArray(lifecycleEvents) || !Array.isArray(readinessEvents)
    || !Array.isArray(executedCommands)) fail('MALFORMED_HOST_ATTESTATION');
  const headIdentity = plan.headIdentity;
  if (!isRecord(headIdentity)) fail('MALFORMED_HOST_ATTESTATION');
  const subject = {
    schema: HOST_SUBJECT_SCHEMA,
    producer: 'claude-review-gate',
    adapter: 'review-gate-adapter',
    eventType: 'REVIEW_RESULT_RECORDED',
    effect: 'ENFORCE',
    workId: safeId(plan.workId),
    waveId: safeId(plan.waveId),
    planId: safeId(plan.planId),
    decisionId: safeId(plan.decisionId),
    obligationId: safeId(obligation.obligationId),
    lane: safeId(obligation.lane),
    sourceCommit: boundedText(headIdentity.commit),
    sourceTree: boundedText(headIdentity.tree),
    policyVersion: boundedText(plan.policyVersion),
    contractVersion: boundedText(plan.contractVersion),
    identity: exactKeys(identity, IDENTITY_FIELDS),
    requestDigest: digestJson(reviewRequest),
    resultDigest: digestJson(reviewResult),
    artifactDigest: boundedText(artifactDigest),
    lifecycleDigest: digestJson(lifecycleEvents),
    readinessDigest: digestJson(readinessEvents),
    executedCommandsDigest: digestJson(executedCommands),
  };
  for (const field of IDENTITY_FIELDS) {
    if (field === 'attempt') {
      if (!Number.isSafeInteger(subject.identity[field]) || subject.identity[field] < 1) {
        fail('MALFORMED_HOST_ATTESTATION');
      }
    } else safeId(subject.identity[field]);
  }
  for (const field of ['artifactDigest', 'requestDigest', 'resultDigest', 'lifecycleDigest', 'readinessDigest', 'executedCommandsDigest']) {
    if (!DIGEST.test(subject[field])) fail('MALFORMED_HOST_ATTESTATION');
  }
  return subject;
};

const signatureInput = (subject) => Buffer.concat([
  Buffer.from(SIGNATURE_DOMAIN, 'utf8'),
  Buffer.from(canonicalJson(subject), 'utf8'),
]);

const normalizeEnvelope = (envelope) => {
  exactKeys(envelope, ENVELOPE_FIELDS);
  if (envelope.schema !== HOST_ATTESTATION_SCHEMA || envelope.subject && envelope.subject.schema !== HOST_SUBJECT_SCHEMA) {
    fail('UNSUPPORTED_SCHEMA');
  }
  if (envelope.algorithm !== ALGORITHM || !KEY_ID.test(envelope.keyId)) fail('UNTRUSTED_HOST_ATTESTATION');
  const subject = exactKeys(envelope.subject, SUBJECT_FIELDS);
  exactKeys(subject.identity, IDENTITY_FIELDS);
  for (const field of ['producer', 'adapter', 'eventType', 'effect', 'workId', 'waveId', 'planId', 'decisionId', 'obligationId', 'lane', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion']) boundedText(subject[field]);
  for (const field of ['workId', 'waveId', 'planId', 'decisionId', 'obligationId', 'lane']) safeId(subject[field]);
  for (const field of ['requestDigest', 'resultDigest', 'artifactDigest', 'lifecycleDigest', 'readinessDigest', 'executedCommandsDigest']) {
    if (typeof subject[field] !== 'string' || !DIGEST.test(subject[field])) fail('MALFORMED_HOST_ATTESTATION');
  }
  if (!Number.isSafeInteger(subject.identity.attempt) || subject.identity.attempt < 1) fail('MALFORMED_HOST_ATTESTATION');
  for (const field of IDENTITY_FIELDS.filter((name) => name !== 'attempt')) safeId(subject.identity[field]);
  const signature = decodeBase64Url(envelope.signature, 64);
  return { ...envelope, subject, signatureBytes: signature };
};

const verifyHostAttestation = ({ envelope, content, trust, expectedSubject } = {}) => {
  if (envelope === undefined || envelope === null) fail('MISSING_HOST_ATTESTATION');
  const normalized = normalizeEnvelope(envelope);
  const trusted = normalizeHostTrust(trust, 'UNTRUSTED_HOST_ATTESTATION');
  if (!trusted || trusted.keyId !== normalized.keyId || trusted.algorithm !== normalized.algorithm) {
    fail('UNTRUSTED_HOST_ATTESTATION');
  }
  let key;
  try {
    key = crypto.createPublicKey({ key: decodeBase64Url(trusted.publicKeySpki), format: 'der', type: 'spki' });
  } catch (_) {
    fail('UNTRUSTED_HOST_ATTESTATION');
  }
  let valid = false;
  try {
    valid = crypto.verify(null, signatureInput(normalized.subject), key, normalized.signatureBytes);
  } catch (_) {
    fail('UNTRUSTED_HOST_ATTESTATION');
  }
  if (!valid) fail('UNTRUSTED_HOST_ATTESTATION');
  if (expectedSubject === undefined || canonicalJson(normalized.subject) !== canonicalJson(expectedSubject)) {
    fail('STALE_HOST_ATTESTATION');
  }
  const digest = `sha256:${sha256(content === undefined ? canonicalJson(envelope) : content)}`;
  return { keyId: normalized.keyId, digest, subject: normalized.subject };
};

module.exports = {
  ALGORITHM,
  HOST_ATTESTATION_SCHEMA,
  HOST_SUBJECT_SCHEMA,
  HOST_TRUST_SCHEMA,
  MAX_ATTESTATION_BYTES,
  buildHostTrust,
  buildObserveSubject,
  normalizeHostTrust,
  readHostPublicKey,
  signatureInput,
  verifyHostAttestation,
};
