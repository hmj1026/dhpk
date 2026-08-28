'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  INTERNAL_RUNTIME_SURFACES,
  runtimeSupportSkillIds,
  validateInternalRuntimeSkills,
} = require('../scripts/lib/internal-runtime-skills');

function inventory() {
  return JSON.parse(JSON.stringify(require('../manifests/distribution-inventory.json')));
}

test('resolves declared runtime support without making it an invokable selection', () => {
  const source = inventory();
  const expected = ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge'];
  const entry = source.skills.find((skill) => skill.id === 'cli-dispatch-context');
  assert.ok(entry, 'dispatch context inventory entry is required');
  assert.strictEqual(entry.invokable, false);
  assert.strictEqual(entry.discoveryVisible, false);
  assert.deepStrictEqual([...entry.surfaces].sort(), [...source.surfaces].sort());
  assert.deepStrictEqual(INTERNAL_RUNTIME_SURFACES, ['agent-plugin', 'cursor-plugin', 'agy-plugin', 'codex-native']);
  for (const surface of ['agent-plugin', 'cursor-plugin', 'agy-plugin']) {
    assert.deepStrictEqual(runtimeSupportSkillIds(source, surface), expected);
  }
  assert.deepStrictEqual(runtimeSupportSkillIds(source, 'codex-native'), ['cli-dispatch-context', 'cli-transport']);
});

test('rejects malformed and unsupported runtime-support declarations', () => {
  const duplicate = inventory();
  duplicate.internal_runtime_skills['agent-plugin'] = ['cli-transport', 'cli-transport'];
  assert.throws(() => runtimeSupportSkillIds(duplicate, 'agent-plugin'), /duplicate stable id/);

  const unsupported = inventory();
  unsupported.internal_runtime_skills['unsupported-surface'] = ['cli-transport'];
  const validation = validateInternalRuntimeSkills({ inventory: unsupported });
  assert.ok(validation.errors.some((error) => error.includes("unsupported surface 'unsupported-surface'")));
});

run('internal-runtime-skills');
