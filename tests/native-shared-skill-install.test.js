'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { installNativeSharedSkills, uninstallNativeSharedSkills } = require('../scripts/lib/native-shared-skill-install');
const {
  validateRelocatableAgentsSkillsProjection,
} = require('../scripts/lib/project-agent-projection-publisher');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const sourceRoot = tmpDir('dhpk-native-shared-src-');
  write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), [
    '---',
    'name: dhpk-sample',
    'description: Sample',
    '---',
    '',
    '# Sample skill',
    '',
  ].join('\n'));
  write(path.join(sourceRoot, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: 'sample',
      name: 'dhpk-sample',
      path: 'skills/dhpk-sample',
      lifecycle: 'promoted',
      surfaces: ['cursor-sync', 'cursor-plugin', 'codex-sync'],
    }],
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
        claude: { surface: 'claude-core', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'claude-project-skill', version: '1' } },
        codex: { surface: 'codex-sync', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'codex-project-skill', version: '1' } },
        cursor: { surface: 'cursor-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'cursor-project-skill', version: '1' } },
        agy: { surface: 'agy-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-direct-file', transform: { id: 'agy-project-direct-file', version: '1' } },
      },
      dependencies: {},
    },
  }, null, 2)}\n`);
  return sourceRoot;
}

test('installNativeSharedSkills materializes shared skills and Cursor native-link bindings', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-project-');
  try {
    const result = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    const nativeSkill = path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample');
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
    assert.strictEqual(result.receipt.hostBindings.cursor.bindingShape, 'native-link');
    assert.deepStrictEqual(result.receipt.bindingPaths.cursor, [{
      path: '.cursor/skills/dhpk-sample',
      target: '../../.agents/skills/dhpk-sample',
    }]);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills records direct bindings when a PASS probe record is injected', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-direct-');
  try {
    const result = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
      consumerEvidence: {
        stage: 'CONSUMER',
        producer: 'consumer-platform-probe',
        adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
        surfaceResults: [{
          surface: 'cursor-project',
          status: 'PASS',
          adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
          commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform cursor-project', exitCode: 0 }],
          environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
          artifacts: [],
          diagnostics: [],
          reasons: ['bounded Cursor project probe PASS'],
          checkedClaims: ['project-artifact-structure', 'cursor-project-discovery', 'consumer-route'],
        }],
      },
    });
    assert.strictEqual(result.receipt.hostBindings.cursor.bindingShape, 'direct');
    assert.deepStrictEqual(result.receipt.bindingPaths.cursor || [], []);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills rejects an unsupported Host', () => {
  assert.throws(
    () => installNativeSharedSkills({
      sourceRoot: '/tmp/dhpk-native-shared-unused-source',
      projectRoot: '/tmp/dhpk-native-shared-unused-project',
      host: 'claude',
      selectedStableIds: ['sample'],
    }),
    /unsupported native shared-skill Host/,
  );
});

function dualFixture() {
  const sourceRoot = fixture();
  write(path.join(sourceRoot, 'skills', 'dhpk-other', 'SKILL.md'), [
    '---',
    'name: dhpk-other',
    'description: Other',
    '---',
    '',
    '# Other skill',
    '',
  ].join('\n'));
  const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  inventory.skills.push({
    id: 'other',
    name: 'dhpk-other',
    path: 'skills/dhpk-other',
    lifecycle: 'promoted',
    surfaces: ['codex-sync'],
  });
  inventory.project_agent_projection.profiles['portable-core'].stable_ids = ['other', 'sample'];
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return sourceRoot;
}

function hiddenVisibleFixture() {
  const sourceRoot = fixture();
  const visiblePath = path.join(sourceRoot, 'skills', 'dhpk-sample');
  const renamedVisiblePath = path.join(sourceRoot, 'skills', 'dhpk-visible');
  fs.renameSync(visiblePath, renamedVisiblePath);
  write(path.join(renamedVisiblePath, 'SKILL.md'), [
    '---',
    'name: dhpk-visible',
    'description: Visible Codex skill',
    '---',
    '',
    '# Visible Codex skill',
    '',
  ].join('\n'));
  write(path.join(sourceRoot, 'skills', 'dhpk-hidden', 'SKILL.md'), [
    '---',
    'name: dhpk-hidden',
    'description: Hidden Codex support skill',
    '---',
    '',
    '# Hidden Codex support skill',
    '',
  ].join('\n'));

  const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  inventory.skills[0] = {
    ...inventory.skills[0],
    id: 'visible',
    name: 'dhpk-visible',
    path: 'skills/dhpk-visible',
    discoveryVisible: true,
  };
  inventory.skills.push({
    id: 'hidden',
    name: 'dhpk-hidden',
    path: 'skills/dhpk-hidden',
    lifecycle: 'promoted',
    surfaces: ['codex-sync'],
    discoveryVisible: false,
  });
  inventory.project_agent_projection.profiles['portable-core'].stable_ids = ['hidden', 'visible'];
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return sourceRoot;
}

test('installNativeSharedSkills materializes Codex native-link bindings', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-codex-');
  try {
    const result = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    const nativeSkill = path.join(projectRoot, '.codex', 'skills', 'dhpk-sample');
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
    assert.strictEqual(result.receipt.hostBindings.codex.bindingShape, 'native-link');
    assert.deepStrictEqual(result.receipt.bindingPaths.codex, [{
      path: '.codex/skills/dhpk-sample',
      target: '../../.agents/skills/dhpk-sample',
    }]);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills unions shared skills and preserves the first Host bindings', () => {
  const sourceRoot = dualFixture();
  const projectRoot = tmpDir('dhpk-native-shared-union-');
  try {
    const cursor = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    const cursorBindings = JSON.parse(JSON.stringify(cursor.receipt.hostBindings.cursor));
    const cursorPaths = JSON.parse(JSON.stringify(cursor.receipt.bindingPaths.cursor));
    const second = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['other'],
      declaredSelection: true,
    });
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-other', 'SKILL.md')));
    assert.ok(fs.lstatSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')).isSymbolicLink());
    assert.ok(fs.lstatSync(path.join(projectRoot, '.codex', 'skills', 'dhpk-other')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-other')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.codex', 'skills', 'dhpk-sample')));
    assert.deepStrictEqual(second.receipt.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(second.receipt.bindingPaths.cursor, cursorPaths);
    assert.deepStrictEqual(second.receipt.hostBindings.codex.selectedStableIds, ['other']);
    const again = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['other'],
      declaredSelection: true,
    });
    assert.deepStrictEqual(again.receipt.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(again.receipt.hostBindings.codex.selectedStableIds, ['other']);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills keeps a hidden Codex skill materialized across another Host lifecycle', () => {
  const sourceRoot = hiddenVisibleFixture();
  const projectRoot = tmpDir('dhpk-native-shared-hidden-codex-');
  const hiddenSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-hidden', 'SKILL.md');
  const visibleSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-visible', 'SKILL.md');
  const foreignSkill = path.join(projectRoot, '.agents', 'skills', 'user-owned', 'README.md');
  try {
    const codex = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['hidden', 'visible'],
      declaredSelection: true,
    });
    assert.deepStrictEqual(codex.receipt.hostBindings.codex.selectedStableIds, ['hidden', 'visible']);
    assert.deepStrictEqual(
      codex.receipt.hostBindings.codex.bindings.map((binding) => binding.stableId),
      ['visible'],
    );
    assert.ok(fs.existsSync(hiddenSkill), 'Codex hidden selection should be materialized initially');

    write(foreignSkill, '# User-owned skill\n');
    const cursor = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['visible'],
      declaredSelection: true,
    });
    assert.deepStrictEqual(cursor.receipt.hostBindings.codex.selectedStableIds, ['hidden', 'visible']);
    assert.ok(fs.existsSync(hiddenSkill), 'installing Cursor should retain the selected Codex hidden skill');
    assert.ok(fs.existsSync(visibleSkill), 'installing Cursor should retain the visible skill');
    assert.strictEqual(fs.readFileSync(foreignSkill, 'utf8'), '# User-owned skill\n');

    const removed = uninstallNativeSharedSkills({ sourceRoot, projectRoot, host: 'cursor' });
    assert.strictEqual(removed.ok, true, removed.error && removed.error.message);
    assert.ok(fs.existsSync(hiddenSkill), 'removing Cursor should retain the selected Codex hidden skill');
    assert.ok(fs.existsSync(visibleSkill), 'removing Cursor should retain the visible skill');
    assert.strictEqual(fs.readFileSync(foreignSkill, 'utf8'), '# User-owned skill\n');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills recreates missing Host dests without --update', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-rebind-');
  try {
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    const nativeSkill = path.join(projectRoot, '.codex', 'skills', 'dhpk-sample');
    fs.rmSync(nativeSkill, { force: true });
    const again = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
    assert.deepStrictEqual(again.receipt.hostBindings.codex.selectedStableIds, ['sample']);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('uninstallNativeSharedSkills drops one Host and keeps skills the other Host still binds', () => {
  const sourceRoot = dualFixture();
  const projectRoot = tmpDir('dhpk-native-shared-uninstall-keep-');
  try {
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['other'],
      declaredSelection: true,
    });
    write(path.join(projectRoot, '.agents', 'skills', 'foreign', 'README.md'), '# keep\n');
    const result = uninstallNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
    });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-other', 'SKILL.md')));
    assert.ok(fs.lstatSync(path.join(projectRoot, '.codex', 'skills', 'dhpk-other')).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'foreign', 'README.md'), 'utf8'), '# keep\n');
    assert.strictEqual(result.receipt.hostBindings.cursor, undefined);
    assert.deepStrictEqual(result.receipt.hostBindings.codex.selectedStableIds, ['other']);
    const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(checked.ok, true, (checked.errors || []).join('\n'));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('uninstallNativeSharedSkills fails closed when remaining shared content was modified', () => {
  const sourceRoot = dualFixture();
  const projectRoot = tmpDir('dhpk-native-shared-uninstall-modified-');
  try {
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['other'],
      declaredSelection: true,
    });
    fs.appendFileSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-other', 'SKILL.md'), '\n# edited\n');
    assert.throws(
      () => uninstallNativeSharedSkills({ sourceRoot, projectRoot, host: 'cursor' }),
      /modified|fingerprint|ownership/i,
    );
    assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-other', 'SKILL.md')));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('uninstallNativeSharedSkills removes shared content when the last Host unbinds', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-uninstall-last-');
  try {
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    write(path.join(projectRoot, '.agents', 'skills', 'foreign', 'keep.md'), '# keep\n');
    const result = uninstallNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'codex',
    });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.codex', 'skills', 'dhpk-sample')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')));
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'foreign', 'keep.md'), 'utf8'), '# keep\n');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('uninstallNativeSharedSkills rejects an unsupported Host', () => {
  assert.throws(
    () => uninstallNativeSharedSkills({
      sourceRoot: '/tmp/dhpk-native-shared-unused-source',
      projectRoot: '/tmp/dhpk-native-shared-unused-project',
      host: 'claude',
    }),
    /unsupported native shared-skill Host/,
  );
});

run('native-shared-skill-install');
