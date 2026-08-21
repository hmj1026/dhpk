'use strict';

// RED for profile-scoped-claude-capability-bundle.
//
// The first two tests are characterization guards for the current unscoped
// Claude package.  The remaining tests describe the compiler-owned profile
// selector and the pre-discovery bundle seam.  They intentionally exercise
// public compiler/projection boundaries; no SessionStart state or directory
// scan is allowed to decide membership.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const bundleApi = require('../scripts/lib/claude-capability-bundle');
const inventoryApi = require('../scripts/lib/distribution-inventory');
const contextBudget = require('../scripts/ci/context-budget');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');
const { runClaudeProfileProbe } = require('../scripts/release/claude-profile-probe');

const ROOT = path.join(__dirname, '..');

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

test('characterizes the current unscoped Claude manifest and CLI outcome', () => {
  const pluginPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
  const pluginBytes = fs.readFileSync(pluginPath);
  const plugin = JSON.parse(pluginBytes.toString('utf8'));
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
  assert.strictEqual(
    summary.stdout,
    'dhpk Claude publication surface (generated from distribution inventory):\n'
      + '  roots:              1\n'
      + '  generated skill ids: 102 (excludes deprecated; host cannot hide within a shared root)\n',
  );
  assert.strictEqual(pluginBytes.length, 30206, 'compatibility manifest byte count drifted');
  assert.strictEqual(
    crypto.createHash('sha256').update(pluginBytes).digest('hex'),
    'bb6575b0aa43a9ee064a6d9a5fce33544e8410d304c4c636020f8758a5740094',
    'compatibility manifest bytes drifted',
  );

  const compiled = inventoryApi.compileClaudeProjection({ inventory });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.generated.roots, ['./skills/']);
  assert.strictEqual(compiled.generated.generatedSkillIds.length, 102);
  assert.strictEqual(compiled.plan.surface, 'claude-core');
});

test('characterizes SessionStart as post-discovery runtime activation only', () => {
  const sessionStart = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'session-start.sh'), 'utf8');
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

  assert.deepStrictEqual(plugin.skills, ['./skills/']);
  assert.match(sessionStart, /DHPK_ACTIVE_MODULES/);
  assert.doesNotMatch(sessionStart, /plugin\.json|skills\[|generatedSkillIds|discovery.*filter/i);
  assert.ok(sessionStart.indexOf('load-project-config.sh') < sessionStart.indexOf('activate-modules.py'));
});

test('characterizes every declared representative profile closure before generation', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));
  for (const profileId of ['minimal', 'legacy-php-yii', 'php-only', 'js-only', 'full']) {
    const result = bundleApi.resolveClaudeProfile({ profileId, inventory, profiles, moduleCatalog });
    assert.strictEqual(result.ok, true, `${profileId}: ${result.error && result.error.message}`);
    assert.ok(result.value.profileFingerprint);
    assert.ok(result.value.inputFingerprint);
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

test('profile probe binds a materialized package to the artifact-store fingerprint', () => {
  const fixture = profileFixture();
  const root = makeFixtureRoot(fixture);
  const publishRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-claude-profile-probe-'));
  try {
    const compiled = compileProfile(fixture, 'minimal', root);
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    const artifact = bundleApi.materializeClaudeCapabilityBundle({
      compiled: compiled.value,
      artifactStore: new ProjectionArtifactStore({ root: publishRoot, sourceRoot: root, publishRoot: path.join(publishRoot, 'package') }),
      root,
    });
    assert.strictEqual(artifact.ok, true, artifact.error && artifact.error.message);
    const packageRoot = path.join(publishRoot, 'package');
    let invocation = 0;
    const runner = () => {
      invocation += 1;
      return invocation === 1
        ? { status: 0, stdout: JSON.stringify({ plugins: [{ id: 'dhpk@dhpk-profile-minimal', installPath: packageRoot }] }) }
        : { status: 0, stdout: JSON.stringify({ installPath: packageRoot, secretPath: '/opt/dhpk/private', token: 'top-secret', skills: [] }) };
    };
    const result = runClaudeProfileProbe({
      profileId: 'minimal',
      packageRoot,
      expectedPlanFingerprint: artifact.value.planFingerprint,
      expectedArtifactFingerprint: artifact.value.artifactFingerprint,
      runner,
    });
    assert.strictEqual(result.status, 'PASS', result.reason);
    assert.strictEqual(result.artifactFingerprint, artifact.value.artifactFingerprint);
    assert.strictEqual(result.packageRoot, '<profile-package>');
    assert.doesNotMatch(JSON.stringify(result), /top-secret|\/opt\/dhpk/);

    fs.mkdirSync(path.join(packageRoot, 'skills', 'evil'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'skills', 'evil', 'SKILL.md'), 'unexpected\n');
    const contaminated = runClaudeProfileProbe({
      profileId: 'minimal',
      packageRoot,
      expectedPlanFingerprint: artifact.value.planFingerprint,
      expectedArtifactFingerprint: artifact.value.artifactFingerprint,
      runner,
    });
    assert.strictEqual(contaminated.status, 'FAIL');
    assert.match(contaminated.reason, /outside|ledger/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(publishRoot, { recursive: true, force: true });
  }
});

test('Claude profile probe stays non-pass when the configured executable is unavailable', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-claude-profile-probe-missing-'));
  try {
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'dhpk' }) + '\n');
    fs.writeFileSync(path.join(root, 'bundle-receipt.json'), JSON.stringify({
      schema: 'dhpk.claude-capability-bundle.v1',
      profile: { id: 'minimal' },
      consumerPluginId: 'dhpk@dhpk-profile-minimal',
      selectedStableIds: [],
      planFingerprint: 'plan',
      outputs: [
        { stableId: 'claude-profile:manifest', destination: 'plugin.json' },
        { stableId: 'claude-profile:receipt', destination: 'bundle-receipt.json' },
      ],
    }) + '\n');
    const result = runClaudeProfileProbe({
      profileId: 'minimal',
      packageRoot: root,
      runner: () => ({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }), status: null }),
    });
    assert.strictEqual(result.status, 'NOT_CONFIGURED');
    assert.match(result.resumeCommand, /plugin details/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('profile-scoped-claude-capability-bundle');
