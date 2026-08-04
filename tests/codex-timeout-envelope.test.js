'use strict';

// Direct contract coverage for the shared timeout-envelope seam. The wrapper
// integration tests exercise the CLI boundary; these tests lock redaction,
// bounded diagnostic tails, and stable JSON/base64 fields in isolation.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const {
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_SCAN_BYTES,
  MAX_DIAGNOSTIC_B64_BYTES,
  MAX_REPORT_B64_BYTES,
  DIAGNOSTIC_OVERFLOW_MARKER,
  MAX_REPORT_BYTES,
  REPORT_OVERFLOW_MARKER,
  buildTimeoutEnvelope,
  decodePayload,
  parseTimeoutEnvelope,
} = require('../skills/codex-bridge/scripts/codex-timeout-envelope');

test('wrapper resolves the helper from the packaged codex-bridge skill directory', () => {
  const wrapper = fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'codex-bridge', 'scripts', 'run-codex.sh'),
    'utf8',
  );
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'skills', 'codex-bridge', 'scripts', 'codex-timeout-envelope.js')));
  assert.ok(wrapper.includes('TIMEOUT_ENVELOPE_HELPER="$SCRIPT_DIR/codex-timeout-envelope.js"'));
});

test('builds the versioned envelope with redacted report and bounded tails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-envelope-'));
  try {
    const report = path.join(dir, 'report.txt');
    const stderr = path.join(dir, 'stderr.log');
    const stdout = path.join(dir, 'stdout.log');
    fs.writeFileSync(report, 'token=secret-report\nline\n');
    fs.writeFileSync(stderr, 'password=secret-stderr\n');
    fs.writeFileSync(stdout, 'Bearer secret-stdout\n');
    const envelope = buildTimeoutEnvelope({
      budgetSecs: 360,
      elapsedSecs: 361,
      reportFile: report,
      stderrFile: stderr,
      stdoutFile: stdout,
    });
    assert.strictEqual(envelope.schema, 'dhpk.codex.timeout.v1');
    assert.strictEqual(envelope.status, 'TIMEOUT');
    assert.strictEqual(envelope.report_present, true);
    assert.strictEqual(envelope.report_encoding, 'base64');
    assert.strictEqual(envelope.stderr_tail_encoding, 'base64');
    assert.strictEqual(envelope.stdout_tail_encoding, 'base64');
    assert.strictEqual(parseTimeoutEnvelope(JSON.stringify(envelope)).schema, 'dhpk.codex.timeout.v1');
    assert.ok(decodePayload(envelope.report_b64).includes('[REDACTED]'));
    assert.ok(!decodePayload(envelope.report_b64).includes('secret-report'));
    assert.ok(!decodePayload(envelope.stderr_tail_b64).includes('secret-stderr'));
    assert.ok(!decodePayload(envelope.stdout_tail_b64).includes('secret-stdout'));
    assert.ok(Buffer.byteLength(decodePayload(envelope.stderr_tail_b64), 'utf8') <= MAX_DIAGNOSTIC_BYTES);
    assert.ok(Buffer.byteLength(decodePayload(envelope.stdout_tail_b64), 'utf8') <= MAX_DIAGNOSTIC_BYTES);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostic tails are capped before base64 framing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-envelope-cap-'));
  try {
    const report = path.join(dir, 'report.txt');
    const stderr = path.join(dir, 'stderr.log');
    const stdout = path.join(dir, 'stdout.log');
    fs.writeFileSync(report, 'report');
    fs.writeFileSync(stderr, 'x'.repeat(MAX_DIAGNOSTIC_SCAN_BYTES + 100));
    fs.writeFileSync(stdout, 'y'.repeat(MAX_DIAGNOSTIC_SCAN_BYTES + 100));
    const envelope = buildTimeoutEnvelope({
      budgetSecs: 2,
      elapsedSecs: 2,
      reportFile: report,
      stderrFile: stderr,
      stdoutFile: stdout,
    });
    assert.strictEqual(decodePayload(envelope.stderr_tail_b64), DIAGNOSTIC_OVERFLOW_MARKER);
    assert.strictEqual(decodePayload(envelope.stdout_tail_b64), DIAGNOSTIC_OVERFLOW_MARKER);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('redacts credentials before applying the diagnostic tail cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-envelope-boundary-'));
  try {
    const report = path.join(dir, 'report.txt');
    const stderr = path.join(dir, 'stderr.log');
    const stdout = path.join(dir, 'stdout.log');
    fs.writeFileSync(report, 'report');
    fs.writeFileSync(stderr, `${'x'.repeat(MAX_DIAGNOSTIC_BYTES - 4)}password=secret-boundary`);
    fs.writeFileSync(stdout, `${'y'.repeat(MAX_DIAGNOSTIC_BYTES - 4)}token=secret-boundary-stdout`);
    const envelope = buildTimeoutEnvelope({
      budgetSecs: 2,
      elapsedSecs: 2,
      reportFile: report,
      stderrFile: stderr,
      stdoutFile: stdout,
    });
    assert.ok(!decodePayload(envelope.stderr_tail_b64).includes('secret-boundary'));
    assert.ok(!decodePayload(envelope.stdout_tail_b64).includes('secret-boundary-stdout'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('redacts structured and standalone credential formats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-envelope-secrets-'));
  try {
    const report = path.join(dir, 'report.txt');
    const stderr = path.join(dir, 'stderr.log');
    const stdout = path.join(dir, 'stdout.log');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-secret';
    const compactJwt = 'eyJhbGciOiJIUzI1NiJ9.e30.abcdefghijklmnopqrstuvwxyzABCDE';
    const pem = '-----BEGIN PRIVATE KEY-----\nprivate-secret\n-----END PRIVATE KEY-----';
    fs.writeFileSync(report, [
      '{"password":"hunter2"}',
      '{"password":"hunter\\\"2"}',
      'passphrase=correct horse battery staple',
      'password: another whitespace-bearing secret',
      'Authorization: Basic dXNlcjpwYXNzd29yZA==',
      'Basic YTpi',
      'postgres://user:db-secret@db.example.test/app',
      'redis://:redis-secret@cache.example.test/0',
      jwt,
      compactJwt,
      pem,
      'AIza123456789012345678901234567890',
      'npm_123456789012345678901234',
    ].join('\n'));
    fs.writeFileSync(stderr, 'Cookie: session=secret-cookie');
    fs.writeFileSync(stdout, 'api_key: secret-api');
    const envelope = buildTimeoutEnvelope({
      budgetSecs: 2,
      elapsedSecs: 2,
      reportFile: report,
      stderrFile: stderr,
      stdoutFile: stdout,
      tempDir: dir,
    });
    const decoded = [envelope.report_b64, envelope.stderr_tail_b64, envelope.stdout_tail_b64]
      .map(decodePayload).join('\n');
    for (const secret of ['hunter2', 'hunter\\"2', 'correct horse battery staple', 'another whitespace-bearing secret', 'dXNlcjpwYXNzd29yZA==', 'YTpi', 'db-secret', 'redis-secret', 'signature-secret', 'abcdefghijklmnopqrstuvwxyzABCDE', 'private-secret', 'secret-cookie', 'secret-api', 'AIza123456789012345678901234567890', 'npm_123456789012345678901234']) {
      assert.ok(!decoded.includes(secret), `secret format bypassed redaction: ${secret}`);
    }
    assert.ok(decoded.includes('[REDACTED]') || decoded.includes('[REDACTED_JWT]'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('report input is capped before encoding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-envelope-report-cap-'));
  try {
    const report = path.join(dir, 'report.txt');
    const stderr = path.join(dir, 'stderr.log');
    const stdout = path.join(dir, 'stdout.log');
    fs.writeFileSync(report, `${'password=report-secret\n'.repeat(Math.ceil(MAX_REPORT_BYTES / 20))}tail`);
    fs.writeFileSync(stderr, 'stderr');
    fs.writeFileSync(stdout, 'stdout');
    const envelope = buildTimeoutEnvelope({ budgetSecs: 2, elapsedSecs: 2, reportFile: report, stderrFile: stderr, stdoutFile: stdout });
    const decoded = decodePayload(envelope.report_b64);
    assert.ok(Buffer.byteLength(decoded, 'utf8') <= MAX_REPORT_BYTES, 'report payload must stay bounded after redaction');
    assert.strictEqual(decoded, REPORT_OVERFLOW_MARKER, 'oversized reports must be omitted before redaction');
    assert.ok(!decoded.includes('report-secret'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('truncation-boundary credentials are omitted instead of leaking their suffix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-envelope-boundary-leak-'));
  try {
    const report = path.join(dir, 'report.txt');
    const stderr = path.join(dir, 'stderr.log');
    const stdout = path.join(dir, 'stdout.log');
    const prefix = 'x'.repeat(MAX_REPORT_BYTES - 'password='.length - 40);
    fs.writeFileSync(report, `${prefix}password=${' '.repeat(40)}exact-boundary-secret`);
    fs.writeFileSync(stderr, 'stderr');
    fs.writeFileSync(stdout, 'stdout');
    const envelope = buildTimeoutEnvelope({ budgetSecs: 2, elapsedSecs: 2, reportFile: report, stderrFile: stderr, stdoutFile: stdout });
    assert.strictEqual(decodePayload(envelope.report_b64), REPORT_OVERFLOW_MARKER);
    assert.ok(!decodePayload(envelope.report_b64).includes('exact-boundary-secret'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing report is represented by report_present=false and an empty payload', () => {
  const envelope = buildTimeoutEnvelope({
    budgetSecs: 2,
    elapsedSecs: 2,
    reportFile: '/tmp/does-not-exist-codex-report',
    stderrFile: '/tmp/does-not-exist-codex-stderr',
    stdoutFile: '/tmp/does-not-exist-codex-stdout',
  });
  assert.strictEqual(envelope.report_present, false);
  assert.strictEqual(envelope.report_b64, '');
  assert.strictEqual(decodePayload(envelope.report_b64), '');
});

test('parser rejects malformed, non-timeout, and drifted envelopes', () => {
  assert.strictEqual(parseTimeoutEnvelope('not-json'), null);
  assert.strictEqual(parseTimeoutEnvelope({ schema: 'other', status: 'TIMEOUT' }), null);
  const envelope = buildTimeoutEnvelope({
    budgetSecs: 2,
    elapsedSecs: 2,
    reportFile: '/tmp/does-not-exist-codex-report-2',
    stderrFile: '/tmp/does-not-exist-codex-stderr-2',
    stdoutFile: '/tmp/does-not-exist-codex-stdout-2',
  });
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, extra: true }), null);
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, exit_code: 0 }), null);
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, report_present: true, report_b64: '' }), null);
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, budget_secs: '2' }), null);
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, stderr_tail_b64: 'not base64!' }), null);
  const unavailable = {
    ...envelope,
    report_present: false,
    report_b64: '',
    stderr_tail_b64: '',
    stdout_tail_b64: '',
    redaction: 'unavailable',
  };
  assert.strictEqual(parseTimeoutEnvelope(unavailable).redaction, 'unavailable');
  assert.strictEqual(parseTimeoutEnvelope({ ...unavailable, report_b64: 'c2VjcmV0' }), null);
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, report_b64: 'A'.repeat(MAX_REPORT_B64_BYTES + 1) }), null);
  assert.strictEqual(parseTimeoutEnvelope({ ...envelope, stderr_tail_b64: 'A'.repeat(MAX_DIAGNOSTIC_B64_BYTES + 1) }), null);
});

run('codex-timeout-envelope');
