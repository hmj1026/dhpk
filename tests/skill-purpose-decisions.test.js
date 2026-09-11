'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  CONTRACT_VERSION,
  DISPOSITIONS,
  effectiveDecision,
  validateSkillPurposeDecisions,
} = require('../scripts/lib/skill-purpose-decisions');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'skill-purpose-decisions.json'), 'utf8'));

test('purpose ledger covers the current baseline and resolves every decision contract', () => {
  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.effective.length, INVENTORY.skills.length);
  assert.ok(result.effective.every((decision) => DISPOSITIONS.includes(decision.disposition)));
  assert.ok(result.effective.every((decision) => decision.task.source === 'skill.frontmatter.description'));
  assert.ok(result.effective.every((decision) => decision.authority));
  assert.ok(result.effective.every((decision) => typeof decision.independentUse === 'boolean'));
  assert.ok(result.effective.every((decision) => decision.successor));
  assert.ok(result.effective.every((decision) => decision.compatibility.includes('stable-id-preserved')));
});

test('purpose decisions preserve family, internal, and external ownership boundaries', () => {
  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  const byId = new Map(result.effective.map((decision) => [decision.id, decision]));
  assert.strictEqual(byId.get('laravel').disposition, 'retain-family');
  assert.strictEqual(byId.get('laravel').family, 'laravel');
  assert.strictEqual(byId.get('phpunit').family, 'phpunit');
  assert.strictEqual(byId.get('cli-transport').disposition, 'retain-internal');
  assert.strictEqual(byId.get('cli-transport').independentUse, false);
  assert.strictEqual(byId.get('gitnexus-cli').disposition, 'retain-external');
  assert.strictEqual(byId.get('gitnexus-cli').owner, 'gitnexus');
});

test('purpose validator rejects missing rows, identity drift, and unowned internal decisions', () => {
  const missing = { ...LEDGER, decisions: LEDGER.decisions.slice(1) };
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: missing, root: ROOT }).errors.some((error) => /missing decision.*fastapi-pro/i.test(error)));

  const drift = JSON.parse(JSON.stringify(LEDGER));
  drift.decisions[0] = { ...drift.decisions[0], publicName: 'wrong-public-name' };
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: drift, root: ROOT }).errors.some((error) => /publicName.*fastapi-pro|fastapi-pro.*publicName/i.test(error)));

  const unowned = JSON.parse(JSON.stringify(LEDGER));
  const row = unowned.decisions.find((decision) => decision.id === 'cli-transport');
  row.disposition = 'retain-standalone';
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: unowned, root: ROOT }).errors.some((error) => /cli-transport.*internal|internal.*cli-transport/i.test(error)));

  const wrongOwner = JSON.parse(JSON.stringify(LEDGER));
  const external = wrongOwner.decisions.find((decision) => decision.id === 'gitnexus-cli');
  external.owner = 'dhpk';
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: wrongOwner, root: ROOT }).errors.some((error) => /gitnexus-cli.*owner|owner.*gitnexus-cli/i.test(error)));
});

test('effective decisions expose the versioned contract for a single row', () => {
  const row = LEDGER.decisions.find((decision) => decision.id === 'laravel');
  const decision = effectiveDecision({ inventory: INVENTORY, ledger: LEDGER, row, root: ROOT });
  assert.strictEqual(LEDGER.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(decision.id, 'laravel');
  assert.strictEqual(decision.publicName, 'laravel');
  assert.strictEqual(decision.path, 'skills/laravel');
  assert.strictEqual(decision.successor.kind, 'family');
  assert.strictEqual(decision.successor.id, 'laravel');
});

run('skill-purpose-decisions');
