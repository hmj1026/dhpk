'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeRelocatableAgentsSkillsProjection,
  validateRelocatableAgentsSkillsProjection,
} = require('../scripts/lib/project-agent-projection-publisher');

function write(root, relative, content, mode = 0o644) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode });
  return target;
}

function inventory(runtimeAssets = undefined) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: 'check',
      name: 'repo-check',
      path: 'skills/repo-check',
      lifecycle: 'promoted',
      surfaces: ['claude-core'],
    }],
    surface_membership: { 'claude-core': ['check'] },
    project_agent_projection: {
      schema: 'dhpk.project-agent-projection.v1',
      scope: 'project',
      owner: 'dhpk.project-agent-projection',
      managed_root: '.agents/skills',
      receipt: '.agents/.dhpk-installed.json',
      profiles: {
        'portable-core': {
          version: 'portable-core-v1',
          compatibility_mode: 'portable-core',
          stable_ids: ['check'],
          hosts: ['agy', 'claude', 'codex', 'cursor'],
        },
      },
      hosts: {
        claude: { surface: 'claude-core', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'claude-project-skill', version: '1' } },
        codex: { surface: 'codex-sync', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'codex-project-skill', version: '1' } },
        cursor: { surface: 'cursor-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'cursor-project-skill', version: '1' } },
        agy: { surface: 'agy-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-direct-file', transform: { id: 'agy-project-direct-file', version: '1' } },
      },
      dependencies: {},
    },
    ...(runtimeAssets === undefined ? {} : { runtimeAssets }),
  };
}

function makeFixture(staleRuntimeAssets) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-runtime-source-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-runtime-project-'));
  write(sourceRoot, 'skills/repo-check/SKILL.md', '---\nname: repo-check\ndescription: "Run the packaged check."\n---\nRun scripts/check.js.\n');
  write(sourceRoot, 'skills/repo-check/scripts/check.js', "process.stdout.write(require('./lib/value'));\n", 0o755);
  write(sourceRoot, 'skills/repo-check/scripts/lib/value.js', "module.exports = 'modern runtime passed';\n");
  if (staleRuntimeAssets) {
    // A stale retired descriptor is inert: it cannot inject or escape.
    write(sourceRoot, 'skills/repo-check/skill-package.json', JSON.stringify({
      schema: 'dhpk.skill-package.v1', id: 'check', version: '1.0.0', entry: 'SKILL.md',
      resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
      runtimeAssets: staleRuntimeAssets,
    }));
    write(sourceRoot, 'scripts/overlay-only.js', "module.exports = 'overlay';\n");
  }
  return { sourceRoot, projectRoot };
}

function publish(sourceRoot, projectRoot, sourceInventory = inventory()) {
  return materializeRelocatableAgentsSkillsProjection({
    sourceRoot,
    projectRoot,
    inventory: sourceInventory,
    profileId: 'portable-core',
    requestedHosts: ['claude'],
  });
}

function renamedInventory(name) {
  const value = inventory();
  value.skills = [{ ...value.skills[0], name, path: `skills/${name}` }];
  value.renamed_skill_names = [{
    id: 'check',
    oldName: 'repo-check-old',
    oldPath: 'skills/repo-check-old',
    newName: 'repo-check-new',
    newPath: 'skills/repo-check-new',
    rollback: { release: '1.0.0' },
  }];
  return value;
}

test('relocatable project projection ships the Skill-local runner after source removal', () => {
  const { sourceRoot, projectRoot } = makeFixture();
  try {
    publish(sourceRoot, projectRoot);
    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    const runner = path.join(outputRoot, 'repo-check', 'scripts', 'check.js');
    assert.ok(fs.existsSync(runner), 'Skill-local runner was not published into the project artifact');
    assert.strictEqual(fs.statSync(runner).mode & 0o111, 0o111);
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    const execution = spawnSync(process.execPath, [runner], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.strictEqual(execution.status, 0, execution.stderr);
    assert.strictEqual(execution.stdout, 'modern runtime passed');
    const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable project projection detects runtime output tamper and source drift', () => {
  const { sourceRoot, projectRoot } = makeFixture();
  try {
    publish(sourceRoot, projectRoot);
    const runner = path.join(projectRoot, '.agents', 'skills', 'repo-check', 'scripts', 'check.js');
    assert.ok(fs.existsSync(runner), 'Skill-local runner was not published into the project artifact');
    fs.appendFileSync(runner, '\n// local tamper\n');
    const tampered = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(tampered.ok, false);
    assert.match(tampered.errors.join('\n'), /fingerprint|managed|modified/i);

    fs.writeFileSync(runner, "process.stdout.write(require('./lib/value'));\n", { mode: 0o755 });
    write(sourceRoot, 'skills/repo-check/scripts/lib/value.js', "module.exports = 'changed source runtime';\n");
    assert.throws(
      () => publish(sourceRoot, projectRoot),
      /source|drift|fingerprint/i,
    );
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('a stale descriptor cannot inject or escape, and a symlinked Skill script is rejected', () => {
  const stale = makeFixture([
    { source: 'scripts/overlay-only.js', destination: 'SKILL.md', required: true },
    { source: '../outside.js', destination: 'scripts/outside.js', required: true },
  ]);
  try {
    publish(stale.sourceRoot, stale.projectRoot);
    const skill = path.join(stale.projectRoot, '.agents', 'skills', 'repo-check');
    assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /Run the packaged check/);
    assert.strictEqual(fs.existsSync(path.join(skill, 'scripts', 'outside.js')), false);
  } finally {
    fs.rmSync(stale.sourceRoot, { recursive: true, force: true });
    fs.rmSync(stale.projectRoot, { recursive: true, force: true });
  }

  const linked = makeFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-runtime-outside-'));
  try {
    const runner = path.join(linked.sourceRoot, 'skills', 'repo-check', 'scripts', 'check.js');
    write(outside, 'check.js', 'outside\n');
    fs.rmSync(runner);
    fs.symlinkSync(path.join(outside, 'check.js'), runner);
    assert.throws(() => publish(linked.sourceRoot, linked.projectRoot), /symlink|unsafe/i);
    assert.strictEqual(fs.existsSync(path.join(linked.projectRoot, '.agents', '.dhpk-installed.json')), false);
  } finally {
    fs.rmSync(linked.sourceRoot, { recursive: true, force: true });
    fs.rmSync(linked.projectRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('relocatable project projection migrates an approved stable-ID rename by identity', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-rename-source-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-rename-project-'));
  const oldInventory = renamedInventory('repo-check-old');
  const newInventory = renamedInventory('repo-check-new');
  delete oldInventory.renamed_skill_names;
  try {
    write(sourceRoot, 'skills/repo-check-old/SKILL.md', '---\nname: repo-check-old\ndescription: "Old check."\n---\nOld body.\n');
    materializeRelocatableAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: oldInventory,
      profileId: 'portable-core',
      requestedHosts: ['claude'],
    });
    write(sourceRoot, 'skills/repo-check-new/SKILL.md', '---\nname: repo-check-new\ndescription: "New check."\n---\nNew body.\n');

    materializeRelocatableAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: newInventory,
      profileId: 'portable-core',
      requestedHosts: ['claude'],
    });

    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    const receipt = JSON.parse(fs.readFileSync(path.join(projectRoot, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(receipt.entries.map((entry) => ({ stableId: entry.stableId, name: entry.name })), [{ stableId: 'check', name: 'repo-check-new' }]);
    assert.strictEqual(fs.existsSync(path.join(outputRoot, 'repo-check-old', 'SKILL.md')), false);
    assert.strictEqual(fs.existsSync(path.join(outputRoot, 'repo-check-new', 'SKILL.md')), true);
    const checked = validateRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory: newInventory, requestedHosts: ['claude'] });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('project-agent-runtime-assets');
