'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { verifyShardReports, main } = require('../scripts/ci/verify-test-shards');
const { classifyChangedPaths, createCiPlan, validateCiPlan, verifyCiResults, packageSurfacesForFiles } = require('../scripts/lib/ci-plan');

function gitFixture(setup, mutate, baseRef = 'develop') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-plan-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test'); git('config', 'commit.gpgsign', 'false');
    setup(root); git('add', '.');
    git('commit', '--no-verify', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD');
    mutate(root, git); git('add', '-A'); git('commit', '--no-verify', '-m', 'head');
    const headSha = git('rev-parse', 'HEAD');
    const checkoutSha = headSha;
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'plan', '--base-sha', baseSha, '--head-sha', headSha, '--checkout-sha', checkoutSha, '--base-ref', baseRef], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    return { root, baseSha, headSha, checkoutSha, plan: JSON.parse(result.stdout) };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true }); throw error;
  }
}

const SHARD_COUNT = 4;
const RUN_ID = '123';
const RUN_ATTEMPT = '1';
const CHECKOUT_SHA = '0123456789abcdef0123456789abcdef01234567';
const HEAD_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const SHARD_FILES = [
  ['alpha.test.js'],
  ['nested/beta.test.js'],
  ['gamma.test.js'],
  ['nested/delta.test.js'],
];
const SHARD_DURATIONS = [900, 1700, 1100, 1200];

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-test-shards-'));
  const testsDir = path.join(root, 'tests');
  const directory = path.join(root, 'artifacts');
  fs.mkdirSync(path.join(testsDir, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(testsDir, '_lib'), { recursive: true });
  fs.mkdirSync(directory, { recursive: true });

  for (const file of SHARD_FILES.flat()) {
    const target = path.join(testsDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// fixture test file\n');
  }
  // Mirrors tests/run-all.js discovery: this nested test file is excluded.
  fs.writeFileSync(path.join(testsDir, '_lib', 'ignored.test.js'), '// ignored\n');
  fs.writeFileSync(path.join(testsDir, 'notes.txt'), 'not a test\n');

  for (let shardIndex = 0; shardIndex < SHARD_COUNT; shardIndex += 1) {
    writeShardReport({ root, directory, shardIndex, files: SHARD_FILES[shardIndex] });
  }

  return { root, testsDir, directory };
}

function artifactPath(directory, shardIndex) {
  return path.join(
    directory,
    `dhpk-test-timing-${RUN_ID}-${RUN_ATTEMPT}-shard-${shardIndex}`,
    'dhpk-test-timing.json',
  );
}

function fileTiming(file, index) {
  return {
    file,
    duration_ms: 100 + index,
    status: 'PASS',
    assertions: { status: 'OBSERVED', total: 3, passed: 3, failed: 0, skipped: 0 },
  };
}

function createReport(shardIndex, files) {
  const fileTimings = files.map(fileTiming);
  return {
    schema: 'dhpk.test-timing.v1',
    generated_at: '2026-09-29T00:00:00.000Z',
    source_commit: CHECKOUT_SHA,
    ci: { run_id: RUN_ID, run_attempt: RUN_ATTEMPT, head_sha: HEAD_SHA },
    runner: {
      command: 'node tests/run-all.js',
      node: 'v24.21.0',
      platform: 'linux',
      jobs: 4,
      mode: 'parallel',
      shard_index: shardIndex,
      shard_count: SHARD_COUNT,
    },
    duration_ms: SHARD_DURATIONS[shardIndex] || 1300,
    totals: { files: files.length, failed: 0 },
    suites: {
      smoke: { status: 'OBSERVED', files: 0, assertions: { total: 0, passed: 0, failed: 0, skipped: 0 } },
      full_suite: {
        status: 'OBSERVED',
        files: files.length,
        assertions: { total: files.length * 3, passed: files.length * 3, failed: 0, skipped: 0 },
      },
    },
    files: fileTimings,
    jobs: [{ worker_index: 0, duration_ms: 100, status: 'PASS', files: fileTimings }],
  };
}

function writeShardReport({ directory, shardIndex, files, report }) {
  const target = artifactPath(directory, shardIndex);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report || createReport(shardIndex, files), null, 2));
  return target;
}

function readShardReport(directory, shardIndex) {
  return JSON.parse(fs.readFileSync(artifactPath(directory, shardIndex), 'utf8'));
}

function writeChangedReport(directory, shardIndex, change) {
  const report = readShardReport(directory, shardIndex);
  change(report);
  fs.writeFileSync(artifactPath(directory, shardIndex), JSON.stringify(report, null, 2));
}

function syncReportFileAggregates(report) {
  const files = report.files;
  const assertions = files.reduce((summary, file) => {
    summary.total += file.assertions.total;
    summary.passed += file.assertions.passed;
    summary.failed += file.assertions.failed;
    summary.skipped += file.assertions.skipped;
    return summary;
  }, { total: 0, passed: 0, failed: 0, skipped: 0 });
  report.totals.files = files.length;
  report.totals.failed = files.filter((file) => file.status === 'FAIL').length;
  report.suites.full_suite.files = files.length;
  report.suites.full_suite.assertions = assertions;
  report.jobs = report.jobs.map((job) => ({
    ...job,
    duration_ms: files.reduce((sum, file) => sum + file.duration_ms, 0),
    status: report.totals.failed === 0 ? 'PASS' : 'FAIL',
    files: files.map((file) => ({ ...file, assertions: { ...file.assertions } })),
  }));
}

function verify({ root, directory, overrides = {} }) {
  return verifyShardReports({
    root,
    directory,
    shardCount: SHARD_COUNT,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    checkoutSha: CHECKOUT_SHA,
    headSha: HEAD_SHA,
    ...overrides,
  });
}

function setShardDurations(directory, durations) {
  durations.forEach((durationMs, shardIndex) => {
    writeChangedReport(directory, shardIndex, (report) => { report.duration_ms = durationMs; });
  });
}

function runMainSummary({ root, directory }) {
  const summaryPath = path.join(root, 'summary.md');
  const previousDirectory = process.cwd();
  try {
    process.chdir(root);
    const exitCode = main([
      '--directory', directory,
      '--count', String(SHARD_COUNT),
      '--run-id', RUN_ID,
      '--run-attempt', RUN_ATTEMPT,
      '--checkout-sha', CHECKOUT_SHA,
      '--head-sha', HEAD_SHA,
      '--summary', summaryPath,
    ]);
    return { exitCode, summary: fs.readFileSync(summaryPath, 'utf8') };
  } finally {
    process.chdir(previousDirectory);
  }
}

function assertRejected(result) {
  assert.strictEqual(result.ok, false);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'rejection must include an error');
}

function withFixture(callback) {
  const fixture = makeFixture();
  try {
    callback(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('valid four-shard reports aggregate files, assertions, and parallel wall time', () => {
  withFixture(({ root, directory }) => {
    const result = verify({ root, directory });
    assert.strictEqual(result.ok, true, (result.errors || []).join('\n'));
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.durationMs, 1700);
    assert.strictEqual(result.files, 4);
    assert.deepStrictEqual(result.assertions, { total: 12, passed: 12, failed: 0, skipped: 0 });
  });
});

test('validated shard summary warns above a max/min ratio of 2.0 without failing verification', () => {
  withFixture(({ root, directory }) => {
    setShardDurations(directory, [43.3, 86.7, 43.3, 43.3]);
    const result = verify({ root, directory });
    assert.strictEqual(result.ok, true, (result.errors || []).join('\n'));
    const { exitCode, summary } = runMainSummary({ root, directory });
    assert.strictEqual(exitCode, 0);
    assert.match(summary, /imbalance/i);
  });
});

test('validated shard summary does not warn when max/min ratio is exactly 2.0', () => {
  withFixture(({ root, directory }) => {
    const durations = [43.3, 86.6, 43.3, 43.3];
    setShardDurations(directory, durations);
    assert.strictEqual(Math.max(...durations) / Math.min(...durations), 2.0);
    const result = verify({ root, directory });
    assert.strictEqual(result.ok, true, (result.errors || []).join('\n'));
    const { exitCode, summary } = runMainSummary({ root, directory });
    assert.strictEqual(exitCode, 0);
    assert.ok(!/imbalance/i.test(summary), 'a ratio equal to 2.0 must not warn');
  });
});

test('validated shard summary warns when a positive duration has a zero minimum', () => {
  withFixture(({ root, directory }) => {
    setShardDurations(directory, [0, 10, 3, 4]);
    const result = verify({ root, directory });
    assert.strictEqual(result.ok, true, (result.errors || []).join('\n'));
    const { exitCode, summary } = runMainSummary({ root, directory });
    assert.strictEqual(exitCode, 0);
    assert.match(summary, /imbalance/i);
  });
});

test('an empty smoke suite accepts the partial evidence emitted by run-all', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => {
      report.suites.smoke = {
        status: 'PARTIAL',
        files: 0,
        assertions: { total: 0, passed: 0, failed: 0, skipped: null },
      };
    });
    const result = verify({ root, directory });
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
  });
});

test('worker timing records must cover every reported test file', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => { report.jobs = []; });
    assertRejected(verify({ root, directory }));
  });
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => { report.jobs[0].files = []; });
    assertRejected(verify({ root, directory }));
  });
});

test('missing shard timing report is rejected', () => {
  withFixture(({ root, directory }) => {
    fs.rmSync(artifactPath(directory, 2));
    assertRejected(verify({ root, directory }));
  });
});

test('duplicate shard index across timing reports is rejected', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 1, (report) => { report.runner.shard_index = 0; });
    assertRejected(verify({ root, directory }));
  });
});

test('extra shard timing report is rejected', () => {
  withFixture(({ root, directory }) => {
    writeShardReport({ directory, shardIndex: 4, files: [] });
    assertRejected(verify({ root, directory }));
  });
});

test('checkout commit and pull-request head must match the requested run', () => {
  for (const override of [
    { checkoutSha: 'fedcba9876543210fedcba9876543210fedcba98' },
    { headSha: 'fedcba9876543210fedcba9876543210fedcba98' },
  ]) {
    withFixture(({ root, directory }) => assertRejected(verify({ root, directory, overrides: override })));
  }
});

test('run id and attempt must match every shard report', () => {
  for (const override of [{ runId: '124' }, { runAttempt: '2' }]) {
    withFixture(({ root, directory }) => assertRejected(verify({ root, directory, overrides: override })));
  }
});

test('shard index, shard count, and worker count must match the CI topology', () => {
  for (const [field, value] of [['shard_index', 1], ['shard_count', 3], ['jobs', 3]]) {
    withFixture(({ root, directory }) => {
      writeChangedReport(directory, 0, (report) => { report.runner[field] = value; });
      assertRejected(verify({ root, directory }));
    });
  }
});

test('reported test files must match live discovery exactly once', () => {
  const mutations = [
    (report) => { report.files = []; },
    (report) => { report.files.push({ ...report.files[0], assertions: { ...report.files[0].assertions } }); },
    (report) => { report.files[0].file = 'unlisted.test.js'; },
  ];
  for (const mutate of mutations) {
    withFixture(({ root, directory }) => {
      writeChangedReport(directory, 0, (report) => {
        mutate(report);
        syncReportFileAggregates(report);
      });
      assertRejected(verify({ root, directory }));
    });
  }
});

test('a newly discovered test without a shard result is rejected', () => {
  withFixture(({ root, testsDir, directory }) => {
    fs.writeFileSync(path.join(testsDir, 'newly-added.test.js'), '// newly discovered\n');
    assertRejected(verify({ root, directory }));
  });
});

test('a failed test-file status is rejected', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => {
      report.files[0].status = 'FAIL';
      syncReportFileAggregates(report);
    });
    assertRejected(verify({ root, directory }));
  });
});

test('failed test assertions are rejected even when the file status says pass', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => {
      report.files[0].assertions.passed = 2;
      report.files[0].assertions.failed = 1;
      syncReportFileAggregates(report);
    });
    assertRejected(verify({ root, directory }));
  });
});

test('missing shard duration is rejected as absent timing evidence', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => { delete report.duration_ms; });
    assertRejected(verify({ root, directory }));
  });
});

test('missing per-file duration is rejected as incomplete timing evidence', () => {
  withFixture(({ root, directory }) => {
    writeChangedReport(directory, 0, (report) => { delete report.files[0].duration_ms; });
    assertRejected(verify({ root, directory }));
  });
});

test('malformed shard timing JSON is rejected', () => {
  withFixture(({ root, directory }) => {
    fs.writeFileSync(artifactPath(directory, 0), '{');
    assertRejected(verify({ root, directory }));
  });
});

{
  // Collected cases from tests/run-all.test.js.
  // Contract coverage for the aggregate test runner's bounded scheduling.  The
  // runner must remain usable as a CLI while exposing deterministic planning
  // helpers so CI can prove that every test file is assigned exactly once.

  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const {
    parseOptions,
    assignShard,
    partitionFiles,
    findTests,
    fileTimeoutMs,
    createTimingReport,
    parseTimingPayload,
  } = require('./run-all');

  test('default options preserve the complete sequential runner contract', () => {
    assert.deepStrictEqual(parseOptions([], {}), {
      shardIndex: 0,
      shardCount: 1,
      jobs: 1,
      worker: false,
      files: [],
    });
  });

  test('CLI options accept a bounded shard and worker-pool configuration', () => {
    assert.deepStrictEqual(parseOptions([
      '--shard-index', '2',
      '--shard-count', '4',
      '--jobs', '3',
    ]), {
      shardIndex: 2,
      shardCount: 4,
      jobs: 3,
      worker: false,
      files: [],
    });
    assert.strictEqual(parseOptions(['--shard-index', '0', '--shard-count', '4']).shardIndex, 0);
  });

  test('invalid shard and job values fail closed before scheduling', () => {
    for (const argv of [
      ['--shard-index', '-1', '--shard-count', '4'],
      ['--shard-index', '4', '--shard-count', '4'],
      ['--shard-index', '0', '--shard-count', '0'],
      ['--jobs', '0'],
      ['--jobs', '9'],
    ]) {
      assert.throws(() => parseOptions(argv), /invalid|must be|range/i, argv.join(' '));
    }
  });

  test('installer and harness-release files keep a longer timeout than the default 180s budget', () => {
    assert.strictEqual(fileTimeoutMs('tests/install-codex-skills.test.js', 180000), 180000);
    assert.strictEqual(fileTimeoutMs('tests/install-codex-skills-reconciliation.test.js', 180000), 300000);
    assert.strictEqual(fileTimeoutMs('tests/harness-facade-cli.test.js', 180000), 240000);
    assert.strictEqual(fileTimeoutMs('tests/alpha.test.js', 180000), 180000);
    assert.strictEqual(fileTimeoutMs('tests/install-codex-skills-reconciliation.test.js', 400000), 400000);
  });

  test('weighted partition assigns every selected file exactly once', () => {
    const files = [
      'install-codex-skills.test.js',
      'install-codex-skills-reconciliation.test.js',
      'install-codex-skills-planning.test.js',
      'install-codex-skills-uninstall.test.js',
      'consumer-gate-cli.test.js',
      'run-codex.test.js',
      'validate-retirement-closure.test.js',
      'alpha.test.js',
      'beta.test.js',
      'gamma.test.js',
      'delta.test.js',
    ].map((name) => path.join('/repo/tests', name));
    const buckets = partitionFiles(files, 3);
    const flattened = buckets.flat();

    assert.strictEqual(flattened.length, files.length);
    assert.deepStrictEqual(new Set(flattened), new Set(files));
    assert.ok(buckets.every((bucket) => bucket.length > 0));
  });

  test('CI-sized weighted partition separates the heaviest split installer file', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-scheduler-'));
    try {
      const fillerFiles = Array.from({ length: 5 }, (_, index) => {
        const file = path.join(fixtureRoot, `filler-${index}.test.js`);
        fs.writeFileSync(file, Buffer.alloc(53 * 2048));
        return file;
      });
      const files = [
        'install-codex-skills.test.js',
        'install-codex-skills-reconciliation.test.js',
        'install-codex-skills-planning.test.js',
        'install-codex-skills-uninstall.test.js',
        'consumer-gate-cli.test.js',
        'gen-cursor-plugin-package.test.js',
        'harness-facade-cli.test.js',
        'run-codex.test.js',
        ...fillerFiles,
        'validate-retirement-closure.test.js',
      ].map((name) => path.isAbsolute(name) ? name : path.join(__dirname, name));
      const buckets = partitionFiles(files, 4);
      const workerFor = (name) => buckets.findIndex((bucket) => (
        bucket.some((file) => path.basename(file) === name)
      ));

      assert.notStrictEqual(
        workerFor('install-codex-skills-reconciliation.test.js'),
        workerFor('consumer-gate-cli.test.js'),
        'CI worker pool must not co-schedule the heaviest split installer file with consumer-gate',
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('shard assignment is deterministic and covers every shard', () => {
    const files = Array.from({ length: 20 }, (_, i) => `/repo/tests/${i}.test.js`);
    const assignments = files.map((file) => assignShard(file, 4));
    assert.deepStrictEqual(assignments, files.map((file) => assignShard(file, 4)));
    assert.deepStrictEqual([...new Set(assignments)].sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  test('worker mode accepts an explicit file list without rediscovering the tree', () => {
    const parsed = parseOptions(['--worker', '/repo/tests/a.test.js', '/repo/tests/b.test.js']);
    assert.deepStrictEqual(parsed, {
      shardIndex: 0,
      shardCount: 1,
      jobs: 1,
      worker: true,
      files: ['/repo/tests/a.test.js', '/repo/tests/b.test.js'],
    });
    assert.throws(() => parseOptions(['--worker']), /requires at least one test file/i);
  });

  test('timing reports preserve per-file and worker evidence without changing scheduling options', () => {
    const report = createTimingReport({
      options: parseOptions(['--jobs', '2']),
      result: {
        failed: 1,
        total: 2,
        fileTimings: [
          { file: 'alpha.test.js', duration_ms: 12, status: 'PASS', assertions: { status: 'OBSERVED', total: 2, passed: 2, failed: 0, skipped: 0 } },
          { file: 'beta.test.js', duration_ms: 34, status: 'FAIL', assertions: { status: 'OBSERVED', total: 3, passed: 2, failed: 1, skipped: 0 } },
        ],
        jobTimings: [{ worker_index: 0, duration_ms: 35, files: [] }],
      },
      durationMs: 42,
      sourceEnv: { DHPK_TEST_SOURCE_COMMIT: 'abc123' },
    });

    assert.strictEqual(report.schema, 'dhpk.test-timing.v1');
    assert.strictEqual(report.source_commit, 'abc123');
    assert.deepStrictEqual(report.ci, {
      run_id: null,
      run_attempt: null,
      event: null,
      ref: null,
      head_sha: null,
      base_ref: null,
      base_sha: null,
    });
    assert.strictEqual(report.runner.jobs, 2);
    assert.strictEqual(report.totals.failed, 1);
    assert.deepStrictEqual(report.suites.full_suite.assertions, { total: 5, passed: 4, failed: 1, skipped: 0 });
    assert.strictEqual(report.suites.smoke.files, 0);
    assert.deepStrictEqual(report.files.map((entry) => entry.file), ['alpha.test.js', 'beta.test.js']);
    assert.strictEqual(report.jobs[0].duration_ms, 35);
  });

  test('timing reports preserve CI run identity without changing test scheduling', () => {
    const report = createTimingReport({
      options: parseOptions(['--jobs', '2']),
      result: { failed: 0, total: 0, fileTimings: [], jobTimings: [] },
      durationMs: 5,
      sourceEnv: {
        DHPK_TEST_SOURCE_COMMIT: 'head123',
        DHPK_TEST_RUN_ID: '99',
        DHPK_TEST_RUN_ATTEMPT: '3',
        DHPK_TEST_EVENT: 'pull_request',
        DHPK_TEST_REF: 'refs/pull/1/merge',
        DHPK_TEST_HEAD_SHA: 'head123',
        DHPK_TEST_BASE_REF: 'develop',
        DHPK_TEST_BASE_SHA: 'base456',
      },
    });
    assert.deepStrictEqual(report.ci, {
      run_id: '99',
      run_attempt: '3',
      event: 'pull_request',
      ref: 'refs/pull/1/merge',
      head_sha: 'head123',
      base_ref: 'develop',
      base_sha: 'base456',
    });
    assert.deepStrictEqual(report.suites, {
      smoke: { status: 'PARTIAL', files: 0, assertions: { total: 0, passed: 0, failed: 0, skipped: null } },
      full_suite: { status: 'PARTIAL', files: 0, assertions: { total: 0, passed: 0, failed: 0, skipped: null } },
    });
  });

  test('timing report write failures do not replace the aggregate test result', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-timing-directory-'));
    try {
      const oneTestFile = path.join(directory, 'one-test.test.js');
      const tinytestPath = path.join(__dirname, '_lib', 'tinytest');
      fs.writeFileSync(oneTestFile, [
        "'use strict';",
        'const { test, run, assert } = require(' + JSON.stringify(tinytestPath) + ');',
        "test('external fixture registers one assertion through tinytest', () => {",
        '  assert.strictEqual(true, true);',
        '});',
        "run('external-one-test');",
        '',
      ].join('\n'));
      const childEnv = { ...process.env, DHPK_TEST_TIMING_FILE: directory, DHPK_TEST_JOBS: '1' };
      delete childEnv.DHPK_TEST_TIMING_CHILD;
      const result = spawnSync(process.execPath, [path.join(__dirname, 'run-all.js'), oneTestFile], {
        cwd: path.join(__dirname, '..'),
        env: childEnv,
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stdout + '\n' + result.stderr);
      assert.match(result.stdout, /external-one-test: 1\/1 passed/);
      assert.match(result.stderr, /unable to write test timing report/i);
      assert.match(result.stdout, /PASS: 1\/1 test file/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('worker timing payloads are machine-readable and tolerate ordinary test output', () => {
    const payload = { duration_ms: 17, file_timings: [{ file: 'a.test.js', duration_ms: 17, status: 'PASS' }] };
    assert.deepStrictEqual(
      parseTimingPayload(`ordinary output\nDHPK_TEST_TIMING_PAYLOAD=${JSON.stringify(payload)}\n`),
      payload,
    );
    assert.strictEqual(parseTimingPayload('ordinary output\n'), null);
    assert.strictEqual(parseTimingPayload('DHPK_TEST_TIMING_PAYLOAD={invalid}\n'), null);
  });

  test('discovered tests stay flat except skipped _lib', () => {
    const files = findTests(__dirname);
    const nested = files.filter((file) => path.relative(__dirname, file).split(path.sep).length > 1);
    assert.deepStrictEqual(nested, [], `nested *.test.js must not exist: ${nested.join(', ')}`);
    const libDir = path.join(__dirname, '_lib');
    const libNested = fs.existsSync(libDir)
      ? fs.readdirSync(libDir).filter((name) => name.endsWith('.test.js'))
      : [];
    assert.deepStrictEqual(libNested, [], '_lib must not hold discovered *.test.js files');
  });
}

{
  // Collected cases from tests/render-test-timing.test.js.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    readTimingFile,
    summarizeTiming,
  } = require('../scripts/ci/render-test-timing');

  function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-timing-summary-'));
  }

  function summarizeFiles(files) {
    const root = tempDir();
    try {
      const file = path.join(root, 'timing.json');
      fs.writeFileSync(file, JSON.stringify({
        schema: 'dhpk.test-timing.v1',
        source_commit: 'abc123',
        ci: { run_id: '42', run_attempt: '2', event: 'pull_request', ref: 'refs/pull/1/merge', base_ref: 'develop', base_sha: 'base456' },
        runner: { node: 'v20.1.0', platform: 'linux', command: 'node tests/run-all.js', jobs: 4, shard_index: 0, shard_count: 1 },
        duration_ms: files.reduce((sum, entry) => sum + entry.duration_ms, 0),
        totals: { files: files.length, failed: 0 },
        suites: {
          smoke: { status: 'OBSERVED', files: 0, assertions: { total: 0, passed: 0, failed: 0, skipped: 0 } },
          full_suite: { status: 'OBSERVED', files: files.length, assertions: { total: files.length, passed: files.length, failed: 0, skipped: 0 } },
        },
        files,
      }));
      const observed = readTimingFile(file);
      assert.strictEqual(observed.status, 'OBSERVED');
      return summarizeTiming(observed);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  test('valid timing evidence renders identity, runtime, slowest, and failed files', () => {
    const root = tempDir();
    try {
      const file = path.join(root, 'timing.json');
      fs.writeFileSync(file, JSON.stringify({
        schema: 'dhpk.test-timing.v1',
        source_commit: 'abc123',
        ci: { run_id: '42', run_attempt: '2', event: 'pull_request', ref: 'refs/pull/1/merge', base_ref: 'develop', base_sha: 'base456' },
        runner: { node: 'v20.1.0', platform: 'linux', command: 'node tests/run-all.js', jobs: 4, shard_index: 0, shard_count: 1 },
        duration_ms: 1200,
        totals: { files: 2, failed: 1 },
        suites: {
          smoke: { status: 'OBSERVED', files: 1, assertions: { total: 2, passed: 2, failed: 0, skipped: 0 } },
          full_suite: { status: 'OBSERVED', files: 2, assertions: { total: 5, passed: 4, failed: 1, skipped: 0 } },
        },
        files: [
          { file: 'fast.test.js', duration_ms: 20, status: 'PASS' },
          { file: 'slow.test.js', duration_ms: 1000, status: 'FAIL' },
        ],
      }));
      const observed = readTimingFile(file);
      const output = summarizeTiming(observed);
      assert.strictEqual(observed.status, 'OBSERVED');
      assert.match(output, /abc123/);
      assert.match(output, /42/);
      assert.match(output, /base456/);
      assert.match(output, /Suite assertion evidence/);
      assert.match(output, /full suite: OBSERVED; files=2; assertions=5; skipped=0/);
      assert.match(output, /slow\.test\.js/);
      assert.match(output, /Failed files/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing and malformed timing evidence remain explicit without becoming a test failure', () => {
    const root = tempDir();
    try {
      const missing = readTimingFile(path.join(root, 'missing.json'));
      assert.strictEqual(missing.status, 'NOT_RUN');
      assert.match(summarizeTiming(missing), /not produced/);
      const malformed = path.join(root, 'malformed.json');
      fs.writeFileSync(malformed, '{');
      const unavailable = readTimingFile(malformed);
      assert.strictEqual(unavailable.status, 'UNAVAILABLE');
      assert.match(summarizeTiming(unavailable), /not valid JSON/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('valid timing summary warns when a file duration exceeds 180000ms', () => {
    const output = summarizeFiles([
      { file: 'over-threshold.test.js', duration_ms: 180001, status: 'PASS' },
    ]);
    assert.match(output, /warning/i);
    assert.match(output, /over-threshold\.test\.js/);
  });

  test('valid timing summary omits per-file warnings at and below 180000ms', () => {
    const output = summarizeFiles([
      { file: 'at-threshold.test.js', duration_ms: 180000, status: 'PASS' },
      { file: 'under-threshold.test.js', duration_ms: 179999, status: 'PASS' },
    ]);
    assert.ok(!/warning/i.test(output), 'files at or under the threshold must not warn');
  });
}

test('CI plan classifies canonical prose as light and skips expensive jobs', () => {
  const plan = classifyChangedPaths([
    { status: 'M', path: 'skills/example/SKILL.md' },
    { status: 'M', path: 'docs/guide.md' },
  ], { baseRef: 'develop' });
  assert.strictEqual(plan.mode, 'light');
  assert.deepStrictEqual(plan.requiredJobs, ['preflight', 'validate', 'lint']);
  assert.ok(plan.skippedJobs.includes('tests'));
  assert.ok(plan.skippedJobs.includes('macos-installer'));
  assert.strictEqual(classifyChangedPaths([{ status: 'M', path: 'README.md' }], { baseRef: 'develop' }).mode, 'light');
  assert.deepStrictEqual(packageSurfacesForFiles(['skills/example/SKILL.md']), []);
});

test('CI plan falls back to full for unknown, and release-base paths', () => {
  assert.strictEqual(classifyChangedPaths([{ status: 'M', path: 'scripts/lib/new-core.js' }], { baseRef: 'develop' }).mode, 'full');
  const release = classifyChangedPaths([{ status: 'M', path: 'skills/example/SKILL.md' }], { baseRef: 'main' });
  assert.strictEqual(release.mode, 'full');
  assert.ok(release.requiredJobs.includes('release-rehearsal'));
});

test('aggregate accepts only explicitly skipped jobs and requires plan-bound evidence', () => {
  const plan = { ...classifyChangedPaths([{ status: 'M', path: 'skills/demo/SKILL.md' }]), testFiles: [], shardCount: 0, packageSurfaces: [], generatedChecks: [], identities: { baseSha: 'base', headSha: 'head', checkoutSha: 'checkout', baseRef: 'develop' } };
  assert.strictEqual(verifyCiResults(plan, { preflight: 'success', validate: 'success', lint: 'success', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' }).ok, true);
  assert.strictEqual(verifyCiResults(plan, { preflight: 'success', validate: 'success', lint: 'success', tests: 'success' }).ok, false);
  assert.strictEqual(verifyCiResults(plan, { preflight: 'success', validate: 'success', lint: 'cancelled', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' }).ok, false);
});

test('public CI plan CLI classifies content, metadata, mixed, deletion, and rename fixtures', () => {
  const content = gitFixture((root) => { fs.mkdirSync(path.join(root, 'skills/demo'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'old\n'); }, (root) => fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'new\n'));
  const metadata = gitFixture((root) => fs.writeFileSync(path.join(root, 'plugin.json'), '{}\n'), (root) => fs.writeFileSync(path.join(root, 'plugin.json'), '{"name":"x"}\n'));
  const mixed = gitFixture((root) => { fs.mkdirSync(path.join(root, 'skills/demo'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'old\n'); }, (root) => fs.writeFileSync(path.join(root, 'scripts.js'), 'code\n'));
  const deletion = gitFixture((root) => { fs.mkdirSync(path.join(root, 'skills/demo'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'old\n'); }, (root) => fs.rmSync(path.join(root, 'skills/demo/SKILL.md')));
  const rename = gitFixture((root, git) => { fs.mkdirSync(path.join(root, 'skills/demo'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'old\n'); }, (root, git) => { fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); git('mv', 'skills/demo/SKILL.md', 'docs/guide.md'); });
  try {
    assert.strictEqual(content.plan.mode, 'light');
    assert.strictEqual(metadata.plan.mode, 'full');
    assert.strictEqual(mixed.plan.mode, 'full');
    assert.strictEqual(deletion.plan.mode, 'light');
    assert.strictEqual(rename.plan.mode, 'light');
    assert.deepStrictEqual(rename.plan.changes[0].files.slice().sort(), ['skills/demo/SKILL.md', 'docs/guide.md'].sort());
  } finally {
    for (const fixture of [content, metadata, mixed, deletion, rename]) fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('public CI plan validation rejects forged identity, missing fields, and unavailable diff', () => {
  const fixture = gitFixture((root) => { fs.mkdirSync(path.join(root, 'skills/demo'), { recursive: true }); fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'old\n'); }, (root) => fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), 'new\n'));
  try {
    const planPath = path.join(fixture.root, 'plan.json'); fs.writeFileSync(planPath, JSON.stringify({ ...fixture.plan, files: [], requiredJobs: [] }));
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'validate', '--plan', planPath, '--base-sha', fixture.baseSha, '--head-sha', fixture.headSha, '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop'], { cwd: fixture.root, encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    const unavailable = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'plan', '--base-sha', 'missing', '--head-sha', fixture.headSha, '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop'], { cwd: fixture.root, encoding: 'utf8' });
    assert.strictEqual(unavailable.status, 0);
    const unavailablePlan = JSON.parse(unavailable.stdout);
    assert.strictEqual(unavailablePlan.mode, 'full');
    const successResults = { preflight: 'success', tests: 'success', validate: 'success', 'macos-installer': 'success', lint: 'success', 'release-rehearsal': 'skipped' };
    const resultsPath = path.join(fixture.root, 'results.json'); fs.writeFileSync(resultsPath, JSON.stringify(successResults));
    const aggregate = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'aggregate', '--plan', path.join(fixture.root, 'plan.json'), '--results', resultsPath, '--base-sha', 'missing', '--head-sha', fixture.headSha, '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop'], { cwd: fixture.root, encoding: 'utf8' });
    assert.notStrictEqual(aggregate.status, 0, 'the forged plan must not aggregate');
    const unavailablePath = path.join(fixture.root, 'unavailable.json'); fs.writeFileSync(unavailablePath, JSON.stringify(unavailablePlan));
    const unavailableAggregate = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'aggregate', '--plan', unavailablePath, '--results', resultsPath, '--base-sha', 'missing', '--head-sha', fixture.headSha, '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop'], { cwd: fixture.root, encoding: 'utf8' });
    assert.strictEqual(unavailableAggregate.status, 0, unavailableAggregate.stderr);
    const failedResults = { ...successResults, tests: 'failure' }; fs.writeFileSync(resultsPath, JSON.stringify(failedResults));
    const failedAggregate = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'aggregate', '--plan', unavailablePath, '--results', resultsPath, '--base-sha', 'missing', '--head-sha', fixture.headSha, '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop'], { cwd: fixture.root, encoding: 'utf8' });
    assert.notStrictEqual(failedAggregate.status, 0);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('public CI plan selects existing owner suites and enables macOS only for installers', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'scripts', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'sample.sh'), 'old\n');
    for (const owner of ['hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js', 'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js', 'pretool-branch-safety-dedup.test.js', 'session-audit-integrity-fixtures.test.js', 'session-end.test.js', 'session-install-health-ask.test.js', 'session-install-health-version.test.js', 'session-start.test.js', 'session-usage-audit.test.js', 'stop-advisory-dispatch-graduation.test.js', 'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js', 'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js']) {
      fs.writeFileSync(path.join(root, 'tests', owner), '// owner\n');
    }
  }, (root) => fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'sample.sh'), 'new\n'));
  try {
    assert.strictEqual(fixture.plan.mode, 'selected');
    assert.deepStrictEqual(fixture.plan.testFiles, ['hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js', 'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js', 'pretool-branch-safety-dedup.test.js', 'session-audit-integrity-fixtures.test.js', 'session-end.test.js', 'session-install-health-ask.test.js', 'session-install-health-version.test.js', 'session-start.test.js', 'session-usage-audit.test.js', 'stop-advisory-dispatch-graduation.test.js', 'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js', 'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js']);
    assert.strictEqual(fixture.plan.shardCount, 1);
    assert.ok(fixture.plan.skippedJobs.includes('macos-installer'));
    const runner = spawnSync(process.execPath, [path.join(__dirname, 'run-all.js'), 'tests/utils.test.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.strictEqual(runner.status, 0, runner.stderr);
    const plan = createCiPlan({ root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop' });
    assert.strictEqual(validateCiPlan(plan, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop' }).ok, true);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('known resource families select their existing owner suites', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'skills', 'dhpk-agy-fast-worker', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh'), 'old\n');
    for (const owner of ['modules.test.js', 'run-agy.test.js', 'run-cli-transport.test.js', 'session-usage-audit.test.js', 'skill-resource-sync-security.test.js', 'skill-runtime-path-contract.test.js']) fs.writeFileSync(path.join(root, 'tests', owner), '// owner\n');
  }, (root) => fs.writeFileSync(path.join(root, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh'), 'new\n'));
  try { assert.strictEqual(fixture.plan.mode, 'selected'); assert.ok(fixture.plan.testFiles.includes('run-agy.test.js')); }
  finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('selected package changes carry only their affected platform surfaces', () => {
  assert.deepStrictEqual(packageSurfacesForFiles(['plugins/dhpk-agent/skills/demo/SKILL.md']), ['agent-plugin']);
  assert.deepStrictEqual(packageSurfacesForFiles(['plugins/dhpk-cursor/marketplace.json']), ['cursor-plugin']);
  assert.deepStrictEqual(packageSurfacesForFiles(['scripts/lib/verify-platform-packages.js']), []);
  assert.deepStrictEqual(packageSurfacesForFiles(['scripts/ci/verify-platform-packages.js']), ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
});

test('canonical content with owned evidence companions stays light and carries exact checks', () => {
  const cases = [
    ['plugins/dhpk-agent/skills/demo/SKILL.md', [], ['agent-plugin']],
    ['plugins/dhpk-agent/provenance.json', [], ['agent-plugin']],
    ['generated/claude-marketplace/package/docs/README.md', ['claude-marketplace'], []],
    ['generated/claude-profiles/minimal/package/bundle-receipt.json', ['claude-profile:minimal'], []],
    ['manifests/skill-resource-copies.json', [], []],
    ['generated/claude-marketplace/package/manifests/skill-resource-copies.json', ['claude-marketplace'], []],
  ];
  for (const [companion, generatedChecks, packageSurfaces] of cases) {
    const fixture = gitFixture((root) => {
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
      fs.mkdirSync(path.dirname(path.join(root, companion)), { recursive: true });
      fs.writeFileSync(path.join(root, companion), 'old\n');
    }, (root) => {
      fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'new\n');
      fs.writeFileSync(path.join(root, companion), 'new\n');
    });
    try {
      assert.strictEqual(fixture.plan.mode, 'light');
      assert.strictEqual(fixture.plan.shardCount, 0);
      assert.deepStrictEqual(fixture.plan.generatedChecks, generatedChecks);
      assert.deepStrictEqual(fixture.plan.packageSurfaces, packageSurfaces);
      assert.ok(fixture.plan.skippedJobs.includes('tests'));
      assert.ok(fixture.plan.skippedJobs.includes('macos-installer'));
      const validation = validateCiPlan(fixture.plan, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop' });
      assert.strictEqual(validation.ok, true, validation.errors.join('; '));
      const aggregate = verifyCiResults(fixture.plan, { preflight: 'success', validate: 'success', lint: 'success', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' }, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop' });
      assert.strictEqual(aggregate.ok, true, aggregate.errors.join('; '));
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('unknown or generated-only companions fail closed to full CI', () => {
  for (const companion of ['plugins/dhpk-agent/plugin.json', 'generated/claude-marketplace/package/hooks/hooks.json']) {
    const fixture = gitFixture((root) => {
      fs.mkdirSync(path.dirname(path.join(root, companion)), { recursive: true });
      fs.writeFileSync(path.join(root, companion), 'old\n');
    }, (root) => fs.writeFileSync(path.join(root, companion), 'new\n'));
    try {
      assert.strictEqual(fixture.plan.mode, 'full');
      assert.strictEqual(fixture.plan.shardCount, 4);
      assert.deepStrictEqual(fixture.plan.packageSurfaces, ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('generated-only Agent receipt stays full even when every adapter owner suite exists', () => {
  const owners = ['agy-adapt-agents.test.js', 'agy-plugin-install.test.js', 'agents-skills-package.test.js', 'codex-native-package-validate.test.js', 'cursor-plugin-package.test.js', 'gen-agent-plugin-package.test.js', 'gen-claude-marketplace-package.test.js', 'gen-claude-manifest.test.js', 'gen-cursor-plugin-package.test.js'];
  for (const generated of ['provenance.json', 'plugin.json']) {
    const fixture = gitFixture((root) => {
      fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agent'), { recursive: true });
      fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', generated), '{}\n');
      for (const owner of owners) fs.writeFileSync(path.join(root, 'tests', owner), '// owner\n');
    }, (root) => fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', generated), '{"changed":true}\n'));
    try {
      assert.strictEqual(fixture.plan.mode, 'full');
      assert.strictEqual(fixture.plan.shardCount, 4);
      assert.strictEqual(fixture.plan.reason, 'generated-companion-without-canonical');
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('canonical content plus arbitrary generated JSON or executable stays full with owners present', () => {
  const owners = ['agy-adapt-agents.test.js', 'agy-plugin-install.test.js', 'agents-skills-package.test.js', 'codex-native-package-validate.test.js', 'cursor-plugin-package.test.js', 'gen-agent-plugin-package.test.js', 'gen-claude-marketplace-package.test.js', 'gen-claude-manifest.test.js', 'gen-cursor-plugin-package.test.js'];
  for (const generated of ['generated/claude-marketplace/package/hooks/hooks.json', 'plugins/dhpk-agent/plugin.json', 'plugins/dhpk-agent/scripts/runtime.js']) {
    const fixture = gitFixture((root) => {
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(root, generated)), { recursive: true });
      fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
      fs.writeFileSync(path.join(root, generated), 'old\n');
      for (const owner of owners) fs.writeFileSync(path.join(root, 'tests', owner), '// owner\n');
    }, (root) => {
      fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'new\n');
      fs.writeFileSync(path.join(root, generated), 'new\n');
    });
    try { assert.strictEqual(fixture.plan.mode, 'full'); } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('rename and deletion diffs inspect both sides of bounded companion paths', () => {
  const renamed = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agent'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
    fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), '{}\n');
  }, (root, git) => {
    git('mv', 'docs/guide.md', 'plugins/dhpk-agent/guide.md');
    fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), '{"changed":true}\n');
  });
  const deleted = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agent'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
    fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), '{}\n');
  }, (root) => {
    fs.rmSync(path.join(root, 'docs', 'guide.md'));
    fs.rmSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'));
  });
  try {
    assert.strictEqual(renamed.plan.mode, 'light');
    assert.deepStrictEqual(renamed.plan.packageSurfaces, ['agent-plugin']);
    assert.strictEqual(deleted.plan.mode, 'light');
    assert.deepStrictEqual(deleted.plan.packageSurfaces, ['agent-plugin']);
  } finally {
    fs.rmSync(renamed.root, { recursive: true, force: true });
    fs.rmSync(deleted.root, { recursive: true, force: true });
  }
});

test('authoritative validation rejects forged companion obligations', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
    fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agent'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), '{}\n');
  }, (root) => {
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'new\n');
    fs.writeFileSync(path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'), '{"changed":true}\n');
  });
  try {
    const forged = { ...fixture.plan, packageSurfaces: [], generatedChecks: ['claude-marketplace'] };
    const result = validateCiPlan(forged, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => /authoritative plan/.test(error)));
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('shared package publisher and closure helpers fall back to full CI', () => {
  for (const helper of ['marketplace-host-publication.js', 'standalone-package-assets.js', 'workflow-package-closure.js']) {
    const fixture = gitFixture((root) => {
      fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(root, 'scripts', 'lib', helper), 'old\n');
      fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
      for (const owner of ['agy-adapt-agents.test.js', 'agy-plugin-install.test.js', 'agents-skills-package.test.js', 'codex-native-package-validate.test.js', 'cursor-plugin-package.test.js', 'gen-agent-plugin-package.test.js', 'gen-claude-marketplace-package.test.js', 'gen-claude-manifest.test.js', 'gen-cursor-plugin-package.test.js']) {
        fs.writeFileSync(path.join(root, 'tests', owner), '// adapter owner\n');
      }
    }, (root) => fs.writeFileSync(path.join(root, 'scripts', 'lib', helper), 'new\n'));
    try {
      assert.strictEqual(fixture.plan.mode, 'full');
      assert.deepStrictEqual(fixture.plan.packageSurfaces, ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('missing hook owner mapping fails closed to full validation', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'scripts', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'sample.sh'), 'old\n');
  }, (root) => fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'sample.sh'), 'new\n'));
  try { assert.strictEqual(fixture.plan.mode, 'full'); assert.ok(['owner-suite-unavailable', 'owner-mapping-unavailable'].includes(fixture.plan.reason)); }
  finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('AGY installer wrapper fails closed to full macOS validation', () => {
  const fixture = gitFixture((root) => fs.writeFileSync(path.join(root, 'install-agy-plugin.js'), 'old\n'), (root) => {
    fs.mkdirSync(path.join(root, 'scripts', 'ci'), { recursive: true });
    fs.rmSync(path.join(root, 'install-agy-plugin.js'));
    fs.writeFileSync(path.join(root, 'scripts', 'ci', 'install-agy-plugin.js'), 'new\n');
  });
  try {
    assert.strictEqual(fixture.plan.mode, 'full');
    assert.ok(fixture.plan.requiredJobs.includes('macos-installer'));
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('selected shard verification uses the trusted plan file list exactly', () => {
  withFixture(({ root, directory }) => {
    const selected = verify({ root, directory, overrides: { expectedFiles: ['alpha.test.js'] } });
    assertRejected(selected);
    assert.ok(selected.errors.some((error) => /undiscovered|multiple|no shard result/i.test(error)));
    const complete = verify({ root, directory, overrides: { expectedFiles: SHARD_FILES.flat() } });
    assert.strictEqual(complete.ok, true, complete.errors.join('\n'));
  });
});

run('verify-test-shards');
