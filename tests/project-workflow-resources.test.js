'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeAgentsSkillsProjection, validateAgentsSkillsProjection } = require('../scripts/lib/agents-skills-package');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('project skill projection ships its physical runner closure without an ambient source checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-workflow-resource-'));
  try {
    const inventory = {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{ id: 'check', name: 'repo-check', path: 'skills/repo-check', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
      surface_membership: { 'agent-plugin': ['check'] },
    };
    write(root, 'manifests/distribution-inventory.json', JSON.stringify(inventory));
    write(root, 'skills/repo-check/SKILL.md', '---\nname: repo-check\ndescription: "Run the packaged check."\n---\nRun scripts/check.js.\n');
    write(root, 'skills/repo-check/scripts/check.js', "process.stdout.write(require('./lib/value'));\n");
    write(root, 'skills/repo-check/scripts/lib/value.js', "module.exports = 'independent package check passed';\n");
    // A stale retired descriptor naming a repository overlay must be inert.
    write(root, 'skills/repo-check/skill-package.json', JSON.stringify({
      schema: 'dhpk.skill-package.v1', id: 'check', version: '1.0.0', entry: 'SKILL.md',
      resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
      runtimeAssets: [{ source: 'scripts/overlay-only.js', destination: 'scripts/overlay-only.js', required: true }],
    }));
    write(root, 'scripts/overlay-only.js', "module.exports = 'overlay';\n");
    const outDir = path.join(root, '.agents', 'skills');
    materializeAgentsSkillsProjection({ root, inventory, outDir });
    const validation = validateAgentsSkillsProjection({ root, inventory, outDir });
    assert.strictEqual(validation.ok, true, JSON.stringify(validation.errors));
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check', 'scripts', 'overlay-only.js')), false,
      'a repository overlay must never be injected into the projection');
    // Removing only the disposable fixture's source proves the runner cannot
    // fall back to a parent checkout or unprojected source library.
    fs.rmSync(path.join(root, 'scripts'), { recursive: true });
    fs.rmSync(path.join(root, 'skills'), { recursive: true });
    const execution = spawnSync(process.execPath, [path.join(outDir, 'repo-check/scripts/check.js')], {
      cwd: os.tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.strictEqual(execution.status, 0, execution.stderr);
    assert.strictEqual(execution.stdout, 'independent package check passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy projection migrates an approved stable-ID public-name rename without duplicate ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-rename-migration-'));
  const oldInventory = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'rename-check', name: 'repo-check-old', path: 'skills/repo-check-old', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
    surface_membership: { 'agent-plugin': ['rename-check'] },
  };
  const newInventory = {
    ...oldInventory,
    skills: [{ ...oldInventory.skills[0], name: 'repo-check-new', path: 'skills/repo-check-new' }],
    renamed_skill_names: [{
      id: 'rename-check',
      oldName: 'repo-check-old',
      oldPath: 'skills/repo-check-old',
      newName: 'repo-check-new',
      newPath: 'skills/repo-check-new',
      rollback: { release: '1.0.0' },
    }],
  };
  const outDir = path.join(root, '.agents', 'skills');
  try {
    write(root, 'skills/repo-check-old/SKILL.md', '---\nname: repo-check-old\ndescription: "Old check."\n---\nOld body.\n');
    materializeAgentsSkillsProjection({ root, inventory: oldInventory, outDir });
    write(outDir, 'repo-check-old/foreign.txt', 'foreign skill content.\n');
    write(root, 'skills/repo-check-new/SKILL.md', '---\nname: repo-check-new\ndescription: "New check."\n---\nNew body.\n');

    materializeAgentsSkillsProjection({ root, inventory: newInventory, outDir });

    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'));
    assert.deepStrictEqual(receipt.entries.map((entry) => ({ id: entry.id, name: entry.name })), [{ id: 'rename-check', name: 'repo-check-new' }]);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old', 'SKILL.md')), false);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old.md')), false);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old', 'foreign.txt')), true);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-new', 'SKILL.md')), true);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-new.md')), true);
    const validation = validateAgentsSkillsProjection({ root, inventory: newInventory, outDir });
    assert.strictEqual(validation.ok, true, validation.errors.join('; '));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy rename migration preserves edited receipt-owned content as a conflict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-rename-conflict-'));
  const inventory = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'rename-check', name: 'repo-check-old', path: 'skills/repo-check-old', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
    surface_membership: { 'agent-plugin': ['rename-check'] },
  };
  const renamedInventory = {
    ...inventory,
    skills: [{ ...inventory.skills[0], name: 'repo-check-new', path: 'skills/repo-check-new' }],
    renamed_skill_names: [{
      id: 'rename-check',
      oldName: 'repo-check-old',
      oldPath: 'skills/repo-check-old',
      newName: 'repo-check-new',
      newPath: 'skills/repo-check-new',
      rollback: { release: '1.0.0' },
    }],
  };
  const outDir = path.join(root, '.agents', 'skills');
  try {
    write(root, 'skills/repo-check-old/SKILL.md', '---\nname: repo-check-old\ndescription: "Old check."\n---\nOld body.\n');
    materializeAgentsSkillsProjection({ root, inventory, outDir });
    fs.appendFileSync(path.join(outDir, 'repo-check-old', 'SKILL.md'), '\nuser edit.\n');
    write(root, 'skills/repo-check-new/SKILL.md', '---\nname: repo-check-new\ndescription: "New check."\n---\nNew body.\n');

    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: renamedInventory, outDir }),
      /receipt-owned renamed skill file.*(modified|foreign)|modified|foreign/i,
    );
    assert.match(fs.readFileSync(path.join(outDir, 'repo-check-old', 'SKILL.md'), 'utf8'), /user edit/);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-new', 'SKILL.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('project-workflow-resources');
