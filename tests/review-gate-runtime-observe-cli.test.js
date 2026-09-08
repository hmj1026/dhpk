'use strict';

// Black-box RED slice for the public observe checkpoint.  The fixture follows
// the Claude hook construction order: lifecycle identity, artifact/readiness,
// structured companion, Sentinel outcome, then observe-only cost telemetry.

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
  return writeFixture(repoRoot, relativePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

function lifecycleEvent(state, identity, index, extra = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-observe-${index}`,
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

function buildObserveEvidence(repoRoot, prepared) {
  const request = prepared.reviewRequests[0];
  const identity = {
    taskId: 'task-390-observe',
    attemptId: 'attempt-390-observe-1',
    attempt: 1,
    sessionId: 'session-390-observe',
    dispatchId: 'dispatch-390-observe',
    scopeId: 'scope-390-observe',
    diffId: 'diff-390-observe',
  };
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-observe.md';
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
  writeFixture(repoRoot, artifactRelativePath, artifactContent);
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
  writeJsonFixture(repoRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult,
    artifact: {
      sha256: artifactDigest,
      identity,
    },
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
    event_id: 'ready-event-390-observe',
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
  const verdicted = lifecycleEvents[lifecycleEvents.length - 1];
  const lifecycleRelativePath = '.claude/artifacts/sessions/.lifecycle-events.jsonl';
  const readinessRelativePath = '.claude/artifacts/sessions/.producer-ready.jsonl';
  writeJsonLinesFixture(repoRoot, lifecycleRelativePath, lifecycleEvents);
  writeJsonLinesFixture(repoRoot, readinessRelativePath, readinessEvents);

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
  writeJsonLinesFixture(repoRoot, costRelativePath, [acceptedOutcomeCost]);

  const sentinelOutcome = {
    status: 'CLEARED',
    verdict: 'PASS',
    outcome: 'PASS',
    lifecycleEventId: verdicted.event_id,
  };
  const sentinelRelativePath = '.claude/artifacts/sessions/.sentinel-outcome.json';
  writeJsonFixture(repoRoot, sentinelRelativePath, sentinelOutcome);

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
    costRelativePath,
    sentinelRelativePath,
    identity,
    sentinelOutcomeBytes: fs.readFileSync(path.join(repoRoot, sentinelRelativePath), 'utf8'),
    sentinelMarker: path.join(repoRoot, '.claude', 'artifacts', 'sessions', '.pending-review'),
  };
}

test('observe records one PASS obligation while preserving Sentinel and durable receipts', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-observe-')));
  try {
    const initialized = runCli(repoRoot, ['init']);
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);

    const prepare = runCli(repoRoot, ['prepare'], fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
    assert.strictEqual(prepare.status, 0, `${prepare.stdout}\n${prepare.stderr}`);
    const prepared = JSON.parse(prepare.stdout);
    assert.strictEqual(prepared.reviewRequests.length, 1);
    const evidence = buildObserveEvidence(repoRoot, prepared);
    const markerBefore = fs.existsSync(evidence.sentinelMarker);

    const observe = runCli(repoRoot, [
      'observe',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
      '--artifact', evidence.artifactRelativePath,
      '--companion', evidence.companionRelativePath,
      '--lifecycle-events', evidence.lifecycleRelativePath,
      '--readiness-events', evidence.readinessRelativePath,
      '--accepted-outcome-cost', evidence.costRelativePath,
      '--sentinel-outcome', evidence.sentinelRelativePath,
    ]);
    assert.strictEqual(observe.status, 0, `${observe.stdout}\n${observe.stderr}`);
    const observed = JSON.parse(observe.stdout);
    assert.strictEqual(observed.schema, RUNTIME_SCHEMA);
    assert.strictEqual(observed.command, 'observe');
    assert.strictEqual(observed.status, 'OBSERVED');
    assert.strictEqual(observed.phase, 'OBSERVE');
    assert.strictEqual(observed.workId, prepared.workId);
    assert.strictEqual(observed.waveId, prepared.waveId);
    assert.strictEqual(observed.obligationId, prepared.reviewRequests[0].obligationId);
    assert.strictEqual(observed.lane, 'code-reviewer');
    assert.strictEqual(observed.comparison, 'AGREE');
    assert.strictEqual(observed.effect, 'OBSERVE_ONLY');
    assert.strictEqual(observed.authority, 'SENTINEL');
    assert.strictEqual(observed.telemetryStatus, 'PARTIAL');
    assert.strictEqual(observed.retirementEligible, false);
    assert.strictEqual(observed.clearsSentinel, false);
    assert.doesNotMatch(observe.stdout, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const status = runCli(repoRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ]);
    assert.strictEqual(status.status, 0, `${status.stdout}\n${status.stderr}`);
    const persisted = JSON.parse(status.stdout);
    assert.strictEqual(persisted.status, 'RESOLVED');
    assert.strictEqual(persisted.semanticVerdict, 'PASS');
    assert.strictEqual(persisted.executionStatus, 'COMPLETE');
    assert.deepStrictEqual(persisted.reviewRequests, []);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(persisted, 'receipts'), false);
    assert.deepStrictEqual(persisted.receiptSummary, {
      total: 2,
      byKind: {
        review: 1,
        'migration-observation': 1,
      },
    });
    assert.ok(persisted.migrationObservation, 'status must expose a bounded migration projection');
    assert.strictEqual(persisted.migrationObservation.comparison, 'AGREE');
    assert.strictEqual(persisted.migrationObservation.reviewGateStatus, 'PASS');
    assert.strictEqual(
      persisted.migrationObservation.acceptedOutcomeCost.telemetryStatus,
      'PARTIAL',
    );
    assert.strictEqual(persisted.migrationObservation.retirementEligible, false);
    assert.strictEqual(fs.existsSync(evidence.sentinelMarker), markerBefore);
    assert.strictEqual(
      fs.readFileSync(path.join(repoRoot, evidence.sentinelRelativePath), 'utf8'),
      evidence.sentinelOutcomeBytes,
    );
    assert.doesNotMatch(status.stdout, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-observe-cli');
