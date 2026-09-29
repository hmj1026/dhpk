'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { verifyShardReports } = require('../scripts/ci/verify-test-shards');

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

run('verify-test-shards');
