'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRenamedSkillNames } = require('../scripts/lib/distribution-inventory');
const inventory = require('../manifests/distribution-inventory.json');

for (const name of ['deploy-list', 'feature-verify', 'issue-analyze', 'project-audit', 'repo-intake']) {
  const skill = inventory.skills.find((entry) => entry.id === name);
  assert.equal(skill.name, name);
  assert.equal(skill.path, `skills/${name}`);
  assert.match(fs.readFileSync(path.join(__dirname, '..', skill.path, 'SKILL.md'), 'utf8'), /dhpk-name-style: portable-skill/);
  const row = inventory.renamed_skill_names.find((entry) => entry.id === name);
  assert.deepEqual(row, { id: name, oldName: `dhpk-${name}`, oldPath: `skills/dhpk-${name}`, newName: name, newPath: `skills/${name}`, rollback: { release: '0.67.0' } });
  const missing = structuredClone(inventory);
  missing.renamed_skill_names = missing.renamed_skill_names.filter((entry) => entry.id !== name);
  assert.ok(validateRenamedSkillNames({ inventory: missing }).errors.some((error) => error.includes(name)));
  const wrongRollback = structuredClone(inventory);
  wrongRollback.renamed_skill_names.find((entry) => entry.id === name).rollback.release = '0.66.0';
  assert.ok(validateRenamedSkillNames({ inventory: wrongRollback }).errors.some((error) => error.includes(name)));
}
console.log('PASS core unprefixed skill names and protected migration ledger');
