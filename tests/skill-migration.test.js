'use strict';

// Task 2 real-tree contract. This intentionally runs against the checked-in
// repository rather than a disposable fixture: the migration must leave one
// flat canonical package per inventory entry and relative projections only.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventoryV2,
  validateSkillTopology,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

function frontmatterName(skillFile) {
  const content = fs.readFileSync(skillFile, 'utf8');
  const match = content.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  assert.ok(match, `${skillFile} is missing frontmatter name`);
  return match[1].trim();
}

function defaultPrompt(skillDir) {
  const metadata = path.join(skillDir, 'agents', 'openai.yaml');
  assert.ok(fs.existsSync(metadata), `${skillDir} is missing agents/openai.yaml`);
  const content = fs.readFileSync(metadata, 'utf8');
  const match = content.match(/^  default_prompt:\s*"((?:\\.|[^"\\])*)"\s*$/m);
  assert.ok(match, `${metadata} is missing interface.default_prompt`);
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function flatCanonicalDirs() {
  return fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function projectionTarget(linkPath) {
  assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), `${linkPath} must be a symlink`);
  return fs.readlinkSync(linkPath);
}

// Keep this mapping literal: it is the real-tree canary for the 11 version
// modules that now consume the two public family skills. Do not derive the
// expected family from module.yaml or the inventory under test.
const EXPECTED_VERSION_FAMILY_PROJECTIONS = [
  { moduleId: 'laravel-5.4', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-6', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-7', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-8', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-9', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-10', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-11', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'laravel-mix', familySkill: 'dhpk-laravel', symlinkTarget: '../../../skills/dhpk-laravel' },
  { moduleId: 'phpunit-9', familySkill: 'dhpk-phpunit', symlinkTarget: '../../../skills/dhpk-phpunit' },
  { moduleId: 'phpunit-10', familySkill: 'dhpk-phpunit', symlinkTarget: '../../../skills/dhpk-phpunit' },
  { moduleId: 'phpunit-11', familySkill: 'dhpk-phpunit', symlinkTarget: '../../../skills/dhpk-phpunit' },
];

function moduleProvidedSkills(moduleId) {
  const yamlPath = path.join(ROOT, 'modules', moduleId, 'module.yaml');
  const source = fs.readFileSync(yamlPath, 'utf8');
  const match = source.match(/^provides:\s*\n\s+skills:\s*\[([^\]]*)\]/m);
  assert.ok(match, `${yamlPath} has no provides.skills mapping`);
  return match[1].split(',').map((skill) => skill.trim()).filter(Boolean);
}

test('real tree version modules select only their canonical public family projection', () => {
  const actual = EXPECTED_VERSION_FAMILY_PROJECTIONS.map((expected) => {
    const projectionRoot = path.join(ROOT, 'modules', expected.moduleId, 'skills');
    assert.ok(fs.existsSync(projectionRoot), `${expected.moduleId} is missing its skills projection root`);
    const projectionEntries = fs.readdirSync(projectionRoot).sort();
    assert.deepStrictEqual(projectionEntries, [expected.familySkill], expected.moduleId);

    const familyEntry = INVENTORY.skills.find((entry) => entry.name === expected.familySkill);
    assert.ok(familyEntry, `missing canonical family inventory entry: ${expected.familySkill}`);

    return {
      moduleId: expected.moduleId,
      providesSkills: moduleProvidedSkills(expected.moduleId),
      projectionEntries,
      symlinkTarget: projectionTarget(path.join(projectionRoot, expected.familySkill)),
      profileIncludesModule: familyEntry.profiles.includes(expected.moduleId),
    };
  });

  assert.deepStrictEqual(actual, EXPECTED_VERSION_FAMILY_PROJECTIONS.map((expected) => ({
    moduleId: expected.moduleId,
    providesSkills: [expected.familySkill],
    projectionEntries: [expected.familySkill],
    symlinkTarget: expected.symlinkTarget,
    profileIncludesModule: true,
  })));
});

test('real tree has 101 flat canonical packages with inventory identities and metadata tokens', () => {
  assert.strictEqual(INVENTORY.schema, 'dhpk.distribution-inventory.v2');
  assert.strictEqual(INVENTORY.skills.length, 101);
  assert.deepStrictEqual(validateDistributionInventoryV2({ inventory: INVENTORY }).errors, []);

  const dirs = flatCanonicalDirs();
  assert.strictEqual(dirs.length, 101);
  assert.strictEqual(fs.readdirSync(path.join(ROOT, 'skills')).filter((name) => {
    const candidate = path.join(ROOT, 'skills', name);
    return fs.statSync(candidate).isDirectory() && !fs.existsSync(path.join(candidate, 'SKILL.md'));
  }).length, 0, 'skills/ must not retain nested category directories');

  const names = new Set();
  const capabilities = new Set();
  for (const entry of INVENTORY.skills) {
    assert.ok(!names.has(entry.name), `duplicate inventory name ${entry.name}`);
    assert.ok(!capabilities.has(entry.capability_id), `duplicate inventory capability ${entry.capability_id}`);
    names.add(entry.name);
    capabilities.add(entry.capability_id);
    const skillDir = path.join(ROOT, 'skills', entry.name);
    assert.strictEqual(path.basename(skillDir), entry.name);
    assert.strictEqual(frontmatterName(path.join(skillDir, 'SKILL.md')), entry.name);
    const prompt = defaultPrompt(skillDir);
    if (entry.invokable === false) {
      assert.ok(!prompt.includes(`$${entry.name}`), `${entry.name} internal runtime prompt must not invite direct invocation`);
      assert.match(prompt, /internal|do not invoke/i, `${entry.name} internal runtime prompt must explain its boundary`);
    } else {
      assert.ok(prompt.includes(`$${entry.name}`), `${entry.name} default_prompt must invoke $${entry.name}`);
    }
  }
});

test('real tree has no nested canonical SKILL.md and module projections are relative symlinks', () => {
  const canonicalNames = new Set(INVENTORY.skills.map((entry) => entry.name));
  let moduleCount = 0;
  for (const moduleEntry of fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })) {
    if (!moduleEntry.isDirectory()) continue;
    const projectionRoot = path.join(ROOT, 'modules', moduleEntry.name, 'skills');
    if (!fs.existsSync(projectionRoot)) continue;
    for (const skillEntry of fs.readdirSync(projectionRoot, { withFileTypes: true })) {
      const linkPath = path.join(projectionRoot, skillEntry.name);
      moduleCount += 1;
      assert.ok(canonicalNames.has(skillEntry.name), `${linkPath} has no canonical inventory entry`);
      assert.strictEqual(projectionTarget(linkPath), `../../../skills/${skillEntry.name}`);
      assert.ok(INVENTORY.skills.some((entry) => entry.name === skillEntry.name && entry.profiles.includes(moduleEntry.name)));
    }
  }
  assert.strictEqual(moduleCount, 37);

  const topology = validateSkillTopology({ root: ROOT, inventory: INVENTORY, nativeRoots: ['plugins/dhpk'] });
  assert.deepStrictEqual(topology.errors, []);
});

test('real tree has relative Codex projections for every codex-sync skill and no generic aliases', () => {
  const expected = INVENTORY.skills.filter((entry) => entry.surfaces.includes('codex-sync')).map((entry) => entry.name).sort();
  const actual = fs.readdirSync(path.join(ROOT, 'codex', 'skills')).sort();
  assert.deepStrictEqual(actual, expected);
  for (const name of actual) {
    assert.strictEqual(projectionTarget(path.join(ROOT, 'codex', 'skills', name)), `../../skills/${name}`);
  }
  assert.ok(actual.every((name) => name.startsWith('dhpk-')));
});

run('skill-migration');
