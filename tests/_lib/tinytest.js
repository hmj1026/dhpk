'use strict';

// Minimal zero-dep test harness for dhpk (Node built-in assert only).
//   const { test, run, assert } = require('./_lib/tinytest');
//   test('does X', () => assert.ok(...));
//   run('suite-name');   // prints results, exits 1 on any failure

const assert = require('node:assert');

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

function run(suite) {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ok   - ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`  FAIL - ${name}\n    ${e.message}`);
    }
  }
  const passed = tests.length - failed;
  console.log(`${suite}: ${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

module.exports = { test, run, assert };
