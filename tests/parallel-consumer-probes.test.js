'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { parseArgs, namespaceFor } = require('../scripts/release/parallel-consumer-probes');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'parallel-consumer-probes.js');

function runStubbedProbe(execution, {
  worker = false,
  currentAcceptance = false,
  childExitCode = 'none',
  timeoutMs = 3000,
  hangMs = null,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parallel-probe-contract-'));
  const preload = path.join(root, 'probe-harness.js');
  const originalNodeOptions = process.env.NODE_OPTIONS || '';
  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('node:module');",
    'const cli = process.env.DHPK_PARALLEL_PROBE_CLI;',
    'const originalLoad = Module._load;',
    'Module._load = function loadWithControlledConsumerProbe(request, parent, isMain) {',
    "  if (request === '../lib/harness' && parent && parent.filename === cli) {",
    '    return {',
    '      runConsumerProbe(repoRoot, options = {}) {',
    '        if (process.env.DHPK_PARALLEL_TEST_HANG_MS !== \'none\') {',
    '          const blocker = new Int32Array(new SharedArrayBuffer(4));',
    '          Atomics.wait(blocker, 0, 0, Number(process.env.DHPK_PARALLEL_TEST_HANG_MS));',
    '        }',
    '        if (process.env.DHPK_PARALLEL_TEST_EXIT_CODE !== \'none\') {',
    '          setImmediate(() => { process.exitCode = Number(process.env.DHPK_PARALLEL_TEST_EXIT_CODE); });',
    '        }',
    '        const execution = JSON.parse(process.env.DHPK_PARALLEL_TEST_EXECUTION);',
    '        if (!execution || typeof execution !== \'object\' || Array.isArray(execution)) return execution;',
    '        const hasCurrentAcceptance = Object.prototype.hasOwnProperty.call(options, \'currentAcceptance\');',
    '        execution.probeOptions = {',
    '          hasCurrentAcceptance,',
    '          ...(hasCurrentAcceptance ? { currentAcceptance: options.currentAcceptance } : {}),',
    '        };',
    '        return execution;',
    '      },',
    '    };',
    '  }',
    '  return originalLoad.call(this, request, parent, isMain);',
    '};',
    '',
  ].join('\n'));
  const workerArgs = [
    CLI, '--worker', '--repo-root', root, '--surface', 'codex-sync', '--namespace', 'dhpk-release-probe-contract',
    ...(currentAcceptance ? ['--current-acceptance'] : []),
  ];
  const batchArgs = [
    CLI,
    '--repo-root', root,
    '--surfaces', 'codex-sync',
    '--concurrency', '1',
    '--timeout-ms', String(timeoutMs),
    '--task-id', 'parallel-contract',
    '--attempt-id', 'attempt-a1',
    ...(currentAcceptance ? ['--current-acceptance'] : []),
  ];
  try {
    return spawnSync(process.execPath, worker ? workerArgs : batchArgs, {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        NODE_OPTIONS: `${originalNodeOptions} --require "${preload}"`.trim(),
        DHPK_PARALLEL_PROBE_CLI: CLI,
        DHPK_PARALLEL_TEST_EXECUTION: JSON.stringify(execution),
        DHPK_PARALLEL_TEST_EXIT_CODE: childExitCode,
        DHPK_PARALLEL_TEST_HANG_MS: hangMs === null ? 'none' : String(hangMs),
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function acceptanceExecution(verdict = 'PASS', status = 'PASS') {
  return {
    outcome: verdict,
    acceptance: {
      verdict,
      requiredChecks: [{
        id: 'install.codex-sync',
        surface: 'codex-sync',
        kind: 'installation',
        reason: 'The selected installation contract result is recorded.',
        status,
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
      adapter: { id: 'codex-sync-installer', version: '1.0.0' },
      installationEvidence: { status },
      runtimeEvidence: { status: 'NOT_RUN' },
    }],
  };
}

test('parallel consumer coordinator requires canonical surfaces and bounds concurrency', () => {
  const args = parseArgs([
    '--repo-root', '/tmp/dhpk',
    '--surfaces', 'claude-core,codex-sync',
    '--concurrency', '99',
    '--timeout-ms', '1000',
    '--task-id', 'release-test',
    '--attempt-id', 'attempt-test',
  ]);
  assert.strictEqual(args.concurrency, 7);
  assert.strictEqual(args.timeoutMs, 1000);
  assert.match(namespaceFor(args, 'claude-core', 0), /^dhpk-release-probe-release-test-attempt-test-claude-core-0$/);
  assert.throws(() => parseArgs(['--repo-root', '/tmp/dhpk', '--surfaces', 'unknown']), /canonical/);
});

test('coordinator runs isolated child probes and reports each surface result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parallel-probe-coordinator-'));
  const preload = path.join(root, 'probe-harness.js');
  const surfaces = ['claude-core', 'codex-sync'];
  const originalNodeOptions = process.env.NODE_OPTIONS || '';
  const hostPaths = {
    home: path.join(root, 'host-home'),
    profile: path.join(root, 'host-profile'),
    codex: path.join(root, 'host-codex'),
    cursor: path.join(root, 'host-cursor'),
    agy: path.join(root, 'host-agy'),
  };

  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('node:module');",
    "const fs = require('node:fs');",
    'const cli = process.env.DHPK_PARALLEL_PROBE_CLI;',
    'const originalLoad = Module._load;',
    'Module._load = function loadWithControlledConsumerProbe(request, parent, isMain) {',
    "  if (request === '../lib/harness' && parent && parent.filename === cli) {",
    '    return {',
    '      runConsumerProbe(repoRoot, { surface }) {',
    '        return {',
    "          outcome: 'PASS',",
    '          acceptance: {',
    "            verdict: 'PASS',",
    '            requiredChecks: [{',
    '              id: `install.${surface}`, surface, kind: \'installation\',',
    "              reason: 'The selected installation contract passed.', status: 'PASS',",
    '              evidenceRef: `surfaceResults.${surface}.installationEvidence`,',
    '            }],',
    '            excludedChecks: [{',
    '              id: `native.${surface}`, surface, kind: \'native\',',
    "              reason: 'Native execution was not required.', status: 'NOT_RUN',",
    '              evidenceRef: `surfaceResults.${surface}.runtimeEvidence`,',
    '            }],',
    '          },',
    '          surfaceResults: [{',
    "            surface, status: 'NOT_RUN', stage: 'CONSUMER', producer: 'consumer-gate',",
    "            adapter: { id: 'consumer-installation', version: '1.0.0' },",
    "            installationEvidence: { status: 'PASS' }, runtimeEvidence: { status: 'NOT_RUN' },",
    '          }],',
    '          probeEnvironment: {',
    '            repoRoot, surface,',
    '            namespace: process.env.DHPK_HARNESS_PROBE_NAMESPACE,',
    '            receiptRoot: process.env.DHPK_HARNESS_RECEIPT_ROOT,',
    '            receiptRootExists: fs.existsSync(process.env.DHPK_HARNESS_RECEIPT_ROOT),',
    '            taskId: process.env.DHPK_HARNESS_PROBE_TASK_ID,',
    '            attemptId: process.env.DHPK_HARNESS_PROBE_ATTEMPT_ID,',
    '            home: process.env.HOME,',
    '            homeExists: fs.existsSync(process.env.HOME),',
    '            userProfile: process.env.USERPROFILE,',
    '            xdgConfig: process.env.XDG_CONFIG_HOME,',
    '            xdgData: process.env.XDG_DATA_HOME,',
    '            xdgCache: process.env.XDG_CACHE_HOME,',
    '            codexHome: process.env.CODEX_HOME,',
    '            hostCodexHome: process.env.DHPK_CONSUMER_PROBE_HOST_CODEX_HOME,',
    '            cursorHostHome: process.env.DHPK_CURSOR_HOST_HOME,',
    '            agyHostHome: process.env.DHPK_AGY_HOST_HOME,',
    '          },',
    '        };',
    '      },',
    '    };',
    '  }',
    '  return originalLoad.call(this, request, parent, isMain);',
    '};',
    '',
  ].join('\n'));

  try {
    const res = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--surfaces', surfaces.join(','),
      '--concurrency', '2',
      '--timeout-ms', '3000',
      '--task-id', 'issue-660',
      '--attempt-id', 'attempt-a1',
    ], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        NODE_OPTIONS: `${originalNodeOptions} --require "${preload}"`.trim(),
        DHPK_PARALLEL_PROBE_CLI: CLI,
        HOME: hostPaths.home,
        USERPROFILE: hostPaths.profile,
        CODEX_HOME: hostPaths.codex,
        DHPK_CURSOR_HOST_HOME: hostPaths.cursor,
        DHPK_AGY_HOST_HOME: hostPaths.agy,
      },
    });
    assert.strictEqual(res.status, 0, res.stderr);

    const batch = JSON.parse(res.stdout);
    assert.strictEqual(batch.schema, 'dhpk.release-consumer-probe-batch.v1');
    assert.strictEqual(batch.concurrency, 2);
    assert.strictEqual(batch.timeoutMs, 3000);
    assert.deepStrictEqual(batch.surfaces, surfaces);
    assert.strictEqual(batch.results.length, surfaces.length);

    const bySurface = new Map(batch.results.map((result) => [result.surface, result]));
    assert.deepStrictEqual([...bySurface.keys()].sort(), [...surfaces].sort());
    const namespaces = new Set();
    for (const surface of surfaces) {
      const result = bySurface.get(surface);
      const env = result.execution.probeEnvironment;
      assert.strictEqual(result.execution.outcome, 'PASS');
      assert.strictEqual(result.diagnostic, null);
      assert.deepStrictEqual(result.execution.acceptance, {
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
          id: `native.${surface}`,
          surface,
          kind: 'native',
          reason: 'Native execution was not required.',
          status: 'NOT_RUN',
          evidenceRef: `surfaceResults.${surface}.runtimeEvidence`,
        }],
      });
      assert.strictEqual(result.execution.surfaceResults[0].status, 'NOT_RUN');
      assert.strictEqual(result.execution.surfaceResults[0].installationEvidence.status, 'PASS');
      assert.strictEqual(result.execution.surfaceResults[0].runtimeEvidence.status, 'NOT_RUN');
      assert.match(result.namespace, new RegExp(`^dhpk-release-probe-issue-660-attempt-a1-${surface}-\\d+$`));
      assert.strictEqual(env.repoRoot, root);
      assert.strictEqual(env.surface, surface);
      assert.strictEqual(env.namespace, result.namespace);
      assert.strictEqual(env.taskId, 'issue-660');
      assert.strictEqual(env.attemptId, 'attempt-a1');
      assert.ok(env.receiptRoot.includes(`${path.sep}${result.namespace}${path.sep}receipts`));
      assert.ok(env.home.includes(`${path.sep}${result.namespace}${path.sep}home`));
      assert.strictEqual(env.homeExists, true, 'private worker home must exist while the child runs');
      assert.strictEqual(env.receiptRootExists, true, 'private receipt root must exist while the child runs');
      assert.strictEqual(env.userProfile, env.home);
      assert.ok(env.xdgConfig.startsWith(env.home));
      assert.ok(env.xdgData.startsWith(env.home));
      assert.ok(env.xdgCache.startsWith(env.home));
      assert.ok(env.codexHome.startsWith(env.home));
      assert.strictEqual(env.hostCodexHome, hostPaths.codex);
      assert.strictEqual(env.cursorHostHome, hostPaths.cursor);
      assert.strictEqual(env.agyHostHome, hostPaths.agy);
      assert.ok(!fs.existsSync(env.home), 'private worker home must be removed after aggregation');
      assert.ok(!fs.existsSync(env.receiptRoot), 'private receipt root must be removed after aggregation');
      namespaces.add(result.namespace);
    }
    assert.strictEqual(namespaces.size, surfaces.length, 'each surface must receive a distinct namespace');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('worker exit status follows the current acceptance verdict', () => {
  const execution = acceptanceExecution('BLOCKED', 'UNAVAILABLE');
  const res = runStubbedProbe(execution, { worker: true });

  assert.strictEqual(res.status, 1, res.stderr);
  const worker = JSON.parse(res.stdout);
  assert.deepStrictEqual(worker.execution.acceptance, execution.acceptance);
  assert.strictEqual(worker.execution.surfaceResults[0].status, 'NOT_RUN');
  assert.deepStrictEqual(worker.execution.probeOptions, { hasCurrentAcceptance: false });
});

test('coordinator transports current acceptance mode to its worker harness call', () => {
  const execution = acceptanceExecution('PASS', 'PASS');
  const res = runStubbedProbe(execution, { currentAcceptance: true });

  assert.strictEqual(res.status, 0, res.stderr);
  const batch = JSON.parse(res.stdout);
  assert.deepStrictEqual(batch.results[0].execution.probeOptions, {
    hasCurrentAcceptance: true,
    currentAcceptance: true,
  });
});

test('current probe with no consumer gate fails transport without reaching legacy execute fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parallel-current-no-gate-'));
  const releaseDirectory = path.join(root, 'scripts', 'release');
  const fallbackArgsFile = path.join(root, 'fallback-args.jsonl');
  fs.mkdirSync(releaseDirectory, { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agent'), { recursive: true });
  fs.writeFileSync(path.join(releaseDirectory, 'consumer-platform-probe.js'), [
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.DHPK_FALLBACK_ARGS_FILE, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "process.stdout.write(JSON.stringify({ status: 'PASS', stage: 'CONSUMER', producer: 'consumer-platform-probe', commands: [], artifacts: [], diagnostics: [], reasons: [], checkedClaims: ['consumer-route'] }));",
  ].join('\n') + '\n');

  try {
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--surfaces', 'agent-plugin',
      '--concurrency', '2',
      '--timeout-ms', '3000',
      '--task-id', 'current-no-gate',
      '--attempt-id', 'attempt-a1',
      '--current-acceptance',
    ], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        CI: 'true',
        DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '1',
        DHPK_FALLBACK_ARGS_FILE: fallbackArgsFile,
      },
    });

    assert.strictEqual(result.status, 1, `${result.stderr}\n${result.stdout}`);
    const batch = JSON.parse(result.stdout);
    assert.strictEqual(batch.results.length, 1);
    assert.strictEqual(batch.results[0].transportStatus, 'FAIL');
    assert.match(batch.results[0].diagnostic, /current|acceptance|evidence/i);
    assert.strictEqual(batch.results[0].execution.outcome, 'FAIL');
    assert.strictEqual(fs.existsSync(fallbackArgsFile), false, 'current mode invoked the legacy consumer-platform-probe fallback');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('coordinator fails when worker exit contradicts passing acceptance JSON', () => {
  const execution = acceptanceExecution('PASS', 'PASS');
  const res = runStubbedProbe(execution, { childExitCode: '1' });

  assert.strictEqual(res.status, 1, res.stderr);
  const batch = JSON.parse(res.stdout);
  const worker = batch.results[0];
  assert.deepStrictEqual(worker.execution.acceptance, execution.acceptance);
  assert.deepStrictEqual(worker.execution.surfaceResults, execution.surfaceResults);
  assert.match(worker.diagnostic, /exit|contradict/i);
});

test('coordinator rejects worker JSON that omits its execution result', () => {
  const res = runStubbedProbe(null);

  assert.strictEqual(res.status, 1, res.stderr);
  const batch = JSON.parse(res.stdout);
  assert.strictEqual(batch.results[0].transportStatus, 'FAIL');
  assert.match(batch.results[0].diagnostic, /execution|result/i);
});

test('coordinator marks a timed-out worker as failed transport', () => {
  const res = runStubbedProbe(acceptanceExecution('PASS', 'PASS'), {
    timeoutMs: 1000,
    hangMs: 5000,
  });

  assert.strictEqual(res.status, 1, res.stderr);
  const result = JSON.parse(res.stdout).results[0];
  assert.strictEqual(result.transportStatus, 'FAIL');
  assert.match(result.diagnostic, /timeout|timed out|ETIMEDOUT/i);
});



// Consolidated source suite: release-probe-batch (tests/release-probe-batch.test.js).
{
  const { mapWithConcurrency, normalizeConcurrency } = require('../scripts/lib/release-probe-batch');

  test('bounded probe batch preserves order and caps live workers', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency(['a', 'b', 'c', 'd', 'e'], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 'a' ? 12 : 4));
      active -= 1;
      return value.toUpperCase();
    });
    assert.deepStrictEqual(result, ['A', 'B', 'C', 'D', 'E']);
    assert.strictEqual(peak, 2);
  });

  test('bounded probe concurrency is clamped to the configured maximum', () => {
    assert.strictEqual(normalizeConcurrency(99, { maximum: 4 }), 4);
    assert.throws(() => normalizeConcurrency(0), /positive integer/);
  });
}

run('parallel-consumer-probes');
