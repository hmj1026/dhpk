'use strict';

// Packaged clean-consumer proof for issue #390.  The runtime is copied into a
// disposable package directory first, then installed through the same asset
// installer used by a consumer.  No command in this test is allowed to write
// to the checkout or to the host user's global configuration.

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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  return `sha256:${sha256(JSON.stringify(canonicalize(value)))}`;
}

function writeFile(root, relativePath, content) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function writeJson(root, relativePath, value) {
  return writeFile(root, relativePath, `${JSON.stringify(value)}\n`);
}

function writeJsonLines(root, relativePath, values) {
  return writeFile(root, relativePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

function isolatedEnvironment(home) {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
  };
}

function materializePackage(sandbox) {
  const packageRoot = path.join(sandbox, 'package');
  fs.mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(packageRoot, 'scripts'), {
    recursive: true,
    dereference: false,
  });
  return packageRoot;
}

function installPackage(packageRoot, consumerRoot, home) {
  const installer = path.join(packageRoot, 'scripts', 'setup', 'install-assets.sh');
  const result = spawnSync('bash', [
    installer,
    '--source', packageRoot,
    '--target', path.join(consumerRoot, '.claude', 'dhpk'),
    '--install', 'scripts',
  ], {
    cwd: consumerRoot,
    env: isolatedEnvironment(home),
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function runConsumerCli(consumerRoot, args = [], input = undefined, home) {
  const cli = path.join(consumerRoot, '.claude', 'dhpk', 'scripts', 'review-gate-runtime.js');
  return spawnSync(process.execPath, [
    cli,
    ...args,
    '--repo-root', consumerRoot,
  ], {
    cwd: consumerRoot,
    env: isolatedEnvironment(home),
    encoding: 'utf8',
    input,
  });
}

function identityFor(lane) {
  return {
    taskId: `task-390-consumer-${lane}`,
    attemptId: `attempt-390-consumer-${lane}-1`,
    attempt: 1,
    sessionId: `session-390-consumer-${lane}`,
    dispatchId: `dispatch-390-consumer-${lane}`,
    scopeId: `scope-390-consumer-${lane}`,
    diffId: `diff-390-consumer-${lane}`,
  };
}

function lifecycleEvent(state, identity, index, extra = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-consumer-${index}`,
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

function writeReviewerEvidence(consumerRoot, request) {
  const identity = identityFor(request.lane);
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-consumer.md';
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
    'The packaged consumer runtime records a direct review observation.',
    '',
  ].join('\n');
  writeFile(consumerRoot, artifactRelativePath, artifactContent);
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
  writeJson(consumerRoot, companionRelativePath, {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult,
    artifact: { sha256: artifactDigest, identity },
    command: {
      sha256: `sha256:${sha256('reviewer command output is intentionally not persisted')}`,
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
    event_id: 'ready-event-390-consumer',
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
  const lifecycleRelativePath = '.claude/artifacts/sessions/.lifecycle-events.jsonl';
  const readinessRelativePath = '.claude/artifacts/sessions/.producer-ready.jsonl';
  writeJsonLines(consumerRoot, lifecycleRelativePath, lifecycleEvents);
  writeJsonLines(consumerRoot, readinessRelativePath, readinessEvents);

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
  };
}

function assertNoHostWrites(home) {
  assert.deepStrictEqual(fs.readdirSync(home), [], 'consumer flow must not write host-global state');
}

test('materialized package records a direct review observation in an isolated consumer', () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-390-consumer-e2e-')));
  const consumerRoot = path.join(sandbox, 'consumer');
  const hostHome = path.join(sandbox, 'host-home');
  fs.mkdirSync(consumerRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(hostHome, { recursive: true, mode: 0o700 });

  try {
    const packageRoot = materializePackage(sandbox);
    installPackage(packageRoot, consumerRoot, hostHome);
    const installedCli = path.join(consumerRoot, '.claude', 'dhpk', 'scripts', 'review-gate-runtime.js');
    assert.ok(fs.statSync(installedCli).isFile(), 'runtime CLI must be present in the installed package');
    assert.deepStrictEqual(
      fs.readFileSync(installedCli),
      fs.readFileSync(path.join(ROOT, 'scripts', 'review-gate-runtime.js')),
      'consumer must execute the materialized runtime, not the checkout file',
    );

    const preInit = runConsumerCli(consumerRoot, ['prepare'], fs.readFileSync(WORK_REQUEST_PATH), hostHome);
    assert.notStrictEqual(preInit.status, 0, 'prepare must require explicit setup');
    assert.strictEqual(
      fs.existsSync(path.join(consumerRoot, '.dhpk', 'review-gate', 'v1')),
      false,
      'prepare must not lazily create opt-in state',
    );

    const host = createHostKey(consumerRoot, 'consumer-single');
    const initialized = runConsumerCli(consumerRoot, hostInitArgs(host), undefined, hostHome);
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const initOutput = JSON.parse(initialized.stdout);
    assert.deepStrictEqual(
      { schema: initOutput.schema, command: initOutput.command, initialized: initOutput.initialized },
      { schema: RUNTIME_SCHEMA, command: 'init', initialized: true },
    );
    const storeRoot = path.join(consumerRoot, '.dhpk', 'review-gate', 'v1');
    const keyStat = fs.statSync(path.join(storeRoot, 'integrity.key'));
    assert.strictEqual(keyStat.mode & 0o777, 0o600);

    const preparedResult = runConsumerCli(
      consumerRoot,
      ['prepare'],
      fs.readFileSync(WORK_REQUEST_PATH),
      hostHome,
    );
    assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
    const prepared = JSON.parse(preparedResult.stdout);
    assert.strictEqual(prepared.status, 'PREPARED');
    assert.strictEqual(prepared.reviewRequests.length, 1);
    const request = prepared.reviewRequests[0];
    assert.strictEqual(request.lane, 'code-reviewer');

    const evidence = writeReviewerEvidence(consumerRoot, request);
    writeHostAttestation(consumerRoot, prepared, evidence, host, { label: 'consumer-single' });
    const observedResult = runConsumerCli(consumerRoot, [
      'observe',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
      '--artifact', evidence.artifactRelativePath,
      '--companion', evidence.companionRelativePath,
      '--lifecycle-events', evidence.lifecycleRelativePath,
      '--readiness-events', evidence.readinessRelativePath,
      '--host-attestation', evidence.hostAttestationRelativePath,
    ], undefined, hostHome);
    assert.strictEqual(observedResult.status, 0, `${observedResult.stdout}\n${observedResult.stderr}`);
    const observed = JSON.parse(observedResult.stdout);
    assert.deepStrictEqual(
      {
        schema: observed.schema,
        command: observed.command,
        status: observed.status,
        semanticVerdict: observed.semanticVerdict,
        executionStatus: observed.executionStatus,
        applicability: observed.applicability,
        lifecycleStatus: observed.lifecycleStatus,
        resolution: observed.resolution,
      },
      {
        schema: RUNTIME_SCHEMA,
        command: 'observe',
        status: 'OBSERVED',
        semanticVerdict: 'PASS',
        executionStatus: 'COMPLETE',
        applicability: 'REQUIRED',
        lifecycleStatus: 'RESOLVED',
        resolution: 'REVIEW_PASS',
      },
    );

    const statusResult = runConsumerCli(consumerRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ], undefined, hostHome);
    assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert.strictEqual(status.status, 'RESOLVED');
    assert.strictEqual(status.semanticVerdict, 'PASS');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
    assert.deepStrictEqual(status.receiptSummary, {
      total: 1,
      byKind: { review: 1 },
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(status, 'migrationObservation'));

    const eventDirectory = path.join(storeRoot, 'works', prepared.workId, 'events');
    assert.ok(fs.statSync(eventDirectory).isDirectory(), 'consumer receipt event history must be durable');
    assert.ok(fs.readdirSync(eventDirectory).some((name) => name.endsWith('.json')));
    assert.ok(fs.existsSync(path.join(storeRoot, 'objects', 'sha256')), 'consumer receipt objects must be content-addressed');
    assertNoHostWrites(hostHome);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

function writeLaneReviewerEvidence(consumerRoot, request, suffix) {
  const identity = identityFor(`${suffix}-${request.lane}`);
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
    'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
    'verdict: PASS',
    '---',
    `The ${request.lane} packaged-consumer review result is bounded Review Gate evidence.`,
    '',
  ].join('\n');
  writeFile(consumerRoot, artifactRelativePath, artifactContent);
  const artifactDigest = `sha256:${sha256(Buffer.from(artifactContent, 'utf8'))}`;
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  writeJson(consumerRoot, companionRelativePath, {
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
      sha256: `sha256:${sha256(`${request.lane} consumer evidence`)}`,
      outcome: 'PASS',
    },
  });

  const lifecycleEvents = [
    lifecycleEvent('planned', identity, `${suffix}-1`),
    lifecycleEvent('dispatched', identity, `${suffix}-2`),
    lifecycleEvent('started', identity, `${suffix}-3`),
    lifecycleEvent('artifact-ready', identity, `${suffix}-4`),
    lifecycleEvent('verdicted', identity, `${suffix}-5`, { verdict: 'PASS' }),
  ].map((event) => ({ ...event, agent: request.lane }));
  const readinessEvents = [{
    schema_version: 1,
    event_id: `ready-event-390-consumer-${suffix}`,
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
  writeJsonLines(consumerRoot, lifecycleRelativePath, lifecycleEvents);
  writeJsonLines(consumerRoot, readinessRelativePath, readinessEvents);

  return {
    artifactRelativePath,
    companionRelativePath,
    lifecycleRelativePath,
    readinessRelativePath,
  };
}

function observeConsumerLane(consumerRoot, prepared, evidence, home) {
  return runConsumerCli(consumerRoot, [
    'observe',
    '--work-id', prepared.workId,
    '--wave-id', prepared.waveId,
    '--artifact', evidence.artifactRelativePath,
    '--companion', evidence.companionRelativePath,
    '--lifecycle-events', evidence.lifecycleRelativePath,
    '--readiness-events', evidence.readinessRelativePath,
    '--host-attestation', evidence.hostAttestationRelativePath,
  ], undefined, home);
}

test('installed consumer observes every reviewer lane durably and idempotently', () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-390-consumer-e2e-')));
  const consumerRoot = path.join(sandbox, 'consumer');
  const hostHome = path.join(sandbox, 'host-home');
  const expectedLanes = [
    'code-reviewer',
    'security-reviewer',
    'database-reviewer',
    'migration-reviewer',
    'frontend-reviewer',
    'doc-reviewer',
    'polyfill-reviewer',
  ];
  fs.mkdirSync(consumerRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(hostHome, { recursive: true, mode: 0o700 });

  try {
    const packageRoot = materializePackage(sandbox);
    installPackage(packageRoot, consumerRoot, hostHome);
    const host = createHostKey(consumerRoot, 'consumer-all-lanes');
    const initialized = runConsumerCli(consumerRoot, hostInitArgs(host), undefined, hostHome);
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);

    const workRequest = JSON.parse(fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
    workRequest.requestId = 'github:issue:390-consumer-all-lanes';
    workRequest.scope.kinds = ['SOURCE', 'FRONTEND', 'DATABASE', 'MIGRATION', 'DOCUMENTATION'];
    workRequest.materialRisks = ['SECURITY', 'SCHEMA', 'RUNTIME_VERSION_GUARD'];
    const preparedResult = runConsumerCli(
      consumerRoot,
      ['prepare'],
      `${JSON.stringify(workRequest)}\n`,
      hostHome,
    );
    assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
    const prepared = JSON.parse(preparedResult.stdout);
    assert.deepStrictEqual(prepared.reviewRequests.map((request) => request.lane), expectedLanes);

    const evidences = prepared.reviewRequests.map((request, index) => (
      writeLaneReviewerEvidence(consumerRoot, request, `consumer-all-lanes-${index}`)
    ));
    prepared.reviewRequests.forEach((request, index) => {
      writeHostAttestation(
        consumerRoot,
        prepared,
        evidences[index],
        host,
        { label: `consumer-all-lanes-${index}` },
      );
    });
    let firstObservation = null;
    for (const [index, request] of prepared.reviewRequests.entries()) {
      const result = observeConsumerLane(consumerRoot, prepared, evidences[index], hostHome);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const observed = JSON.parse(result.stdout);
      assert.strictEqual(observed.lane, request.lane);
      assert.strictEqual(observed.schema, RUNTIME_SCHEMA);
      assert.strictEqual(observed.command, 'observe');
      assert.strictEqual(observed.status, 'OBSERVED');
      assert.strictEqual(observed.applicability, 'REQUIRED');
      if (index === prepared.reviewRequests.length - 1) {
        assert.strictEqual(observed.semanticVerdict, 'PASS');
        assert.strictEqual(observed.executionStatus, 'COMPLETE');
        assert.strictEqual(observed.lifecycleStatus, 'RESOLVED');
        assert.strictEqual(observed.resolution, 'REVIEW_PASS');
      } else {
        assert.strictEqual(observed.semanticVerdict, undefined);
        assert.strictEqual(observed.executionStatus, 'NOT_RUN');
        assert.strictEqual(observed.lifecycleStatus, 'PENDING');
        assert.strictEqual(observed.resolution, undefined);
      }

      if (index === 0) {
        firstObservation = observed;
        const retry = observeConsumerLane(consumerRoot, prepared, evidences[index], hostHome);
        assert.strictEqual(retry.status, 0, `${retry.stdout}\n${retry.stderr}`);
        const repeated = JSON.parse(retry.stdout);
        assert.strictEqual(repeated.eventId, firstObservation.eventId);
        assert.strictEqual(repeated.receiptId, firstObservation.receiptId);
        assert.strictEqual(repeated.revision, firstObservation.revision);
        assert.strictEqual(repeated.chainDigest, firstObservation.chainDigest);
      }
    }

    const statusResult = runConsumerCli(consumerRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ], undefined, hostHome);
    assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert.strictEqual(status.status, 'RESOLVED');
    assert.strictEqual(status.semanticVerdict, 'PASS');
    assert.deepStrictEqual(status.reviewRequests, []);
    assert.deepStrictEqual(status.receiptSummary, {
      total: expectedLanes.length,
      byKind: { review: expectedLanes.length },
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(status, 'migrationObservation'));
    assertNoHostWrites(hostHome);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

run('review-gate-runtime-consumer-e2e');
