'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { generateClaudeSkillRoots, validateDistributionInventory } = require('../scripts/lib/distribution-inventory');

test('internal transport is registered everywhere but excluded from invokable generation', () => {
  const inventory = JSON.parse(JSON.stringify(require('../manifests/distribution-inventory.json')));
  const entry = inventory.skills.find((skill) => skill.id === 'cli-transport');
  assert.ok(entry, 'internal transport inventory entry is required');
  assert.strictEqual(entry.invokable, false);
  assert.deepStrictEqual([...entry.surfaces].sort(), [...inventory.surfaces].sort());
  const validation = validateDistributionInventory({ inventory });
  assert.deepStrictEqual(validation.errors, [], validation.errors.join('\n'));
  const generated = generateClaudeSkillRoots(inventory);
  assert.ok(generated.registeredSkillIds.includes('cli-transport'));
  assert.ok(!generated.generatedSkillIds.includes('cli-transport'));

  const expectedRuntimeSupport = ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge'];
  for (const surface of ['agent-plugin', 'cursor-plugin', 'agy-plugin']) {
    assert.deepStrictEqual(
      inventory.internal_runtime_skills[surface],
      expectedRuntimeSupport,
      `${surface} must explicitly carry the non-invokable transport runtime`,
    );
  }
  assert.deepStrictEqual(inventory.internal_runtime_skills['codex-native'], ['cli-dispatch-context', 'cli-transport'],
    'Codex sync must materialize its transport runtime outside capability selection');

  const unknownSupport = JSON.parse(JSON.stringify(inventory));
  unknownSupport.internal_runtime_skills['agent-plugin'] = ['missing-runtime'];
  const invalid = validateDistributionInventory({ inventory: unknownSupport });
  assert.ok(invalid.errors.some((error) => error.includes("internal_runtime_skills.agent-plugin references unknown stable id 'missing-runtime'")));
});

run();
