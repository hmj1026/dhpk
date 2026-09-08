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
const COST_FIELDS = [
  'modelTokens',
  'dispatchCount',
  'semanticReviewCount',
  'remediationRounds',
  'humanTurns',
  'elapsedMs',
  'falseBlockCount',
  'receiptReuseCount',
];

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
  const initialized = runCli(repoRoot, ['init']);
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const preparedResult = runCli(
    repoRoot,
    ['prepare'],
    `${JSON.stringify(workRequest)}\n`,
  );
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  return { repoRoot, prepared: JSON.parse(preparedResult.stdout) };
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
  collector = 'missing',
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
      summary: 'The migration observation still requires a named remediation.',
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

  const sentinelRelativePath = `.claude/artifacts/sessions/${suffix}.sentinel-outcome.json`;
  writeJsonFixture(repoRoot, sentinelRelativePath, {
    status: verdict === 'PASS' ? 'CLEARED' : 'PENDING',
    verdict,
    outcome: verdict,
    lifecycleEventId: lifecycleEvents[lifecycleEvents.length - 1].event_id,
  });

  let costRelativePath = null;
  if (collector === 'empty') {
    costRelativePath = `.claude/artifacts/sessions/${suffix}.accepted-outcome-cost.jsonl`;
    writeJsonLinesFixture(repoRoot, costRelativePath, []);
  }
  if (collector === 'complete') {
    costRelativePath = `.claude/artifacts/sessions/${suffix}.accepted-outcome-cost.jsonl`;
    const acceptedOutcome = verdict === 'PASS';
    const cost = {
      schema: ACCEPTED_OUTCOME_COST_SCHEMA,
      observationId: `legacy-${sha256(identity.taskId).slice(0, 32)}`,
      acceptedOutcome,
      metrics: Object.fromEntries(COST_FIELDS.map((field) => [field, 1])),
      telemetryFailures: [],
      telemetryFailureCount: 0,
      telemetryStatus: 'COMPLETE',
      retirementEligible: acceptedOutcome,
    };
    writeJsonLinesFixture(repoRoot, costRelativePath, [cost]);
  }

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
    costRelativePath,
    sentinelRelativePath,
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
    '--sentinel-outcome', evidence.sentinelRelativePath,
  ];
  if (evidence.costRelativePath) args.push('--accepted-outcome-cost', evidence.costRelativePath);
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

function assertCommonObservation(observeResult, expected, expectedComparison = 'AGREE') {
  assert.strictEqual(observeResult.status, 0, `${observeResult.stdout}\n${observeResult.stderr}`);
  const observed = JSON.parse(observeResult.stdout);
  assert.strictEqual(observed.schema, RUNTIME_SCHEMA);
  assert.strictEqual(observed.command, 'observe');
  assert.strictEqual(observed.status, 'OBSERVED');
  assert.strictEqual(observed.phase, 'OBSERVE');
  assert.strictEqual(observed.comparison, expectedComparison);
  assert.strictEqual(observed.effect, 'OBSERVE_ONLY');
  assert.strictEqual(observed.authority, 'SENTINEL');
  assert.strictEqual(observed.clearsSentinel, false);
  assert.strictEqual(observed.retirementEligible, false);
  assert.strictEqual(observed.lane, expected.lane);
  assert.strictEqual(observed.obligationId, expected.obligationId);
  return observed;
}

test('observe records CHANGES_REQUIRED as an OBSERVE-only migration observation', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest());
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      verdict: 'CHANGES_REQUIRED',
      suffix: 'changes-required',
      collector: 'complete',
    });
    const observed = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(observed.telemetryStatus, 'COMPLETE');

    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(status.semanticVerdict, 'CHANGES_REQUIRED');
    assert.strictEqual(status.executionStatus, 'COMPLETE');
    assert.strictEqual(status.reviewRequests.length, 1);
    assertBoundedReceiptSummary(status, {
      total: 2,
      byKind: {
        review: 1,
        'migration-observation': 1,
      },
    });
    assert.ok(status.migrationObservation, 'CHANGES_REQUIRED must expose a migration projection');
    assert.strictEqual(status.migrationObservation.comparison, 'AGREE');
    assert.strictEqual(status.migrationObservation.reviewGateStatus, 'CHANGES_REQUIRED');
    assert.strictEqual(status.migrationObservation.sentinelStatus, 'PENDING');
    assert.strictEqual(status.migrationObservation.retirementEligible, false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('observe records BLOCKED as an OBSERVE-only migration observation', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest({ requestId: 'github:issue:390-blocked' }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      verdict: 'BLOCKED',
      suffix: 'blocked',
      collector: 'complete',
    });
    const observed = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(observed.telemetryStatus, 'COMPLETE');

    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(status.semanticVerdict, 'BLOCKED');
    assert.strictEqual(status.executionStatus, 'COMPLETE');
    assert.strictEqual(status.reviewRequests.length, 1);
    assertBoundedReceiptSummary(status, {
      total: 2,
      byKind: {
        review: 1,
        'migration-observation': 1,
      },
    });
    assert.ok(status.migrationObservation, 'BLOCKED must expose a migration projection');
    assert.strictEqual(status.migrationObservation.comparison, 'AGREE');
    assert.strictEqual(status.migrationObservation.reviewGateStatus, 'BLOCKED');
    assert.strictEqual(status.migrationObservation.sentinelStatus, 'PENDING');
    assert.strictEqual(status.migrationObservation.retirementEligible, false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('missing collector yields nullable partial telemetry, named failure, and no retirement eligibility', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest({ requestId: 'github:issue:390-missing-collector' }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      suffix: 'missing-collector',
      collector: 'missing',
    });
    const observed = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(observed.telemetryStatus, 'FAILED');
    assert.strictEqual(observed.retirementEligible, false);

    const status = readStatus(repoRoot, prepared);
    assertBoundedReceiptSummary(status, {
      total: 2,
      byKind: {
        review: 1,
        'migration-observation': 1,
      },
    });
    assert.ok(status.migrationObservation, 'missing collector must still expose a migration projection');
    const cost = status.migrationObservation.acceptedOutcomeCost;
    assert.strictEqual(cost.acceptedOutcome, true);
    assert.strictEqual(cost.telemetryStatus, 'FAILED');
    assert.strictEqual(cost.retirementEligible, false);
    assert.deepStrictEqual(cost.telemetryFailures.map((failure) => failure.code), [
      'COLLECTOR_UNAVAILABLE',
    ]);
    assert.deepStrictEqual(cost.metrics, Object.fromEntries(COST_FIELDS.map((field) => [field, null])));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('empty collector yields the same truthful partial telemetry contract as an unavailable collector', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest({ requestId: 'github:issue:390-empty-collector' }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      suffix: 'empty-collector',
      collector: 'empty',
    });
    const observed = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(observed.telemetryStatus, 'FAILED');
    assert.strictEqual(observed.retirementEligible, false);

    const status = readStatus(repoRoot, prepared);
    assertBoundedReceiptSummary(status, {
      total: 2,
      byKind: {
        review: 1,
        'migration-observation': 1,
      },
    });
    assert.ok(status.migrationObservation, 'empty collector must still expose a migration projection');
    const cost = status.migrationObservation.acceptedOutcomeCost;
    assert.strictEqual(cost.telemetryStatus, 'FAILED');
    assert.strictEqual(cost.retirementEligible, false);
    assert.deepStrictEqual(cost.telemetryFailures.map((failure) => failure.code), [
      'COLLECTOR_UNAVAILABLE',
    ]);
    assert.deepStrictEqual(cost.metrics, Object.fromEntries(COST_FIELDS.map((field) => [field, null])));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('repeating the same observation is idempotent and does not add a second migration receipt', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest({ requestId: 'github:issue:390-retry' }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      suffix: 'retry',
      collector: 'complete',
    });
    const first = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    const second = assertCommonObservation(runObserve(repoRoot, prepared, evidence), request);
    assert.strictEqual(second.eventId, first.eventId);
    assert.strictEqual(second.receiptId, first.receiptId);
    assert.strictEqual(second.revision, first.revision);
    assert.strictEqual(second.chainDigest, first.chainDigest);

    const status = readStatus(repoRoot, prepared);
    assertBoundedReceiptSummary(status, {
      total: 2,
      byKind: {
        review: 1,
        'migration-observation': 1,
      },
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('multi-lane observe follows the prepared plan order one obligation at a time', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest({
    requestId: 'github:issue:390-multilane',
    kinds: ['MIGRATION'],
  }));
  try {
    const expectedLanes = ['code-reviewer', 'database-reviewer', 'migration-reviewer'];
    assert.deepStrictEqual(prepared.reviewRequests.map((request) => request.lane), expectedLanes);

    for (const [index, request] of prepared.reviewRequests.entries()) {
      const evidence = writeObserveEvidence(repoRoot, prepared, request, {
        suffix: `multilane-${index}-${request.lane}`,
        collector: 'complete',
      });
      const observed = assertCommonObservation(
        runObserve(repoRoot, prepared, evidence),
        request,
        index === prepared.reviewRequests.length - 1 ? 'AGREE' : 'INDETERMINATE',
      );
      assert.strictEqual(observed.lane, expectedLanes[index]);
    }

    const status = readStatus(repoRoot, prepared);
    assert.strictEqual(status.reviewRequests.length, 0);
    assert.strictEqual(status.semanticVerdict, 'PASS');
    assertBoundedReceiptSummary(status, {
      total: expectedLanes.length * 2,
      byKind: {
        review: expectedLanes.length,
        'migration-observation': expectedLanes.length,
      },
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('tampered trust policy rejects observe and status without changing durable evidence', () => {
  const { repoRoot, prepared } = prepareRepo(cloneWorkRequest({
    requestId: 'github:issue:390-review-gate-rejection',
  }));
  try {
    const request = prepared.reviewRequests[0];
    const evidence = writeObserveEvidence(repoRoot, prepared, request, {
      suffix: 'review-gate-rejection',
      collector: 'complete',
    });
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
    const sentinelPath = path.join(repoRoot, evidence.sentinelRelativePath);
    const sentinelBytes = fs.readFileSync(sentinelPath);
    const configPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.trustPolicy.producers = config.trustPolicy.producers.map((entry) => (
      entry.producer === 'claude-migration'
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
    assert.deepStrictEqual(fs.readFileSync(sentinelPath), sentinelBytes);
    assert.deepStrictEqual(fs.readFileSync(configPath), tamperedConfigBytes);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-observe-states');
