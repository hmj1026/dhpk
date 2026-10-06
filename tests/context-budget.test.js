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

test('aggregate CLI emits a JSON report with an exit code matching its verdict', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'context-budget.js'), '--aggregate', '--json',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.schema, 'dhpk.aggregate-discovery-report.v1');
  assert.strictEqual(report.profileId, 'minimal');
  assert.strictEqual(typeof report.ok, 'boolean');
  assert.strictEqual(result.status, report.ok ? 0 : 1, result.stderr);
});

// Consolidated source suite: discovery-budget-parity-separation.
{

  // RED acceptance coverage for decouple-discovery-budget-from-projection-parity.
  // This file deliberately describes the post-separation boundary.  Production
  // changes belong to the implementation wave, not to this characterization
  // fixture.

  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    createDistributionArtifact,
    createDistributionPlan,
  } = require('../scripts/lib/distribution-projection-contract');
  const { inspectDiscoveryContext } = require('../scripts/ci/context-budget');

  const ROOT = path.join(__dirname, '..');
  const CONTEXT_BUDGET_CLI = path.join(ROOT, 'scripts', 'ci', 'context-budget.js');

  // The new owner is intentionally loaded lazily so budget-boundary failures
  // remain observable while the parity module is still being introduced.
  let projectionParity = null;
  let projectionParityLoadError = null;
  try {
    projectionParity = require('../scripts/lib/distribution-projection-parity');
  } catch (error) {
    projectionParityLoadError = error;
  }

  function parityApi() {
    assert.ifError(projectionParityLoadError);
    assert.strictEqual(typeof projectionParity.compareDistributionProjections, 'function');
    return projectionParity;
  }

  function skillInventory({ surface = 'claude-core', discoveryVisible } = {}) {
    const skill = {
      id: 'fixture',
      name: 'dhpk-fixture',
      path: 'skills/dhpk-fixture',
      lifecycle: 'promoted',
      tier: 'core',
      profiles: ['minimal'],
      surfaces: [surface],
    };
    if (discoveryVisible !== undefined) skill.discoveryVisible = discoveryVisible;
    return { skills: [skill], modules: [] };
  }

  function profileScope() {
    return {
      id: 'minimal',
      selectedStableIds: ['fixture'],
    };
  }

  function scopedIdentity() {
    return {
      planFingerprint: 'plan-fixture',
      artifactFingerprint: 'artifact-fixture',
    };
  }

  function budgetsFor(surface = 'claude-core', words = 120, tokens = 180) {
    return {
      promoted: {
        [surface]: { words, tokens },
      },
    };
  }

  function makeProjection({ outputFingerprint = 'output-fixture', planFingerprint = null } = {}) {
    const entry = {
      stableId: 'fixture',
      source: 'skills/dhpk-fixture/SKILL.md',
      sourceFingerprint: 'source-fixture',
      destination: 'skills/dhpk-fixture/SKILL.md',
      owner: 'fixture',
      transform: { id: 'identity', version: '1' },
      expectedFingerprint: outputFingerprint,
      mode: 0o644,
      symlinkPolicy: 'forbid',
    };
    const planResult = createDistributionPlan({
      compilerVersion: 'test-1',
      surface: 'claude-profile',
      inventoryFingerprint: 'inventory-fixture',
      inputFingerprint: 'input-fixture',
      ownershipRoot: '.claude-plugin',
      profileSelection: {
        id: 'minimal',
        modules: ['core'],
        version: 'claude-profile-v1',
        inventoryFingerprint: 'inventory-fixture',
        inputFingerprint: 'input-fixture',
      },
      selectionPolicy: {
        source: 'profile',
        version: 'claude-profile-v1',
        profileId: 'minimal',
      },
      compatibilityMode: 'profile',
      entries: [entry],
      selectedStableIds: ['fixture'],
    });
    assert.strictEqual(planResult.ok, true);
    const plan = planFingerprint
      ? { ...planResult.value, planFingerprint }
      : planResult.value;
    const artifactResult = createDistributionArtifact({
      planFingerprint: plan.planFingerprint,
      adapter: { id: 'fixture-adapter', version: '1' },
      outputs: [{
        stableId: entry.stableId,
        destination: entry.destination,
        expectedFingerprint: outputFingerprint,
      }],
    });
    assert.strictEqual(artifactResult.ok, true);
    return {
      surface: 'claude-profile',
      profile: { id: 'minimal' },
      plan,
      artifact: artifactResult.value,
    };
  }

  function parityVerdict(result) {
    assert.ok(result && result.evidence, 'parity must return an EvidenceResult');
    return result.evidence.verdict;
  }

  test('missing budget is a configuration failure, never a zero-limit content overflow', () => {
    const report = inspectDiscoveryContext({
      root: ROOT,
      inventory: skillInventory({ surface: 'claude-user-config', discoveryVisible: true }),
      budgets: budgetsFor('claude-core'),
      readDescription: () => 'short description',
    });
    assert.ok(Array.isArray(report.configurationErrors));
    assert.ok(report.configurationErrors.some((error) => error.code === 'MISSING_BUDGET_CONFIGURATION'));
    assert.strictEqual(report.violations.length, 0);
    assert.strictEqual(report.ok, false);
  });

  test('unknown discovery visibility is reported as configuration, not inferred as visible', () => {
    const report = inspectDiscoveryContext({
      root: ROOT,
      inventory: skillInventory({ surface: 'claude-core' }),
      budgets: budgetsFor('claude-core'),
      readDescription: () => 'short description',
    });
    assert.ok(Array.isArray(report.configurationErrors));
    assert.ok(report.configurationErrors.some((error) => error.code === 'UNKNOWN_DISCOVERY_VISIBILITY'));
    assert.strictEqual(report.violations.length, 0);
    assert.strictEqual(report.entries[0].discoveryVisible, null);
  });

  test('scoped budget rejects an unbound profile/artifact identity', () => {
    const report = inspectDiscoveryContext({
      root: ROOT,
      inventory: skillInventory({ discoveryVisible: true }),
      budgets: budgetsFor(),
      profileSelection: profileScope(),
      readDescription: () => 'short description',
    });
    assert.ok(Array.isArray(report.configurationErrors));
    assert.ok(report.configurationErrors.some((error) => error.code === 'MISSING_SCOPE_IDENTITY'));
    assert.strictEqual(report.violations.length, 0);
    assert.strictEqual(report.ok, false);
  });

  test('claude-user-config accounting keeps its category and manifest identity contract', () => {
    const report = inspectDiscoveryContext({
      root: ROOT,
      inventory: skillInventory({ surface: 'claude-user-config', discoveryVisible: true }),
      budgets: budgetsFor('claude-user-config'),
      artifactIdentity: { artifactFingerprint: 'plugin-manifest-fixture' },
      readDescription: () => 'short description',
    });
    assert.strictEqual(report.category, 'claude-user-config');
    assert.strictEqual(report.scope, 'claude-plugin.userConfig');
    assert.strictEqual(report.receipt.claims[0], 'discovery budget category claude-user-config');
    assert.strictEqual(report.entries[0].artifactFingerprint, 'plugin-manifest-fixture');
  });

  test('a budget overflow remains independent while projection parity passes', () => {
    const budget = inspectDiscoveryContext({
      root: ROOT,
      inventory: skillInventory({ discoveryVisible: true }),
      budgets: budgetsFor('claude-core', 1, 1),
      readDescription: () => 'one two three four',
    });
    assert.ok(budget.violations.length > 0);
    assert.strictEqual(budget.ok, false);

    const projection = makeProjection();
    const parity = parityApi().compareDistributionProjections({
      expected: projection,
      actual: projection,
      stage: 'structural',
    });
    assert.strictEqual(parity.ok, true);
    assert.strictEqual(parityVerdict(parity), 'PASS');
  });

  test('projection drift remains independent while the discovery budget passes', () => {
    const budget = inspectDiscoveryContext({
      root: ROOT,
      inventory: skillInventory({ discoveryVisible: true }),
      budgets: budgetsFor(),
      readDescription: () => 'short description',
    });
    assert.strictEqual(budget.violations.length, 0);
    assert.strictEqual(budget.ok, true);

    const expected = makeProjection();
    const actual = makeProjection({ outputFingerprint: 'output-drifted' });
    const parity = parityApi().compareDistributionProjections({
      expected,
      actual,
      stage: 'structural',
    });
    assert.strictEqual(parity.ok, false);
    assert.strictEqual(parityVerdict(parity), 'FAIL');
    assert.match(parity.evidence.diagnostics.join('\n'), /fixture|fingerprint/i);
  });

  test('stale or unknown plan identity fails parity closed', () => {
    const expected = makeProjection();
    const actual = makeProjection({ planFingerprint: 'unknown-plan' });
    const parity = parityApi().compareDistributionProjections({
      expected,
      actual,
      stage: 'structural',
    });
    assert.strictEqual(parity.ok, false);
    assert.match(parity.evidence.diagnostics.join('\n'), /identity|fingerprint|stale/i);
  });

  test('legacy context-budget CLI keeps its summary headings and exit behavior', () => {
    const result = spawnSync(process.execPath, [CONTEXT_BUDGET_CLI, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    const lines = result.stdout.trim().split('\n');
    const report = JSON.parse(lines[lines.length - 1]);
    const hasFailure = report.violations.length > 0 || report.configurationErrors.length > 0;
    assert.strictEqual(result.status, hasFailure ? 1 : 0, result.stderr);
    // Counts follow the live inventory; the legacy contract is the heading shape.
    assert.match(lines[0], /^discovery-visible entries: \d+$/);
    assert.match(lines[1], /^optional discovery-visible entries: \d+$/);
    assert.match(lines[2], /^budget violations: \d+$/);
  });
}


run('context-budget');
