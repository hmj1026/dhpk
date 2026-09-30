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

test('a manually-removed root that the inventory still expects fails --check', () => {
  withTempRepo((repo) => {
    const pluginPath = path.join(repo, '.claude-plugin', 'plugin.json');
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
    plugin.skills = plugin.skills.filter((s) => s !== './skills/');
    fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));

    const { status, out } = runCheck(repo);
    assert.notStrictEqual(status, 0, 'dropping an inventory-expected root should fail --check');
    assert.match(
      out,
      /DRIFT \[gen-claude-manifest\]: inventory expects root '\.\/skills\/' but plugin\.json skills\[\] does not register it/,
    );
  });
});

{
  // Named source-suite block consolidated from gen-claude-manifest-generate.test.js.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { generateClaudeSkillRoots } = require('../scripts/lib/distribution-inventory');

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

  test('against the real checked-in inventory, generated roots equal the current plugin.json skills[] set (nothing is deprecated yet)', () => {
    const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    const gen = generateClaudeSkillRoots(inv);
    assert.deepStrictEqual([...gen.roots].sort(), [...plugin.skills].sort());
    const registered = inv.skills.filter((skill) => skill.lifecycle !== 'deprecated');
    assert.deepStrictEqual(gen.registeredSkillIds, registered.map((skill) => skill.id).sort());
    assert.deepStrictEqual(
      gen.generatedSkillIds,
      registered.filter((skill) => skill.invokable !== false).map((skill) => skill.id).sort(),
    );
  });
}

run('gen-claude-manifest');
