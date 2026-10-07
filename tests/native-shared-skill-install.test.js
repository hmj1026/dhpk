'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { installNativeSharedSkills, uninstallNativeSharedSkills } = require('../scripts/lib/native-shared-skill-install');
const {
  validateRelocatableAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
  materializeRelocatableAgentsSkillsProjection,
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
    const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const cursorBinding = {
      ...receipt.hostBindings.cursor,
      selectedStableIds: ['other', 'sample'],
      emittedStableIds: ['sample'],
    };
    const { receiptFingerprint: previousFingerprint, ...payload } = receipt;
    const hostBindings = { ...payload.hostBindings, cursor: cursorBinding };
    const expanded = { ...payload, hostBindings, bindings: hostBindings };
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
      }
      return value;
    };
    write(receiptPath, `${JSON.stringify({
      ...expanded,
      receiptFingerprint: crypto.createHash('sha256').update(JSON.stringify(canonical(expanded))).digest('hex'),
    }, null, 2)}\n`);
    const beforeUninstall = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(beforeUninstall.ok, true, (beforeUninstall.errors || []).join('\n'));
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

test('uninstallNativeSharedSkills rejects invalid current inventories before retirement removal', () => {
  const mutations = [
    (inventory) => ({ ...inventory, skills: [], project_agent_projection: { ...inventory.project_agent_projection, profiles: {} } }),
    (inventory) => ({ ...inventory, skills: inventory.skills.filter((entry) => entry.id === 'other'), project_agent_projection: { ...inventory.project_agent_projection, profiles: {} } }),
    (inventory) => ({ ...inventory, skills: inventory.skills.map((entry) => ({ ...entry, path: undefined })) }),
    (inventory) => ({ ...inventory, skills: inventory.skills.filter((entry) => entry.id === 'other') }),
    (inventory) => ({ ...inventory, skills: [...inventory.skills, inventory.skills[0]] }),
  ];
  for (const mutate of mutations) {
    const sourceRoot = dualFixture();
    const projectRoot = tmpDir('dhpk-native-shared-invalid-retirement-');
    try {
      installNativeSharedSkills({ sourceRoot, projectRoot, host: 'cursor', selectedStableIds: ['sample'], declaredSelection: true });
      installNativeSharedSkills({ sourceRoot, projectRoot, host: 'codex', selectedStableIds: ['sample'], declaredSelection: true });
      const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
      const skillPath = path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md');
      const beforeReceipt = fs.readFileSync(receiptPath, 'utf8');
      const beforeSkill = fs.readFileSync(skillPath, 'utf8');
      write(path.join(projectRoot, '.agents', 'skills', 'foreign', 'README.md'), '# keep\n');
      const inventory = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests', 'distribution-inventory.json'), 'utf8'));
      assert.throws(() => uninstallNativeSharedSkills({ sourceRoot, projectRoot, host: 'codex', inventory: mutate(inventory) }));
      assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), beforeReceipt);
      assert.strictEqual(fs.readFileSync(skillPath, 'utf8'), beforeSkill);
      for (const host of ['cursor', 'codex']) {
        assert.strictEqual(fs.readlinkSync(path.join(projectRoot, `.${host}`, 'skills', 'dhpk-sample')), '../../.agents/skills/dhpk-sample');
      }
      assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'foreign', 'README.md'), 'utf8'), '# keep\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  }
});

test('uninstallNativeSharedSkills prunes a retired skill when removing an unbound Host', () => {
  const sourceRoot = dualFixture();
  const projectRoot = tmpDir('dhpk-native-shared-uninstall-retired-');
  const retiredNativeSkill = path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample');
  const remainingNativeSkill = path.join(projectRoot, '.cursor', 'skills', 'dhpk-other');
  const retiredSharedSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md');
  const remainingSharedSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-other', 'SKILL.md');
  const foreignFile = path.join(projectRoot, '.agents', 'skills', 'user-owned', 'README.md');
  try {
    installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample', 'other'],
      declaredSelection: true,
    });

    const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const profile = inventory.project_agent_projection.profiles['portable-core'];
    const retiredInventory = {
      ...inventory,
      skills: inventory.skills.filter((skill) => skill.id !== 'sample'),
      project_agent_projection: {
        ...inventory.project_agent_projection,
        profiles: {
          ...inventory.project_agent_projection.profiles,
          'portable-core': {
            ...profile,
            stable_ids: ['other'],
          },
        },
      },
    };
    write(inventoryPath, `${JSON.stringify(retiredInventory, null, 2)}\n`);
    write(foreignFile, '# keep\n');

    const result = uninstallNativeSharedSkills({ sourceRoot, projectRoot, host: 'codex' });

    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.ok(!fs.existsSync(retiredNativeSkill));
    assert.ok(!fs.existsSync(retiredSharedSkill));
    assert.ok(fs.lstatSync(remainingNativeSkill).isSymbolicLink());
    assert.ok(fs.existsSync(remainingSharedSkill));
    assert.strictEqual(fs.readFileSync(foreignFile, 'utf8'), '# keep\n');
    assert.deepStrictEqual(result.receipt.selectedIds, ['other']);
    assert.deepStrictEqual(result.receipt.emittedIds, ['other']);
    assert.deepStrictEqual(result.receipt.entries.map((entry) => entry.stableId), ['other']);
    assert.deepStrictEqual(result.receipt.hostBindings.cursor.selectedStableIds, ['other']);
    assert.deepStrictEqual(result.receipt.hostBindings.cursor.emittedStableIds, ['other']);
    assert.deepStrictEqual(
      result.receipt.hostBindings.cursor.bindings.map((binding) => binding.stableId),
      ['other'],
    );
    assert.deepStrictEqual(result.receipt.bindingPaths.cursor, [{
      path: '.cursor/skills/dhpk-other',
      target: '../../.agents/skills/dhpk-other',
    }]);
    assert.ok(result.receipt.managedPaths.every((managedPath) => !managedPath.includes('dhpk-sample')));
    const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(checked.ok, true, (checked.errors || []).join('\n'));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('retirement reconciliation keeps hidden skills and independent Claude discovery with an empty remaining Host', () => {
  const sourceRoot = hiddenVisibleFixture();
  const projectRoot = tmpDir('dhpk-native-shared-mixed-retirement-');
  try {
    const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
    const initial = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const inventory = {
      ...initial,
      skills: initial.skills.map((entry) => ({ ...entry, surfaces: [...entry.surfaces, 'claude-core'] })),
    };
    write(path.join(sourceRoot, 'skills', 'dhpk-retired', 'SKILL.md'), '---\nname: dhpk-retired\ndescription: Retired\n---\n# Retired\n');
    const oldInventory = {
      ...inventory,
      skills: [...inventory.skills, { id: 'retired', name: 'dhpk-retired', path: 'skills/dhpk-retired', lifecycle: 'promoted', surfaces: ['agy-plugin', 'cursor-plugin', 'codex-sync'] }],
      project_agent_projection: {
        ...inventory.project_agent_projection,
        profiles: { 'portable-core': { ...inventory.project_agent_projection.profiles['portable-core'], stable_ids: ['hidden', 'retired', 'visible'] } },
      },
    };
    const previous = materializeRelocatableAgentsSkillsProjection({
      sourceRoot, projectRoot, inventory: oldInventory, requestedHosts: ['agy', 'claude', 'codex', 'cursor'],
      declaredSelection: true, selectedStableIds: ['hidden', 'retired', 'visible'],
      hostSelections: { agy: ['retired'], claude: ['visible'], codex: ['hidden', 'visible'], cursor: ['retired'] },
    });
    const result = uninstallNativeSharedSkills({ sourceRoot, projectRoot, inventory, host: 'cursor' });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.receipt.emittedIds, ['hidden', 'visible']);
    assert.deepStrictEqual(result.receipt.hostBindings.agy.emittedStableIds, []);
    assert.strictEqual(result.receipt.bindingPaths.agy, undefined);
    assert.deepStrictEqual(result.receipt.hostBindings.codex.emittedStableIds, ['hidden', 'visible']);
    assert.deepStrictEqual(result.receipt.hostBindings.claude.emittedStableIds, ['visible']);
    assert.deepStrictEqual(result.receipt.hostBindings.claude.discovery.paths, ['.claude/skills/dhpk-visible']);
    assert.strictEqual(result.receipt.hostBindings.codex.bindingShape, previous.receipt.hostBindings.codex.bindingShape);
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-hidden', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'dhpk-hidden')));
    const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(checked.ok, true, (checked.errors || []).join('\n'));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('retirement reconciliation prunes selected-only IDs without reclassifying direct bindings', () => {
  const sourceRoot = dualFixture();
  const projectRoot = tmpDir('dhpk-native-shared-retired-selection-');
  try {
    const oldInventory = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const installed = materializeRelocatableAgentsSkillsProjection({
      sourceRoot, projectRoot, inventory: oldInventory, requestedHosts: ['cursor'],
      cursorBinding: { bindingShape: 'direct', reason: 'verified-consumer-discovery' },
    });
    assert.deepStrictEqual(installed.receipt.hostBindings.cursor.selectedStableIds, ['other', 'sample']);
    assert.deepStrictEqual(installed.receipt.hostBindings.cursor.emittedStableIds, ['sample']);
    assert.deepStrictEqual(installed.receipt.entries.map((entry) => entry.stableId), ['sample']);
    const inventory = {
      ...oldInventory,
      skills: oldInventory.skills.filter((entry) => entry.id === 'sample'),
      project_agent_projection: {
        ...oldInventory.project_agent_projection,
        profiles: { 'portable-core': { ...oldInventory.project_agent_projection.profiles['portable-core'], stable_ids: ['sample'] } },
      },
    };
    const result = uninstallNativeSharedSkills({ sourceRoot, projectRoot, inventory, host: 'codex' });
    assert.deepStrictEqual(result.receipt.hostBindings.cursor.selectedStableIds, ['sample']);
    assert.deepStrictEqual(result.receipt.hostBindings.cursor.emittedStableIds, ['sample']);
    assert.strictEqual(result.receipt.hostBindings.cursor.bindingShape, 'direct');
    assert.strictEqual(result.receipt.hostBindings.cursor.bindingReason, 'verified-consumer-discovery');
    assert.deepStrictEqual(result.receipt.bindingPaths.cursor, []);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(checked.ok, true, (checked.errors || []).join('\n'));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('uninstallNativeSharedSkills removes an entirely retired projection using a valid current profile', () => {
  const sourceRoot = dualFixture();
  const projectRoot = tmpDir('dhpk-native-shared-all-retired-');
  try {
    installNativeSharedSkills({ sourceRoot, projectRoot, host: 'cursor', selectedStableIds: ['sample'], declaredSelection: true });
    const oldInventory = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const inventory = {
      ...oldInventory,
      skills: oldInventory.skills.filter((entry) => entry.id === 'other'),
      project_agent_projection: {
        ...oldInventory.project_agent_projection,
        profiles: { 'portable-core': { ...oldInventory.project_agent_projection.profiles['portable-core'], stable_ids: ['other'] } },
      },
    };
    write(path.join(projectRoot, '.agents', 'skills', 'foreign', 'README.md'), '# keep\n');
    const result = uninstallNativeSharedSkills({ sourceRoot, projectRoot, host: 'codex', inventory });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.state, 'REMOVED');
    assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample')));
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'foreign', 'README.md'), 'utf8'), '# keep\n');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('retirement reconciliation preserves rollback and blocks modified retired assets', () => {
  for (const damage of ['none', 'content', 'link']) {
    const sourceRoot = dualFixture();
    const projectRoot = tmpDir('dhpk-native-shared-retirement-safety-');
    try {
      installNativeSharedSkills({ sourceRoot, projectRoot, host: 'cursor', selectedStableIds: ['sample', 'other'], declaredSelection: true });
      installNativeSharedSkills({ sourceRoot, projectRoot, host: 'codex', selectedStableIds: ['other'], declaredSelection: true });
      const inventoryPath = path.join(sourceRoot, 'manifests', 'distribution-inventory.json');
      const oldInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      const inventory = {
        ...oldInventory,
        skills: oldInventory.skills.filter((entry) => entry.id === 'other'),
        project_agent_projection: {
          ...oldInventory.project_agent_projection,
          profiles: { 'portable-core': { ...oldInventory.project_agent_projection.profiles['portable-core'], stable_ids: ['other'] } },
        },
      };
      const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
      const retiredFile = path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md');
      const retiredLink = path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample');
      if (damage === 'content') fs.appendFileSync(retiredFile, '\nUser edit\n');
      if (damage === 'link') {
        fs.unlinkSync(retiredLink);
        fs.symlinkSync('../../foreign', retiredLink);
      }
      const beforeReceipt = fs.readFileSync(receiptPath, 'utf8');
      const beforeContent = fs.readFileSync(retiredFile, 'utf8');
      const beforeLink = fs.readlinkSync(retiredLink);
      if (damage !== 'none') {
        assert.throws(() => uninstallNativeSharedSkills({ sourceRoot, projectRoot, inventory, host: 'codex' }));
        assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), beforeReceipt);
        assert.strictEqual(fs.readFileSync(retiredFile, 'utf8'), beforeContent);
        assert.strictEqual(fs.readlinkSync(retiredLink), beforeLink);
      } else {
        const result = uninstallNativeSharedSkills({ sourceRoot, projectRoot, inventory, host: 'codex' });
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual(Object.keys(result.receipt.hostBindings), ['cursor']);
        assert.deepStrictEqual(result.receipt.hostBindings.cursor.emittedStableIds, ['other']);
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        const restored = rollbackAgentsSkillsProjection({ projectRoot });
        assert.strictEqual(restored.ok, true, JSON.stringify(restored.error));
        assert.strictEqual(fs.readFileSync(retiredFile, 'utf8'), beforeContent);
        assert.strictEqual(fs.readlinkSync(retiredLink), beforeLink);
        const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
        assert.strictEqual(checked.ok, true, (checked.errors || []).join('\n'));
        assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).hostBindings).sort(), ['codex', 'cursor']);
      }
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
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

// Consolidated source suite: install-native-shared-skills.
{

  const fs = require('node:fs');
const crypto = require('node:crypto');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'install-native-shared-skills.js');

  function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  function fixture() {
    const sourceRoot = tmpDir('dhpk-install-native-src-');
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
        surfaces: ['cursor-sync', 'cursor-plugin'],
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

  function invoke(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 20000,
    });
  }

  test('CLI installs Cursor native-link bindings from a declared selection', () => {
    const sourceRoot = fixture();
    const projectRoot = tmpDir('dhpk-install-native-project-');
    try {
      const result = invoke([
        'install',
        '--source', sourceRoot,
        '--project-root', projectRoot,
        '--host', 'cursor',
        '--selected-id', 'sample',
        '--declared-selection',
        '--json',
      ]);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.bindingShape, 'native-link');
      assert.deepStrictEqual(report.selectedIds, ['sample']);
      const nativeSkill = path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample');
      assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
      assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('CLI usage fails closed when each required install argument is missing', () => {
    const sourceRoot = fixture();
    const bareInstall = invoke(['install', '--json']);
    assert.notStrictEqual(bareInstall.status, 0, `${bareInstall.stdout}\n${bareInstall.stderr}`);
    assert.match(`${bareInstall.stdout}\n${bareInstall.stderr}`, /usage: install-native-shared-skills/);
    const cases = [
      { name: 'source', option: '--source' },
      { name: 'project root', option: '--project-root' },
      { name: 'selected id', option: '--selected-id' },
    ];
    try {
      for (const { name, option } of cases) {
        const projectRoot = tmpDir(`dhpk-install-native-missing-${name.replaceAll(' ', '-')}-`);
        const args = [
          'install',
          '--source', sourceRoot,
          '--project-root', projectRoot,
          '--host', 'cursor',
          '--selected-id', 'sample',
          '--declared-selection',
          '--json',
        ];
        const index = args.indexOf(option);
        assert.notStrictEqual(index, -1, `could not find ${name} argument`);
        args.splice(index, 2);

        try {
          const result = invoke(args);
          assert.notStrictEqual(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
          assert.match(`${result.stdout}\n${result.stderr}`, /usage: install-native-shared-skills/);
          assert.deepStrictEqual(fs.readdirSync(projectRoot), [], `${name} failure mutated the project`);
        } finally {
          fs.rmSync(projectRoot, { recursive: true, force: true });
        }
      }
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  test('CLI explains how to resolve a conflicting skill symlink', () => {
    const sourceRoot = fixture();
    const projectRoot = tmpDir('dhpk-install-native-conflict-');
    try {
      fs.mkdirSync(path.join(projectRoot, '.agents', 'skills'), { recursive: true });
      fs.symlinkSync(sourceRoot, path.join(projectRoot, '.agents', 'skills', 'dhpk-sample'));
      const result = invoke(['install', '--source', sourceRoot, '--project-root', projectRoot,
        '--host', 'cursor', '--selected-id', 'sample', '--declared-selection', '--json']);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /conflicting skill symlink|symlink at candidate/i);
      assert.match(result.stderr, /remove|adopt/i);
      assert.ok(fs.lstatSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample')).isSymbolicLink());
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('CLI classify and install honor an injected Cursor PASS probe record', () => {
    const sourceRoot = fixture();
    const projectRoot = tmpDir('dhpk-install-native-direct-');
    const evidence = path.join(projectRoot, 'cursor-probe.json');
    try {
      write(evidence, `${JSON.stringify({
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
      })}\n`);
      const classified = invoke(['classify', '--json', '--consumer-evidence', evidence]);
      assert.strictEqual(classified.status, 0, `${classified.stdout}\n${classified.stderr}`);
      const classification = JSON.parse(classified.stdout);
      assert.strictEqual(classification.bindingShape, 'direct');
      assert.match(String(classification.reason || ''), /PASS/i);

      const result = invoke([
        'install',
        '--source', sourceRoot,
        '--project-root', projectRoot,
        '--host', 'cursor',
        '--selected-id', 'sample',
        '--declared-selection',
        '--consumer-evidence', evidence,
        '--json',
      ]);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.bindingShape, 'direct');
      assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('CLI classify --host codex honors Codex PASS and ignores Cursor PASS', () => {
    const projectRoot = tmpDir('dhpk-install-native-codex-classify-');
    const codexEvidence = path.join(projectRoot, 'codex-probe.json');
    const cursorEvidence = path.join(projectRoot, 'cursor-probe.json');
    try {
      write(codexEvidence, `${JSON.stringify({
        stage: 'CONSUMER',
        producer: 'consumer-platform-probe',
        adapter: { id: 'codex-project-discovery', version: '1.0.0' },
        surfaceResults: [{
          surface: 'codex-project',
          status: 'PASS',
          adapter: { id: 'codex-project-discovery', version: '1.0.0' },
          commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform codex-project', exitCode: 0 }],
          environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
          artifacts: [],
          diagnostics: [],
          reasons: ['bounded Codex project probe PASS'],
          checkedClaims: ['project-artifact-structure', 'codex-project-discovery', 'consumer-route'],
        }],
      })}\n`);
      write(cursorEvidence, `${JSON.stringify({
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
      })}\n`);
      const classified = invoke(['classify', '--json', '--host', 'codex', '--consumer-evidence', codexEvidence]);
      assert.strictEqual(classified.status, 0, `${classified.stdout}\n${classified.stderr}`);
      assert.strictEqual(JSON.parse(classified.stdout).bindingShape, 'direct');
      const ignored = invoke(['classify', '--json', '--host', 'codex', '--consumer-evidence', cursorEvidence]);
      assert.strictEqual(ignored.status, 0, `${ignored.stdout}\n${ignored.stderr}`);
      assert.strictEqual(JSON.parse(ignored.stdout).bindingShape, 'native-link');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('CLI installs Codex native-link bindings from a declared selection', () => {
    const sourceRoot = fixture();
    const projectRoot = tmpDir('dhpk-install-native-codex-project-');
    try {
      const result = invoke([
        'install',
        '--source', sourceRoot,
        '--project-root', projectRoot,
        '--host', 'codex',
        '--selected-id', 'sample',
        '--declared-selection',
        '--json',
      ]);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.host, 'codex');
      assert.strictEqual(report.bindingShape, 'native-link');
      const nativeSkill = path.join(projectRoot, '.codex', 'skills', 'dhpk-sample');
      assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
      assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('CLI uninstalls one Host and keeps the remaining Host bindings', () => {
    const sourceRoot = fixture();
    const projectRoot = tmpDir('dhpk-install-native-uninstall-');
    try {
      const cursor = invoke([
        'install',
        '--source', sourceRoot,
        '--project-root', projectRoot,
        '--host', 'cursor',
        '--selected-id', 'sample',
        '--declared-selection',
        '--json',
      ]);
      assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
      const codex = invoke([
        'install',
        '--source', sourceRoot,
        '--project-root', projectRoot,
        '--host', 'codex',
        '--selected-id', 'sample',
        '--declared-selection',
        '--json',
      ]);
      assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
      const removed = invoke([
        'uninstall',
        '--source', sourceRoot,
        '--project-root', projectRoot,
        '--host', 'cursor',
        '--json',
      ]);
      assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
      assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
      assert.ok(fs.lstatSync(path.join(projectRoot, '.codex', 'skills', 'dhpk-sample')).isSymbolicLink());
      assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
      const receipt = JSON.parse(fs.readFileSync(path.join(projectRoot, '.agents', '.dhpk-installed.json'), 'utf8'));
      assert.strictEqual(receipt.hostBindings.cursor, undefined);
      assert.deepStrictEqual(receipt.hostBindings.codex.selectedStableIds, ['sample']);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}


run('native-shared-skill-install');
