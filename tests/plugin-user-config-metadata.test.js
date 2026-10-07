'use strict';

// Contract coverage for compact plugin user-config metadata. The fixture locks
// the legacy contract while generation and rollback behavior stay observable.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, '.claude-plugin', 'plugin.json');
const LEGACY_MANIFEST_PATH = path.join(ROOT, 'manifests', 'claude-user-config-legacy.json');
const METADATA_SOURCE_PATH = path.join(ROOT, 'manifests', 'claude-user-config-metadata.json');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'plugin-user-config-contract.json');
const activeManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const legacyManifest = JSON.parse(fs.readFileSync(LEGACY_MANIFEST_PATH, 'utf8'));
const canonicalMetadataDocument = JSON.parse(fs.readFileSync(METADATA_SOURCE_PATH, 'utf8'));
const contractFixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

const EXPECTED_ACTIVE_USER_CONFIG_COUNT = 76;
const EXPECTED_ACTIVE_USER_CONFIG_SHA256 = '53cc964a6a31d4c3a63bde9ab9a14951a9b1ebfc9440162a3f4ef0422b042b36';
const EXPECTED_CANONICAL_ROLE_CONFIG_KEYS = [
  'cross_provider',
  'worker_target',
  'reasoner_target',
  'planner_target',
  'reviewer_target',
  'preference_order',
  'fallback_allow',
  'codex_worker_model',
  'codex_worker_effort',
  'codex_reasoner_model',
  'codex_reasoner_effort',
  'codex_worker_timeout_secs',
  'codex_reasoner_timeout_secs',
  'codex_reviewer_model',
  'codex_reviewer_effort',
  'codex_reviewer_timeout_secs',
  'agy_worker_model',
];

let metadataApi = null;
let metadataLoadError = null;
try {
  metadataApi = require('../scripts/lib/plugin-user-config-metadata');
} catch (error) {
  metadataLoadError = error;
}

let probeApi = null;
let probeLoadError = null;
try {
  probeApi = require('../scripts/release/claude-user-config-probe');
} catch (error) {
  probeLoadError = error;
}

function api() {
  assert.ifError(metadataLoadError);
  for (const name of [
    'validateUserConfigMetadata',
    'generateUserConfigMetadata',
    'measureUserConfigMetadata',
    'rollbackUserConfigMetadata',
    'loadAuthoritativeMetadata',
  ]) assert.strictEqual(typeof metadataApi[name], 'function', `${name} export is required`);
  return metadataApi;
}

function probe() {
  assert.ifError(probeLoadError);
  assert.strictEqual(typeof probeApi.runClaudeUserConfigProbe, 'function');
  return probeApi;
}

function contractEntries(manifest = legacyManifest) {
  return Object.entries(manifest.userConfig || {}).map(([key, entry]) => ({
    key,
    type: entry.type,
    multiple: entry.multiple === true,
    title: entry.title,
    default: entry.default,
  }));
}

function compactSource(overrides = {}) {
  const entries = contractFixture.entries.map((entry) => ({
    ...entry,
    purpose: `Configure ${entry.title.toLowerCase()}.`,
    trigger: `Use when setting ${entry.key}.`,
    boundary: `Does not change ${entry.key} validation or runtime behavior.`,
    pointer: 'docs/configuration.md',
    description: `Configure ${entry.key}; use for this option only; not for runtime behavior. See docs/configuration.md.`,
  }));
  return {
    schema: 'dhpk.plugin-user-config-metadata.v1',
    generatorVersion: '1',
    entries,
    ...overrides,
  };
}

function resultText(result) {
  return JSON.stringify(result);
}

function valueOf(result) {
  return result && result.value && typeof result.value === 'object' ? result.value : result;
}

function candidateManifest(result) {
  const value = valueOf(result);
  return value && (value.manifest || value.candidateManifest || value.output || value);
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('legacy userConfig fixture contains exactly 59 options and preserves the legacy contract', () => {
  assert.strictEqual(contractFixture.source, 'manifests/claude-user-config-legacy.json');
  assert.strictEqual(contractFixture.count, 59);
  assert.strictEqual(contractFixture.entries.length, 59);
  assert.strictEqual(Object.keys(legacyManifest.userConfig || {}).length, 59);
  assert.deepStrictEqual(contractEntries(), contractFixture.entries);
  for (const [key, entry] of Object.entries(legacyManifest.userConfig)) {
    assert.strictEqual(typeof entry.description, 'string', `${key} description`);
    assert.ok(entry.description.length > 0, `${key} description must remain characterized`);
  }
});

test('active userConfig preserves the canonical 76-key contract and metadata coverage', () => {
  const activeEntries = contractEntries(activeManifest);
  const legacyKeys = Object.keys(legacyManifest.userConfig || {});
  const activeKeys = Object.keys(activeManifest.userConfig || {});
  const canonicalOnlyKeys = activeKeys.filter((key) => !legacyKeys.includes(key));

  assert.strictEqual(activeEntries.length, EXPECTED_ACTIVE_USER_CONFIG_COUNT);
  assert.strictEqual(digest(activeEntries), EXPECTED_ACTIVE_USER_CONFIG_SHA256);
  for (const key of ['codex_deep_reasoner_model', 'codex_reasoner_model', 'codex_reviewer_model']) {
    assert.strictEqual(activeManifest.userConfig[key].default, 'gpt-6.1-sol', key);
  }
  assert.deepStrictEqual(canonicalOnlyKeys, EXPECTED_CANONICAL_ROLE_CONFIG_KEYS);
  assert.ok(EXPECTED_CANONICAL_ROLE_CONFIG_KEYS.every((key) => !legacyKeys.includes(key)));
  assert.strictEqual(canonicalMetadataDocument.entries.length, EXPECTED_ACTIVE_USER_CONFIG_COUNT);
  assert.deepStrictEqual(canonicalMetadataDocument.entries.map((entry) => entry.key), activeKeys);

  const canonicalMetadataSource = api().loadAuthoritativeMetadata({
    root: ROOT,
    legacyManifest: activeManifest,
    sourcePath: METADATA_SOURCE_PATH,
  });
  const result = api().validateUserConfigMetadata({
    root: ROOT,
    legacyManifest: activeManifest,
    source: canonicalMetadataSource,
  });
  assert.strictEqual(result.ok, true, resultText(result));
  const value = valueOf(result);
  assert.strictEqual(value.entries.length, EXPECTED_ACTIVE_USER_CONFIG_COUNT);
  assert.deepStrictEqual(value.entries.map((entry) => entry.key), activeKeys);
});

test('active userConfig exposes cross_provider as a disabled-by-default opt-in', () => {
  const option = activeManifest.userConfig.cross_provider;
  assert.ok(option, 'cross_provider userConfig entry is required');
  assert.strictEqual(option.type, 'boolean');
  assert.strictEqual(option.default, false);
  assert.match(option.description, /auto|external|provider/i);
});

test('active userConfig ships Gemini 3.8 Flash High for both AGY model keys', () => {
  assert.strictEqual(activeManifest.userConfig.agy_worker_model.default, 'Gemini 3.8 Flash (High)');
  assert.strictEqual(activeManifest.userConfig.agy_fast_worker_model.default, 'Gemini 3.8 Flash (High)');
});

test('compact metadata source validates purpose, trigger, boundary, pointer, and schema compatibility', () => {
  const result = api().validateUserConfigMetadata({
    root: ROOT,
    legacyManifest,
    source: compactSource(),
  });
  assert.strictEqual(result.ok, true, resultText(result));
  const value = valueOf(result);
  assert.strictEqual(value.category, 'claude-user-config');
  assert.strictEqual(value.entries.length, 59);
  assert.ok(value.entries.every((entry) => entry.purpose && entry.trigger && entry.boundary && entry.pointer));
});

test('missing, outside-root, or outside-doc guidance pointers fail closed with the affected option', () => {
  for (const pointer of ['', '../../outside.md', '/etc/passwd', 'scripts/ci/context-budget.js']) {
    const source = compactSource();
    source.entries[0] = { ...source.entries[0], pointer };
    const result = api().validateUserConfigMetadata({ root: ROOT, legacyManifest, source });
    assert.strictEqual(result.ok, false, `${pointer}: ${resultText(result)}`);
    assert.match(resultText(result), /hook_profile|pointer|escape|missing/i);
  }
});

test('metadata source cannot move the canonical guidance root', () => {
  const source = compactSource({ pointerRoot: '.claude-plugin' });
  const result = api().validateUserConfigMetadata({ root: ROOT, legacyManifest, source });
  assert.strictEqual(result.ok, false);
  assert.match(resultText(result), /canonical docs root|pointerRoot/i);
});

test('duplicate keys, unknown keys, and generator-local entries are rejected', () => {
  const duplicate = compactSource({ entries: [...compactSource().entries, compactSource().entries[0]] });
  const duplicateResult = api().validateUserConfigMetadata({ root: ROOT, legacyManifest, source: duplicate });
  assert.strictEqual(duplicateResult.ok, false);
  assert.match(resultText(duplicateResult), /duplicate|hook_profile/i);

  const unknown = compactSource({ entries: [...compactSource().entries, {
    key: 'generator_local_option',
    type: 'string',
    default: 'bad',
    purpose: 'local',
    trigger: 'local',
    boundary: 'local',
    pointer: 'docs/configuration.md',
    description: 'local option',
  }] });
  const unknownResult = api().validateUserConfigMetadata({ root: ROOT, legacyManifest, source: unknown });
  assert.strictEqual(unknownResult.ok, false);
  assert.match(resultText(unknownResult), /generator_local_option|unknown|unowned/i);
});

test('long-form policy duplication and unsupported custom manifest fields block publication', () => {
  const duplicate = compactSource();
  duplicate.entries[1] = {
    ...duplicate.entries[1],
    description: legacyManifest.userConfig.deep_reasoner_model.description,
  };
  const duplicateResult = api().validateUserConfigMetadata({ root: ROOT, legacyManifest, source: duplicate });
  assert.strictEqual(duplicateResult.ok, false);
  assert.match(resultText(duplicateResult), /duplicate|long-form|review_agents|deep_reasoner_model/i);

  const custom = compactSource();
  custom.entries[0] = { ...custom.entries[0], guidanceRef: 'docs/configuration.md' };
  const customResult = api().validateUserConfigMetadata({ root: ROOT, legacyManifest, source: custom });
  assert.strictEqual(customResult.ok, false);
  assert.match(resultText(customResult), /guidanceRef|schema|unsupported/i);

  const legacyWithCustom = JSON.parse(JSON.stringify(legacyManifest));
  legacyWithCustom.userConfig.hook_profile.guidanceRef = 'docs/configuration.md';
  const legacyResult = api().validateUserConfigMetadata({ root: ROOT, legacyManifest: legacyWithCustom, source: compactSource() });
  assert.strictEqual(legacyResult.ok, false);
  assert.match(resultText(legacyResult), /legacy manifest field|guidanceRef/i);
});

test('unchanged compact source generates byte-identical metadata and a stable fingerprint', () => {
  const source = compactSource();
  const first = api().generateUserConfigMetadata({ root: ROOT, legacyManifest, source });
  const second = api().generateUserConfigMetadata({ root: ROOT, legacyManifest, source });
  assert.strictEqual(first.ok, true, resultText(first));
  assert.strictEqual(second.ok, true, resultText(second));
  const firstManifest = candidateManifest(first);
  const secondManifest = candidateManifest(second);
  assert.strictEqual(JSON.stringify(firstManifest), JSON.stringify(secondManifest));
  assert.strictEqual(valueOf(first).manifestFingerprint, valueOf(second).manifestFingerprint);
  assert.strictEqual(valueOf(first).manifestFingerprint, digest(firstManifest));
});

test('generated candidate preserves the complete config contract and compacts only approved metadata', () => {
  const result = api().generateUserConfigMetadata({ root: ROOT, legacyManifest, source: compactSource() });
  assert.strictEqual(result.ok, true, resultText(result));
  const candidate = candidateManifest(result);
  assert.deepStrictEqual(contractEntries(candidate), contractFixture.entries);
  assert.deepStrictEqual(candidate.skills, legacyManifest.skills);
  assert.deepStrictEqual(candidate.agents, legacyManifest.agents);
  assert.deepStrictEqual(candidate.commands, legacyManifest.commands);
  assert.ok(Object.values(candidate.userConfig).every((entry) => entry.description.length < 400));
});

test('rollback restores the characterized legacy manifest and leaves unrelated projections untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-user-config-rollback-'));
  try {
    const manifestPath = path.join(root, 'plugin.json');
    const unrelatedProjectionPath = path.join(root, 'unrelated-projection.json');
    const unrelatedProjectionBytes = '{"owner":"other-projection","version":1}\n';
    const legacyBytes = `${JSON.stringify(legacyManifest, null, 2)}\n`;
    fs.writeFileSync(manifestPath, legacyBytes);
    fs.writeFileSync(unrelatedProjectionPath, unrelatedProjectionBytes);
    const generated = api().generateUserConfigMetadata({ root: ROOT, legacyManifest, source: compactSource() });
    assert.strictEqual(generated.ok, true, resultText(generated));
    fs.writeFileSync(manifestPath, `${JSON.stringify(candidateManifest(generated), null, 2)}\n`);
    const rollback = api().rollbackUserConfigMetadata({
      root,
      manifestPath,
      legacyManifest,
      legacyFingerprint: digest(legacyBytes),
    });
    assert.strictEqual(rollback.ok, true, resultText(rollback));
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), legacyBytes);
    assert.strictEqual(fs.readFileSync(unrelatedProjectionPath, 'utf8'), unrelatedProjectionBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metadata evidence is scoped to claude-user-config and remains structural', () => {
  const generated = api().generateUserConfigMetadata({ root: ROOT, legacyManifest, source: compactSource() });
  assert.strictEqual(generated.ok, true, resultText(generated));
  const candidate = candidateManifest(generated);
  const evidence = api().measureUserConfigMetadata({
    beforeManifest: legacyManifest,
    afterManifest: candidate,
    metadataSource: compactSource(),
    identity: {
      artifactFingerprint: valueOf(generated).manifestFingerprint,
    },
    consumer: { status: 'NOT_CONFIGURED', resumeCommand: 'claude plugin validate' },
  });
  assert.strictEqual(evidence.ok, true, resultText(evidence));
  const value = valueOf(evidence);
  assert.strictEqual(value.category, 'claude-user-config');
  assert.strictEqual(value.scope.kind, 'claude-plugin.userConfig');
  assert.ok(value.before.bytes > value.after.bytes);
  assert.ok(value.before.tokens > value.after.tokens);
  assert.strictEqual(value.structural.verdict, 'PASS');
  assert.notStrictEqual(value.consumer.verdict, 'PASS');
  assert.match(JSON.stringify(value), /NOT_CONFIGURED|NOT_RUN|UNAVAILABLE/);
  assert.doesNotMatch(JSON.stringify(value), /live context reduced|session context decreased/i);
});

test('unconfigured Claude consumer probe stays non-pass and supplies resume evidence', () => {
  const result = probe().runClaudeUserConfigProbe({
    executable: 'dhpk-claude-user-config-command-not-installed',
    manifestPath: MANIFEST_PATH,
    manifestFingerprint: digest(activeManifest),
  });
  assert.ok(['NOT_RUN', 'NOT_CONFIGURED', 'UNAVAILABLE', 'BLOCKED'].includes(result.status));
  assert.ok(result.resumeCommand || result.resume_command);
  assert.doesNotMatch(JSON.stringify(result), /context reduced|session context decreased|runtime PASS/i);
});

// BEGIN lexical source block: tests/claude-user-config-probe.test.js
{
  const INVENTORY_ARGS = ['plugin', 'list', '--json'];
  const EXPECTED_VERSION = '2.1.292';
  const CANDIDATE = { name: 'dhpk', version: '1.0.0', userConfig: { example: true } };
  const { runClaudeUserConfigProbe } = require('../scripts/release/claude-user-config-probe');

  function writeManifest(root, manifest = CANDIDATE) {
    const directory = path.join(root, '.claude-plugin');
    fs.mkdirSync(directory, { recursive: true });
    const manifestPath = path.join(directory, 'plugin.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    return manifestPath;
  }

  function probeFixture() {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-inventory-')));
    const candidatePath = path.join(directory, 'candidate', '.claude-plugin', 'plugin.json');
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    fs.writeFileSync(candidatePath, `${JSON.stringify(CANDIDATE)}\n`);
    const inventory = [];
    const calls = [];
    let inventoryResult = null;
    let versionResult = { status: 0, stdout: `claude ${EXPECTED_VERSION}` };
    const runner = (_command, args) => {
      calls.push([...args]);
      if (args.length === 1 && args[0] === '--version') return versionResult;
      if (JSON.stringify(args) === JSON.stringify(INVENTORY_ARGS)) {
        return inventoryResult || { status: 0, stdout: JSON.stringify(inventory) };
      }
      // This is the real failure observed with Claude Code 2.1.291: the old
      // details command rejects --json. Returning it keeps RED tied to the
      // actual unsupported invocation until production switches to inventory.
      return { status: 1, stdout: '', stderr: "error: unknown option '--json'\n" };
    };
    return {
      directory,
      candidatePath,
      inventory,
      calls,
      setInventoryResult(value) { inventoryResult = value; },
      setVersionResult(value) { versionResult = value; },
      installed(label, manifest = CANDIDATE) {
        const root = path.join(directory, label);
        const manifestPath = writeManifest(root, manifest);
        return { root, manifestPath };
      },
      record(root, overrides = {}) {
        return {
          id: 'dhpk@dhpk',
          version: CANDIDATE.version,
          folderVersion: CANDIDATE.version,
          scope: 'user',
          enabled: true,
          installPath: root,
          ...overrides,
        };
      },
      run(overrides = {}) {
        return runClaudeUserConfigProbe({
          executable: 'claude',
          manifestPath: candidatePath,
          manifestFingerprint: digest(CANDIDATE),
          version: EXPECTED_VERSION,
          execute: true,
          runner,
          ...overrides,
        });
      },
    };
  }

  function withProbe(callback) {
    const fixture = probeFixture();
    try {
      callback(fixture);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }

  function assertInventoryInvocation(fixture) {
    assert.deepStrictEqual(
      fixture.calls.filter((args) => args[0] === 'plugin'),
      [INVENTORY_ARGS],
      'the probe must request Claude plugin inventory as JSON',
    );
  }

  function withEnv(name, value, callback) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try { callback(); } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
  test('probe uses the JSON plugin inventory and verifies the installed manifest', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('cache/dhpk/1.0.0');
      const secondRoot = fixture.installed('other-cache/dhpk/1.0.0');
      fixture.inventory.push(fixture.record(installed.root, {
        // These undocumented details fields must never bind acceptance.
        manifestFingerprint: 'f'.repeat(64),
        userConfigFingerprint: 'e'.repeat(64),
        privateMarker: 'inventory-raw-data-must-not-leak',
      }), fixture.record(installed.root, { scope: 'managed' }), fixture.record(secondRoot.root));

      const result = fixture.run();

      assertInventoryInvocation(fixture);
      assert.strictEqual(result.status, 'PASS');
      assert.strictEqual(result.stage, 'installed-manifest');
      assert.doesNotMatch(JSON.stringify(result), /context reduced|session context decreased|runtime PASS/i);
      assert.doesNotMatch(JSON.stringify(result), /inventory-raw-data-must-not-leak|plugin\.json|dhpk\/1\.0\.0/);
    });
  });

  test('project and local scopes require a project path containing cwd', () => {
    const cases = [
      { scope: 'project', projectPath: path.dirname(process.cwd()), expected: 'PASS' },
      { scope: 'local', projectPath: path.dirname(process.cwd()), expected: 'PASS' },
      { scope: 'project', projectPath: `${process.cwd()}-foreign`, expected: 'BLOCKED' },
    ];
    for (const entry of cases) {
      withProbe((fixture) => {
        const installed = fixture.installed(`project-${entry.scope}`);
        fixture.inventory.push(fixture.record(installed.root, {
          scope: entry.scope,
          projectPath: entry.projectPath,
        }));
        const result = fixture.run();
        assert.strictEqual(result.status, entry.expected, entry.scope);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('readFromFolder selects the loaded folder instead of a stale cache installPath', () => {
    withProbe((fixture) => {
      const staleManifest = { ...CANDIDATE, version: '0.9.0' };
      const stale = fixture.installed('stale-cache', staleManifest);
      const loaded = fixture.installed('loaded-folder');
      fixture.inventory.push(fixture.record(stale.root, {
        readFromFolder: loaded.root,
      }));
      const result = fixture.run();
      assert.strictEqual(result.status, 'PASS');
      assertInventoryInvocation(fixture);
    });
  });

  test('an invalid declared readFromFolder does not fall back to a valid cache path', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('valid-cache');
      fixture.inventory.push(fixture.record(installed.root, {
        readFromFolder: 'relative/invalid-folder',
      }));
      const result = fixture.run();
      assert.strictEqual(result.status, 'BLOCKED');
      assertInventoryInvocation(fixture);
    });
  });

  test('each distinct applicable root must match the candidate manifest', () => {
    withProbe((fixture) => {
      const current = fixture.installed('first-current-root');
      const staleManifest = { ...CANDIDATE, version: '0.9.0' };
      const stale = fixture.installed('second-stale-root', staleManifest);
      fixture.inventory.push(
        fixture.record(current.root),
        fixture.record(stale.root, { version: staleManifest.version, folderVersion: staleManifest.version }),
      );
      const result = fixture.run();
      assert.strictEqual(result.status, 'FAIL');
      assertInventoryInvocation(fixture);
    });
  });

  test('folderVersion and cache version can each bind an installed manifest version', () => {
    for (const versionField of ['folderVersion', 'version']) {
      withProbe((fixture) => {
        const installed = fixture.installed(`version-${versionField}`);
        const record = fixture.record(installed.root);
        if (versionField === 'folderVersion') {
          delete record.version;
          record.readFromFolder = installed.root;
        }
        else delete record.folderVersion;
        fixture.inventory.push(record);
        const result = fixture.run();
        assert.strictEqual(result.status, 'PASS', versionField);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('a stale cache or folder version fails even when the installed manifest bytes match', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('stale-version-metadata');
      fixture.inventory.push(fixture.record(installed.root, {
        version: '0.9.0',
        folderVersion: '0.9.0',
      }));
      const result = fixture.run();
      assert.strictEqual(result.status, 'FAIL');
      assertInventoryInvocation(fixture);
    });
  });

  test('only an enabled exact dhpk identity satisfies the inventory requirement', () => {
    const cases = [
      { name: 'empty inventory' },
      { name: 'disabled', overrides: { enabled: false } },
      { name: 'unrelated identity', overrides: { id: 'other@publisher' } },
    ];
    for (const entry of cases) {
      withProbe((fixture) => {
        if (entry.overrides) {
          const installed = fixture.installed(`no-match-${entry.name}`);
          fixture.inventory.push(fixture.record(installed.root, entry.overrides));
        }
        const result = fixture.run();
        assert.strictEqual(result.status, 'BLOCKED', entry.name);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('unknown scopes and malformed matching records are blocked', () => {
    const cases = [
      { name: 'unknown scope', overrides: { scope: 'workspace' } },
      { name: 'non-boolean enabled flag', overrides: { enabled: 'true' } },
      { name: 'relative project path', overrides: { scope: 'project', projectPath: 'relative/project' } },
    ];
    for (const entry of cases) {
      withProbe((fixture) => {
        const installed = fixture.installed(`malformed-${entry.name.replaceAll(' ', '-')}`);
        fixture.inventory.push(fixture.record(installed.root, entry.overrides));
        const result = fixture.run();
        assert.strictEqual(result.status, 'BLOCKED', entry.name);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('plugin inventory load errors block and are not echoed into the result', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('load-error');
      fixture.inventory.push(fixture.record(installed.root, { errors: ['private-load-error-detail'] }));
      const result = fixture.run();
      assert.strictEqual(result.status, 'BLOCKED');
      assert.doesNotMatch(JSON.stringify(result), /private-load-error-detail|load-error/);
      assertInventoryInvocation(fixture);
    });
  });

  test('missing or non-regular installed manifests are blocked', () => {
    for (const kind of ['missing', 'directory']) {
      withProbe((fixture) => {
        const root = path.join(fixture.directory, `bad-manifest-${kind}`);
        const manifestDirectory = path.join(root, '.claude-plugin');
        fs.mkdirSync(manifestDirectory, { recursive: true });
        if (kind === 'directory') fs.mkdirSync(path.join(manifestDirectory, 'plugin.json'));
        fixture.inventory.push(fixture.record(root));
        const result = fixture.run();
        assert.strictEqual(result.status, 'BLOCKED', kind);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('symlinked install roots, ancestors, and manifests are blocked', () => {
    const cases = ['root', 'ancestor', 'manifest'];
    for (const kind of cases) {
      withProbe((fixture) => {
        const real = fixture.installed(`real-${kind}`);
        let installPath = real.root;
        if (kind === 'root') {
          installPath = path.join(fixture.directory, 'linked-root');
          fs.symlinkSync(real.root, installPath, 'dir');
        } else if (kind === 'ancestor') {
          const linkParent = path.join(fixture.directory, 'linked-parent');
          fs.symlinkSync(fixture.directory, linkParent, 'dir');
          installPath = path.join(linkParent, path.basename(real.root));
        } else {
          const linkedManifest = path.join(real.root, '.claude-plugin', 'plugin.json');
          fs.unlinkSync(linkedManifest);
          const target = path.join(fixture.directory, 'outside-plugin.json');
          fs.writeFileSync(target, `${JSON.stringify(CANDIDATE)}\n`);
          fs.symlinkSync(target, linkedManifest);
        }
        fixture.inventory.push(fixture.record(installPath));
        const result = fixture.run();
        assert.strictEqual(result.status, 'BLOCKED', kind);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('installed manifest identity and JSON content must match the candidate', () => {
    const cases = [
      { name: 'wrong plugin name', manifest: { ...CANDIDATE, name: 'other' }, expected: 'BLOCKED' },
      { name: 'stale manifest content', manifest: { ...CANDIDATE, userConfig: { example: false } }, expected: 'FAIL' },
      { name: 'invalid JSON', contents: '{invalid json', expected: 'FAIL' },
    ];
    for (const entry of cases) {
      withProbe((fixture) => {
        const root = path.join(fixture.directory, `manifest-${entry.name.replaceAll(' ', '-')}`);
        const manifestDirectory = path.join(root, '.claude-plugin');
        fs.mkdirSync(manifestDirectory, { recursive: true });
        if (entry.contents !== undefined) fs.writeFileSync(path.join(manifestDirectory, 'plugin.json'), entry.contents);
        else writeManifest(root, entry.manifest);
        fixture.inventory.push(fixture.record(root, {
          version: entry.manifest ? entry.manifest.version : CANDIDATE.version,
          folderVersion: entry.manifest ? entry.manifest.version : CANDIDATE.version,
        }));
        const result = fixture.run();
        assert.strictEqual(result.status, entry.expected, entry.name);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('empty, invalid JSON, non-array, nonzero, and timed-out inventories are unavailable', () => {
    const cases = [
      { name: 'invalid JSON', result: { status: 0, stdout: '{invalid' } },
      { name: 'non-array inventory', result: { status: 0, stdout: JSON.stringify({ plugins: [] }) } },
      { name: 'nonzero inventory command', result: { status: 1, stdout: '', stderr: 'private-cli-diagnostic' } },
      { name: 'inventory timeout', result: { status: null, error: { code: 'ETIMEDOUT' } } },
    ];
    for (const entry of cases) {
      withProbe((fixture) => {
        fixture.setInventoryResult(entry.result);
        const result = fixture.run();
        assert.strictEqual(result.status, 'UNAVAILABLE', entry.name);
        assertInventoryInvocation(fixture);
      });
    }
  });

  test('missing executable permissions report NOT_CONFIGURED', () => {
    for (const code of ['ENOENT', 'EACCES']) {
      withProbe((fixture) => {
        fixture.setVersionResult({ status: null, error: { code } });
        const result = fixture.run();
        assert.strictEqual(result.status, 'NOT_CONFIGURED', code);
        assert.strictEqual(fixture.calls.some((args) => args[0] === 'plugin'), false);
      });
    }
  });

  test('local candidate tampering fails even if an inventory record could claim its fingerprint', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('candidate-tamper');
      fixture.inventory.push(fixture.record(installed.root, { manifestFingerprint: digest(CANDIDATE) }));
      fs.writeFileSync(fixture.candidatePath, `${JSON.stringify({ ...CANDIDATE, userConfig: { example: false } })}\n`);
      const result = fixture.run();
      assert.strictEqual(result.status, 'FAIL');
      assert.strictEqual(fixture.calls.some((args) => args[0] === 'plugin'), false);
    });
  });

  test('exact Claude version matching rejects prefixes and prerelease suffixes', () => {
    for (const observed of ['claude 2.1.2921', 'claude 2.1.292-beta']) {
      withProbe((fixture) => {
        fixture.setVersionResult({ status: 0, stdout: observed });
        const result = fixture.run({ version: EXPECTED_VERSION });
        assert.strictEqual(result.status, 'BLOCKED', observed);
        assert.match(result.reason, /version/i);
        assert.strictEqual(fixture.calls.some((args) => args[0] === 'plugin'), false);
      });
    }
  });

  test('explicit execution requires an exact Claude version', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('exact-version-required');
      fixture.inventory.push(fixture.record(installed.root));
      const result = fixture.run({ version: undefined });
      assert.strictEqual(result.status, 'BLOCKED');
      assert.match(result.reason, /exact.*version|version.*required/i);
      assert.strictEqual(fixture.calls.some((args) => args[0] === 'plugin'), false);
    });
  });

  test('environment-requested execution requires and accepts an exact version', () => {
    withProbe((fixture) => {
      const installed = fixture.installed('env-execute');
      fixture.inventory.push(fixture.record(installed.root));
      withEnv('DHPK_CONSUMER_PROBE_EXECUTE', '1', () => {
        const missingVersion = fixture.run({ execute: false, version: undefined });
        assert.strictEqual(missingVersion.status, 'BLOCKED');
        assert.strictEqual(fixture.calls.some((args) => args[0] === 'plugin'), false);
      });
    });

    withProbe((fixture) => {
      const installed = fixture.installed('env-execute-exact');
      fixture.inventory.push(fixture.record(installed.root));
      withEnv('DHPK_CONSUMER_PROBE_EXECUTE', '1', () => {
        const result = fixture.run({ execute: false, version: EXPECTED_VERSION });
        assert.strictEqual(result.status, 'PASS');
        assertInventoryInvocation(fixture);
      });
    });
  });
}
// END lexical source block: tests/claude-user-config-probe.test.js

// BEGIN lexical source block: tests/gen-claude-user-config.test.js
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  test('candidate generator validates the authoritative source without activating it', () => {
    const manifestPath = path.join(ROOT, '.claude-plugin/plugin.json');
    const activeBefore = fs.readFileSync(manifestPath);
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ci/gen-claude-user-config.js'), '--check'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const fingerprint = result.stdout.match(/candidate fingerprint ([a-f0-9]{64})/i);
    assert.ok(fingerprint, `candidate fingerprint must be reported: ${result.stdout}`);
    assert.deepStrictEqual(fs.readFileSync(manifestPath), activeBefore, '--check must leave the active manifest byte-identical');

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-user-config-malformed-source-'));
    try {
      for (const relative of [
        'scripts/lib',
        'scripts/ci/gen-claude-user-config.js',
        'scripts/release/claude-user-config-probe.js',
        'manifests/claude-user-config-metadata.json',
        '.claude-plugin/plugin.json',
        'docs/configuration.md',
      ]) {
        const source = path.join(ROOT, relative);
        const destination = path.join(temp, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(source, destination, { recursive: true });
      }
      const metadataPath = path.join(temp, 'manifests/claude-user-config-metadata.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      metadata.schema = 'dhpk.invalid-user-config-metadata.v1';
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

      const malformed = spawnSync(process.execPath, [path.join(temp, 'scripts/ci/gen-claude-user-config.js'), '--check'], { encoding: 'utf8' });
      assert.strictEqual(malformed.status, 1, `${malformed.stdout}\n${malformed.stderr}`);
      assert.match(`${malformed.stdout}\n${malformed.stderr}`, /metadata source schema must be dhpk\.plugin-user-config-metadata\.v1/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}
// END lexical source block: tests/gen-claude-user-config.test.js

run('plugin-user-config-metadata');
