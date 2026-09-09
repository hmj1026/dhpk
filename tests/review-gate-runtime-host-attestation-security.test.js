'use strict';

// Security RED slice for the public observe checkpoint. Every evidence file in
// this fixture is authored by the caller; hashes and matching identity alone
// must not let observe create an enforcing Review Gate receipt. The intended
// contract is a host-issued, integrity-protected attestation bound to
// the prepared plan and the four evidence digests.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  createHostKey,
  hostInitArgs,
  writeHostAttestation,
} = require('./_lib/review-gate-host-attestation-fixture');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'review-gate-runtime.js');
const WORK_REQUEST_PATH = path.join(
  ROOT,
  'tests',
  'fixtures',
  'review-gate',
  'runtime-work-request-v1.json',
);
const RUNTIME_SCHEMA = 'dhpk.review-gate.runtime.v1';
const COMPANION_SCHEMA = 'dhpk.claude-review-result.v1';
const REVIEWER_CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';
const FIXTURE_TIME = '2026-09-07T00:00:02.000Z';

function runCli(repoRoot, args = [], input = undefined) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digestJson(value) {
  return `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
}

function digestBytes(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function writeFixture(repoRoot, relativePath, content) {
  const file = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function writeJson(repoRoot, relativePath, value) {
  return writeFixture(repoRoot, relativePath, `${JSON.stringify(value)}\n`);
}

function writeJsonLines(repoRoot, relativePath, values) {
  return writeFixture(
    repoRoot,
    relativePath,
    `${values.map((value) => JSON.stringify(value)).join('\n')}\n`,
  );
}

function evidenceIdentity() {
  return {
    taskId: 'task-390-host-attestation',
    attemptId: 'attempt-390-host-attestation-1',
    attempt: 1,
    sessionId: 'session-390-host-attestation',
    dispatchId: 'dispatch-390-host-attestation',
    scopeId: 'scope-390-host-attestation',
    diffId: 'diff-390-host-attestation',
  };
}

function lifecycleEvent(state, identity, index, verdict = undefined) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-host-attestation-${index}`,
    event_type: 'review-lifecycle',
    state,
    task_id: identity.taskId,
    attempt_id: identity.attemptId,
    agent: 'code-reviewer',
    session_id: identity.sessionId,
    attempt: identity.attempt,
    scope_id: identity.scopeId,
    diff_id: identity.diffId,
    wave: identity.dispatchId,
    occurred_at: FIXTURE_TIME,
    ...(verdict === undefined ? {} : { verdict }),
  };
}

function makeFixture() {
  const repoRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-host-attestation-')),
  );
  const host = createHostKey(repoRoot, 'host-attestation-security');
  const initialized = runCli(repoRoot, hostInitArgs(host));
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);

  const preparedResult = runCli(
    repoRoot,
    ['prepare'],
    fs.readFileSync(WORK_REQUEST_PATH, 'utf8'),
  );
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  const prepared = JSON.parse(preparedResult.stdout);
  const request = prepared.reviewRequests[0];
  const identity = evidenceIdentity();
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-host-attestation.md';
  const artifactContent = [
    '---',
    'agent: code-reviewer',
    `generated_at: ${FIXTURE_TIME}`,
    `commit: ${request.headIdentity.commit}`,
    `scope: [${request.scope.paths.join(', ')}]`,
    `scope_id: ${identity.scopeId}`,
    `diff_id: ${identity.diffId}`,
    `task_id: ${identity.taskId}`,
    `attempt_id: ${identity.attemptId}`,
    `session_id: ${identity.sessionId}`,
    `dispatch_attempt: ${identity.attempt}`,
    `dispatch_id: ${identity.dispatchId}`,
    'producer: code-reviewer',
    `wave: ${identity.dispatchId}`,
    'adapter: code-reviewer',
    'stage: review',
    'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
    'verdict: PASS',
    '---',
    'caller-authored artifact',
    '',
  ].join('\n');
  const artifactFile = writeFixture(repoRoot, artifactRelativePath, artifactContent);
  const artifactDigest = digestBytes(Buffer.from(artifactContent, 'utf8'));
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  writeJson(repoRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult: {
      contractVersion: REVIEWER_CONTRACT_VERSION,
      obligationId: request.obligationId,
      lane: request.lane,
      executionStatus: 'COMPLETE',
      applicability: 'REQUIRED',
      semanticVerdict: 'PASS',
      findings: [],
      inspectedScope: request.scope.paths,
      evidenceReferences: [`artifact-sha256:${artifactDigest.slice('sha256:'.length)}`],
    },
    artifact: { sha256: artifactDigest, identity },
    command: {
      sha256: digestBytes('node tests/reviewer-contract-v2.test.js'),
      outcome: 'PASS',
    },
  });

  const lifecycleRelativePath = '.claude/artifacts/sessions/host-attestation.lifecycle-events.jsonl';
  writeJsonLines(repoRoot, lifecycleRelativePath, [
    lifecycleEvent('planned', identity, 1),
    lifecycleEvent('dispatched', identity, 2),
    lifecycleEvent('started', identity, 3),
    lifecycleEvent('artifact-ready', identity, 4),
    lifecycleEvent('verdicted', identity, 5, 'PASS'),
  ]);
  const readinessRelativePath = '.claude/artifacts/sessions/host-attestation.producer-ready.jsonl';
  writeJsonLines(repoRoot, readinessRelativePath, [{
    schema_version: 1,
    event_id: 'ready-event-390-host-attestation',
    state: 'artifact-ready',
    task_id: identity.taskId,
    attempt_id: identity.attemptId,
    agent: 'code-reviewer',
    session_id: identity.sessionId,
    attempt: identity.attempt,
    scope_id: identity.scopeId,
    diff_id: identity.diffId,
    wave: identity.dispatchId,
    occurred_at: FIXTURE_TIME,
    artifact_sha256: artifactDigest,
  }]);

  return {
    repoRoot,
    host,
    prepared,
    artifactFile,
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
  };
}

function observeArgs(fixture) {
  const args = [
    'observe',
    '--work-id', fixture.prepared.workId,
    '--wave-id', fixture.prepared.waveId,
    '--artifact', fixture.artifactRelativePath,
    '--companion', fixture.companionRelativePath,
    '--lifecycle-events', fixture.lifecycleRelativePath,
    '--readiness-events', fixture.readinessRelativePath,
  ];
  if (fixture.hostAttestationRelativePath) {
    args.push('--host-attestation', fixture.hostAttestationRelativePath);
  }
  return args;
}

function diagnosticFiles(repoRoot) {
  const directory = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name));
}

function assertAttestationFailure(fixture, result, expectedCode) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
  const diagnostics = diagnosticFiles(fixture.repoRoot);
  assert.strictEqual(diagnostics.length, 1);
  const diagnostic = JSON.parse(fs.readFileSync(diagnostics[0], 'utf8'));
  assert.strictEqual(diagnostic.command, 'observe');
  assert.strictEqual(diagnostic.code, expectedCode);
}

function attestedFixture() {
  const fixture = makeFixture();
  writeHostAttestation(
    fixture.repoRoot,
    fixture.prepared,
    fixture,
    fixture.host,
    { label: 'host-attestation-security' },
  );
  return fixture;
}

test('observe rejects caller-authored evidence without a host-issued attestation', () => {
  const fixture = makeFixture();
  try {
    const result = runCli(fixture.repoRoot, observeArgs(fixture));

    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');

    const diagnostics = diagnosticFiles(fixture.repoRoot);
    assert.strictEqual(diagnostics.length, 1);
    const diagnostic = JSON.parse(fs.readFileSync(diagnostics[0], 'utf8'));
    assert.strictEqual(diagnostic.command, 'observe');
    assert.strictEqual(diagnostic.code, 'MISSING_HOST_ATTESTATION');

    const statusResult = runCli(fixture.repoRoot, [
      'status',
      '--work-id', fixture.prepared.workId,
      '--wave-id', fixture.prepared.waveId,
    ]);
    assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert.strictEqual(status.schema, RUNTIME_SCHEMA);
    assert.strictEqual(status.status, 'PENDING');
    assert.deepStrictEqual(status.receiptSummary, { total: 0, byKind: {} });
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('observe maps a bounded attestation JSON tree to MALFORMED_HOST_ATTESTATION', () => {
  const fixture = attestedFixture();
  try {
    const envelopePath = path.join(fixture.repoRoot, fixture.hostAttestationRelativePath);
    const nested = Array.from({ length: 130 }, () => []);
    nested.reduce((value, child) => { child.push(value); return child; }, {});
    fs.writeFileSync(envelopePath, `${JSON.stringify({
      schema: 'dhpk.review-gate.host-attestation.v1',
      algorithm: 'Ed25519',
      keyId: fixture.host.keyId,
      subject: nested,
      signature: 'A'.repeat(86),
    })}\n`, { mode: 0o600 });

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertAttestationFailure(fixture, result, 'MALFORMED_HOST_ATTESTATION');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('observe rejects an attestation signed by an untrusted key id', () => {
  const fixture = attestedFixture();
  try {
    const envelopePath = path.join(fixture.repoRoot, fixture.hostAttestationRelativePath);
    const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    envelope.keyId = `sha256:${'a'.repeat(64)}`;
    fs.writeFileSync(envelopePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertAttestationFailure(fixture, result, 'UNTRUSTED_HOST_ATTESTATION');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('observe rejects an invalid host attestation signature before recording a receipt', () => {
  const fixture = attestedFixture();
  try {
    const envelopePath = path.join(fixture.repoRoot, fixture.hostAttestationRelativePath);
    const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    const replacement = envelope.signature[0] === 'A' ? 'B' : 'A';
    envelope.signature = `${replacement}${envelope.signature.slice(1)}`;
    fs.writeFileSync(envelopePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertAttestationFailure(fixture, result, 'UNTRUSTED_HOST_ATTESTATION');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('observe rejects an attestation whose signed subject is stale', () => {
  const fixture = attestedFixture();
  try {
    const lifecyclePath = path.join(fixture.repoRoot, fixture.lifecycleRelativePath);
    const lifecycle = fs.readFileSync(lifecyclePath, 'utf8').trim().split('\n').map(JSON.parse);
    lifecycle[0].event_id = 'stale-host-attestation-event';
    writeJsonLines(fixture.repoRoot, fixture.lifecycleRelativePath, lifecycle);

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertAttestationFailure(fixture, result, 'STALE_HOST_ATTESTATION');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('observe permits an exact host-attested retry without a second receipt', () => {
  const fixture = attestedFixture();
  try {
    const first = runCli(fixture.repoRoot, observeArgs(fixture));
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const second = runCli(fixture.repoRoot, observeArgs(fixture));
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const firstObserved = JSON.parse(first.stdout);
    const secondObserved = JSON.parse(second.stdout);
    assert.strictEqual(secondObserved.eventId, firstObserved.eventId);
    assert.strictEqual(secondObserved.receiptId, firstObserved.receiptId);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('observe rejects a valid host attestation when the checkout has no enrolled trust', () => {
  const fixture = makeFixture();
  try {
    fixture.host = createHostKey(fixture.repoRoot, 'host-attestation-no-trust');
    writeHostAttestation(
      fixture.repoRoot,
      fixture.prepared,
      fixture,
      fixture.host,
      { label: 'host-attestation-no-trust' },
    );
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertAttestationFailure(fixture, result, 'UNTRUSTED_HOST_ATTESTATION');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-host-attestation-security');
