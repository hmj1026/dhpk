'use strict';

// RED contracts for scope-default-workflow-capability-bundles.  The fixture is
// intentionally small but keeps the inventory/profile/retirement boundaries
// used by the production manifests.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const selection = require('../scripts/lib/capability-bundle-selection');
const { computeProfileProjectionSets } = require('../scripts/lib/profile-projection-sets');
// Consolidated imports from capability-bundle-activation.test.js.
const os = require('node:os');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');
const { activateStagedCandidate } = require('../scripts/lib/capability-bundle-activation');

// Consolidated helpers from capability-bundle-activation.test.js.
function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-capability-activation-'));
}

function plan(fingerprint) {
  return {
    planFingerprint: fingerprint,
    entries: [{ stableId: 'manifest', destination: 'manifest.json', symlink: { policy: 'forbid' } }],
  };
}

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
        common: { modules: ['module-a'], skillIds: CORE_IDS.concat(['module-a-skill']) },
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

test('omitted profile selects the common collection', () => {
  const result = resolve();
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.value.profileId, 'common');
  assert.deepStrictEqual(result.value.selectedStableIds, CORE_IDS.concat(['module-a-skill']).sort());
});

test('general selection cannot expose profiles stored only for historical receipts', () => {
  const source = fixture();
  const profiles = {
    profiles: { common: { modules: [], skillIds: CORE_IDS.slice() } },
    legacy_profiles: { minimal: { modules: [], skillIds: CORE_IDS.slice() } },
  };
  const result = selection.resolveCapabilitySelection({
    inventory: source.inventory,
    profiles,
    moduleCatalog: source.moduleCatalog,
    profileId: 'minimal',
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'UNKNOWN_PROFILE');
});

test('host projection sets include common and omit historical profiles', () => {
  const root = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'module-catalog.json'), 'utf8'));
  const projection = computeProfileProjectionSets({ inventory, profiles, moduleCatalog });
  assert.ok(Object.hasOwn(projection.profiles, 'common'));
  assert.ok(Object.hasOwn(projection.profiles, 'legacy-php-yii'));
  for (const id of ['minimal', 'full', 'compat-v1']) {
    assert.ok(!Object.hasOwn(projection.profiles, id), `${id} is historical receipt metadata only`);
  }
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

test('historical receipt selection preserves exact retired IDs without materializing them', () => {
  const source = fixture();
  const recordedIds = ['retired-id', 'core-01'];
  const receipt = { profileId: 'full', selectedStableIds: recordedIds.slice() };
  const profiles = {
    profiles: { common: { modules: [], skillIds: CORE_IDS.slice() } },
    legacy_profiles: { full: { modules: [], skillIds: CORE_IDS.concat(['retired-id']) } },
  };
  const replay = selection.resolveReceiptSelection({
    receipt,
    inventory: source.inventory,
    profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
  });
  assert.strictEqual(replay.ok, true, replay.error && replay.error.message);
  assert.strictEqual(replay.value.profileId, 'full');
  assert.deepStrictEqual(replay.value.selectedStableIds, recordedIds);
  assert.strictEqual(replay.value.materializationSupported, false);

  const migration = selection.planProfileMigration({
    receipt,
    targetProfileId: 'common',
    inventory: source.inventory,
    profiles,
    moduleCatalog: source.moduleCatalog,
    surface: 'claude-profile',
  });
  assert.strictEqual(migration.ok, false);
  assert.strictEqual(migration.error.code, 'LEGACY_PROFILE_UPDATE_BLOCKED');
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
  assert.deepStrictEqual(Object.keys(profiles.legacy_profiles).sort(), ['compat-v1', 'full', 'minimal']);
  const common = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog });
  assert.strictEqual(common.ok, true, common.error && common.error.message);
  assert.strictEqual(common.value.profileId, 'common');
  assert.deepStrictEqual(common.value.selectedStableIds, profiles.profiles.common.skillIds);
  for (const id of ['minimal', 'full', 'compat-v1']) {
    const result = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog, profileId: id });
    assert.strictEqual(result.ok, false, `${id} is retained for historical reads only`);
    assert.strictEqual(result.error.code, 'UNKNOWN_PROFILE');
  }
});

test('checked-in common collection is the curated fifteen-entry default', () => {
  const root = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests/distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests/install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests/module-catalog.json'), 'utf8'));
  const expected = [
    'flow-guide', 'code-trace', 'change-verdict', 'flow-drive', 'git-smart-commit',
    'release-creator', 'tdd', 'create-pr', 'git-worktree', 'proposal-analyze',
    'update-docs', 'precommit', 'dep-audit', 'repo-verify', 'ui-ux-verify',
  ];
  const result = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.value.profileId, 'common');
  assert.deepStrictEqual(result.value.selectedStableIds, expected);
  assert.strictEqual(result.value.selectedStableIds.length, 15);
  assert.deepStrictEqual(result.value.supportClosure.skillStableIds, []);
  assert.ok(result.value.supportClosure.files.every((file) => expected.includes(file.requiredBy)));
});

test('common collection cannot drop a required core skill', () => {
  const root = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests/distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests/install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests/module-catalog.json'), 'utf8'));
  profiles.profiles.common.skillIds = profiles.profiles.common.skillIds.filter((id) => id !== 'flow-drive');
  const result = selection.resolveCapabilitySelection({ inventory, profiles, moduleCatalog });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'PROFILE_CORE_MISMATCH');
  assert.ok(result.error.message.includes('required_core_ids'));
});

// RED contract for issue #534 P2.  A renamed public name may improve the
// rejection diagnostic, but it must never become a selection alias or invoke
// the replacement family automatically; stable-ID selection remains intact.
test('renamed public names fail with diagnostics while canonical stable IDs still select', () => {
  const root = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests/distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests/install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests/module-catalog.json'), 'utf8'));

  const renamed = selection.resolveCapabilitySelection({
    inventory,
    profiles,
    moduleCatalog,
    surface: 'claude-profile',
    standaloneSkillIds: ['dhpk-laravel'],
  });
  assert.strictEqual(renamed.ok, false);
  assert.strictEqual(renamed.error.code, 'RENAMED_STABLE_ID');
  assert.deepStrictEqual(renamed.error.stableIds, ['dhpk-laravel']);
  assert.strictEqual(renamed.value, undefined);

  const canonical = selection.resolveCapabilitySelection({
    inventory,
    profiles,
    moduleCatalog,
    surface: 'claude-profile',
    standaloneSkillIds: ['laravel'],
  });
  assert.strictEqual(canonical.ok, true, canonical.error && canonical.error.message);
  assert.deepStrictEqual(canonical.value.selectedStableIds, ['laravel']);
});

// Consolidated source cases from capability-bundle-activation.test.js.
test('staging is observable separately and a required non-pass leaves the active root unchanged', () => {
  const root = tempRoot();
  try {
    const publishRoot = path.join(root, 'active');
    const store = new ProjectionArtifactStore({ root, publishRoot });
    const initial = store.begin(plan('old'));
    initial.write({ stableId: 'manifest', destination: 'manifest.json', content: '{"profile":"compat-v1"}\n' });
    initial.publish();
    const before = fs.readFileSync(path.join(publishRoot, 'manifest.json'));

    const candidate = store.begin(plan('new'));
    candidate.write({ stableId: 'manifest', destination: 'manifest.json', content: '{"profile":"minimal"}\n' });
    const staged = candidate.stage();
    assert.ok(staged.artifactFingerprint);
    const blocked = activateStagedCandidate({
      session: candidate,
      requiredRuntimeSurfaces: ['claude-core'],
      evidence: [{ surface: 'claude-core', verdict: 'UNAVAILABLE' }],
    });
    assert.strictEqual(blocked.ok, false);
    assert.deepStrictEqual(fs.readFileSync(path.join(publishRoot, 'manifest.json')), before);
    assert.strictEqual(fs.existsSync(path.join(publishRoot, 'manifest.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a required PASS is the only path that activates a staged candidate', () => {
  const root = tempRoot();
  try {
    const publishRoot = path.join(root, 'active');
    const store = new ProjectionArtifactStore({ root, publishRoot });
    const candidate = store.begin(plan('pass'));
    candidate.write({ stableId: 'manifest', destination: 'manifest.json', content: '{"profile":"minimal"}\n' });
    candidate.stage();
    const activated = activateStagedCandidate({
      session: candidate,
      requiredRuntimeSurfaces: ['claude-core'],
      evidence: [{ surface: 'claude-core', verdict: 'PASS' }],
    });
    assert.strictEqual(activated.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(publishRoot, 'manifest.json'), 'utf8'), '{"profile":"minimal"}\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run();

module.exports = { CORE_IDS, fixture };
