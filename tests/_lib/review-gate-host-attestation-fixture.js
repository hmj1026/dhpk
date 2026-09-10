'use strict';

// Test-only host signer. Production code intentionally exposes verification
// and enrollment only; this fixture keeps the ephemeral private key in the
// test process and writes only the public key and signed envelope.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  sha256,
} = require('../../scripts/lib/receipt-primitives');
const { INITIAL_RISK_POLICY } = require('../../scripts/lib/risk-router');

const SCHEMA = 'dhpk.review-gate.host-attestation.v1';
const SUBJECT_SCHEMA = 'dhpk.review-gate.observe-subject.v1';
const hostKeys = new Map();

const digestJson = (value) => `sha256:${sha256(canonicalJson(value))}`;
const digestBytes = (value) => `sha256:${sha256(value)}`;

const createHostKey = (repoRoot, label = 'test') => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' });
  const relative = `.test-host-${label}.pub`;
  const file = path.join(repoRoot, relative);
  fs.writeFileSync(file, publicKey, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  const host = {
    publicKeyPath: relative,
    keyId: `sha256:${sha256(publicKey)}`,
    trust: {
      schema: 'dhpk.review-gate.host-trust.v1',
      algorithm: 'Ed25519',
      keyId: `sha256:${sha256(publicKey)}`,
      publicKeySpki: publicKey.toString('base64url'),
    },
    privateKey: pair.privateKey,
  };
  hostKeys.set(path.resolve(repoRoot), host);
  return host;
};

const getOrCreateHostKey = (repoRoot, label = 'test') => {
  const existing = hostKeys.get(path.resolve(repoRoot));
  return existing || createHostKey(repoRoot, label);
};

const hostInitArgs = (host) => [
  'init',
  '--host-public-key', host.publicKeyPath,
  '--host-key-id', host.keyId,
];

const jsonLines = (file) => fs.readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line));

const evidencePath = (repoRoot, evidence, field, fallback) => {
  const value = evidence[field] || fallback;
  if (typeof value === 'string') return path.resolve(repoRoot, value);
  return value;
};

const writeHostAttestation = (
  repoRoot,
  prepared,
  evidence,
  host = hostKeys.get(path.resolve(repoRoot)),
  { label = 'test', subjectPatch = null } = {},
) => {
  if (!host || !host.privateKey) throw new Error('host fixture key is required');
  const artifactFile = evidencePath(repoRoot, evidence, 'artifactFile', evidence.artifactRelativePath);
  const companionFile = evidencePath(repoRoot, evidence, 'companionFile', evidence.companionRelativePath);
  const lifecycleFile = evidencePath(repoRoot, evidence, 'lifecycleFile', evidence.lifecycleRelativePath);
  const readinessFile = evidencePath(repoRoot, evidence, 'readinessFile', evidence.readinessRelativePath);
  const artifact = fs.readFileSync(artifactFile);
  const companion = JSON.parse(fs.readFileSync(companionFile, 'utf8'));
  const request = prepared.reviewRequests.find((candidate) => (
    candidate.obligationId === companion.reviewResult.obligationId
  ));
  if (!request) throw new Error('host fixture request is not prepared');
  const lifecycleEvents = jsonLines(lifecycleFile);
  const readinessEvents = jsonLines(readinessFile);
  const executedCommands = [{
    command: `digest:${companion.command.sha256}`,
    outcome: companion.command.outcome,
  }];
  const subject = {
    schema: SUBJECT_SCHEMA,
    producer: 'claude-review-gate',
    adapter: 'review-gate-adapter',
    eventType: 'REVIEW_RESULT_RECORDED',
    effect: 'ENFORCE',
    workId: prepared.workId,
    waveId: prepared.waveId,
    planId: prepared.planId,
    decisionId: prepared.decisionId,
    obligationId: request.obligationId,
    lane: request.lane,
    sourceCommit: request.headIdentity.commit,
    sourceTree: request.headIdentity.tree,
    policyVersion: INITIAL_RISK_POLICY.version,
    contractVersion: request.contractVersion,
    identity: companion.artifact.identity,
    requestDigest: digestJson(request),
    resultDigest: digestJson(companion.reviewResult),
    artifactDigest: digestBytes(artifact),
    lifecycleDigest: digestJson(lifecycleEvents),
    readinessDigest: digestJson(readinessEvents),
    executedCommandsDigest: digestJson(executedCommands),
  };
  const finalSubject = subjectPatch ? subjectPatch(subject) : subject;
  const signature = crypto.sign(
    null,
    Buffer.concat([
      Buffer.from(`${SCHEMA}\u0000`, 'utf8'),
      Buffer.from(canonicalJson(finalSubject), 'utf8'),
    ]),
    host.privateKey,
  ).toString('base64url');
  const relative = `.claude/artifacts/sessions/${label}.host-attestation.json`;
  const file = path.join(repoRoot, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({
    schema: SCHEMA,
    algorithm: 'Ed25519',
    keyId: host.keyId,
    subject: finalSubject,
    signature,
  })}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  evidence.hostAttestationRelativePath = relative;
  return relative;
};

module.exports = {
  createHostKey,
  getOrCreateHostKey,
  hostInitArgs,
  writeHostAttestation,
};
