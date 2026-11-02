'use strict';

// OpenSpec unify-tree-fingerprint-algorithm task 4.1 and
// remove-legacy-tree-fingerprints task 4: the package generators write
// `tree-merkle-v1` values plus the `fingerprintAlgorithm` marker, and the
// verifiers require that marker (absent or unknown = fail closed with the
// version-boundary diagnostic). Oracles are computed here from the shared
// recipe over real files, never from the code under test.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  TREE_FINGERPRINT_ALGORITHM,
  treeFingerprint,
  treeNodeFingerprint,
  collectDirectoryEntries,
  versionBoundaryMessage,
} = require('../scripts/lib/content-fingerprint');
const codex = require('../scripts/lib/codex-native-package');
const agent = require('../scripts/lib/agent-plugin-package');
const cursor = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const TDD = { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted' };

function tempDir(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `tree-surface-${label}-`)));
}

function withDir(label, callback) {
  const dir = tempDir(label);
  try { return callback(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function fileEntries(directory) {
  return collectDirectoryEntries(directory, { skipBytecode: true }).filter((entry) => entry.type === 'file');
}

// A digest produced by the removed flat file-set recipe (fileSetFingerprintLocale)
// over tests/fixtures/content-fingerprint/adversarial, captured on 2026-11-02
// before the recipe was deleted. It stands for "a value from a removed recipe":
// under the tree marker it must read as drift.
const REMOVED_RECIPE_DIGEST = '5210043f319dc84e262ddee0a77724c368655b6c2601abd5b2246d5bc89a2c62';

// Independent oracle: the shared recipe over the files actually on disk.
function oracleTree(directory) { return treeFingerprint(fileEntries(directory)); }

// The one diagnostic every verifier raises for a missing or unknown marker.
const ABSENT_MARKER = versionBoundaryMessage('fingerprintAlgorithm', undefined);
const UNKNOWN_MARKER = versionBoundaryMessage('fingerprintAlgorithm', 'tree-merkle-v9');

// ---------------------------------------------------------------------------
test('treeNodeFingerprint: a file prefix is its bare leaf, a directory prefix equals the re-rooted tree, a missing prefix is empty', () => {
  const entries = [
    { path: 'skills/a/SKILL.md', type: 'file', content: Buffer.from('a') },
    { path: 'skills/a/ref.md', type: 'file', content: Buffer.from('b') },
    { path: 'hooks/hooks.json', type: 'file', content: Buffer.from('{}') },
  ];
  const leaf = crypto.createHash('sha256').update('file\0').update('{}').digest('hex');
  assert.strictEqual(treeNodeFingerprint(entries, 'hooks/hooks.json'), leaf);
  assert.strictEqual(
    treeNodeFingerprint(entries, 'skills'),
    treeFingerprint([{ path: 'a/SKILL.md', type: 'file', content: Buffer.from('a') }, { path: 'a/ref.md', type: 'file', content: Buffer.from('b') }]),
  );
  assert.strictEqual(treeNodeFingerprint(entries, 'rules'), '');
  assert.strictEqual(treeNodeFingerprint(entries, 'hooks/hooks.json/x'), '');
});

// ---------------------------------------------------------------------------
// Codex native
// ---------------------------------------------------------------------------

function materializeCodex(outDir) {
  const inventory = { skills: [{ ...TDD, surfaces: ['claude-core', 'codex-native'] }] };
  return { inventory, result: codex.materializeNativePackage({ inventory, root: ROOT, outDir, version: '1.2.3', sourceCommit: 'abc123' }) };
}

test('Codex native: writer emits tree-merkle-v1 values, the marker, and the bumped generator version', () => withDir('codex', (out) => {
  assert.strictEqual(codex.GENERATOR_VERSION, '2.4.0');
  materializeCodex(out);
  const provenance = readJson(path.join(out, 'provenance.json'));
  assert.strictEqual(provenance.fingerprintAlgorithm, TREE_FINGERPRINT_ALGORITHM);
  assert.strictEqual(provenance.generatorVersion, '2.4.0');
  const recorded = readJson(path.join(out, 'fingerprints.json'));
  const skillDir = path.join(out, 'skills', 'tdd-workflow');
  assert.strictEqual(recorded['tdd-workflow'], oracleTree(skillDir));
}));

test('Codex native: fingerprintDir computes the tree recipe and rejects any other algorithm', () => withDir('codex-dir', (out) => {
  materializeCodex(out);
  const skillDir = path.join(out, 'skills', 'tdd-workflow');
  assert.strictEqual(codex.fingerprintDir(skillDir), oracleTree(skillDir));
  assert.strictEqual(codex.fingerprintDir(skillDir, { algorithm: TREE_FINGERPRINT_ALGORITHM }), oracleTree(skillDir));
  assert.throws(() => codex.fingerprintDir(skillDir, { algorithm: 'tree-merkle-v9' }), (error) => error.message === UNKNOWN_MARKER);
  assert.throws(() => codex.fingerprintDir(skillDir, { algorithm: 'legacy' }), /0\.70\.0 accepts only records written by 0\.69\.x/);
}));

test('Codex native: verifyNativePackage accepts the marker and fails closed on a missing, absent, or unknown marker', () => withDir('codex-verify', (out) => {
  const { inventory } = materializeCodex(out);
  const verify = () => codex.verifyNativePackage({ packageRoot: out, inventory, sourceRoot: ROOT, stage: 'structural' });
  assert.strictEqual(verify().ok, true, verify().errors.join('; '));
  const provenancePath = path.join(out, 'provenance.json');
  const provenance = readJson(provenancePath);
  const expectFailClosed = (message, label) => {
    const rejected = verify();
    assert.strictEqual(rejected.ok, false, label);
    assert.ok(rejected.errors.some((error) => error.includes(message)), `${label}: ${rejected.errors.join('; ')}`);
  };
  const { fingerprintAlgorithm: _removed, ...markerless } = provenance;
  writeJson(provenancePath, markerless);
  expectFailClosed(ABSENT_MARKER, 'provenance without the marker');
  writeJson(provenancePath, { ...provenance, fingerprintAlgorithm: 'tree-merkle-v9' });
  expectFailClosed(UNKNOWN_MARKER, 'unknown marker');
  fs.rmSync(provenancePath);
  expectFailClosed(ABSENT_MARKER, 'package without provenance.json');
}));

// ---------------------------------------------------------------------------
// Agent Plugin (the AGY package holds only per-file sha256 values, row 17)
// ---------------------------------------------------------------------------

function materializeAgent(outDir) {
  const inventory = { skills: [{ ...TDD, surfaces: ['claude-core', 'agent-plugin'] }] };
  agent.materializeAgentPluginPackage({ inventory, root: ROOT, outDir, version: '1.2.3', sourceCommit: 'abc123' });
  return inventory;
}

test('Agent Plugin: writer emits tree-merkle-v1 values, the marker, and the bumped generator version', () => withDir('agent', (out) => {
  assert.strictEqual(agent.GENERATOR_VERSION, '1.1.0');
  materializeAgent(out);
  const provenance = readJson(path.join(out, 'provenance.json'));
  assert.strictEqual(provenance.fingerprintAlgorithm, TREE_FINGERPRINT_ALGORITHM);
  assert.strictEqual(provenance.generatorVersion, '1.1.0');
  const recorded = readJson(path.join(out, 'fingerprints.json'));
  assert.strictEqual(recorded.generatorVersion, '1.1.0');
  assert.ok(!Object.hasOwn(recorded, 'fingerprintAlgorithm'), 'fingerprints.json keeps its flat shape');
  const skillDir = path.join(out, 'skills', 'tdd-workflow');
  assert.strictEqual(recorded.skills['tdd-workflow'], oracleTree(skillDir));
}));

test('Agent Plugin: fingerprintDir computes the tree recipe and rejects any other algorithm', () => withDir('agent-dir', (out) => {
  materializeAgent(out);
  const skillDir = path.join(out, 'skills', 'tdd-workflow');
  assert.strictEqual(agent.fingerprintDir(skillDir), oracleTree(skillDir));
  assert.strictEqual(agent.fingerprintDir(skillDir, { algorithm: TREE_FINGERPRINT_ALGORITHM }), oracleTree(skillDir));
  assert.throws(() => agent.fingerprintDir(skillDir, { algorithm: 'tree-merkle-v9' }), (error) => error.message === UNKNOWN_MARKER);
  assert.throws(() => agent.fingerprintDir(skillDir, { algorithm: 'legacy' }), /0\.70\.0 accepts only records written by 0\.69\.x/);
}));

test('Agent Plugin: the validator selects the recipe from the marker, never both', () => withDir('agent-verify', (out) => {
  materializeAgent(out);
  const fingerprintErrors = () => agent.validateAgentPluginPackage(out).errors.filter((error) => /fingerprint/i.test(error));
  assert.deepStrictEqual(fingerprintErrors(), []);

  const provenancePath = path.join(out, 'provenance.json');
  const fingerprintsPath = path.join(out, 'fingerprints.json');
  const provenance = readJson(provenancePath);
  const fingerprints = readJson(fingerprintsPath);

  // Legacy values under the new marker are drift.
  writeJson(fingerprintsPath, { ...fingerprints, skills: { 'tdd-workflow': REMOVED_RECIPE_DIGEST } });
  assert.ok(fingerprintErrors().some((error) => /drifted/.test(error)), 'legacy value under the tree marker must be rejected');

  writeJson(provenancePath, { ...provenance, fingerprintAlgorithm: 'tree-merkle-v9' });
  assert.ok(fingerprintErrors().some((error) => error.includes(UNKNOWN_MARKER)));

  const { fingerprintAlgorithm: _removed, ...markerless } = provenance;
  writeJson(provenancePath, markerless);
  assert.ok(fingerprintErrors().some((error) => error.includes(ABSENT_MARKER)), 'a marker-less package fails closed');

  fs.rmSync(provenancePath);
  assert.ok(fingerprintErrors().some((error) => error.includes(ABSENT_MARKER)), 'a package without provenance.json fails closed');
}));

test('Agent Plugin: unparseable provenance.json fails closed as unreadable, not as an absent marker', () => withDir('agent-unreadable', (out) => {
  materializeAgent(out);
  fs.writeFileSync(path.join(out, 'provenance.json'), '{ not json');
  const errors = agent.validateAgentPluginPackage(out).errors.filter((error) => /provenance\.json/.test(error));
  assert.ok(errors.some((error) => error.includes('provenance.json is unreadable')), errors.join('; '));
  assert.ok(!errors.some((error) => error.includes(ABSENT_MARKER)), 'a parse error is not reported as an absent marker');
}));

test('AGY: the package carries no directory-level tree value and no tree marker (row 17)', () => {
  const provenance = readJson(path.join(ROOT, 'plugins', 'dhpk-agy', 'provenance.json'));
  const files = Object.keys(readJson(path.join(ROOT, 'plugins', 'dhpk-agy', 'fingerprints.json')).files);
  assert.ok(files.length > 0);
  assert.ok(files.every((relative) => fs.statSync(path.join(ROOT, 'plugins', 'dhpk-agy', relative)).isFile()));
  assert.ok(!Object.hasOwn(provenance, 'fingerprintAlgorithm'));
});

// ---------------------------------------------------------------------------
// Cursor: values must not change
// ---------------------------------------------------------------------------

function materializeCursor(outDir) {
  cursor.materializeCursorPackage({ inventory: INVENTORY, root: ROOT, outDir, version: '1.2.3', sourceCommit: 'abc123' });
}

test('Cursor: writer emits the marker and the bumped version while every digest equals the tree value', () => withDir('cursor', (out) => {
  assert.strictEqual(cursor.GENERATOR_VERSION, '1.1.0');
  materializeCursor(out);
  const provenance = readJson(path.join(out, 'provenance.json'));
  assert.strictEqual(provenance.fingerprintAlgorithm, TREE_FINGERPRINT_ALGORITHM);
  assert.strictEqual(provenance.generatorVersion, '1.1.0');
  const recorded = readJson(path.join(out, 'fingerprints.json'));
  const keys = Object.keys(recorded);
  assert.ok(keys.length > 0);
  for (const key of keys) {
    const target = path.join(out, key);
    assert.strictEqual(recorded[key], cursor.fingerprintPath(target), `${key} equals the default recipe`);
    assert.strictEqual(recorded[key], cursor.fingerprintPath(target, { algorithm: TREE_FINGERPRINT_ALGORITHM }), `${key} equals the tree recipe`);
    const expected = fs.statSync(target).isFile()
      ? crypto.createHash('sha256').update('file\0').update(fs.readFileSync(target)).digest('hex')
      : oracleTree(target);
    assert.strictEqual(recorded[key], expected, key);
  }
}));

test('Cursor: fingerprintPath computes the tree recipe and rejects any other algorithm', () => withDir('cursor-path', (out) => {
  materializeCursor(out);
  const target = path.join(out, 'hooks');
  assert.strictEqual(cursor.fingerprintPath(target), oracleTree(target));
  assert.throws(() => cursor.fingerprintPath(target, { algorithm: 'tree-merkle-v9' }), (error) => error.message === UNKNOWN_MARKER);
  assert.throws(() => cursor.fingerprintPath(target, { algorithm: 'legacy' }), /0\.70\.0 accepts only records written by 0\.69\.x/);
}));

test('Cursor: the validator requires the marker before comparing and fails closed on an absent or unknown algorithm', () => withDir('cursor-verify', (out) => {
  materializeCursor(out);
  const fingerprintErrors = () => cursor.validateCursorPackage({ packageRoot: out }).errors.filter((error) => /fingerprint/i.test(error));
  assert.deepStrictEqual(fingerprintErrors(), []);
  const provenancePath = path.join(out, 'provenance.json');
  const provenance = readJson(provenancePath);
  const { fingerprintAlgorithm: _removed, ...markerless } = provenance;
  writeJson(provenancePath, markerless);
  assert.ok(fingerprintErrors().some((error) => error.includes(ABSENT_MARKER)), 'a marker-less package fails closed');
  writeJson(provenancePath, { ...provenance, fingerprintAlgorithm: 'tree-merkle-v9' });
  assert.ok(fingerprintErrors().some((error) => error.includes(UNKNOWN_MARKER)));
  fs.rmSync(provenancePath);
  assert.ok(fingerprintErrors().some((error) => error.includes(ABSENT_MARKER)), 'a package without provenance.json fails closed');
  writeJson(provenancePath, provenance);
  writeJson(provenancePath, provenance);
  fs.appendFileSync(path.join(out, 'README.md'), 'x');
  fs.appendFileSync(path.join(out, 'hooks', 'hooks.json'), ' ');
  assert.ok(fingerprintErrors().some((error) => /does not match package content/.test(error)), 'a real edit is still detected');
}));

test('Cursor: unparseable provenance.json fails closed as unreadable, not as an absent marker', () => withDir('cursor-unreadable', (out) => {
  materializeCursor(out);
  fs.writeFileSync(path.join(out, 'provenance.json'), '{ not json');
  const errors = cursor.validateCursorPackage({ packageRoot: out }).errors.filter((error) => /provenance\.json/.test(error));
  assert.ok(errors.some((error) => error.includes('provenance.json is unreadable')), errors.join('; '));
  assert.ok(!errors.some((error) => error.includes(ABSENT_MARKER)), 'a parse error is not reported as an absent marker');
}));

run('tree-fingerprint-package-surfaces');
