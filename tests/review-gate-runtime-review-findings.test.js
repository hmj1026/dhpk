'use strict';

// Black-box contracts raised during review of the issue #390 runtime slice.
// These tests deliberately use the dependency-free CLI and durable consumer
// files only; production fixes belong to the implementation worker.

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
const REVIEWER_CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';
const COMPANION_SCHEMA = 'dhpk.claude-review-result.v1';
const FIXTURE_TIME = '2026-09-07T00:00:02.000Z';

function runCli(repoRoot, args = [], input = undefined, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    ...options,
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestJson(value) {
  return `sha256:${sha256(JSON.stringify(canonicalize(value)))}`;
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
  const content = values.length === 0
    ? ''
    : `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
  return writeFixture(repoRoot, relativePath, content);
}

function cloneWorkRequest(overrides = {}) {
  const request = JSON.parse(fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
  if (overrides.requestId) request.requestId = overrides.requestId;
  if (overrides.decisionKey) request.decisionKey = overrides.decisionKey;
  return request;
}

function lifecycleEvent(state, identity, suffix, verdict = null) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-review-${suffix}`,
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
    ...(verdict === null ? {} : { verdict }),
  };
}

function prepareRepo(request) {
  const repoRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-review-')),
  );
  const host = createHostKey(repoRoot, `review-findings-${request.requestId.replace(/[^a-z0-9-]/gi, '-')}`);
  const initialized = runCli(repoRoot, hostInitArgs(host));
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const preparedResult = runCli(repoRoot, ['prepare'], `${JSON.stringify(request)}\n`);
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  return { repoRoot, prepared: JSON.parse(preparedResult.stdout), request, host };
}

function identityFor(suffix) {
  return {
    taskId: `task-390-review-${suffix}`,
    attemptId: `attempt-390-review-${suffix}-1`,
    attempt: 1,
    sessionId: `session-390-review-${suffix}`,
    dispatchId: `dispatch-390-review-${suffix}`,
    scopeId: `scope-390-review-${suffix}`,
    diffId: `diff-390-review-${suffix}`,
  };
}

function writeObserveEvidence(repoRoot, prepared, request, {
  suffix = 'default',
  commandOutcome = 'PASS',
  extraEvidenceReferences = [],
} = {}) {
  const identity = identityFor(suffix);
  const artifactRelativePath = `.claude/artifacts/reviews/code-reviewer-390-${suffix}.md`;
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
    'clean',
    '',
  ].join('\n');
  const artifactFile = writeFixture(repoRoot, artifactRelativePath, artifactContent);
  const artifactDigest = `sha256:${sha256(Buffer.from(artifactContent, 'utf8'))}`;
  const reviewResult = {
    contractVersion: REVIEWER_CONTRACT_VERSION,
    obligationId: request.obligationId,
    lane: request.lane,
    executionStatus: 'COMPLETE',
    applicability: 'REQUIRED',
    semanticVerdict: 'PASS',
    findings: [],
    inspectedScope: request.scope.paths,
    evidenceReferences: [
      `artifact-sha256:${artifactDigest.slice('sha256:'.length)}`,
      ...extraEvidenceReferences,
    ],
  };
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  const companionFile = writeJson(repoRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult,
    artifact: { sha256: artifactDigest, identity },
    command: {
      sha256: `sha256:${sha256(`node ${request.lane}-reviewer`)}`,
      outcome: commandOutcome,
    },
  });

  const lifecycleEvents = [
    lifecycleEvent('planned', identity, suffix),
    lifecycleEvent('dispatched', identity, suffix),
    lifecycleEvent('started', identity, suffix),
    lifecycleEvent('artifact-ready', identity, suffix),
    lifecycleEvent('verdicted', identity, suffix, 'PASS'),
  ];
  const readinessEvents = [{
    schema_version: 1,
    event_id: `ready-event-390-review-${suffix}`,
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
  }];
  const lifecycleRelativePath = `.claude/artifacts/sessions/${suffix}.lifecycle-events.jsonl`;
  const readinessRelativePath = `.claude/artifacts/sessions/${suffix}.producer-ready.jsonl`;
  writeJsonLines(repoRoot, lifecycleRelativePath, lifecycleEvents);
  writeJsonLines(repoRoot, readinessRelativePath, readinessEvents);

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
    artifactFile,
    companionFile,
  };
}

function observeArgs(prepared, evidence) {
  return [
    'observe',
    '--work-id', prepared.workId,
    '--wave-id', prepared.waveId,
    '--artifact', evidence.artifactRelativePath,
    '--companion', evidence.companionRelativePath,
    '--lifecycle-events', evidence.lifecycleRelativePath,
    '--readiness-events', evidence.readinessRelativePath,
    '--host-attestation', evidence.hostAttestationRelativePath,
  ];
}

function runObserve(repoRoot, prepared, evidence) {
  return runCli(repoRoot, observeArgs(prepared, evidence));
}

function readStatus(repoRoot, prepared) {
  const result = runCli(repoRoot, [
    'status',
    '--work-id', prepared.workId,
    '--wave-id', prepared.waveId,
  ]);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function withPreparedRepo(request, callback) {
  const fixture = prepareRepo(request);
  try {
    callback(fixture);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function diagnosticFiles(repoRoot) {
  const directory = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name));
}

test('observe rejects CHANGES_REQUIRED as a command outcome because it belongs to semantic verdicts', () => {
  withPreparedRepo(cloneWorkRequest(), ({ repoRoot, prepared, request, host }) => {
    const evidence = writeObserveEvidence(repoRoot, prepared, prepared.reviewRequests[0], {
      suffix: 'command-changes-required',
      commandOutcome: 'CHANGES_REQUIRED',
    });
    writeHostAttestation(repoRoot, prepared, evidence, host, { label: 'command-changes-required' });
    const result = runObserve(repoRoot, prepared, evidence);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
    const diagnostics = diagnosticFiles(repoRoot);
    assert.strictEqual(diagnostics.length, 1);
    const diagnostic = JSON.parse(fs.readFileSync(diagnostics[0], 'utf8'));
    assert.deepStrictEqual(
      { schema: diagnostic.schema, command: diagnostic.command, code: diagnostic.code },
      {
        schema: 'dhpk.review-gate.runtime-diagnostic.v1',
        command: 'observe',
        code: 'MALFORMED_COMPANION',
      },
    );
    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
    assert.deepStrictEqual(status.receiptSummary, { total: 0, byKind: {} });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'migrationObservation'), false);
  });
});

test('observe accepts documented BLOCKED command outcome as bounded companion data', () => {
  withPreparedRepo(cloneWorkRequest({ requestId: 'github:issue:390-command-blocked' }), ({ repoRoot, prepared, request, host }) => {
    const evidence = writeObserveEvidence(repoRoot, prepared, prepared.reviewRequests[0], {
      suffix: 'command-blocked',
      commandOutcome: 'BLOCKED',
    });
    writeHostAttestation(repoRoot, prepared, evidence, host, { label: 'command-blocked' });
    const result = runObserve(repoRoot, prepared, evidence);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(JSON.parse(result.stdout).status, 'OBSERVED');
  });
});

test('observe accepts documented UNAVAILABLE command outcome as bounded companion data', () => {
  withPreparedRepo(cloneWorkRequest({ requestId: 'github:issue:390-command-unavailable' }), ({ repoRoot, prepared, request, host }) => {
    const evidence = writeObserveEvidence(repoRoot, prepared, prepared.reviewRequests[0], {
      suffix: 'command-unavailable',
      commandOutcome: 'UNAVAILABLE',
    });
    writeHostAttestation(repoRoot, prepared, evidence, host, { label: 'command-unavailable' });
    const result = runObserve(repoRoot, prepared, evidence);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(JSON.parse(result.stdout).status, 'OBSERVED');
  });
});

test('prepare retries the same request after observe without adding a plan receipt or revision', () => {
  withPreparedRepo(cloneWorkRequest({ requestId: 'github:issue:390-prepare-retry' }), ({ repoRoot, prepared, request, host }) => {
    const evidence = writeObserveEvidence(repoRoot, prepared, prepared.reviewRequests[0], { suffix: 'prepare-retry' });
    writeHostAttestation(repoRoot, prepared, evidence, host, { label: 'prepare-retry' });
    const observed = runObserve(repoRoot, prepared, evidence);
    assert.strictEqual(observed.status, 0, `${observed.stdout}\n${observed.stderr}`);
    const observedEnvelope = JSON.parse(observed.stdout);
    const beforeRetry = readStatus(repoRoot, prepared);
    const retry = runCli(repoRoot, ['prepare'], `${JSON.stringify(request)}\n`);
    assert.strictEqual(retry.status, 0, `${retry.stdout}\n${retry.stderr}`);
    const retried = JSON.parse(retry.stdout);

    assert.strictEqual(retried.workId, prepared.workId);
    assert.strictEqual(retried.waveId, prepared.waveId);
    assert.strictEqual(retried.planId, prepared.planId);
    assert.strictEqual(retried.revision, observedEnvelope.revision);
    assert.strictEqual(retried.chainDigest, observedEnvelope.chainDigest);
    assert.deepStrictEqual(retried.reviewRequests, []);

    const afterRetry = readStatus(repoRoot, prepared);
    assert.strictEqual(afterRetry.revision, beforeRetry.revision);
    assert.strictEqual(afterRetry.chainDigest, beforeRetry.chainDigest);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(afterRetry, 'receipts'), false);
    assert.deepStrictEqual(afterRetry.receiptSummary, beforeRetry.receiptSummary);
    assert.deepStrictEqual(afterRetry.receiptSummary, {
      total: 1,
      byKind: { review: 1 },
    });
  });
});

test('prepare rejects an open stdin stream after the 1 MiB bound without waiting for EOF', () => {
  const repoRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-bounded-stdin-')),
  );
  try {
    const host = createHostKey(repoRoot, 'review-findings-bounded');
    const initialized = runCli(repoRoot, hostInitArgs(host));
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const producer = [
      "const chunk=Buffer.alloc(65536,120);",
      "process.stdout.on('error',()=>process.exit(0));",
      "function pump(){if(!process.stdout.write(chunk))process.stdout.once('drain',pump);else setImmediate(pump);}pump();",
    ].join(' ');
    const command = [
      `${process.execPath} -e ${shellQuote(producer)}`,
      `${process.execPath} ${shellQuote(CLI)} prepare --repo-root ${shellQuote(repoRoot)}`,
    ].join(' | ');
    const result = spawnSync('bash', ['-c', command], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 1500,
      killSignal: 'SIGKILL',
    });
    assert.strictEqual(result.error, undefined, `bounded stdin reader did not terminate: ${result.error && result.error.code}`);
    assert.strictEqual(result.signal, null, `bounded stdin reader timed out: ${result.stderr}`);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
    const diagnostics = diagnosticFiles(repoRoot);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(diagnostics[0], 'utf8')).code, 'BOUNDED_INPUT');
    const plans = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'plans');
    assert.deepStrictEqual(fs.readdirSync(plans), []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('status returns bounded receipt counts and summary instead of full receipt payloads', () => {
  withPreparedRepo(cloneWorkRequest({ requestId: 'github:issue:390-status-summary' }), ({ repoRoot, prepared, request, host }) => {
    const payloadMarker = 'review-payload-marker-390-status-summary';
    const evidence = writeObserveEvidence(repoRoot, prepared, prepared.reviewRequests[0], {
      suffix: 'status-summary',
      extraEvidenceReferences: [payloadMarker],
    });
    writeHostAttestation(repoRoot, prepared, evidence, host, { label: 'status-summary' });
    const observed = runObserve(repoRoot, prepared, evidence);
    assert.strictEqual(observed.status, 0, `${observed.stdout}\n${observed.stderr}`);

    const result = runCli(repoRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ]);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const status = JSON.parse(result.stdout);
    assert.strictEqual(status.schema, RUNTIME_SCHEMA);
    assert.strictEqual(status.command, 'status');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
    assert.deepStrictEqual(status.receiptSummary, {
      total: 1,
      byKind: { review: 1 },
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'migrationObservation'), false);
    assert.doesNotMatch(result.stdout, new RegExp(payloadMarker));
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') < 32 * 1024, 'status must remain bounded');
  });
});

run('review-gate-runtime-review-findings');
