'use strict';

// RED contract for the portable command-skill migration.  The fixtures below
// are deliberately literal: expected public names, stable IDs, and rename
// paths must remain visible in this test instead of being derived from the
// inventory under test.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventoryV2,
  validateRenamedSkillNames,
  resolveSkillIdentity,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));

const EXPECTED_GENERIC_NAMES = Object.freeze([
  'create-pr',
  'git-worktree',
  'merge-prep',
  'pr-summary',
  'proposal-analyze',
  'project-brief',
  'doc-refactor',
  'update-docs',
  'update-codemaps',
  'precommit',
  'dep-audit',
  'repo-verify',
  'code-simplify',
  'harness-audit',
  'review-pending',
  'spec-mine',
]);

const EXPECTED_ACTIVE_RENAMES = Object.freeze({
  'git-smart-commit': {
    oldName: 'dhpk-git-smart-commit',
    oldPath: 'skills/dhpk-git-smart-commit',
    newName: 'git-smart-commit',
    newPath: 'skills/git-smart-commit',
  },
  'release-creator': {
    oldName: 'dhpk-release-creator',
    oldPath: 'skills/dhpk-release-creator',
    newName: 'release-creator',
    newPath: 'skills/release-creator',
  },
  'matrix-cell-onboard': {
    oldName: 'dhpk-matrix-cell-onboard',
    oldPath: 'skills/dhpk-matrix-cell-onboard',
    newName: 'matrix-cell-onboard',
    newPath: 'skills/matrix-cell-onboard',
  },
  tdd: {
    oldName: 'dhpk-tdd-workflow',
    oldPath: 'skills/dhpk-tdd-workflow',
    newName: 'tdd-workflow',
    newPath: 'skills/tdd-workflow',
  },
  'js-static-check-strategy': {
    oldName: 'dhpk-js-static-check-strategy',
    oldPath: 'skills/dhpk-js-static-check-strategy',
    newName: 'js-static-check-strategy',
    newPath: 'skills/js-static-check-strategy',
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function minimalSkill(overrides = {}) {
  return {
    id: 'tdd',
    name: 'tdd-workflow',
    name_style: 'portable-skill',
    path: 'skills/tdd-workflow',
    capability_id: 'dhpk.tdd',
    invocation_class: 'implicit-eligible',
    lifecycle: 'promoted',
    tier: 'core',
    profiles: ['default'],
    surfaces: ['claude-core'],
    ...overrides,
  };
}

function portableInventory(skills = [minimalSkill()]) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills,
  };
}

function renameRow(id, oldName, oldPath, newName, newPath, release = '0.62.4') {
  return {
    id,
    oldName,
    oldPath,
    newName,
    newPath,
    rollback: { release },
  };
}

function renameInventory() {
  const entries = [
    minimalSkill(),
    minimalSkill({ id: 'laravel', name: 'laravel', name_style: 'portable-family', path: 'skills/laravel', capability_id: 'dhpk.laravel' }),
    minimalSkill({ id: 'phpunit', name: 'phpunit', name_style: 'portable-family', path: 'skills/phpunit', capability_id: 'dhpk.phpunit' }),
    minimalSkill({ id: 'git-smart-commit', name: 'git-smart-commit', path: 'skills/git-smart-commit', capability_id: 'dhpk.git-smart-commit', invocation_class: 'explicit-only' }),
    minimalSkill({ id: 'release-creator', name: 'release-creator', path: 'skills/release-creator', capability_id: 'dhpk.release-creator', invocation_class: 'explicit-only' }),
    minimalSkill({ id: 'matrix-cell-onboard', name: 'matrix-cell-onboard', path: 'skills/matrix-cell-onboard', capability_id: 'dhpk.matrix-cell-onboard', invocation_class: 'explicit-only' }),
    minimalSkill({ id: 'js-static-check-strategy', name: 'js-static-check-strategy', path: 'skills/js-static-check-strategy', capability_id: 'dhpk.js-static-check-strategy' }),
  ];
  return portableInventory(entries);
}

function activeRenameRows() {
  return [
    renameRow('laravel', 'dhpk-laravel', 'skills/dhpk-laravel', 'laravel', 'skills/laravel', '0.53.0'),
    renameRow('phpunit', 'dhpk-phpunit', 'skills/dhpk-phpunit', 'phpunit', 'skills/phpunit', '0.53.0'),
    renameRow('git-smart-commit', 'dhpk-git-smart-commit', 'skills/dhpk-git-smart-commit', 'git-smart-commit', 'skills/git-smart-commit'),
    renameRow('release-creator', 'dhpk-release-creator', 'skills/dhpk-release-creator', 'release-creator', 'skills/release-creator'),
    renameRow('matrix-cell-onboard', 'dhpk-matrix-cell-onboard', 'skills/dhpk-matrix-cell-onboard', 'matrix-cell-onboard', 'skills/matrix-cell-onboard'),
    renameRow('tdd', 'dhpk-tdd-workflow', 'skills/dhpk-tdd-workflow', 'tdd-workflow', 'skills/tdd-workflow'),
    renameRow('js-static-check-strategy', 'dhpk-js-static-check-strategy', 'skills/dhpk-js-static-check-strategy', 'js-static-check-strategy', 'skills/js-static-check-strategy'),
  ];
}

test('portable-skill naming accepts an unprefixed public name whose stable ID differs', () => {
  const result = validateDistributionInventoryV2({ inventory: portableInventory() });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

test('public names collide across portable-skill and portable-family styles', () => {
  const candidate = portableInventory([
    minimalSkill({ name: 'skill-scope', path: 'skills/skill-scope' }),
    minimalSkill({
      id: 'skill-scope',
      name: 'skill-scope',
      name_style: 'portable-family',
      path: 'skills/skill-scope',
      capability_id: 'dhpk.skill-scope',
    }),
  ]);
  const result = validateDistributionInventoryV2({ inventory: candidate });
  assert.ok(result.errors.some((error) => /duplicate.*public.*name|public.*name.*duplicate/i.test(error)), result.errors.join('\n'));
});

test('the checked-in migration publishes the approved generic names as flat canonical skills', () => {
  const rows = INVENTORY.skills.filter((entry) => EXPECTED_GENERIC_NAMES.includes(entry.name));
  assert.deepStrictEqual(
    rows.map((entry) => entry.name).sort(),
    [...EXPECTED_GENERIC_NAMES].sort(),
  );
  for (const name of EXPECTED_GENERIC_NAMES) {
    const entry = INVENTORY.skills.find((candidate) => candidate.name === name);
    assert.strictEqual(entry.path, `skills/${name}`, `${name} must use its public name as canonical path`);
  }
});

test('the five active renames preserve stable IDs and reject active legacy aliases', () => {
  for (const [id, expected] of Object.entries(EXPECTED_ACTIVE_RENAMES)) {
    const entry = INVENTORY.skills.find((candidate) => candidate.id === id);
    assert.ok(entry, `stable ID ${id} must remain active`);
    assert.strictEqual(entry.name, expected.newName);
    assert.strictEqual(entry.path, expected.newPath);
    assert.ok(!Array.isArray(entry.legacy_names) || !entry.legacy_names.includes(expected.oldName));
  }
});

test('rename validation accepts explicit active ID rows alongside historical Laravel/PHPUnit rows', () => {
  const inventory = renameInventory();
  inventory.renamed_skill_names = activeRenameRows();
  const result = validateRenamedSkillNames({ inventory });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));

  const resolution = resolveSkillIdentity({ inventory, identifier: 'dhpk-tdd-workflow' });
  assert.deepStrictEqual(resolution, {
    state: 'renamed',
    stableId: 'tdd',
    publicName: 'tdd-workflow',
    oldName: 'dhpk-tdd-workflow',
  });
});

test('rename validation rejects unsafe or non-matching canonical paths', () => {
  const inventory = renameInventory();
  inventory.renamed_skill_names = activeRenameRows();
  inventory.renamed_skill_names[5].newPath = 'skills/../outside';
  inventory.renamed_skill_names[6].oldPath = 'skills/not-the-old-name';
  const result = validateRenamedSkillNames({ inventory });
  assert.ok(result.errors.some((error) => /tdd.*newPath|newPath.*tdd|canonical|safe|outside/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /js-static-check-strategy.*oldPath|oldPath.*js-static-check-strategy|canonical|safe/i.test(error)), result.errors.join('\n'));
});

test('rename validation rejects duplicate IDs and conflicting old/new identities', () => {
  const duplicate = renameInventory();
  duplicate.renamed_skill_names = activeRenameRows();
  duplicate.renamed_skill_names.push(clone(duplicate.renamed_skill_names[2]));
  const duplicateResult = validateRenamedSkillNames({ inventory: duplicate });
  assert.ok(duplicateResult.errors.some((error) => /duplicate.*git-smart-commit|git-smart-commit.*duplicate/i.test(error)), duplicateResult.errors.join('\n'));

  const conflict = renameInventory();
  conflict.renamed_skill_names = activeRenameRows();
  conflict.renamed_skill_names[3].oldName = conflict.renamed_skill_names[2].oldName;
  conflict.renamed_skill_names[3].oldPath = conflict.renamed_skill_names[2].oldPath;
  const conflictResult = validateRenamedSkillNames({ inventory: conflict });
  assert.ok(conflictResult.errors.some((error) => /conflict|duplicate.*old|old.*duplicate|collision/i.test(error)), conflictResult.errors.join('\n'));
});

test('historical Laravel and PHPUnit rename rows keep their original rollback pins', () => {
  const inventory = renameInventory();
  inventory.renamed_skill_names = activeRenameRows();
  inventory.renamed_skill_names[0].rollback.release = '0.52.0';
  inventory.renamed_skill_names[1].newPath = 'skills/phpunit-old';
  const result = validateRenamedSkillNames({ inventory });
  assert.ok(result.errors.some((error) => /laravel.*0\.53\.0|0\.53\.0.*laravel/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /phpunit.*newPath|newPath.*phpunit/i.test(error)), result.errors.join('\n'));
});

run('portable-skill-names');
