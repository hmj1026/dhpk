'use strict';

// RED-first coverage for the public harness boundary (OpenSpec tasks 3.1,
// 3.2, and 3.4).  The assertions stay at the process boundary so the
// compatibility distribution command remains free to keep its own output.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const receipts = require('../scripts/lib/harness-receipt');

const ROOT = path.join(__dirname, '..');

function invokeAt(root, args, env = {}) {
  return spawnSync('bash', [path.join(root, 'bin', 'dhpk'), 'harness', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, DHPK_BOUNDED_REQUIRE_CGROUP: '0', DHPK_BOUNDED_ALLOW_FALLBACK: '1', ...env },
  });
}

function invoke(args, env = {}) {
  return invokeAt(ROOT, args, env);
}

function temporaryReceiptRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-cli-receipts-'));
}

function parseSingleJson(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, 1, `expected one JSON line, got ${lines.length}: ${stdout}`);
  return JSON.parse(lines[0]);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function temporaryPackageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-package-fixture-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agent'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'harness-entry.js'), [
    "'use strict';",
    `const { execute } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'lib', 'harness'))});`,
    'const invocation = execute(process.argv.slice(2), { root: __dirname });',
    'if (invocation.help) process.stdout.write(invocation.help);',
    "else process.stdout.write(`${JSON.stringify(invocation.result || { phase: null, outcome: 'INTERNAL_ERROR' })}\\n`);",
    'process.exit(invocation.status);',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'bin', 'dhpk'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
    'case "${1:-}" in',
    '  harness) shift; exec node "$root/harness-entry.js" "$@" ;;',
    '  distribution) shift; printf \'{"surface":"agent-plugin","output":"%s"}\\n\' "$root/plugins/dhpk-agent" ;;',
    '  *) exit 64 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), JSON.stringify({
    planFingerprint: `sha256:${'1'.repeat(64)}`,
    sourceCommit: '0'.repeat(40),
  }) + '\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'harness-test@example.invalid']);
  git(root, ['config', 'user.name', 'Harness Test']);
  git(root, ['add', 'bin/dhpk', 'manifests/distribution-inventory.json', 'plugins/dhpk-agent/provenance.json']);
  git(root, ['commit', '-qm', 'fixture initial']);
  const initial = git(root, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), JSON.stringify({
    planFingerprint: `sha256:${'1'.repeat(64)}`,
    sourceCommit: initial,
  }) + '\n');
  git(root, ['add', 'plugins/dhpk-agent/provenance.json']);
  git(root, ['commit', '-qm', 'fixture current']);
  return root;
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

test('public distribution evidence refuses a retained package from an older checkout', () => {
  const root = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'validate',
      '--surface',
      'agent-plugin',
      '--task-id',
      'facade-package-identity',
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    assert.strictEqual(result.status, 2, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'NO_SHIP');
    assert.match(payload.diagnostics.join('\n'), /source commit does not match current checkout/i);
    assert.match(payload.diagnostics.join('\n'), /source tree does not match current checkout/i);
    assert.match(JSON.stringify(payload.artifacts), /artifactFingerprint/);
    assert.match(JSON.stringify(payload.artifacts), /provenanceFingerprint/);
    const checked = receipts.validateReceipt(payload.receiptReference, {
      root,
      expectedIdentity: { surface: 'agent-plugin', stage: 'structural', producer: 'distribution-adapter' },
    });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('harness-facade-cli');
