'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const TINYTEST = path.join(ROOT, 'tests', '_lib', 'tinytest.js');

function runTinytestSnippet(call) {
  const source = [
    `const { test, run } = require(${JSON.stringify(TINYTEST)});`,
    "test('sentinel', () => console.log('SENTINEL_RAN'));",
    call,
  ].join('\n');
  return spawnSync(process.execPath, ['-e', source], { cwd: ROOT, encoding: 'utf8' });
}

for (const [label, call] of [
  ['missing', 'run()'],
  ['null', 'run(null)'],
  ['number', 'run(7)'],
  ['empty', "run('')"],
  ['whitespace-only', "run('   ')"],
]) {
  test(`tinytest.run rejects ${label} suite names before executing tests`, () => {
    const result = runTinytestSnippet(call);
    assert.doesNotMatch(result.stdout, /SENTINEL_RAN/, result.stdout || result.stderr);
    assert.notStrictEqual(result.status, 0, `invalid suite name unexpectedly succeeded:\n${result.stdout}${result.stderr}`);
  });
}

test('tinytest.run retains a named suite summary', () => {
  const result = runTinytestSnippet("run('named-suite')");
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /named-suite: 1\/1 passed/);
  assert.doesNotMatch(result.stdout, /undefined: 1\/1 passed/);
});

run('tinytest-names');
