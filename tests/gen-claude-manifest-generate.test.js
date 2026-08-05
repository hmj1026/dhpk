'use strict';

// RED (task 2.1, curate-dhpk-distribution-surfaces): generateClaudeSkillRoots
// does not exist yet in scripts/lib/distribution-inventory.js. Pins the
// generation contract task 2.2 must satisfy: promoted-core/optional roots stay
// registered as directory roots (Claude's plugin.json has no per-skill
// granularity — see design.md decision 3), while the generated *promoted skill
// id set* used for counts/validation excludes deprecated skills even though the
// host still lists the directory. A root whose every skill is deprecated is the
// one case that can actually drop from the roots array.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { generateClaudeSkillRoots } = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');

function inventoryWith(skills) {
  return { skills, modules: [] };
}

test('promoted-core root skill stays registered under ./skills/', () => {
  const inv = inventoryWith([
    { id: 'tdd', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core'] },
  ]);
  const gen = generateClaudeSkillRoots(inv);
  assert.ok(gen.roots.includes('./skills/'));
  assert.ok(gen.generatedSkillIds.includes('tdd'));
});

test('optional module skill stays registered under its module root', () => {
  const inv = inventoryWith([
    { id: 'vue-2-notes', path: 'modules/vue-2/skills/dhpk-vue-2-notes', lifecycle: 'optional', surfaces: ['claude-module'] },
  ]);
  const gen = generateClaudeSkillRoots(inv);
  assert.ok(gen.roots.includes('./modules/vue-2/skills/'));
  assert.ok(gen.generatedSkillIds.includes('vue-2-notes'));
});

test('experimental skill still stays registered (host cannot hide at discovery time)', () => {
  const inv = inventoryWith([
    { id: 'new-thing', path: 'skills/new-thing', lifecycle: 'experimental', surfaces: ['claude-core'] },
  ]);
  const gen = generateClaudeSkillRoots(inv);
  assert.ok(gen.roots.includes('./skills/'));
  assert.ok(gen.generatedSkillIds.includes('new-thing'));
});

test('a deprecated skill is excluded from generatedSkillIds', () => {
  const inv = inventoryWith([
    { id: 'old-thing', path: 'skills/old-thing', lifecycle: 'deprecated', surfaces: ['claude-core'] },
    { id: 'tdd', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core'] },
  ]);
  const gen = generateClaudeSkillRoots(inv);
  assert.ok(!gen.generatedSkillIds.includes('old-thing'));
  assert.ok(gen.generatedSkillIds.includes('tdd'));
});

test('a module root drops out only when every one of its skills is deprecated', () => {
  const inv = inventoryWith([
    { id: 'vue-2-notes', path: 'modules/vue-2/skills/dhpk-vue-2-notes', lifecycle: 'deprecated', surfaces: ['claude-module'] },
  ]);
  const gen = generateClaudeSkillRoots(inv);
  assert.ok(!gen.roots.includes('./modules/vue-2/skills/'));
  assert.ok(!gen.generatedSkillIds.includes('vue-2-notes'));
});

test('against the real checked-in inventory, generated roots equal the current plugin.json skills[] set (nothing is deprecated yet)', () => {
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const gen = generateClaudeSkillRoots(inv);
  assert.deepStrictEqual([...gen.roots].sort(), [...plugin.skills].sort());
});

run('gen-claude-manifest-generate');
