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

const CURRENT_WAVE_IDS = Object.freeze([
  'laravel-5.4-notes', 'laravel-6-notes', 'laravel-7-notes', 'laravel-8-notes',
  'laravel-9-notes', 'laravel-10-notes', 'laravel-11-notes', 'laravel-mix-notes',
  'phpunit-9-modern', 'phpunit-10-notes', 'phpunit-11-notes', 'claude-health',
  'harness-budget', 'harness-fill', 'harness-revise', 'multi-ai-sync',
  'agy-commit', 'feasibility-study', 'tech-spec', 'create-request', 'op-session',
]);

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

// RED contract for issue #534 P2.  The purpose ledger explains active
// decisions, while inventory remains the only source for identity and
// publication/migration facts.  The current retirement wave is deliberately
// a separate decision collection so a missing row cannot hide in the active
// 65-row baseline.
test('v2 purpose ledger covers active rows and the exact separate retirement wave', () => {
  assert.strictEqual(LEDGER.schema, 'dhpk.skill-purpose-decisions.v2');
  assert.ok(Array.isArray(LEDGER.decisions));
  assert.strictEqual(LEDGER.decisions.length, 84);
  assert.ok(LEDGER.decisions.every((row) => row.outcome === 'retain'));
  assert.ok(LEDGER.decisions.every((row) => typeof row.content_value === 'string' && row.content_value.trim() !== ''));
  assert.ok(LEDGER.decisions.every((row) => typeof row.authority === 'string' && row.authority.trim() !== ''));
  assert.ok(LEDGER.decisions.every((row) => row.duplicate_content
    && typeof row.duplicate_content.fact === 'string'
    && typeof row.duplicate_content.comparison === 'string'
    && row.duplicate_content.evidence
    && row.duplicate_content.evidence.status === 'PASS'));
  assert.ok(LEDGER.decisions.every((row) => Array.isArray(row.callers) && row.callers.length > 0));
  assert.ok(LEDGER.decisions.every((row) => row.evidence && typeof row.evidence === 'object'));

  assert.ok(Array.isArray(LEDGER.retirements));
  assert.deepStrictEqual(LEDGER.retirements.map((row) => row.id).sort(), [...CURRENT_WAVE_IDS].sort());
  const outcomeCounts = LEDGER.retirements.reduce((counts, row) => {
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
    return counts;
  }, {});
  assert.deepStrictEqual(outcomeCounts, { internalize: 11, merge: 7, retire: 2, remove: 1 });
  assert.ok(LEDGER.retirements.every((row) => typeof row.authority === 'string' && row.authority.length > 0));
  assert.ok(LEDGER.retirements.every((row) => row.duplicate_content
    && typeof row.duplicate_content.fact === 'string'
    && typeof row.duplicate_content.comparison === 'string'
    && row.duplicate_content.evidence
    && row.duplicate_content.evidence.status === 'PASS'));
  for (const row of [...LEDGER.decisions, ...LEDGER.retirements]) {
    for (const duplicated of ['name', 'path', 'publicName', 'canonicalPath', 'surfaces', 'successor', 'migration', 'rollback']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(row, duplicated), false,
        `${row.id} must derive ${duplicated} from distribution inventory`);
    }
  }

  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.effective.length, INVENTORY.skills.length);
  assert.strictEqual(result.retirements.length, CURRENT_WAVE_IDS.length);
});

test('v2 purpose validation rejects missing outcome rows and duplicated inventory identity', () => {
  const missing = JSON.parse(JSON.stringify(LEDGER));
  missing.retirements = (Array.isArray(missing.retirements) ? missing.retirements : CURRENT_WAVE_IDS.map((id) => ({ id }))).slice(1);
  const missingResult = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: missing, root: ROOT });
  assert.ok(missingResult.errors.some((error) => /missing.*retire.*laravel-5\.4-notes|laravel-5\.4-notes.*missing/i.test(error)),
    `expected missing retirement diagnostic, got:\n${missingResult.errors.join('\n')}`);

  const duplicated = JSON.parse(JSON.stringify(LEDGER));
  duplicated.decisions[0].path = INVENTORY.skills[0].path;
  const duplicateResult = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: duplicated, root: ROOT });
  assert.ok(duplicateResult.errors.some((error) => /identity|path|distribution inventory/i.test(error)),
    `expected inventory-derived identity diagnostic, got:\n${duplicateResult.errors.join('\n')}`);
});

run('skill-purpose-decisions');
