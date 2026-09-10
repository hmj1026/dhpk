'use strict';

// Black-box contract coverage for the active Review Gate runtime observe
// checkpoint. Evidence is supplied through the same bounded files a reviewer
// produces, but no retired Sentinel, migration, or cost sidecars are used.

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

function digestJson(value) {
  return `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeFixture(repoRoot, relativePath, content) {
  const file = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function writeJson(repoRoot, relativePath, value) {
  writeFixture(repoRoot, relativePath, `${JSON.stringify(value)}\n`);
}

function writeJsonLines(repoRoot, relativePath, values) {
  writeFixture(repoRoot, relativePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

function identity() {
  return {
    taskId: 'task-390-observe',
    attemptId: 'attempt-390-observe-1',
    attempt: 1,
    sessionId: 'session-390-observe',
    dispatchId: 'dispatch-390-observe',
    scopeId: 'scope-390-observe',
    diffId: 'diff-390-observe',
  };
}

function lifecycleEvent(state, ids, index, verdict = undefined) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-observe-${index}`,
    event_type: 'review-lifecycle',
    state,
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'code-reviewer',
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: FIXTURE_TIME,
    ...(verdict === undefined ? {} : { verdict }),
  };
}

function buildEvidence(repoRoot, prepared) {
  const request = prepared.reviewRequests[0];
  const ids = identity();
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-observe.md';
  const artifactContent = `review artifact for ${request.lane}\n`;
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
    evidenceReferences: [`artifact-sha256:${artifactDigest.slice('sha256:'.length)}`],
  };
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  writeJson(repoRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult,
    artifact: { sha256: artifactDigest, identity: ids },
    command: {
      sha256: `sha256:${sha256(`node ${request.lane}-reviewer`)}`,
      outcome: 'PASS',
    },
  });

  const lifecycleRelativePath = '.claude/artifacts/sessions/observe.lifecycle-events.jsonl';
  writeJsonLines(repoRoot, lifecycleRelativePath, [
    lifecycleEvent('planned', ids, 1),
    lifecycleEvent('dispatched', ids, 2),
    lifecycleEvent('started', ids, 3),
    lifecycleEvent('artifact-ready', ids, 4),
    lifecycleEvent('verdicted', ids, 5, 'PASS'),
  ]);
  const readinessRelativePath = '.claude/artifacts/sessions/observe.producer-ready.jsonl';
  writeJsonLines(repoRoot, readinessRelativePath, [{
    schema_version: 1,
    event_id: 'ready-event-390-observe',
    state: 'artifact-ready',
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'code-reviewer',
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: FIXTURE_TIME,
    artifact_sha256: artifactDigest,
  }]);

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
    lifecycleIdentity: ids,
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

test('observe records and retries one Review Gate obligation with bounded provenance', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-observe-')));
  try {
    const host = createHostKey(repoRoot, 'observe-cli');
    const initialized = runCli(repoRoot, hostInitArgs(host));
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const prepare = runCli(
      repoRoot,
      ['prepare'],
      fs.readFileSync(WORK_REQUEST_PATH, 'utf8'),
    );
    assert.strictEqual(prepare.status, 0, `${prepare.stdout}\n${prepare.stderr}`);
    const prepared = JSON.parse(prepare.stdout);
    assert.strictEqual(prepared.reviewRequests.length, 1);
    const evidence = buildEvidence(repoRoot, prepared);
    evidence.hostAttestationRelativePath = writeHostAttestation(
      repoRoot,
      prepared,
      evidence,
      host,
      { label: 'observe-cli' },
    );

    const firstResult = runCli(repoRoot, observeArgs(prepared, evidence));
    assert.strictEqual(firstResult.status, 0, `${firstResult.stdout}\n${firstResult.stderr}`);
    const first = JSON.parse(firstResult.stdout);
    assert.strictEqual(first.schema, RUNTIME_SCHEMA);
    assert.strictEqual(first.command, 'observe');
    assert.strictEqual(first.status, 'OBSERVED');
    assert.strictEqual(first.workId, prepared.workId);
    assert.strictEqual(first.waveId, prepared.waveId);
    assert.strictEqual(first.decisionId, prepared.decisionId);
    assert.strictEqual(first.planId, prepared.planId);
    assert.strictEqual(first.obligationId, prepared.reviewRequests[0].obligationId);
    assert.strictEqual(first.lane, prepared.reviewRequests[0].lane);
    assert.strictEqual(first.semanticVerdict, 'PASS');
    assert.strictEqual(first.executionStatus, 'COMPLETE');
    assert.strictEqual(first.applicability, 'REQUIRED');
    assert.strictEqual(first.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(first.provenance.terminalLifecycleVerdict, 'PASS');
    assert.strictEqual(first.provenance.artifactDigest.startsWith('sha256:'), true);
    assert.strictEqual(first.provenance.eventId, first.eventId);
    assert.strictEqual(first.provenance.receiptId, first.receiptId);
    assert.doesNotMatch(firstResult.stdout, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const secondResult = runCli(repoRoot, observeArgs(prepared, evidence));
    assert.strictEqual(secondResult.status, 0, `${secondResult.stdout}\n${secondResult.stderr}`);
    const second = JSON.parse(secondResult.stdout);
    assert.strictEqual(second.eventId, first.eventId);
    assert.strictEqual(second.receiptId, first.receiptId);
    assert.strictEqual(second.revision, first.revision);
    assert.strictEqual(second.chainDigest, first.chainDigest);
    assert.deepStrictEqual(second.provenance, first.provenance);

    const statusResult = runCli(repoRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ]);
    assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert.strictEqual(status.semanticVerdict, 'PASS');
    assert.strictEqual(status.executionStatus, 'COMPLETE');
    assert.deepStrictEqual(status.reviewRequests, []);
    assert.deepStrictEqual(status.receiptSummary, { total: 1, byKind: { review: 1 } });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'migrationObservation'), false);
    assert.doesNotMatch(statusResult.stdout, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('observe rejects a lifecycle verdict that disagrees with the companion Review Result', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-mismatch-')));
  try {
    const host = createHostKey(repoRoot, 'observe-cli-mismatch');
    assert.strictEqual(runCli(repoRoot, hostInitArgs(host)).status, 0);
    const prepare = runCli(
      repoRoot,
      ['prepare'],
      fs.readFileSync(WORK_REQUEST_PATH, 'utf8'),
    );
    assert.strictEqual(prepare.status, 0, `${prepare.stdout}\n${prepare.stderr}`);
    const prepared = JSON.parse(prepare.stdout);
    const evidence = buildEvidence(repoRoot, prepared);
    const lifecycleFile = path.join(repoRoot, evidence.lifecycleRelativePath);
    const lines = fs.readFileSync(lifecycleFile, 'utf8').trim().split('\n').map(JSON.parse);
    lines[lines.length - 1].verdict = 'WARNING';
    writeJsonLines(repoRoot, evidence.lifecycleRelativePath, lines);
    evidence.hostAttestationRelativePath = writeHostAttestation(
      repoRoot,
      prepared,
      evidence,
      host,
      { label: 'observe-cli-mismatch' },
    );

    const failed = runCli(repoRoot, observeArgs(prepared, evidence));
    assert.notStrictEqual(failed.status, 0);
    assert.strictEqual(failed.stdout, '');
    assert.strictEqual(failed.stderr, 'review-gate-runtime: ERROR\n');
    const diagnostics = fs.readdirSync(path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics'));
    assert.ok(diagnostics.some((name) => (
      JSON.parse(fs.readFileSync(path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics', name), 'utf8')).code
        === 'VERDICT_MISMATCH'
    )));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-observe-cli');
