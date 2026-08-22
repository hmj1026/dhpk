'use strict';

// RED-first coverage for harness-facade-receipt-contract tasks 2.3 and 2.4.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const receipts = require('../scripts/lib/harness-receipt');

const ROOT = path.join(__dirname, '..');
const PLAN = 'sha256:' + '1'.repeat(64);
const ARTIFACT = 'sha256:' + '2'.repeat(64);

function temporaryReceiptRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-identity-'));
}

function sourceBinding(revision = 'HEAD') {
  const sourceCommit = execFileSync('git', ['rev-parse', `${revision}^{commit}`], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  return { sourceCommit, sourceTree: receipts.resolveGitTree(ROOT, sourceCommit) };
}

function makeAttempt(root, options = {}) {
  const binding = sourceBinding(options.revision || 'HEAD');
  return receipts.createAttempt({
    root,
    command: 'harness verify --json',
    taskId: 'task-identity',
    attemptId: options.attemptId || 'attempt-1',
    sourceCommit: binding.sourceCommit,
    sourceTree: binding.sourceTree,
    sessionId: 'session-1',
    dispatch: { wave: 1, dispatchId: 'dispatch-1' },
    scopeId: 'scope-1',
    diffId: 'diff-1',
    planFingerprint: PLAN,
    artifactFingerprint: ARTIFACT,
    surface: 'agent-plugin',
    adapter: 'codex-sync',
    stage: 'verify',
    producer: 'harness-test',
    operationKey: options.operationKey,
    retryOf: options.retryOf,
    backupReference: options.backupReference,
  });
}

test('exact source commit and resolved tree must match the consuming checkout', () => {
  const root = temporaryReceiptRoot();
  try {
    const current = sourceBinding('HEAD');
    const attempt = makeAttempt(root);
    const accepted = receipts.validateReceipt(attempt.path, {
      root: ROOT,
      expectedSourceCommit: current.sourceCommit,
      expectedSourceTree: current.sourceTree,
    });
    assert.strictEqual(accepted.ok, true, accepted.errors.join('; '));

    const stale = sourceBinding('HEAD^');
    const rejected = receipts.validateReceipt(attempt.path, {
      root: ROOT,
      expectedSourceCommit: stale.sourceCommit,
      expectedSourceTree: stale.sourceTree,
    });
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /commit|tree|current|expected/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('plan, artifact, and strong identity bindings reject foreign evidence', () => {
  const root = temporaryReceiptRoot();
  try {
    const attempt = makeAttempt(root);
    const expected = {
      taskId: 'task-identity',
      attemptId: 'attempt-1',
      scopeId: 'scope-1',
      diffId: 'diff-1',
      sessionId: 'session-1',
      dispatch: { wave: 1, dispatchId: 'dispatch-1' },
      planFingerprint: PLAN,
      artifactFingerprint: ARTIFACT,
      surface: 'agent-plugin',
      adapter: 'codex-sync',
      stage: 'verify',
      producer: 'harness-test',
    };
    assert.strictEqual(receipts.compareIdentity(expected, attempt.envelope).ok, true);
    const foreign = receipts.compareIdentity({ ...expected, artifactFingerprint: 'sha256:' + 'f'.repeat(64) }, attempt.envelope);
    assert.strictEqual(foreign.ok, false);
    assert.match(foreign.errors.join('\n'), /artifact|fingerprint|identity/i);

    const rejected = receipts.validateReceipt(attempt.path, { expectedIdentity: { ...expected, sessionId: 'foreign-session' } });
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /session|identity|foreign/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readiness revalidates artifact bytes instead of trusting a marker or mtime', () => {
  const root = temporaryReceiptRoot();
  const artifactPath = path.join(root, 'artifact.txt');
  try {
    fs.writeFileSync(artifactPath, 'artifact-v1');
    const reference = {
      path: artifactPath,
      fingerprint: 'sha256:d25252040204953b4a9926344bf5de38d5bbd36d01e71eb25b4c68a535f99248',
    };
    assert.strictEqual(receipts.revalidateBytes(reference).ok, true);
    fs.writeFileSync(artifactPath, 'artifact-v2');
    const stale = receipts.revalidateBytes(reference);
    assert.strictEqual(stale.ok, false);
    assert.match(stale.errors.join('\n'), /digest|fingerprint|modified|stale/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lifecycle transitions are forward-only and keep outcome separate', () => {
  const root = temporaryReceiptRoot();
  try {
    const attempt = makeAttempt(root);
    receipts.appendEvent(attempt, { lifecyclePhase: 'PLANNED', outcome: 'PASS' });
    receipts.appendEvent(attempt, { lifecyclePhase: 'RED', outcome: 'FAIL' });
    receipts.appendEvent(attempt, { lifecyclePhase: 'GREEN', outcome: 'PASS' });
    receipts.appendEvent(attempt, { lifecyclePhase: 'REFACTOR', outcome: 'PASS' });
    receipts.appendEvent(attempt, { lifecyclePhase: 'VERIFIED', outcome: 'PASS' });
    const complete = receipts.appendEvent(attempt, { lifecyclePhase: 'COMPLETE', outcome: 'COMPLETE' });
    assert.strictEqual(complete.lifecyclePhase, 'COMPLETE');
    assert.strictEqual(complete.outcome, 'COMPLETE');
    assert.throws(() => receipts.appendEvent(attempt, { lifecyclePhase: 'GREEN', outcome: 'PASS' }), /transition|monotonic|backward|terminal/i);
    assert.strictEqual(receipts.validateReceipt(attempt.path).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('operation keys are idempotent and retries preserve prior identity and backup references', () => {
  const root = temporaryReceiptRoot();
  try {
    const first = makeAttempt(root, {
      operationKey: 'publish:agent-plugin:1',
      backupReference: { path: '/runtime/backups/agent-plugin-1', fingerprint: ARTIFACT },
    });
    const found = receipts.findAttemptByOperationKey(root, 'publish:agent-plugin:1');
    assert.strictEqual(found.attemptId, 'attempt-1');
    assert.deepStrictEqual(first.envelope.backupReference, {
      path: '/runtime/backups/agent-plugin-1',
      fingerprint: ARTIFACT,
    });
    assert.throws(() => makeAttempt(root, {
      attemptId: 'attempt-2',
      operationKey: 'publish:agent-plugin:1',
    }), /operation|idempot|existing|replay/i);

    const retry = makeAttempt(root, {
      attemptId: 'attempt-2',
      operationKey: 'publish:agent-plugin:2',
      retryOf: { taskId: first.envelope.taskId, attemptId: first.envelope.attemptId },
    });
    assert.deepStrictEqual(retry.envelope.retryOf, { taskId: 'task-identity', attemptId: 'attempt-1' });
    assert.strictEqual(receipts.validateReceipt(retry.path).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rollback ownership fails closed for foreign surface or artifact identity', () => {
  const current = sourceBinding('HEAD');
  const target = {
    taskId: 'task-identity',
    attemptId: 'attempt-1',
    surface: 'agent-plugin',
    sourceCommit: current.sourceCommit,
    sourceTree: current.sourceTree,
    planFingerprint: PLAN,
    artifactFingerprint: ARTIFACT,
  };
  assert.strictEqual(receipts.validateRollbackOwnership(target, { ...target }).ok, true);
  const foreignSurface = receipts.validateRollbackOwnership(target, { ...target, surface: 'cursor-plugin' });
  assert.strictEqual(foreignSurface.ok, false);
  assert.match(foreignSurface.errors.join('\n'), /surface|ownership|identity/i);
  assert.throws(() => receipts.assertRollbackOwnership(target, { ...target, artifactFingerprint: 'sha256:' + 'f'.repeat(64) }), /rollback|ownership|artifact|fingerprint/i);
});

run('harness-receipt-identity-lifecycle');
