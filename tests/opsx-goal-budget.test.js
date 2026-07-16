'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { generateFixture, readFixture } = require('./_lib/opsx-goal-fixtures');

const ROOT = path.join(__dirname, '..');
const CONTRACT = fs.readFileSync(path.join(ROOT, 'skills', 'opsx-apply-goal', 'references', 'gate-contracts.md'), 'utf8');

test('representative goal fixtures stay within the target or hard-stop without output', () => {
  for (const name of ['minimal', 'normal', 'maximum-gate', 'codex', 'smoke']) {
    const result = generateFixture(readFixture(name));
    assert.ok(result.bytes <= 4000, `${name} exceeds hard cap: ${result.bytes}`);
    assert.strictEqual(result.mode, 'full', `${name} should emit normally`);
  }
  assert.ok(generateFixture(readFixture('normal')).bytes <= 3400, 'normal fixture must meet target');
  assert.ok(
    generateFixture(readFixture('normal')).goal.includes('First run ONE Bash orientation command'),
    'fixture must compose the production goal-template literal, not a parallel test-only core',
  );
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
  for (const token of ['${CLAUDE_PLUGIN_ROOT:-', 'hard-rule', 'Unknown skill', 'dhpk:codex-fast-worker', 'dhpk:agy-fast-worker', '.pending-*', '.unresolved-verdict']) {
    assert.ok(goal.includes(token), `missing required safety token: ${token}`);
  }
  for (const token of ['TEST', 'COVERAGE', 'BUILD', 'LINT', 'SMOKE', 'REVIEW', 'ARTIFACT', 'VERDICT']) {
    assert.ok(goal.includes(`${token}:`), `missing gate token: ${token}`);
  }
  for (const token of ['UTF-8 bytes', '3,400', '4,000', 'Required gates']) {
    assert.ok(CONTRACT.includes(token), `gate contract reference missing: ${token}`);
  }
});

run('opsx-goal-budget');
