'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('TDD and E2E routing remains distinct and reports stable metadata', () => {
  const policy = read('rules/execution-policy.md');
  const tdd = read('agents/tdd-guide.md');
  const e2e = read('agents/e2e-runner.md');
  assert.ok(policy.includes('RED PHPUnit') && policy.includes('`tdd-guide`'));
  assert.ok(policy.includes('Playwright user journeys') && policy.includes('`e2e-runner`'));
  for (const token of ['Phase: RED|GREEN|REFACTOR', 'Verdict: PASS|WARNING|FAIL', 'coverage_pct', 'Verification command', 'Test files']) {
    assert.ok(tdd.includes(token), `TDD contract missing ${token}`);
  }
  for (const token of ['pass_rate', 'critical_journey', 'retry_count', 'artifact_paths', '95%', 'Verdict: PASS | WARNING | FAIL']) {
    assert.ok(e2e.includes(token), `E2E contract missing ${token}`);
  }
  assert.ok(e2e.includes('never `waitForTimeout`') && !e2e.includes('sleep('), 'E2E contract must forbid sleep polling');
});

run('tdd-e2e-contracts');
