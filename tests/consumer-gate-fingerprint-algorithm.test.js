'use strict';

// The consumer gate verifies a receipt by the recipe the receipt names
// (OpenSpec unify-tree-fingerprint-algorithm, consumer-post-install-validation
// delta). Receipts here are written by the real installer in a temp project, or
// are the frozen receipt of the previous installer.

const fs = require('node:fs');
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
const tempDir = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-gatealg-${label}-`)));

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

// A project the previous installer left behind: no fingerprint_algorithm.
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

test('a legacy receipt without fingerprint_algorithm verifies during the transition', () => {
  const legacy = legacyProject();
  assert.ok(!('fingerprint_algorithm' in readJson(legacy.receiptPath)));
  const entries = projectEntries(legacy);
  assert.ok(skillOf(entries));
  for (const entry of entries) assert.strictEqual(entry.owned, true, `${entry.kind}/${entry.id}`);
});

test('an edited destination fails ownership under the tree recipe and under the legacy recipe', () => {
  for (const [label, make] of [['tree-merkle-v1', installedProject], ['legacy', legacyProject]]) {
    const prepared = make();
    editSkill(prepared.project);
    const entries = projectEntries(prepared);
    assert.strictEqual(skillOf(entries).owned, false, label);
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

test('a legacy-marked entry kept by the installer is proven with the legacy recipe once the edit is reverted', () => {
  const prepared = legacyProject();
  const notes = path.join(prepared.project, '.codex', 'skills', 'sample-skill', 'references', 'notes.md');
  const original = fs.readFileSync(notes, 'utf8');
  editSkill(prepared.project);
  const blocked = runInstaller(prepared.project, ['--copy', '--update', '--force'], prepared.plugin);
  assert.strictEqual(blocked.status, 1, `${blocked.stdout}\n${blocked.stderr}`);
  const receipt = readJson(prepared.receiptPath);
  assert.strictEqual(receipt.fingerprint_algorithm, 'tree-merkle-v1');
  assert.strictEqual(receipt.managed_entries.skills['sample-skill'].fingerprint_algorithm, 'legacy');
  assert.strictEqual(skillOf(projectEntries(prepared)).owned, false, 'the edited skill is not owned');
  fs.writeFileSync(notes, original);
  assert.strictEqual(skillOf(projectEntries(prepared)).owned, true, 'the restored skill matches its legacy value');
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

test('fingerprintPath and fingerprintDir agree per algorithm and differ across algorithms', () => {
  const dir = tempDir('tree');
  fs.mkdirSync(path.join(dir, 'a', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'x.md'), 'x');
  fs.writeFileSync(path.join(dir, 'b.md'), 'b');
  const options = { allowedRoots: [dir] };
  for (const algorithm of ['legacy', 'tree-merkle-v1']) {
    assert.strictEqual(fingerprintProjectSkill(dir, { ...options, algorithm }), fingerprintDir(dir, { algorithm }), algorithm);
  }
  const legacyPath = fingerprintPath(dir, options);
  assert.strictEqual(fingerprintPath(dir, { ...options, algorithm: 'legacy' }), legacyPath, 'default stays legacy');
  assert.notStrictEqual(fingerprintPath(dir, { ...options, algorithm: 'tree-merkle-v1' }), legacyPath);
  assert.throws(() => fingerprintPath(dir, { ...options, algorithm: 'nope' }), /unknown fingerprint algorithm/);
});

run('consumer-gate-fingerprint-algorithm');
