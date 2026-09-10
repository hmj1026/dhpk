'use strict';

// Black-box state matrix for the public Review Gate runtime observe checkpoint.
// Each case uses only the CLI and files that a real reviewer/lifecycle adapter
// would produce; the test never reaches into runtime internals.

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
  const content = values.length === 0
    ? ''
    : `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
  return writeFixture(repoRoot, relativePath, content);
}

function lifecycleEvent(state, identity, suffix, verdict = null) {
  return {
    schema_version: 1,
    event_id: `${state}-event-${suffix}`,
    event_type: 'review-lifecycle',
    state,
    task_id: identity.taskId,
    attempt_id: identity.attemptId,
    agent: 'reviewer',
    session_id: identity.sessionId,
    attempt: identity.attempt,
    scope_id: identity.scopeId,
    diff_id: identity.diffId,
    wave: identity.dispatchId,
    occurred_at: FIXTURE_TIME,
    ...(verdict === null ? {} : { verdict }),
  };
}

function cloneWorkRequest({ requestId = 'github:issue:390', kinds = ['SOURCE'] } = {}) {
  const request = JSON.parse(fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
  request.requestId = requestId;
  request.scope.kinds = [...kinds];
  return request;
}

function prepareRepo(workRequest) {
  const repoRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-observe-states-')),
  );
  const host = createHostKey(repoRoot, `observe-states-${workRequest.requestId.replace(/[^a-z0-9-]/gi, '-')}`);
  const initialized = runCli(repoRoot, hostInitArgs(host));
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const preparedResult = runCli(
    repoRoot,
    ['prepare'],
    `${JSON.stringify(workRequest)}\n`,
  );
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  return { repoRoot, prepared: JSON.parse(preparedResult.stdout), host };
}

function makeIdentity(request, suffix) {
  return {
    taskId: `task-390-${suffix}`,
    attemptId: `attempt-390-${suffix}`,
    attempt: 1,
    sessionId: `session-390-${suffix}`,
    dispatchId: `dispatch-390-${suffix}`,
    scopeId: `scope-390-${suffix}`,
    diffId: `diff-390-${suffix}`,
  };
}

function writeObserveEvidence(repoRoot, prepared, request, {
  verdict = 'PASS',
  suffix = request.lane,
} = {}) {
  const identity = makeIdentity(request, suffix);
  const artifactRelativePath = `.claude/artifacts/reviews/${request.lane}-390-${suffix}.md`;
  const artifactContent = [
    '---',
    `agent: ${request.lane}`,
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
    `producer: ${request.lane}`,
    `wave: ${identity.dispatchId}`,
    `adapter: ${request.lane}`,
    'stage: review',
    `verdict: ${verdict}`,
    '---',
    `review result for ${request.lane}: ${verdict}`,
    '',
  ].join('\n');
  writeFixture(repoRoot, artifactRelativePath, artifactContent);
  const artifactDigest = `sha256:${sha256(Buffer.from(artifactContent, 'utf8'))}`;
  const reviewResult = {
    contractVersion: REVIEWER_CONTRACT_VERSION,
    obligationId: request.obligationId,
    lane: request.lane,
    executionStatus: 'COMPLETE',
    applicability: 'REQUIRED',
    semanticVerdict: verdict,
    findings: verdict === 'CHANGES_REQUIRED' ? [{
      id: `finding-390-${suffix}`,
      severity: 'HIGH',
      disposition: 'MUST_FIX',
      summary: 'The review still requires a named remediation.',
      evidence: [artifactRelativePath],
    }] : [],
    inspectedScope: request.scope.paths,
    evidenceReferences: [
      `artifact-sha256:${artifactDigest.replace(/^sha256:/, '')}`,
      ...(verdict === 'BLOCKED' ? ['missing-scope:generated-projection'] : []),
    ],
  };
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  writeJsonFixture(repoRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult,
    artifact: {
      sha256: artifactDigest,
      identity,
    },
    command: {
      sha256: `sha256:${sha256(`node ${request.lane}-reviewer`)}`,
      outcome: 'PASS',
    },
  });

  const lifecycleEvents = [
    lifecycleEvent('planned', identity, suffix),
    lifecycleEvent('dispatched', identity, suffix),
    lifecycleEvent('started', identity, suffix),
    lifecycleEvent('artifact-ready', identity, suffix),
    lifecycleEvent('verdicted', identity, suffix, verdict),
  ];
  const readinessEvents = [{
    schema_version: 1,
    event_id: `ready-event-${suffix}`,
    state: 'artifact-ready',
    task_id: identity.taskId,
    attempt_id: identity.attemptId,
    agent: request.lane,
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
  writeJsonLinesFixture(repoRoot, lifecycleRelativePath, lifecycleEvents);
  writeJsonLinesFixture(repoRoot, readinessRelativePath, readinessEvents);

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
    identity,
  };
}

function observeArgs(prepared, evidence) {
  const args = [
    'observe',
    '--work-id', prepared.workId,
    '--wave-id', prepared.waveId,
    '--artifact', evidence.artifactRelativePath,
    '--companion', evidence.companionRelativePath,
    '--lifecycle-events', evidence.lifecycleRelativePath,
    '--readiness-events', evidence.readinessRelativePath,
    '--host-attestation', evidence.hostAttestationRelativePath,
  ];
  return args;
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

function diagnosticFiles(repoRoot) {
  const directory = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name));
}

function assertConfigInvalidFailure(result, repoRoot, command) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
  const escapedRoot = repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const diagnostics = diagnosticFiles(repoRoot);
  const matching = diagnostics.find((file) => {
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content).command === command && JSON.parse(content).code === 'CONFIG_INVALID';
  });
  assert.ok(matching, `${command} must record CONFIG_INVALID`);
  for (const file of diagnostics) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, new RegExp(escapedRoot));
  }
}

function assertBoundedReceiptSummary(status, expected) {
  assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
  assert.deepStrictEqual(status.receiptSummary, expected);
}

function assertCommonObservation(observeResult, expected) {
  assert.strictEqual(observeResult.status, 0, `${observeResult.stdout}\n${observeResult.stderr}`);
  const observed = JSON.parse(observeResult.stdout);
  assert.strictEqual(observed.schema, RUNTIME_SCHEMA);
  assert.strictEqual(observed.command, 'observe');
  assert.strictEqual(observed.status, 'OBSERVED');
  assert.strictEqual(observed.lane, expected.lane);
  assert.strictEqual(observed.obligationId, expected.obligationId);
  return observed;
}

test('observe records CHANGES_REQUIRED as a Review Gate result', () => {
  const { repoRoot, prepared, host } = prepareRepo(cloneWorkRequest());
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      verdict: 'CHANGES_REQUIRED',
      suffix: 'changes-required',
    });
    evidence.hostAttestationRelativePath = writeHostAttestation(
      repoRoot, prepared, evidence, host, { label: 'changes-required' },
    );
    const observed = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(observed.semanticVerdict, 'CHANGES_REQUIRED');
    assert.strictEqual(observed.executionStatus, 'COMPLETE');

    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(status.semanticVerdict, 'CHANGES_REQUIRED');
    assert.strictEqual(status.executionStatus, 'COMPLETE');
    assert.strictEqual(status.reviewRequests.length, 1);
    assertBoundedReceiptSummary(status, {
      total: 1,
      byKind: { review: 1 },
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'migrationObservation'), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('observe records BLOCKED as a Review Gate result', () => {
  const { repoRoot, prepared, host } = prepareRepo(cloneWorkRequest({ requestId: 'github:issue:390-blocked' }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      verdict: 'BLOCKED',
      suffix: 'blocked',
    });
    evidence.hostAttestationRelativePath = writeHostAttestation(
      repoRoot, prepared, evidence, host, { label: 'blocked' },
    );
    const observed = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(observed.semanticVerdict, 'BLOCKED');
    assert.strictEqual(observed.executionStatus, 'COMPLETE');

    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(status.semanticVerdict, 'BLOCKED');
    assert.strictEqual(status.executionStatus, 'COMPLETE');
    assert.strictEqual(status.reviewRequests.length, 1);
    assertBoundedReceiptSummary(status, {
      total: 1,
      byKind: { review: 1 },
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'migrationObservation'), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('repeating the same observation is idempotent and does not add a second review receipt', () => {
  const { repoRoot, prepared, host } = prepareRepo(cloneWorkRequest({ requestId: 'github:issue:390-retry' }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      suffix: 'retry',
    });
    evidence.hostAttestationRelativePath = writeHostAttestation(
      repoRoot, prepared, evidence, host, { label: 'retry' },
    );
    const first = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    const second = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(second.eventId, first.eventId);
    assert.strictEqual(second.receiptId, first.receiptId);
    assert.strictEqual(second.revision, first.revision);
    assert.strictEqual(second.chainDigest, first.chainDigest);

    const status = readStatus(repoRoot, prepared);
    assertBoundedReceiptSummary(status, {
      total: 1,
      byKind: { review: 1 },
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('multi-lane observe follows the prepared plan order one obligation at a time', () => {
  const { repoRoot, prepared, host } = prepareRepo(cloneWorkRequest({
    requestId: 'github:issue:390-multilane',
    kinds: ['MIGRATION'],
  }));
  try {
    const expectedLanes = ['code-reviewer', 'database-reviewer', 'migration-reviewer'];
    assert.deepStrictEqual(prepared.reviewRequests.map((request) => request.lane), expectedLanes);

    for (const [index, request] of prepared.reviewRequests.entries()) {
      const evidence = writeObserveEvidence(repoRoot, prepared, request, {
        suffix: `multilane-${index}-${request.lane}`,
      });
      evidence.hostAttestationRelativePath = writeHostAttestation(
        repoRoot,
        prepared,
        evidence,
        host,
        { label: `multilane-${index}-${request.lane}` },
      );
      const observed = assertCommonObservation(
        runObserve(repoRoot, prepared, evidence),
        request,
      );
      assert.strictEqual(observed.lane, expectedLanes[index]);
    }

    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(status.reviewRequests.length, 0);
    assert.strictEqual(status.semanticVerdict, 'PASS');
    assertBoundedReceiptSummary(status, {
      total: expectedLanes.length,
      byKind: { review: expectedLanes.length },
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('tampered trust policy rejects observe and status without changing durable evidence', () => {
  const { repoRoot, prepared, host } = prepareRepo(cloneWorkRequest({
    requestId: 'github:issue:390-review-gate-rejection',
  }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      suffix: 'review-gate-rejection',
    });
    evidence.hostAttestationRelativePath = writeHostAttestation(
      repoRoot,
      prepared,
      evidence,
      host,
      { label: 'review-gate-rejection' },
    );
    const eventsDirectory = path.join(
      repoRoot,
      '.dhpk',
      'review-gate',
      'v1',
      'works',
      prepared.workId,
      'events',
    );
    const eventNames = fs.readdirSync(eventsDirectory).sort();
    const eventBytes = new Map(eventNames.map((name) => [
      name,
      fs.readFileSync(path.join(eventsDirectory, name)),
    ]));
    const configPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.trustPolicy.producers = config.trustPolicy.producers.map((entry) => (
      entry.producer === 'claude-review-gate'
        ? {
          ...entry,
          eventTypes: entry.eventTypes.filter((eventType) => eventType !== 'REVIEW_RESULT_RECORDED'),
        }
        : entry
    ));
    fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    fs.chmodSync(configPath, 0o600);
    const tamperedConfigBytes = fs.readFileSync(configPath);

    const failed = runObserve(repoRoot, prepared, evidence);
    assertConfigInvalidFailure(failed, repoRoot, 'observe');

    const status = runCli(repoRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ]);
    assertConfigInvalidFailure(status, repoRoot, 'status');

    assert.deepStrictEqual(fs.readdirSync(eventsDirectory).sort(), eventNames);
    for (const name of eventNames) {
      assert.deepStrictEqual(fs.readFileSync(path.join(eventsDirectory, name)), eventBytes.get(name));
    }
    assert.deepStrictEqual(fs.readFileSync(configPath), tamperedConfigBytes);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-observe-states');
