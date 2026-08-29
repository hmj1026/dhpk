'use strict';

// RED-first coverage for the controlled local Issue #237 runtime-proof runner.
// The runner must fail closed before consumer invocation when the checkout is
// dirty or its required external capabilities are unavailable.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const inventoryApi = require('../scripts/lib/distribution-inventory');
const preflightApi = require('../scripts/lib/consumer-runtime-preflight');
const receipts = require('../scripts/lib/harness-receipt');
const runnerApi = require('../scripts/release/issue-237-runtime-proof');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'release', 'issue-237-runtime-proof.js');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function checkoutFixture({ dirty = false, entrypoint = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-proof-checkout-')));
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    path.join(root, 'manifests', 'distribution-inventory.json'),
  );
  if (entrypoint) {
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bin', 'dhpk'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'runtime-proof-test@example.invalid']);
  git(root, ['config', 'user.name', 'Runtime Proof Test']);
  git(root, ['add', 'manifests/distribution-inventory.json']);
  git(root, ['commit', '-qm', 'runtime proof fixture']);
  if (dirty) fs.writeFileSync(path.join(root, 'dirty.txt'), 'uncommitted runtime-proof change\n');
  return root;
}

function temporaryReceiptRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-proof-receipts-')));
}

function invoke(root, receiptRoot, env = {}) {
  return spawnSync(process.execPath, [
    RUNNER,
    '--root', root,
    '--receipt-root', receiptRoot,
    '--task-id', 'issue-237-runtime-proof',
    '--attempt-id', 'runtime-proof-attempt',
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ...env },
  });
}

function parseJson(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, 1, `expected one JSON result line, got ${lines.length}: ${stdout}`);
  return JSON.parse(lines[0]);
}

test('controlled runtime-proof runner refuses a dirty checkout before consumer invocation', () => {
  const root = checkoutFixture({ dirty: true });
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(root, receiptRoot, { PATH: '/usr/bin:/bin' });
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const payload = parseJson(result.stdout);
    assert.strictEqual(payload.runtimePromoted, false, JSON.stringify(payload));
    assert.notStrictEqual(payload.outcome, 'COMPLETE', JSON.stringify(payload));
    assert.match(JSON.stringify(payload), /clean|dirty/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('controlled runtime-proof runner keeps unavailable external tools non-complete and redacts session markers', () => {
  const root = checkoutFixture();
  const receiptRoot = temporaryReceiptRoot();
  const cursorHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-proof-secret-marker-')));
  const agyHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-proof-agy-home-')));
  const marker = 'RUNTIME_PROOF_SECRET_MARKER_123456789';
  try {
    fs.mkdirSync(path.join(cursorHome, '.config', 'cursor'), { recursive: true });
    fs.writeFileSync(path.join(cursorHome, '.config', 'cursor', 'auth.json'), JSON.stringify({ token: marker }));
    const result = invoke(root, receiptRoot, {
      PATH: '/usr/bin:/bin',
      DHPK_CURSOR_HOST_HOME: cursorHome,
      DHPK_AGY_HOST_HOME: agyHome,
    });
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const payload = parseJson(result.stdout);
    assert.strictEqual(payload.runtimePromoted, false, JSON.stringify(payload));
    assert.strictEqual(payload.outcome, 'UNAVAILABLE', JSON.stringify(payload));
    assert.doesNotMatch(result.stdout, new RegExp(marker));
    assert.doesNotMatch(result.stderr, new RegExp(marker));
    const runnerReceipt = path.join(receiptRoot, 'issue-237-runtime-proof', 'runtime-proof-attempt', 'runtime-proof.json');
    assert.strictEqual(fs.statSync(runnerReceipt).mode & 0o777, 0o600);
    const receiptText = fs.readFileSync(runnerReceipt, 'utf8');
    assert.strictEqual(JSON.parse(receiptText).runtimePromoted, false);
    assert.doesNotMatch(receiptText, new RegExp(marker));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(cursorHome, { recursive: true, force: true });
    fs.rmSync(agyHome, { recursive: true, force: true });
  }
});

test('release evidence accepts only the canonical six runtime PASS rows and exact identity', () => {
  const root = checkoutFixture();
  try {
    const binding = receipts.resolveGitBinding(root);
    const worktree = receipts.resolveGitWorktree(root);
    const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    const identity = {
      taskId: 'issue-237-runtime-proof',
      attemptId: 'runtime-proof-valid',
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      targetCommit: binding.sourceCommit,
      targetTree: binding.sourceTree,
      worktree,
      selectedSurfaces: required.requiredSurfaces,
      requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
    };
    const preflight = preflightApi.createPreflightResult({
      identity,
      status: 'PASS',
      surfaces: required.requiredSurfaces.map((surface) => ({ surface, status: 'PASS', reasonCode: 'READY' })),
      runner: { node: { status: 'PASS', reasonCode: 'READY' } },
    });
    const payload = {
      phase: 'release',
      outcome: 'COMPLETE',
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      targetCommit: binding.sourceCommit,
      targetTree: binding.sourceTree,
      worktree: 'CLEAN',
      requiredSurfaces: required.requiredSurfaces,
      requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
      surfaceResults: required.requiredSurfaces.map((surface) => ({
        surface,
        status: surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
      })),
      preflight,
    };
    assert.deepStrictEqual(runnerApi.validateReleaseEvidence({
      root,
      binding,
      required,
      expectedPreflight: preflight,
      payload,
    }), []);

    const incomplete = {
      ...payload,
      surfaceResults: payload.surfaceResults.map((row) => row.surface === 'agy-plugin' ? { ...row, status: 'UNAVAILABLE' } : row),
    };
    assert.match(runnerApi.validateReleaseEvidence({
      root,
      binding,
      required,
      expectedPreflight: preflight,
      payload: incomplete,
    }).join('; '), /agy-plugin.*PASS/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runner receipt creation is exclusive for a task and attempt', () => {
  const root = checkoutFixture();
  const receiptRoot = temporaryReceiptRoot();
  try {
    const first = invoke(root, receiptRoot, { PATH: '/usr/bin:/bin' });
    assert.strictEqual(first.status, 2, `${first.stdout}\n${first.stderr}`);
    const receiptFile = path.join(receiptRoot, 'issue-237-runtime-proof', 'runtime-proof-attempt', 'runtime-proof.json');
    const before = fs.readFileSync(receiptFile, 'utf8');
    const second = invoke(root, receiptRoot, { PATH: '/usr/bin:/bin' });
    assert.strictEqual(second.status, 2, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /refusing to overwrite|receipt/i);
    assert.strictEqual(fs.readFileSync(receiptFile, 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('runner invokes the public harness with real-probe opt-in only after preflight', () => {
  const root = checkoutFixture({ entrypoint: true });
  const receiptRoot = temporaryReceiptRoot();
  const binding = receipts.resolveGitBinding(root);
  const identity = {
    taskId: 'issue-237-runtime-proof',
    attemptId: 'runtime-proof-invoke',
    sourceCommit: binding.sourceCommit,
    sourceTree: binding.sourceTree,
    targetCommit: binding.sourceCommit,
    targetTree: binding.sourceTree,
    worktree: 'CLEAN',
    selectedSurfaces: [],
    requiredRuntimeSurfaces: [],
  };
  let captured = null;
  try {
    const child = runnerApi.invokeHarness(root, receiptRoot, identity, { PATH: '/usr/bin:/bin' }, (command, args, options) => {
      captured = { command, args, options };
      return { status: 0, stdout: '{}\n', stderr: '' };
    });
    assert.strictEqual(child.status, 0);
    assert.ok(captured);
    assert.strictEqual(captured.command, 'bash');
    assert.deepStrictEqual(captured.args.slice(1, 4), ['harness', 'release', '--json']);
    assert.strictEqual(captured.options.env.DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE, '1');
    assert.strictEqual(captured.options.env.DHPK_HARNESS_RECEIPT_ROOT, receiptRoot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('harness receipt validation rejects references outside the requested root', () => {
  const root = checkoutFixture();
  const receiptRoot = temporaryReceiptRoot();
  try {
    const binding = receipts.resolveGitBinding(root);
    const attempt = receipts.createAttempt({
      root: receiptRoot,
      command: 'harness release',
      phase: 'release',
      taskId: 'issue-237-runtime-proof',
      attemptId: 'runtime-proof-receipt',
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      identity: {
        targetCommit: binding.sourceCommit,
        targetTree: binding.sourceTree,
        worktree: 'CLEAN',
      },
      outcome: 'COMPLETE',
      lifecyclePhase: 'COMPLETE',
    });
    receipts.appendEvent(attempt, { outcome: 'COMPLETE', lifecyclePhase: 'COMPLETE' });
    assert.deepStrictEqual(runnerApi.validateHarnessReceipt(root, receiptRoot, {
      outcome: 'COMPLETE',
      receiptReference: attempt.path,
    }, binding), []);
    assert.match(runnerApi.validateHarnessReceipt(root, receiptRoot, {
      outcome: 'COMPLETE',
      receiptReference: path.join(os.tmpdir(), 'outside-runtime-proof-receipt'),
    }, binding).join('; '), /escapes.*receipt root/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

run('issue-237-runtime-proof');
