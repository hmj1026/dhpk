'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const preflight = require('../scripts/lib/consumer-runtime-preflight');
const cursorPackage = require('../scripts/lib/cursor-plugin-package');
const receipts = require('../scripts/lib/harness-receipt');
const harness = require('../scripts/lib/harness');
const releasePreflight = require('../scripts/release/consumer-runtime-preflight');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TREE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TARGET = 'cccccccccccccccccccccccccccccccccccccccc';
const TARGET_TREE = 'dddddddddddddddddddddddddddddddddddddddd';

function identity(overrides = {}) {
  return {
    taskId: 'issue-237',
    attemptId: 'attempt-1',
    sourceCommit: COMMIT,
    sourceTree: TREE,
    targetCommit: TARGET,
    targetTree: TARGET_TREE,
    worktree: 'CLEAN',
    selectedSurfaces: ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync', 'cursor-plugin', 'agent-plugin', 'agy-plugin'],
    requiredRuntimeSurfaces: ['claude-core', 'codex-sync', 'codex-native', 'cursor-plugin', 'agent-plugin', 'agy-plugin'],
    ...overrides,
  };
}

test('preflight identity normalizes exact head and never retains credentials', () => {
  const result = preflight.normalizePreflightIdentity({
    ...identity(),
    diagnostics: 'Authorization: Bearer super-secret and /home/private/.oauth',
    sessionFiles: ['.config/cursor/auth.json', '.ssh/id_rsa'],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.identity.sourceCommit, COMMIT);
  assert.strictEqual(result.identity.worktree, 'CLEAN');
  assert.deepStrictEqual(result.identity.sessionFiles, ['.config/cursor/auth.json']);
  assert.doesNotMatch(JSON.stringify(result), /super-secret|Bearer|\/home\/private/);
});

test('preflight identity rejects foreign or stale exact-head evidence', () => {
  const expected = preflight.normalizePreflightIdentity(identity()).identity;
  const actual = preflight.normalizePreflightIdentity(identity({ targetTree: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' })).identity;
  const checked = preflight.comparePreflightIdentity(expected, actual);
  assert.strictEqual(checked.ok, false);
  assert.match(checked.errors.join('; '), /targetTree|target tree/i);
});

test('preflight PASS is runner readiness and cannot promote runtime completion', () => {
  const ready = preflight.createPreflightResult({
    identity: identity(),
    status: 'PASS',
    surfaces: identity().selectedSurfaces.map((surface) => ({ surface, status: 'PASS', reasonCode: 'READY' })),
    runner: { cursor: { status: 'PASS', version: '0.1.0' } },
  });
  assert.strictEqual(ready.status, 'PASS');
  const aggregate = preflight.aggregatePreflight({
    preflight: ready,
    requiredRuntimeSurfaces: identity().requiredRuntimeSurfaces,
    surfaceResults: identity().requiredRuntimeSurfaces.map((surface) => ({ surface, status: 'NOT_RUN' })),
  });
  assert.notStrictEqual(aggregate.outcome, 'COMPLETE');
  assert.strictEqual(aggregate.preflightStatus, 'PASS');
  assert.strictEqual(aggregate.runtimePromoted, false);
});

test('preflight reason codes and runner metadata are bounded and redacted', () => {
  const normalized = preflight.normalizeRunnerCapabilities({
    cursor: {
      status: 'BLOCKED',
      reasonCode: 'AUTH_REQUIRED',
      version: 'cursor /home/private/tool',
      diagnostic: 'token=SECRET_MARKER',
      capabilities: ['token=CAPABILITY_SECRET_MARKER', '/home/private/capability'],
    },
    session: { selectedFiles: ['.config/cursor/auth.json'], count: 1 },
  });
  assert.strictEqual(normalized.cursor.reasonCode, 'AUTH_REQUIRED');
  assert.doesNotMatch(JSON.stringify(normalized), /SECRET_MARKER|token=|\/home\/private/i);
  assert.ok(preflight.REASON_CODES.has('AUTH_REQUIRED'));
});

test('preflight reports unavailable sandbox prerequisites even when a selected surface is local', () => {
  const result = preflight.preflightForCheckout({
    identity: identity({ selectedSurfaces: ['claude-core'], requiredRuntimeSurfaces: ['claude-core'] }),
    pathValue: '/path/that/does/not/exist',
    env: { PATH: '/path/that/does/not/exist', HOME: '/tmp' },
  });
  assert.strictEqual(result.status, 'UNAVAILABLE', JSON.stringify(result));
  assert.strictEqual(result.reasonCode, 'TOOL_UNAVAILABLE', JSON.stringify(result));
  assert.strictEqual(result.surfaces[0].status, 'PASS', JSON.stringify(result));
  assert.strictEqual(result.runner.bwrap.status, 'UNAVAILABLE', JSON.stringify(result));
});

test('controlled preflight CLI binds default target identity to the current checkout', () => {
  const root = path.join(__dirname, '..');
  const result = releasePreflight.main([
    '--root', root,
    '--task-id', 'issue-237',
    '--attempt-id', 'attempt-cli-test',
  ], { ...process.env, PATH: '/path/that/does/not/exist' });
  assert.strictEqual(result.status, 2, JSON.stringify(result));
  assert.strictEqual(result.payload.identity.targetCommit, result.payload.identity.sourceCommit, JSON.stringify(result));
  assert.strictEqual(result.payload.identity.targetTree, result.payload.identity.sourceTree, JSON.stringify(result));
  assert.doesNotMatch((result.payload.diagnostics || []).join('; '), /targetCommit|targetTree does not match/i);
});

test('Cursor timeout and preflight diagnostics carry bounded machine-readable codes', () => {
  assert.strictEqual(cursorPackage.cursorReasonCode({ status: 'SKIP_INCOMPATIBLE', timed_out: true, no_stdout: true }), 'TIMEOUT_SILENT');
  assert.strictEqual(cursorPackage.cursorReasonCode({ status: 'BLOCKED', timed_out: true, diagnostic: 'progress: chunk' }), 'TIMEOUT_PARTIAL_OUTPUT');
  assert.strictEqual(cursorPackage.cursorReasonCode({ status: 'BLOCKED', output_limited: true }), 'OUTPUT_LIMIT');
  assert.strictEqual(cursorPackage.cursorStreamFrame('{"progress":"delta"}'), true);
  assert.strictEqual(cursorPackage.cursorStreamFrame('nothing useful'), false);
});

test('receipt binds preflight identity and release keeps runtime rows independent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-preflight-receipt-'));
  const pf = preflight.createPreflightResult({
    identity: identity(),
    status: 'PASS',
    surfaces: identity().selectedSurfaces.map((surface) => ({ surface, status: 'PASS' })),
  });
  try {
    const attempt = receipts.createAttempt({
      root,
      command: 'harness preflight',
      phase: 'preflight',
      taskId: 'issue-237',
      attemptId: 'attempt-1',
      sourceCommit: COMMIT,
      sourceTree: TREE,
      identity: { targetCommit: TARGET, targetTree: TARGET_TREE, worktree: 'CLEAN', preflight: pf },
      preflight: pf,
      outcome: 'PASS',
      lifecyclePhase: 'VERIFIED',
    });
    receipts.appendEvent(attempt, { outcome: 'PASS', lifecyclePhase: 'VERIFIED', preflight: pf });
    const checked = receipts.validateReceipt(attempt.path);
    assert.strictEqual(checked.ok, true, JSON.stringify(checked.errors));

    const foreignPreflight = JSON.parse(JSON.stringify(pf));
    foreignPreflight.identity = { ...foreignPreflight.identity, attemptId: 'attempt-foreign' };
    const foreignAttempt = receipts.createAttempt({
      root,
      command: 'harness preflight foreign',
      phase: 'preflight',
      taskId: 'issue-237',
      attemptId: 'attempt-foreign-receipt',
      sourceCommit: COMMIT,
      sourceTree: TREE,
      identity: { targetCommit: TARGET, targetTree: TARGET_TREE, worktree: 'CLEAN', preflight: foreignPreflight },
      preflight: foreignPreflight,
      outcome: 'PASS',
      lifecyclePhase: 'VERIFIED',
    });
    receipts.appendEvent(foreignAttempt, { outcome: 'PASS', lifecyclePhase: 'VERIFIED', preflight: foreignPreflight });
    const foreignChecked = receipts.validateReceipt(foreignAttempt.path);
    assert.strictEqual(foreignChecked.ok, false, JSON.stringify(foreignChecked));
    assert.match(foreignChecked.errors.join('; '), /preflight identity.*attemptId|attemptId.*match/i);

    const required = identity().requiredRuntimeSurfaces;
    const aggregate = harness.runReleaseProbes('/tmp/dhpk-fixture', identity().selectedSurfaces, required, (rootPath, parsed) => ({
      outcome: 'NOT_RUN',
      surfaceResults: [{ surface: parsed.surface, status: 'NOT_RUN', stage: 'CONSUMER', producer: 'fixture' }],
    }), { preflight: pf, expectedIdentity: identity() });
    assert.strictEqual(aggregate.outcome, 'PUBLISHED_PENDING');
    assert.strictEqual(aggregate.preflight.status, 'PASS');

    const foreign = identity({ targetTree: 'e'.repeat(40) });
    const blocked = harness.runReleaseProbes('/tmp/dhpk-fixture', identity().selectedSurfaces, required, (rootPath, parsed) => ({
      outcome: 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture',
        preflightIdentity: foreign,
      }],
    }), { preflight: pf, expectedIdentity: identity() });
    assert.strictEqual(blocked.outcome, 'BLOCKED');
    assert.match(blocked.diagnostics.join('; '), /foreign preflight|targetTree/i);

    const malformed = harness.runReleaseProbes('/tmp/dhpk-fixture', identity().selectedSurfaces, required, () => ({
      outcome: 'PASS',
      surfaceResults: [{ surface: 'claude-core', status: 'PASS', stage: 'CONSUMER', producer: 'fixture' }],
    }), { preflight: { status: 'PASS' }, expectedIdentity: identity() });
    assert.strictEqual(malformed.outcome, 'BLOCKED');
    assert.match(malformed.diagnostics.join('; '), /invalid preflight|schema|identity/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('consumer-runtime-preflight');
