'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validatePortableSkillMetadata } = require('../scripts/lib/portable-skill-metadata');
const { extractMetadata } = require('../scripts/ci/_lib/frontmatter');
const { renderSkillUsageCard, validateSkillUsage } = require('../scripts/lib/skill-usage');

const ROOT = path.join(__dirname, '..');
const FLOW_DRIVE_MARKDOWN = path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md');
const INVENTORY_PATH = path.join(ROOT, 'manifests', 'distribution-inventory.json');

function flowDriveEntry() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const skill = inventory.skills.find((entry) => entry.id === 'flow-drive');
  assert.ok(skill, 'Flow Drive remains a discoverable inventory-owned Skill');
  return { skill, usage: skill.usage };
}

test('canonical Flow Drive metadata is portable without a structured follow-on graph', () => {
  const content = fs.readFileSync(FLOW_DRIVE_MARKDOWN, 'utf8');
  const portable = validatePortableSkillMetadata(content);
  assert.strictEqual(portable.ok, true, portable.errors.join('\n'));

  const metadata = extractMetadata(content);
  assert.deepStrictEqual(metadata.errors, []);
  assert.strictEqual(Object.hasOwn(metadata.values, 'dhpk-next'), false,
    'native task completion has no required follow-on Skill transition');
});

test('inventory-owned Flow Drive usage exposes bounded task and read-only help actions only', () => {
  const { skill, usage } = flowDriveEntry();
  const validation = validateSkillUsage({ skill, usage });
  assert.strictEqual(validation.ok, true, validation.errors.join('\n'));

  const card = renderSkillUsageCard({ skill, usage, catalogEvidence: null });
  const actions = Object.fromEntries(card.actions.map((action) => [action.id, action]));
  assert.deepStrictEqual(Object.keys(actions).sort(), ['apply', 'help']);
  assert.strictEqual(actions.apply.effect_authority, 'workspace-write');
  assert.strictEqual(actions.help.effect_authority, 'read-only');
  assert.deepStrictEqual(card.options.map((option) => option.id), ['help']);
  assert.strictEqual(card.options[0].syntax, '--help');
  assert.deepStrictEqual(card.options[0].applies_to, ['help']);
});

run('flow-drive-native-contract');
