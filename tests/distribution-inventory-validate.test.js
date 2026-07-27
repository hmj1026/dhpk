'use strict';

// RED (task 1.2, curate-dhpk-distribution-surfaces): scripts/lib/distribution-inventory.js
// does not exist yet. These tests pin the validator contract that task 1.4 must satisfy:
// missing lifecycle entries, invalid lifecycle values, duplicate surface membership, and
// deprecated skills leaking into generated promoted output all fail validation.

const { test, run, assert } = require('./_lib/tinytest');
const { validateDistributionInventory, LIFECYCLES } = require('../scripts/lib/distribution-inventory');

function baseInventory() {
  return {
    schema: 'dhpk.distribution-inventory.v1',
    lifecycles: ['promoted', 'optional', 'experimental', 'deprecated'],
    surfaces: ['claude-core', 'claude-module', 'codex-sync', 'codex-native'],
    skills: [
      { id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
      { id: 'vue-2-notes', path: 'modules/vue-2/skills/vue-2-notes', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
    modules: [
      { id: 'vue-2', path: 'modules/vue-2', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
}

test('LIFECYCLES exports the four canonical states', () => {
  assert.deepStrictEqual([...LIFECYCLES].sort(), ['deprecated', 'experimental', 'optional', 'promoted']);
});

test('passes when every canonical skill/module has one valid entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.deepStrictEqual(result.errors, []);
});

test('fails when a canonical skill has no lifecycle entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes', 'skills/new-skill'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /skills\/new-skill/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('fails when a canonical module has no lifecycle entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2', 'modules/new-module'],
  });
  assert.ok(result.errors.some((e) => /modules\/new-module/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('fails on an invalid lifecycle value', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'bogus';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /invalid lifecycle/i.test(e)), result.errors.join('\n'));
});

test('fails on an invalid surface value', () => {
  const inv = baseInventory();
  inv.skills[0].surfaces = ['claude-cor'];
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /invalid surface/i.test(e)), result.errors.join('\n'));
});

test('fails on duplicate surface membership within one entry', () => {
  const inv = baseInventory();
  inv.skills[0].surfaces = ['claude-core', 'claude-core'];
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /duplicate surface/i.test(e)), result.errors.join('\n'));
});

test('fails on a duplicate skill id across entries', () => {
  const inv = baseInventory();
  inv.skills.push({ id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core'] });
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /duplicate/i.test(e)), result.errors.join('\n'));
});

test('fails when a deprecated skill leaks into generated promoted output', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
    generatedPromotedSkillIds: ['tdd'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecated/i.test(e) && /promoted/i.test(e)), result.errors.join('\n'));
});

test('passes when a deprecated skill is correctly absent from generated promoted output and carries deprecation metadata', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  inv.skills[0].deprecation = {
    since: '2026-07-27',
    compatibilityWindowEnds: '2026-10-27',
    migrationNote: 'Use vue-2-notes instead.',
  };
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
    generatedPromotedSkillIds: ['vue-2-notes'],
  });
  assert.deepStrictEqual(result.errors, []);
});

test('fails when a deprecated skill has no deprecation metadata', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecation metadata/i.test(e)), result.errors.join('\n'));
});

test('fails when a deprecated skill has incomplete deprecation metadata', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  inv.skills[0].deprecation = { since: '2026-07-27' };
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /compatibilityWindowEnds/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /migrationNote/.test(e)), result.errors.join('\n'));
});

test('fails when deprecation metadata fields are whitespace-only strings, not just absent', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  inv.skills[0].deprecation = { since: '   ', compatibilityWindowEnds: '2026-10-27', migrationNote: '' };
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd', 'modules/vue-2/skills/vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecation\.since/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecation\.migrationNote/.test(e)), result.errors.join('\n'));
  assert.ok(!result.errors.some((e) => /deprecation\.compatibilityWindowEnds/.test(e)), result.errors.join('\n'));
});

run('distribution-inventory-validate');
