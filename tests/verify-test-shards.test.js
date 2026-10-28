'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { verifyShardReports, main } = require('../scripts/ci/verify-test-shards');
const { classifyChangedPaths, createCiPlan, validateCiPlan, verifyCiResults, packageSurfacesForFiles } = require('../scripts/lib/ci-plan');

function changedPaths(root, baseSha, headSha) {
  const output = execFileSync('git', ['-C', root, 'diff', '--name-status', '-z', '--find-renames', `${baseSha}...${headSha}`], { encoding: 'utf8' });
  const fields = output.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith('R') || status.startsWith('C')) files.push(fields[index++], fields[index++]);
    else files.push(fields[index++]);
  }
  return [...new Set(files)].sort();
}

function classificationFor(paths, baseSha, headSha, kindForPath = () => 'wording') {
  return {
    baseSha,
    headSha,
    entries: paths.map((file) => ({ path: file, kind: kindForPath(file), reason: 'Scoped test declaration.' })),
  };
}

function gitFixture(setup, mutate, baseRef = 'develop', kindForPath = () => 'wording') {
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
    const classification = classificationFor(changedPaths(root, baseSha, headSha), baseSha, headSha, kindForPath);
    const classificationPath = path.join(root, 'classification.json');
    fs.writeFileSync(classificationPath, JSON.stringify(classification));
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'plan', '--base-sha', baseSha, '--head-sha', headSha, '--checkout-sha', checkoutSha, '--base-ref', baseRef, '--classification-file', classificationPath], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    return { root, baseSha, headSha, checkoutSha, classification, classificationPath, plan: JSON.parse(result.stdout) };
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
  const { spawn, spawnSync } = require('node:child_process');
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

  function isolatedRunnerFixture(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-run-all-progress-'));
    const testsDir = path.join(root, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'run-all.js'), path.join(testsDir, 'run-all.js'));
    fs.cpSync(path.join(__dirname, '..', 'scripts', 'lib'), path.join(root, 'scripts', 'lib'), { recursive: true });
    const testFiles = Object.entries(files).map(([name, source]) => {
      const file = path.join(testsDir, name);
      fs.writeFileSync(file, source);
      return file;
    });
    return { root, testsDir, runner: path.join(testsDir, 'run-all.js'), testFiles };
  }

  function isolatedRunnerEnv(overrides = {}) {
    const env = { ...process.env, DHPK_TEST_JOBS: '2' };
    for (const key of ['DHPK_TEST_PROGRESS', 'DHPK_TEST_TIMING_FILE', 'DHPK_TEST_TIMING_CHILD', 'DHPK_TEST_SHARD_INDEX', 'DHPK_TEST_SHARD_COUNT']) {
      delete env[key];
    }
    return { ...env, ...overrides };
  }

  function assertProgressTranscript(stderr, expectedStatuses) {
    const progressLines = stderr.split(/\r?\n/).filter((line) => line.startsWith('[test-progress]'));
    const startedFiles = [];
    const completedStatuses = {};
    let completed = 0;

    for (const line of progressLines) {
      const started = line.match(/^\[test-progress\] started ([^ ]+) \(completed (\d+)\/(\d+)\)$/);
      if (started) {
        assert.strictEqual(Number(started[2]), completed, line);
        assert.strictEqual(Number(started[3]), Object.keys(expectedStatuses).length, line);
        startedFiles.push(started[1]);
        continue;
      }

      const done = line.match(/^\[test-progress\] completed ([^ ]+) status=(PASS|FAIL) \(completed (\d+)\/(\d+)\)$/);
      assert.ok(done, `unexpected progress line: ${line}`);
      assert.strictEqual(Number(done[3]), completed + 1, line);
      assert.strictEqual(Number(done[4]), Object.keys(expectedStatuses).length, line);
      assert.strictEqual(done[2], expectedStatuses[done[1]], line);
      completedStatuses[done[1]] = done[2];
      completed += 1;
    }

    assert.deepStrictEqual(startedFiles.sort(), Object.keys(expectedStatuses).sort());
    assert.deepStrictEqual(
      Object.entries(completedStatuses).sort(([left], [right]) => left.localeCompare(right)),
      Object.entries(expectedStatuses).sort(([left], [right]) => left.localeCompare(right)),
    );
    assert.strictEqual(completed, Object.keys(expectedStatuses).length);
  }

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
    assert.strictEqual(fileTimeoutMs('tests/macos-installer-darwin.test.js', 180000), 240000);
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

  for (const mode of ['selected', 'discovered']) {
    for (const jobs of [1, 2]) {
      for (const scenario of [
        { name: 'missing summary', output: 'ordinary output', exit: 0, succeeds: false, evidence: 'UNAVAILABLE', counts: [null, null, null] },
        { name: 'unparseable summary', output: 'fixture: unknown/unknown passed', exit: 0, succeeds: false, evidence: 'UNAVAILABLE', counts: [null, null, null] },
        { name: 'observed pass', output: 'fixture: 1/1 passed', exit: 0, succeeds: true, evidence: 'OBSERVED', counts: [1, 1, 0] },
        { name: 'observed zero assertions', output: 'fixture: 0/0 passed', exit: 0, succeeds: true, evidence: 'OBSERVED', counts: [0, 0, 0] },
        { name: 'failed assertions with zero exit', output: 'fixture: 1/2 passed', exit: 0, succeeds: false, evidence: 'OBSERVED', counts: [2, 1, 1] },
        { name: 'invalid assertion counts', output: 'fixture: 2/1 passed', exit: 0, succeeds: false, evidence: 'OBSERVED', counts: [1, 2, -1] },
        { name: 'failed process with passing assertions', output: 'fixture: 1/1 passed', exit: 7, succeeds: false, evidence: 'OBSERVED', counts: [1, 1, 0] },
      ]) {
        test(`${mode} runner with ${jobs} jobs enforces ${scenario.name} and preserves timing evidence`, () => {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-local-assertions-'));
          try {
            const testsDir = path.join(directory, 'tests');
            fs.mkdirSync(testsDir);
            // Run the unchanged CLI in an isolated discovery tree, never the
            // repository's recursive suite from inside this suite.
            fs.copyFileSync(path.join(__dirname, 'run-all.js'), path.join(testsDir, 'run-all.js'));
            fs.cpSync(path.join(__dirname, '..', 'scripts', 'lib'), path.join(directory, 'scripts', 'lib'), { recursive: true });
            const fixture = path.join(testsDir, 'fixture.test.js');
            const companion = path.join(testsDir, 'companion.test.js');
            fs.writeFileSync(fixture, `console.log(${JSON.stringify(scenario.output)}); process.exitCode = ${scenario.exit};\n`);
            fs.writeFileSync(companion, "console.log('companion: 1/1 passed');\n");
            const timingFile = path.join(directory, 'timing.json');
            const childEnv = { ...process.env, DHPK_TEST_TIMING_FILE: timingFile, DHPK_TEST_JOBS: String(jobs) };
            delete childEnv.DHPK_TEST_TIMING_CHILD;
            delete childEnv.DHPK_TEST_SHARD_INDEX;
            delete childEnv.DHPK_TEST_SHARD_COUNT;
            const args = [path.join(testsDir, 'run-all.js')];
            if (mode === 'selected') args.push(fixture, companion);
            const result = spawnSync(process.execPath, args, { cwd: directory, env: childEnv, encoding: 'utf8', timeout: 30000 });
            const output = result.stdout + '\n' + result.stderr;
            assert.strictEqual(result.error, undefined, output);
            if (scenario.succeeds) assert.strictEqual(result.status, 0, output);
            else assert.notStrictEqual(result.status, 0, `runner accepted ${scenario.name}:\n${output}`);
            const report = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
            assert.strictEqual(report.totals.files, 2);
            assert.strictEqual(report.totals.failed, scenario.succeeds ? 0 : 1);
            assert.strictEqual(report.files.length, 2, 'retain every completed file, including failures');
            const timing = report.files.find((entry) => entry.file === 'fixture.test.js');
            assert.strictEqual(timing.status, scenario.succeeds ? 'PASS' : 'FAIL');
            assert.strictEqual(timing.assertions.status, scenario.evidence);
            assert.deepStrictEqual([timing.assertions.total, timing.assertions.passed, timing.assertions.failed], scenario.counts);
            assert(Number.isFinite(timing.duration_ms) && timing.duration_ms >= 0);
            if (!scenario.succeeds) assert.doesNotMatch(result.stdout, /PASS: 2\/2 test file/);
            if (!scenario.succeeds && scenario.exit === 0) assert.match(result.stderr, /ASSERTION EVIDENCE:/);
          } finally {
            fs.rmSync(directory, { recursive: true, force: true });
          }
        });
      }
    }
  }

  test('worker timing payloads are machine-readable and tolerate ordinary test output', () => {
    const payload = { duration_ms: 17, file_timings: [{ file: 'a.test.js', duration_ms: 17, status: 'PASS' }] };
    assert.deepStrictEqual(
      parseTimingPayload(`ordinary output\nDHPK_TEST_TIMING_PAYLOAD=${JSON.stringify(payload)}\n`),
      payload,
    );
    assert.strictEqual(parseTimingPayload('ordinary output\n'), null);
    assert.strictEqual(parseTimingPayload('DHPK_TEST_TIMING_PAYLOAD={invalid}\n'), null);
  });

  test('progress is opt-in on stderr and preserves file outcomes across sequential and parallel jobs', () => {
    const fixture = isolatedRunnerFixture({
      'quick.test.js': "console.log('quick.test.js: 1/1 passed');\n",
      'fail.test.js': "console.log('fail.test.js: 0/1 passed');\nprocess.exitCode = 1;\n",
      'timeout.test.js': "console.log('timeout.test.js: 1/1 passed');\nsetInterval(() => {}, 1000);\n",
    });
    try {
      const args = [fixture.runner, ...fixture.testFiles];
      const expectedStatuses = {
        'quick.test.js': 'PASS',
        'fail.test.js': 'FAIL',
        'timeout.test.js': 'FAIL',
      };
      const withoutProgress = (stderr) => stderr.split(/\r?\n/)
        .filter((line) => !line.startsWith('[test-progress]'))
        .join('\n');

      for (const jobs of [1, 2]) {
        const baseline = spawnSync(process.execPath, args, {
          cwd: fixture.root,
          env: isolatedRunnerEnv({ DHPK_TEST_JOBS: String(jobs), DHPK_TEST_TIMEOUT_MS: '100' }),
          encoding: 'utf8',
          timeout: 30000,
        });
        const progress = spawnSync(process.execPath, args, {
          cwd: fixture.root,
          env: isolatedRunnerEnv({
            DHPK_TEST_JOBS: String(jobs),
            DHPK_TEST_TIMEOUT_MS: '100',
            DHPK_TEST_PROGRESS: '1',
          }),
          encoding: 'utf8',
          timeout: 30000,
        });
        const baselineOutput = baseline.stdout + '\n' + baseline.stderr;
        const progressOutput = progress.stdout + '\n' + progress.stderr;

        assert.strictEqual(baseline.error, undefined, baselineOutput);
        assert.strictEqual(progress.error, undefined, progressOutput);
        assert.strictEqual(baseline.status, 1, baselineOutput);
        assert.strictEqual(progress.status, 1, progressOutput);
        assert.strictEqual(progress.stdout, baseline.stdout, `jobs=${jobs}: progress must preserve stdout`);
        assert.doesNotMatch(baseline.stderr, /\[test-progress\]/i);
        assert.doesNotMatch(progress.stdout, /\[test-progress\]/i);
        assert.strictEqual(withoutProgress(progress.stderr), withoutProgress(baseline.stderr));
        assert.match(progress.stdout, /quick\.test\.js: 1\/1 passed/);
        assert.match(progress.stdout, /fail\.test\.js: 0\/1 passed/);
        assert.match(progress.stdout, /timeout\.test\.js: 1\/1 passed/);
        assert.match(progress.stderr, /ASSERTION EVIDENCE: fail\.test\.js contains failed assertions\./);
        assert.match(progressOutput, /FAIL: 2\/3 test file\(s\) failed/);
        assertProgressTranscript(progress.stderr, expectedStatuses);
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test('parallel completion progress waits for child results and failed workers remain failures', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-run-all-progress-held-'));
    const startedFile = path.join(root, 'slow-started');
    const releaseFile = path.join(root, 'slow-release');
    const slowSource = [
      "const fs = require('node:fs');",
      "console.log('slow.test.js: 1/1 passed');",
      'fs.writeFileSync(' + JSON.stringify(startedFile) + ", 'started');",
      'const timer = setInterval(() => {',
      '  if (fs.existsSync(' + JSON.stringify(releaseFile) + ')) {',
      '    clearInterval(timer);',
      '    process.exitCode = 1;',
      '  }',
      '}, 10);',
      '',
    ].join('\n');
    const fixture = isolatedRunnerFixture({
      'quick.test.js': "console.log('quick: 1/1 passed');\n",
      'slow.test.js': slowSource,
    });
    let child;
    let closed = false;
    let stdout = '';
    let stderr = '';
    let result;
    let resolveEarlyCompletion;
    const earlyCompletionPromise = new Promise((resolve) => { resolveEarlyCompletion = resolve; });
    try {
      child = spawn(process.execPath, [fixture.runner, ...fixture.testFiles], {
        cwd: fixture.root,
        env: isolatedRunnerEnv({ DHPK_TEST_PROGRESS: '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const finished = new Promise((resolve) => {
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
          const completionLine = stderr.split(/\r?\n/).find((line) => (
            /^\[test-progress\] completed quick\.test\.js status=PASS\b/.test(line)
          ));
          if (completionLine && resolveEarlyCompletion) {
            resolveEarlyCompletion({ line: completionLine, beforeClose: !closed, stderrAtEvent: stderr });
            resolveEarlyCompletion = null;
          }
        });
        child.once('error', (error) => {
          closed = true;
          resolve({ error, status: null, stdout, stderr });
        });
        child.once('close', (status) => {
          closed = true;
          resolve({ status, stdout, stderr });
        });
      });
      let earlyTimeout;
      const earlyCompletion = await Promise.race([
        earlyCompletionPromise,
        new Promise((resolve) => { earlyTimeout = setTimeout(() => resolve(null), 5000); }),
      ]);
      clearTimeout(earlyTimeout);
      fs.writeFileSync(releaseFile, 'release');
      result = await finished;
      assert.ok(fs.existsSync(startedFile), 'the held test worker must start before the runner exits');
      assert.ok(earlyCompletion, 'a worker completion must be reported before the held worker is released');
      assert.strictEqual(earlyCompletion.beforeClose, true, 'progress must arrive before the aggregate runner closes');
      assert.match(stderr, /\[test-progress\]/i, stderr);
      const progressCounters = stderr.split(/\r?\n/)
        .filter((line) => line.includes('[test-progress]'))
        .flatMap((line) => [...line.matchAll(/\bcompleted\s+(\d+)\s*\/\s*(\d+)\b/gi)])
        .map((match) => ({ completed: Number(match[1]), total: Number(match[2]) }));
      assert.ok(progressCounters.some(({ completed, total }) => completed === 2 && total === 2), stderr);
      assert.ok(
        progressCounters.every(({ completed, total }) => completed <= total),
        `progress must not report more completed files than the global total:\n${stderr}`,
      );
      const prematureSlowPass = earlyCompletion.stderrAtEvent.split(/\r?\n/).some((line) => (
        /slow\.test\.js/i.test(line) && /\bPASS\b/i.test(line)
      ));
      assert.strictEqual(prematureSlowPass, false, 'a running child must not be reported as passed before its result');
      assert.strictEqual(result.status, 1, stdout + '\n' + stderr);
      assert.match(stderr, /FAIL: 1\/2 test file\(s\) failed/);
      assert.doesNotMatch(stdout, /PASS: 2\/2 test file\(s\) passed/);
    } finally {
      if (child && !closed) {
        fs.writeFileSync(releaseFile, 'release');
        await new Promise((resolve) => child.once('close', resolve));
      }
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
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
  const changes = [
    { status: 'M', path: 'skills/example/SKILL.md' },
    { status: 'M', path: 'docs/guide.md' },
  ];
  const classification = classificationFor(['skills/example/SKILL.md', 'docs/guide.md'], 'base', 'head');
  const plan = classifyChangedPaths(changes, { baseRef: 'develop', baseSha: 'base', headSha: 'head', classification });
  assert.strictEqual(plan.mode, 'light');
  assert.deepStrictEqual(plan.requiredJobs, ['preflight', 'validate', 'lint']);
  assert.ok(plan.skippedJobs.includes('tests'));
  assert.ok(plan.skippedJobs.includes('macos-installer'));
  const readme = classifyChangedPaths([{ status: 'M', path: 'README.md' }], {
    baseRef: 'develop', baseSha: 'base', headSha: 'head',
    classification: classificationFor(['README.md'], 'base', 'head'),
  });
  assert.strictEqual(readme.mode, 'light');
  assert.deepStrictEqual(packageSurfacesForFiles(['skills/example/SKILL.md']), []);
});

test('CI plan falls back to full for unknown, and release-base paths', () => {
  assert.strictEqual(classifyChangedPaths([{ status: 'M', path: 'scripts/lib/new-core.js' }], { baseRef: 'develop' }).mode, 'full');
  const release = classifyChangedPaths([{ status: 'M', path: 'skills/example/SKILL.md' }], { baseRef: 'main' });
  assert.strictEqual(release.mode, 'full');
  assert.ok(release.requiredJobs.includes('release-rehearsal'));
  assert.deepStrictEqual(release.generatedChecks, []);
});

test('aggregate accepts only explicitly skipped jobs and requires plan-bound evidence', () => {
  const classification = classificationFor(['skills/demo/SKILL.md'], 'base', 'head');
  const plan = { ...classifyChangedPaths([{ status: 'M', path: 'skills/demo/SKILL.md' }], { baseRef: 'develop', baseSha: 'base', headSha: 'head', classification }), testFiles: [], shardCount: 0, packageSurfaces: [], generatedChecks: ['claude-marketplace'], identities: { baseSha: 'base', headSha: 'head', checkoutSha: 'checkout', baseRef: 'develop' } };
  const expected = { baseSha: 'base', headSha: 'head', checkoutSha: 'checkout', baseRef: 'develop', classification };
  assert.strictEqual(verifyCiResults(plan, { preflight: 'success', validate: 'success', lint: 'success', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' }, expected).ok, true);
  assert.strictEqual(verifyCiResults(plan, { preflight: 'success', validate: 'success', lint: 'success', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' }, { ...expected, classification: undefined }).ok, false);
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
    assert.deepStrictEqual(rename.plan.classification.entries.map((entry) => entry.path), ['docs/guide.md', 'skills/demo/SKILL.md']);
  } finally {
    for (const fixture of [content, metadata, mixed, deletion, rename]) fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the CI plan reads exactly one inert classification block from the pull request event', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'before\n');
  }, (root) => fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'after\n'));
  const eventPath = path.join(fixture.root, 'event.json');
  const command = [
    path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'plan',
    '--base-sha', fixture.baseSha, '--head-sha', fixture.headSha,
    '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop',
  ];
  const block = `\`\`\`dhpk-ci-classification\n${JSON.stringify(fixture.classification)}\n\`\`\``;
  const event = (body) => fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { body } }));
  const run = () => spawnSync(process.execPath, command, {
    cwd: fixture.root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
  });
  try {
    event(`Description\n\n${block}\n`);
    const valid = run();
    assert.strictEqual(valid.status, 0, valid.stderr);
    const plan = JSON.parse(valid.stdout);
    assert.strictEqual(plan.mode, 'light');
    assert.strictEqual(plan.classification.status, 'accepted');

    event(`${block}\n\n${block}\n`);
    const duplicate = run();
    assert.strictEqual(duplicate.status, 0, duplicate.stderr);
    const duplicatePlan = JSON.parse(duplicate.stdout);
    assert.strictEqual(duplicatePlan.mode, 'full');
    assert.strictEqual(duplicatePlan.classification.reason, 'classification-invalid');

    const malformedPath = path.join(fixture.root, 'malformed-classification.json');
    fs.writeFileSync(malformedPath, '{');
    const cleanEnv = { ...process.env };
    delete cleanEnv.GITHUB_EVENT_PATH;
    const malformed = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'plan',
      '--base-sha', fixture.baseSha, '--head-sha', fixture.headSha,
      '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop',
      '--classification-file', malformedPath,
    ], { cwd: fixture.root, encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(malformed.status, 0, malformed.stderr);
    const malformedPlan = JSON.parse(malformed.stdout);
    assert.strictEqual(malformedPlan.mode, 'full');
    assert.strictEqual(malformedPlan.classification.reason, 'classification-invalid');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('plan validation and aggregation require classification reloaded from an independent source', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'before\n');
  }, (root) => fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'after\n'));
  const planPath = path.join(fixture.root, 'plan.json');
  const resultsPath = path.join(fixture.root, 'results.json');
  const baseArgs = [
    '--plan', planPath, '--base-sha', fixture.baseSha, '--head-sha', fixture.headSha,
    '--checkout-sha', fixture.checkoutSha, '--base-ref', 'develop',
  ];
  const cli = path.join(__dirname, '..', 'scripts/ci/ci-plan.js');
  const cleanEnv = { ...process.env };
  delete cleanEnv.GITHUB_EVENT_PATH;
  try {
    fs.writeFileSync(planPath, JSON.stringify(fixture.plan));
    const statuses = { preflight: 'success', validate: 'success', lint: 'success', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' };
    fs.writeFileSync(resultsPath, JSON.stringify(statuses));

    const missing = spawnSync(process.execPath, [cli, 'validate', ...baseArgs], { cwd: fixture.root, encoding: 'utf8', env: cleanEnv });
    assert.notStrictEqual(missing.status, 0);
    assert.match(missing.stderr, /classification/i);

    const valid = spawnSync(process.execPath, [cli, 'validate', ...baseArgs, '--classification-file', fixture.classificationPath], { cwd: fixture.root, encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(valid.status, 0, valid.stderr);

    const forgedPlan = { ...fixture.plan, classification: { ...fixture.plan.classification, entries: fixture.plan.classification.entries.map((entry) => ({ ...entry, reason: 'Changed after planning.' })) } };
    fs.writeFileSync(planPath, JSON.stringify(forgedPlan));
    const forged = spawnSync(process.execPath, [cli, 'validate', ...baseArgs, '--classification-file', fixture.classificationPath], { cwd: fixture.root, encoding: 'utf8', env: cleanEnv });
    assert.notStrictEqual(forged.status, 0);
    assert.match(forged.stderr, /classification/i);
    fs.writeFileSync(planPath, JSON.stringify(fixture.plan));

    const missingAggregate = spawnSync(process.execPath, [cli, 'aggregate', ...baseArgs, '--results', resultsPath], { cwd: fixture.root, encoding: 'utf8', env: cleanEnv });
    assert.notStrictEqual(missingAggregate.status, 0);
    const validAggregate = spawnSync(process.execPath, [cli, 'aggregate', ...baseArgs, '--results', resultsPath, '--classification-file', fixture.classificationPath], { cwd: fixture.root, encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(validAggregate.status, 0, validAggregate.stderr);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CI plan CLI writes full plans to artifacts and keeps routing outputs bounded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-plan-transport-'));
  const planPath = path.join(root, 'ci-plan.json');
  const githubOutputPath = path.join(root, 'github-output');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');

    const retiredOutput = path.join(root, 'generated', 'claude-marketplace', 'package', 'modules', 'retired-output');
    fs.mkdirSync(retiredOutput, { recursive: true });
    for (let index = 0; index < 3000; index += 1) {
      const name = `retired-${String(index).padStart(4, '0')}.json`;
      fs.writeFileSync(path.join(retiredOutput, name), '{"retired":true}\n');
    }
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'fixture.test.js'), '// fixture\n');
    fs.writeFileSync(path.join(root, 'plugin.json'), '{"name":"dhpk"}\n');
    git('add', '-A');
    git('commit', '--no-verify', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD');

    fs.writeFileSync(path.join(root, 'plugin.json'), '{"name":"dhpk","version":"next"}\n');
    fs.rmSync(retiredOutput, { recursive: true, force: true });
    git('add', '-A');
    git('commit', '--no-verify', '-m', 'retire generated files');
    const headSha = git('rev-parse', 'HEAD');
    const checkoutSha = headSha;
    const classification = classificationFor(changedPaths(root, baseSha, headSha), baseSha, headSha);
    const classificationPath = path.join(root, 'classification.json');
    fs.writeFileSync(classificationPath, JSON.stringify(classification));
    fs.writeFileSync(githubOutputPath, '');

    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'plan',
      '--base-sha', baseSha,
      '--head-sha', headSha,
      '--checkout-sha', checkoutSha,
      '--base-ref', 'develop',
      '--classification-file', classificationPath,
      '--out', planPath,
      '--github-output', githubOutputPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(planPath), 'the complete plan must be written to the artifact file');
    assert.strictEqual(result.stdout, '', 'file output must not also print the full plan');

    const planJson = fs.readFileSync(planPath, 'utf8');
    const plan = JSON.parse(planJson);
    const planBytes = Buffer.byteLength(planJson);
    assert.ok(
      planBytes > 131072,
      `fixture plan is ${planBytes} bytes with ${plan.files.length} paths (${plan.reason}: ${plan.diffError || 'no diff error'}); it must exceed 128 KiB`,
    );
    assert.strictEqual(plan.mode, 'full');
    assert.strictEqual(plan.shardCount, 4);
    assert.deepStrictEqual(plan.packageSurfaces, ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
    assert.ok(plan.requiredJobs.includes('macos-installer'));
    assert.deepStrictEqual(fs.readFileSync(githubOutputPath, 'utf8').trim().split('\n'), [
      'mode=full',
      'shards=[0,1,2,3]',
      'macos=true',
      'surfaces=["agent-plugin","cursor-plugin","codex-native","agy-plugin"]',
    ]);
    assert.ok(fs.statSync(githubOutputPath).size < 1024, 'job outputs must contain only bounded routing metadata');

    const validated = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts/ci/ci-plan.js'), 'validate',
      '--plan', planPath,
      '--base-sha', baseSha,
      '--head-sha', headSha,
      '--checkout-sha', checkoutSha,
      '--base-ref', 'develop',
      '--classification-file', classificationPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /PASS: CI plan is valid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test('public CI plan selects existing hook owner suites and requires macOS', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'scripts', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'sample.sh'), 'old\n');
    for (const owner of ['hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js', 'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js', 'pretool-branch-safety-dedup.test.js', 'session-end.test.js', 'session-install-health-ask.test.js', 'session-install-health-version.test.js', 'session-start.test.js', 'stop-advisory-dispatch-graduation.test.js', 'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js', 'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js']) {
      fs.writeFileSync(path.join(root, 'tests', owner), '// owner\n');
    }
  }, (root) => fs.writeFileSync(path.join(root, 'scripts', 'hooks', 'sample.sh'), 'new\n'));
  try {
    assert.strictEqual(fixture.plan.mode, 'selected');
    assert.deepStrictEqual(fixture.plan.testFiles, ['hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js', 'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js', 'pretool-branch-safety-dedup.test.js', 'session-end.test.js', 'session-install-health-ask.test.js', 'session-install-health-version.test.js', 'session-start.test.js', 'stop-advisory-dispatch-graduation.test.js', 'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js', 'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js']);
    assert.strictEqual(fixture.plan.shardCount, 1);
    assert.ok(fixture.plan.requiredJobs.includes('macos-installer'));
    const runner = spawnSync(process.execPath, [path.join(__dirname, 'run-all.js'), 'tests/utils.test.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.strictEqual(runner.status, 0, runner.stderr);
    const plan = createCiPlan({ root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop', classification: fixture.classification });
    assert.strictEqual(validateCiPlan(plan, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop', classification: fixture.classification }).ok, true);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('known resource families select their existing owner suites', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'scripts', 'cli-dispatch', 'adapters'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'cli-dispatch', 'adapters', 'run-agy.sh'), 'old\n');
    for (const owner of [
      'modules.test.js', 'run-agy.test.js', 'run-codex.test.js',
      'run-cli-transport.test.js', 'cli-dispatch-launcher.test.js',
      'cli-role-resolver.test.js', 'verify-handoff.test.js',
      'verification-handoff-isolation.test.js', 'native-agent-support.test.js',
      'skill-resource-sync-security.test.js', 'skill-runtime-path-contract.test.js',
    ]) fs.writeFileSync(path.join(root, 'tests', owner), '// owner\n');
  }, (root) => fs.writeFileSync(path.join(root, 'scripts', 'cli-dispatch', 'adapters', 'run-agy.sh'), 'new\n'));
  try {
    assert.strictEqual(fixture.plan.mode, 'selected');
    assert.ok(fixture.plan.testFiles.includes('run-agy.test.js'));
    assert.ok(fixture.plan.requiredJobs.includes('macos-installer'));
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('shard verification reloads the pull request classification before trusting a downloaded plan', () => {
  const installerSuites = [
    'dhpk-install-lifecycle.test.js', 'install.test.js', 'install-assets.test.js',
    'install-codex-skills.test.js', 'install-codex-skills-planning.test.js',
    'install-codex-skills-reconciliation.test.js', 'install-codex-skills-uninstall.test.js',
    'install-codex-sync-shared.test.js', 'install-cursor-harness.test.js',
    'install-prompts.test.js', 'macos-installer-darwin.test.js',
    'macos-installer-files.test.js', 'native-shared-skill-install.test.js',
  ];
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'skills', 'harness-setup'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'harness-setup', 'SKILL.md'), 'before\n');
    installerSuites.forEach((suite) => fs.writeFileSync(path.join(root, 'tests', suite), '// suite\n'));
  }, (root) => fs.writeFileSync(path.join(root, 'skills', 'harness-setup', 'SKILL.md'), 'after\n'), 'develop', () => 'behavior');
  const planPath = path.join(fixture.root, 'downloaded-plan.json');
  const eventPath = path.join(fixture.root, 'event.json');
  fs.writeFileSync(planPath, JSON.stringify(fixture.plan));
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { body: `\`\`\`dhpk-ci-classification\n${JSON.stringify(fixture.classification)}\n\`\`\`` } }));
  const args = [
    '--directory', path.join(fixture.root, 'shards'), '--count', '1', '--run-id', RUN_ID,
    '--run-attempt', RUN_ATTEMPT, '--checkout-sha', fixture.checkoutSha,
    '--head-sha', fixture.headSha, '--plan', planPath, '--base-sha', fixture.baseSha,
    '--base-ref', 'develop',
  ];
  const previousDirectory = process.cwd();
  const previousEventPath = process.env.GITHUB_EVENT_PATH;
  try {
    process.chdir(fixture.root);
    process.env.GITHUB_EVENT_PATH = eventPath;
    assert.strictEqual(main(args), 1, 'valid independently loaded classification reaches shard evidence validation');
    delete process.env.GITHUB_EVENT_PATH;
    assert.throws(() => main(args), /plan is not authoritative/);
  } finally {
    process.chdir(previousDirectory);
    if (previousEventPath === undefined) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = previousEventPath;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('selected package changes carry only their affected platform surfaces', () => {
  assert.deepStrictEqual(packageSurfacesForFiles(['plugins/dhpk-agent/skills/demo/SKILL.md']), ['agent-plugin']);
  assert.deepStrictEqual(packageSurfacesForFiles(['plugins/dhpk-cursor/marketplace.json']), ['cursor-plugin']);
  assert.deepStrictEqual(packageSurfacesForFiles(['scripts/lib/verify-platform-packages.js']), []);
  assert.deepStrictEqual(packageSurfacesForFiles(['scripts/ci/verify-platform-packages.js']), ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
});

test('light docs-only CI checks the retained Claude marketplace package', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'contracts', 'licensing.md'), 'old\n');
  }, (root) => fs.rmSync(path.join(root, 'docs', 'contracts', 'licensing.md')));
  try {
    assert.strictEqual(fixture.plan.mode, 'light');
    assert.deepStrictEqual(fixture.plan.generatedChecks, ['claude-marketplace']);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('release-base CI checks the retained Claude marketplace package', () => {
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
    fs.writeFileSync(path.join(root, 'tests', 'example.test.js'), '// fixture owner\n');
  }, (root) => fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'new\n'), 'main');
  try {
    assert.strictEqual(fixture.plan.mode, 'full');
    assert.ok(fixture.plan.requiredJobs.includes('release-rehearsal'));
    assert.deepStrictEqual(fixture.plan.generatedChecks, ['claude-marketplace']);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('canonical content with owned evidence companions stays light and carries exact checks', () => {
  const cases = [
    ['plugins/dhpk-agent/skills/demo/SKILL.md', ['agent-plugin']],
    ['plugins/dhpk-agent/provenance.json', ['agent-plugin']],
    ['generated/claude-marketplace/package/docs/README.md', []],
    ['manifests/skill-resource-copies.json', []],
    ['generated/claude-marketplace/package/manifests/skill-resource-copies.json', []],
  ];
  const generatedChecks = ['claude-marketplace'];
  for (const [companion, packageSurfaces] of cases) {
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
      const validation = validateCiPlan(fixture.plan, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop', classification: fixture.classification });
      assert.strictEqual(validation.ok, true, validation.errors.join('; '));
      const aggregate = verifyCiResults(fixture.plan, { preflight: 'success', validate: 'success', lint: 'success', tests: 'skipped', 'macos-installer': 'skipped', 'release-rehearsal': 'skipped' }, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop', classification: fixture.classification });
      assert.strictEqual(aggregate.ok, true, aggregate.errors.join('; '));
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('retired profile output changes fail closed to full CI', () => {
  const companion = 'generated/claude-profiles/minimal/package/bundle-receipt.json';
  const fixture = gitFixture((root) => {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'old\n');
    fs.writeFileSync(path.join(root, 'tests', 'example.test.js'), '// fixture owner\n');
    fs.mkdirSync(path.dirname(path.join(root, companion)), { recursive: true });
    fs.writeFileSync(path.join(root, companion), 'old\n');
  }, (root) => {
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), 'new\n');
    fs.writeFileSync(path.join(root, companion), 'new\n');
  });
  try {
    assert.strictEqual(fixture.plan.mode, 'full');
    assert.strictEqual(fixture.plan.reason, 'generated-companion-without-canonical');
    assert.deepStrictEqual(fixture.plan.generatedChecks, ['claude-marketplace']);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
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
    const result = validateCiPlan(forged, { root: fixture.root, baseSha: fixture.baseSha, headSha: fixture.headSha, checkoutSha: fixture.checkoutSha, baseRef: 'develop', classification: fixture.classification });
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
