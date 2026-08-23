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
const harness = require('../scripts/lib/harness');

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
  git(root, ['add', 'bin/dhpk', 'harness-entry.js', 'manifests/distribution-inventory.json', 'plugins/dhpk-agent/provenance.json']);
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

function temporaryProbeFixture(payload) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-probe-fixture-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'dhpk-cursor', '.cursor-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'plugins', 'dhpk-cursor', '.cursor-plugin', 'plugin.json'), JSON.stringify({
    name: 'dhpk-cursor',
    version: '0.45.0',
  }) + '\n');
  fs.writeFileSync(path.join(root, 'scripts', 'release', 'consumer-platform-probe.js'), [
    "const fs = require('node:fs');",
    "const index = process.argv.indexOf('--package-root');",
    "const packageRoot = index === -1 ? null : process.argv[index + 1];",
    "const missing = !packageRoot || !fs.existsSync(packageRoot);",
    "const payload = missing ? { status: 'BLOCKED', reason: 'package manifest is missing', commands: [] } : JSON.parse(process.env.PROBE_PAYLOAD);",
    'process.stdout.write(JSON.stringify(payload));',
    'if (missing) process.exit(1);',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'harness-entry.js'), [
    "'use strict';",
    `const { execute } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'lib', 'harness'))});`,
    'const invocation = execute(process.argv.slice(2), { root: __dirname });',
    "process.stdout.write(`${JSON.stringify(invocation.result || { phase: null, outcome: 'INTERNAL_ERROR' })}\\n`);",
    'process.exit(invocation.status);',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'bin', 'dhpk'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
    'case "${1:-}" in',
    '  harness) shift; exec node "$root/harness-entry.js" "$@" ;;',
    '  *) exit 64 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, '.probe-payload.json'), JSON.stringify(payload));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'harness-test@example.invalid']);
  git(root, ['config', 'user.name', 'Harness Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'probe fixture']);
  return root;
}

function temporaryGateFixture(payload) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-gate-fixture-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'scripts', 'release', 'consumer-gate.js'), [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.GATE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));",
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`,
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'harness-entry.js'), [
    "'use strict';",
    `const { execute } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'lib', 'harness'))});`,
    'const invocation = execute(process.argv.slice(2), { root: __dirname });',
    "process.stdout.write(`${JSON.stringify(invocation.result || { phase: null, outcome: 'INTERNAL_ERROR' })}\\n`);",
    'process.exit(invocation.status);',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'bin', 'dhpk'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
    'case "${1:-}" in',
    '  harness) shift; exec node "$root/harness-entry.js" "$@" ;;',
    '  *) exit 64 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'harness-test@example.invalid']);
  git(root, ['config', 'user.name', 'Harness Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'gate fixture']);
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

test('public distribution evidence accepts a retained package from an ancestor checkout when adapter bytes pass', () => {
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
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'PASS');
    assert.strictEqual(payload.artifacts[0].generatedFromCommit.length, 40);
    assert.strictEqual(payload.artifacts[0].targetCommit, payload.sourceCommit);
    assert.strictEqual(payload.artifacts[0].targetTree, payload.sourceTree);
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

test('package provenance keeps generated-input identity separate from final target receipt identity', () => {
  const root = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'validate',
      '--surface',
      'agent-plugin',
      '--task-id',
      'facade-generated-input-identity',
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'PASS');
    assert.strictEqual(payload.artifacts[0].generatedFromCommit.length, 40);
    assert.strictEqual(payload.artifacts[0].targetCommit, payload.sourceCommit);
    assert.strictEqual(payload.artifacts[0].targetTree, payload.sourceTree);
    const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(attempt.targetCommit, payload.sourceCommit);
    assert.strictEqual(attempt.targetTree, payload.sourceTree);
    assert.strictEqual(attempt.generatedFromCommit, payload.artifacts[0].generatedFromCommit);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release JSON preserves every required surface result at the public boundary', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['release', '--task-id', 'facade-release-surfaces', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.strictEqual(result.status, 2, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.deepStrictEqual(payload.requiredSurfaces, [
      'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
      'cursor-plugin', 'agent-plugin', 'agy-plugin',
    ]);
    assert.strictEqual(payload.surfaceResults.length, 7);
    assert.deepStrictEqual(
      payload.surfaceResults.map((entry) => entry.surface),
      payload.requiredSurfaces,
    );
    assert.strictEqual(payload.outcome, 'PUBLISHED_PENDING');
    assert.strictEqual(payload.exitCode, 2);
    const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
    const event = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'events', '0001.json'), 'utf8'));
    assert.strictEqual(attempt.outcome, payload.outcome);
    assert.strictEqual(attempt.artifacts.length, 7);
    assert.strictEqual(event.artifacts.length, 7);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('clean aggregate receipt keeps terminal lifecycle COMPLETE and target identity', () => {
  const receiptRoot = temporaryReceiptRoot();
  const fixtureRoot = temporaryPackageFixture();
  const requiredSurfaces = [
    'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
    'cursor-plugin', 'agent-plugin', 'agy-plugin',
  ];
  try {
    const invocation = harness.execute(['release', '--task-id', 'facade-complete-receipt', '--json'], {
      root: fixtureRoot,
      env: { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot },
      phaseExecutor: () => ({
        outcome: 'COMPLETE',
        requiredSurfaces,
        surfaceResults: requiredSurfaces.map((surface) => ({ surface, status: 'PASS' })),
      }),
    });
    assert.strictEqual(invocation.status, 0);
    const payload = invocation.result;
    assert.strictEqual(payload.outcome, 'COMPLETE');
    const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
    const event = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'events', '0001.json'), 'utf8'));
    assert.strictEqual(attempt.lifecyclePhase, 'COMPLETE');
    assert.strictEqual(attempt.outcome, 'COMPLETE');
    assert.strictEqual(attempt.worktree, 'CLEAN');
    assert.strictEqual(attempt.targetCommit, payload.targetCommit);
    assert.strictEqual(attempt.targetTree, payload.targetTree);
    assert.strictEqual(event.lifecyclePhase, 'COMPLETE');
    assert.strictEqual(event.outcome, 'COMPLETE');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dirty aggregate receipt cannot promote COMPLETE or omit target identity', () => {
  const receiptRoot = temporaryReceiptRoot();
  const fixtureRoot = temporaryPackageFixture();
  fs.appendFileSync(path.join(fixtureRoot, 'manifests', 'distribution-inventory.json'), '\n');
  try {
    const invocation = harness.execute(['release', '--task-id', 'facade-dirty-complete', '--json'], {
      root: fixtureRoot,
      env: { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot },
      phaseExecutor: () => ({
        outcome: 'COMPLETE',
        requiredSurfaces: [
          'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
          'cursor-plugin', 'agent-plugin', 'agy-plugin',
        ],
        surfaceResults: [
          'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
          'cursor-plugin', 'agent-plugin', 'agy-plugin',
        ].map((surface) => ({ surface, status: 'PASS' })),
      }),
    });
    assert.strictEqual(invocation.status, 2);
    assert.strictEqual(invocation.result.outcome, 'NO_SHIP');
    assert.strictEqual(invocation.result.worktree, 'DIRTY');
    const attempt = JSON.parse(fs.readFileSync(path.join(invocation.result.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(attempt.worktree, 'DIRTY');
    assert.strictEqual(attempt.targetCommit, invocation.result.targetCommit);
    assert.strictEqual(attempt.targetTree, invocation.result.targetTree);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('probe JSON preserves a consumer surface row when its runtime is unavailable', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['probe', '--surface', 'cursor-plugin', '--task-id', 'facade-cursor-probe', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.strictEqual(result.status, 2, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'UNAVAILABLE');
    assert.strictEqual(payload.surfaceResults.length, 1);
    assert.strictEqual(payload.surfaceResults[0].surface, 'cursor-plugin');
    assert.strictEqual(payload.surfaceResults[0].status, 'UNAVAILABLE');
    assert.strictEqual(payload.surfaceResults[0].stage, 'CONSUMER');
    assert.match(JSON.stringify(payload.surfaceResults[0]), /Cursor|loader|unavailable/i);
    assert.ok(payload.receiptReference);
    const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(attempt.surface, 'cursor-plugin');
    assert.strictEqual(attempt.stage, 'CONSUMER');
    assert.strictEqual(attempt.producer, 'consumer-platform-probe');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('probe facade preserves BLOCKED status for a missing package producer result', () => {
  const root = temporaryProbeFixture({ status: 'PASS' });
  const receiptRoot = temporaryReceiptRoot();
  try {
    fs.rmSync(path.join(root, 'plugins', 'dhpk-cursor'), { recursive: true, force: true });
    const result = invokeAt(root, [
      'probe',
      '--surface',
      'cursor-plugin',
      '--task-id',
      'facade-missing-package',
      '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      PROBE_PAYLOAD: JSON.stringify({ status: 'PASS' }),
    });
    assert.strictEqual(result.status, 2, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults.length, 1);
    assert.strictEqual(payload.surfaceResults[0].status, 'BLOCKED');
    assert.match(payload.diagnostics.join('\n'), /package manifest is missing/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('probe facade fails closed for malformed or ambiguous producer evidence', () => {
  const cases = [
    {
      payload: {
        status: 'PASS',
        surfaceResults: [
          { surface: 'cursor-plugin', status: 'PASS', environment: 'local' },
          { surface: 'cursor-plugin', status: 'FAIL', environment: 'local' },
        ],
      },
      diagnostic: /exactly one surface result/i,
    },
    {
      payload: {
        status: 'UNAVAILABLE',
        surfaceResults: [{ surface: 'cursor-plugin', status: 'UNAVAILABLE', stage: 'PACKAGE', environment: 'local' }],
      },
      diagnostic: /evidence is invalid|stage/i,
    },
    {
      payload: {
        status: 'PASS',
        surfaceResults: [{
          surface: 'cursor-plugin',
          status: 'PASS',
          environment: 'local',
          planFingerprint: `sha256:${'1'.repeat(64)}`,
        }],
      },
      diagnostic: /evidence is invalid|artifact binding/i,
    },
  ];
  for (const fixture of cases) {
    const root = temporaryProbeFixture(fixture.payload);
    const receiptRoot = temporaryReceiptRoot();
    try {
      const result = invokeAt(root, [
        'probe',
        '--surface',
        'cursor-plugin',
        '--task-id',
        'facade-malformed-probe',
        '--json',
      ], {
        DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
        PROBE_PAYLOAD: JSON.stringify(fixture.payload),
      });
      assert.strictEqual(result.status, 1, result.stderr);
      const payload = parseSingleJson(result.stdout);
      assert.strictEqual(payload.outcome, 'FAIL');
      assert.strictEqual(payload.surfaceResults.length, 1);
      assert.strictEqual(payload.surfaceResults[0].status, 'FAIL');
      assert.match(payload.diagnostics.join('\n'), fixture.diagnostic);
    } finally {
      fs.rmSync(receiptRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('probe facade delegates configured sync surfaces to the canonical consumer gate', () => {
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  const root = temporaryGateFixture({
    surfaceResults: [{
      surface: 'codex-sync',
      status: 'PASS',
      stage: 'CONSUMER',
      adapter: { id: 'codex-sync-installer', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
    }],
  });
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, ['probe', '--surface', 'codex-sync', '--task-id', 'facade-codex-sync-probe', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_ARGS_FILE: gateArgsFile,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.surfaceResults.length, 1);
    assert.strictEqual(payload.surfaceResults[0].surface, 'codex-sync');
    assert.strictEqual(payload.surfaceResults[0].stage, 'CONSUMER');
    assert.strictEqual(payload.surfaceResults[0].producer, 'consumer-gate');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(gateArgsFile, 'utf8')), [
      '--repo-root', root,
      '--surface', 'codex-sync',
    ]);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade preserves AGY runtime evidence from the multi-AI validator', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['probe', '--surface', 'agy-plugin', '--task-id', 'facade-agy-probe', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.notStrictEqual(result.status, 64, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.surfaceResults.length, 1);
    assert.strictEqual(payload.surfaceResults[0].surface, 'agy-plugin');
    assert.strictEqual(payload.surfaceResults[0].stage, 'CONSUMER');
    assert.strictEqual(payload.surfaceResults[0].producer, 'multi-ai-sync');
    assert.ok(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_CONFIGURED', 'UNAVAILABLE', 'SKIP_INCOMPATIBLE'].includes(payload.surfaceResults[0].status));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('probe facade does not trust CI=false as permission for shared consumer probes', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['probe', '--surface', 'claude-core', '--task-id', 'facade-ci-false-probe', '--json'], {
      CI: 'false',
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '',
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.strictEqual(result.status, 2, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'NOT_CONFIGURED');
    assert.match(payload.diagnostics.join('\n'), /opt-in|isolated|CI/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

run('harness-facade-cli');
