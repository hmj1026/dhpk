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

function sourceBinding(revision = 'HEAD', root = ROOT) {
  const sourceCommit = execFileSync('git', ['rev-parse', `${revision}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return { sourceCommit, sourceTree: receipts.resolveGitTree(root, sourceCommit) };
}

function temporaryCleanCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-checkout-clean-'));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'harness-test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: root });
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture initial'], { cwd: root });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'second\n');
  execFileSync('git', ['commit', '-qam', 'fixture second'], { cwd: root });
  return root;
}

function temporaryDirtyCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-checkout-'));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'harness-test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: root });
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture initial'], { cwd: root });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'dirty\n');
  return root;
}

function makeAttempt(root, options = {}) {
  const checkoutRoot = options.checkoutRoot || ROOT;
  const binding = sourceBinding(options.revision || 'HEAD', checkoutRoot);
  const current = sourceBinding('HEAD', checkoutRoot);
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
    surface: options.surface || 'agent-plugin',
    adapter: options.adapter || 'codex-sync',
    stage: options.stage || 'verify',
    producer: options.producer || 'harness-test',
    ...(options.surfaceResults ? { surfaceResults: options.surfaceResults } : {}),
    ...(options.consumerEvidence ? { consumerEvidence: options.consumerEvidence } : {}),
    ...(options.outcome ? { outcome: options.outcome } : {}),
    identity: {
      targetCommit: current.sourceCommit,
      targetTree: current.sourceTree,
      worktree: receipts.resolveGitWorktree(checkoutRoot),
    },
    operationKey: options.operationKey,
    retryOf: options.retryOf,
    backupReference: options.backupReference,
  });
}

function installationOnlyConsumerEvidence(observationStatus = 'NOT_RUN') {
  return {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    runtimeVerified: true,
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: 'install.codex-sync',
        surface: 'codex-sync',
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: 'surfaceResults.codex-sync.installationEvidence',
      }],
      excludedChecks: [{
        id: 'native.codex-sync',
        surface: 'codex-sync',
        kind: 'native',
        reason: 'Native execution was not required.',
        status: 'NOT_RUN',
        evidenceRef: 'surfaceResults.codex-sync.runtimeEvidence',
      }],
    },
    surfaceResults: [{
      surface: 'codex-sync',
      status: observationStatus,
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      producerSurface: 'codex-sync',
      adapter: { id: 'codex-sync-installer', version: '1.0.0' },
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
}

// This follows requirementEvidenceReport in tests/release-evidence.test.js:
// aggregate runtimeVerified is absent, while the required native capability
// record carries the typed proof and its own runtimeVerified claim.
function nativeRequirementConsumerEvidence() {
  return {
    version: '0.43.0',
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    adapter: { id: 'consumer-gate', version: '1.0.0' },
    planFingerprint: PLAN,
    artifactFingerprint: ARTIFACT,
    schemaVersion: 2,
    verdict: 'PASS',
    surfaceResults: [{
      surface: 'codex-sync',
      status: 'PASS',
      adapter: { id: 'codex-named-role-probe', version: '1.0.0' },
      commands: [],
      environment: { CI: 'true' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: [],
      installationEvidence: { status: 'PASS', reason: 'Selected installation contract passed.' },
      runtimeEvidence: { status: 'NOT_RUN', reason: 'No aggregate runtime claim was made.' },
      requirementEvidence: {
        check1: {
          id: 'selected-capability',
          host: 'codex',
          capability: 'named-role-security-reviewer',
          trigger: 'explicit-native',
          reason: 'Verify only the selected capability.',
          question: 'Did the selected check pass?',
          requestedEvidenceKind: 'native',
          evidenceKind: 'native',
          authorized: true,
          checkKey: 'codex-sync:named-role-security-reviewer:native',
          status: 'PASS',
          adapter: { id: 'codex-named-role-probe', version: '1.0.0' },
          nativeProof: {
            executionOrigin: 'native',
            adapterRoute: 'codex-named-role',
            roles: [{ id: 'security-reviewer', agentTypeAccepted: true, threadId: 'thread-1', childCompleted: true }],
            registryPreconditions: {
              disposableCodexHome: true,
              authReference: 'symlink',
              projectTrust: 'trusted',
              userConfigIgnored: false,
            },
            cliVersion: 'codex-cli fixture',
          },
          runtimeVerified: true,
        },
      },
    }],
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [
        {
          id: 'install.codex-sync',
          surface: 'codex-sync',
          kind: 'installation',
          reason: 'Selected installation contract passed.',
          status: 'PASS',
          evidenceRef: 'surfaceResults.codex-sync.installationEvidence',
        },
        {
          id: 'requirement.selected-capability',
          surface: 'codex-sync',
          kind: 'native',
          reason: 'Verify only the selected capability.',
          status: 'PASS',
          evidenceRef: 'surfaceResults.codex-sync.requirementEvidence.check1',
        },
      ],
      excludedChecks: [],
    },
  };
}

function writeConsumerEvidence(attempt, consumerEvidence) {
  const envelopePath = path.join(attempt.path, 'attempt.json');
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  envelope.consumerEvidence = consumerEvidence;
  fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2) + '\n');
}

test('exact source commit and resolved tree must match the consuming checkout', () => {
  const root = temporaryReceiptRoot();
  const checkoutRoot = temporaryCleanCheckout();
  try {
    const current = sourceBinding('HEAD', checkoutRoot);
    const attempt = makeAttempt(root, { checkoutRoot });
    const accepted = receipts.validateReceipt(attempt.path, {
      root: checkoutRoot,
      expectedSourceCommit: current.sourceCommit,
      expectedSourceTree: current.sourceTree,
    });
    assert.strictEqual(accepted.ok, true, accepted.errors.join('; '));

    const stale = sourceBinding('HEAD^', checkoutRoot);
    const rejected = receipts.validateReceipt(attempt.path, {
      root: checkoutRoot,
      expectedSourceCommit: stale.sourceCommit,
      expectedSourceTree: stale.sourceTree,
    });
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /commit|tree|current|expected/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(checkoutRoot, { recursive: true, force: true });
  }
});

test('receipt v1 preserves the current consumer acceptance envelope as optional evidence', () => {
  const root = temporaryReceiptRoot();
  const consumerEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    runtimeVerified: false,
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: 'install.codex-sync',
        surface: 'codex-sync',
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: 'surfaceResults.codex-sync.installationEvidence',
      }],
      excludedChecks: [{
        id: 'native.codex-sync',
        surface: 'codex-sync',
        kind: 'native',
        reason: 'Native execution was not required.',
        status: 'NOT_RUN',
        evidenceRef: 'surfaceResults.codex-sync.runtimeEvidence',
      }],
    },
    surfaceResults: [{
      surface: 'codex-sync',
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      producerSurface: 'codex-sync',
      adapter: { id: 'codex-sync-installer', version: '1.0.0' },
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  try {
    const attempt = makeAttempt(root, {
      surface: 'codex-sync',
      adapter: 'codex-sync-installer',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      surfaceResults: consumerEvidence.surfaceResults,
      consumerEvidence,
      outcome: 'PASS',
    });
    const checked = receipts.validateReceipt(attempt.path);
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
    assert.strictEqual(checked.envelope.schema, 'dhpk.harness.receipt.v1');
    assert.deepStrictEqual(checked.envelope.surfaceResults, consumerEvidence.surfaceResults);
    assert.deepStrictEqual(checked.envelope.consumerEvidence, consumerEvidence);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt validation rejects acceptance references that do not resolve to the selected observation', () => {
  const root = temporaryReceiptRoot();
  const surfaceResults = [{
    surface: 'codex-sync',
    status: 'PASS',
    installationEvidence: { status: 'FAIL' },
  }];
  const attempt = makeAttempt(root, {
    surface: 'codex-sync',
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    surfaceResults,
    outcome: 'PASS',
  });
  try {
    const envelopePath = path.join(attempt.path, 'attempt.json');
    const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    envelope.consumerEvidence = {
      schemaVersion: 2,
      stage: 'CONSUMER',
      verdict: 'PASS',
      acceptance: {
        verdict: 'PASS',
        requiredChecks: [{
          id: 'install.codex-sync',
          surface: 'codex-sync',
          kind: 'installation',
          reason: 'The selected installation contract passed.',
          status: 'PASS',
          evidenceRef: 'surfaceResults.cursor-sync.installationEvidence',
        }],
        excludedChecks: [],
      },
      surfaceResults,
    };
    fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2) + '\n');

    const checked = receipts.validateReceipt(attempt.path);
    assert.strictEqual(checked.ok, false);
    assert.match(checked.errors.join('\n'), /acceptance|evidence|surface|reference/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt validation rejects v2 installation PASS beside runtime NOT_RUN with aggregate runtimeVerified true', () => {
  const root = temporaryReceiptRoot();
  try {
    const attempt = makeAttempt(root, {
      surface: 'codex-sync',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
    });
    writeConsumerEvidence(attempt, installationOnlyConsumerEvidence('NOT_RUN'));

    const rejected = receipts.validateReceipt(attempt.path);
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /runtimeVerified|runtime proof|runtime evidence/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt validation rejects v2 aggregate runtimeVerified based only on an unrelated surface PASS', () => {
  const root = temporaryReceiptRoot();
  try {
    const attempt = makeAttempt(root, {
      surface: 'codex-sync',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
    });
    writeConsumerEvidence(attempt, installationOnlyConsumerEvidence('PASS'));

    const rejected = receipts.validateReceipt(attempt.path);
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /runtimeVerified|runtime proof|runtime evidence/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt validation accepts v2 native capability proof without an aggregate runtimeVerified claim', () => {
  const root = temporaryReceiptRoot();
  const consumerEvidence = nativeRequirementConsumerEvidence();
  try {
    const attempt = makeAttempt(root, {
      surface: 'codex-sync',
      adapter: 'codex-named-role-probe',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      outcome: 'PASS',
    });
    writeConsumerEvidence(attempt, consumerEvidence);

    const accepted = receipts.validateReceipt(attempt.path);
    assert.strictEqual(accepted.ok, true, accepted.errors.join('; '));
    assert.strictEqual(accepted.envelope.consumerEvidence.runtimeVerified, undefined);
    assert.strictEqual(accepted.envelope.consumerEvidence.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.strictEqual(accepted.envelope.consumerEvidence.surfaceResults[0].requirementEvidence.check1.runtimeVerified, true);
    assert.strictEqual(accepted.envelope.consumerEvidence.acceptance.requiredChecks[1].kind, 'native');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt validation preserves historical non-v2 runtimeVerified compatibility', () => {
  const root = temporaryReceiptRoot();
  const consumerEvidence = {
    stage: 'CONSUMER',
    verdict: 'PASS',
    runtimeVerified: true,
    surfaceResults: [{
      surface: 'codex-sync',
      status: 'PASS',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: 'codex-sync-installer', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
    }],
  };
  try {
    const attempt = makeAttempt(root, {
      surface: 'codex-sync',
      adapter: 'codex-sync-installer',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      surfaceResults: consumerEvidence.surfaceResults,
      consumerEvidence,
      outcome: 'PASS',
    });

    const accepted = receipts.validateReceipt(attempt.path);
    assert.strictEqual(accepted.ok, true, accepted.errors.join('; '));
    assert.strictEqual(accepted.envelope.consumerEvidence.runtimeVerified, true);
    assert.strictEqual(accepted.envelope.consumerEvidence.schemaVersion, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('final target receipt identity must match the checkout independently of generated-input identity', () => {
  const root = temporaryReceiptRoot();
  const checkoutRoot = temporaryCleanCheckout();
  try {
    const current = sourceBinding('HEAD', checkoutRoot);
    const generated = sourceBinding('HEAD^', checkoutRoot);
    const attempt = receipts.createAttempt({
      root,
      command: 'harness verify --json',
      taskId: 'task-target',
      attemptId: 'attempt-1',
      sourceCommit: current.sourceCommit,
      sourceTree: current.sourceTree,
      identity: {
        generatedFromCommit: generated.sourceCommit,
        generatedFromTree: generated.sourceTree,
        targetCommit: current.sourceCommit,
        targetTree: current.sourceTree,
        worktree: receipts.resolveGitWorktree(checkoutRoot),
      },
    });
    const validated = receipts.validateReceipt(attempt.path, { root: checkoutRoot });
    assert.strictEqual(validated.ok, true, validated.errors?.join('; '));

    const envelopePath = path.join(attempt.path, 'attempt.json');
    const tampered = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    tampered.targetCommit = generated.sourceCommit;
    tampered.targetTree = generated.sourceTree;
    fs.writeFileSync(envelopePath, JSON.stringify(tampered, null, 2) + '\n');
    const rejected = receipts.validateReceipt(attempt.path, { root: checkoutRoot });
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /target (commit|tree)|current checkout/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(checkoutRoot, { recursive: true, force: true });
  }
});

test('generated-input commit and tree must be a matching pair', () => {
  const root = temporaryReceiptRoot();
  const checkoutRoot = temporaryCleanCheckout();
  try {
    const current = sourceBinding('HEAD', checkoutRoot);
    const generated = sourceBinding('HEAD^', checkoutRoot);
    const attempt = receipts.createAttempt({
      root,
      command: 'harness verify --json',
      taskId: 'task-generated-pair',
      attemptId: 'attempt-1',
      sourceCommit: current.sourceCommit,
      sourceTree: current.sourceTree,
      identity: {
        generatedFromCommit: generated.sourceCommit,
        generatedFromTree: current.sourceTree,
        targetCommit: current.sourceCommit,
        targetTree: current.sourceTree,
        worktree: 'DIRTY',
      },
    });
    const mismatchedTree = receipts.validateReceipt(attempt.path, { root: checkoutRoot });
    assert.strictEqual(mismatchedTree.ok, false);
    assert.match(mismatchedTree.errors.join('\n'), /generated|tree|commit/i);

    const missingTree = receipts.createAttempt({
      root,
      command: 'harness verify --json',
      taskId: 'task-generated-pair-missing',
      attemptId: 'attempt-1',
      sourceCommit: current.sourceCommit,
      sourceTree: current.sourceTree,
      identity: {
        generatedFromCommit: generated.sourceCommit,
        targetCommit: current.sourceCommit,
        targetTree: current.sourceTree,
        worktree: 'DIRTY',
      },
    });
    const missing = receipts.validateReceipt(missingTree.path, { root: checkoutRoot });
    assert.strictEqual(missing.ok, false);
    assert.match(missing.errors.join('\n'), /generated.*tree|pair|missing/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(checkoutRoot, { recursive: true, force: true });
  }
});

test('receipt validation rejects a forged CLEAN declaration on a dirty checkout', () => {
  const root = temporaryReceiptRoot();
  const checkoutRoot = temporaryDirtyCheckout();
  try {
    const current = {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD^{commit}'], {
        cwd: checkoutRoot,
        encoding: 'utf8',
      }).trim(),
    };
    current.sourceTree = receipts.resolveGitTree(checkoutRoot, current.sourceCommit);
    const attempt = receipts.createAttempt({
      root,
      command: 'harness verify --json',
      taskId: 'task-forged-clean',
      attemptId: 'attempt-1',
      sourceCommit: current.sourceCommit,
      sourceTree: current.sourceTree,
      identity: {
        targetCommit: current.sourceCommit,
        targetTree: current.sourceTree,
        worktree: 'CLEAN',
      },
      outcome: 'COMPLETE',
      lifecyclePhase: 'COMPLETE',
    });
    const rejected = receipts.validateReceipt(attempt.path, { root: checkoutRoot });
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.errors.join('\n'), /worktree|clean|dirty/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(checkoutRoot, { recursive: true, force: true });
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
