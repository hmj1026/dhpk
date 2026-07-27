'use strict';

// Task 5.4: prove rollback. design.md's Migration Plan step 7: "Roll back by
// restoring the previous generated manifest from the same inventory revision;
// canonical skill sources remain untouched." generateClaudeSkillRoots() is a
// PURE function of an inventory object (no fs access — see
// scripts/lib/distribution-inventory.js), so "the prior inventory revision" is
// just an older JSON blob (in practice `git show <rev>:manifests/distribution-inventory.json`);
// regenerating from it reproduces the old manifest without touching, deleting,
// or restoring any canonical skill source file on disk.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { generateClaudeSkillRoots } = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');

const priorInventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const priorGenerated = generateClaudeSkillRoots(priorInventory);

test('the prior inventory revision regenerates exactly the currently-committed plugin.json roots', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.deepStrictEqual([...priorGenerated.roots].sort(), [...plugin.skills].sort());
});

// Simulate a later change: deprecate fastapi's only skill (a single-skill
// module — the one case where a whole root can drop, see
// scripts/lib/distribution-inventory.js's generateClaudeSkillRoots comment).
const laterInventory = JSON.parse(JSON.stringify(priorInventory));
const fastapiSkill = laterInventory.skills.find((s) => s.id === 'fastapi-pro');
fastapiSkill.lifecycle = 'deprecated';
fastapiSkill.deprecation = {
  since: '2026-07-27',
  compatibilityWindowEnds: '2026-10-27',
  migrationNote: 'Rollback-proof fixture only — not a real deprecation.',
};
const laterGenerated = generateClaudeSkillRoots(laterInventory);

test('the later (deprecated) inventory revision drops the now-empty module root', () => {
  assert.ok(priorGenerated.roots.includes('./modules/fastapi/skills/'));
  assert.ok(!laterGenerated.roots.includes('./modules/fastapi/skills/'));
  assert.ok(!laterGenerated.generatedSkillIds.includes('fastapi-pro'));
});

test('rollback: regenerating from the prior revision again reproduces the original root set, without any canonical source having been touched', () => {
  const canonicalSourcePath = path.join(ROOT, 'modules', 'fastapi', 'skills', 'fastapi-pro', 'SKILL.md');
  // The canonical source was never deleted by generation in either direction —
  // only the (in-memory, test-local) inventory copy's lifecycle metadata
  // changed. Rollback never needs a restore step because nothing was removed.
  assert.ok(fs.existsSync(canonicalSourcePath), 'canonical fastapi-pro/SKILL.md must remain on disk throughout');

  const rolledBackGenerated = generateClaudeSkillRoots(priorInventory);
  assert.deepStrictEqual(rolledBackGenerated, priorGenerated);
  assert.ok(rolledBackGenerated.roots.includes('./modules/fastapi/skills/'));
});

run('distribution-rollback-proof');
