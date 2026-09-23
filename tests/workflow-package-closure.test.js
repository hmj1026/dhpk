'use strict';

// Path-safety contract for the physical Skill tree every publisher shares.
// Per-Skill descriptors, runtime overlays, and peer closures are retired;
// what remains must still fail closed on escapes, symlinks, and caches.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  isIgnoredTreeName,
  physicalSkillTree,
  resolveSafeSkillPath,
} = require('../scripts/lib/workflow-package-closure');

const ROOT = path.join(__dirname, '..');

function tempRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeSkill(root, relative, name) {
  const skillRoot = path.join(root, relative);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  return skillRoot;
}

test('flow-guide and flow-drive publish their execution bundles from their own trees', () => {
  for (const id of ['flow-guide', 'flow-drive']) {
    const files = physicalSkillTree(ROOT, { id }).map((file) => file.relative);
    assert.ok(files.includes('SKILL.md'), `${id} entry`);
    assert.ok(files.includes('references/execution-bundle/rules/execution-policy.md'), `${id} policy bundle`);
    assert.ok(files.includes('references/execution-bundle/scripts/lib/flow-handoff-contract.js'), `${id} handoff contract`);
    assert.ok(!files.includes('skill-package.json'), `${id} retired descriptor`);
  }
});

test('an inventory path outside the source root fails closed', () => {
  const root = tempRoot('dhpk-tree-root-');
  const outside = tempRoot('dhpk-tree-outside-');
  try {
    writeSkill(outside, '.', 'escape');
    const entry = { id: 'escape', path: path.relative(root, outside).split(path.sep).join('/') };
    assert.throws(() => physicalSkillTree(root, entry, { availableEntries: [entry] }), /unsafe|escapes|source root/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlinked Skill ancestor or leaf fails closed', () => {
  const root = tempRoot('dhpk-tree-link-');
  const outside = tempRoot('dhpk-tree-link-outside-');
  try {
    writeSkill(outside, 'real', 'linked');
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'real'), path.join(root, 'skills', 'linked'));
    assert.throws(() => physicalSkillTree(root, { id: 'linked', path: 'skills/linked' }), /symlink/i);

    const skill = writeSkill(root, 'skills/leaf', 'leaf');
    fs.writeFileSync(path.join(outside, 'data.txt'), 'external');
    fs.symlinkSync(path.join(outside, 'data.txt'), path.join(skill, 'data.txt'));
    assert.throws(() => physicalSkillTree(root, { id: 'leaf', path: 'skills/leaf' }), /symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a stable ID resolves through its renamed canonical path from the inventory', () => {
  const root = tempRoot('dhpk-tree-renamed-');
  try {
    writeSkill(root, 'skills/tdd-workflow', 'tdd-workflow');
    const entry = { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow' };
    fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), JSON.stringify({ skills: [entry] }));
    assert.strictEqual(resolveSafeSkillPath(root, 'tdd').relative, 'skills/tdd-workflow');
    assert.deepStrictEqual(physicalSkillTree(root, { id: 'tdd' }).map((file) => file.relative), ['SKILL.md']);
    assert.deepStrictEqual(
      physicalSkillTree(root, { id: 'tdd' }, { availableEntries: [entry] }).map((file) => file.relative),
      ['SKILL.md'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('nested bytecode is ignored and a skill-package.json name has no special meaning', () => {
  const root = tempRoot('dhpk-tree-ignored-');
  try {
    const skill = writeSkill(root, 'skills/demo', 'demo');
    for (const relative of [
      'scripts/runtime/__pycache__/runner.js',
      'scripts/runtime/generated/runner.pyc',
      'skill-package.json',
      'references/examples/skill-package.json',
      'scripts/runtime/generated/runner.py',
    ]) {
      fs.mkdirSync(path.dirname(path.join(skill, relative)), { recursive: true });
      fs.writeFileSync(path.join(skill, relative), 'bytes\n');
    }
    assert.deepStrictEqual(physicalSkillTree(root, { id: 'demo', path: 'skills/demo' }).map((file) => file.relative), [
      'SKILL.md',
      'references/examples/skill-package.json',
      'scripts/runtime/generated/runner.py',
      'skill-package.json',
    ]);
    assert.strictEqual(isIgnoredTreeName('__pycache__', true), true);
    assert.strictEqual(isIgnoredTreeName('runner.pyc', false), true);
    assert.strictEqual(isIgnoredTreeName('runner.py', false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('workflow-package-closure');
