'use strict';

// Regression guard for the frontend identity contract. React 18/19 and
// Next.js 15.5/16 are intentionally separate module/skill pairs; changing an
// ID, source path, profile mapping, or module-provided skill must fail closed.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));

// Keep these values literal: this test is the canary against accidental
// consolidation or source remapping in the inventory itself.
const EXPECTED_FRONTEND_MAPPINGS = [
  {
    moduleId: 'react-18',
    modulePath: 'modules/react-18',
    moduleSkill: 'dhpk-react-18-notes',
    skillId: 'react-18-notes',
    skillName: 'dhpk-react-18-notes',
    skillPath: 'skills/dhpk-react-18-notes',
    capabilityId: 'dhpk.skill.react-18-notes',
    profile: 'react-18',
  },
  {
    moduleId: 'react-19',
    modulePath: 'modules/react-19',
    moduleSkill: 'dhpk-react-19-notes',
    skillId: 'react-19-notes',
    skillName: 'dhpk-react-19-notes',
    skillPath: 'skills/dhpk-react-19-notes',
    capabilityId: 'dhpk.skill.react-19-notes',
    profile: 'react-19',
  },
  {
    moduleId: 'nextjs-15.5',
    modulePath: 'modules/nextjs-15.5',
    moduleSkill: 'dhpk-nextjs-15-5-notes',
    skillId: 'nextjs-15-5-notes',
    skillName: 'dhpk-nextjs-15-5-notes',
    skillPath: 'skills/dhpk-nextjs-15-5-notes',
    capabilityId: 'dhpk.skill.nextjs-15-5-notes',
    profile: 'nextjs-15.5',
  },
  {
    moduleId: 'nextjs-16',
    modulePath: 'modules/nextjs-16',
    moduleSkill: 'dhpk-nextjs-16-notes',
    skillId: 'nextjs-16-notes',
    skillName: 'dhpk-nextjs-16-notes',
    skillPath: 'skills/dhpk-nextjs-16-notes',
    capabilityId: 'dhpk.skill.nextjs-16-notes',
    profile: 'nextjs-16',
  },
];

function providedSkills(moduleId) {
  const module = inventory.modules.find((entry) => entry.id === moduleId);
  assert.ok(module, `missing module inventory entry: ${moduleId}`);
  const source = fs.readFileSync(path.join(ROOT, module.path, 'module.yaml'), 'utf8');
  const match = source.match(/^provides:\s*\n\s+skills:\s+\[([^\]]*)\]/m);
  assert.ok(match, `${moduleId}/module.yaml has no provides.skills mapping`);
  return match[1].split(',').map((skill) => skill.trim()).filter(Boolean);
}

function skillFrontmatterName(skillPath) {
  const source = fs.readFileSync(path.join(ROOT, skillPath, 'SKILL.md'), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, `${skillPath}/SKILL.md has no frontmatter`);
  const name = match[1].match(/^name:\s*(\S+)\s*$/m);
  assert.ok(name, `${skillPath}/SKILL.md has no name field`);
  return name[1];
}

test('React and Next frontend IDs remain separate with literal inventory mappings', () => {
  const actual = EXPECTED_FRONTEND_MAPPINGS.map((expected) => {
    const skill = inventory.skills.find((entry) => entry.id === expected.skillId);
    assert.ok(skill, `missing skill inventory entry: ${expected.skillId}`);
    const module = inventory.modules.find((entry) => entry.id === expected.moduleId);
    assert.ok(module, `missing module inventory entry: ${expected.moduleId}`);

    return {
      moduleId: module.id,
      modulePath: module.path,
      moduleSkill: providedSkills(module.id)[0],
      skillId: skill.id,
      skillName: skill.name,
      skillPath: skill.path,
      capabilityId: skill.capability_id,
      profile: skill.profiles[0],
    };
  });

  assert.deepStrictEqual(actual, EXPECTED_FRONTEND_MAPPINGS);
  assert.deepStrictEqual(
    actual.map((entry) => entry.moduleId),
    ['react-18', 'react-19', 'nextjs-15.5', 'nextjs-16'],
  );
  assert.deepStrictEqual(
    actual.map((entry) => entry.skillId),
    ['react-18-notes', 'react-19-notes', 'nextjs-15-5-notes', 'nextjs-16-notes'],
  );
  assert.strictEqual(new Set(actual.map((entry) => entry.moduleId)).size, 4);
  assert.strictEqual(new Set(actual.map((entry) => entry.skillId)).size, 4);
});

test('frontend inventory mappings point to the declared source skills and claude module surface', () => {
  for (const expected of EXPECTED_FRONTEND_MAPPINGS) {
    const skill = inventory.skills.find((entry) => entry.id === expected.skillId);
    const module = inventory.modules.find((entry) => entry.id === expected.moduleId);
    assert.deepStrictEqual(skill.surfaces, ['claude-module'], expected.skillId);
    assert.strictEqual(skill.lifecycle, 'optional', expected.skillId);
    assert.strictEqual(skill.tier, 'optional', expected.skillId);
    assert.strictEqual(skillFrontmatterName(skill.path), expected.skillName);
    assert.deepStrictEqual(providedSkills(module.id), [expected.moduleSkill], expected.moduleId);
  }
});

run('skill-routing-frontend-regression');
