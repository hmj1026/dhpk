'use strict';

// Phase 4 characterization: reproduce GitHub issue #88's exact failure shape as
// static, pre-install checks: a parent-relative manifest `skills` field (the marketplace
// wrapper's actual bug — `plugins/dhpk/.codex-plugin/plugin.json` resolves
// `../../codex/skills/`, escaping its own package directory) and a same-directory
// field whose package tree still contains a symlink (the native manifest's actual
// bug — `codex/skills/*` symlinks back to `../../skills/<name>`, which a clean
// marketplace cache install does not preserve). Both must be rejected BEFORE a
// candidate is ever staged for install, distinguishing static/repo-local manifest
// resolution (these checks) from installed-cache materialization proof (task 3.3).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, run, assert } = require('./_lib/tinytest');
const {
  validateNativeCandidate,
  validateNativeMembership,
  verifyNativePackage,
} = require('../scripts/lib/codex-native-package');
const { compileMarketplacePublicationView } = require('../scripts/lib/marketplace-selection');

function makeTempPackage() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-native-candidate-'));
  fs.mkdirSync(path.join(dir, 'skills', 'hello-skill'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'hello-skill', 'SKILL.md'), '---\nname: hello-skill\n---\n');
  return dir;
}

test('rejects a parent-relative manifest skills field (the wrapper bug: ../../codex/skills/)', () => {
  const dir = makeTempPackage();
  try {
    const result = validateNativeCandidate({ manifestSkillsField: '../../codex/skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /parent-relative/i.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an absolute manifest skills field escaping the package root', () => {
  const dir = makeTempPackage();
  try {
    const result = validateNativeCandidate({ manifestSkillsField: '/etc/skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /escapes|parent-relative|absolute/i.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a same-directory candidate that still contains a symlink (the native mirror bug)', () => {
  const dir = makeTempPackage();
  try {
    // Reproduce the real bug shape: a skill entry that is a symlink back out of
    // the package, exactly like codex/skills/tdd-workflow -> ../../skills/tdd-workflow today.
    fs.mkdirSync(path.join(dir, 'canonical-elsewhere', 'tdd'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'canonical-elsewhere', 'tdd', 'SKILL.md'), '---\nname: tdd\n---\n');
    fs.symlinkSync(path.join('..', '..', 'canonical-elsewhere', 'tdd'), path.join(dir, 'skills', 'tdd-workflow'));

    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /symlink/i.test(e) && /tdd/.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a symlinked skills root even when its lexical path is inside the package', () => {
  const dir = makeTempPackage();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-outside-skills-'));
  try {
    fs.rmSync(path.join(dir, 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(outside, 'hello-skill'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'hello-skill', 'SKILL.md'), '---\nname: hello-skill\n---\n');
    fs.symlinkSync(outside, path.join(dir, 'skills'), 'dir');
    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => /skills.*symlink|realpath.*inside/i.test(e)), result.errors.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('accepts a same-directory candidate whose package tree is entirely physical files', () => {
  const dir = makeTempPackage();
  try {
    const result = validateNativeCandidate({ manifestSkillsField: './skills/', packageRoot: dir });
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.ok);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a candidate containing a promoted-but-non-native skill, naming the extra skill', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core'] },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['tdd-workflow', 'dhpk-skill-quality-judge'], inventory });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => /skill-judge/.test(e) && /not in the codex-native/i.test(e)), result.errors.join('\n'));
});

test('accepts an approved optional-lifecycle native exception alongside promoted native skills', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'php-pro', name: 'dhpk-php-runtime-router', path: 'skills/dhpk-php-runtime-router', lifecycle: 'optional', surfaces: ['claude-module', 'codex-native'] },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['tdd-workflow', 'dhpk-php-runtime-router'], inventory });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('rejects a candidate missing a codex-native skill that the inventory expects', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['tdd-workflow'], inventory });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => /skill-judge/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('excludes a deprecated codex-native skill from the expected membership set', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      {
        id: 'old-skill',
        name: 'dhpk-old-skill',
        path: 'skills/old-skill',
        lifecycle: 'deprecated',
        surfaces: ['claude-core', 'codex-native'],
        deprecation: { since: '2026-01-01', compatibilityWindowEnds: '2026-04-01', migrationNote: 'retired' },
      },
    ],
  };
  const result = validateNativeMembership({ candidateSkillNames: ['tdd-workflow'], inventory });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('native structural verification returns stage-bound evidence instead of a lifecycle aggregate', () => {
  const dir = makeTempPackage();
  try {
    const inventory = {
      skills: [{
        id: 'hello',
        name: 'hello-skill',
        path: 'skills/hello-skill',
        lifecycle: 'promoted',
        surfaces: ['codex-native'],
      }],
    };
    const result = verifyNativePackage({
      packageRoot: dir,
      inventory,
      stage: 'structural',
      observedAt: '2026-08-13T00:00:00.000Z',
    });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    assert.strictEqual(result.evidence.stage, 'structural');
    assert.strictEqual(result.evidence.verdict, 'PASS');
    assert.strictEqual(result.evidence.observedAt, '2026-08-13T00:00:00.000Z');
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'lifecycle'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Consolidated from tests/codex-native-activation.test.js; imports and helpers stay local.
{
  const { test, assert } = require('./_lib/tinytest');
  const { probeCodexNativeActivation, CODEX_NATIVE_PLUGIN_ID, normalizeActivationOverride } = require('../scripts/lib/codex-native-activation');

  function stub(result) {
    return () => result;
  }

  function captureProbeTimeout(options = {}) {
    let timeout;
    const result = probeCodexNativeActivation({
      spawn: (_cmd, _args, spawnOptions) => {
        timeout = spawnOptions.timeout;
        return { status: 0, stdout: JSON.stringify({ installed: [], available: [] }), stderr: '' };
      },
      ...options,
    });
    return { result, timeout };
  }

  test('codex missing from PATH reports NOT_INSTALLED', () => {
    const spawn = () => {
      const error = new Error('spawn codex ENOENT');
      error.code = 'ENOENT';
      return { error, status: null, pid: undefined };
    };
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'NOT_INSTALLED');
  });

  test('enabled native plugin reports ENABLED with version', () => {
    const spawn = stub({
      status: 0,
      stdout: JSON.stringify({ installed: [
        { pluginId: 'unrelated-plugin@marketplace', enabled: true, version: '9.9.9' },
        { pluginId: 'dhpk@dhpk', enabled: true, version: '0.57.0' },
      ], available: [] }),
      stderr: '',
    });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'ENABLED');
    assert.strictEqual(result.pluginId, 'dhpk@dhpk');
    assert.strictEqual(result.version, '0.57.0');
  });

  test('disabled native plugin reports DISABLED', () => {
    const spawn = stub({
      status: 0,
      stdout: JSON.stringify({ installed: [{ pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: false }], available: [] }),
      stderr: '',
    });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'DISABLED');
  });

  test('no matching plugin entry reports AVAILABLE', () => {
    const spawn = stub({ status: 0, stdout: JSON.stringify({ installed: [], available: [] }), stderr: '' });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'AVAILABLE');
  });

  test('non-zero exit reports UNAVAILABLE', () => {
    const spawn = stub({ status: 1, stdout: '', stderr: 'boom' });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'UNAVAILABLE');
  });

  test('timeout reports UNAVAILABLE', () => {
    const spawn = stub({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      pid: 4242,
    });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'UNAVAILABLE');
  });

  test('live probe waits 30 seconds by default so remote marketplace queries can finish', () => {
    const { result, timeout } = captureProbeTimeout({ env: {} });
    assert.strictEqual(result.status, 'AVAILABLE');
    assert.strictEqual(timeout, 30000);
  });

  test('DHPK_CODEX_PROBE_TIMEOUT_MS overrides the default live-probe budget', () => {
    const { result, timeout } = captureProbeTimeout({
      env: { DHPK_CODEX_PROBE_TIMEOUT_MS: '45000' },
    });
    assert.strictEqual(result.status, 'AVAILABLE');
    assert.strictEqual(timeout, 45000);
  });

  test('DHPK_CODEX_PROBE_TIMEOUT_SECONDS is accepted when the millisecond override is unset', () => {
    const { result, timeout } = captureProbeTimeout({
      env: { DHPK_CODEX_PROBE_TIMEOUT_SECONDS: '12' },
    });
    assert.strictEqual(result.status, 'AVAILABLE');
    assert.strictEqual(timeout, 12000);
  });

  test('an explicit timeoutMs option outranks the environment override', () => {
    const { timeout } = captureProbeTimeout({
      env: { DHPK_CODEX_PROBE_TIMEOUT_MS: '45000' },
      timeoutMs: 1200,
    });
    assert.strictEqual(timeout, 1200);
  });

  test('invalid probe timeout environment values keep the 30 second default', () => {
    const { timeout } = captureProbeTimeout({
      env: { DHPK_CODEX_PROBE_TIMEOUT_MS: 'nope', DHPK_CODEX_PROBE_TIMEOUT_SECONDS: '0' },
    });
    assert.strictEqual(timeout, 30000);
  });

  test('non-JSON stdout reports UNAVAILABLE', () => {
    const spawn = stub({ status: 0, stdout: 'not json', stderr: '' });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'UNAVAILABLE');
  });

  test('missing installed array reports UNAVAILABLE', () => {
    const spawn = stub({ status: 0, stdout: JSON.stringify({ available: [] }), stderr: '' });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'UNAVAILABLE');
  });

  test('non-boolean enabled field reports UNAVAILABLE', () => {
    const spawn = stub({
      status: 0,
      stdout: JSON.stringify({ installed: [{ pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: 'yes' }], available: [] }),
      stderr: '',
    });
    const result = probeCodexNativeActivation({ spawn });
    assert.strictEqual(result.status, 'UNAVAILABLE');
  });

  test('normalizeActivationOverride accepts auto/enabled/inactive and rejects anything else', () => {
    assert.strictEqual(normalizeActivationOverride('auto'), 'auto');
    assert.strictEqual(normalizeActivationOverride('enabled'), 'enabled');
    assert.strictEqual(normalizeActivationOverride('inactive'), 'inactive');
    assert.throws(() => normalizeActivationOverride('bogus'), /native-activation/);
  });
}

// Consolidated from tests/codex-native-experimental-gate.test.js; imports and helpers stay local.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { validateNativeCandidate, validateNativeMembership } = require('../scripts/lib/codex-native-package');

  const ROOT = path.join(__dirname, '..');

  function loadManifest(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  }

  test('the native .codex-plugin/plugin.json now passes native-candidate structural validation (physical tracked package, no symlinks)', () => {
    const manifest = loadManifest('.codex-plugin/plugin.json');
    const result = validateNativeCandidate({ manifestSkillsField: manifest.skills, packageRoot: ROOT });
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.ok);
  });

  test('the marketplace-target wrapper plugin.json now passes native-candidate structural validation (./skills/, no parent-relative escape)', () => {
    const manifest = loadManifest(path.join('plugins', 'dhpk', '.codex-plugin', 'plugin.json'));
    const packageRoot = path.join(ROOT, 'plugins', 'dhpk');
    const result = validateNativeCandidate({ manifestSkillsField: manifest.skills, packageRoot });
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.ok);
  });

  test('the tracked package contains the canonical common and Codex-only entries', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const selection = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'marketplace-selection.json'), 'utf8'));
    const publicationView = compileMarketplacePublicationView({ inventory, selection, hostSurface: 'codex-native' });
    const packageRoot = path.join(ROOT, 'plugins', 'dhpk');
    const candidateSkillNames = fs.readdirSync(path.join(packageRoot, 'skills'));
    const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8'));
    const expectedPublicIds = publicationView.publicEntries.map((entry) => entry.id).sort();
    const expectedHostOnlyIds = publicationView.hostOnly.map((entry) => entry.id).sort();
    const expectedIds = [...expectedPublicIds, ...expectedHostOnlyIds].sort();
    const expectedNames = [...publicationView.publicEntries, ...publicationView.hostOnly]
      .map((entry) => entry.name || entry.id).sort();
    const result = validateNativeMembership({ candidateSkillNames, inventory, publicationView });

    assert.deepStrictEqual(publicationView.errors, []);
    assert.strictEqual(expectedPublicIds.length, 15);
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.ok);
    assert.deepStrictEqual(candidateSkillNames.sort(), expectedNames);
    assert.deepStrictEqual(provenance.selectedSkillIds, expectedIds);
    assert.deepStrictEqual(provenance.marketplacePublication.publicEntryIds, expectedPublicIds);
    assert.deepStrictEqual(provenance.marketplacePublication.hostOnlyIds, expectedHostOnlyIds);
    assert.strictEqual(provenance.marketplacePublication.selectionDigest, publicationView.selectionDigest);
  });
}

// Consolidated from tests/codex-plugin-manifest.test.js; imports and helpers stay local.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { validateNativeCandidate } = require('../scripts/lib/codex-native-package');

  const ROOT = path.join(__dirname, '..');
  const resolve = (base, p) => path.join(base, p.replace(/^\.\//, ''));

  const claudePlugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
  const wrapperDir = path.join(ROOT, 'plugins', 'dhpk');
  const wrapperManifest = JSON.parse(fs.readFileSync(path.join(wrapperDir, '.codex-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8'));

  test('root .codex-plugin/plugin.json has a semver version', () => {
    assert.match(rootManifest.version, /^\d+\.\d+\.\d+$/, `version='${rootManifest.version}'`);
  });

  test('root .codex-plugin/plugin.json version matches .claude-plugin/plugin.json', () => {
    assert.strictEqual(rootManifest.version, claudePlugin.version);
  });

test('root .codex-plugin/plugin.json skills path resolves to an existing directory', () => {
  const result = validateNativeCandidate({ manifestSkillsField: rootManifest.skills, packageRoot: ROOT });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.ok(result.ok);
  assert.strictEqual(rootManifest.skills, './plugins/dhpk/skills/');
});

  test('thin wrapper plugin.json name/version match the root manifest', () => {
    assert.strictEqual(wrapperManifest.name, rootManifest.name);
    assert.strictEqual(wrapperManifest.version, rootManifest.version);
  });

  test('thin wrapper skills path resolves to the same directory as the root manifest', () => {
    const wrapperSkillsDir = resolve(wrapperDir, wrapperManifest.skills);
    const rootSkillsDir = resolve(ROOT, rootManifest.skills);
    assert.strictEqual(fs.realpathSync(wrapperSkillsDir), fs.realpathSync(rootSkillsDir));
  });

  test('marketplace.json plugin name/version match the marketplace-target wrapper manifest', () => {
    const entry = marketplace.plugins && marketplace.plugins[0];
    assert.ok(entry, 'marketplace.json has no plugins[0]');
    assert.strictEqual(entry.name, wrapperManifest.name);
    assert.strictEqual(entry.version, wrapperManifest.version);
  });

  test('marketplace.json source.path resolves exactly to the tracked plugins/dhpk wrapper', () => {
    const entry = marketplace.plugins[0];
    const sourcePath = fs.realpathSync(resolve(ROOT, entry.source.path));
    assert.strictEqual(
      sourcePath,
      fs.realpathSync(wrapperDir),
      'source.path must resolve exactly to the tracked codex-native publication artifact at plugins/dhpk',
    );
  });
}


// Consolidated from tests/gen-codex-native-package.test.js; imports and helpers stay local.
{

  // Coverage for scripts/ci/gen-codex-native-package.js and materializeNativePackage().
  // Verifies the generated candidate is entirely physical files, scoped to the
  // explicit codex-native inventory surface (not lifecycle=promoted), deterministic
  // across two runs, and carries a per-skill source fingerprint plus provenance.

  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const {
    compileNativePackage,
    materializeNativePackage,
    validateNativeCandidate,
    verifyNativePackage,
    fingerprintDir,
  } = require('../scripts/lib/codex-native-package');

  const ROOT = path.join(__dirname, '..');

  function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  }

  test('native compiler plan preserves explicit selection, public identity, and generated output intent', () => {
    const inventory = {
      skills: [
        { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
        { id: 'not-native', name: 'dhpk-not-native', path: 'skills/dhpk-not-native', lifecycle: 'promoted', surfaces: ['claude-core'] },
      ],
    };
    const out = tmpDir('dhpk-native-compile-');
    try {
      const projection = compileNativePackage({ inventory, root: ROOT, outDir: out, version: '1.2.3', sourceCommit: 'abc123' });
      assert.strictEqual(projection.plan.surface, 'codex-native');
      assert.deepStrictEqual(projection.selectedSkillIds, ['tdd']);
      assert.deepStrictEqual(projection.selectedSkillNames, ['tdd-workflow']);
      assert.deepStrictEqual(projection.provenance.routingProjection, projection.routingProjection);
      assert.strictEqual(projection.routingProjection.surface, 'codex-native');
      assert.ok(projection.plan.entries.some((entry) => entry.destination === 'skills/tdd-workflow/SKILL.md'));
      assert.ok(projection.plan.entries.some((entry) => entry.destination === '.codex-plugin/plugin.json'));
      assert.ok(!projection.plan.entries.some((entry) => entry.destination.includes('dhpk-not-native')));
      assert.ok(Object.isFrozen(projection.plan));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('native compiler materializes a non-invokable transport runtime without granting capability selection', () => {
    const inventory = {
      skills: [
        { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['codex-native'] },
        { id: 'cli-transport', name: 'dhpk-cli-transport', path: 'skills/dhpk-cli-transport', lifecycle: 'optional', invokable: false, surfaces: ['codex-native'] },
      ],
      internal_runtime_skills: { 'codex-native': ['cli-transport'] },
    };
    const out = tmpDir('dhpk-native-runtime-support-');
    try {
      const projection = compileNativePackage({ inventory, root: ROOT, outDir: out, version: '1.2.3', sourceCommit: 'abc123' });
      assert.deepStrictEqual(projection.selectedSkillIds, ['tdd']);
      assert.deepStrictEqual(projection.materializedSkillIds, ['cli-transport', 'tdd']);
      assert.deepStrictEqual(projection.provenance.selectedSkillIds, ['tdd']);
      assert.deepStrictEqual(projection.provenance.runtimeSupportStableIds, ['cli-transport']);
      assert.ok(projection.plan.entries.some((entry) => entry.destination === 'skills/dhpk-cli-transport/SKILL.md'));
      assert.ok(!projection.plan.selectedStableIds.includes('cli-transport'));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('generation without a marketplace manifest preserves legacy inventory-surface membership', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const tracked = path.join(ROOT, 'plugins', 'dhpk');
    const trackedManifest = JSON.parse(fs.readFileSync(path.join(tracked, '.codex-plugin', 'plugin.json'), 'utf8'));
    const trackedProvenance = JSON.parse(fs.readFileSync(path.join(tracked, 'provenance.json'), 'utf8'));
    const legacyRoot = tmpDir('dhpk-native-legacy-source-');
    const out = tmpDir('dhpk-native-byte-equivalence-');
    try {
      fs.mkdirSync(path.join(legacyRoot, 'manifests'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), path.join(legacyRoot, 'manifests', 'distribution-inventory.json'));
      fs.cpSync(path.join(ROOT, 'skills'), path.join(legacyRoot, 'skills'), { recursive: true });
      materializeNativePackage({
        inventory,
        root: legacyRoot,
        outDir: out,
        name: trackedManifest.name,
        version: trackedManifest.version,
        sourceCommit: trackedProvenance.sourceCommit,
      });
      const inventoryById = new Map(inventory.skills.map((entry) => [entry.id, entry]));
      const surfaceIds = inventory.skills.filter((entry) => entry.lifecycle !== 'deprecated'
        && Array.isArray(entry.surfaces) && entry.surfaces.includes('codex-native')).map((entry) => entry.id);
      const expectedIds = [...new Set([...surfaceIds, ...inventory.internal_runtime_skills['codex-native']])];
      const expectedNames = expectedIds.map((id) => inventoryById.get(id).name || id).sort();
      assert.deepStrictEqual(
        fs.readdirSync(path.join(out, 'skills')).sort(),
        expectedNames,
        'a source fixture without marketplace-selection.json must keep the inventory-surface root set',
      );
    } finally {
      fs.rmSync(legacyRoot, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('explicit Codex profile selection remains separate from the default catalog', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const out = tmpDir('dhpk-native-profile-');
    try {
      const requiredCoreIds = inventory.profile_policy.required_core_ids.slice().sort();
      const { resolveCapabilitySelection } = require('../scripts/lib/capability-bundle-selection');
      const resolved = resolveCapabilitySelection({
        inventory,
        profileId: 'minimal',
        profiles: { profiles: { minimal: { skillIds: requiredCoreIds, modules: [] } } },
      });
      assert.ok(resolved.ok, resolved.error && resolved.error.message);
      materializeNativePackage({
        inventory,
        root: ROOT,
        outDir: out,
        name: 'dhpk',
        version: '1.0.0',
        sourceCommit: 'a'.repeat(40),
        profileSelection: resolved.value,
      });
      const provenance = JSON.parse(fs.readFileSync(path.join(out, 'provenance.json'), 'utf8'));
      assert.strictEqual(Object.prototype.hasOwnProperty.call(provenance, 'marketplacePublication'), false);
      assert.strictEqual(provenance.profileId, 'minimal');
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
  });

  test('native materialization preserves executable source modes through the artifact store', () => {
    const root = tmpDir('dhpk-native-mode-source-');
    const out = tmpDir('dhpk-native-mode-output-');
    try {
      const skill = path.join(root, 'skills', 'dhpk-mode-skill');
      fs.mkdirSync(path.join(skill, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: dhpk-mode-skill\n---\n');
      const executable = path.join(skill, 'bin', 'run.sh');
      fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.chmodSync(executable, 0o755);
      materializeNativePackage({
        inventory: { skills: [{ id: 'mode', name: 'dhpk-mode-skill', path: 'skills/dhpk-mode-skill', surfaces: ['codex-native'] }] },
        root,
        outDir: out,
      });
      assert.strictEqual(fs.statSync(path.join(out, 'skills', 'dhpk-mode-skill', 'bin', 'run.sh')).mode & 0o777, 0o755);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('materialized candidate contains only the explicit codex-native surface, as real files — not every promoted skill', () => {
    const inventory = {
      skills: [
        { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
        { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core'] },
        { id: 'vue-2-notes', name: 'dhpk-vue-2-notes', path: 'skills/dhpk-vue-2-notes', lifecycle: 'optional', surfaces: ['claude-module'] },
      ],
    };
    const out = tmpDir('dhpk-native-materialize-');
    try {
      const result = materializeNativePackage({ inventory, root: ROOT, outDir: out });
      assert.deepStrictEqual(result.skillIds, ['tdd']);
      assert.ok(fs.existsSync(path.join(out, 'skills', 'tdd-workflow', 'SKILL.md')));
      // skill-judge is promoted but NOT codex-native — must be excluded.
      assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-skill-quality-judge')));
      assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-vue-2-notes')));
      const validation = validateNativeCandidate({ manifestSkillsField: result.manifestSkillsField, packageRoot: out });
      assert.deepStrictEqual(validation.errors, []);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('an approved optional-lifecycle native exception is included alongside promoted native skills', () => {
    const inventory = {
      skills: [
        { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
        { id: 'php-pro', name: 'dhpk-php-runtime-router', path: 'skills/dhpk-php-runtime-router', lifecycle: 'optional', surfaces: ['claude-module', 'codex-native'] },
      ],
    };
    const out = tmpDir('dhpk-native-optional-exception-');
    try {
      const result = materializeNativePackage({ inventory, root: ROOT, outDir: out });
      assert.deepStrictEqual(result.skillIds, ['php-pro', 'tdd']);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('materialized native packages use public names for directories, frontmatter, fingerprints, and provenance while retaining stable IDs', () => {
    const inventory = {
      skills: [{
        id: 'tdd',
        name: 'tdd-workflow',
        path: 'skills/tdd-workflow',
        lifecycle: 'promoted',
        surfaces: ['claude-core', 'codex-native'],
      }],
    };
    const out = tmpDir('dhpk-native-public-name-');
    try {
      const result = materializeNativePackage({ inventory, root: ROOT, outDir: out, version: '1.2.3', sourceCommit: 'abc123' });
      const publicDir = path.join(out, 'skills', 'tdd-workflow');
      assert.deepStrictEqual(result.skillIds, ['tdd']);
      assert.deepStrictEqual(result.skillNames, ['tdd-workflow']);
      assert.ok(fs.existsSync(path.join(publicDir, 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(out, 'skills', 'tdd')), 'stable IDs must not become native directory names');
      assert.match(fs.readFileSync(path.join(publicDir, 'SKILL.md'), 'utf8'), /^name:\s*tdd-workflow/m);
      assert.deepStrictEqual(Object.keys(result.fingerprints), ['tdd-workflow']);
      assert.deepStrictEqual(result.provenance.selectedSkillIds, ['tdd']);
      assert.deepStrictEqual(result.provenance.selectedSkillNames, ['tdd-workflow']);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('native materialization rejects a skill whose frontmatter name differs from its public directory name', () => {
    const root = tmpDir('dhpk-native-frontmatter-mismatch-root-');
    const out = tmpDir('dhpk-native-frontmatter-mismatch-out-');
    try {
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-example-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-example-skill', 'SKILL.md'), '---\nname: legacy-example\n---\n');
      const inventory = {
        skills: [{
          id: 'example-skill',
          name: 'dhpk-example-skill',
          path: 'skills/dhpk-example-skill',
          lifecycle: 'promoted',
          surfaces: ['codex-native'],
        }],
      };
      assert.throws(
        () => materializeNativePackage({ inventory, root, outDir: out }),
        /frontmatter.*dhpk-example-skill|public name.*dhpk-example-skill/i
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('regenerating into an existing outDir removes a skill directory dropped from the codex-native surface', () => {
    const firstInventory = {
      skills: [
        { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
        { id: 'yii1-security-audit', name: 'dhpk-yii1-security-audit', path: 'skills/dhpk-yii1-security-audit', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      ],
    };
    const out = tmpDir('dhpk-native-regenerate-drop-');
    try {
      materializeNativePackage({ inventory: firstInventory, root: ROOT, outDir: out });
      assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-yii1-security-audit')));

      // yii1-security-audit is de-listed from codex-native between releases.
      const secondInventory = {
        skills: [{ id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
      };
      const result = materializeNativePackage({ inventory: secondInventory, root: ROOT, outDir: out });

      assert.deepStrictEqual(result.skillIds, ['tdd']);
      assert.ok(fs.existsSync(path.join(out, 'skills', 'tdd-workflow')), 'tdd must remain');
      assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-yii1-security-audit')), 'stale yii1-security-audit directory must be removed on regeneration');
      assert.deepStrictEqual(Object.keys(result.fingerprints), ['tdd-workflow']);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('rematerializing a selected skill removes files deleted from its canonical source', () => {
    const root = tmpDir('dhpk-native-regenerate-file-root-');
    const out = tmpDir('dhpk-native-regenerate-file-out-');
    const inventory = {
      skills: [{ id: 'example', name: 'dhpk-example-skill', path: 'skills/dhpk-example-skill', lifecycle: 'promoted', surfaces: ['codex-native'] }],
    };
    try {
      const source = path.join(root, 'skills', 'dhpk-example-skill');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: dhpk-example-skill\n---\n');
      fs.writeFileSync(path.join(source, 'retired.md'), 'remove me\n');
      materializeNativePackage({ inventory, root, outDir: out });
      assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-example-skill', 'retired.md')));

      fs.rmSync(path.join(source, 'retired.md'));
      const result = materializeNativePackage({ inventory, root, outDir: out });
      assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-example-skill', 'retired.md')),
        'a deleted canonical file must not survive in the selected destination');
      assert.deepStrictEqual(result.skillNames, ['dhpk-example-skill']);
      assert.ok(fs.existsSync(path.join(out, 'provenance.json')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('materialization rejects a symlinked output root instead of writing through it', () => {
    const parent = tmpDir('dhpk-native-symlink-root-');
    const actual = path.join(parent, 'actual');
    const linked = path.join(parent, 'linked');
    const inventory = {
      skills: [{ id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['codex-native'] }],
    };
    try {
      fs.mkdirSync(actual);
      fs.symlinkSync(actual, linked, 'dir');
      assert.throws(() => materializeNativePackage({ inventory, root: ROOT, outDir: linked }), /symlinked output root/i);
      assert.deepStrictEqual(fs.readdirSync(actual), []);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('materialization rejects a symlinked output ancestor before it can write outside the lexical root', () => {
    const parent = tmpDir('dhpk-native-symlink-ancestor-');
    const external = path.join(parent, 'external');
    const linkedParent = path.join(parent, 'plugins');
    const inventory = {
      skills: [{ id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['codex-native'] }],
    };
    try {
      fs.mkdirSync(external);
      fs.symlinkSync(external, linkedParent, 'dir');
      const outDir = path.join(linkedParent, 'dhpk');
      assert.throws(() => materializeNativePackage({ inventory, root: ROOT, outDir }), /symlinked output root|symlinked output ancestor/i);
      assert.deepStrictEqual(fs.readdirSync(external), []);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test('generation is deterministic: two materializations of the same inventory produce identical fingerprints and provenance', () => {
    const inventory = {
      skills: [{ id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
    };
    const outA = tmpDir('dhpk-native-a-');
    const outB = tmpDir('dhpk-native-b-');
    try {
      const a = materializeNativePackage({ inventory, root: ROOT, outDir: outA, version: '1.2.3', sourceCommit: 'abc123' });
      const b = materializeNativePackage({ inventory, root: ROOT, outDir: outB, version: '1.2.3', sourceCommit: 'abc123' });
      assert.deepStrictEqual(a.fingerprints, b.fingerprints);
      assert.deepStrictEqual(a.provenance, b.provenance);
      assert.strictEqual(fingerprintDir(path.join(outA, 'skills', 'tdd-workflow')), fingerprintDir(path.join(outB, 'skills', 'tdd-workflow')));
    } finally {
      fs.rmSync(outA, { recursive: true, force: true });
      fs.rmSync(outB, { recursive: true, force: true });
    }
  });

  test('fingerprint traversal rejects excessive directory depth before unbounded recursion', () => {
    const root = tmpDir('dhpk-native-fingerprint-depth-');
    try {
      let current = root;
      for (let depth = 0; depth < 4; depth += 1) {
        current = path.join(current, `level-${depth}`);
        fs.mkdirSync(current);
      }
      fs.writeFileSync(path.join(current, 'SKILL.md'), 'bounded\n');
      assert.throws(
        () => fingerprintDir(root, { maxDepth: 2 }),
        /maximum directory depth/i,
      );
      assert.throws(
        () => fingerprintDir(root, { maxBytes: 1 }),
        /byte budget/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('native projection uses one byte budget across all selected skills', () => {
    const root = tmpDir('dhpk-native-aggregate-budget-');
    const out = tmpDir('dhpk-native-aggregate-budget-out-');
    const body = 'x'.repeat(180);
    try {
      for (const [id, name] of [['one', 'dhpk-one'], ['two', 'dhpk-two']]) {
        const skill = path.join(root, 'skills', name);
        fs.mkdirSync(skill, { recursive: true });
        fs.writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: ${name}\n---\n${body}\n`);
      }
      const inventory = {
        skills: [
          { id: 'one', name: 'dhpk-one', path: 'skills/dhpk-one', surfaces: ['codex-native'] },
          { id: 'two', name: 'dhpk-two', path: 'skills/dhpk-two', surfaces: ['codex-native'] },
        ],
      };
      assert.throws(
        () => compileNativePackage({ inventory, root, outDir: out, traversalOptions: { maxBytes: 700 } }),
        /byte budget/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('native fingerprinting rejects symlink entries before following external targets', () => {
    const root = tmpDir('dhpk-native-fingerprint-symlink-');
    const outside = tmpDir('dhpk-native-fingerprint-outside-');
    try {
      fs.writeFileSync(path.join(outside, 'secret.md'), 'outside\n');
      fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));
      assert.throws(() => fingerprintDir(root), /symlink/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('native verifier rejects symlinked package roots and ancestors before reading the package', () => {
    const realParent = tmpDir('dhpk-native-verify-root-');
    const packageRoot = path.join(realParent, 'package');
    fs.mkdirSync(packageRoot);
    const linkParent = path.join(tmpDir('dhpk-native-verify-parent-'), 'linked-parent');
    const linkedRoot = path.join(linkParent, 'package');
    const rootLink = path.join(tmpDir('dhpk-native-verify-link-'), 'root-link');
    try {
      fs.symlinkSync(realParent, linkParent, 'dir');
      fs.symlinkSync(packageRoot, rootLink, 'dir');
      for (const candidate of [linkedRoot, rootLink]) {
        const result = verifyNativePackage({ packageRoot: candidate });
        assert.strictEqual(result.ok, false);
        assert.match(result.errors.join('\n'), /symlinked native package root ancestor|physical native package root/i);
      }
    } finally {
      fs.rmSync(realParent, { recursive: true, force: true });
      fs.rmSync(path.dirname(linkParent), { recursive: true, force: true });
      fs.rmSync(path.dirname(rootLink), { recursive: true, force: true });
    }
  });

  test('CLI generates the canonical Codex owner catalog with zero symlinks and provenance', () => {
    const out = tmpDir('dhpk-native-cli-');
    try {
      const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'gen-codex-native-package.js'), out], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);

      function findSymlinks(dir) {
        const found = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) found.push(fp);
          else if (entry.isDirectory()) found.push(...findSymlinks(fp));
        }
        return found;
      }
      assert.deepStrictEqual(findSymlinks(out), []);

      const manifest = JSON.parse(fs.readFileSync(path.join(out, '.codex-plugin', 'plugin.json'), 'utf8'));
      assert.strictEqual(manifest.skills, './skills/');

      const provenance = JSON.parse(fs.readFileSync(path.join(out, 'provenance.json'), 'utf8'));
      const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
      const selection = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'marketplace-selection.json'), 'utf8'));
      const inventoryById = new Map(inventory.skills.map((entry) => [entry.id, entry]));
      const commonIds = selection.skills.filter((entry) => entry.selection === 'common' && entry.kind === 'entry')
        .map((entry) => entry.id).sort();
      const hostOnlyIds = selection.skills.filter((entry) => entry.selection === 'host-only'
        && inventoryById.get(entry.id).surfaces.includes('codex-native')).map((entry) => entry.id).sort();
      const expectedIds = [...commonIds, ...hostOnlyIds].sort();
      assert.deepStrictEqual(provenance.runtimeSupportStableIds, ['cli-dispatch-context', 'cli-transport']);
      assert.deepStrictEqual(provenance.marketplacePublication.publicEntryIds, commonIds);
      assert.deepStrictEqual(provenance.marketplacePublication.hostOnlyIds, hostOnlyIds);
      assert.deepStrictEqual(provenance.selectedSkillIds, expectedIds);
      assert.deepStrictEqual(
        fs.readdirSync(path.join(out, 'skills')).sort(),
        provenance.materializedSkillNames,
        'native directory names must equal sorted public names from materialized provenance'
      );
      assert.ok(provenance.sourceCommit && provenance.sourceCommit !== 'unknown');
      assert.ok(provenance.inventoryDigest);
      assert.ok(provenance.generatorVersion);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
}

// Consolidated from tests/verify-codex-native-package.test.js; imports and helpers stay local.
{

  // Coverage for scripts/ci/verify-codex-native-package.js — the deterministic
  // generation gate and Phase 4 consumer-stage adapter: a fresh regeneration must match the tracked
  // plugins/dhpk/ artifact's fingerprints, membership, manifest skills field,
  // inventory digest, and generator version.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const { materializeNativePackage, verifyNativePackage } = require('../scripts/lib/codex-native-package');

  const ROOT = path.join(__dirname, '..');
  const CLI = path.join(ROOT, 'scripts', 'ci', 'verify-codex-native-package.js');

  function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  }

  function fixtureRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-drift-repo-'));
    fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'tdd-workflow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'tdd-workflow', 'SKILL.md'), '---\nname: tdd-workflow\n---\n');
    const inventory = {
      skills: [{ id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
    };
    fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), JSON.stringify(inventory));
    return { root, inventory };
  }

  test('passes when the tracked package matches a fresh generation from the same sources', () => {
    const { root, inventory } = fixtureRepo();
    try {
      materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails and names the extra skill when the tracked package has drifted membership', () => {
    const { root, inventory } = fixtureRepo();
    try {
      materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      // Simulate drift: inventory gains a new codex-native skill after the tracked package was generated.
      fs.mkdirSync(path.join(root, 'skills', 'extra-skill'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'extra-skill', 'SKILL.md'), '---\nname: extra-skill\n---\n');
      const driftedInventory = {
        skills: [
          ...inventory.skills,
          { id: 'extra-skill', path: 'skills/extra-skill', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
        ],
      };
      fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), JSON.stringify(driftedInventory));

      const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0);
      assert.match(res.stderr, /membership drifted/);
      assert.match(res.stderr, /extra-skill/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails when a canonical skill file changes content after the tracked package was generated', () => {
    const { root, inventory } = fixtureRepo();
    try {
      materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      fs.writeFileSync(path.join(root, 'skills', 'tdd-workflow', 'SKILL.md'), '---\nname: tdd-workflow\n---\nchanged content\n');

      const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0);
      assert.match(res.stderr, /fingerprint drifted/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed when the native provenance routing projection omits entries', () => {
    const { root, inventory } = fixtureRepo();
    try {
      const packageRoot = path.join(root, 'plugins', 'dhpk');
      materializeNativePackage({ inventory, root, outDir: packageRoot, name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      const provenancePath = path.join(packageRoot, 'provenance.json');
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
      delete provenance.routingProjection.entries;
      fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

      const result = verifyNativePackage({ packageRoot, inventory, stage: 'structural' });

      assert.strictEqual(result.ok, false);
      assert.ok(result.routingParity.diagnostics.some((diagnostic) => /entries array/.test(diagnostic)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails and identifies tracked frontmatter whose name differs from its public directory', () => {
    const { root, inventory } = fixtureRepo();
    try {
      materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      const trackedSkill = path.join(root, 'plugins', 'dhpk', 'skills', 'tdd-workflow', 'SKILL.md');
      fs.writeFileSync(trackedSkill, '---\nname: tdd\n---\n');

      const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0);
      assert.match(res.stderr, /frontmatter.*tdd-workflow|public name.*tdd-workflow/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('default Codex generation publishes the canonical owner catalog and verifies against its source root', () => {
    const packageRoot = tmpDir('dhpk-native-catalog-real-');
    try {
      const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
      const selection = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'marketplace-selection.json'), 'utf8'));
      const priorReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk', 'provenance.json'), 'utf8'));
      const inventoryById = new Map(inventory.skills.map((entry) => [entry.id, entry]));
      const commonIds = selection.skills.filter((entry) => entry.selection === 'common' && entry.kind === 'entry')
        .map((entry) => entry.id).sort();
      const hostOnlyIds = selection.skills.filter((entry) => entry.selection === 'host-only'
        && inventoryById.get(entry.id).surfaces.includes('codex-native')).map((entry) => entry.id).sort();
      const expectedIds = [...commonIds, ...hostOnlyIds].sort();

      const generated = materializeNativePackage({
        inventory,
        root: ROOT,
        outDir: packageRoot,
        name: 'dhpk',
        version: '1.0.0',
        sourceCommit: priorReceipt.sourceCommit,
      });
      const verified = verifyNativePackage({ packageRoot, inventory, sourceRoot: ROOT, stage: 'structural' });
      const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8'));
      const actualNames = fs.readdirSync(path.join(packageRoot, 'skills')).filter((name) => fs.existsSync(path.join(packageRoot, 'skills', name, 'SKILL.md'))).sort();

      assert.ok(verified.ok, verified.errors.join('\n'));
      assert.strictEqual(commonIds.length, 15);
      assert.deepStrictEqual(actualNames, expectedIds.map((id) => inventoryById.get(id).name).sort());
      assert.deepStrictEqual(generated.skillIds, expectedIds);
      assert.deepStrictEqual(provenance.marketplacePublication.publicEntryIds, commonIds);
      assert.deepStrictEqual(provenance.marketplacePublication.hostOnlyIds, hostOnlyIds);
      assert.deepStrictEqual(provenance.selectedSkillIds, expectedIds);
    } finally {
      fs.rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  test('explicit Codex profile selection stays separate from the default catalog', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const packageRoot = tmpDir('dhpk-native-profile-real-');
    try {
      const requiredCoreIds = inventory.profile_policy.required_core_ids.slice().sort();
      const { resolveCapabilitySelection } = require('../scripts/lib/capability-bundle-selection');
      const resolved = resolveCapabilitySelection({
        inventory,
        profileId: 'minimal',
        profiles: { profiles: { minimal: { skillIds: requiredCoreIds, modules: [] } } },
      });
      assert.ok(resolved.ok, resolved.error && resolved.error.message);
      materializeNativePackage({
        inventory,
        root: ROOT,
        outDir: packageRoot,
        name: 'dhpk',
        version: '1.0.0',
        sourceCommit: 'a'.repeat(40),
        profileSelection: resolved.value,
      });
      const verified = verifyNativePackage({
        packageRoot,
        inventory,
        sourceRoot: ROOT,
        profileSelection: resolved.value,
        stage: 'structural',
      });
      const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8'));
      assert.ok(verified.ok, verified.errors.join('\n'));
      assert.strictEqual(Object.prototype.hasOwnProperty.call(provenance, 'marketplacePublication'), false);
      assert.strictEqual(provenance.profileId, 'minimal');
    } finally {
      fs.rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  test('consumer-runtime verification preserves NOT_CONFIGURED without upgrading structural evidence', () => {
    const { root, inventory } = fixtureRepo();
    try {
      const packageRoot = path.join(root, 'plugins', 'dhpk');
      materializeNativePackage({ inventory, root, outDir: packageRoot, name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      const result = verifyNativePackage({
        packageRoot,
        inventory,
        stage: 'consumer-runtime',
        observedAt: '2026-08-13T00:00:00.000Z',
        consumerAdapter: {
          identity: { id: 'codex-cli', version: 'not-installed' },
          verify: () => ({ verdict: 'NOT_CONFIGURED', diagnostics: ['codex CLI is not configured'] }),
        },
      });
      assert.strictEqual(result.ok, true, result.error && result.error.message);
      assert.strictEqual(result.evidence.stage, 'consumer-runtime');
      assert.strictEqual(result.evidence.verdict, 'NOT_CONFIGURED');
      assert.deepStrictEqual(result.evidence.diagnostics, ['codex CLI is not configured']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('consumer-runtime verification stays NOT_CONFIGURED when no consumer adapter is supplied', () => {
    const { root, inventory } = fixtureRepo();
    try {
      const packageRoot = path.join(root, 'plugins', 'dhpk');
      materializeNativePackage({ inventory, root, outDir: packageRoot, name: 'dhpk', version: '1.0.0', sourceCommit: 'a'.repeat(40) });
      const result = verifyNativePackage({
        packageRoot,
        inventory,
        stage: 'consumer-runtime',
        observedAt: '2026-08-13T00:00:00.000Z',
      });
      assert.strictEqual(result.ok, true, result.error && result.error.message);
      assert.strictEqual(result.evidence.stage, 'consumer-runtime');
      assert.strictEqual(result.evidence.verdict, 'NOT_CONFIGURED');
      assert.strictEqual(result.evidence.observedAt, '2026-08-13T00:00:00.000Z');
      assert.ok(result.evidence.claims.includes('Codex native consumer configuration'));
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'lifecycle'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

run('codex-native-package-validate');
