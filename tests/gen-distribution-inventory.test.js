'use strict';

// Coverage for scripts/ci/gen-distribution-inventory.js and the classifier it
// wraps. Pins the default classification rule (task 1.3): root skills/ ->
// promoted/claude-core, module skills/modules -> optional/claude-module,
// codex-sync added wherever codex/skills/ mirrors the entry.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { classifyCanonicalInventory, LIFECYCLES } = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifests', 'distribution-inventory.json');

test('checked-in manifest exists and declares the v2 schema', () => {
  assert.ok(fs.existsSync(MANIFEST), 'manifests/distribution-inventory.json is missing — run scripts/ci/gen-distribution-inventory.js --write');
  const inv = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.strictEqual(inv.schema, 'dhpk.distribution-inventory.v2');
  assert.deepStrictEqual([...inv.lifecycles].sort(), [...LIFECYCLES].sort());
});

test('every canonical skill directory (skills/, modules/*/skills/) is classified', () => {
  const generated = classifyCanonicalInventory(ROOT);
  assert.ok(generated.skills.length > 0);
  for (const s of generated.skills) {
    assert.ok(fs.existsSync(path.join(ROOT, s.path, 'SKILL.md')), `${s.path}/SKILL.md missing on disk`);
  }
});

test('root skills classify promoted/claude-core; module skills classify optional/claude-module', () => {
  const generated = classifyCanonicalInventory(ROOT);
  for (const s of generated.skills) {
    if (s.path.startsWith('modules/')) {
      assert.strictEqual(s.lifecycle, 'optional', `${s.id} (module skill) should default to optional`);
      assert.ok(s.surfaces.includes('claude-module'), `${s.id} should carry claude-module surface`);
    } else {
      assert.strictEqual(s.lifecycle, 'promoted', `${s.id} (root skill) should default to promoted`);
      assert.ok(s.surfaces.includes('claude-core'), `${s.id} should carry claude-core surface`);
    }
  }
});

test('codex-sync surface is granted exactly to entries mirrored under codex/skills/', () => {
  const generated = classifyCanonicalInventory(ROOT);
  const codexSkillsDir = path.join(ROOT, 'codex', 'skills');
  const mirrorNames = new Set(fs.readdirSync(codexSkillsDir));
  for (const s of generated.skills) {
    const hasCodexSync = s.surfaces.includes('codex-sync');
    assert.strictEqual(hasCodexSync, mirrorNames.has(s.id), `${s.id} codex-sync surface should match codex/skills/ mirror presence`);
  }
});

test('every module directory under modules/ is classified optional/claude-module', () => {
  const generated = classifyCanonicalInventory(ROOT);
  const moduleDirs = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepStrictEqual(generated.modules.map((m) => m.id).sort(), moduleDirs);
  for (const m of generated.modules) {
    assert.strictEqual(m.lifecycle, 'optional');
    assert.deepStrictEqual(m.surfaces, ['claude-module']);
  }
});

test('checked-in manifest covers every canonical skill/module (a deliberate lifecycle override is expected to diverge from the default classifier, so this checks coverage, not byte-equality)', () => {
  const existing = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const generated = classifyCanonicalInventory(ROOT);
  const existingSkillPaths = new Set(existing.skills.map((s) => s.path));
  const existingModulePaths = new Set(existing.modules.map((m) => m.path));
  for (const s of generated.skills) {
    assert.ok(existingSkillPaths.has(s.path), `${s.path} missing from checked-in manifest — run scripts/ci/gen-distribution-inventory.js --write`);
  }
  for (const m of generated.modules) {
    assert.ok(existingModulePaths.has(m.path), `${m.path} missing from checked-in manifest — run scripts/ci/gen-distribution-inventory.js --write`);
  }
});

run('gen-distribution-inventory');
