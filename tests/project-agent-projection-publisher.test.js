'use strict';

const { test, run, assert } = require('./_lib/tinytest');

{
  // Source suite: tests/project-agent-projection-publisher.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const publisher = require('../scripts/lib/project-agent-projection-publisher');

  function projectInventory() {
    return {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{
        id: 'sample',
        name: 'dhpk-sample',
        path: 'skills/dhpk-sample',
        lifecycle: 'promoted',
        surfaces: ['claude-core', 'codex-sync', 'cursor-plugin', 'agy-plugin'],
      }],
      surface_membership: {
        'claude-core': ['sample'],
        'codex-sync': ['sample'],
        'cursor-plugin': ['sample'],
        'agy-plugin': ['sample'],
      },
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
            stable_ids: ['sample'],
            hosts: ['agy', 'claude', 'codex', 'cursor'],
          },
        },
        hosts: {
          claude: {
            surface: 'claude-core',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-directory',
            transform: { id: 'claude-project-skill', version: '1' },
          },
          codex: {
            surface: 'codex-sync',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-directory',
            transform: { id: 'codex-project-skill', version: '1' },
          },
          cursor: {
            surface: 'cursor-plugin',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-directory',
            transform: { id: 'cursor-project-skill', version: '1' },
          },
          agy: {
            surface: 'agy-plugin',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-direct-file',
            transform: { id: 'agy-project-direct-file', version: '1' },
          },
        },
        dependencies: {},
      },
    };
  }

  function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  test('project publisher fails closed when materialization inputs are incomplete', () => {
    assert.throws(
      () => publisher.materializeRelocatableAgentsSkillsProjection({}),
      /sourceRoot and inventory are required/,
    );
  });

  test('project publisher installs, validates, rolls back an authorized update, and uninstalls only owned paths', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-publisher-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-publisher-project-'));
    const inventory = projectInventory();
    const sourceSkill = path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md');
    const options = { sourceRoot, projectRoot, inventory, profileId: 'portable-core', requestedHosts: ['claude'] };
    const originalSkill = '---\nname: dhpk-sample\ndescription: "A fixture skill."\n---\n# Original\n';
    const updatedSkill = '---\nname: dhpk-sample\ndescription: "A fixture skill."\n---\n# Updated\n';
    const managedSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md');
    const foreignFile = path.join(projectRoot, '.agents', 'skills', 'foreign', 'keep.md');

    try {
      write(sourceSkill, originalSkill);
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(installed.state, 'INSTALLED');
      assert.strictEqual(installed.receipt.schema, publisher.PROJECT_RECEIPT_SCHEMA);
      assert.deepStrictEqual(installed.receipt.managedPaths, ['.dhpk-projection.json', 'dhpk-sample/SKILL.md']);
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), originalSkill);

      const validated = publisher.validateRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(validated.ok, true, validated.errors.join('; '));

      write(foreignFile, '# User-owned content\n');
      write(sourceSkill, updatedSkill);
      const updated = publisher.materializeRelocatableAgentsSkillsProjection({ ...options, allowCanonicalChanges: true });
      assert.strictEqual(updated.state, 'UPDATED');
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), updatedSkill);

      const rolledBack = publisher.rollbackAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), originalSkill);

      const removed = publisher.uninstallAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(removed.ok, true, removed.error && removed.error.message);
      assert.strictEqual(removed.state, 'REMOVED');
      assert.strictEqual(fs.existsSync(managedSkill), false);
      assert.strictEqual(fs.readFileSync(foreignFile, 'utf8'), '# User-owned content\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}

{
  // Source suite: tests/project-agent-runtime-assets.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
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
}

{
  // Source suite: tests/project-workflow-resources.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
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
}

run('project-agent-projection-publisher');
