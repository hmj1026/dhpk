'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../manifests/distribution-inventory.json');
const { validateRenamedSkillNames } = require('../scripts/lib/distribution-inventory');

for (const [id, name] of Object.entries({
  'openspec-artifact-guard': 'openspec-artifact-guard',
  'legacy-code-characterization': 'legacy-characterization-tests',
  'vue-2-notes': 'vue-2-notes',
})) {
  const skill = inventory.skills.find((entry) => entry.id === id);
  assert.equal(skill.name, name);
  assert.equal(skill.path, `skills/${name}`);
  assert.ok(fs.statSync(path.join(__dirname, '..', skill.path, 'SKILL.md')).isFile());
  const missing = structuredClone(inventory);
  missing.renamed_skill_names = missing.renamed_skill_names.filter((entry) => entry.id !== id);
  assert.ok(validateRenamedSkillNames({ inventory: missing }).errors.some((error) => error.includes(id)));
  const wrong = structuredClone(inventory);
  wrong.renamed_skill_names.find((entry) => entry.id === id).rollback.release = '0.66.0';
  assert.ok(validateRenamedSkillNames({ inventory: wrong }).errors.some((error) => error.includes(id)));
}
console.log('PASS optional module names and protected rollback ledger');
