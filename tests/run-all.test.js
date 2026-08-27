'use strict';

// Contract coverage for the aggregate test runner's bounded scheduling.  The
// runner must remain usable as a CLI while exposing deterministic planning
// helpers so CI can prove that every test file is assigned exactly once.

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  parseOptions,
  assignShard,
  partitionFiles,
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

run('run-all');
