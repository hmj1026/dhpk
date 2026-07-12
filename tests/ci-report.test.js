'use strict';

// Behavioral guard for scripts/ci/_lib/report.js — the shared WARN/ERROR
// reporter every CI validator builds on. Proves: warn() is non-blocking by
// default but promotes to an error under strict; err() always blocks;
// done() exits non-zero iff errors accumulated (0 for warn-only, non-strict).
//
// done() calls process.exit() directly, so we temporarily stub process.exit
// to capture the code instead of killing the test runner.

const { createReporter } = require('../scripts/ci/_lib/report');
const { test, run, assert } = require('./_lib/tinytest');

const NOOP = () => {};

function callDoneCapturingExit(reporter, okMsg) {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalErr = console.error;
  let code = null;
  process.exit = (c) => {
    code = c;
    throw new Error('__EXIT__');
  };
  console.log = NOOP;
  console.error = NOOP;
  try {
    reporter.done(okMsg);
  } catch (e) {
    if (e.message !== '__EXIT__') throw e;
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalErr;
  }
  return code; // null means process.exit was never called
}

test('no findings — done() does not exit', () => {
  const r = createReporter('t', { strict: false });
  const code = callDoneCapturingExit(r, 'ok');
  assert.strictEqual(code, null);
});

test('err() forces done() to exit(1)', () => {
  const r = createReporter('t', { strict: false });
  r.err('something broke');
  const code = callDoneCapturingExit(r, 'ok');
  assert.strictEqual(code, 1);
});

test('warn() is non-blocking by default (non-strict)', () => {
  const r = createReporter('t', { strict: false });
  r.warn('a style nit');
  const code = callDoneCapturingExit(r, 'ok');
  assert.strictEqual(code, null, 'warn-only, non-strict must not fail the run');
});

test('warn() is promoted to a blocking error under strict', () => {
  const r = createReporter('t', { strict: true });
  r.warn('a style nit');
  const code = callDoneCapturingExit(r, 'ok');
  assert.strictEqual(code, 1, 'warn-only, strict must fail the run');
});

test('strict resolves from opts.strict override, ignoring argv/env', () => {
  const r = createReporter('t', { strict: true });
  assert.strictEqual(r.strict, true);
});

test('multiple err() calls all accumulate toward a single exit(1)', () => {
  const r = createReporter('t', { strict: false });
  r.err('first');
  r.err('second');
  const code = callDoneCapturingExit(r, 'ok');
  assert.strictEqual(code, 1);
});

run('ci-report');
