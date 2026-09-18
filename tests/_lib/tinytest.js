'use strict';

// Minimal zero-dep test harness for dhpk (Node built-in assert only).
//   const { test, run, assert } = require('./_lib/tinytest');
//   test('does X', () => assert.ok(...));
//   run('suite-name');   // prints results, exits 1 on any failure

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');

// Hand every test process a physical temp root. On macOS os.tmpdir() resolves
// to /var/folders/... (and /tmp), both of which reach the real directory
// through a symlink. The package generators deliberately refuse symlinked
// ancestors so provenance binds to a real path, which made package and
// consumer suites fail locally on macOS while passing on Linux CI. Resolving
// TMPDIR here fixes the harness instead of weakening that guard, and covers
// both `node tests/x.test.js` and tests/run-all.js children because every test
// file requires this module.
function usePhysicalTmpdir() {
  const current = os.tmpdir();
  let real;
  try {
    real = fs.realpathSync(current);
  } catch (e) {
    console.error(`tinytest: cannot resolve temp root '${current}': ${e.message}`);
    return;
  }
  if (real !== current) process.env.TMPDIR = real;
}
usePhysicalTmpdir();

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

async function run(suite) {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok   - ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`  FAIL - ${name}\n    ${e.message}`);
    }
  }
  const passed = tests.length - failed;
  console.log(`${suite}: ${passed}/${tests.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

module.exports = { test, run, assert };
