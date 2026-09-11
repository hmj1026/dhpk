'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  readSkillPackageManifest,
  resolveSkillPackageClosure,
  skillPackageClosureReceipt,
  runtimeAssetsForSkill,
  validateSkillPackageManifest,
} = require('../scripts/lib/workflow-package-closure');

const ROOT = path.join(__dirname, '..');

test('flow-guide and flow-drive publish explicit package manifests', () => {
  const guide = readSkillPackageManifest(ROOT, 'flow-guide');
  const drive = readSkillPackageManifest(ROOT, 'flow-drive');
  assert.strictEqual(validateSkillPackageManifest(ROOT, 'flow-guide').ok, true);
  assert.strictEqual(validateSkillPackageManifest(ROOT, 'flow-drive').ok, true);
  assert.strictEqual(guide.schema, 'dhpk.skill-package.v1');
  assert.strictEqual(drive.schema, 'dhpk.skill-package.v1');
  assert.deepStrictEqual(drive.requires, [{ id: 'flow-guide', version: '^1.0.0' }]);
});

test('flow-guide runtime closure names one canonical source for external helpers', () => {
  const assets = runtimeAssetsForSkill(ROOT, 'flow-guide');
  assert.deepStrictEqual(assets.map((asset) => asset.destination), [
    'references/execution-policy.md',
    'references/execution-policy-kernel.md',
    'scripts/_lib/skill-usage.js',
    'scripts/_lib/utils.js',
    'scripts/_lib/feature-resolver.js',
  ]);
  for (const asset of assets) assert.ok(fs.existsSync(asset.source), asset.source);
});

test('flow-drive resolves its flow-guide dependency on published surfaces', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  const drive = inventory.skills.find((entry) => entry.id === 'flow-drive');
  const closure = resolveSkillPackageClosure(ROOT, [drive], {
    availableEntries: inventory.skills,
    surface: 'codex-native',
  });
  assert.deepStrictEqual(closure.map((entry) => entry.id).sort(), ['flow-drive', 'flow-guide']);
  assert.deepStrictEqual(skillPackageClosureReceipt(ROOT, closure), [
    { id: 'flow-drive', version: '1.0.0' },
    { id: 'flow-guide', version: '1.0.0' },
  ]);
});

test('dependency version ranges are enforced by the closure resolver', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-version-'));
  try {
    for (const [id, version] of [['root-skill', '1.0.0'], ['dependency', '2.0.0']]) {
      const skillRoot = path.join(root, 'skills', id);
      fs.mkdirSync(skillRoot, { recursive: true });
      fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), `---\nname: ${id}\n---\n`);
      fs.writeFileSync(path.join(skillRoot, 'skill-package.json'), JSON.stringify({
        schema: 'dhpk.skill-package.v1', id, version, entry: 'SKILL.md',
        resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
        ...(id === 'root-skill' ? { requires: [{ id: 'dependency', version: '^1.0.0' }] } : {}),
      }));
    }
    const entries = [
      { id: 'root-skill', path: 'skills/root-skill', surfaces: ['codex-native'] },
      { id: 'dependency', path: 'skills/dependency', surfaces: ['codex-native'] },
    ];
    const rootManifestPath = path.join(root, 'skills', 'root-skill', 'skill-package.json');
    const dependencyManifestPath = path.join(root, 'skills', 'dependency', 'skill-package.json');
    const assertRejected = (range, dependencyVersion) => {
      fs.writeFileSync(rootManifestPath, JSON.stringify({
        schema: 'dhpk.skill-package.v1', id: 'root-skill', version: '1.0.0', entry: 'SKILL.md',
        resources: [{ path: 'SKILL.md', kind: 'entry', required: true }], requires: [{ id: 'dependency', version: range }],
      }));
      fs.writeFileSync(dependencyManifestPath, JSON.stringify({
        schema: 'dhpk.skill-package.v1', id: 'dependency', version: dependencyVersion, entry: 'SKILL.md',
        resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
      }));
      assert.throws(() => resolveSkillPackageClosure(root, [entries[0]], {
        availableEntries: entries,
        surface: 'codex-native',
      }), /version range|does not satisfy/i);
    };
    assertRejected('^1.0.0', '2.0.0');
    assertRejected('^0.2.3', '0.3.0');
    assertRejected('^0.0.3', '0.1.0');
    assertRejected('^1.0.0', '1.0.0-alpha');
    assertRejected('1.0.0', '1.0.0-alpha');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime assets reject symlink escape instead of publishing external content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-closure-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-external-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'demo', 'skill-package.json'), JSON.stringify({
      schema: 'dhpk.skill-package.v1',
      id: 'demo',
      entry: 'SKILL.md',
      resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
      runtimeAssets: [{ source: 'outside.txt', destination: 'scripts/_lib/outside.txt', required: true }],
    }));
    fs.writeFileSync(path.join(root, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
    fs.writeFileSync(path.join(external, 'outside.txt'), 'external');
    fs.symlinkSync(path.join(external, 'outside.txt'), path.join(root, 'outside.txt'));
    assert.throws(() => runtimeAssetsForSkill(root, 'demo'), /symlink|escape/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('invalid package resources fail closed instead of guessing a source root', () => {
  const result = validateSkillPackageManifest(ROOT, 'flow-guide', {
    manifest: {
      schema: 'dhpk.skill-package.v1',
      id: 'flow-guide',
      entry: '../SKILL.md',
      resources: [{ path: '../rules/execution-policy.md', kind: 'reference', required: true }],
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join('\n'), /unsafe|relative|resource/i);
});

run('workflow-package-closure');
