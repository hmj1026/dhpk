'use strict';

// Coverage for scripts/ci/validate-distribution.js's reconciliation layer
// (task 1.4): reconcileDistribution() checks module-catalog membership,
// codex/skills/ mirror presence, and agents/openai.yaml presence for any
// skill declaring a Codex surface. Complements
// distribution-inventory-validate.test.js, which covers the structural
// checks (missing/invalid/duplicate/deprecated-leak).

const { test, run, assert } = require('./_lib/tinytest');
const { reconcileDistribution } = require('../scripts/lib/distribution-inventory');

function baseInventory() {
  return {
    skills: [
      { id: 'tdd', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
    ],
    modules: [
      { id: 'vue-2', path: 'modules/vue-2', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
}

test('passes when every module is catalog-selectable and every codex surface is backed', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: ['tdd'],
    moduleCatalogIds: ['vue-2'],
    hasOpenaiMetadata: () => true,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('fails when an optional module has no module-catalog entry', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: ['tdd'],
    moduleCatalogIds: [],
    hasOpenaiMetadata: () => true,
  });
  assert.ok(result.errors.some((e) => /vue-2/.test(e) && /catalog/i.test(e)), result.errors.join('\n'));
});

test('fails when a codex-sync skill has no codex/skills/ mirror', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: [],
    moduleCatalogIds: ['vue-2'],
    hasOpenaiMetadata: () => true,
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /mirror/i.test(e)), result.errors.join('\n'));
});

test('fails when a codex-sync skill has no agents/openai.yaml', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: ['tdd'],
    moduleCatalogIds: ['vue-2'],
    hasOpenaiMetadata: () => false,
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /openai\.yaml/i.test(e)), result.errors.join('\n'));
});

test('a skill with no codex surface never triggers codex reconciliation errors', () => {
  const inv = {
    skills: [{ id: 'harness-fill', path: 'skills/dhpk-harness-fill', lifecycle: 'promoted', surfaces: ['claude-core'] }],
    modules: [],
  };
  const result = reconcileDistribution({
    inventory: inv,
    codexMirrorNames: [],
    moduleCatalogIds: [],
    hasOpenaiMetadata: () => false,
  });
  assert.deepStrictEqual(result.errors, []);
});

run('validate-distribution');
