'use strict';

// RED acceptance coverage for decouple-discovery-budget-from-projection-parity.
// This file deliberately describes the post-separation boundary.  Production
// changes belong to the implementation wave, not to this characterization
// fixture.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
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
  const result = spawnSync(process.execPath, [CONTEXT_BUDGET_CLI], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 1);
  const lines = result.stdout.trim().split('\n');
  assert.deepStrictEqual(lines.slice(0, 3), [
    'discovery-visible entries: 124',
    'optional discovery-visible entries: 34',
    'budget violations: 35',
  ]);
  assert.ok(lines.some((line) => line.startsWith('FAIL ')));
});

run('discovery-budget-parity-separation');
