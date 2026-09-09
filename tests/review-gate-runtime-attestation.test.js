'use strict';

// Unit coverage for the host-attestation boundary. Signing is deliberately
// test-local: production exposes verification and trust enrollment, never a
// private-key signing command.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attestation = require('../scripts/lib/review-gate-runtime-attestation');
const { test, run, assert } = require('./_lib/tinytest');

const {
  ALGORITHM,
  HOST_ATTESTATION_SCHEMA,
  HOST_SUBJECT_SCHEMA,
  HOST_TRUST_SCHEMA,
  buildHostTrust,
  buildObserveSubject,
  verifyHostAttestation,
} = attestation;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Independent canonical JSON implementation for constructing the fixture's
// signature. This keeps the expected signature input separate from the
// production signatureInput helper.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function subjectInputs() {
  return {
    plan: {
      workId: 'work-attestation-unit',
      waveId: 'wave-attestation-unit',
      planId: 'plan-attestation-unit',
      decisionId: 'decision-attestation-unit',
      policyVersion: 'policy-v1',
      contractVersion: 'dhpk.reviewer-contract.v2',
      headIdentity: {
        commit: 'commit-attestation-unit',
        tree: 'tree-attestation-unit',
      },
    },
    obligation: {
      obligationId: 'obligation-attestation-unit',
      lane: 'code-reviewer',
    },
    identity: {
      taskId: 'task-attestation-unit',
      attemptId: 'attempt-attestation-unit',
      attempt: 1,
      sessionId: 'session-attestation-unit',
      dispatchId: 'dispatch-attestation-unit',
      scopeId: 'scope-attestation-unit',
      diffId: 'diff-attestation-unit',
    },
    reviewRequest: {
      obligationId: 'obligation-attestation-unit',
      lane: 'code-reviewer',
      scope: { paths: ['scripts/lib/review-gate-runtime-attestation.js'] },
    },
    reviewResult: {
      contractVersion: 'dhpk.reviewer-contract.v2',
      obligationId: 'obligation-attestation-unit',
      lane: 'code-reviewer',
      executionStatus: 'COMPLETE',
      applicability: 'REQUIRED',
      semanticVerdict: 'PASS',
      findings: [],
    },
    artifactDigest: `sha256:${'a'.repeat(64)}`,
    lifecycleEvents: [{ state: 'verdicted', event_id: 'event-attestation-unit' }],
    readinessEvents: [{ state: 'artifact-ready', event_id: 'ready-attestation-unit' }],
    executedCommands: [{ command: 'node tests/review-gate-runtime-attestation.test.js', outcome: 'PASS' }],
  };
}

function hostKeys() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey: pair.privateKey,
    trust: {
      schema: HOST_TRUST_SCHEMA,
      algorithm: ALGORITHM,
      keyId: `sha256:${sha256(der)}`,
      publicKeySpki: der.toString('base64url'),
    },
  };
}

function signEnvelope(subject, privateKey, keyId) {
  const input = Buffer.concat([
    Buffer.from(`${HOST_ATTESTATION_SCHEMA}\u0000`, 'utf8'),
    Buffer.from(canonicalJson(subject), 'utf8'),
  ]);
  return {
    schema: HOST_ATTESTATION_SCHEMA,
    algorithm: ALGORITHM,
    keyId,
    subject,
    signature: crypto.sign(null, input, privateKey).toString('base64url'),
  };
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test('buildHostTrust enrolls an Ed25519 SPKI with a derived immutable identity', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-attestation-unit-')));
  const pair = crypto.generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyPath = path.join(root, 'host.pub');
  try {
    fs.writeFileSync(publicKeyPath, der, { mode: 0o600 });
    const trust = buildHostTrust(publicKeyPath, `sha256:${sha256(der)}`);

    assert.deepStrictEqual(trust, {
      schema: HOST_TRUST_SCHEMA,
      algorithm: ALGORITHM,
      keyId: `sha256:${sha256(der)}`,
      publicKeySpki: der.toString('base64url'),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildObserveSubject binds plan identity and every evidence digest', () => {
  const inputs = subjectInputs();
  const subject = buildObserveSubject(inputs);

  assert.strictEqual(subject.schema, HOST_SUBJECT_SCHEMA);
  assert.strictEqual(subject.producer, 'claude-review-gate');
  assert.strictEqual(subject.effect, 'ENFORCE');
  assert.deepStrictEqual(subject.identity, inputs.identity);
  assert.strictEqual(subject.artifactDigest, inputs.artifactDigest);
  for (const field of [
    'requestDigest',
    'resultDigest',
    'artifactDigest',
    'lifecycleDigest',
    'readinessDigest',
    'executedCommandsDigest',
  ]) {
    assert.match(subject[field], /^sha256:[a-f0-9]{64}$/);
  }

  const changedResult = buildObserveSubject({
    ...inputs,
    reviewResult: { ...inputs.reviewResult, semanticVerdict: 'FAIL' },
  });
  assert.notStrictEqual(subject.resultDigest, changedResult.resultDigest);
});

test('verifyHostAttestation accepts a valid host signature and returns metadata only', () => {
  const inputs = subjectInputs();
  const subject = buildObserveSubject(inputs);
  const host = hostKeys();
  const envelope = signEnvelope(subject, host.privateKey, host.trust.keyId);
  const content = Buffer.from('signed host envelope bytes', 'utf8');

  const verified = verifyHostAttestation({
    envelope,
    content,
    trust: host.trust,
    expectedSubject: subject,
  });

  assert.deepStrictEqual(verified, {
    keyId: host.trust.keyId,
    digest: `sha256:${sha256(content)}`,
    subject,
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(verified, 'signature'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(verified, 'publicKeySpki'), false);
});

test('verifyHostAttestation rejects a validly shaped envelope with an invalid signature', () => {
  const subject = buildObserveSubject(subjectInputs());
  const host = hostKeys();
  const envelope = signEnvelope(subject, host.privateKey, host.trust.keyId);
  envelope.signature = 'A'.repeat(86);

  assertCode(() => verifyHostAttestation({
    envelope,
    trust: host.trust,
    expectedSubject: subject,
  }), 'UNTRUSTED_HOST_ATTESTATION');
});

test('verifyHostAttestation rejects a signed subject replayed against different evidence', () => {
  const inputs = subjectInputs();
  const subject = buildObserveSubject(inputs);
  const host = hostKeys();
  const envelope = signEnvelope(subject, host.privateKey, host.trust.keyId);
  const staleSubject = buildObserveSubject({
    ...inputs,
    reviewResult: { ...inputs.reviewResult, semanticVerdict: 'FAIL' },
  });

  assertCode(() => verifyHostAttestation({
    envelope,
    trust: host.trust,
    expectedSubject: staleSubject,
  }), 'STALE_HOST_ATTESTATION');
});

test('verifyHostAttestation fails closed for missing trust and unsupported schema', () => {
  const subject = buildObserveSubject(subjectInputs());
  const host = hostKeys();
  const envelope = signEnvelope(subject, host.privateKey, host.trust.keyId);

  assertCode(() => verifyHostAttestation({
    envelope,
    expectedSubject: subject,
  }), 'UNTRUSTED_HOST_ATTESTATION');

  assertCode(() => verifyHostAttestation({
    envelope: { ...envelope, schema: 'dhpk.review-gate.host-attestation.v2' },
    trust: host.trust,
    expectedSubject: subject,
  }), 'UNSUPPORTED_SCHEMA');
});

test('verifyHostAttestation rejects absent envelopes before any trust lookup', () => {
  assertCode(() => verifyHostAttestation({}), 'MISSING_HOST_ATTESTATION');
});

run('review-gate-runtime-attestation');
