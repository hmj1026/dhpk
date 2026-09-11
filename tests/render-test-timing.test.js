'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  readTimingFile,
  summarizeTiming,
} = require('../scripts/ci/render-test-timing');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-timing-summary-'));
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

run('render-test-timing');
