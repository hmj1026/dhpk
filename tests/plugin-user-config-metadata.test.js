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
const EXPECTED_ACTIVE_USER_CONFIG_SHA256 = '21635fd9fcbaddc682105395cfa8206ff12b8e3ffd7bf48f80ee1ccd15ce72a2';
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
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { runClaudeUserConfigProbe } = require('../scripts/release/claude-user-config-probe');

  test('configured consumer probe stays non-pass without an exact details binding', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-probe-'));
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      fs.writeFileSync(manifestPath, '{}\n');
      const result = runClaudeUserConfigProbe({
        manifestPath,
        manifestFingerprint: 'a'.repeat(64),
        version: '2.1.238',
        execute: true,
        runner: (command, args) => args[0] === '--version'
          ? { status: 0, stdout: 'claude 2.1.238' }
          : { status: 0, stdout: JSON.stringify({ name: 'dhpk' }) },
      });
      assert.strictEqual(result.status, 'FAIL');
      assert.ok(result.resumeCommand);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probe rejects a stale local manifest even when the consumer reports a forged expected fingerprint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-stale-'));
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      fs.writeFileSync(manifestPath, '{"name":"legacy"}\n');
      const result = runClaudeUserConfigProbe({
        manifestPath,
        manifestFingerprint: 'b'.repeat(64),
        version: '2.1.238',
        execute: true,
        runner: (command, args) => args[0] === '--version'
          ? { status: 0, stdout: 'claude 2.1.238' }
          : { status: 0, stdout: JSON.stringify({ manifestFingerprint: 'b'.repeat(64) }) },
      });
      assert.strictEqual(result.status, 'FAIL');
      assert.match(result.reason, /fingerprint/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probe rejects a prefix-only Claude version and unrelated plugin details', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-version-'));
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      const manifest = { name: 'dhpk' };
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      const crypto = require('node:crypto');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const result = runClaudeUserConfigProbe({
        manifestPath,
        manifestFingerprint: fingerprint,
        version: '2.1.23',
        execute: true,
        runner: (command, args) => args[0] === '--version'
          ? { status: 0, stdout: 'claude 2.1.238' }
          : { status: 0, stdout: JSON.stringify({ name: 'other-plugin', manifestFingerprint: fingerprint }) },
      });
      assert.strictEqual(result.status, 'BLOCKED');
      assert.match(result.reason, /version/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probe requires dhpk identity before accepting fingerprint details', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-identity-'));
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      const manifest = { name: 'dhpk' };
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      const crypto = require('node:crypto');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const result = runClaudeUserConfigProbe({
        manifestPath,
        manifestFingerprint: fingerprint,
        version: '2.1.238',
        execute: true,
        runner: (command, args) => args[0] === '--version'
          ? { status: 0, stdout: 'claude 2.1.238' }
          : { status: 0, stdout: JSON.stringify({ name: 'other-plugin', manifestFingerprint: fingerprint }) },
      });
      assert.strictEqual(result.status, 'BLOCKED');
      assert.match(result.reason, /identity/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probe treats a prerelease suffix as a version mismatch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-prerelease-'));
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      const manifest = { name: 'dhpk' };
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      const crypto = require('node:crypto');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const result = runClaudeUserConfigProbe({
        manifestPath,
        manifestFingerprint: fingerprint,
        version: '2.1.2',
        runner: () => ({ status: 0, stdout: 'claude 2.1.2-beta' }),
      });
      assert.strictEqual(result.status, 'BLOCKED');
      assert.match(result.reason, /version/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probe rejects conflicting consumer fingerprints', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-conflict-'));
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      const manifest = { name: 'dhpk' };
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      const crypto = require('node:crypto');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const other = 'c'.repeat(64);
      const result = runClaudeUserConfigProbe({
        manifestPath,
        manifestFingerprint: fingerprint,
        version: '2.1.238',
        execute: true,
        runner: (command, args) => args[0] === '--version'
          ? { status: 0, stdout: 'claude 2.1.238' }
          : { status: 0, stdout: JSON.stringify({ name: 'dhpk', manifestFingerprint: fingerprint, userConfigFingerprint: other }) },
      });
      assert.strictEqual(result.status, 'FAIL');
      assert.match(result.reason, /conflicting/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
