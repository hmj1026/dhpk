'use strict';

// Task 2.4: a manual .claude-plugin/plugin.json skills[] registration that
// bypasses the distribution inventory must fail `gen-claude-manifest.js --check`.
// Runs against a faithful temp copy so the real repo files are never mutated.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-gen-claude-manifest-'));
  for (const rel of ['scripts', 'manifests', '.claude-plugin']) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

function runCheck(repo) {
  const res = spawnSync(process.execPath, [path.join(repo, 'scripts', 'ci', 'gen-claude-manifest.js'), '--check'], { encoding: 'utf8' });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

function withTempRepo(action) {
  const repo = makeTempRepo();
  try {
    action(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('faithful temp copy passes --check as-is', () => {
  withTempRepo((repo) => {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 0, `baseline temp copy should pass --check, got:\n${out}`);
  });
});

test('an extra manually-added root not backed by the inventory fails --check', () => {
  withTempRepo((repo) => {
    const pluginPath = path.join(repo, '.claude-plugin', 'plugin.json');
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
    plugin.skills = plugin.skills || [];
    plugin.skills.push('./modules/totally-manual-addition/skills/');
    fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));

    const { status, out } = runCheck(repo);
    assert.notStrictEqual(status, 0, 'an inventory-unbacked root should fail --check');
    assert.match(
      out,
      /DRIFT \[gen-claude-manifest\]: plugin\.json skills\[\] registers '\.\/modules\/totally-manual-addition\/skills\/' with no inventory-eligible skill backing it/,
    );
  });
});

test('omitting the implicit ./skills/ default passes --check without changing the registered skill set', () => {
  withTempRepo((repo) => {
    const pluginPath = path.join(repo, '.claude-plugin', 'plugin.json');
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
    delete plugin.skills;
    fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));

    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 0, `Claude's implicit ./skills/ root should remain effective:\n${out}`);
    assert.doesNotMatch(out, /DRIFT \[gen-claude-manifest\]/);
  });
});

{
  // Named source-suite block consolidated from gen-claude-manifest-generate.test.js.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { generateClaudeSkillRoots, verifyClaudeProjection } = require('../scripts/lib/distribution-inventory');

  const ROOT = path.join(__dirname, '..');

  function inventoryWith(skills) {
    return { skills, modules: [] };
  }

  test('promoted-core root skill stays registered under ./skills/', () => {
    const inv = inventoryWith([
      { id: 'tdd', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core'] },
    ]);
    const gen = generateClaudeSkillRoots(inv);
    assert.deepStrictEqual(gen.roots, ['./skills/']);
    assert.deepStrictEqual(gen.registeredSkillIds, ['tdd']);
    assert.deepStrictEqual(gen.generatedSkillIds, ['tdd']);
  });

  test('optional module skill stays registered under its module root', () => {
    const inv = inventoryWith([
      { id: 'vue-2-notes', path: 'modules/vue-2/skills/dhpk-vue-2-notes', lifecycle: 'optional', surfaces: ['claude-module'] },
    ]);
    const gen = generateClaudeSkillRoots(inv);
    assert.deepStrictEqual(gen.roots, ['./modules/vue-2/skills/']);
    assert.deepStrictEqual(gen.registeredSkillIds, ['vue-2-notes']);
    assert.deepStrictEqual(gen.generatedSkillIds, ['vue-2-notes']);
  });

  test('experimental skill still stays registered (host cannot hide at discovery time)', () => {
    const inv = inventoryWith([
      { id: 'new-thing', path: 'skills/new-thing', lifecycle: 'experimental', surfaces: ['claude-core'] },
    ]);
    const gen = generateClaudeSkillRoots(inv);
    assert.deepStrictEqual(gen.roots, ['./skills/']);
    assert.deepStrictEqual(gen.registeredSkillIds, ['new-thing']);
    assert.deepStrictEqual(gen.generatedSkillIds, ['new-thing']);
  });

  test('a deprecated skill is excluded from generatedSkillIds', () => {
    const inv = inventoryWith([
      { id: 'old-thing', path: 'skills/old-thing', lifecycle: 'deprecated', surfaces: ['claude-core'] },
      { id: 'tdd', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core'] },
    ]);
    const gen = generateClaudeSkillRoots(inv);
    assert.deepStrictEqual(gen.roots, ['./skills/']);
    assert.deepStrictEqual(gen.registeredSkillIds, ['tdd']);
    assert.deepStrictEqual(gen.generatedSkillIds, ['tdd']);
  });

  test('a module root drops out only when every one of its skills is deprecated', () => {
    const inv = inventoryWith([
      { id: 'vue-2-notes', path: 'modules/vue-2/skills/dhpk-vue-2-notes', lifecycle: 'deprecated', surfaces: ['claude-module'] },
    ]);
    const gen = generateClaudeSkillRoots(inv);
    assert.deepStrictEqual(gen.roots, []);
    assert.deepStrictEqual(gen.registeredSkillIds, []);
    assert.deepStrictEqual(gen.generatedSkillIds, []);
  });

  test('implicit ./skills/ plus module roots preserve the inventory IDs when the root is not listed explicitly', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    delete inventory.schema;
    const coreSkill = inventory.skills.find((skill) => skill.path.startsWith('skills/'));
    inventory.skills.push({
      ...coreSkill,
      id: 'fixture-module-skill',
      name: 'fixture-module-skill',
      path: 'modules/library-author/skills/fixture-module-skill',
      lifecycle: 'optional',
      surfaces: ['claude-module'],
    });

    const generated = generateClaudeSkillRoots(inventory);
    assert.deepStrictEqual(generated.roots, ['./skills/', './modules/library-author/skills/']);
    const explicitlyRegisteredRoots = generated.roots.filter((root) => root !== './skills/');
    const verified = verifyClaudeProjection({ inventory, pluginSkills: explicitlyRegisteredRoots });
    assert.strictEqual(verified.ok, true, verified.evidence && verified.evidence.diagnostics.join('; '));
    assert.deepStrictEqual(verified.generated.roots, generated.roots);
    assert.deepStrictEqual(verified.generated.registeredSkillIds, generated.registeredSkillIds);
    assert.deepStrictEqual(verified.generated.generatedSkillIds, generated.generatedSkillIds);
  });

  test('against the real checked-in inventory, generated roots equal the effective plugin root set', () => {
    const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    const gen = generateClaudeSkillRoots(inv);
    const effectivePluginRoots = [...(plugin.skills || [])];
    if (!effectivePluginRoots.includes('./skills/')) effectivePluginRoots.push('./skills/');
    assert.deepStrictEqual([...gen.roots].sort(), effectivePluginRoots.sort());
    const registered = inv.skills.filter((skill) => skill.lifecycle !== 'deprecated');
    assert.deepStrictEqual(gen.registeredSkillIds, registered.map((skill) => skill.id).sort());
    assert.deepStrictEqual(
      gen.generatedSkillIds,
      registered.filter((skill) => skill.invokable !== false).map((skill) => skill.id).sort(),
    );
  });
}

run('gen-claude-manifest');
