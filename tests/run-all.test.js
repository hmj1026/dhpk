'use strict';

// Contract coverage for the aggregate test runner's bounded scheduling.  The
// runner must remain usable as a CLI while exposing deterministic planning
// helpers so CI can prove that every test file is assigned exactly once.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  parseOptions,
  assignShard,
  partitionFiles,
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
  assert.strictEqual(fileTimeoutMs('tests/install-codex-skills.test.js', 180000), 300000);
  assert.strictEqual(fileTimeoutMs('tests/harness-facade-cli.test.js', 180000), 240000);
  assert.strictEqual(fileTimeoutMs('tests/alpha.test.js', 180000), 180000);
  assert.strictEqual(fileTimeoutMs('tests/install-codex-skills.test.js', 400000), 400000);
});

test('weighted partition assigns every selected file exactly once', () => {
  const files = [
    'install-codex-skills.test.js',
    'consumer-gate-cli.test.js',
    'run-codex.test.js',
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
    const childEnv = { ...process.env, DHPK_TEST_TIMING_FILE: directory, DHPK_TEST_JOBS: '1' };
    delete childEnv.DHPK_TEST_TIMING_CHILD;
    const result = spawnSync(process.execPath, [path.join(__dirname, 'run-all.js'), path.join(__dirname, 'render-test-timing.test.js')], {
      cwd: path.join(__dirname, '..'),
      env: childEnv,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
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

run('run-all');
