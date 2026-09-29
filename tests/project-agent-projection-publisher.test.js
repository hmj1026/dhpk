'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
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

run('project-agent-projection-publisher');
