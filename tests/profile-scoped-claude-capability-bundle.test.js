'use strict';

// RED for the Claude common capability bundle.
//
// The first two tests cover the unscoped Claude generator contract and release
// version normalization. The remaining tests exercise the compiler-owned
// profile selector and pre-discovery bundle seam through public compiler and
// projection boundaries.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const bundleApi = require('../scripts/lib/claude-capability-bundle');
const inventoryApi = require('../scripts/lib/distribution-inventory');
const contextBudget = require('../scripts/ci/context-budget');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');

const ROOT = path.join(__dirname, '..');
const RELEASE_VERSION_SENTINEL = '<release-version>';

function normalizeReleaseVersion(pluginBytes) {
  const text = Buffer.from(pluginBytes).toString('utf8');
  const plugin = JSON.parse(text);
  assert.match(
    plugin.version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    `manifest version must be valid semver, got '${plugin.version}'`,
  );
  const escapedVersion = JSON.stringify(plugin.version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionEntry = new RegExp(`("version"\\s*:\\s*)${escapedVersion}`, 'g');
  assert.strictEqual(
    (text.match(versionEntry) || []).length,
    1,
    'manifest must contain exactly one version entry in the source bytes',
  );
  return Buffer.from(text.replace(versionEntry, `$1${JSON.stringify(RELEASE_VERSION_SENTINEL)}`), 'utf8');
}

function normalizedManifestFingerprint(pluginBytes) {
  const normalized = normalizeReleaseVersion(pluginBytes);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function profileFixture() {
  return {
    inventory: {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [
        {
          id: 'core-review',
          name: 'dhpk-core-review',
          path: 'skills/core-review',
          capability_id: 'dhpk.skill.core-review',
          lifecycle: 'promoted',
          tier: 'core',
          profiles: ['core'],
          surfaces: ['claude-core'],
        },
        {
          id: 'php-runtime',
          name: 'dhpk-php-runtime',
          path: 'skills/php-runtime',
          capability_id: 'dhpk.skill.php-runtime',
          lifecycle: 'optional',
          tier: 'optional',
          profiles: ['php-5.6'],
          surfaces: ['claude-module'],
        },
        {
          id: 'yii-guidance',
          name: 'dhpk-yii-guidance',
          path: 'skills/yii-guidance',
          capability_id: 'dhpk.skill.yii-guidance',
          lifecycle: 'optional',
          tier: 'optional',
          profiles: ['yii-1.1'],
          surfaces: ['claude-module'],
        },
        {
          id: 'js-guidance',
          name: 'dhpk-js-guidance',
          path: 'skills/js-guidance',
          capability_id: 'dhpk.skill.js-guidance',
          lifecycle: 'optional',
          tier: 'optional',
          profiles: ['js'],
          surfaces: ['claude-module'],
        },
        {
          id: 'deprecated-guidance',
          name: 'dhpk-deprecated-guidance',
          path: 'skills/deprecated-guidance',
          capability_id: 'dhpk.skill.deprecated-guidance',
          lifecycle: 'deprecated',
          tier: 'optional',
          profiles: ['php-5.6'],
          surfaces: ['claude-module'],
        },
      ],
      modules: [
        { id: 'php-5.6', path: 'modules/php-5.6', lifecycle: 'optional', surfaces: ['claude-module'] },
        { id: 'yii-1.1', path: 'modules/yii-1.1', lifecycle: 'optional', surfaces: ['claude-module'] },
        { id: 'js', path: 'modules/js', lifecycle: 'optional', surfaces: ['claude-module'] },
      ],
    },
    installProfiles: {
      profiles: {
        minimal: { modules: [] },
        'php-yii': { modules: ['yii-1.1'] },
        'js-only': { modules: ['js'] },
        conflicting: { modules: ['php-5.6'], excludes: { 'php-5.6': 'fixture conflict' } },
        'missing-module': { modules: ['does-not-exist'] },
        cyclic: { modules: ['cycle-a'] },
      },
    },
    moduleCatalog: {
      stacks: [
        {
          id: 'php',
          versions: [{ id: '5.6', module: 'php-5.6' }],
        },
        {
          id: 'yii',
          versions: [{ id: '1.1', module: 'yii-1.1', requires_module: 'php-5.6' }],
        },
        {
          id: 'js',
          versions: [{ id: '0.1', module: 'js' }],
        },
        {
          id: 'cycles',
          versions: [
            { id: 'a', module: 'cycle-a', requires_module: 'cycle-b' },
            { id: 'b', module: 'cycle-b', requires_module: 'cycle-a' },
          ],
        },
      ],
    },
  };
}

function resolveProfile(input) {
  assert.strictEqual(
    typeof bundleApi.resolveClaudeProfile,
    'function',
    'Claude bundle selector must expose resolveClaudeProfile(input)',
  );
  return bundleApi.resolveClaudeProfile(input);
}

function makeFixtureRoot(fixture) {
  const tempRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-claude-profile-'));
  fs.mkdirSync(path.join(tempRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'dhpk',
    version: '0.43.0',
    skills: ['./skills/'],
  }, null, 2) + '\n');
  for (const skill of fixture.inventory.skills) {
    const skillRoot = path.join(tempRoot, skill.path);
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), [
      '---',
      `name: ${skill.name}`,
      'description: Fixture capability for profile selection.',
      '---',
      '',
      `# ${skill.name}`,
      '',
    ].join('\n'));
  }
  return tempRoot;
}

function compileProfile(fixture, profileId, root) {
  assert.strictEqual(
    typeof bundleApi.compileClaudeCapabilityBundle,
    'function',
    'Claude bundle compiler must expose compileClaudeCapabilityBundle(input)',
  );
  return bundleApi.compileClaudeCapabilityBundle({
    root,
    inventory: fixture.inventory,
    profileId,
    profiles: fixture.installProfiles,
    moduleCatalog: fixture.moduleCatalog,
  });
}

function compileStandalone(fixture, root, standaloneSkillIds) {
  return bundleApi.compileClaudeCapabilityBundle({
    root,
    inventory: fixture.inventory,
    profiles: fixture.installProfiles,
    moduleCatalog: fixture.moduleCatalog,
    standaloneSkillIds,
  });
}

test('characterizes the current unscoped Claude manifest and CLI outcome', () => {
  const pluginPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const check = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'gen-claude-manifest.js'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const summary = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'gen-claude-manifest.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.deepStrictEqual(plugin.skills, ['./skills/']);
  assert.strictEqual(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.strictEqual(
    check.stdout,
    'PASS [gen-claude-manifest]: plugin.json skills[] (1 roots) matches the inventory-derived root set.\n',
  );
  assert.strictEqual(summary.status, 0, `${summary.stdout}\n${summary.stderr}`);
  assert.match(summary.stdout, /dhpk Claude publication surface/);
  assert.match(summary.stdout, /roots:\s+1/);
  const compiled = inventoryApi.compileClaudeProjection({ inventory });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.generated.roots, ['./skills/']);
  for (const id of JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8')).profiles.common.skillIds) {
    assert.ok(compiled.generated.generatedSkillIds.includes(id), `Claude root must expose common skill ${id}`);
  }
  assert.strictEqual(compiled.plan.surface, 'claude-core');
});

test('compatibility fingerprint ignores only release version changes', () => {
  const manifest = (version, description = 'fixture manifest') => Buffer.from(JSON.stringify({
    name: 'dhpk',
    version,
    description,
  }, null, 2) + '\n');
  const current = manifest('0.46.0');
  const next = manifest('1.0.0-rc.1');
  const drifted = manifest('1.0.0-rc.1', 'fixture manifest changed');

  assert.strictEqual(
    normalizedManifestFingerprint(current),
    normalizedManifestFingerprint(next),
    'release version changes must not invalidate the compatibility fingerprint',
  );
  assert.notStrictEqual(
    normalizedManifestFingerprint(next),
    normalizedManifestFingerprint(drifted),
    'non-version manifest drift must invalidate the compatibility fingerprint',
  );
});

test('characterizes SessionStart as post-discovery runtime activation only', () => {
  const sessionStart = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'session-start.sh'), 'utf8');
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

  assert.deepStrictEqual(plugin.skills, ['./skills/']);
  assert.match(sessionStart, /DHPK_ACTIVE_MODULES/);
  assert.doesNotMatch(sessionStart, /plugin\.json|skills\[|generatedSkillIds|discovery.*filter/i);
  assert.ok(sessionStart.indexOf('load-project-config.sh') < sessionStart.indexOf('activate-modules.py'));
});

test('characterizes common and retained language preset closures before generation', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));
  for (const profileId of ['common', 'legacy-php-yii', 'php-only', 'js-only']) {
    const result = bundleApi.resolveClaudeProfile({ profileId, inventory, profiles, moduleCatalog });
    assert.strictEqual(result.ok, true, `${profileId}: ${result.error && result.error.message}`);
    assert.ok(result.value.profileFingerprint);
    assert.ok(result.value.inputFingerprint);
  }
});

test('unscoped Claude resolution defaults to common and does not expose legacy profiles', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));
  const result = bundleApi.resolveClaudeProfile({ inventory, profiles, moduleCatalog });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.value.profileId, 'common');
  assert.deepStrictEqual(result.value.selectedStableIds, profiles.profiles.common.skillIds);
  for (const profileId of ['minimal', 'full', 'compat-v1']) {
    const legacy = bundleApi.resolveClaudeProfile({ profileId, inventory, profiles, moduleCatalog });
    assert.strictEqual(legacy.ok, false, `${profileId} is not an active Claude selection`);
    assert.strictEqual(legacy.error.code, 'UNKNOWN_PROFILE');
  }
});

test('compiler resolves a profile module dependency closure and selects only its stable IDs', () => {
  const fixture = profileFixture();
  const result = resolveProfile({
    profileId: 'php-yii',
    inventory: fixture.inventory,
    profiles: fixture.installProfiles,
    moduleCatalog: fixture.moduleCatalog,
  });

  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.value.profileId, 'php-yii');
  assert.deepStrictEqual(result.value.moduleClosure, ['php-5.6', 'yii-1.1']);
  assert.deepStrictEqual(result.value.selectedStableIds, ['core-review', 'php-runtime', 'yii-guidance']);
  assert.deepStrictEqual(result.value.excludedStableIds, ['js-guidance']);
});

test('standalone Claude bundle emits only the requested skill and its package-local closure', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  try {
    const selectedRoot = path.join(root, 'skills', 'php-runtime');
    fs.mkdirSync(path.join(selectedRoot, 'references'), { recursive: true });
    fs.writeFileSync(path.join(selectedRoot, 'references', 'runtime.md'), 'runtime reference\n');
    const unselectedRoot = path.join(root, 'skills', 'yii-guidance');
    fs.mkdirSync(path.join(unselectedRoot, 'references'), { recursive: true });
    fs.writeFileSync(path.join(unselectedRoot, 'references', 'unselected.md'), 'must not be discovered\n');

    const compiled = compileStandalone(fixture, root, ['dhpk-php-runtime', 'php-runtime']);
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    assert.strictEqual(compiled.value.selection.selectionMode, 'standalone');
    assert.strictEqual(compiled.value.selection.profileId, null);
    assert.deepStrictEqual(compiled.value.selection.requestedStableIds, ['php-runtime']);
    const destinations = compiled.value.outputs.map((entry) => entry.destination);
    assert.ok(destinations.includes('skills/php-runtime/SKILL.md'));
    assert.ok(destinations.includes('skills/php-runtime/references/runtime.md'));
    assert.ok(!destinations.some((destination) => destination.includes('yii-guidance')));
    assert.ok(!destinations.some((destination) => destination.includes('unselected.md')));
    assert.strictEqual(compiled.value.plan.profile.selectionMode, 'standalone');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compiler rejects unknown profiles and does not fall back to ambient or unscoped membership', () => {
  const fixture = profileFixture();
  const result = resolveProfile({
    profileId: 'not-a-profile',
    inventory: fixture.inventory,
    profiles: fixture.installProfiles,
    moduleCatalog: fixture.moduleCatalog,
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.error.message, /unknown profile/i);
});

test('compiler rejects inherited and unsafe profile aliases', () => {
  const fixture = profileFixture();
  const inherited = resolveProfile({
    profileId: 'constructor', inventory: fixture.inventory, profiles: fixture.installProfiles, moduleCatalog: fixture.moduleCatalog,
  });
  assert.strictEqual(inherited.ok, false);
  const unsafe = resolveProfile({
    profileId: '../escape', inventory: fixture.inventory, profiles: fixture.installProfiles, moduleCatalog: fixture.moduleCatalog,
  });
  assert.strictEqual(unsafe.ok, false);
});

function assertProfileRejected(profileId, pattern) {
  const fixture = profileFixture();
  const result = resolveProfile({
    profileId,
    inventory: fixture.inventory,
    profiles: fixture.installProfiles,
    moduleCatalog: fixture.moduleCatalog,
  });
  assert.strictEqual(result.ok, false, `${profileId} must fail closed`);
  assert.match(result.error.message, pattern, `${profileId} error must identify the policy failure`);
}

test('compiler rejects a profile that names a missing module', () => {
  assertProfileRejected('missing-module', /module/i);
});

test('compiler rejects a cyclic module requirement', () => {
  assertProfileRejected('cyclic', /cycle|module/i);
});

test('compiler rejects a profile that conflicts with its exclusion map', () => {
  assertProfileRejected('conflicting', /conflict|exclude|module/i);
});

test('compiler rejects duplicate inventory stable IDs', () => {
  const duplicateInventory = profileFixture();
  duplicateInventory.inventory.skills.push({ ...duplicateInventory.inventory.skills[0] });
  const duplicate = resolveProfile({
    profileId: 'minimal',
    inventory: duplicateInventory.inventory,
    profiles: duplicateInventory.installProfiles,
    moduleCatalog: duplicateInventory.moduleCatalog,
  });
  assert.strictEqual(duplicate.ok, false, 'duplicate stable IDs must fail closed');
  assert.match(duplicate.error.message, /duplicate|stable.?id/i);
});

test('bundle compiler rejects inventory skill paths that escape the source root', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  try {
    fixture.inventory.skills[0] = { ...fixture.inventory.skills[0], path: '../outside' };
    const result = compileProfile(fixture, 'minimal', root);
    assert.strictEqual(result.ok, false);
    assert.match(result.error.message, /unsafe|source|path/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bundle compiler rejects a symlinked Claude manifest', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  const outside = path.join(require('node:os').tmpdir(), `dhpk-outside-plugin-${process.pid}.json`);
  try {
    fs.writeFileSync(outside, JSON.stringify({ name: 'outside' }) + '\n');
    fs.unlinkSync(path.join(root, '.claude-plugin', 'plugin.json'));
    fs.symlinkSync(outside, path.join(root, '.claude-plugin', 'plugin.json'));
    const result = compileProfile(fixture, 'minimal', root);
    assert.strictEqual(result.ok, false);
    assert.match(result.error.message, /unsafe|symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('profile compilation has explicit plan identity and is deterministic for equivalent normalized inputs', () => {
  const fixture = profileFixture();
  const reordered = profileFixture();
  reordered.inventory.skills.reverse();
  reordered.installProfiles.profiles['php-yii'].modules.reverse();
  const firstRoot = makeFixtureRoot(fixture);
  const secondRoot = makeFixtureRoot(reordered);

  try {
    const first = compileProfile(fixture, 'php-yii', firstRoot);
    const second = compileProfile(reordered, 'php-yii', secondRoot);
    assert.strictEqual(first.ok, true, first.error && first.error.message);
    assert.strictEqual(second.ok, true, second.error && second.error.message);
    assert.strictEqual(first.value.plan.planFingerprint, second.value.plan.planFingerprint);
    assert.strictEqual(first.value.plan.surface, 'claude-profile');
    assert.strictEqual(first.value.plan.profile.id, 'php-yii');
    assert.deepStrictEqual(first.value.plan.profile.modules, ['php-5.6', 'yii-1.1']);
    assert.ok(Array.isArray(first.value.plan.selectedStableIds));
    assert.ok(first.value.plan.selectionPolicy && first.value.plan.selectionPolicy.version);
    assert.ok(first.value.plan.inventoryFingerprint);
    assert.ok(first.value.plan.entries.some((entry) => entry.sourceFingerprint));
    assert.ok(first.value.plan.compatibilityMode);
  } finally {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test('Claude profile adapter preserves the ./skills/ manifest shape and excludes unselected optional skills', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  try {
    const compiled = compileProfile(fixture, 'minimal', root);
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    const adapter = bundleApi.createClaudeCapabilityBundleAdapter({ root, compiled: compiled.value });
    const rendered = adapter.render(compiled.value.plan);
    const manifest = (rendered.outputs || []).find((entry) => entry.destination === 'plugin.json');
    assert.ok(manifest, 'profile bundle must render a Claude plugin manifest');
    const manifestJson = JSON.parse(Buffer.from(manifest.content).toString('utf8'));
    assert.deepStrictEqual(manifestJson.skills, ['./skills/']);

    const outputIds = (rendered.outputs || []).map((entry) => entry.stableId);
    assert.ok(outputIds.includes('claude-profile:skill:core-review'), 'promoted core must be in every profile bundle');
    assert.ok(!outputIds.includes('claude-profile:skill:php-runtime'), 'unselected PHP skill must not enter minimal bundle');
    assert.ok(!outputIds.includes('claude-profile:skill:yii-guidance'), 'unselected Yii skill must not enter minimal bundle');
    assert.ok(!outputIds.includes('claude-profile:skill:js-guidance'), 'unselected JS skill must not enter minimal bundle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile compilation reports optional capabilities as unavailable instead of silently remapping them', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  try {
    const compiled = compileProfile(fixture, 'minimal', root);
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    assert.deepStrictEqual(compiled.value.selection.unavailableOptionalIds, ['js-guidance', 'php-runtime', 'yii-guidance']);
    assert.notStrictEqual(compiled.value.selection.selectedStableIds.includes('js-guidance'), true);
    assert.notStrictEqual(compiled.value.selection.selectedStableIds.includes('php-runtime'), true);
    assert.notStrictEqual(compiled.value.selection.selectedStableIds.includes('yii-guidance'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('context-budget distinguishes a selected Claude profile bundle from the compatibility catalog', () => {
  const fixture = profileFixture();
  const report = contextBudget.inspectDiscoveryContext({
    root: ROOT,
    inventory: fixture.inventory,
    profileId: 'minimal',
    selectedStableIds: ['core-review'],
  });

  assert.strictEqual(report.scope, 'claude-profile');
  assert.strictEqual(report.profileId, 'minimal');
  assert.strictEqual(report.totals.entries, 1);
  assert.strictEqual(report.totals.discoveryVisible, 1);
  assert.ok(report.compatibilityCatalog);
  assert.strictEqual(report.compatibilityCatalog.totals.entries, 5);
  assert.notStrictEqual(report.totals.entries, report.compatibilityCatalog.totals.entries);
});

test('profile materialization uses the artifact store and publishes only planned skill files', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  const publishRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-claude-profile-publish-'));
  try {
    const compiled = compileProfile(fixture, 'minimal', root);
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    const artifact = bundleApi.materializeClaudeCapabilityBundle({
      compiled: compiled.value,
      artifactStore: new ProjectionArtifactStore({ root: publishRoot, sourceRoot: root, publishRoot: path.join(publishRoot, 'package') }),
      root,
    });
    assert.strictEqual(artifact.ok, true, artifact.error && artifact.error.message);
    assert.strictEqual(artifact.value.planFingerprint, compiled.value.plan.planFingerprint);
    const packageRoot = path.join(publishRoot, 'package');
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'plugin.json'), 'utf8'));
    assert.deepStrictEqual(manifest.skills, ['./skills/']);
    assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'core-review', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(packageRoot, 'skills', 'php-runtime', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(packageRoot, 'bundle-receipt.json')));
    const structural = bundleApi.verifyClaudeCapabilityBundle(
      'structural',
      artifact.value,
      bundleApi.createClaudeCapabilityBundleAdapter({ root, compiled: compiled.value }),
    );
    assert.strictEqual(structural.ok, true, structural.error && structural.error.message);
    assert.strictEqual(structural.value.verdict, 'PASS');
    assert.strictEqual(structural.value.planFingerprint, artifact.value.planFingerprint);
    const runtime = bundleApi.verifyClaudeCapabilityBundle(
      'consumer-runtime',
      artifact.value,
      bundleApi.createClaudeCapabilityBundleAdapter({ root, compiled: compiled.value }),
    );
    assert.strictEqual(runtime.ok, true, runtime.error && runtime.error.message);
    assert.strictEqual(runtime.value.verdict, 'NOT_CONFIGURED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(publishRoot, { recursive: true, force: true });
  }
});

// v1 GREEN contract (tests above): unscoped Claude manifest characterization,
// profile compiler fixtures, artifact-store materialization.
// Required core remains a four-skill invariant; the common collection is a
// separate fifteen-entry default.

test('required_core remains the four public workflow capabilities', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const core = inventory.profile_policy.required_core_ids;
  assert.ok(Array.isArray(core), 'profile_policy.required_core_ids must be an array');
  assert.deepStrictEqual(core, ['change-verdict', 'code-trace', 'flow-drive', 'flow-guide']);
});

test('common Claude selection includes retained command-owning skills', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));
  const result = bundleApi.compileClaudeCapabilityBundle({
    root: ROOT,
    inventory,
    profiles,
    moduleCatalog,
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.value.selection.profileId, 'common');
  assert.deepStrictEqual(result.value.selection.selectedStableIds, profiles.profiles.common.skillIds);
  assert.deepStrictEqual(result.value.plan.selectedStableIds, profiles.profiles.common.skillIds.slice().sort());
  assert.deepStrictEqual(result.value.plan.profile.supportClosure, result.value.selection.supportClosure);
  assert.ok(result.value.selection.selectedStableIds.includes('git-smart-commit'));
  assert.ok(result.value.selection.selectedStableIds.includes('repo-verify'));
});

// BEGIN lexical source block: tests/gen-claude-profile-bundles.test.js
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  test('profile bundle generator previews the common collection by default', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-common-plan-output-'));
    try {
      const absentOutput = path.join(temporary, 'must-not-be-created');
      const result = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--plan', '--out', absentOutput,
      ], { cwd: ROOT, encoding: 'utf8' });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.profile.id, 'common');
      assert.strictEqual(payload.profile.profileId, 'common');
      assert.match(payload.planFingerprint, /^[a-f0-9]{64}$/);
      assert.deepStrictEqual(payload.selectedStableIds, JSON.parse(fs.readFileSync(
        path.join(ROOT, 'manifests/install-profiles.json'), 'utf8',
      )).profiles.common.skillIds.slice().sort());
      assert.ok(!fs.existsSync(absentOutput), '--plan must not create its requested output directory');
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('profile bundle generator rejects the retired profile selector flag', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-retired-profile-output-'));
    try {
      for (const profileId of ['common', 'minimal', 'full', 'compat-v1']) {
        const output = path.join(temporary, profileId);
        const result = spawnSync(process.execPath, [
          path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'),
          '--profile', profileId, '--out', output,
        ], { cwd: ROOT, encoding: 'utf8' });
        assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, /--profile is retired/);
        assert.ok(!fs.existsSync(output), `${profileId} must not materialize a bundle`);
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('common generator does not materialize without an explicit output path', () => {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'),
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /--out is required/);
  });

  test('standalone generator still previews an isolated selection', () => {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--standalone', 'code-trace', '--plan',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.profile.id, 'standalone');
    assert.deepStrictEqual(payload.selectedStableIds, ['code-trace']);
    assert.strictEqual(payload.compatibilityMode, 'standalone');
  });

  test('common generator materializes only to the requested internal output path', () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-common-generator-'));
    try {
      const result = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--out', outputRoot,
      ], { cwd: ROOT, encoding: 'utf8' });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      const packageRoot = path.join(outputRoot, 'package');
      const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'plugin.json'), 'utf8'));
      assert.strictEqual(payload.profile, 'common');
      assert.deepStrictEqual(payload.selectedStableIds, JSON.parse(fs.readFileSync(
        path.join(ROOT, 'manifests/install-profiles.json'), 'utf8',
      )).profiles.common.skillIds.slice().sort());
      assert.deepStrictEqual(manifest.skills, ['./skills/']);
      assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'flow-guide', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'ui-ux-verify', 'SKILL.md')));
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  const GENERATOR = path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js');

  function runGenerator(args) {
    return spawnSync(process.execPath, [GENERATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
  }

  function withCommonCopy(mutate) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-profile-check-'));
    try {
      const generated = runGenerator(['--out', outputRoot]);
      assert.strictEqual(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
      mutate(path.join(outputRoot, 'package'));
      return runGenerator(['--check', '--out', outputRoot]);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  }

  test('--check passes for an explicitly materialized common bundle', () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-common-check-'));
    try {
      const generated = runGenerator(['--out', outputRoot]);
      assert.strictEqual(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
      const result = runGenerator(['--check', '--out', outputRoot]);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /PASS \[gen-claude-profile-bundles\]/);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test('--check fails and names a stale skill copy', () => {
    const result = withCommonCopy((packageRoot) => {
      fs.appendFileSync(path.join(packageRoot, 'skills/flow-guide/SKILL.md'), '\nstale\n');
    });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /out of date/);
    assert.match(result.stderr, /changed: skills\/flow-guide\/SKILL\.md/);
  });

  test('--check fails on extra and missing files', () => {
    const result = withCommonCopy((packageRoot) => {
      fs.writeFileSync(path.join(packageRoot, 'skills/extra.md'), 'extra\n');
      fs.rmSync(path.join(packageRoot, 'skills/ui-ux-verify/SKILL.md'));
    });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /extra: skills\/extra\.md/);
    assert.match(result.stderr, /missing: skills\/ui-ux-verify\/SKILL\.md/);
  });

  test('--check fails when the baseline package is absent', () => {
    const outputRoot = path.join(os.tmpdir(), `dhpk-claude-profile-absent-${process.pid}`);
    const result = runGenerator(['--check', '--out', outputRoot]);
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /baseline package is missing/);
    assert.ok(!fs.existsSync(outputRoot));
  });

  test('--plan and --check are mutually exclusive', () => {
    const result = runGenerator(['--plan', '--check']);
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /mutually exclusive/);
  });
}
// END lexical source block: tests/gen-claude-profile-bundles.test.js

run('profile-scoped-claude-capability-bundle');
