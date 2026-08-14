'use strict';

// Coverage for scripts/ci/gen-distribution-inventory.js and the classifier it
// wraps. Pins the default classification rule (task 1.3): root skills/ ->
// promoted/claude-core, module skills/modules -> optional/claude-module,
// codex-sync added wherever codex/skills/ mirrors the entry.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  classifyCanonicalInventory,
  LIFECYCLES,
  refreshSupportingDigests,
  compileClaudeProjection,
  preserveProjectionContract,
  writeInventoryAtomically,
} = require('../scripts/lib/distribution-inventory');

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

test('supporting provenance refresh derives transformed digests without mutating the source inventory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-provenance-'));
  try {
    fs.mkdirSync(path.join(temp, 'canonical'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'codex'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'canonical', 'policy.md'), 'canonical policy\n');
    fs.writeFileSync(path.join(temp, 'codex', 'policy.md'), 'codex projection\n');
    const original = {
      supporting_assets: [{
        id: 'policy',
        source: 'codex/policy.md',
        canonical_source: 'canonical/policy.md',
        canonical_digest: 'stale',
        projection_digest: 'stale',
        destination: 'dhpk/policies/policy.md',
      }],
    };
    const refreshed = refreshSupportingDigests(original, temp);
    const digest = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(temp, rel))).digest('hex');
    assert.strictEqual(refreshed.supporting_assets[0].canonical_digest, digest('canonical/policy.md'));
    assert.strictEqual(refreshed.supporting_assets[0].projection_digest, digest('codex/policy.md'));
    assert.strictEqual(original.supporting_assets[0].canonical_digest, 'stale');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Claude compilation is deterministic and does not let contract preservation select roots', () => {
  const inventory = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const first = compileClaudeProjection({ inventory });
  const second = compileClaudeProjection({ inventory: JSON.parse(JSON.stringify(inventory)) });
  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.strictEqual(first.plan.planFingerprint, second.plan.planFingerprint);
  assert.deepStrictEqual(first.generated, second.generated);
  assert.deepStrictEqual(first.inventoryView.skillRoutingProjection, first.routingProjection);
  const rendered = first.adapter.render(first.plan);
  const inventoryOutput = rendered.outputs.find((entry) => entry.stableId === 'claude:inventory-view');
  assert.deepStrictEqual(JSON.parse(inventoryOutput.content.toString()).skillRoutingProjection, first.routingProjection);
  const regenerated = preserveProjectionContract({ ...inventory, skills: inventory.skills.slice() }, inventory);
  const preserved = compileClaudeProjection({ inventory: regenerated });
  assert.strictEqual(preserved.ok, true, preserved.error && preserved.error.message);
  assert.deepStrictEqual(preserved.generated, first.generated);
});

test('inventory writer preserves the accepted manifest when atomic rename fails', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-inventory-atomic-'));
  const target = path.join(temp, 'distribution-inventory.json');
  const before = '{"schema":"old"}\n';
  fs.writeFileSync(target, before);
  const realRename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('synthetic inventory rename failure'); };
    assert.throws(
      () => writeInventoryAtomically(target, '{"schema":"new"}\n'),
      /synthetic inventory rename failure/,
    );
    assert.strictEqual(fs.readFileSync(target, 'utf8'), before);
    assert.deepStrictEqual(fs.readdirSync(temp), ['distribution-inventory.json']);
  } finally {
    fs.renameSync = realRename;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('gen-distribution-inventory');
