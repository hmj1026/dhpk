'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { sweepStaleScratch, defaultJobs, parseOptions } = require('./run-all');

const HOUR = 60 * 60 * 1000;

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sweep-fixture-'));
}

function mkScratch(root, name, ageMs) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'x'), 'x');
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(dir, when, when);
  return dir;
}

test('sweepStaleScratch removes old scratch dirs and keeps fresh ones owned by live runs', () => {
  const root = mkRoot();
  try {
    const stale = mkScratch(root, '.dhpk-test-scratch-old-abc123', 3 * HOUR);
    const fresh = mkScratch(root, '.dhpk-test-scratch-live-def456', 1000);
    const removed = sweepStaleScratch(root);
    assert.deepStrictEqual(removed, ['.dhpk-test-scratch-old-abc123']);
    assert.ok(!fs.existsSync(stale));
    assert.ok(fs.existsSync(fresh));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sweepStaleScratch leaves unrelated entries and symlinks alone', () => {
  const root = mkRoot();
  try {
    const other = mkScratch(root, 'keep-me', 3 * HOUR);
    const outside = mkScratch(root, 'outside', 3 * HOUR);
    fs.symlinkSync(outside, path.join(root, '.dhpk-test-scratch-link'));
    assert.deepStrictEqual(sweepStaleScratch(root), []);
    assert.ok(fs.existsSync(other));
    assert.ok(fs.existsSync(path.join(outside, 'x')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sweepStaleScratch tolerates a missing root', () => {
  assert.deepStrictEqual(sweepStaleScratch(path.join(os.tmpdir(), 'dhpk-no-such-root-x')), []);
});

test('default jobs is min(cpus, 4) and DHPK_TEST_JOBS overrides it', () => {
  assert.strictEqual(defaultJobs(), Math.max(1, Math.min(os.availableParallelism(), 4)));
  assert.strictEqual(parseOptions([], {}).jobs, defaultJobs());
  assert.strictEqual(parseOptions([], { DHPK_TEST_JOBS: '2' }).jobs, 2);
});

run('run-all-scratch-sweep');
