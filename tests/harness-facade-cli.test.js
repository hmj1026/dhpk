'use strict';

// RED-first coverage for the public harness boundary (OpenSpec tasks 3.1,
// 3.2, and 3.4).  The assertions stay at the process boundary so the
// compatibility distribution command remains free to keep its own output.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const receipts = require('../scripts/lib/harness-receipt');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk');

function invoke(args, env = {}) {
  return spawnSync('bash', [CLI, 'harness', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, DHPK_BOUNDED_REQUIRE_CGROUP: '0', DHPK_BOUNDED_ALLOW_FALLBACK: '1', ...env },
  });
}

function temporaryReceiptRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-cli-receipts-'));
}

function parseSingleJson(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, 1, `expected one JSON line, got ${lines.length}: ${stdout}`);
  return JSON.parse(lines[0]);
}

test('dispatches every public phase and rejects unknown options before execution', () => {
  const phases = ['preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release'];
  for (const phase of phases) {
    const result = invoke([phase, '--help']);
    assert.strictEqual(result.status, 0, `${phase}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`dhpk harness ${phase}`));
  }

  const unknown = invoke(['preflight', '--unknown']);
  assert.strictEqual(unknown.status, 64);
  assert.match(unknown.stderr, /unknown|usage|option/i);
  assert.strictEqual(unknown.stdout.trim(), '');
});

test('test phase uses the bounded runner and emits one compact JSON result', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke([
      'test',
      '--test-file',
      'tests/harness-release-aggregation.test.js',
      '--task-id',
      'facade-cli-test',
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.phase, 'test');
    assert.strictEqual(payload.outcome, 'PASS');
    assert.strictEqual(payload.exitCode, 0);
    assert.ok(payload.receiptReference);
    assert.match(payload.resumeCommand, /bin\/dhpk harness test/);
    assert.strictEqual(result.stdout.includes('harness-release-aggregation:'), false);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('JSON and diagnostics are redacted and the receipt is linked to the result', () => {
  const receiptRoot = temporaryReceiptRoot();
  const marker = 'HARNESS_FACADE_SECRET_MARKER_123456789';
  try {
    const result = invoke([
      'preflight',
      '--diagnostic',
      `Authorization: Bearer ${marker}`,
      '--task-id',
      'facade-redaction-test',
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    const payload = parseSingleJson(result.stdout);
    assert.doesNotMatch(result.stdout, new RegExp(marker));
    assert.doesNotMatch(result.stderr, new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(marker));
    assert.ok(payload.receiptReference);
    assert.match(payload.resumeCommand, /--task-id facade-redaction-test/);
    const attemptFiles = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name === 'attempt.json' || /^\d{4}\.json$/.test(entry.name)) attemptFiles.push(file);
      }
    };
    walk(receiptRoot);
    assert.ok(attemptFiles.length >= 2, `receipt files missing under ${receiptRoot}`);
    for (const file of attemptFiles) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), new RegExp(marker));
    }
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('distribution evidence is identity-bound and revalidates package bytes', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke([
      'validate',
      '--surface',
      'agent-plugin',
      '--task-id',
      'facade-package-identity',
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'PASS');
    assert.match(JSON.stringify(payload.artifacts), /artifactFingerprint/);
    assert.match(JSON.stringify(payload.artifacts), /provenanceFingerprint/);
    const checked = receipts.validateReceipt(payload.receiptReference, {
      root: ROOT,
      expectedIdentity: { surface: 'agent-plugin', stage: 'structural', producer: 'distribution-adapter' },
    });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

run('harness-facade-cli');
