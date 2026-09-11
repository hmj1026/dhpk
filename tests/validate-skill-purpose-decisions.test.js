'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateSkillPurposeDecisions } = require('../scripts/lib/skill-purpose-decisions');

const ROOT = path.join(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'skill-purpose-decisions.json'), 'utf8'));

test('dedicated CI validator contract covers every active skill', () => {
  const result = validateSkillPurposeDecisions({ inventory, ledger, root: ROOT });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.effective.length, inventory.skills.length);
});

run('validate-skill-purpose-decisions');
