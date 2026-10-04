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
const NODE_BASH_ONLY_PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;
// scripts/lib/harness.js gives each consumer-gate child 120s. Release walks
// every required surface sequentially, so the outer spawn must outlive that
// cap instead of reporting status null on ETIMEDOUT.
const RELEASE_INVOKE_TIMEOUT_MS = 150_000;

function invokeAt(root, args, env = {}, timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS) {
  return spawnSync('bash', [path.join(root, 'bin', 'dhpk'), 'harness', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, DHPK_BOUNDED_REQUIRE_CGROUP: '0', DHPK_BOUNDED_ALLOW_FALLBACK: '1', ...env },
  });
}

function invoke(args, env = {}, timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS) {
  return invokeAt(ROOT, args, env, timeoutMs);
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

function temporaryPackageFixture({ mutateDistribution = false } = {}) {
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
    `  distribution) shift; ${mutateDistribution ? 'printf \'\\n\' >> "$root/plugins/dhpk-agent/provenance.json"; ' : ''}printf \'{"surface":"agent-plugin","output":"%s"}\\n\' "$root/plugins/dhpk-agent" ;;`,
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

function temporaryProbeFixture(payload, platform = 'cursor') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-probe-fixture-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  const packageRoot = platform === 'agent'
    ? path.join(root, 'plugins', 'dhpk-agent')
    : path.join(root, 'plugins', 'dhpk-cursor', '.cursor-plugin');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), '{}\n');
  fs.writeFileSync(path.join(packageRoot, 'plugin.json'), JSON.stringify({
    name: platform === 'agent' ? 'dhpk-agent' : 'dhpk-cursor',
    version: '0.45.0',
  }) + '\n');
  fs.writeFileSync(path.join(root, 'scripts', 'release', 'consumer-platform-probe.js'), [
    "const fs = require('node:fs');",
    "const index = process.argv.indexOf('--package-root');",
    "const packageRoot = index === -1 ? null : process.argv[index + 1];",
    "const missing = !packageRoot || !fs.existsSync(packageRoot);",
    "const configured = process.argv.includes('--execute');",
    "const source = missing ? { status: 'BLOCKED', reason: 'package manifest is missing', commands: [] } : JSON.parse(process.env.PROBE_PAYLOAD);",
    "const payload = !missing && process.env.REQUIRE_EXECUTE === '1' && !configured ? { ...source, status: 'NOT_RUN', surfaceResults: (source.surfaceResults || []).map((entry) => ({ ...entry, status: 'NOT_RUN', reasons: ['execute required'] })) } : source;",
    'process.stdout.write(JSON.stringify(payload));',
    "if (payload && payload.verdict) process.exit(['FAIL', 'BLOCKED'].includes(payload.verdict) ? 1 : 0);",
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

function temporaryGateFixture(payload, inventory = '{}\n', markerPaths = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-gate-fixture-')));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'release'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), inventory);
  for (const relative of markerPaths) {
    const source = path.join(ROOT, relative);
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'scripts', 'release', 'consumer-gate.js'), [
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    `const fixturePayload = ${JSON.stringify(payload)};`,
    "if (process.env.MUTATE_REQUIREMENTS_SOURCE_FILE) fs.writeFileSync(process.env.MUTATE_REQUIREMENTS_SOURCE_FILE, '{\"schema\":\"dhpk.consumer-requirements.v1\",\"selectedSurfaces\":[\"agy-plugin\"],\"checks\":[]}\\n');",
    "const surfaceIndex = args.indexOf('--surface');",
    "const selectedSurface = surfaceIndex === -1 ? null : args[surfaceIndex + 1];",
    'const payload = fixturePayload && fixturePayload.bySurface && selectedSurface',
    '  ? fixturePayload.bySurface[selectedSurface]',
    '  : fixturePayload;',
    'fs.writeFileSync(process.env.GATE_ARGS_FILE, JSON.stringify(args));',
    'if (process.env.GATE_CALLS_FILE) {',
    "  const index = args.indexOf('--requirements');",
    "  const requirementsText = index === -1 ? null : fs.readFileSync(args[index + 1], 'utf8');",
    "  const requirements = index === -1 ? null : JSON.parse(fs.readFileSync(args[index + 1], 'utf8'));",
    '  fs.appendFileSync(process.env.GATE_CALLS_FILE, `${JSON.stringify({ args, requirements, requirementsText })}\\n`);',
    '}',
    'process.stdout.write(JSON.stringify(payload));',
    "const verdict = payload && payload.acceptance && payload.acceptance.verdict;",
    "if (process.env.GATE_EXIT_BY_VERDICT === '1' && verdict) process.exitCode = ['FAIL', 'BLOCKED'].includes(verdict) ? 1 : 0;",
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

function restrictedClaudeGateEvidence({ additionalRows = [], additionalChecks = [], additionalExclusions = [] } = {}) {
  const reason = 'Claude installation was restricted because it may write a shared cache.';
  return {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'BLOCKED',
    acceptance: {
      verdict: 'BLOCKED',
      requiredChecks: [{
        id: 'install.claude',
        surface: 'claude',
        kind: 'installation',
        reason,
        status: 'BLOCKED',
        evidenceRef: 'surfaceResults.claude.installationEvidence',
      }, ...additionalChecks],
      excludedChecks: [{
        id: 'runtime.claude',
        surface: 'claude',
        kind: 'native',
        reason: 'Claude runtime was not executed.',
        status: 'NOT_RUN',
        evidenceRef: 'surfaceResults.claude.runtimeEvidence',
      }, ...additionalExclusions],
    },
    surfaceResults: [{
      surface: 'claude',
      producerSurface: 'claude',
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: 'claude-plugin-cli', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [reason],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'BLOCKED', reason },
      runtimeEvidence: { status: 'NOT_RUN', reason: 'Claude runtime was not executed.' },
    }, ...additionalRows],
  };
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
      'tests/harness-facade-contract.test.js',
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
    assert.strictEqual(result.stdout.includes('harness-facade-contract:'), false);
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

test('cross-phase receipt handoff is validated and operation keys replay the original attempt', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  let executions = 0;
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  try {
    const planned = harness.execute(['plan', '--task-id', 'handoff-task', '--operation-key', 'handoff-plan', '--json'], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'PASS', requiredSurfaces: ['claude-core'] };
      },
    });
    assert.strictEqual(planned.status, 0);
    assert.strictEqual(executions, 1);
    const plannedAttempt = JSON.parse(fs.readFileSync(path.join(planned.result.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(plannedAttempt.operationKey, 'handoff-plan');
    assert.strictEqual(plannedAttempt.idempotencyKey, 'handoff-plan');

    const verified = harness.execute([
      'verify', '--surface', 'agent-plugin', '--task-id', 'handoff-task',
      '--previous-receipt', planned.result.receiptReference,
      '--operation-key', 'handoff-verify', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'PASS', identity: { surface: 'agent-plugin', stage: 'structural' } };
      },
    });
    assert.strictEqual(verified.status, 0);
    assert.strictEqual(executions, 2);
    const verifiedAttempt = JSON.parse(fs.readFileSync(path.join(verified.result.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(verifiedAttempt.previousReceipt.taskId, 'handoff-task');
    assert.strictEqual(verifiedAttempt.previousReceipt.attemptId, plannedAttempt.attemptId);
    assert.strictEqual(verifiedAttempt.previousReceipt.phase, 'plan');
    assert.strictEqual(verifiedAttempt.previousReceipt.outcome, 'PASS');

    const replay = harness.execute([
      'verify', '--surface', 'agent-plugin', '--task-id', 'handoff-task',
      '--operation-key', 'handoff-verify', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'FAIL' };
      },
    });
    assert.strictEqual(replay.status, 0);
    assert.strictEqual(replay.result.receiptReference, verified.result.receiptReference);
    assert.strictEqual(executions, 2, 'idempotent replay must not rerun the phase');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('receipt handoff mismatches are BLOCKED instead of internal failures', () => {
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  try {
    const planned = harness.execute(['plan', '--task-id', 'handoff-owner', '--json'], {
      root: ROOT,
      env,
      phaseExecutor: () => ({ outcome: 'PASS' }),
    });
    assert.strictEqual(planned.status, 0);
    const blocked = harness.execute([
      'verify', '--surface', 'agent-plugin', '--task-id', 'different-task',
      '--previous-receipt', planned.result.receiptReference, '--json',
    ], {
      root: ROOT,
      env,
      phaseExecutor: () => { throw new Error('phase executor must not run'); },
    });
    assert.strictEqual(blocked.status, 2);
    assert.strictEqual(blocked.result.outcome, 'BLOCKED');
    assert.strictEqual(blocked.result.internalError, undefined);
    assert.match(blocked.result.diagnostics.join(' '), /belongs to task/i);
  } finally { fs.rmSync(receiptRoot, { recursive: true, force: true }); }
});

test('cross-phase handoff enforces predecessor order, eligible outcome, and surface scope', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  try {
    const failedPlan = harness.execute(['plan', '--task-id', 'handoff-contract', '--attempt-id', 'failed-plan', '--json'], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => ({ outcome: 'FAIL' }),
    });
    assert.strictEqual(failedPlan.status, 1);
    const failedOutcome = harness.execute([
      'generate', '--surface', 'agent-plugin', '--task-id', 'handoff-contract',
      '--previous-receipt', failedPlan.result.receiptReference, '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => { throw new Error('ineligible handoff must not execute'); },
    });
    assert.strictEqual(failedOutcome.status, 2);
    assert.match(failedOutcome.result.diagnostics.join(' '), /outcome|pass|eligible/i);

    const verify = harness.execute(['verify', '--surface', 'agent-plugin', '--task-id', 'handoff-contract', '--attempt-id', 'verify-attempt', '--json'], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => ({ outcome: 'PASS', identity: { surface: 'agent-plugin', planFingerprint: `sha256:${'a'.repeat(64)}` } }),
    });
    assert.strictEqual(verify.status, 0);
    const wrongOrder = harness.execute([
      'generate', '--surface', 'cursor-plugin', '--task-id', 'handoff-contract',
      '--previous-receipt', verify.result.receiptReference, '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => { throw new Error('wrong-order handoff must not execute'); },
    });
    assert.strictEqual(wrongOrder.status, 2);
    assert.match(wrongOrder.result.diagnostics.join(' '), /phase|order|prior/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('idempotent replay preserves release evidence and rejects a phase mismatch', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const requiredSurfaces = [
    'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
    'cursor-plugin', 'agent-plugin', 'agy-plugin',
  ];
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  const phaseExecutor = () => {
    executions += 1;
    return {
      outcome: 'PASS',
      requiredSurfaces,
      surfaceResults: requiredSurfaces.map((surface) => ({ surface, status: 'PASS' })),
    };
  };
  try {
    const first = harness.execute(['release', '--task-id', 'replay-shape', '--operation-key', 'replay-shape-key', '--json'], {
      root: fixtureRoot, env, phaseExecutor,
    });
    assert.strictEqual(first.status, 0);
    const replay = harness.execute(['release', '--task-id', 'replay-shape', '--operation-key', 'replay-shape-key', '--json'], {
      root: fixtureRoot, env, phaseExecutor: () => { throw new Error('replay must not execute the phase'); },
    });
    assert.strictEqual(replay.status, 0);
    assert.strictEqual(replay.result.phase, 'release');
    assert.deepStrictEqual(replay.result.requiredSurfaces, first.result.requiredSurfaces);
    assert.deepStrictEqual(replay.result.surfaceResults, first.result.surfaceResults);
    assert.strictEqual(executions, 1);

    const wrongPhase = harness.execute(['plan', '--task-id', 'replay-shape', '--operation-key', 'replay-shape-key', '--json'], {
      root: fixtureRoot, env, phaseExecutor: () => { throw new Error('phase mismatch must not execute'); },
    });
    assert.strictEqual(wrongPhase.status, 2);
    assert.strictEqual(wrongPhase.result.outcome, 'BLOCKED');
    assert.match(wrongPhase.result.diagnostics.join(' '), /phase/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('operation claims are reserved before a conflicting phase can execute', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  try {
    receipts.reserveOperationKey(receiptRoot, 'reserved-before-execution', {
      taskId: 'owner-task',
      attemptId: 'owner-attempt',
    });
    const blocked = harness.execute([
      'release', '--task-id', 'other-task', '--attempt-id', 'other-attempt',
      '--operation-key', 'reserved-before-execution', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'PASS' };
      },
    });
    assert.strictEqual(blocked.status, 2);
    assert.strictEqual(blocked.result.outcome, 'BLOCKED');
    assert.strictEqual(executions, 0, 'a conflicting operation must be blocked before phase execution');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('operation reservations are exclusive even when public task and attempt IDs repeat', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  try {
    receipts.reserveOperationKey(receiptRoot, 'same-public-identity', {
      taskId: 'same-task',
      attemptId: 'same-attempt',
    });
    const blocked = harness.execute([
      'release', '--task-id', 'same-task', '--attempt-id', 'same-attempt',
      '--operation-key', 'same-public-identity', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'PASS' };
      },
    });
    assert.strictEqual(blocked.status, 2);
    assert.strictEqual(blocked.result.outcome, 'BLOCKED');
    assert.strictEqual(executions, 0);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('operation replay rejects a different surface intent', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  try {
    const first = harness.execute([
      'verify', '--surface', 'agent-plugin', '--task-id', 'surface-replay',
      '--operation-key', 'surface-replay-key', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'PASS', identity: { surface: 'agent-plugin' } };
      },
    });
    assert.strictEqual(first.status, 0);
    const blocked = harness.execute([
      'verify', '--surface', 'cursor-plugin', '--task-id', 'surface-replay',
      '--operation-key', 'surface-replay-key', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'FAIL' };
      },
    });
    assert.strictEqual(blocked.status, 2);
    assert.strictEqual(blocked.result.outcome, 'BLOCKED');
    assert.strictEqual(executions, 1);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('operation replay binds requirements bytes and plural surface scope', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const requirementsFile = path.join(os.tmpdir(), `dhpk-replay-requirements-${process.pid}-${Date.now()}.json`);
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  const phaseExecutor = (_root, parsed) => {
    executions += 1;
    const selected = parsed.surfaces || ['codex-sync'];
    return {
      outcome: 'COMPLETE',
      requiredSurfaces: selected,
      requiredRuntimeSurfaces: [],
      surfaceResults: selected.map((surface) => ({ surface, status: 'NOT_RUN' })),
    };
  };
  const requirement = (surface, id) => ({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: [surface],
    checks: [{
      id,
      surface,
      host: surface === 'agy-plugin' ? 'agy' : (surface === 'codex-native' ? 'codex' : 'codex'),
      capability: 'plugin-install',
      trigger: 'new-host',
      reason: `Verify ${surface} installation.`,
      question: `Does ${surface} installation satisfy the contract?`,
      evidenceKind: 'contract',
      authorization: { authorized: false },
    }],
  });
  try {
    fs.writeFileSync(requirementsFile, `${JSON.stringify(requirement('codex-sync', 'codex-contract'))}\n`);
    const firstRequirements = harness.execute([
      'release', '--requirements', requirementsFile, '--task-id', 'replay-requirements',
      '--operation-key', 'replay-requirements-key', '--json',
    ], { root: fixtureRoot, env, phaseExecutor });
    assert.strictEqual(firstRequirements.status, 0);

    fs.writeFileSync(requirementsFile, `${JSON.stringify(requirement('agy-plugin', 'agy-native-contract'))}\n`);
    const changedRequirements = harness.execute([
      'release', '--requirements', requirementsFile, '--task-id', 'replay-requirements',
      '--operation-key', 'replay-requirements-key', '--json',
    ], { root: fixtureRoot, env, phaseExecutor: () => { throw new Error('changed requirements must not replay'); } });
    assert.strictEqual(changedRequirements.status, 2);
    assert.strictEqual(changedRequirements.result.outcome, 'BLOCKED');
    assert.match(changedRequirements.result.diagnostics.join(' '), /intent|requirements|scope/i);
    assert.strictEqual(executions, 1);

    const firstSurfaces = harness.execute([
      'release', '--surfaces', 'codex-sync', '--task-id', 'replay-surfaces',
      '--operation-key', 'replay-surfaces-key', '--json',
    ], { root: fixtureRoot, env, phaseExecutor });
    assert.strictEqual(firstSurfaces.status, 0);
    const changedSurfaces = harness.execute([
      'release', '--surfaces', 'cursor-sync', '--task-id', 'replay-surfaces',
      '--operation-key', 'replay-surfaces-key', '--json',
    ], { root: fixtureRoot, env, phaseExecutor: () => { throw new Error('changed surface scope must not replay'); } });
    assert.strictEqual(changedSurfaces.status, 2);
    assert.strictEqual(changedSurfaces.result.outcome, 'BLOCKED');
    assert.match(changedSurfaces.result.diagnostics.join(' '), /intent|scope/i);
    assert.strictEqual(executions, 2);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(requirementsFile, { force: true });
  }
});

test('operation replay rejects an incomplete receipt envelope', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  try {
    const sourceCommit = git(fixtureRoot, ['rev-parse', 'HEAD']).trim();
    receipts.createAttempt({
      root: receiptRoot,
      command: 'harness release --operation-key incomplete-replay',
      phase: 'release',
      taskId: 'incomplete-replay',
      attemptId: 'attempt-1',
      sourceCommit,
      sourceTree: receipts.resolveGitTree(fixtureRoot, sourceCommit),
      targetCommit: sourceCommit,
      targetTree: receipts.resolveGitTree(fixtureRoot, sourceCommit),
      worktree: 'CLEAN',
      operationKey: 'incomplete-replay',
      identity: { operationIntent: { phase: 'release', surface: null, testFile: null } },
      outcome: 'PASS',
      lifecyclePhase: 'VERIFIED',
    });
    const blocked = harness.execute([
      'release', '--task-id', 'incomplete-replay', '--operation-key', 'incomplete-replay', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'FAIL' };
      },
    });
    assert.strictEqual(blocked.status, 2);
    assert.strictEqual(blocked.result.outcome, 'BLOCKED');
    assert.strictEqual(executions, 0);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('dirty operation receipts cannot be replayed as exact checkout evidence', () => {
  const fixtureRoot = temporaryPackageFixture();
  const receiptRoot = temporaryReceiptRoot();
  const env = { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot };
  let executions = 0;
  try {
    fs.writeFileSync(path.join(fixtureRoot, 'dirty.txt'), 'dirty bytes\n');
    const first = harness.execute([
      'release', '--task-id', 'dirty-replay', '--operation-key', 'dirty-replay-key', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'PASS' };
      },
    });
    assert.strictEqual(first.status, 0);
    assert.strictEqual(first.result.worktree, 'DIRTY');
    const replay = harness.execute([
      'release', '--task-id', 'dirty-replay', '--operation-key', 'dirty-replay-key', '--json',
    ], {
      root: fixtureRoot,
      env,
      phaseExecutor: () => {
        executions += 1;
        return { outcome: 'FAIL' };
      },
    });
    assert.strictEqual(replay.status, 2);
    assert.strictEqual(replay.result.outcome, 'BLOCKED');
    assert.strictEqual(executions, 1);
    assert.match(replay.result.diagnostics.join(' '), /clean|dirty|exact/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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

test('generation records post-generation DIRTY binding and blocks a previous-receipt handoff', () => {
  const root = temporaryPackageFixture({ mutateDistribution: true });
  const receiptRoot = temporaryReceiptRoot();
  const provenancePath = path.join(root, 'plugins', 'dhpk-agent', 'provenance.json');
  const cleanProvenance = fs.readFileSync(provenancePath, 'utf8');
  try {
    const generated = invokeAt(root, [
      'generate',
      '--surface',
      'agent-plugin',
      '--task-id',
      'facade-post-generation-dirty',
      '--attempt-id',
      'generate-attempt',
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    assert.strictEqual(generated.status, 0, generated.stderr);
    const generatedPayload = parseSingleJson(generated.stdout);
    assert.strictEqual(generatedPayload.outcome, 'PASS');
    assert.strictEqual(generatedPayload.worktree, 'DIRTY');
    const generatedAttempt = JSON.parse(fs.readFileSync(path.join(generatedPayload.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(generatedAttempt.worktree, 'DIRTY');

    fs.writeFileSync(provenancePath, cleanProvenance);
    const handoff = invokeAt(root, [
      'verify',
      '--surface',
      'agent-plugin',
      '--task-id',
      'facade-post-generation-dirty',
      '--previous-receipt',
      generatedPayload.receiptReference,
      '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot });
    assert.strictEqual(handoff.status, 2);
    const handoffPayload = parseSingleJson(handoff.stdout);
    assert.strictEqual(handoffPayload.outcome, 'BLOCKED');
    assert.match(handoffPayload.diagnostics.join(' '), /clean|dirty|worktree/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release JSON preserves the gate-configured acceptance scope at the public boundary', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['release', '--task-id', 'facade-release-surfaces', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      PATH: NODE_BASH_ONLY_PATH,
    }, RELEASE_INVOKE_TIMEOUT_MS);
    const payload = parseSingleJson(result.stdout);
    assert.ok(['dhpk.harness.result.v1', 'dhpk.harness.result.v2'].includes(payload.schema));
    assert.strictEqual(result.status, payload.exitCode);
    if (payload.acceptance) {
      const selectedByGate = payload.acceptance.requiredChecks
        .filter((check) => check.id.startsWith('install.'))
        .map((check) => check.surface);
      assert.deepStrictEqual([...payload.requiredSurfaces].sort(), [...selectedByGate].sort());
    } else {
      assert.strictEqual(payload.outcome, 'PUBLISHED_UNHEALTHY');
      assert.match(payload.diagnostics.join('\n'), /configured consumer evidence failed closed/i);
      assert.deepStrictEqual(
        payload.surfaceResults.map((entry) => entry.surface).sort(),
        [...payload.requiredSurfaces].sort(),
      );
    }
    assert.ok(payload.requiredSurfaces.length < 7, 'the configured scope should not be inferred from the inventory');
    assert.ok(payload.requiredRuntimeSurfaces.every((surface) => payload.requiredSurfaces.includes(surface)));
    assert.strictEqual(payload.surfaceResults.length, payload.requiredSurfaces.length);
    assert.deepStrictEqual(
      payload.surfaceResults.map((entry) => entry.surface).sort(),
      [...payload.requiredSurfaces].sort(),
    );
    assert.ok(payload.surfaceResults.every((entry) => entry.stage === 'CONSUMER'));
    assert.ok(payload.surfaceResults.every((entry) => typeof entry.producer === 'string' && entry.producer.length > 0));
    const cursorSync = payload.surfaceResults.find((entry) => entry.surface === 'cursor-sync');
    assert.strictEqual(cursorSync.status, 'NOT_RUN', JSON.stringify(cursorSync));
    assert.strictEqual(cursorSync.producer, 'consumer-gate');
    assert.strictEqual(cursorSync.adapter.id, 'cursor-sync-installer');
    assert.strictEqual(result.status, payload.exitCode);
    const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
    const event = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'events', '0001.json'), 'utf8'));
    assert.strictEqual(attempt.outcome, payload.outcome);
    assert.deepStrictEqual(attempt.requiredRuntimeSurfaces, payload.requiredRuntimeSurfaces);
    assert.strictEqual(attempt.artifacts.length, payload.surfaceResults.length);
    assert.strictEqual(event.artifacts.length, payload.surfaceResults.length);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('preflight and plan receipts preserve the required runtime surface list', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    for (const phase of ['preflight', 'plan']) {
      const result = invoke([phase, '--task-id', `facade-${phase}-runtime-list`, '--json'], {
        DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      });
      assert.ok([0, 2].includes(result.status), `${phase}: ${result.stderr}`);
      const payload = parseSingleJson(result.stdout);
      assert.strictEqual(result.status, payload.exitCode, `${phase}: process/result exit mismatch`);
      assert.deepStrictEqual(payload.requiredRuntimeSurfaces, [
        'claude-core', 'codex-sync', 'codex-native', 'cursor-plugin',
        'agent-plugin', 'agy-plugin',
      ]);
      const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
      assert.deepStrictEqual(attempt.requiredRuntimeSurfaces, payload.requiredRuntimeSurfaces);
    }
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

test('dirty-at-start receipt remains DIRTY when phase execution restores a clean checkout', () => {
  const receiptRoot = temporaryReceiptRoot();
  const fixtureRoot = temporaryPackageFixture();
  const dirtyPath = path.join(fixtureRoot, 'dirty-before-execution.txt');
  const requiredSurfaces = [
    'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
    'cursor-plugin', 'agent-plugin', 'agy-plugin',
  ];
  fs.writeFileSync(dirtyPath, 'dirty before execution\n');
  try {
    const invocation = harness.execute(['release', '--task-id', 'facade-dirty-before-clean-after', '--json'], {
      root: fixtureRoot,
      env: { ...process.env, DHPK_HARNESS_RECEIPT_ROOT: receiptRoot },
      phaseExecutor: () => {
        fs.rmSync(dirtyPath);
        return {
          outcome: 'COMPLETE',
          requiredSurfaces,
          surfaceResults: requiredSurfaces.map((surface) => ({ surface, status: 'PASS' })),
        };
      },
    });
    assert.strictEqual(invocation.status, 2);
    assert.strictEqual(invocation.result.outcome, 'NO_SHIP');
    assert.strictEqual(invocation.result.worktree, 'DIRTY');
    const attempt = JSON.parse(fs.readFileSync(path.join(invocation.result.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(attempt.outcome, 'NO_SHIP');
    assert.strictEqual(attempt.worktree, 'DIRTY');
    assert.strictEqual(attempt.targetCommit, invocation.result.targetCommit);
    assert.strictEqual(attempt.targetTree, invocation.result.targetTree);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('probe acceptance stays separate from a runtime-unavailable surface observation', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['probe', '--surface', 'cursor-plugin', '--task-id', 'facade-cursor-probe', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.outcome, 'PASS');
    assert.strictEqual(payload.acceptance.verdict, 'PASS');
    assert.strictEqual(payload.surfaceResults.length, 1);
    const [cursorPlugin] = payload.surfaceResults;
    assert.strictEqual(cursorPlugin.surface, 'cursor-plugin');
    assert.strictEqual(cursorPlugin.status, 'UNAVAILABLE');
    assert.ok(payload.surfaceResults.every((entry) => entry.stage === 'CONSUMER'));
    assert.ok(payload.surfaceResults.every((entry) => entry.status !== 'PASS'));
    assert.strictEqual(cursorPlugin.producer, 'consumer-gate');
    assert.notStrictEqual(cursorPlugin.runtimeEvidence.status, 'PASS');
    assert.match(JSON.stringify(cursorPlugin), /Cursor|loader|unavailable/i);
    assert.ok(payload.receiptReference);
    const attempt = JSON.parse(fs.readFileSync(path.join(payload.receiptReference, 'attempt.json'), 'utf8'));
    assert.strictEqual(attempt.surface, 'cursor-plugin');
    assert.strictEqual(attempt.stage, 'CONSUMER');
    assert.strictEqual(attempt.producer, 'consumer-gate');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('probe facade delegates the Cursor project-local sync route to the consumer gate', () => {
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invoke(['probe', '--surface', 'cursor-sync', '--task-id', 'facade-cursor-sync-probe', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.outcome, 'PASS');
    assert.strictEqual(payload.acceptance.verdict, 'PASS');
    assert.strictEqual(payload.surfaceResults.length, 1);
    assert.strictEqual(payload.surfaceResults[0].surface, 'cursor-sync');
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].producer, 'consumer-gate');
    assert.strictEqual(payload.surfaceResults[0].adapter.id, 'cursor-sync-installer');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

test('standard Agent Plugin rejects Codex marketplace evidence without a portable loader result', () => {
  const root = temporaryProbeFixture({
    surfaceResults: [{
      surface: 'codex-marketplace',
      status: 'PASS',
      stage: 'CONSUMER',
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
    }],
  }, 'agent');
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'probe',
      '--surface',
      'agent-plugin',
      '--task-id',
      'facade-agent-execute',
      '--json',
    ], {
      CI: '1',
      REQUIRE_EXECUTE: '1',
      PROBE_PAYLOAD: JSON.stringify({
        surfaceResults: [{
          surface: 'codex-marketplace',
          status: 'PASS',
          stage: 'CONSUMER',
          commands: [],
          environment: { network: 'disabled' },
          artifacts: [],
          diagnostics: [],
          reasons: [],
          checkedClaims: ['consumer-route'],
        }],
      }),
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    });
    assert.strictEqual(result.status, 1, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.surfaceResults[0].surface, 'agent-plugin');
    assert.strictEqual(payload.surfaceResults[0].status, 'FAIL');
    assert.strictEqual(payload.surfaceResults[0].producer, 'consumer-platform-probe');
    assert.strictEqual(payload.surfaceResults[0].adapter.id, 'consumer-platform-probe');
    assert.match(payload.surfaceResults[0].reasons.join('\n'), /unexpected surface|codex-marketplace/i);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
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
      '--skip-claude-reinstall',
    ]);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade preserves current BLOCKED acceptance when Claude execution is restricted', () => {
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  const gateEvidence = restrictedClaudeGateEvidence();
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'probe', '--surface', 'claude-core', '--task-id', 'facade-claude-restricted-probe', '--json',
    ], {
      CI: 'false',
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '0',
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_ARGS_FILE: gateArgsFile,
      GATE_EXIT_BY_VERDICT: '1',
    });

    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'BLOCKED');
    assert.strictEqual(payload.acceptance.requiredChecks[0].status, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].surface, 'claude-core');
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.deepStrictEqual(payload.surfaceResults[0].commands, []);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(gateArgsFile, 'utf8')), [
      '--repo-root', root,
      '--surface', 'claude-core',
      '--skip-claude-reinstall',
    ]);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('configured release forwards Claude cache restriction and keeps current acceptance', () => {
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-configured-gate-args-${process.pid}-${Date.now()}.json`);
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(restrictedClaudeGateEvidence(), inventory, ['.claude-plugin']);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, ['release', '--task-id', 'configured-claude-restricted', '--json'], {
      CI: 'false',
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '0',
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_ARGS_FILE: gateArgsFile,
      GATE_EXIT_BY_VERDICT: '1',
    }, RELEASE_INVOKE_TIMEOUT_MS);

    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'BLOCKED');
    assert.deepStrictEqual(payload.requiredSurfaces, ['claude-core']);
    assert.strictEqual(payload.surfaceResults[0].surface, 'claude-core');
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.deepStrictEqual(payload.surfaceResults[0].commands, []);
    assert.ok(JSON.parse(fs.readFileSync(gateArgsFile, 'utf8')).includes('--skip-claude-reinstall'));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('requirements release keeps Claude BLOCKED and independent selected cursor evidence', () => {
  const cursorRow = {
    surface: 'cursor-sync',
    producerSurface: 'cursor-sync',
    status: 'NOT_RUN',
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    adapter: { id: 'cursor-sync-fixture', version: '1.0.0' },
    commands: [],
    environment: { network: 'disabled' },
    artifacts: [],
    diagnostics: [],
    reasons: [],
    checkedClaims: ['consumer-route'],
    installationEvidence: { status: 'PASS' },
    runtimeEvidence: { status: 'NOT_RUN', reason: 'Cursor runtime was not selected.' },
  };
  const requirements = {
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['claude-core', 'cursor-sync'],
    checks: [
      {
        id: 'claude-installation',
        surface: 'claude-core',
        host: 'claude',
        capability: 'installation-contract',
        trigger: 'new-host',
        reason: 'Verify the selected Claude installation contract.',
        question: 'Did the Claude installation contract pass?',
        evidenceKind: 'contract',
        authorization: { authorized: false },
      },
      {
        id: 'cursor-installation',
        surface: 'cursor-sync',
        host: 'cursor',
        capability: 'installation-contract',
        trigger: 'new-host',
        reason: 'Verify the selected Cursor installation contract.',
        question: 'Did the Cursor installation contract pass?',
        evidenceKind: 'contract',
        authorization: { authorized: false },
      },
    ],
  };
  const gateEvidence = restrictedClaudeGateEvidence({
    additionalRows: [cursorRow],
    additionalChecks: [{
      id: 'install.cursor-sync',
      surface: 'cursor-sync',
      kind: 'installation',
      reason: 'The selected Cursor installation contract passed.',
      status: 'PASS',
      evidenceRef: 'surfaceResults.cursor-sync.installationEvidence',
    }],
    additionalExclusions: [{
      id: 'runtime.cursor-sync',
      surface: 'cursor-sync',
      kind: 'native',
      reason: 'Cursor runtime was not selected.',
      status: 'NOT_RUN',
      evidenceRef: 'surfaceResults.cursor-sync.runtimeEvidence',
    }],
  });
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const requirementsFile = path.join(os.tmpdir(), `dhpk-restricted-requirements-${process.pid}-${Date.now()}.json`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-restricted-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  fs.writeFileSync(requirementsFile, `${JSON.stringify(requirements, null, 2)}\n`);
  try {
    const result = invokeAt(root, [
      'release', '--requirements', requirementsFile, '--task-id', 'requirements-claude-restricted', '--json',
    ], {
      CI: 'false',
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '0',
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_ARGS_FILE: gateArgsFile,
      GATE_EXIT_BY_VERDICT: '1',
    }, RELEASE_INVOKE_TIMEOUT_MS);

    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'BLOCKED');
    assert.deepStrictEqual(payload.requiredSurfaces, ['claude-core', 'cursor-sync']);
    assert.deepStrictEqual(payload.surfaceResults.map((row) => row.surface), ['claude-core', 'cursor-sync']);
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[1].installationEvidence.status, 'PASS');
    assert.ok(JSON.parse(fs.readFileSync(gateArgsFile, 'utf8')).includes('--skip-claude-reinstall'));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(requirementsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade canonicalizes Claude producer rows while preserving producer identity', () => {
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: 'install.claude',
        surface: 'claude',
        kind: 'installation',
        reason: 'The selected Claude installation contract passed.',
        status: 'PASS',
        evidenceRef: 'surfaceResults.claude.installationEvidence',
      }, {
        id: 'requirement.claude-installation',
        surface: 'claude',
        kind: 'contract',
        reason: 'The selected Claude installation contract passed.',
        status: 'PASS',
        evidenceRef: 'surfaceResults.claude.requirementEvidence.check1',
      }],
      excludedChecks: [{
        id: 'runtime.claude',
        surface: 'claude',
        kind: 'native',
        reason: 'Native execution was not required.',
        status: 'NOT_RUN',
        evidenceRef: 'surfaceResults.claude.runtimeEvidence',
      }],
    },
    surfaceResults: [{
      surface: 'claude',
      producerSurface: 'claude',
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: 'claude-plugin-cli', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
      requirementEvidence: {
        check1: {
          id: 'claude-installation',
          host: 'claude',
          capability: 'installation-contract',
          trigger: 'new-host',
          reason: 'Verify only the selected Claude installation contract.',
          question: 'Did the selected Claude installation contract pass?',
          requestedEvidenceKind: 'contract',
          evidenceKind: 'contract',
          authorized: false,
          checkKey: 'claude:installation-contract:contract',
          status: 'PASS',
          adapter: { id: 'consumer-gate', version: '1.0.0' },
          contractEvidence: {
            status: 'PASS',
            adapterRoute: 'consumer-gate-installation',
            reason: 'Installation evidence was observed.',
            evidenceRef: 'surfaceResults.claude.installationEvidence',
          },
        },
      },
    }],
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'probe', '--surface', 'claude-core', '--task-id', 'facade-claude-alias-probe', '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '1',
      GATE_ARGS_FILE: gateArgsFile,
    });

    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'PASS');
    assert.strictEqual(payload.acceptance.requiredChecks[0].surface, 'claude-core');
    assert.strictEqual(payload.acceptance.requiredChecks[0].evidenceRef, 'surfaceResults.claude-core.installationEvidence');
    assert.strictEqual(payload.acceptance.excludedChecks[0].surface, 'claude-core');
    assert.strictEqual(payload.acceptance.excludedChecks[0].evidenceRef, 'surfaceResults.claude-core.runtimeEvidence');
    assert.strictEqual(payload.acceptance.requiredChecks[1].id, 'requirement.claude-installation');
    assert.strictEqual(payload.acceptance.requiredChecks[1].evidenceRef, 'surfaceResults.claude-core.requirementEvidence.check1');
    assert.strictEqual(payload.surfaceResults[0].surface, 'claude-core');
    assert.strictEqual(payload.surfaceResults[0].producerSurface, 'claude');
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.strictEqual(
      payload.surfaceResults[0].requirementEvidence.check1.contractEvidence.evidenceRef,
      'surfaceResults.claude-core.installationEvidence',
    );
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(gateArgsFile, 'utf8')), [
      '--repo-root', root,
      '--surface', 'claude-core',
    ]);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('release forwards the complete requirements declaration in one consumer-gate call', () => {
  const requirements = {
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['codex-sync', 'cursor-plugin'],
    checks: [
      {
        id: 'codex-installation',
        surface: 'codex-sync',
        host: 'codex',
        capability: 'plugin-install',
        trigger: 'new-host',
        reason: 'Verify the selected Codex installation contract.',
        question: 'Does the selected Codex installation satisfy the contract?',
        evidenceKind: 'contract',
        authorization: { authorized: false },
      },
      {
        id: 'cursor-installation',
        surface: 'cursor-plugin',
        host: 'cursor',
        capability: 'plugin-install',
        trigger: 'new-host',
        reason: 'Verify the selected Cursor installation contract.',
        question: 'Does the selected Cursor installation satisfy the contract?',
        evidenceKind: 'contract',
        authorization: { authorized: false },
      },
    ],
  };
  const surfaceResults = requirements.selectedSurfaces.map((surface) => ({
    surface,
    status: 'NOT_RUN',
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    producerSurface: surface,
    adapter: { id: `${surface}-fixture`, version: '1.0.0' },
    commands: [],
    environment: { network: 'disabled' },
    artifacts: [],
    diagnostics: [],
    reasons: [],
    checkedClaims: ['consumer-route'],
    installationEvidence: { status: 'PASS' },
    runtimeEvidence: { status: 'NOT_RUN' },
  }));
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: requirements.selectedSurfaces.map((surface) => ({
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      })),
      excludedChecks: [],
    },
    surfaceResults,
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const requirementsFile = path.join(os.tmpdir(), `dhpk-requirements-${process.pid}-${Date.now()}.json`);
  const gateCallsFile = path.join(os.tmpdir(), `dhpk-gate-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  fs.writeFileSync(requirementsFile, `${JSON.stringify(requirements, null, 2)}\n`);
  try {
    const result = invokeAt(root, [
      'release', '--requirements', requirementsFile, '--task-id', 'facade-atomic-requirements', '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_CALLS_FILE: gateCallsFile,
      GATE_ARGS_FILE: gateArgsFile,
      MUTATE_REQUIREMENTS_SOURCE_FILE: requirementsFile,
    }, RELEASE_INVOKE_TIMEOUT_MS);

    assert.notStrictEqual(result.status, 64, `${result.stderr}\n${result.stdout}`);
    assert.ok(fs.existsSync(gateCallsFile), 'the consumer gate was not invoked');
    const calls = fs.readFileSync(gateCallsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(calls.length, 1, JSON.stringify(calls));
    assert.deepStrictEqual(calls[0].requirements, requirements);
    assert.strictEqual(calls[0].args.filter((arg) => arg === '--requirements').length, 1);
    assert.ok(!calls[0].args.includes('--surface'), calls[0].args.join(' '));
    assert.notDeepStrictEqual(JSON.parse(fs.readFileSync(requirementsFile, 'utf8')), requirements);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(requirementsFile, { force: true });
    fs.rmSync(gateCallsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('release derives omitted requirements scope in declaration order without rewriting input bytes', () => {
  const checks = ['cursor-sync', 'codex-sync', 'cursor-sync'].map((surface, index) => ({
    id: `installation-${index + 1}`,
    surface,
    host: surface.startsWith('cursor') ? 'cursor' : 'codex',
    capability: 'installation-contract',
    trigger: 'new-host',
    reason: `Verify the selected ${surface} installation contract.`,
    question: `Did the selected ${surface} installation satisfy the contract?`,
    evidenceKind: 'contract',
    authorization: { authorized: false },
  }));
  const requirements = { schema: 'dhpk.consumer-requirements.v1', checks };
  const requirementsBytes = `${JSON.stringify(requirements, null, 2)}\n`;
  const selectedSurfaces = ['cursor-sync', 'codex-sync'];
  const surfaceResults = selectedSurfaces.map((surface) => ({
    surface,
    status: 'NOT_RUN',
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    producerSurface: surface,
    adapter: { id: `${surface}-fixture`, version: '1.0.0' },
    commands: [],
    environment: { network: 'disabled' },
    artifacts: [],
    diagnostics: [],
    reasons: [],
    checkedClaims: ['consumer-route'],
    installationEvidence: { status: 'PASS' },
    runtimeEvidence: { status: 'NOT_RUN', reason: 'Runtime evidence was not selected.' },
  }));
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: selectedSurfaces.map((surface) => ({
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      })),
      excludedChecks: selectedSurfaces.map((surface) => ({
        id: `runtime.${surface}`,
        surface,
        kind: 'native',
        reason: 'Runtime evidence was not selected.',
        status: 'NOT_RUN',
        evidenceRef: `surfaceResults.${surface}.runtimeEvidence`,
      })),
    },
    surfaceResults,
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const requirementsFile = path.join(os.tmpdir(), `dhpk-derived-requirements-${process.pid}-${Date.now()}.json`);
  const gateCallsFile = path.join(os.tmpdir(), `dhpk-derived-gate-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-derived-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  fs.writeFileSync(requirementsFile, requirementsBytes);
  try {
    const result = invokeAt(root, [
      'release', '--requirements', requirementsFile, '--task-id', 'derived-requirements-scope', '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_CALLS_FILE: gateCallsFile,
      GATE_ARGS_FILE: gateArgsFile,
      MUTATE_REQUIREMENTS_SOURCE_FILE: requirementsFile,
    }, RELEASE_INVOKE_TIMEOUT_MS);

    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.deepStrictEqual(payload.requiredSurfaces, selectedSurfaces);
    const calls = fs.readFileSync(gateCallsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(calls.length, 1, JSON.stringify(calls));
    assert.strictEqual(calls[0].requirementsText, requirementsBytes);
    assert.deepStrictEqual(calls[0].requirements, requirements);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(gateArgsFile, 'utf8')).filter((arg) => arg === '--requirements').length, 1);
    assert.notStrictEqual(fs.readFileSync(requirementsFile, 'utf8'), requirementsBytes, 'fixture did not exercise source-file replacement');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(requirementsFile, { force: true });
    fs.rmSync(gateCallsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('release aggregates current consumer-gate acceptance across all seven selected surfaces', () => {
  const selectedSurfaces = [
    'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
    'cursor-plugin', 'agent-plugin', 'agy-plugin',
  ];
  const bySurface = Object.fromEntries(selectedSurfaces.map((surface) => {
    const row = {
      surface,
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      producerSurface: surface === 'claude-core' ? 'claude' : surface,
      adapter: { id: `${surface}-installer`, version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    };
    return [surface, {
      schemaVersion: 2,
      stage: 'CONSUMER',
      verdict: 'PASS',
      acceptance: {
        verdict: 'PASS',
        requiredChecks: [{
          id: `install.${surface}`,
          surface,
          kind: 'installation',
          reason: 'The selected installation contract passed.',
          status: 'PASS',
          evidenceRef: `surfaceResults.${surface}.installationEvidence`,
        }],
        excludedChecks: [{
          id: `runtime.${surface}`,
          surface,
          kind: 'native',
          reason: 'Native execution was not authorized by this facade probe.',
          status: 'NOT_RUN',
          evidenceRef: `surfaceResults.${surface}.runtimeEvidence`,
        }],
      },
      surfaceResults: [row],
    }];
  }));
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture({ bySurface }, inventory);
  const callsFile = path.join(os.tmpdir(), `dhpk-seven-surface-gate-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-seven-surface-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'release', '--surfaces', selectedSurfaces.join(','),
      '--task-id', 'facade-seven-current-surfaces', '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '1',
      GATE_CALLS_FILE: callsFile,
      GATE_ARGS_FILE: gateArgsFile,
      PATH: NODE_BASH_ONLY_PATH,
    }, RELEASE_INVOKE_TIMEOUT_MS);
    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'PASS');
    assert.strictEqual(payload.outcome, 'COMPLETE');
    assert.strictEqual(payload.exitCode, 0);
    assert.deepStrictEqual(payload.requiredSurfaces, selectedSurfaces);
    assert.ok(payload.surfaceResults.every((entry) => entry.status === 'NOT_RUN'));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'preflight'));
    const calls = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(calls.length, selectedSurfaces.length, JSON.stringify(calls));
    assert.deepStrictEqual(calls.map((call) => call.args[call.args.indexOf('--surface') + 1]), selectedSurfaces);
    assert.ok(calls.every((call) => call.args.includes('--surface') && !call.args.includes('--execute')));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(callsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('release explicit subset limits current acceptance to the selected surfaces', () => {
  const selectedSurfaces = ['codex-sync', 'cursor-sync'];
  const bySurface = Object.fromEntries(selectedSurfaces.map((surface) => [surface, {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      }],
      excludedChecks: [],
    },
    surfaceResults: [{
      surface,
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: `${surface}-installer`, version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  }]));
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture({ bySurface }, inventory);
  const callsFile = path.join(os.tmpdir(), `dhpk-subset-gate-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-subset-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'release', '--surfaces', selectedSurfaces.join(','), '--task-id', 'facade-current-subset', '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_CALLS_FILE: callsFile,
      GATE_ARGS_FILE: gateArgsFile,
      PATH: NODE_BASH_ONLY_PATH,
    }, RELEASE_INVOKE_TIMEOUT_MS);
    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'PASS');
    assert.deepStrictEqual(payload.requiredSurfaces, selectedSurfaces);
    assert.strictEqual(payload.outcome, 'COMPLETE');
    assert.strictEqual(payload.exitCode, 0);
    const calls = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(calls.length, selectedSurfaces.length, JSON.stringify(calls));
    assert.deepStrictEqual(calls.map((call) => call.args[call.args.indexOf('--surface') + 1]), selectedSurfaces);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(callsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('release current acceptance uses bounded coordinator and transports current mode', () => {
  const selectedSurfaces = [
    'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
    'cursor-plugin', 'agent-plugin', 'agy-plugin',
  ];
  const bySurface = Object.fromEntries(selectedSurfaces.map((surface) => [surface, {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      }],
      excludedChecks: [],
    },
    surfaceResults: [{
      surface,
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: `${surface}-installer`, version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  }]));
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryPackageFixture();
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), inventory);
  const coordinator = path.join(root, 'scripts', 'release', 'parallel-consumer-probes.js');
  const argsFile = path.join(os.tmpdir(), `dhpk-current-coordinator-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  fs.mkdirSync(path.dirname(coordinator), { recursive: true });
  fs.writeFileSync(coordinator, [
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    'const value = (name) => args[args.indexOf(name) + 1];',
    'const surfaces = value(\'--surfaces\').split(\',\');',
    'fs.writeFileSync(process.env.BATCH_ARGS_FILE, JSON.stringify(args));',
    'const results = surfaces.map((surface, index) => ({',
    '  surface, namespace: `fixture-${surface}-${index}`, diagnostic: null,',
    '  execution: {',
    "    schemaVersion: 2, stage: 'CONSUMER', outcome: 'PASS',",
    "    acceptance: { verdict: 'PASS', requiredChecks: [{ id: `install.${surface}`, surface, kind: 'installation', reason: 'The selected installation contract passed.', status: 'PASS', evidenceRef: `surfaceResults.${surface}.installationEvidence` }], excludedChecks: [] },",
    "    surfaceResults: [{ surface, status: 'NOT_RUN', stage: 'CONSUMER', producer: 'consumer-gate', adapter: { id: `${surface}-installer`, version: '1.0.0' }, commands: [], environment: { network: 'disabled' }, artifacts: [], diagnostics: [], reasons: [], checkedClaims: ['consumer-route'], installationEvidence: { status: 'PASS' }, runtimeEvidence: { status: 'NOT_RUN' } }],",
    '  },',
    '}));',
    "process.stdout.write(JSON.stringify({ schema: 'dhpk.release-consumer-probe-batch.v1', concurrency: Number(value('--concurrency')), timeoutMs: Number(value('--timeout-ms')), wallTimeMs: 1, surfaces, results }));",
  ].join('\n') + '\n');
  git(root, ['add', 'manifests/distribution-inventory.json', 'scripts/release/parallel-consumer-probes.js']);
  git(root, ['commit', '-qm', 'fixture bounded consumer coordinator']);
  const originalNodePath = process.env.PATH;
  try {
    const result = invokeAt(root, [
      'release', '--surfaces', selectedSurfaces.join(','), '--task-id', 'facade-current-parallel', '--json',
    ], {
      CI: 'false',
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '0',
      DHPK_HARNESS_RELEASE_PROBE_CONCURRENCY: '2',
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      BATCH_ARGS_FILE: argsFile,
      GATE_ARGS_FILE: argsFile,
      PATH: originalNodePath,
    }, RELEASE_INVOKE_TIMEOUT_MS);

    assert.ok(fs.existsSync(argsFile), 'current release did not use the bounded coordinator');
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.deepStrictEqual(payload.requiredSurfaces, selectedSurfaces);
    assert.deepStrictEqual(payload.surfaceResults.map((row) => row.surface), selectedSurfaces);
    assert.strictEqual(payload.probeExecution && payload.probeExecution.mode, 'bounded-child-processes');
    assert.strictEqual(payload.probeExecution.concurrency, 2);
    assert.strictEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')).includes('--current-acceptance'), true);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(argsFile, { force: true });
  }
});

test('current install-only release completes when the unrequired raw runtime is unavailable', () => {
  const surface = 'cursor-sync';
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected Cursor sync installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      }],
      excludedChecks: [],
    },
    surfaceResults: [{
      surface,
      status: 'UNAVAILABLE',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: 'cursor-sync-installer', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: ['Runtime execution is not part of Cursor sync installation acceptance.'],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'UNAVAILABLE' },
    }],
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const gateCallsFile = path.join(os.tmpdir(), `dhpk-cursor-sync-gate-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-cursor-sync-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'release', '--surfaces', surface, '--task-id', 'facade-cursor-sync-install-only', '--json',
    ], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_CALLS_FILE: gateCallsFile,
      GATE_ARGS_FILE: gateArgsFile,
      PATH: NODE_BASH_ONLY_PATH,
    }, RELEASE_INVOKE_TIMEOUT_MS);
    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'PASS');
    assert.deepStrictEqual(payload.requiredSurfaces, [surface]);
    assert.deepStrictEqual(payload.requiredRuntimeSurfaces, []);
    assert.strictEqual(payload.surfaceResults[0].status, 'UNAVAILABLE');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'UNAVAILABLE');
    assert.strictEqual(payload.outcome, 'COMPLETE');
    assert.strictEqual(payload.exitCode, 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'preflight'));
    const calls = fs.readFileSync(gateCallsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    assert.strictEqual(calls.length, 1);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateCallsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('requirements files reject FIFOs, symlinks, and non-regular files without invoking the gate', () => {
  const surface = 'codex-sync';
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      }],
      excludedChecks: [],
    },
    surfaceResults: [{
      surface,
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: { id: `${surface}-installer`, version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const requirements = path.join(os.tmpdir(), `dhpk-invalid-requirements-${process.pid}-${Date.now()}.json`);
  const regularTarget = `${requirements}.target`;
  const symlink = `${requirements}.symlink`;
  const fifo = `${requirements}.fifo`;
  const directory = `${requirements}.directory`;
  const gateCallsFile = path.join(os.tmpdir(), `dhpk-invalid-requirements-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-invalid-requirements-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  const validRequirements = JSON.stringify({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: [surface],
    checks: [],
  });
  fs.writeFileSync(regularTarget, `${validRequirements}\n`);
  fs.symlinkSync(regularTarget, symlink);
  execFileSync('mkfifo', [fifo]);
  fs.mkdirSync(directory);
  const invalidPaths = [
    { path: fifo, timeout: 2000, kind: 'FIFO' },
    { path: symlink, timeout: DEFAULT_INVOKE_TIMEOUT_MS, kind: 'symlink' },
    { path: directory, timeout: DEFAULT_INVOKE_TIMEOUT_MS, kind: 'directory' },
  ];
  try {
    const failures = [];
    for (const entry of invalidPaths) {
      fs.rmSync(gateCallsFile, { force: true });
      const result = invokeAt(root, [
        'release', '--requirements', entry.path, '--task-id', `invalid-requirements-${entry.kind}`, '--json',
      ], {
        DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
        GATE_CALLS_FILE: gateCallsFile,
        GATE_ARGS_FILE: gateArgsFile,
        PATH: NODE_BASH_ONLY_PATH,
      }, entry.timeout);
      try {
        assert.notStrictEqual(result.status, null, `${entry.kind} read exceeded the bounded timeout`);
        assert.strictEqual(result.status, 2, `${entry.kind}: ${result.stderr}\n${result.stdout}`);
        const payload = parseSingleJson(result.stdout);
        assert.strictEqual(payload.outcome, 'BLOCKED', `${entry.kind}: ${JSON.stringify(payload)}`);
        assert.match(payload.diagnostics.join(' '), /requirements|regular|fifo|symlink/i);
        assert.ok(!fs.existsSync(gateCallsFile), `${entry.kind} invoked consumer gate`);
      } catch (error) {
        failures.push(`${entry.kind}: ${error.message}`);
      }
    }
    assert.strictEqual(failures.length, 0, failures.join('\n'));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(regularTarget, { force: true });
    fs.rmSync(symlink, { force: true });
    fs.rmSync(fifo, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(gateCallsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('malformed current evidence redacts bearer and password canaries in both release catches', () => {
  const sensitiveStage = 'Authorization: Bearer CANARY_BEARER_853 password=CANARY_PASSWORD_853';
  const surface = 'codex-sync';
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: `install.${surface}`,
        surface,
        kind: 'installation',
        reason: 'The selected installation contract passed.',
        status: 'PASS',
        evidenceRef: `surfaceResults.${surface}.installationEvidence`,
      }],
      excludedChecks: [],
    },
    surfaceResults: [{
      surface,
      status: 'PASS',
      stage: sensitiveStage,
      producer: 'consumer-gate',
      adapter: { id: `${surface}-installer`, version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const requirementsFile = path.join(os.tmpdir(), `dhpk-malformed-requirements-${process.pid}-${Date.now()}.json`);
  const gateCallsFile = path.join(os.tmpdir(), `dhpk-malformed-evidence-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-malformed-evidence-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  fs.writeFileSync(requirementsFile, `${JSON.stringify({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: [surface],
    checks: [],
  })}\n`);
  try {
    const invocations = [
      ['release', '--requirements', requirementsFile, '--task-id', 'malformed-requirements-canary', '--json'],
      ['release', '--task-id', 'malformed-configured-canary', '--json'],
    ];
    for (const args of invocations) {
      const result = invokeAt(root, args, {
        DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
        GATE_CALLS_FILE: gateCallsFile,
        GATE_ARGS_FILE: gateArgsFile,
        PATH: NODE_BASH_ONLY_PATH,
      }, RELEASE_INVOKE_TIMEOUT_MS);
      assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
      const payload = parseSingleJson(result.stdout);
      assert.ok(['PUBLISHED_UNHEALTHY', 'BLOCKED'].includes(payload.outcome), JSON.stringify(payload));
      assert.strictEqual(payload.exitCode, 1);
      const serialized = JSON.stringify(payload);
      assert.ok(!serialized.includes('CANARY_BEARER_853'), serialized);
      assert.ok(!serialized.includes('CANARY_PASSWORD_853'), serialized);
    }
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(requirementsFile, { force: true });
    fs.rmSync(gateCallsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('release with no configured consumer surface returns the gate scope block', () => {
  const surfaces = ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync', 'agent-plugin', 'cursor-plugin', 'agy-plugin'];
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    adapter: { id: 'consumer-gate', version: '1.0.0' },
    verdict: 'BLOCKED',
    acceptance: {
      verdict: 'BLOCKED',
      requiredChecks: [{
        id: 'scope.configuration',
        surface: 'consumer-scope',
        kind: 'contract',
        reason: 'No configured consumer surface exists.',
        status: 'BLOCKED',
        evidenceRef: null,
      }],
      excludedChecks: surfaces.map((surface) => ({
        id: `scope.${surface}`,
        surface,
        kind: 'installation',
        reason: 'No configured-target marker was found.',
        status: 'NOT_CONFIGURED',
        evidenceRef: null,
      })),
    },
    surfaceResults: [],
  };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const root = temporaryGateFixture(gateEvidence, inventory);
  const gateCallsFile = path.join(os.tmpdir(), `dhpk-no-config-gate-calls-${process.pid}-${Date.now()}.jsonl`);
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-no-config-gate-args-${process.pid}-${Date.now()}.json`);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, ['release', '--task-id', 'facade-no-configured-consumer', '--json'], {
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
      GATE_CALLS_FILE: gateCallsFile,
      GATE_ARGS_FILE: gateArgsFile,
      PATH: NODE_BASH_ONLY_PATH,
    }, RELEASE_INVOKE_TIMEOUT_MS);
    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'BLOCKED');
    assert.strictEqual(payload.outcome, 'BLOCKED');
    assert.deepStrictEqual(payload.requiredSurfaces, []);
    const calls = fs.readFileSync(gateCallsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(calls.length, 1, JSON.stringify(calls));
    assert.ok(!calls[0].args.includes('--surface'), calls[0].args.join(' '));
    assert.ok(!calls[0].args.includes('--requirements'), calls[0].args.join(' '));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateCallsFile, { force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade carries passing installation acceptance beside raw native NOT_RUN evidence', () => {
  const gateEvidence = {
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
        id: 'runtime.codex-sync',
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
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  const root = temporaryGateFixture(gateEvidence);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'probe', '--surface', 'codex-sync', '--task-id', 'facade-acceptance-probe', '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot, GATE_ARGS_FILE: gateArgsFile });
    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.outcome, 'PASS');
    assert.deepStrictEqual(payload.acceptance, gateEvidence.acceptance);
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'PASS');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.notStrictEqual(payload.runtimeVerified, true);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade maps required BLOCKED acceptance to exit 1 while preserving raw observations', () => {
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'BLOCKED',
    runtimeVerified: false,
    acceptance: {
      verdict: 'BLOCKED',
      requiredChecks: [{
        id: 'install.codex-sync',
        surface: 'codex-sync',
        kind: 'installation',
        reason: 'The selected installation contract is unavailable.',
        status: 'UNAVAILABLE',
        evidenceRef: 'surfaceResults.codex-sync.installationEvidence',
      }],
      excludedChecks: [],
    },
    surfaceResults: [{
      surface: 'codex-sync',
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      producerSurface: 'codex-sync',
      adapter: { id: 'codex-sync-installer', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'UNAVAILABLE' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  const root = temporaryGateFixture(gateEvidence);
  const receiptRoot = temporaryReceiptRoot();
  try {
    const result = invokeAt(root, [
      'probe', '--surface', 'codex-sync', '--task-id', 'facade-blocked-acceptance', '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot, GATE_ARGS_FILE: gateArgsFile });
    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2', JSON.stringify(payload));
    assert.strictEqual(payload.outcome, 'BLOCKED');
    assert.strictEqual(payload.exitCode, 1);
    assert.deepStrictEqual(payload.acceptance, gateEvidence.acceptance);
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'UNAVAILABLE');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.notStrictEqual(payload.runtimeVerified, true);
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade routes AGY installation through the consumer gate with native NOT_RUN evidence', () => {
  const surface = 'agy-plugin';
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'PASS',
    acceptance: {
      verdict: 'PASS',
      requiredChecks: [{
        id: 'install.agy-plugin',
        surface,
        kind: 'installation',
        reason: 'The selected AGY installation contract passed.',
        status: 'PASS',
        evidenceRef: 'surfaceResults.agy-plugin.installationEvidence',
      }],
      excludedChecks: [{
        id: 'runtime.agy-plugin',
        surface,
        kind: 'native',
        reason: 'Native AGY execution was not required.',
        status: 'NOT_RUN',
        evidenceRef: 'surfaceResults.agy-plugin.runtimeEvidence',
      }],
    },
    surfaceResults: [{
      surface,
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      producerSurface: surface,
      adapter: { id: 'agy-plugin-installer', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'PASS' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  const root = temporaryGateFixture(gateEvidence);
  const receiptRoot = temporaryReceiptRoot();
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  try {
    const result = invokeAt(root, [
      'probe', '--surface', surface, '--task-id', 'facade-agy-install-probe', '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot, GATE_ARGS_FILE: gateArgsFile });

    assert.strictEqual(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    const gateArgs = JSON.parse(fs.readFileSync(gateArgsFile, 'utf8'));
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.outcome, 'PASS');
    assert.deepStrictEqual(payload.acceptance, gateEvidence.acceptance);
    assert.strictEqual(payload.surfaceResults[0].producer, 'consumer-gate');
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'PASS');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
    assert.ok(gateArgs.includes('--surface') && gateArgs.includes(surface), gateArgs.join(' '));
    assert.ok(!gateArgs.includes('--execute'), gateArgs.join(' '));
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
  }
});

test('probe facade preserves blocked AGY project installation evidence from the consumer gate', () => {
  const surface = 'agy-plugin';
  const gateEvidence = {
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: 'BLOCKED',
    acceptance: {
      verdict: 'BLOCKED',
      requiredChecks: [{
        id: 'install.agy-plugin',
        surface,
        kind: 'installation',
        reason: 'The physical AGY project receipt is invalid.',
        status: 'BLOCKED',
        evidenceRef: 'surfaceResults.agy-plugin.installationEvidence',
      }],
      excludedChecks: [{
        id: 'runtime.agy-plugin',
        surface,
        kind: 'native',
        reason: 'Native AGY execution was not required.',
        status: 'NOT_RUN',
        evidenceRef: 'surfaceResults.agy-plugin.runtimeEvidence',
      }],
    },
    surfaceResults: [{
      surface,
      status: 'NOT_RUN',
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      producerSurface: surface,
      adapter: { id: 'agy-project-direct-file', version: '1.0.0' },
      commands: [],
      environment: { network: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: ['The physical AGY project receipt is invalid.'],
      checkedClaims: ['consumer-route'],
      installationEvidence: { status: 'BLOCKED' },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
  const root = temporaryGateFixture(gateEvidence);
  const receiptRoot = temporaryReceiptRoot();
  const gateArgsFile = path.join(os.tmpdir(), `dhpk-gate-args-${process.pid}-${Date.now()}.json`);
  try {
    const result = invokeAt(root, [
      'probe', '--surface', surface, '--task-id', 'facade-agy-project-probe', '--json',
    ], { DHPK_HARNESS_RECEIPT_ROOT: receiptRoot, GATE_ARGS_FILE: gateArgsFile });

    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.outcome, 'BLOCKED');
    assert.strictEqual(payload.exitCode, 1);
    assert.deepStrictEqual(payload.acceptance, gateEvidence.acceptance);
    assert.strictEqual(payload.surfaceResults[0].adapter.id, 'agy-project-direct-file');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(gateArgsFile, { force: true });
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
    assert.strictEqual(result.status, 1, result.stderr);
    const payload = parseSingleJson(result.stdout);
    assert.strictEqual(payload.schema, 'dhpk.harness.result.v2');
    assert.strictEqual(payload.acceptance.verdict, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].status, 'NOT_RUN');
    assert.strictEqual(payload.surfaceResults[0].installationEvidence.status, 'BLOCKED');
    assert.strictEqual(payload.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
  } finally {
    fs.rmSync(receiptRoot, { recursive: true, force: true });
  }
});

run('harness-facade-cli');
