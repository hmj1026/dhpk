'use strict';

// RED contracts for scope-default-workflow-capability-bundles.  The fixture is
// intentionally small but keeps the inventory/profile/retirement boundaries
// used by the production manifests.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const selection = require('../scripts/lib/capability-bundle-selection');

const CORE_IDS = Object.freeze([
  'core-01', 'core-02', 'core-03', 'core-04', 'core-05',
  'core-06', 'core-07', 'core-08', 'core-09',
]);

function fixture() {
  const skills = CORE_IDS.map((id) => ({
    id,
    name: `dhpk-${id}`,
    path: `skills/dhpk-${id}`,
    lifecycle: 'promoted',
    tier: 'core',
    profiles: ['core'],
    surfaces: ['claude-profile', 'agent-plugin', 'cursor-plugin', 'agy-plugin', 'codex-native'],
  }));
  skills.push(
    {
      id: 'module-a-skill', name: 'dhpk-module-a', path: 'skills/dhpk-module-a', lifecycle: 'optional', tier: 'optional',
      profiles: ['module-a'], surfaces: ['claude-profile', 'agent-plugin', 'cursor-plugin', 'agy-plugin', 'codex-native'],
    },
    {
      id: 'module-b-skill', name: 'dhpk-module-b', path: 'skills/dhpk-module-b', lifecycle: 'optional', tier: 'optional',
      profiles: ['module-b'], surfaces: ['claude-profile', 'cursor-plugin'],
    },
    {
      id: 'unavailable-skill', name: 'dhpk-unavailable', path: 'skills/dhpk-unavailable', lifecycle: 'optional', tier: 'optional',
      profiles: ['module-a'], surfaces: ['claude-profile'],
    },
    {
      id: 'runtime-support', name: 'dhpk-runtime-support', path: 'skills/dhpk-runtime-support', lifecycle: 'optional', tier: 'optional',
      profiles: ['core'], surfaces: ['claude-profile', 'agent-plugin'], invokable: false,
    },
  );
  return {
    inventory: {
      schema: 'dhpk.distribution-inventory.v2',
      skills,
      modules: [],
      required_core_ids: CORE_IDS.slice(),
      surface_membership: {
        'claude-profile': skills.map((entry) => entry.id),
        'agent-plugin': skills.filter((entry) => entry.surfaces.includes('agent-plugin')).map((entry) => entry.id),
        'cursor-plugin': skills.filter((entry) => entry.surfaces.includes('cursor-plugin')).map((entry) => entry.id),
        'agy-plugin': skills.filter((entry) => entry.surfaces.includes('agy-plugin')).map((entry) => entry.id),
        'codex-native': CORE_IDS.slice(0, 3).concat('module-a-skill'),
      },
      retired_skills: [{
        id: 'retired-id', name: 'dhpk-retired', canonicalPath: 'skills/dhpk-retired',
        priorSurfaces: ['claude-profile'], retiredIn: '0.46.1', reasonCode: 'retired', replacements: [], rollback: { release: '0.46.1' },
      }],
    },
    profiles: {
      version: 1,
      profiles: {
        minimal: { modules: [], skillIds: CORE_IDS.slice() },
        full: { modules: ['module-a'], skillIds: CORE_IDS.concat(['module-a-skill']), excludes: { 'module-b': 'conflict' } },
        'compat-v1': { modules: [], skillIds: skills.filter((entry) => entry.invokable !== false).map((entry) => entry.id) },
      },
    },
    moduleCatalog: { modules: [{ id: 'module-a', requires: [] }, { id: 'module-b', requires: [] }] },
  };
}

function resolve(input = {}) {
  const source = fixture();
  return selection.resolveCapabilitySelection({
    inventory: source.inventory,
    profiles: source.profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
    ...input,
  });
}

test('fixture declares nine minimal IDs, conflict-aware full inputs, and compat-v1 invokable live IDs', () => {
  const source = fixture();
  assert.strictEqual(source.profiles.profiles.minimal.skillIds.length, 9);
  assert.deepStrictEqual(source.profiles.profiles.minimal.skillIds, CORE_IDS);
  assert.deepStrictEqual(source.profiles.profiles.full.excludes, { 'module-b': 'conflict' });
  assert.strictEqual(source.profiles.profiles['compat-v1'].skillIds.length, source.inventory.skills.filter((entry) => entry.invokable !== false).length);
});

test('minimal resolves exactly nine required core IDs', () => {
  const result = resolve({ profileId: 'minimal' });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.deepStrictEqual(result.value.selectedStableIds, CORE_IDS);
  assert.strictEqual(result.value.selectionMode, 'profile');
});

test('full preserves conflict-aware module semantics and is not the complete catalog', () => {
  const result = resolve({ profileId: 'full' });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.ok(result.value.selectedStableIds.includes('module-a-skill'));
  assert.ok(!result.value.selectedStableIds.includes('module-b-skill'));
  assert.ok(result.value.selectedStableIds.length < fixture().inventory.skills.length);
});

test('compat-v1 resolves every non-retired invokable stable ID in deterministic order', () => {
  const result = resolve({ profileId: 'compat-v1' });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.deepStrictEqual(result.value.selectedStableIds, fixture().inventory.skills
    .filter((entry) => entry.invokable !== false).map((entry) => entry.id).sort());
  assert.ok(!result.value.selectedStableIds.includes('runtime-support'));
  assert.strictEqual(result.value.compatibilityMode, 'compat-v1');
});

test('valid repeated skill overlay is additive and does not mutate profile definitions', () => {
  const source = fixture();
  const before = JSON.stringify(source.profiles);
  const result = selection.resolveCapabilitySelection({
    inventory: source.inventory, profiles: source.profiles, moduleCatalog: source.moduleCatalog,
    profileId: 'minimal', surface: 'agent-plugin', skillIds: ['module-a-skill', 'module-a-skill'],
  });
  assert.strictEqual(result.ok, false, 'duplicate overlay must fail closed');
  assert.strictEqual(JSON.stringify(source.profiles), before);

  const valid = selection.resolveCapabilitySelection({
    inventory: source.inventory, profiles: source.profiles, moduleCatalog: source.moduleCatalog,
    profileId: 'minimal', surface: 'agent-plugin', skillIds: ['module-a-skill'],
  });
  assert.strictEqual(valid.ok, true, valid.error && valid.error.message);
  assert.deepStrictEqual(valid.value.selectedStableIds, CORE_IDS.concat('module-a-skill').sort());
  assert.strictEqual(valid.value.selectionMode, 'explicit-overlay');
  assert.strictEqual(JSON.stringify(source.profiles), before);
});

test('resolver rejects unknown, retired, missing, incompatible, and conflict-excluded IDs', () => {
  for (const [id, code] of [
    ['unknown-id', 'UNKNOWN_STABLE_ID'],
    ['retired-id', 'RETIRED_STABLE_ID'],
    ['', 'MISSING_STABLE_ID'],
    ['module-b-skill', 'SURFACE_INCOMPATIBLE'],
    ['runtime-support', 'NON_INVOKABLE_STABLE_ID'],
  ]) {
    const result = resolve({ profileId: 'minimal', surface: 'agent-plugin', skillIds: [id] });
    assert.strictEqual(result.ok, false, `${id} must fail closed`);
    assert.strictEqual(result.error.code, code, `${id} should report ${code}`);
  }
  const conflict = resolve({ profileId: 'full', surface: 'claude-profile', skillIds: ['module-b-skill'] });
  assert.strictEqual(conflict.ok, false);
  assert.strictEqual(conflict.error.code, 'CONFLICT_EXCLUDED');
});

test('equivalent normalized inputs serialize identically and reordered IDs fingerprint differently', () => {
  const source = fixture();
  const first = resolve({ profileId: 'minimal' });
  const second = selection.resolveCapabilitySelection({
    inventory: source.inventory, profiles: source.profiles, moduleCatalog: source.moduleCatalog,
    profileId: 'minimal', surface: 'claude-profile',
  });
  assert.strictEqual(first.value.selectionFingerprint, second.value.selectionFingerprint);
  const reordered = selection.resolveCapabilitySelection({
    inventory: source.inventory, profiles: { ...source.profiles, profiles: { ...source.profiles.profiles, minimal: { modules: [], skillIds: CORE_IDS.slice().reverse() } } },
    moduleCatalog: source.moduleCatalog, profileId: 'minimal', surface: 'claude-profile',
  });
  assert.strictEqual(reordered.ok, true, reordered.error && reordered.error.message);
  assert.notStrictEqual(first.value.selectionFingerprint, reordered.value.selectionFingerprint);
  assert.ok(Object.isFrozen(first.value));
});

test('surface identity shares canonical selection and Codex emits only supported intersection', () => {
  const canonical = resolve({ profileId: 'compat-v1' });
  assert.strictEqual(canonical.ok, true, canonical.error && canonical.error.message);
  const codex = selection.bindSurfaceSelection({
    selection: canonical.value, surface: 'codex-native', supportedStableIds: ['core-01', 'core-02', 'module-a-skill'],
  });
  assert.strictEqual(codex.ok, true, codex.error && codex.error.message);
  assert.deepStrictEqual(codex.value.emittedStableIds, ['core-01', 'core-02', 'module-a-skill']);
  assert.strictEqual(codex.value.selectionFingerprint, canonical.value.selectionFingerprint);
  assert.ok(codex.value.surfaceSelectionFingerprint);
  const drift = selection.validateSurfaceSelection({ selection: canonical.value, surface: 'agent-plugin', emittedStableIds: ['not-selected'] });
  assert.strictEqual(drift.ok, false);
});

test('distribution and installer flags parse profile plus repeatable skills', () => {
  const parsed = selection.parseSelectionArgs(['--profile', 'minimal', '--skill', 'core-01', '--skill=core-02']);
  assert.deepStrictEqual(parsed, { profileId: 'minimal', skillIds: ['core-01', 'core-02'] });
  const standalone = selection.parseSelectionArgs(['--standalone', 'module-a-skill', '--standalone=core-01']);
  assert.deepStrictEqual(standalone, {
    profileId: null,
    skillIds: [],
    standaloneSkillIds: ['module-a-skill', 'core-01'],
  });
  assert.throws(() => selection.parseSelectionArgs(['--profile']), /requires a value/);
  assert.throws(() => selection.parseSelectionArgs(['--unknown']), /unknown selection option/i);
});

test('standalone selection is explicit, deduplicated, and does not inject required core IDs', () => {
  const source = fixture();
  source.inventory.standalone_dependencies = {
    'module-a-skill': { requires: ['core-01'], runtime_support: ['runtime-support'] },
  };
  const result = selection.resolveCapabilitySelection({
    inventory: source.inventory,
    profiles: source.profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
    standaloneSkillIds: ['dhpk-module-a', 'module-a-skill', 'module-a-skill'],
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.value.selectionMode, 'standalone');
  assert.strictEqual(result.value.profileId, null);
  assert.deepStrictEqual(result.value.requestedStableIds, ['module-a-skill']);
  assert.deepStrictEqual(result.value.selectedStableIds, ['core-01', 'module-a-skill']);
  assert.deepStrictEqual(result.value.emittedPublicNames, ['dhpk-core-01', 'dhpk-module-a']);
  assert.deepStrictEqual(result.value.dependencyClosure.runtimeSupportIds, ['runtime-support']);
  assert.strictEqual(result.value.selectedStableIds.length < CORE_IDS.length, true);
});

test('standalone missing auth or permission is explicit unavailable evidence, never privilege expansion', () => {
  const source = fixture();
  source.inventory.standalone_dependencies = {
    'module-a-skill': {
      capabilities: [{ id: 'provider-auth', available: false, reason: 'test auth is not configured' }],
    },
  };
  const result = selection.resolveCapabilitySelection({
    inventory: source.inventory,
    profiles: source.profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
    standaloneSkillIds: ['module-a-skill'],
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.deepStrictEqual(result.value.selectedStableIds, ['module-a-skill']);
  assert.deepStrictEqual(result.value.unavailableCapabilities, [{
    id: 'provider-auth', reason: 'test auth is not configured', required: true,
  }]);
});

test('standalone dependency errors fail closed without changing profile overlay semantics', () => {
  const source = fixture();
  const dependencyCases = [
    { catalog: { 'module-a-skill': { requires: ['missing'] } }, code: 'UNKNOWN_STABLE_ID' },
    { catalog: { 'module-a-skill': { requires: ['retired-id'] } }, code: 'RETIRED_STABLE_ID' },
    { catalog: { 'module-a-skill': { requires: ['runtime-support'] } }, code: 'NON_INVOKABLE_STABLE_ID' },
    { catalog: { 'module-a-skill': { requires: ['module-b-skill'] }, 'module-b-skill': { requires: ['module-a-skill'] } }, code: 'STANDALONE_DEPENDENCY_CYCLE' },
  ];
  for (const current of dependencyCases) {
    const result = selection.resolveCapabilitySelection({
      inventory: { ...source.inventory, standalone_dependencies: current.catalog },
      profiles: source.profiles,
      moduleCatalog: source.moduleCatalog,
      surface: 'claude-profile',
      standaloneSkillIds: ['module-a-skill'],
    });
    assert.strictEqual(result.ok, false, `${current.code} must fail closed`);
    assert.strictEqual(result.error.code, current.code, `${current.code} diagnostic`);
  }
  const mixed = selection.resolveCapabilitySelection({
    inventory: source.inventory,
    profiles: source.profiles,
    moduleCatalog: source.moduleCatalog,
    profileId: 'minimal',
    surface: 'agent-plugin',
    skillIds: ['module-a-skill'],
    standaloneSkillIds: ['module-a-skill'],
  });
  assert.strictEqual(mixed.ok, false);
  assert.strictEqual(mixed.error.code, 'MIXED_SELECTION_MODES');
});

test('receipt selection preserves compat-v1 until explicit migration', () => {
  const source = fixture();
  const existing = selection.resolveReceiptSelection({
    receipt: { schema: 'dhpk.installed.v3', selectedStableIds: CORE_IDS.slice() },
    inventory: source.inventory, profiles: source.profiles, moduleCatalog: source.moduleCatalog, surface: 'claude-profile',
  });
  assert.strictEqual(existing.ok, true, existing.error && existing.error.message);
  assert.strictEqual(existing.value.profileId, 'compat-v1');
  assert.deepStrictEqual(existing.value.selectedStableIds, source.inventory.skills
    .filter((entry) => entry.invokable !== false).map((entry) => entry.id).sort());
  const migration = selection.planProfileMigration({
    receipt: { profileId: 'compat-v1', selectedStableIds: source.inventory.skills.map((entry) => entry.id) },
    targetProfileId: 'minimal', inventory: source.inventory, profiles: source.profiles, moduleCatalog: source.moduleCatalog, surface: 'claude-profile',
  });
  assert.strictEqual(migration.ok, true, migration.error && migration.error.message);
  assert.strictEqual(migration.value.oldSelection.profileId, 'compat-v1');
  assert.strictEqual(migration.value.newSelection.profileId, 'minimal');
});

test('standalone receipts preserve their requested boundary during validation and update planning', () => {
  const source = fixture();
  source.inventory.standalone_dependencies = { 'module-a-skill': { requires: ['core-01'] } };
  const existing = selection.resolveReceiptSelection({
    receipt: {
      selectionMode: 'standalone',
      profileId: null,
      requestedStableIds: ['module-a-skill'],
      selectedStableIds: ['core-01', 'module-a-skill'],
    },
    inventory: source.inventory,
    profiles: source.profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
  });
  assert.strictEqual(existing.ok, true, existing.error && existing.error.message);
  assert.strictEqual(existing.value.selectionMode, 'standalone');
  assert.strictEqual(existing.value.preservedStandalone, true);
  assert.deepStrictEqual(existing.value.requestedStableIds, ['module-a-skill']);
  const migration = selection.planProfileMigration({
    receipt: { selectionMode: 'standalone', requestedStableIds: ['module-a-skill'], selectedStableIds: ['core-01', 'module-a-skill'] },
    targetStandaloneSkillIds: ['core-02'],
    inventory: source.inventory,
    profiles: source.profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
  });
  assert.strictEqual(migration.ok, true, migration.error && migration.error.message);
  assert.strictEqual(migration.value.migration.toSelectionMode, 'standalone');
  assert.deepStrictEqual(migration.value.newSelection.requestedStableIds, ['core-02']);
});

test('activation gate requires every required runtime surface to PASS', () => {
  const gate = selection.evaluateActivation({
    requiredRuntimeSurfaces: ['claude', 'codex'],
    evidence: [
      { surface: 'claude', verdict: 'PASS' },
      { surface: 'codex', verdict: 'UNAVAILABLE' },
    ],
  });
  assert.strictEqual(gate.ok, false);
  assert.deepStrictEqual(gate.nonPassSurfaces, ['codex']);
  const optional = selection.evaluateActivation({
    requiredRuntimeSurfaces: ['claude'],
    evidence: [{ surface: 'claude', verdict: 'PASS' }, { surface: 'agy', verdict: 'UNAVAILABLE' }],
  });
  assert.strictEqual(optional.ok, true);
});

test('checked-in profiles and inventory satisfy the normalized selection contract', () => {
  const root = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'module-catalog.json'), 'utf8'));
  const checked = selection.validateProfileDefinitions({ inventory, profiles, moduleCatalog });
  assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  const minimal = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog, profileId: 'minimal' });
  const compat = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog, profileId: 'compat-v1' });
  assert.strictEqual(minimal.value.selectedStableIds.length, 8);
  const declaredCompatIds = profiles.profiles['compat-v1'].skillIds.slice().sort();
  assert.deepStrictEqual(compat.value.selectedStableIds, declaredCompatIds);
  for (const familyId of (inventory.skill_routing_families || []).map((family) => family.id)) {
    assert.ok(compat.value.selectedStableIds.includes(familyId), `${familyId} family must remain in compat-v1`);
  }
  assert.ok(compat.value.selectedStableIds.every((id) => !inventory.retired_skills.some((row) => row.id === id)));
});

test('checked-in minimal profile is the curated eight-entry Claude default', () => {
  const root = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests/distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests/install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests/module-catalog.json'), 'utf8'));
  const expected = [
    'change-verdict', 'code-trace', 'flow-drive',
    'flow-guide', 'git-smart-commit', 'project-audit', 'prompt-optimize',
    'tdd',
  ];
  const result = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog, profileId: 'minimal' });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.deepStrictEqual(result.value.selectedStableIds, expected);
  assert.strictEqual(result.value.selectedStableIds.length, 8);
});

run();

module.exports = { CORE_IDS, fixture };
