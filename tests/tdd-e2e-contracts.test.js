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
  assert.ok(policy.includes('RED Vitest/Jest'), 'dispatch table missing the RED Vitest/Jest row');
  assert.ok(policy.includes('Playwright user journeys') && policy.includes('`e2e-runner`'));
  for (const token of ['Phase: RED|GREEN|REFACTOR', 'Verdict: PASS|WARNING|FAIL', 'coverage_pct', 'Verification command', 'Test files']) {
    assert.ok(tdd.includes(token), `TDD contract missing ${token}`);
  }
  for (const token of ['pass_rate', 'critical_journey', 'retry_count', 'artifact_paths', '95%', 'Verdict: PASS | WARNING | FAIL']) {
    assert.ok(e2e.includes(token), `E2E contract missing ${token}`);
  }
  assert.ok(e2e.includes('never `waitForTimeout`') && !e2e.includes('sleep('), 'E2E contract must forbid sleep polling');
});

test('TDD GREEN handback and scoped-loop contract is explicit', () => {
  const tdd = read('agents/tdd-guide.md');
  for (const token of ['≤2 files', 'fast-worker-ready fix-spec', 'scoped verification command', '--filter <TestClass::method>', 'full applicable suite once', 'REFACTOR: skipped (minimal diff)', 'Cross-worker file-collision guard']) {
    assert.ok(tdd.includes(token), `TDD handback contract missing ${token}`);
  }
});

test('E2E application-fix handback, seed cleanup, and helper reuse are explicit', () => {
  const e2e = read('agents/e2e-runner.md');
  for (const token of ['fast-worker-ready fix-spec', 're-run the originating journey as acceptance', 'rolled back', 'explicitly deleted in teardown', 'Reuse shared spec helpers']) {
    assert.ok(e2e.includes(token), `E2E boundary contract missing ${token}`);
  }
});

test('execution policy routes review and specialist fix-spec batches through fast-worker', () => {
  const policy = read('rules/execution-policy.md');
  for (const token of ['whole fix batch exceeds the ≤2-file inline bound', 'Specialist fix-spec handback', 'ONE consolidated parallel reviewer batch', 'at most once per change']) {
    assert.ok(policy.includes(token), `execution policy missing ${token}`);
  }
});

run('tdd-e2e-contracts');
