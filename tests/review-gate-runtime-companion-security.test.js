'use strict';

// Security HIGH coverage for the structured Claude companion boundary.  The
// tests use only the public runtime CLI: a reviewer may emit data, but the
// runtime is the sole producer of the sibling .result.json file and the sole
// reader that can turn it into a durable review receipt.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  createHostKey,
  getOrCreateHostKey,
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
const COMPANION_SCHEMA = 'dhpk.claude-review-result.v1';
const REVIEWER_CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';
const RUNTIME_SCHEMA = 'dhpk.review-gate.runtime.v1';
const CONFIG_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1', 'config.json');
const STORE_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1');
const FIXTURE_TIME = '2026-09-07T00:00:02.000Z';
const SECRET_MARKER = 'COMPANION_SECURITY_SECRET_390';

function runCli(repoRoot, args = [], input = undefined) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
  });
}

function initArgs(repoRoot) {
  return hostInitArgs(getOrCreateHostKey(repoRoot, 'companion-security'));
}

function temporaryDirectory(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function cleanupPath(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || stat.isFile()) fs.unlinkSync(file);
  else fs.rmSync(file, { recursive: true, force: true });
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

function digestBytes(value) {
  return `sha256:${sha256(value)}`;
}

function identity(suffix = 'companion-security') {
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

function lifecycleEvent(state, observationIdentity, index, extra = {}) {
  return {
    schema_version: 1,
    event_id: `${state}-event-390-companion-${index}`,
    event_type: 'review-lifecycle',
    state,
    task_id: observationIdentity.taskId,
    attempt_id: observationIdentity.attemptId,
    agent: 'code-reviewer',
    session_id: observationIdentity.sessionId,
    attempt: observationIdentity.attempt,
    scope_id: observationIdentity.scopeId,
    diff_id: observationIdentity.diffId,
    wave: observationIdentity.dispatchId,
    occurred_at: FIXTURE_TIME,
    ...extra,
  };
}

function writeJsonLinesFixture(repoRoot, relativePath, values) {
  return writeFixture(
    repoRoot,
    relativePath,
    `${values.map((value) => JSON.stringify(value)).join('\n')}\n`,
  );
}

function buildCompanion(request, artifactContent, observationIdentity, reviewResult = {}) {
  const artifactDigest = digestBytes(Buffer.from(artifactContent, 'utf8'));
  const result = {
    contractVersion: REVIEWER_CONTRACT_VERSION,
    obligationId: request.obligationId,
    lane: request.lane,
    executionStatus: 'COMPLETE',
    applicability: 'REQUIRED',
    semanticVerdict: 'PASS',
    findings: [],
    inspectedScope: [...request.scope.paths],
    evidenceReferences: [`artifact-sha256:${artifactDigest.slice('sha256:'.length)}`],
    ...reviewResult,
  };
  return {
    schema: COMPANION_SCHEMA,
    requestDigest: digestJson(request),
    reviewResult: result,
    artifact: {
      sha256: artifactDigest,
      identity: observationIdentity,
    },
    command: {
      sha256: digestBytes('node tests/reviewer-contract-v2.test.js'),
      outcome: 'PASS',
    },
  };
}

function makeObserveFixture() {
  const repoRoot = temporaryDirectory('dhpk-runtime-companion-security-');
  const host = createHostKey(repoRoot, 'companion-security');
  const initialized = runCli(repoRoot, hostInitArgs(host));
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);

  const preparedResult = runCli(
    repoRoot,
    ['prepare'],
    `${fs.readFileSync(WORK_REQUEST_PATH, 'utf8')}\n`,
  );
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  const prepared = JSON.parse(preparedResult.stdout);
  const request = prepared.reviewRequests[0];
  const observationIdentity = identity();
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-companion.md';
  const artifactContent = [
    '---',
    'agent: code-reviewer',
    `generated_at: ${FIXTURE_TIME}`,
    `commit: ${request.headIdentity.commit}`,
    `scope: [${request.scope.paths.join(', ')}]`,
    `scope_id: ${observationIdentity.scopeId}`,
    `diff_id: ${observationIdentity.diffId}`,
    `task_id: ${observationIdentity.taskId}`,
    `attempt_id: ${observationIdentity.attemptId}`,
    `session_id: ${observationIdentity.sessionId}`,
    `dispatch_attempt: ${observationIdentity.attempt}`,
    `dispatch_id: ${observationIdentity.dispatchId}`,
    'producer: code-reviewer',
    `wave: ${observationIdentity.dispatchId}`,
    'adapter: code-reviewer',
    'stage: review',
    'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
    'verdict: PASS',
    '---',
    'clean',
    '',
  ].join('\n');
  const artifactFile = writeFixture(repoRoot, artifactRelativePath, artifactContent);
  const companionRelativePath = artifactRelativePath.replace(/\.md$/, '.result.json');
  writeJsonFixture(
    repoRoot,
    companionRelativePath,
    buildCompanion(request, artifactContent, observationIdentity),
  );

  const lifecycleRelativePath = '.claude/artifacts/sessions/companion.lifecycle-events.jsonl';
  const readinessRelativePath = '.claude/artifacts/sessions/companion.producer-ready.jsonl';
  const lifecycle = [
    lifecycleEvent('planned', observationIdentity, 1),
    lifecycleEvent('dispatched', observationIdentity, 2),
    lifecycleEvent('started', observationIdentity, 3),
    lifecycleEvent('artifact-ready', observationIdentity, 4),
    lifecycleEvent('verdicted', observationIdentity, 5, { verdict: 'PASS' }),
  ];
  const readiness = [{
    schema_version: 1,
    event_id: 'ready-event-390-companion',
    state: 'artifact-ready',
    task_id: observationIdentity.taskId,
    attempt_id: observationIdentity.attemptId,
    agent: 'code-reviewer',
    session_id: observationIdentity.sessionId,
    attempt: observationIdentity.attempt,
    scope_id: observationIdentity.scopeId,
    diff_id: observationIdentity.diffId,
    wave: observationIdentity.dispatchId,
    occurred_at: FIXTURE_TIME,
    artifact_sha256: digestBytes(Buffer.from(artifactContent, 'utf8')),
  }];
  const lifecycleFile = writeJsonLinesFixture(repoRoot, lifecycleRelativePath, lifecycle);
  const readinessFile = writeJsonLinesFixture(repoRoot, readinessRelativePath, readiness);
  const fixture = {
    repoRoot,
    host,
    prepared,
    request,
    observationIdentity,
    artifactFile,
    artifactRelativePath,
    artifactContent,
    companionRelativePath,
    lifecycleFile,
    lifecycleRelativePath,
    readinessFile,
    readinessRelativePath,
  };
  writeHostAttestation(repoRoot, prepared, fixture, host, { label: 'companion-security' });
  return fixture;
}

function observeArgs(fixture) {
  return [
    'observe',
    '--work-id', fixture.prepared.workId,
    '--wave-id', fixture.prepared.waveId,
    '--artifact', fixture.artifactRelativePath,
    '--companion', fixture.companionRelativePath,
    '--lifecycle-events', fixture.lifecycleRelativePath,
    '--readiness-events', fixture.readinessRelativePath,
    '--host-attestation', fixture.hostAttestationRelativePath,
  ];
}

function diagnosticFiles(repoRoot) {
  const directory = path.join(repoRoot, STORE_RELATIVE_PATH, 'diagnostics');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(directory, name));
}

function stateFiles(repoRoot) {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push(file);
    }
  };
  walk(path.join(repoRoot, STORE_RELATIVE_PATH));
  return files;
}

function assertRedactedFailure(fixture, result, marker = SECRET_MARKER) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
  assert.doesNotMatch(result.stderr, new RegExp(fixture.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result.stderr, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const file of diagnosticFiles(fixture.repoRoot)) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, new RegExp(fixture.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

function assertNoDurableObservation(fixture, marker = SECRET_MARKER) {
  const statusResult = runCli(fixture.repoRoot, [
    'status',
    '--work-id', fixture.prepared.workId,
    '--wave-id', fixture.prepared.waveId,
  ]);
  assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
  assert.doesNotMatch(statusResult.stdout, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const status = JSON.parse(statusResult.stdout);
  assert.strictEqual(status.status, 'PENDING');
  if (Object.prototype.hasOwnProperty.call(status, 'receipts')) assert.deepStrictEqual(status.receipts, []);
  assert.ok(!Object.prototype.hasOwnProperty.call(status, 'migrationObservation'));
  for (const file of stateFiles(fixture.repoRoot)) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

function mutateCompanion(fixture, mutation) {
  const file = path.join(fixture.repoRoot, fixture.companionRelativePath);
  const companion = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutation(companion);
  writeJsonFixture(fixture.repoRoot, fixture.companionRelativePath, companion);
}

function withObserveFixture(callback) {
  const fixture = makeObserveFixture();
  try {
    callback(fixture);
  } finally {
    cleanupPath(fixture.repoRoot);
  }
}

function assertGenericWriterFailure(fixture, result, marker = SECRET_MARKER) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
  assert.doesNotMatch(result.stderr, new RegExp(fixture.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(result.stderr, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const files = diagnosticFiles(fixture.repoRoot);
  assert.strictEqual(files.length, 1, 'writer failure must leave one bounded diagnostic');
  const diagnostic = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  assert.notStrictEqual(diagnostic.code, 'UNSUPPORTED_COMMAND');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, new RegExp(fixture.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

test('observe rejects a finding summary containing a newline, raw-log marker, or secret-like payload', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-summary`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.findings = [{
        id: 'finding-390-summary',
        severity: 'INFO',
        disposition: 'NOTE',
        summary: `stdout: raw-log\nAuthorization: Bearer ${marker}`,
        evidence: ['test:summary-safety'],
      }];
      companion.reviewResult.semanticVerdict = 'PASS';
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects an overlong finding summary without persisting it', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-long-summary`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.findings = [{
        id: 'finding-390-long-summary',
        severity: 'INFO',
        disposition: 'NOTE',
        summary: 's'.repeat(4097),
        evidence: ['test:summary-length'],
      }];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects finding evidence that carries a raw log or secret-like payload', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-finding-evidence`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.findings = [{
        id: 'finding-390-evidence',
        severity: 'INFO',
        disposition: 'NOTE',
        summary: 'bounded finding summary',
        evidence: [`stderr: raw-log-${marker}`, `secret:companion-secret-390`],
      }];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects finding evidence that carries traversal or a newline', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-finding-path`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.findings = [{
        id: 'finding-390-evidence-path',
        severity: 'INFO',
        disposition: 'NOTE',
        summary: 'bounded finding summary',
        evidence: [`../../${marker}.log`, 'test:evidence\nnext'],
      }];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects an overlong finding evidence reference without persisting it', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-long-finding-evidence`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.findings = [{
        id: 'finding-390-long-evidence',
        severity: 'INFO',
        disposition: 'NOTE',
        summary: 'bounded finding summary',
        evidence: [`ref:${'e'.repeat(4097)}`],
      }];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects inspectedScope traversal instead of accepting a parent-relative path', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-scope-traversal`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.inspectedScope = [
        ...fixture.request.scope.paths,
        `../../${marker}.log`,
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects inspectedScope newline, raw-log, and secret-like references', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-scope-payload`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.inspectedScope = [
        ...fixture.request.scope.paths,
        `api-key:companion-secret-${marker}\nnext`,
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects an overlong inspectedScope collection without persisting it', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-scope-length`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.inspectedScope = [
        ...fixture.request.scope.paths,
        ...Array.from({ length: 256 }, (_, index) => `generated/path-${index}`),
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects an overlong inspectedScope reference without persisting it', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-scope-reference-length`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.inspectedScope = [
        ...fixture.request.scope.paths,
        `generated/${'s'.repeat(4097)}`,
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects evidenceReferences traversal instead of accepting a parent-relative path', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-evidence-traversal`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.evidenceReferences = [
        companion.reviewResult.evidenceReferences[0],
        `../../${marker}.log`,
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects evidenceReferences newline, raw-log, and secret-like references', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-evidence-payload`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.evidenceReferences = [
        companion.reviewResult.evidenceReferences[0],
        `token:companion-secret-${marker}\nnext`,
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects an overlong evidenceReferences collection without persisting it', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-evidence-length`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.evidenceReferences = [
        companion.reviewResult.evidenceReferences[0],
        ...Array.from({ length: 256 }, (_, index) => `test:evidence-${index}`),
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});

test('observe rejects an overlong evidenceReferences reference without persisting it', () => {
  withObserveFixture((fixture) => {
    const marker = `${SECRET_MARKER}-evidence-reference-length`;
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.evidenceReferences = [
        companion.reviewResult.evidenceReferences[0],
        `test:${'e'.repeat(4097)}`,
      ];
    });
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assertRedactedFailure(fixture, result, marker);
    assertNoDurableObservation(fixture, marker);
  });
});
test('observe accepts bounded repo-relative, digest, and symbolic test/command references', () => {
  withObserveFixture((fixture) => {
    mutateCompanion(fixture, (companion) => {
      companion.reviewResult.evidenceReferences = [
        companion.reviewResult.evidenceReferences[0],
        'test:review-gate-runtime-companion-security',
        'command:node-tests',
      ];
    });
    writeHostAttestation(
      fixture.repoRoot,
      fixture.prepared,
      fixture,
      fixture.host,
      { label: 'companion-security-bounded' },
    );
    const result = runCli(fixture.repoRoot, observeArgs(fixture));
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const observed = JSON.parse(result.stdout);
    assert.deepStrictEqual(
      {
        status: observed.status,
        semanticVerdict: observed.semanticVerdict,
        executionStatus: observed.executionStatus,
        applicability: observed.applicability,
        lifecycleStatus: observed.lifecycleStatus,
        resolution: observed.resolution,
      },
      {
        status: 'OBSERVED',
        semanticVerdict: 'PASS',
        executionStatus: 'COMPLETE',
        applicability: 'REQUIRED',
        lifecycleStatus: 'RESOLVED',
        resolution: 'REVIEW_PASS',
      },
    );
  });
});

test('init rejects an additional attacker producer trust entry under an exact allowlist', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-companion-config-producer-');
  try {
    const initialized = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const configPath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.trustPolicy.producers.push({
      producer: 'attacker-producer-390',
      adapter: 'review-gate-adapter',
      eventTypes: ['REVIEW_RESULT_RECORDED'],
      receiptKinds: ['review'],
      lanes: ['code-reviewer'],
    });
    writeJsonFixture(repoRoot, CONFIG_RELATIVE_PATH, config);
    const tamperedBytes = fs.readFileSync(configPath);
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericWriterFailure({ repoRoot }, result, 'attacker-producer-390');
    assert.deepStrictEqual(fs.readFileSync(configPath), tamperedBytes);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('init rejects an additional attacker adapter trust entry under an exact allowlist', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-companion-config-adapter-');
  try {
    const initialized = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const configPath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.trustPolicy.producers.push({
      producer: 'claude-review-gate',
      adapter: 'attacker-adapter-390',
      eventTypes: ['REVIEW_RESULT_RECORDED'],
      receiptKinds: ['review'],
      lanes: ['code-reviewer'],
    });
    writeJsonFixture(repoRoot, CONFIG_RELATIVE_PATH, config);
    const tamperedBytes = fs.readFileSync(configPath);
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericWriterFailure({ repoRoot }, result, 'attacker-adapter-390');
    assert.deepStrictEqual(fs.readFileSync(configPath), tamperedBytes);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('status is a minimum bounded projection and never exposes raw receipt payloads', () => {
  withObserveFixture((fixture) => {
    const observed = runCli(fixture.repoRoot, observeArgs(fixture));
    assert.strictEqual(observed.status, 0, `${observed.stdout}\n${observed.stderr}`);
    const statusResult = runCli(fixture.repoRoot, [
      'status',
      '--work-id', fixture.prepared.workId,
      '--wave-id', fixture.prepared.waveId,
    ]);
    assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert.strictEqual(status.schema, RUNTIME_SCHEMA);
    assert.strictEqual(status.command, 'status');
    assert.strictEqual(status.workId, fixture.prepared.workId);
    assert.strictEqual(status.waveId, fixture.prepared.waveId);
    assert.ok(!Object.prototype.hasOwnProperty.call(status, 'rawLogs'));
    assert.ok(!Object.prototype.hasOwnProperty.call(status, 'prompts'));
    if (Array.isArray(status.receipts)) {
      for (const receipt of status.receipts) {
        assert.ok(!Object.prototype.hasOwnProperty.call(receipt, 'payload'));
        assert.ok(!Object.prototype.hasOwnProperty.call(receipt, 'request'));
        assert.ok(!Object.prototype.hasOwnProperty.call(receipt, 'result'));
      }
    }
    assert.ok(!Object.prototype.hasOwnProperty.call(status, 'migrationObservation'));
    assert.ok(!Object.prototype.hasOwnProperty.call(status, 'clearsSentinel'));
    assert.deepStrictEqual(status.receiptSummary, {
      total: 1,
      byKind: { review: 1 },
    });
  });
});

test('write-companion is unsupported and cannot write a sibling or alter Markdown', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-companion-unsupported-');
  const artifactRelativePath = '.claude/artifacts/reviews/code-reviewer-390-unsupported.md';
  const artifactContent = '# unchanged review artifact\n';
  const initialized = runCli(repoRoot, initArgs(repoRoot));
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const artifactFile = writeFixture(repoRoot, artifactRelativePath, artifactContent);
  const resultPath = path.join(repoRoot, artifactRelativePath.replace(/\.md$/, '.result.json'));
  const secret = `${SECRET_MARKER}-unsupported`;
  try {
    const result = runCli(
      repoRoot,
      ['write-companion', '--artifact', artifactRelativePath],
      `${JSON.stringify({ secret })}\n`,
    );
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
    assert.strictEqual(fs.existsSync(resultPath), false);
    assert.strictEqual(fs.readFileSync(artifactFile, 'utf8'), artifactContent);

    const diagnostics = diagnosticFiles(repoRoot);
    assert.strictEqual(diagnostics.length, 1);
    const diagnostic = JSON.parse(fs.readFileSync(diagnostics[0], 'utf8'));
    assert.strictEqual(diagnostic.code, 'UNSUPPORTED_COMMAND');
    const diagnosticContent = fs.readFileSync(diagnostics[0], 'utf8');
    assert.doesNotMatch(diagnosticContent, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(diagnosticContent, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    cleanupPath(repoRoot);
  }
});

run('review-gate-runtime-companion-security');
