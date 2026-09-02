'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  loadDiscoveryBudgets,
  inspectDiscoveryContext,
  inspectAggregateDiscoveryContext,
  renderBudgetReport,
} = require('../scripts/ci/context-budget');
const { evaluateAggregateDiscoveryBudget } = require('../scripts/lib/discovery-budget');

const ROOT = path.join(__dirname, '..');

test('discovery budgets are declared by lifecycle and host surface', () => {
  const budgets = loadDiscoveryBudgets(ROOT);
  for (const lifecycle of ['promoted', 'optional', 'experimental', 'deprecated']) {
    for (const surface of ['claude-core', 'claude-module', 'codex-sync', 'codex-native']) {
      assert.ok(budgets[lifecycle][surface].words > 0, `${lifecycle}/${surface} words`);
      assert.ok(budgets[lifecycle][surface].tokens > 0, `${lifecycle}/${surface} tokens`);
    }
  }
});

test('optional invokable entries remain explicitly discovery-visible while internal runtime support stays host-invisible', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const report = inspectDiscoveryContext({ root: ROOT, inventory });
  const runtimeSupportIds = new Set(['cli-dispatch-context', 'cli-transport']);
  const optional = report.entries.filter((entry) => entry.lifecycle === 'optional' && !runtimeSupportIds.has(entry.id));
  assert.ok(optional.length > 0);
  assert.ok(optional.every((entry) => entry.discoveryVisible === true));
  assert.ok(optional.every((entry) => /runtime|activation|optional/i.test(entry.visibilityReason)));
  const runtimeSupport = report.entries.filter((entry) => runtimeSupportIds.has(entry.id));
  assert.strictEqual(runtimeSupport.length, 16);
  assert.deepStrictEqual([...new Set(runtimeSupport.map((entry) => entry.id))].sort(), [...runtimeSupportIds].sort());
  assert.ok(runtimeSupport.every((entry) => entry.discoveryVisible === false));
  assert.ok(runtimeSupport.every((entry) => /host-invisible/i.test(entry.visibilityReason)));
});

test('budget report is deterministic and identifies out-of-budget fixture entries', () => {
  const report = inspectDiscoveryContext({
    root: ROOT,
    inventory: {
      skills: [{
        id: 'fixture', name: 'dhpk-fixture', path: 'skills/dhpk-fixture', lifecycle: 'promoted',
        tier: 'core', profiles: ['core'], surfaces: ['claude-core'],
      }],
      modules: [],
    },
    readDescription: () => Array(200).fill('word').join(' '),
  });
  assert.ok(report.violations.length > 0);
  const output = renderBudgetReport(report);
  assert.match(output, /discovery-visible/);
  assert.match(output, /fixture/);
});

test('aggregate default discovery budget reports the curated count and reduction', () => {
  const report = inspectAggregateDiscoveryContext({
    root: ROOT,
    inventory: {
      profile_policy: { required_core_ids: ['one', 'two'] },
      skills: [
        { id: 'one', name: 'dhpk-one', path: 'skills/one', lifecycle: 'promoted', surfaces: ['claude-core'], invocation_class: 'implicit-eligible' },
        { id: 'two', name: 'dhpk-two', path: 'skills/two', lifecycle: 'promoted', surfaces: ['claude-core'], invocation_class: 'explicit-only' },
      ],
    },
    selectedStableIds: ['one', 'two'],
    readDescription: (entry) => entry.id === 'one' ? 'short description' : 'explicit description',
    baseline: { entries: 10, tokens: 100 },
    maxEntries: 15,
    minReductionPercent: 70,
  });
  assert.strictEqual(report.ok, true, JSON.stringify(report));
  assert.strictEqual(report.entries, 1);
  assert.strictEqual(report.tokens, 5);
  assert.strictEqual(report.baseline.entries, 10);
  assert.strictEqual(report.baseline.tokens, 100);
  assert.ok(report.reductionPercent >= 70);
});

test('aggregate budget excludes explicit-only entries and fails closed on count/reduction ceilings', () => {
  const items = [
    { id: 'implicit-1', stableId: 'implicit-1', discoveryVisible: true, tokens: 31 },
    { id: 'explicit', stableId: 'explicit', discoveryVisible: false, tokens: 999 },
  ];
  const countFailure = evaluateAggregateDiscoveryBudget({
    items: [...items, ...Array.from({ length: 15 }, (_, index) => ({
      id: `implicit-${index + 2}`,
      stableId: `implicit-${index + 2}`,
      discoveryVisible: true,
      tokens: 1,
    }))],
    baseline: { entries: 20, tokens: 100 },
    maxEntries: 15,
    minReductionPercent: 0,
  });
  assert.strictEqual(countFailure.ok, false);
  assert.strictEqual(countFailure.entries, 16);
  assert.ok(countFailure.excessEntries.includes('implicit-16'));

  const reductionFailure = evaluateAggregateDiscoveryBudget({
    items,
    baseline: { entries: 20, tokens: 100 },
    maxEntries: 15,
    minReductionPercent: 70,
  });
  assert.strictEqual(reductionFailure.ok, false);
  assert.ok(reductionFailure.violations.some((violation) => /reduction/i.test(violation.reason)));
  assert.strictEqual(reductionFailure.entries, 1);
});

test('aggregate budget reports invalid configuration and missing visible measurements', () => {
  const report = evaluateAggregateDiscoveryBudget({
    items: [{ id: 'missing', discoveryVisible: true, tokens: Number.NaN }],
    baseline: { entries: -1, tokens: 0 },
    maxEntries: 15.5,
    minReductionPercent: 101,
  });
  assert.strictEqual(report.ok, false);
  const codes = report.configurationErrors.map((error) => error.code);
  assert.ok(codes.includes('INVALID_AGGREGATE_BASELINE_ENTRIES'));
  assert.ok(codes.includes('INVALID_AGGREGATE_BASELINE_TOKENS'));
  assert.ok(codes.includes('INVALID_AGGREGATE_ENTRY_LIMIT'));
  assert.ok(codes.includes('INVALID_AGGREGATE_REDUCTION_LIMIT'));
  assert.ok(codes.includes('MISSING_AGGREGATE_MEASUREMENT'));
});

test('aggregate CLI emits a reproducible JSON report and CI wires the gate', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'context-budget.js'), '--aggregate', '--json',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.schema, 'dhpk.aggregate-discovery-report.v1');
  assert.strictEqual(report.profileId, 'minimal');
  assert.strictEqual(report.baseline.entries, 63);
  assert.strictEqual(report.baseline.tokens, 5704);
  assert.ok(report.entries <= 15);
  assert.ok(report.reductionPercent >= 70);
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(workflow.includes('node scripts/ci/context-budget.js --aggregate'));
});

run('context-budget');
