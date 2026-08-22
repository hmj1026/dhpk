'use strict';

// RED-first tests for harness-facade-receipt-contract task 1.2.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const receipts = require('../scripts/lib/harness-receipt');

const ROOT = path.join(__dirname, '..');

function temporaryReceiptRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-receipt-'));
}

test('creates an exact-checkout-bound attempt envelope and immutable event chain', () => {
  const root = temporaryReceiptRoot();
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    const attempt = receipts.createAttempt({
      root,
      command: 'harness preflight',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      sourceCommit,
      sourceTree: receipts.resolveGitTree(ROOT, sourceCommit),
    });
    assert.deepStrictEqual(attempt.envelope.diagnostics, []);
    assert.deepStrictEqual(attempt.envelope.artifacts, []);
    assert.strictEqual(attempt.envelope.resumeCommand, null);
    assert.deepStrictEqual(attempt.envelope.byteReferences, []);
    const first = receipts.appendEvent(attempt, {
      lifecyclePhase: 'PLANNED',
      outcome: 'PASS',
      planFingerprint: 'sha256:' + 'a'.repeat(64),
    });
    const second = receipts.appendEvent(attempt, {
      lifecyclePhase: 'VERIFIED',
      outcome: 'PASS',
      artifactFingerprint: 'sha256:' + 'b'.repeat(64),
    });
    assert.strictEqual(first.sequence, 1);
    assert.ok(Array.isArray(first.diagnostics));
    assert.ok(Array.isArray(first.artifacts));
    assert.strictEqual(first.resumeCommand, null);
    assert.ok(Array.isArray(first.byteReferences));
    assert.strictEqual(second.sequence, 2);
    assert.match(first.eventSha256, /^[a-f0-9]{64}$/);
    assert.match(first.chainSha256, /^[a-f0-9]{64}$/);
    assert.notStrictEqual(first.eventSha256, second.eventSha256);
    assert.strictEqual(receipts.validateReceipt(attempt.path).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a receipt event whose bytes or chain predecessor was rewritten', () => {
  const root = temporaryReceiptRoot();
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    const attempt = receipts.createAttempt({
      root,
      command: 'harness verify',
      taskId: 'task-2',
      attemptId: 'attempt-1',
      sourceCommit,
      sourceTree: receipts.resolveGitTree(ROOT, sourceCommit),
    });
    receipts.appendEvent(attempt, { lifecyclePhase: 'PLANNED', outcome: 'PASS' });
    const eventPath = path.join(attempt.path, 'events', '0001.json');
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    event.outcome = 'COMPLETE';
    fs.writeFileSync(eventPath, JSON.stringify(event, null, 2) + '\n');
    const result = receipts.validateReceipt(attempt.path);
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /digest|chain|event/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('redacts secrets before receipt values are persisted', () => {
  const marker = 'HARNESS_RECEIPT_SECRET_MARKER_123456789';
  const redacted = receipts.redact({ token: marker, diagnostics: `Authorization: Bearer ${marker}` });
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(marker));
  assert.match(JSON.stringify(redacted), /redacted/i);
});

run('harness-operation-receipts');
