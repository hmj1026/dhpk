'use strict';

// Stable authoring-test registry for the precommit/repo-verify raw-directory
// pilot. Registration describes fixture coverage; execution remains in the
// pilot isolation test and always uses the trusted tool stubs.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');

let registered = false;

function summaryFor(result) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const match = String(result.stdout || '').match(/- logs: `([^`]+)`/);
  assert.ok(match, 'runner output must expose its log directory');
  const summaryPath = path.join(match[1], 'summary.json');
  assert.ok(fs.existsSync(summaryPath), `runner summary is missing: ${summaryPath}`);
  return JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
}

function assertRunnerContract(result, expected) {
  const summary = summaryFor(result);
  assert.strictEqual(summary.overallPass, expected.overallPass, 'summary overallPass mismatch');
  for (const [name, code] of Object.entries(expected.steps || {})) {
    const step = summary.steps.find((entry) => entry.name === name);
    assert.ok(step, `summary is missing step ${name}`);
    assert.strictEqual(step.code, code, `${name} step code mismatch`);
  }
  for (const text of expected.output || []) {
    assert.ok(String(result.stdout).includes(text), `runner output is missing: ${text}`);
  }
  for (const forwarded of expected.forwarded || []) {
    assert.ok(summary.commands.some((command) => command.includes(forwarded)),
      `runner did not forward argument: ${forwarded}`);
  }
}

function definition(definition) {
  const expected = {
    status: 0,
    ...definition.expected,
  };
  return {
    ...definition,
    expected,
    assert: (result) => assertRunnerContract(result, expected),
  };
}

function registerPilotFixtures() {
  if (registered) return getFixtures();
  const fixtures = [
    definition({
      id: 'pilot-precommit-fast-success',
      skill: 'precommit',
      entry: 'scripts/precommit-runner.js',
      args: ['--mode', 'fast'],
      projectScripts: { 'lint:fix': 'fixture', test: 'fixture' },
      expected: {
        overallPass: true,
        steps: { lint_fix: 0, test_unit: 0 },
        output: ['# Precommit (fast)', '## Overall: ✅ PASS'],
      },
    }),
    definition({
      id: 'pilot-precommit-full-success',
      skill: 'precommit',
      entry: 'scripts/precommit-runner.js',
      args: ['--mode', 'full'],
      projectScripts: { 'lint:fix': 'fixture', build: 'fixture', test: 'fixture' },
      expected: {
        overallPass: true,
        steps: { lint_fix: 0, build: 0, test_unit: 0 },
        output: ['# Precommit (full)', '**build**', '## Overall: ✅ PASS'],
      },
    }),
    definition({
      id: 'pilot-precommit-first-step-failure',
      skill: 'precommit',
      entry: 'scripts/precommit-runner.js',
      args: ['--mode', 'fast'],
      projectScripts: { 'lint:fix': 'fixture', test: 'fixture' },
      env: { PILOT_FAIL_TASKS: 'lint:fix', PILOT_FAIL_CODE: '7' },
      expected: {
        overallPass: false,
        steps: { lint_fix: 7, test_unit: 0 },
        output: ['FAIL(7)', '## Overall: ❌ FAIL'],
      },
    }),
    definition({
      id: 'pilot-precommit-package-tool-unavailable',
      skill: 'precommit',
      entry: 'scripts/precommit-runner.js',
      args: ['--mode', 'fast'],
      projectScripts: { 'lint:fix': 'fixture', test: 'fixture' },
      unavailablePackageTool: true,
      expected: {
        overallPass: false,
        steps: { lint_fix: 127, test_unit: 127 },
        output: ['FAIL(127)', '## Overall: ❌ FAIL'],
      },
    }),
    definition({
      id: 'pilot-repo-verify-fast-success',
      skill: 'repo-verify',
      entry: 'scripts/verify-runner.js',
      args: ['--mode', 'fast'],
      projectScripts: { lint: 'fixture', test: 'fixture' },
      expected: {
        overallPass: true,
        steps: { lint: 0, test_unit: 0 },
        output: ['# Verify (fast)', '## Overall: ✅ PASS'],
      },
    }),
    definition({
      id: 'pilot-repo-verify-full-forwarding',
      skill: 'repo-verify',
      entry: 'scripts/verify-runner.js',
      args: ['--mode', 'full', '--integration', 'integration/example.js', '--e2e', 'e2e/example.js'],
      projectScripts: {
        lint: 'fixture',
        test: 'fixture',
        'test:integration': 'fixture',
        'test:e2e': 'fixture',
      },
      expected: {
        overallPass: true,
        steps: { lint: 0, test_unit: 0, test_integration: 0, test_e2e: 0 },
        forwarded: ['integration/example.js', 'e2e/example.js'],
        output: ['# Verify (full)', '## Overall: ✅ PASS'],
      },
    }),
    definition({
      id: 'pilot-repo-verify-first-step-failure',
      skill: 'repo-verify',
      entry: 'scripts/verify-runner.js',
      args: ['--mode', 'fast'],
      projectScripts: { lint: 'fixture', test: 'fixture' },
      env: { PILOT_FAIL_TASKS: 'lint', PILOT_FAIL_CODE: '6' },
      expected: {
        overallPass: false,
        steps: { lint: 6, test_unit: 0 },
        output: ['FAIL(6)', '## Overall: ❌ FAIL'],
      },
    }),
    definition({
      id: 'pilot-repo-verify-package-tool-unavailable',
      skill: 'repo-verify',
      entry: 'scripts/verify-runner.js',
      args: ['--mode', 'fast'],
      projectScripts: { lint: 'fixture', test: 'fixture' },
      unavailablePackageTool: true,
      expected: {
        overallPass: false,
        steps: { lint: 127, test_unit: 127 },
        output: ['FAIL(127)', '## Overall: ❌ FAIL'],
      },
    }),
  ];
  for (const fixture of fixtures) registerFixture(fixture);
  registered = true;
  return getFixtures();
}

module.exports = { registerPilotFixtures };
