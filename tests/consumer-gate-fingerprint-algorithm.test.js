'use strict';

// The consumer gate verifies a receipt only by tree-merkle-v1 (OpenSpec
// remove-legacy-tree-fingerprints, consumer-post-install-validation delta).
// Receipts here are written by the real installer in a temp project; the frozen
// previous-installer receipt serves as the marker-less fixture.

const fs = require('node:fs');
const { makeTempDir } = require('./_lib/temp-dir');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');
const {
  discoverCodexSurfaces,
  fingerprintDir,
  fingerprintPath,
  fingerprintProjectSkill,
} = require('../scripts/release/consumer-gate');

const { ROOT, runInstaller, projectRoot } = fixtures;
const FIXTURE = path.join(__dirname, 'fixtures', 'tree-fingerprint', 'installer');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const tempDir = (label) => fs.realpathSync(makeTempDir(`dhpk-gatealg-${label}-`));

function minimalPlugin() {
  const plugin = tempDir('plugin');
  fs.cpSync(path.join(FIXTURE, 'destination'), path.join(plugin, 'codex'), { recursive: true });
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
    path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
  );
  fs.mkdirSync(path.join(plugin, 'manifests'), { recursive: true });
  writeJson(path.join(plugin, 'manifests', 'distribution-inventory.json'), {
    skills: [{
      id: 'sample', name: 'sample-skill', path: 'skills/sample-skill', legacy_names: [],
      lifecycle: 'promoted', surfaces: ['codex-sync'],
    }],
    supporting_assets: [],
  });
  return plugin;
}

function installedProject() {
  const project = projectRoot();
  const plugin = minimalPlugin();
  const result = runInstaller(project, ['--copy', '--force'], plugin);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return { project, plugin, receiptPath: path.join(project, '.codex', '.dhpk-installed.json') };
}

// A project a pre-0.69 installer left behind: no fingerprint_algorithm.
function legacyProject() {
  const project = projectRoot();
  const codex = path.join(project, '.codex');
  fs.cpSync(path.join(FIXTURE, 'destination'), codex, { recursive: true });
  const receiptPath = path.join(codex, '.dhpk-installed.json');
  fs.copyFileSync(path.join(FIXTURE, 'legacy-receipt.json'), receiptPath);
  return { project, plugin: minimalPlugin(), receiptPath };
}

function projectEntries({ project, plugin }) {
  const emptyNative = path.join(plugin, 'plugins', 'dhpk');
  const { project: entries } = discoverCodexSurfaces({ root: plugin, project, version: '0.0.0', nativeRoot: emptyNative });
  return entries;
}

const skillOf = (entries) => entries.find((entry) => entry.kind === 'skills' && entry.id === 'sample-skill');
const editSkill = (project) => fs.appendFileSync(path.join(project, '.codex', 'skills', 'sample-skill', 'references', 'notes.md'), 'edited\n');

test('a receipt naming tree-merkle-v1 verifies every unchanged entry', () => {
  const installed = installedProject();
  assert.strictEqual(readJson(installed.receiptPath).fingerprint_algorithm, 'tree-merkle-v1');
  const entries = projectEntries(installed);
  assert.ok(skillOf(entries), 'the nested skill directory is discovered');
  for (const entry of entries) {
    assert.strictEqual(entry.fingerprintError, undefined, `${entry.kind}/${entry.id}`);
    assert.strictEqual(entry.owned, true, `${entry.kind}/${entry.id}`);
  }
});

test('an edited destination fails ownership under the tree recipe', () => {
  const prepared = installedProject();
  editSkill(prepared.project);
  assert.strictEqual(skillOf(projectEntries(prepared)).owned, false);
});

test('a marker-less receipt is a failed fingerprint check naming the field and the 0.70.0 boundary', () => {
  const legacy = legacyProject();
  assert.ok(!('fingerprint_algorithm' in readJson(legacy.receiptPath)));
  const entries = projectEntries(legacy);
  assert.ok(skillOf(entries));
  for (const entry of entries) {
    assert.match(entry.fingerprintError, /fingerprint_algorithm.*absent.*0\.70\.0/, `${entry.kind}/${entry.id}`);
    assert.strictEqual(entry.owned, false, `${entry.kind}/${entry.id}`);
  }
});

test('an unknown algorithm in the receipt is a failed fingerprint check naming the field and value', () => {
  const prepared = installedProject();
  const receipt = readJson(prepared.receiptPath);
  receipt.fingerprint_algorithm = 'tree-merkle-v9';
  writeJson(prepared.receiptPath, receipt);
  const entries = projectEntries(prepared);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.match(entry.fingerprintError, /fingerprint_algorithm.*tree-merkle-v9/, `${entry.kind}/${entry.id}`);
    assert.strictEqual(entry.owned, false);
  }
});

test('an entry-level legacy marker in a tree-merkle-v1 receipt fails that entry', () => {
  const prepared = installedProject();
  const receipt = readJson(prepared.receiptPath);
  receipt.managed_entries.skills['sample-skill'].fingerprint_algorithm = 'legacy';
  writeJson(prepared.receiptPath, receipt);
  const entries = projectEntries(prepared);
  const skill = skillOf(entries);
  assert.match(skill.fingerprintError, /fingerprint_algorithm.*"legacy"/);
  assert.strictEqual(skill.owned, false);
});

function nativePackage(provenance) {
  const nativeRoot = tempDir('native');
  fs.cpSync(path.join(FIXTURE, 'destination', 'skills'), path.join(nativeRoot, 'skills'), { recursive: true });
  if (provenance) writeJson(path.join(nativeRoot, 'provenance.json'), provenance);
  return nativeRoot;
}

function nativeEntries(nativeRoot) {
  const plugin = minimalPlugin();
  const project = projectRoot();
  return discoverCodexSurfaces({ root: plugin, project, version: '0.0.0', nativeRoot }).native;
}

test('a native package without provenance.json is a failed fingerprint check naming the field', () => {
  const entries = nativeEntries(nativePackage(null));
  assert.ok(entries.length > 0);
  for (const entry of entries) assert.match(entry.fingerprintError, /fingerprintAlgorithm.*absent.*0\.70\.0/);
});

test('a native package whose provenance lacks fingerprintAlgorithm fails naming the field', () => {
  const entries = nativeEntries(nativePackage({ packageVersion: '0.0.0' }));
  assert.ok(entries.length > 0);
  for (const entry of entries) assert.match(entry.fingerprintError, /fingerprintAlgorithm.*absent/);
});

test('a native package naming an unknown fingerprintAlgorithm fails naming field and value', () => {
  const entries = nativeEntries(nativePackage({ fingerprintAlgorithm: 'tree-merkle-v9' }));
  assert.ok(entries.length > 0);
  for (const entry of entries) assert.match(entry.fingerprintError, /fingerprintAlgorithm.*tree-merkle-v9/);
});

test('a project without any receipt is not a fingerprint failure', () => {
  const project = projectRoot();
  fs.cpSync(path.join(FIXTURE, 'destination'), path.join(project, '.codex'), { recursive: true });
  const entries = projectEntries({ project, plugin: minimalPlugin() });
  assert.ok(entries.length > 0);
  for (const entry of entries) assert.strictEqual(entry.fingerprintError, undefined);
});

test('an installer-written symlink-mode receipt verifies through the role and resource contract', () => {
  const project = projectRoot();
  const result = runInstaller(project, ['--force']);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = readJson(path.join(project, '.codex', '.dhpk-installed.json'));
  assert.strictEqual(receipt.fingerprint_algorithm, 'tree-merkle-v1');
  const [name, entry] = Object.entries(receipt.managed_entries.supporting_assets).find(([, value]) => value.mode === 'symlink');
  const gateValue = fingerprintPath(path.join(project, '.codex', ...name.split('/')), { allowedRoots: [project, ROOT], algorithm: 'tree-merkle-v1' });
  assert.strictEqual(entry.destination_fingerprint, gateValue);
  assert.strictEqual(entry.destination_fingerprint, entry.source_fingerprint);
});

test('fingerprintPath defaults to the tree recipe and agrees with fingerprintDir and fingerprintProjectSkill', () => {
  const dir = tempDir('tree');
  fs.mkdirSync(path.join(dir, 'a', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'x.md'), 'x');
  fs.writeFileSync(path.join(dir, 'b.md'), 'b');
  const options = { allowedRoots: [dir] };
  const viaDefault = fingerprintPath(dir, options);
  assert.strictEqual(fingerprintPath(dir, { ...options, algorithm: 'tree-merkle-v1' }), viaDefault);
  assert.strictEqual(fingerprintProjectSkill(dir, options), viaDefault);
  assert.strictEqual(fingerprintDir(dir), viaDefault);
});

test('fingerprintPath rejects a legacy or unknown algorithm with the version-boundary diagnostic', () => {
  const dir = tempDir('reject');
  fs.writeFileSync(path.join(dir, 'b.md'), 'b');
  for (const algorithm of ['legacy', 'nope']) {
    assert.throws(
      () => fingerprintPath(dir, { allowedRoots: [dir], algorithm }),
      new RegExp(`'algorithm'.*"${algorithm}".*0\\.70\\.0`),
      algorithm,
    );
  }
});

test('a single-file identity digest keeps sha256("file\\0" + bytes), the tree-merkle-v1 leaf', () => {
  const dir = tempDir('identity');
  const file = path.join(dir, 'hello.txt');
  fs.writeFileSync(file, 'hello\n');
  // Pinned literal: printf 'file\0hello\n' | sha256sum, captured before hashNode was removed.
  const pinned = 'e9eccd80570fc6ff6c0f1a32492ca695b0cef8cd1937cd12bee7db8db5e81052';
  assert.strictEqual(fingerprintPath(file, { allowedRoots: [dir] }), pinned);
});

run('consumer-gate-fingerprint-algorithm');
