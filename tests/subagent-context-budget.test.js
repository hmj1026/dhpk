'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SCHEMA,
  inspectSubagentContext,
} = require('../scripts/ci/subagent-context-budget');

const ROOT = path.join(__dirname, '..');

function fixtureRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-subagent-budget-')));
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'codex', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'worker.md'), [
    '---',
    'name: worker',
    "description: 'do work'",
    '---',
    '# Worker',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'agents', 'code-reviewer.md'), [
    '---',
    'name: code-reviewer',
    "description: 'review code'",
    '---',
    '# Reviewer',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'agents', 'database-reviewer.md'), [
    '---',
    'name: database-reviewer',
    "description: 'review data'",
    '---',
    '# Database reviewer',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'codex', 'agents', 'worker.toml'), [
    'name = "worker"',
    'developer_instructions = """',
    'kernel only',
    '"""',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'codex', 'agents', 'code-reviewer.toml'), [
    'name = "code-reviewer"',
    'developer_instructions = """',
    'review kernel',
    '"""',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'codex', 'agents', 'database-reviewer.toml'), [
    'name = "database-reviewer"',
    'developer_instructions = """',
    'database kernel',
    '"""',
  ].join('\n'));
  return root;
}

test('ledger separates static estimates from runtime-observed usage', () => {
  const root = fixtureRoot();
  try {
    const report = inspectSubagentContext({
      root,
      selectedRoles: ['worker'],
      dispatchPacket: 'goal owned files',
      warmstartOutput: JSON.stringify({
        hookSpecificOutput: { additionalContext: 'hook context' },
      }),
      runtimeObserved: [{ role: 'worker', inputTokens: 99, outputTokens: 7, totalTokens: 106 }],
      scenarios: [{
        id: 'cold-worker',
        contextTier: 'cold',
        roles: ['worker'],
        dispatchPacket: 'goal owned files',
        warmstartOutput: 'hook context',
        inheritedContext: 'parent history must not count',
      }],
    });

    assert.strictEqual(report.schema, SCHEMA);
    assert.strictEqual(report.static.basis, 'static-estimate');
    assert.strictEqual(report.static.roleDescriptions.totals.entries, 3);
    assert.strictEqual(report.static.developerInstructions.totals.entries, 1);
    assert.strictEqual(report.static.dispatchPacket.tokens, 4);
    assert.strictEqual(report.static.warmstartOutput.tokens, 3);
    assert.strictEqual(report.runtimeObserved.basis, 'runtime-observed');
    assert.strictEqual(report.runtimeObserved.totals.inputTokens, 99);
    assert.strictEqual(report.runtimeObserved.totals.totalTokens, 106);
    assert.strictEqual(report.static.runtimeObserved, undefined);

    const scenario = report.static.scenarios.find((entry) => entry.id === 'cold-worker');
    assert.ok(scenario);
    assert.strictEqual(scenario.inherited_context.tokens, 0);
    assert.strictEqual(scenario.marginal_cost.tokens, 10);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ledger exposes the required default scenario catalog and rejects unexplained full context', () => {
  const report = inspectSubagentContext({ root: ROOT });
  for (const id of [
    'small-inline',
    'cold-worker',
    'architect-tdd-worker',
    'reviewer-wave-2',
    'reviewer-wave-4',
    'reviewer-wave-7',
  ]) {
    assert.ok(report.static.scenarios.some((scenario) => scenario.id === id), `missing ${id}`);
  }
  const reviewerWave = report.static.scenarios.find((scenario) => scenario.id === 'reviewer-wave-7');
  assert.ok(reviewerWave.unavailableRoles.some((role) => role.role === 'polyfill-reviewer' && role.status === 'NOT_CONFIGURED'));

  const full = inspectSubagentContext({
    root: ROOT,
    scenarios: [{ id: 'full-without-reason', contextTier: 'full', roles: [] }],
  });
  assert.ok(full.configurationErrors.some((error) => error.code === 'FULL_CONTEXT_REASON_REQUIRED'));
});

test('cold scenarios never charge inherited parent history', () => {
  const report = inspectSubagentContext({
    root: ROOT,
    scenarios: [{
      id: 'reviewer-wave-2',
      contextTier: 'cold',
      roles: ['code-reviewer', 'database-reviewer'],
      inheritedContext: 'a long parent transcript that is intentionally excluded',
      dispatchPacket: 'decision complete packet',
    }],
  });
  const scenario = report.static.scenarios[0];
  assert.strictEqual(scenario.contextTier, 'cold');
  assert.strictEqual(scenario.inherited_context.tokens, 0);
  assert.strictEqual(scenario.parentHistoryIncluded, false);
});

test('structured dispatch packets and context tiers fail closed when incomplete', () => {
  const missing = inspectSubagentContext({
    root: ROOT,
    selectedRoles: ['worker'],
    dispatchPacket: { goal: 'implement the change' },
    scenarios: [{ id: 'bad-packet', contextTier: 'cold', roles: ['worker'], dispatchPacket: {} }],
  });
  assert.ok(missing.configurationErrors.some((error) => error.code === 'DISPATCH_PACKET_INCOMPLETE'));

  const badTier = inspectSubagentContext({
    root: ROOT,
    scenarios: [{ id: 'bad-tier', contextTier: 'unbounded', roles: [] }],
  });
  assert.ok(badTier.configurationErrors.some((error) => error.code === 'INVALID_CONTEXT_TIER'));

  const missingKernel = inspectSubagentContext({
    root: ROOT,
    scenarios: [{ id: 'missing-reviewer-kernel', contextTier: 'cold', roles: ['missing-reviewer-kernel'] }],
  });
  assert.ok(missingKernel.static.scenarios[0].missingRoles.some((error) => error.role === 'missing-reviewer-kernel'));
  assert.ok(missingKernel.configurationErrors.some((error) => error.code === 'MISSING_SELECTED_DEVELOPER_INSTRUCTIONS'));
});

run('subagent-context-budget');
