'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { generateFixture, readFixture } = require('./_lib/opsx-goal-fixtures');

const ROOT = path.join(__dirname, '..');
const CONTRACT = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal', 'references', 'gate-contracts.md'), 'utf8');

test('representative goal fixtures stay within the target or hard-stop without output', () => {
  for (const name of ['minimal', 'normal', 'maximum-gate', 'codex', 'smoke']) {
    const result = generateFixture(readFixture(name));
    assert.ok(result.bytes <= 4000, `${name} exceeds hard cap: ${result.bytes}`);
    assert.strictEqual(result.mode, 'full', `${name} should emit normally`);
  }
  assert.ok(generateFixture(readFixture('normal')).bytes <= 3600, 'normal fixture must meet target');
  assert.ok(
    generateFixture(readFixture('normal')).goal.includes('First run ONE Bash orientation command'),
    'fixture must compose the production goal-template literal, not a parallel test-only core',
  );
});

test('verification fixtures emit only their configured Part 3 gates into the measured goal', () => {
  const minimal = generateFixture(readFixture('minimal'));
  const normal = generateFixture(readFixture('normal'));
  const codex = generateFixture(readFixture('codex'));
  const smoke = generateFixture(readFixture('smoke'));

  for (const gate of ['TEST:', 'COVERAGE:', 'BUILD:', 'LINT:', 'SMOKE:']) {
    assert.ok(!minimal.goal.includes(gate), `minimal fixture must omit ${gate}`);
  }
  assert.ok(normal.goal.includes('TEST: node tests/run-all.js --jobs 4 output shows 0 failures.'));
  for (const gate of ['COVERAGE:', 'BUILD:', 'LINT:', 'SMOKE:']) {
    assert.ok(!normal.goal.includes(gate), `normal fixture must omit ${gate}`);
  }
  assert.ok(!normal.goal.includes('dhpk:codex-fast-worker'), 'normal fixture uses the default worker clause');
  assert.ok(codex.goal.includes('dhpk:codex-fast-worker selected; fallback dhpk:agy-fast-worker → dhpk:fast-worker'));
  assert.notStrictEqual(codex.goal, normal.goal, 'the Codex fixture must select a different dispatch clause');
  assert.ok(smoke.goal.includes('SMOKE: read-only runtime probe via dhpk:smoke-tester; require first-line Verdict: PASS and one pasted observed output line, or paste the failing launch command and output.'));
  assert.notStrictEqual(smoke.goal, minimal.goal, 'the smoke fixture must emit its configured smoke gate');
});

test('maximum verification fixture measures each configured command and the exact UTF-8 output', () => {
  const result = generateFixture(readFixture('maximum-gate'));
  assert.strictEqual(result.mode, 'full', 'maximum-gate fixture must stay below the hard cap');
  assert.ok(result.goal.includes('COVERAGE: node tests/run-all.js --coverage output shows 0 failures AND total coverage ≥ 80%.'));
  assert.ok(result.goal.includes('BUILD: npm run build output shows 0 errors.'));
  assert.ok(result.goal.includes('LINT: npm run lint output shows 0 errors.'));
  assert.ok(result.goal.includes('SMOKE: read-only runtime probe via dhpk:smoke-tester; require first-line Verdict: PASS and one pasted observed output line, or paste the failing launch command and output.'));
  assert.ok(result.goal.includes('RED/E2E Playwright → dhpk:e2e-runner;'));
  assert.strictEqual(result.bytes, Buffer.byteLength(result.goal, 'utf8'));
});

test('over-cap fixture uses wc -c measurement and emits Block A without a goal', () => {
  const result = generateFixture(readFixture('over-cap'));
  assert.ok(result.bytes > 4000, `fixture did not exceed cap: ${result.bytes}`);
  assert.strictEqual(result.mode, 'blocked');
  assert.strictEqual(result.goal, '');
  assert.ok(result.blockA.includes(`${result.bytes} UTF-8 bytes`));
});

test('goal fixtures retain required safety tokens and compact gate contracts', () => {
  const goal = generateFixture(readFixture('maximum-gate')).goal;
  for (const token of ['references/execution-bundle/rules/execution-policy-kernel.md', 'hard-rule', 'Unknown skill', 'dhpk:codex-fast-worker', 'dhpk:agy-fast-worker', 'Review Gate status', 'unresolved obligation']) {
    assert.ok(goal.includes(token), `missing required safety token: ${token}`);
  }
  for (const token of ['COVERAGE:', 'BUILD:', 'LINT:', 'SMOKE:']) {
    assert.ok(goal.includes(token), `missing gate token: ${token}`);
  }
  for (const token of ['UTF-8 bytes', '3,600', '4,000', 'Required gates']) {
    assert.ok(CONTRACT.includes(token), `gate contract reference missing: ${token}`);
  }
});

run('opsx-goal-budget');
