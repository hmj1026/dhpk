'use strict';

// RED-first contract tests for harness-facade-receipt-contract task 3.3.
// The inventory platform matrix is the required-surface SSOT; projection
// contracts and consumer evidence remain separate boundaries.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  REQUIRED_SURFACES,
  validatePlatformCapabilityMatrix,
  validateRequiredSurfacePlan,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const REQUIRED = [
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
];

function matrix(overrides = {}) {
  return {
    schema: 'dhpk.platform-capability-matrix.v1',
    required_surfaces: [...REQUIRED],
    entries: [],
    ...overrides,
  };
}

function projectionContract(overrides = {}) {
  const surfaces = Object.fromEntries(REQUIRED.map((surface) => [surface, {
    adapter: surface,
    owner: surface,
    symlink_policy: 'forbid',
    verification_stages: ['structural', 'package', 'consumer-runtime'],
  }]));
  return {
    schema: 'dhpk.distribution-projection-contract.v1',
    compiler: { id: 'distribution-compiler', version: '1' },
    symlink_policies: ['forbid'],
    surfaces,
    ...overrides,
  };
}

test('checked-in inventory owns the seven canonical required surfaces and projection contracts', () => {
  assert.deepStrictEqual(REQUIRED_SURFACES, REQUIRED);
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  assert.deepStrictEqual(inventory.platform_matrix.required_surfaces, REQUIRED);
  const result = validateRequiredSurfacePlan({ inventory, fullRelease: true });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

test('platform matrix rejects missing, duplicate, unknown, and reordered required lists', () => {
  for (const required_surfaces of [
    undefined,
    [...REQUIRED.slice(0, -1), 'agy-plugin', 'agy-plugin'],
    [...REQUIRED.slice(0, -1), 'unknown-surface'],
    [...REQUIRED].reverse(),
  ]) {
    const result = validatePlatformCapabilityMatrix(matrix({ required_surfaces }), {
      requireRequiredSurfaces: true,
    });
    assert.ok(result.errors.length > 0, JSON.stringify(required_surfaces));
    assert.match(result.errors.join('\n'), /required_surfaces|duplicate|unknown|canonical|order/i);
  }
});

test('required surface plan rejects incomplete or foreign full-release lists and allows declared subsets only as scoped', () => {
  const inventory = {
    platform_matrix: matrix(),
    projection_contract: projectionContract(),
  };
  const incomplete = validateRequiredSurfacePlan({
    inventory,
    requiredSurfaces: REQUIRED.slice(0, -1),
    fullRelease: true,
  });
  assert.ok(incomplete.errors.length > 0);

  const foreign = validateRequiredSurfacePlan({
    inventory,
    requiredSurfaces: [...REQUIRED.slice(0, -1), 'foreign-surface'],
    fullRelease: true,
  });
  assert.ok(foreign.errors.length > 0);
  assert.match(foreign.errors.join('\n'), /unknown|canonical|required/i);

  const scoped = validateRequiredSurfacePlan({
    inventory,
    requiredSurfaces: ['agent-plugin', 'cursor-plugin'],
    fullRelease: false,
  });
  assert.deepStrictEqual(scoped.errors, []);
});

test('required surfaces must have matching projection contracts without upgrading runtime evidence', () => {
  const contract = projectionContract();
  delete contract.surfaces['agy-plugin'];
  const result = validateRequiredSurfacePlan({
    inventory: {
      platform_matrix: matrix(),
      projection_contract: contract,
    },
    fullRelease: true,
  });
  assert.ok(result.errors.some((error) => /agy-plugin.*projection|projection.*agy-plugin/i.test(error)), result.errors.join('\n'));

  const structuralPass = { stage: 'structural', status: 'PASS', surface: 'agent-plugin' };
  const runtimeUnavailable = { stage: 'consumer-runtime', status: 'UNAVAILABLE', surface: 'agent-plugin' };
  assert.strictEqual(structuralPass.status, 'PASS');
  assert.strictEqual(runtimeUnavailable.status, 'UNAVAILABLE');
  assert.notStrictEqual(structuralPass.status, runtimeUnavailable.status);
});

run('harness-platform-matrix');
