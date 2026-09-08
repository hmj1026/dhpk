'use strict';

// Black-box security regression coverage for the public observe checkpoint.
// Every case uses a fresh consumer checkout and verifies that rejected evidence
// cannot create durable Review Gate receipts or alter the legacy Sentinel.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

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
const ACCEPTED_OUTCOME_COST_SCHEMA = 'dhpk.accepted-outcome-cost.v1';
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

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestJson(value) {
  return `sha256:${sha256(canonicalJson(value))}`;
}

function writeFixture(repoRoot, relativePath, content) {
  const file = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function writeJsonFixture(repoRoot, relativePath, value) {
  return writeFixture(repoRoot, relativePath, `${JSON.stringify(value)}\n`);
}

function writeJsonLinesFixture(repoRoot, relativePath, values) {
  return writeFixture(
    repoRoot,
    relativePath,
    `${values.map((value) => JSON.stringify(value)).join('\n')}\n`,
  );
}

function readJsonLines(file) {
  return fs.readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function lifecycleEvent(state, identity, index, extra = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-security-${index}`,
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
    ...extra,
  };
}

function buildEvidence(repoRoot, prepared) {
  const request = prepared.reviewRequests[0];
  const identity = {
    taskId: 'task-390-security',
    attemptId: 'attempt-390-security-1',
    attempt: 1,
    sessionId: 'session-390-security',
    dispatchId: 'dispatch-390-security',
    scopeId: 'scope-390-security',
    diffId: 'diff-390-security',
  };
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-security.md';
  const artifactContent = [
    '---',
    'agent: code-reviewer',
    `generated_at: ${FIXTURE_TIME}`,
    `commit: ${request.headIdentity.commit}`,
    'scope: [scripts/review-gate-runtime.js]',
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
    evidenceReferences: [`artifact-sha256:${artifactDigest.replace(/^sha256:/, '')}`],
  };
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  const companionFile = writeJsonFixture(repoRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult,
    artifact: { sha256: artifactDigest, identity },
    command: {
      sha256: `sha256:${sha256('node tests/reviewer-contract-v2.test.js')}`,
      outcome: 'PASS',
    },
  });

  const lifecycleEvents = [
    lifecycleEvent('planned', identity, 1),
    lifecycleEvent('dispatched', identity, 2),
    lifecycleEvent('started', identity, 3),
    lifecycleEvent('artifact-ready', identity, 4),
    lifecycleEvent('verdicted', identity, 5, { verdict: 'PASS' }),
  ];
  const readinessEvents = [{
    schema_version: 1,
    event_id: 'ready-event-390-security',
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
  const lifecycleRelativePath = '.claude/artifacts/sessions/.lifecycle-events.jsonl';
  const readinessRelativePath = '.claude/artifacts/sessions/.producer-ready.jsonl';
  const lifecycleFile = writeJsonLinesFixture(repoRoot, lifecycleRelativePath, lifecycleEvents);
  const readinessFile = writeJsonLinesFixture(repoRoot, readinessRelativePath, readinessEvents);

  const acceptedOutcomeCost = {
    schema: ACCEPTED_OUTCOME_COST_SCHEMA,
    observationId: `legacy-${sha256(identity.taskId).slice(0, 32)}`,
    acceptedOutcome: true,
    metrics: {
      modelTokens: null,
      dispatchCount: 1,
      semanticReviewCount: 1,
      remediationRounds: 0,
      humanTurns: null,
      elapsedMs: 42,
      falseBlockCount: null,
      receiptReuseCount: null,
    },
    telemetryFailures: [],
    telemetryFailureCount: 0,
    telemetryStatus: 'PARTIAL',
    retirementEligible: false,
  };
  const costRelativePath = '.claude/artifacts/sessions/.accepted-outcome-cost.jsonl';
  const costFile = writeJsonLinesFixture(repoRoot, costRelativePath, [acceptedOutcomeCost]);

  const sentinelOutcome = {
    status: 'CLEARED',
    verdict: 'PASS',
    outcome: 'PASS',
    lifecycleEventId: lifecycleEvents[lifecycleEvents.length - 1].event_id,
  };
  const sentinelRelativePath = '.claude/artifacts/sessions/.sentinel-outcome.json';
  const sentinelFile = writeJsonFixture(repoRoot, sentinelRelativePath, sentinelOutcome);
  const sentinelMarker = path.join(
    repoRoot,
    '.claude',
    'artifacts',
    'sessions',
    '.pending-review',
  );
  writeFixture(repoRoot, '.claude/artifacts/sessions/.pending-review', 'review pending\n');

  return {
    prepared,
    request,
    identity,
    artifactFile,
    artifactRelativePath,
    companionFile,
    companionRelativePath,
    lifecycleFile,
    lifecycleRelativePath,
    readinessFile,
    readinessRelativePath,
    costFile,
    costRelativePath,
    sentinelFile,
    sentinelRelativePath,
    sentinelMarker,
    sentinelBytes: fs.readFileSync(sentinelFile, 'utf8'),
    markerBytes: fs.readFileSync(sentinelMarker, 'utf8'),
  };
}

function makeFixture() {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-security-')));
  const initialized = runCli(repoRoot, ['init']);
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const preparedResult = runCli(repoRoot, ['prepare'], fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  const prepared = JSON.parse(preparedResult.stdout);
  const evidence = buildEvidence(repoRoot, prepared);
  return { repoRoot, ...evidence };
}

function observeArgs(fixture, overrides = {}) {
  return [
    'observe',
    '--work-id', overrides.workId || fixture.prepared.workId,
    '--wave-id', overrides.waveId || fixture.prepared.waveId,
    '--artifact', overrides.artifact || fixture.artifactRelativePath,
    '--companion', overrides.companion || fixture.companionRelativePath,
    '--lifecycle-events', overrides.lifecycleEvents || fixture.lifecycleRelativePath,
    '--readiness-events', overrides.readinessEvents || fixture.readinessRelativePath,
    '--accepted-outcome-cost', overrides.acceptedOutcomeCost || fixture.costRelativePath,
    '--sentinel-outcome', overrides.sentinelOutcome || fixture.sentinelRelativePath,
  ];
}

function diagnosticFiles(repoRoot) {
  const directory = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics');
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name));
}

function assertRedactedFailure(fixture, result, expectedCode, payloadMarker) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
  assert.doesNotMatch(result.stderr, new RegExp(fixture.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result.stderr, new RegExp(payloadMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const files = diagnosticFiles(fixture.repoRoot);
  assert.strictEqual(files.length, 1, 'one bounded diagnostic sidecar is expected');
  const diagnosticText = fs.readFileSync(files[0], 'utf8');
  const diagnostic = JSON.parse(diagnosticText);
  assert.strictEqual(diagnostic.schema, 'dhpk.review-gate.runtime-diagnostic.v1');
  assert.strictEqual(diagnostic.command, 'observe');
  assert.strictEqual(diagnostic.code, expectedCode);
  assert.doesNotMatch(diagnosticText, new RegExp(fixture.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(diagnosticText, new RegExp(payloadMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

function assertNoDurableObservation(fixture) {
  const statusResult = runCli(fixture.repoRoot, [
    'status',
    '--work-id', fixture.prepared.workId,
    '--wave-id', fixture.prepared.waveId,
  ]);
  assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
  const status = JSON.parse(statusResult.stdout);
  assert.strictEqual(status.schema, RUNTIME_SCHEMA);
  assert.strictEqual(status.status, 'PENDING');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
  assert.deepStrictEqual(status.receiptSummary, { total: 0, byKind: {} });
  assert.strictEqual(status.migrationObservation, null);
  assert.strictEqual(fs.readFileSync(fixture.sentinelFile, 'utf8'), fixture.sentinelBytes);
  assert.strictEqual(fs.readFileSync(fixture.sentinelMarker, 'utf8'), fixture.markerBytes);
}

function readStatus(fixture) {
  const result = runCli(fixture.repoRoot, [
    'status',
    '--work-id', fixture.prepared.workId,
    '--wave-id', fixture.prepared.waveId,
  ]);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function assertRetryIntegrityFailure(fixture, retry, beforeStatus, sentinelBytesBeforeRetry) {
  assertRedactedFailure(fixture, retry, 'IDEMPOTENCY_CONFLICT', 'retry-integrity-390');

  const afterStatus = readStatus(fixture);
  assert.strictEqual(afterStatus.revision, beforeStatus.revision);
  assert.strictEqual(afterStatus.chainDigest, beforeStatus.chainDigest);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beforeStatus, 'receipts'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(afterStatus, 'receipts'), false);
  assert.deepStrictEqual(afterStatus.receiptSummary, beforeStatus.receiptSummary);
  assert.strictEqual(
    fs.readFileSync(fixture.sentinelFile, 'utf8'),
    sentinelBytesBeforeRetry,
  );
  assert.strictEqual(fs.readFileSync(fixture.sentinelMarker, 'utf8'), fixture.markerBytes);
}

// Public retry identity contract: an identical work/wave/obligation retry is
// idempotent only when every normalized evidence dimension remains identical.
// The existing review-request/result checks cover the request and result axes;
// this matrix covers the remaining command, lifecycle, readiness, Sentinel,
// cost, and artifact-provenance axes through the public CLI.
const RETRY_INTEGRITY_VARIANTS = Object.freeze([
  {
    name: 'command digest',
    mutate(fixture) {
      const companion = JSON.parse(fs.readFileSync(fixture.companionFile, 'utf8'));
      companion.command.sha256 = `sha256:${'a'.repeat(64)}`;
      writeJsonFixture(fixture.repoRoot, fixture.companionRelativePath, companion);
    },
    args: () => ({}),
  },
  {
    name: 'lifecycle event provenance',
    mutate(fixture) {
      const lifecycle = readJsonLines(fixture.lifecycleFile);
      lifecycle[0].event_id = 'retry-integrity-390-lifecycle';
      writeJsonLinesFixture(fixture.repoRoot, fixture.lifecycleRelativePath, lifecycle);
    },
    args: () => ({}),
  },
  {
    name: 'readiness event provenance',
    mutate(fixture) {
      const readiness = readJsonLines(fixture.readinessFile);
      readiness[0].event_id = 'retry-integrity-390-readiness';
      writeJsonLinesFixture(fixture.repoRoot, fixture.readinessRelativePath, readiness);
    },
    args: () => ({}),
  },
  {
    name: 'Sentinel outcome',
    mutate(fixture) {
      const sentinel = JSON.parse(fs.readFileSync(fixture.sentinelFile, 'utf8'));
      sentinel.status = 'PENDING';
      writeJsonFixture(fixture.repoRoot, fixture.sentinelRelativePath, sentinel);
    },
    args: () => ({}),
  },
  {
    name: 'accepted-outcome cost',
    mutate(fixture) {
      const cost = readJsonLines(fixture.costFile);
      cost[0].metrics.elapsedMs = 43;
      writeJsonLinesFixture(fixture.repoRoot, fixture.costRelativePath, cost);
    },
    args: () => ({}),
  },
  {
    name: 'artifact provenance path',
    mutate(fixture) {
      const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-security-retry-integrity-390.md';
      const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
      writeFixture(
        fixture.repoRoot,
        artifactRelativePath,
        fs.readFileSync(fixture.artifactFile, 'utf8'),
      );
      writeFixture(
        fixture.repoRoot,
        companionRelativePath,
        fs.readFileSync(fixture.companionFile, 'utf8'),
      );
      fixture.retryArgs = {
        artifact: artifactRelativePath,
        companion: companionRelativePath,
      };
    },
    args: (fixture) => fixture.retryArgs || {},
  },
]);

function withFixture(callback) {
  const fixture = makeFixture();
  try {
    callback(fixture);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
}

test('observe rejects a malformed companion with a redacted diagnostic and no receipts', () => {
  withFixture((fixture) => {
    const payloadMarker = 'secret-companion-payload-390';
    const companion = JSON.parse(fs.readFileSync(fixture.companionFile, 'utf8'));
    companion.prompt = payloadMarker;
    writeJsonFixture(fixture.repoRoot, fixture.companionRelativePath, companion);

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, 'MALFORMED_COMPANION', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

test('observe rejects a tampered artifact digest without changing Sentinel state', () => {
  withFixture((fixture) => {
    const payloadMarker = 'tampered-artifact-payload-390';
    fs.appendFileSync(fixture.artifactFile, `${payloadMarker}\n`);

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, 'STALE_ARTIFACT', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

test('observe rejects stale readiness digest before recording a review or migration receipt', () => {
  withFixture((fixture) => {
    const payloadMarker = 'stale-readiness-payload-390';
    const readiness = readJsonLines(fixture.readinessFile);
    readiness[0].artifact_sha256 = `sha256:${'f'.repeat(64)}`;
    readiness[0].marker = payloadMarker;
    writeJsonLinesFixture(fixture.repoRoot, fixture.readinessRelativePath, readiness);

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, 'STALE_ARTIFACT', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

test('observe rejects a foreign work selector without touching the prepared work', () => {
  withFixture((fixture) => {
    const foreignRequest = JSON.parse(fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
    foreignRequest.requestId = 'github:issue:390-foreign-selector';
    foreignRequest.decisionKey = 'review-gate-runtime-observe-security-foreign';
    const foreignPrepare = runCli(
      fixture.repoRoot,
      ['prepare'],
      `${JSON.stringify(foreignRequest)}\n`,
    );
    assert.strictEqual(foreignPrepare.status, 0, `${foreignPrepare.stdout}\n${foreignPrepare.stderr}`);
    const foreign = JSON.parse(foreignPrepare.stdout);
    assert.notStrictEqual(foreign.workId, fixture.prepared.workId);
    assert.notStrictEqual(foreign.waveId, fixture.prepared.waveId);

    const payloadMarker = 'foreign-work-selector-390';
    const result = runCli(fixture.repoRoot, observeArgs(fixture, {
      workId: foreign.workId,
      waveId: fixture.prepared.waveId,
    }));
    assertRedactedFailure(fixture, result, 'FOREIGN_EVIDENCE', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

test('observe rejects a foreign wave selector without recording evidence', () => {
  withFixture((fixture) => {
    const payloadMarker = 'foreign-wave-selector-390';
    const result = runCli(fixture.repoRoot, observeArgs(fixture, {
      waveId: 'wave-foreign-selector-390',
    }));
    assertRedactedFailure(fixture, result, 'FOREIGN_EVIDENCE', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

test('observe rejects a foreign obligation identity without recording evidence', () => {
  withFixture((fixture) => {
    const payloadMarker = 'foreign-obligation-390';
    const companion = JSON.parse(fs.readFileSync(fixture.companionFile, 'utf8'));
    companion.reviewResult.obligationId = 'obligation-foreign-390';
    companion.reviewResult.evidenceReferences.push(payloadMarker);
    writeJsonFixture(fixture.repoRoot, fixture.companionRelativePath, companion);

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, 'FOREIGN_EVIDENCE', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

test('observe rejects a sidecar identity mismatch without altering the Sentinel marker', () => {
  withFixture((fixture) => {
    const payloadMarker = 'foreign-sidecar-identity-390';
    const lifecycle = readJsonLines(fixture.lifecycleFile);
    lifecycle[2].task_id = payloadMarker;
    writeJsonLinesFixture(fixture.repoRoot, fixture.lifecycleRelativePath, lifecycle);

    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, 'FOREIGN_IDENTITY', payloadMarker);
    assertNoDurableObservation(fixture);
  });
});

for (const variant of RETRY_INTEGRITY_VARIANTS) {
  test(`observe retry rejects a normalized fingerprint change: ${variant.name}`, () => {
    withFixture((fixture) => {
      const first = runCli(fixture.repoRoot, observeArgs(fixture));
      assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
      const beforeStatus = readStatus(fixture);

      variant.mutate(fixture);
      const sentinelBytesBeforeRetry = fs.readFileSync(fixture.sentinelFile, 'utf8');
      const retry = runCli(fixture.repoRoot, observeArgs(fixture, variant.args(fixture)));

      assertRetryIntegrityFailure(
        fixture,
        retry,
        beforeStatus,
        sentinelBytesBeforeRetry,
      );
    });
  });
}

run('review-gate-runtime-observe-security');
