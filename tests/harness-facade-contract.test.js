'use strict';

// RED-first tests for harness-facade-receipt-contract task 1.1.
// These tests exercise the public result/parser seam, not private helpers.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const harness = require('../scripts/lib/harness');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk');

function invoke(args) {
  return spawnSync('bash', [CLI, 'harness', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('parses one supported phase and preserves the invocation context', () => {
  const parsed = harness.parseArgs(['preflight', '--json', '--task-id', 'task-1']);
  assert.deepStrictEqual(parsed, {
    phase: 'preflight',
    json: true,
    taskId: 'task-1',
  });
});

test('rejects unknown phases and options with usage status', () => {
  assert.throws(() => harness.parseArgs(['unknown']), /phase|usage|unknown/i);
  assert.throws(() => harness.parseArgs(['preflight', '--unknown']), /option|usage|unknown/i);
  assert.strictEqual(harness.exitCodeForOutcome('PASS'), 0);
  assert.strictEqual(harness.exitCodeForOutcome('FAIL'), 1);
  assert.strictEqual(harness.exitCodeForOutcome('NOT_RUN'), 2);
  assert.strictEqual(harness.exitCodeForOutcome('USAGE'), 64);
  assert.strictEqual(harness.exitCodeForOutcome('INTERNAL_ERROR'), 70);
});

test('requires an explicit surface for distribution adapter phases', () => {
  for (const phase of ['generate', 'validate', 'verify']) {
    assert.throws(() => harness.parseArgs([phase, '--json']), /surface|required/i);
  }
  assert.deepStrictEqual(harness.parseArgs(['generate', '--surface', 'agent-plugin']), {
    phase: 'generate',
    surface: 'agent-plugin',
  });
});

test('CLI exposes the harness help contract', () => {
  const result = invoke(['--help']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight/);
  assert.match(result.stdout, /release/);
});

// Consolidated source suite: harness-docs.
{

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const DOC = path.join(ROOT, 'docs', 'harness-workflow.md');

  test('documentation links resolve to repository files', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    const links = [...content.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    const localMarkdownLinks = links.filter((link) =>
      !/^(?:https?:|mailto:)/.test(link) && /\.md$/i.test(link));
    assert.ok(localMarkdownLinks.length > 0, 'workflow documentation must include a local Markdown link');
    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue;
      assert.strictEqual(fs.existsSync(path.resolve(path.dirname(DOC), link)), true, `broken link: ${link}`);
    }
  });
}

// Consolidated source suite: harness-release-aggregation.
{

  // RED-first tests for harness-facade-receipt-contract task 1.3.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const harnessResult = require('../scripts/lib/harness-result');
  const harness = require('../scripts/lib/harness');

  const REQUIRED = [
    'claude-core',
    'codex-sync',
    'codex-native',
    'cursor-sync',
    'cursor-plugin',
    'agent-plugin',
    'agy-plugin',
  ];
  const REQUIRED_RUNTIME = [
    'claude-core',
    'codex-sync',
    'codex-native',
    'cursor-plugin',
    'agent-plugin',
    'agy-plugin',
  ];

  function all(status = 'PASS') {
    return REQUIRED.map((surface) => ({ surface, status }));
  }

  function currentConsumerExecution(surface, verdict, installationStatus) {
    return {
      outcome: verdict,
      schemaVersion: 2,
      stage: 'CONSUMER',
      verdict,
      producer: 'consumer-gate',
      adapter: { id: 'consumer-gate', version: '1.0.0' },
      acceptance: {
        verdict,
        requiredChecks: [{
          id: `install.${surface}`,
          surface,
          kind: 'installation',
          reason: 'Selected installation evidence was inspected.',
          status: installationStatus,
          evidenceRef: `surfaceResults.${surface}.installationEvidence`,
        }],
        excludedChecks: [{
          id: `runtime.${surface}`,
          surface,
          kind: 'native',
          reason: 'Native runtime execution was not required.',
          status: 'NOT_RUN',
          evidenceRef: `surfaceResults.${surface}.runtimeEvidence`,
        }],
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
        installationEvidence: {
          status: installationStatus,
          reason: 'Selected installation evidence was inspected.',
        },
        runtimeEvidence: {
          status: 'NOT_RUN',
          reason: 'Native runtime execution was not required.',
        },
      }],
    };
  }

  test('current PASS acceptance exits 1 when the effective public outcome is PUBLISHED_PENDING', () => {
    const receiptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-current-pending-receipt-'));
    const execution = {
      ...currentConsumerExecution('codex-sync', 'PASS', 'PASS'),
      outcome: 'PUBLISHED_PENDING',
      transportStatus: 'PASS',
    };
    try {
      const invocation = harness.execute([
        'release', '--json', '--task-id', 'current-pass-pending',
        '--attempt-id', 'current-pass-pending-attempt', '--receipt-root', receiptRoot,
      ], {
        root: ROOT,
        env: process.env,
        phaseExecutor: () => execution,
      });

      assert.strictEqual(invocation.status, 1);
      assert.strictEqual(invocation.result.exitCode, 1);
      assert.strictEqual(invocation.result.outcome, 'PUBLISHED_PENDING');
      assert.strictEqual(invocation.result.acceptance.verdict, 'PASS');
      const receipt = JSON.parse(fs.readFileSync(path.join(invocation.result.receiptReference, 'attempt.json'), 'utf8'));
      assert.strictEqual(receipt.consumerEvidence.acceptance.verdict, 'PASS');
    } finally {
      fs.rmSync(receiptRoot, { recursive: true, force: true });
    }
  });

  test('full-release aggregation requires exactly the seven canonical surfaces', () => {
    assert.deepStrictEqual(harnessResult.REQUIRED_SURFACES, REQUIRED);
    const result = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      surfaceResults: all(),
      fullRelease: true,
    });
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.strictEqual(harness.lifecyclePhaseForOutcome(result.outcome), 'COMPLETE');
  });

  test('unavailable and failed surfaces remain non-complete', () => {
    const pending = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      surfaceResults: all().map((entry) => entry.surface === 'cursor-plugin'
        ? { ...entry, status: 'UNAVAILABLE' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(pending.outcome, 'PUBLISHED_PENDING');

    const unhealthy = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      surfaceResults: all().map((entry) => entry.surface === 'agy-plugin'
        ? { ...entry, status: 'FAIL' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(unhealthy.outcome, 'PUBLISHED_UNHEALTHY');
  });

  test('full release ignores cursor-sync NOT_RUN for COMPLETE but retains its identity row', () => {
    const result = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      requiredRuntimeSurfaces: REQUIRED_RUNTIME,
      surfaceResults: all().map((entry) => entry.surface === 'cursor-sync'
        ? { ...entry, status: 'NOT_RUN' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
    assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
  });

  test('full release keeps cursor-sync FAIL unhealthy even outside the runtime list', () => {
    const result = harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      requiredRuntimeSurfaces: REQUIRED_RUNTIME,
      surfaceResults: all().map((entry) => entry.surface === 'cursor-sync'
        ? { ...entry, status: 'FAIL' }
        : entry),
      fullRelease: true,
    });
    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
  });

  test('full-release aggregation rejects a non-canonical required runtime subset', () => {
    assert.throws(() => harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED,
      requiredRuntimeSurfaces: ['claude-core'],
      surfaceResults: all(),
      fullRelease: true,
    }), /runtime|required|canonical/i);
  });

  test('release execution invokes each required consumer probe and preserves its evidence', () => {
    const calls = [];
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => {
      calls.push({ root, surface: parsed.surface });
      return {
        outcome: parsed.surface === 'cursor-plugin' ? 'UNAVAILABLE' : 'PASS',
        surfaceResults: [{
          surface: parsed.surface,
          status: parsed.surface === 'cursor-plugin' ? 'UNAVAILABLE' : 'PASS',
          stage: 'CONSUMER',
          producer: 'fixture-probe',
        }],
      };
    });

    assert.deepStrictEqual(calls, REQUIRED.map((surface) => ({
      root: '/tmp/dhpk-release-fixture',
      surface,
    })));
    assert.strictEqual(result.outcome, 'PUBLISHED_PENDING');
    assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
    assert.ok(result.surfaceResults.every((entry) => entry.stage === 'CONSUMER'));
    assert.ok(result.surfaceResults.every((entry) => entry.producer === 'fixture-probe'));
  });

  test('release aggregation completes on required PASS while native observations remain NOT_RUN', () => {
    const executions = Object.fromEntries(REQUIRED.map((surface) => [
      surface,
      currentConsumerExecution(surface, 'PASS', 'PASS'),
    ]));
    const result = harness.runReleaseProbes('/tmp/dhpk-current-consumer-fixture', REQUIRED, (_root, parsed) => executions[parsed.surface]);

    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.schemaVersion, 2);
    assert.strictEqual(result.acceptance.verdict, 'PASS');
    assert.deepStrictEqual(result.acceptance.requiredChecks.map((check) => check.id), REQUIRED.map((surface) => `install.${surface}`));
    assert.ok(result.surfaceResults.every((entry) => entry.status === 'NOT_RUN'));
    assert.ok(result.surfaceResults.every((entry) => entry.runtimeEvidence.status === 'NOT_RUN'));
  });

  test('release aggregation retains each required installation failure and its raw observation', () => {
    const passing = Object.fromEntries(REQUIRED.filter((surface) => surface !== 'agy-plugin').map((surface) => [
      surface,
      currentConsumerExecution(surface, 'PASS', 'PASS'),
    ]));
    const executions = {
      ...passing,
      'agy-plugin': currentConsumerExecution('agy-plugin', 'FAIL', 'FAIL'),
    };
    const result = harness.runReleaseProbes('/tmp/dhpk-current-consumer-fixture', REQUIRED, (_root, parsed) => executions[parsed.surface]);
    const failedCheck = result.acceptance.requiredChecks.find((check) => check.id === 'install.agy-plugin');
    const failedObservation = result.surfaceResults.find((entry) => entry.surface === 'agy-plugin');

    assert.strictEqual(result.acceptance.verdict, 'FAIL');
    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(failedCheck.status, 'FAIL');
    assert.strictEqual(failedObservation.status, 'NOT_RUN');
    assert.strictEqual(failedObservation.installationEvidence.status, 'FAIL');
  });

  test('release aggregation blocks unavailable required installation evidence and preserves raw status', () => {
    const passing = Object.fromEntries(REQUIRED.filter((surface) => surface !== 'cursor-plugin').map((surface) => [
      surface,
      currentConsumerExecution(surface, 'PASS', 'PASS'),
    ]));
    const executions = {
      ...passing,
      'cursor-plugin': currentConsumerExecution('cursor-plugin', 'BLOCKED', 'UNAVAILABLE'),
    };
    const result = harness.runReleaseProbes('/tmp/dhpk-current-consumer-fixture', REQUIRED, (_root, parsed) => executions[parsed.surface]);
    const unavailableCheck = result.acceptance.requiredChecks.find((check) => check.id === 'install.cursor-plugin');
    const unavailableObservation = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');

    assert.strictEqual(result.acceptance.verdict, 'BLOCKED');
    assert.strictEqual(result.outcome, 'BLOCKED');
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(unavailableCheck.status, 'UNAVAILABLE');
    assert.strictEqual(unavailableObservation.status, 'NOT_RUN');
    assert.strictEqual(unavailableObservation.installationEvidence.status, 'UNAVAILABLE');
  });

  test('release keeps transport failure separate from passing acceptance and raw observations', () => {
    const executions = Object.fromEntries(REQUIRED.map((surface) => [
      surface,
      currentConsumerExecution(surface, 'PASS', 'PASS'),
    ]));
    executions['agy-plugin'] = {
      ...executions['agy-plugin'],
      transportStatus: 'FAIL',
      diagnostics: ['worker transport failed after emitting evidence'],
    };
    const result = harness.runReleaseProbes(
      '/tmp/dhpk-current-consumer-transport-fixture',
      REQUIRED,
      (_root, parsed) => executions[parsed.surface],
    );
    const transported = result.surfaceResults.find((entry) => entry.surface === 'agy-plugin');

    assert.strictEqual(result.acceptance.verdict, 'PASS');
    assert.notStrictEqual(result.outcome, 'COMPLETE');
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(transported.status, 'NOT_RUN');
    assert.strictEqual(transported.installationEvidence.status, 'PASS');
    assert.match(result.diagnostics.join('\n'), /transport failed after emitting evidence/i);
  });

  test('release execution aggregates the explicit runtime list separately from identity rows', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, REQUIRED_RUNTIME, (root, parsed) => ({
      outcome: parsed.surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: parsed.surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));
    assert.strictEqual(result.outcome, 'COMPLETE');
    assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
    assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
  });

  test('release execution carries the trusted artifact binding onto matching package rows', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, REQUIRED_RUNTIME, (root, parsed) => ({
      outcome: 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }), {
      artifactManifest: {
        manifestFingerprint: 'sha256:' + 'a'.repeat(64),
        packages: [{ surface: 'codex-native', bindingFingerprint: 'sha256:' + 'b'.repeat(64) }],
      },
    });
    const native = result.surfaceResults.find((entry) => entry.surface === 'codex-native');
    assert.strictEqual(native.artifactBinding.bindingFingerprint, 'sha256:' + 'b'.repeat(64));
    assert.strictEqual(result.artifactManifestFingerprint, 'sha256:' + 'a'.repeat(64));
  });

  test('release execution rejects valid batch JSON when the coordinator exits nonzero', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-parallel-exit-'));
    const batchScript = path.join(root, 'scripts', 'release', 'parallel-consumer-probes.js');
    const batch = {
      schema: 'dhpk.release-consumer-probe-batch.v1',
      concurrency: 2,
      timeoutMs: 1000,
      wallTimeMs: 1,
      surfaces: REQUIRED,
      results: REQUIRED.map((surface) => ({
        surface,
        namespace: `fixture-${surface}`,
        diagnostic: null,
        execution: {
          outcome: 'PASS',
          surfaceResults: [{ surface, status: 'PASS', stage: 'CONSUMER', producer: 'fixture-probe' }],
        },
      })),
    };
    fs.mkdirSync(path.dirname(batchScript), { recursive: true });
    fs.writeFileSync(batchScript, [
      "process.stdout.write(`${process.env.DHPK_TEST_BATCH_JSON}\\n`);",
      'process.exitCode = 1;',
      '',
    ].join('\n'));

    try {
      const result = harness.runReleaseProbes(root, REQUIRED, undefined, harness.runConsumerProbe, {
        probeConcurrency: 2,
        probeTimeoutMs: 1000,
        runtimeEnv: { ...process.env, DHPK_TEST_BATCH_JSON: JSON.stringify(batch) },
      });

      assert.notStrictEqual(result.outcome, 'COMPLETE');
      assert.notStrictEqual(result.exitCode, 0);
      assert.match(result.diagnostics.join('\n'), /coordinator|exit|parallel/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('release execution rejects a non-canonical required runtime subset before COMPLETE', () => {
    assert.throws(() => harness.runReleaseProbes(
      '/tmp/dhpk-release-fixture',
      REQUIRED,
      ['claude-core'],
      (root, parsed) => ({
        outcome: 'PASS',
        surfaceResults: [{
          surface: parsed.surface,
          status: 'PASS',
          stage: 'CONSUMER',
          producer: 'fixture-probe',
        }],
      }),
    ), /runtime|required|canonical/i);
  });

  test('release execution fails closed when a probe emits malformed consumer evidence', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
      surfaceResults: [{
        surface: parsed.surface,
        status: parsed.surface === 'cursor-plugin' ? 'UNKNOWN' : 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /invalid status/i);
  });

  test('release execution rejects foreign rows and conflicting producer outcomes', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => {
      if (parsed.surface !== 'cursor-plugin') {
        return {
          outcome: 'PASS',
          surfaceResults: [{
            surface: parsed.surface,
            status: 'PASS',
            stage: 'CONSUMER',
            producer: 'fixture-probe',
          }],
        };
      }
      return {
        outcome: 'FAIL',
        surfaceResults: [
          { surface: 'cursor-plugin', status: 'PASS', stage: 'CONSUMER', producer: 'fixture-probe' },
          { surface: 'agent-plugin', status: 'FAIL', stage: 'CONSUMER', producer: 'fixture-probe' },
        ],
      };
    });

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /exactly one|foreign|result/i);
  });

  test('release execution rejects missing top-level probe outcomes', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /outcome/i);
  });

  test('release execution rejects a conflicting top-level probe outcome', () => {
    const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
      outcome: 'FAIL',
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }));

    assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
    const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
    assert.strictEqual(malformed.status, 'FAIL');
    assert.match(malformed.reasons.join('\n'), /disagrees|outcome/i);
  });

  test('missing or unknown required surfaces fail closed', () => {
    assert.throws(() => harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: REQUIRED.slice(0, -1),
      surfaceResults: all(),
      fullRelease: true,
    }), /required|surface|incomplete/i);
    assert.throws(() => harnessResult.aggregateRequiredSurfaces({
      requiredSurfaces: [...REQUIRED, 'unknown-surface'],
      surfaceResults: all(),
      fullRelease: true,
    }), /required|surface|unknown/i);
  });

  test('lifecycle phase and command outcome remain separate', () => {
    const result = harnessResult.createResult({ phase: 'verify', lifecyclePhase: 'RED', outcome: 'NOT_RUN' });
    assert.strictEqual(result.lifecyclePhase, 'RED');
    assert.strictEqual(result.outcome, 'NOT_RUN');
    assert.strictEqual(harnessResult.exitCodeForOutcome(result.outcome), 2);
  });
}

// Consolidated source suite: harness-surfaces.
{

  const { test, assert } = require('./_lib/tinytest');
  const { REQUIRED_SURFACES } = require('../scripts/lib/harness-surfaces');

  test('full-release surface identity has one canonical ordered list', () => {
    assert.deepStrictEqual(REQUIRED_SURFACES, [
      'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
      'cursor-plugin', 'agent-plugin', 'agy-plugin',
    ]);
    assert.strictEqual(Object.isFrozen(REQUIRED_SURFACES), true);
  });
}

// Consolidated source suite: harness-workflow-config.
{

  // Daily CI keeps deterministic source/package checks; consumer readiness
  // remains available through the public facade and the release workflow.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
  }

  function jobBlock(workflow, id) {
    const start = workflow.indexOf('\n  ' + id + ':\n');
    assert.ok(start !== -1, 'ci.yml must define the ' + id + ' job');
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  }

  test('daily CI omits research and consumer-readiness probes while retaining package checks', () => {
    const workflow = read('.github/workflows/ci.yml');
    const preflight = jobBlock(workflow, 'preflight');
    assert.doesNotMatch(preflight, /node scripts\/ci\/context-budget\.js\b/);
    assert.doesNotMatch(preflight, /node scripts\/ci\/subagent-context-budget\.js\b/);
    assert.doesNotMatch(preflight, /bin\/dhpk harness preflight\b/);
    assert.match(preflight, /scripts\/validate\/validate-harness\.sh/);
    assert.match(workflow, /scripts\/ci\/verify-platform-packages\.js/);
    assert.doesNotMatch(workflow, /bin\/dhpk distribution/);
  });

  test('CI derives bounded test and package verification from the authoritative plan', () => {
    const workflow = read('.github/workflows/ci.yml');
    const preflight = jobBlock(workflow, 'preflight');
    const tests = jobBlock(workflow, 'tests');
    const validate = jobBlock(workflow, 'validate');

    assert.match(preflight, /timeout-minutes:\s*10/);
    assert.doesNotMatch(preflight, /run-all\.js|run-bounded-node-test\.sh/);
    assert.match(tests, /timeout-minutes:\s*10/);
    assert.match(tests, /fail-fast:\s*false/);
    assert.match(tests, /shard:\s*\$\{\{\s*fromJSON\(needs\.plan\.outputs\.shards\)\s*\}\}/);
    assert.match(tests, /DHPK_TEST_JOBS:\s*['"]?4/);
    assert.match(tests, /DHPK_TEST_SOURCE_COMMIT:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(tests, /DHPK_TEST_HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
    assert.match(tests, /DHPK_TEST_TIMING_FILE:\s*\$\{\{\s*runner\.temp\s*\}\}\/dhpk-test-timing\.json/);
    assert.match(tests, /DHPK_CI_PLAN/);
    assert.match(tests, /testFiles/);
    assert.match(tests, /--shard-count\s+4/);

    assert.match(validate, /name: Validate harness assets/);
    assert.match(validate, /needs:\s*\[\s*plan,\s*preflight,\s*tests,\s*macos-installer,\s*release-rehearsal,\s*lint\s*\]/);
    assert.match(validate, /if:\s*always\(\)/);
    assert.match(validate, /needs\.preflight\.result/);
    assert.match(validate, /needs\.tests\.result/);
    assert.match(validate, /actions\/setup-node@[0-9a-f]{40}\s+#\s*v7\.0\.0/);
    assert.match(validate, /node-version:\s*['"]?24/);
    assert.match(validate, /verifyCiResults\(JSON\.parse\(process\.env\.PLAN\)/);
    assert.match(validate, /--count \"\$count\"/);
    assert.match(validate, /node scripts\/ci\/verify-test-shards\.js/);
    assert.match(validate, /if \[ "\$\{\{\s*needs\.plan\.outputs\.mode\s*\}\}" = "selected" \]; then count=1; fi/);
    assert.match(validate, /name: Download full test timing evidence[\s\S]*if: needs\.plan\.outputs\.mode == 'full'[\s\S]*pattern: dhpk-test-timing-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-shard-\*/);
    assert.match(validate, /name: Download selected test timing evidence[\s\S]*if: needs\.plan\.outputs\.mode == 'selected'[\s\S]*name: dhpk-test-timing-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-shard-0[\s\S]*path: \$\{\{ runner\.temp \}\}\/dhpk-test-shards\/dhpk-test-timing-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-shard-0/);
    assert.match(workflow, /Validate bounded generated companions/);
    assert.match(workflow, /generatedChecks/);
    assert.match(workflow, /claude-marketplace\) node scripts\/ci\/gen-claude-marketplace-package\.js --check/);
    assert.doesNotMatch(workflow, /claude-profile:|gen-claude-profile-bundles/);
    const packageScripts = JSON.parse(read('package.json')).scripts;
    assert.strictEqual(packageScripts['check:profiles'], undefined);
    assert.match(packageScripts['check:generated'], /check:marketplace/);
    assert.doesNotMatch(packageScripts['check:generated'], /check:profiles/);
    assert.match(workflow, /CHANGELOG_ARGS=\(\)/);
    assert.match(workflow, /--diff-base\s+"origin\/\$BASE_REF"\s+--base-ref\s+"\$BASE_REF"/);
    assert.strictEqual(
      (workflow.match(/scripts\/ci\/validate-changelog-fragments\.js/g) || []).length,
      1,
      'PR coverage must be folded into the single changelog validator invocation'
    );
  });

  test('CI forwards bot authorship to the changelog coverage gate', () => {
    const workflow = read('.github/workflows/ci.yml');
    assert.match(workflow, /PR_AUTHOR_TYPE:\s*\$\{\{\s*github\.event\.pull_request\.user\.type\s*\}\}/);
    assert.match(workflow, /if \[ "\$PR_AUTHOR_TYPE" = "Bot" \]; then[\s\S]*?CHANGELOG_ARGS\+=\(--bot-authored\)/);
  });

  test('release invokes the harness facade for the full consumer surface plan', () => {
    const workflow = read('.github/workflows/release.yml');
    assert.match(workflow, /bin\/dhpk harness release/);
    assert.match(workflow, /surfaceResults/);
  });
}

run('harness-facade-contract');
