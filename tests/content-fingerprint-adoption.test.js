'use strict';

// Adoption of scripts/lib/content-fingerprint.js by the package generators
// (OpenSpec consolidate-content-fingerprints, tasks 3.3-3.6). The expected
// values are literals captured from the pre-consolidation implementations, so
// they do not depend on the code under test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { fingerprintDir: codexFingerprintDir } = require('../scripts/lib/codex-native-package');
const { fingerprintDir: agentFingerprintDir } = require('../scripts/lib/agent-plugin-package');
const { fingerprintPath: cursorFingerprintPath, validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.resolve(__dirname, '..');
const ADVERSARIAL = path.join(__dirname, 'fixtures', 'content-fingerprint', 'adversarial');

// Old writers (nativeSkillFingerprint / fingerprintProjectedFiles): flat sort of
// destination paths, so `a.txt` precedes `a/inner.txt`.
const OLD_WRITER = Object.freeze({
  codex: 'bccb2fd5c913a88ec051b2742f7f923a21c17d091cdf15e38af6a5c7229b406f',
  agent: '5210043f319dc84e262ddee0a77724c368655b6c2601abd5b2246d5bc89a2c62',
});

// Old disk verifiers (fingerprintDir): per-directory sort, so `a/inner.txt`
// precedes `a.txt`. They disagreed with the writers on this tree.
const OLD_VERIFIER = Object.freeze({
  codex: '4b4bd3d47a947dad0b6bb88c8c1ee5839992753591309fa285dd2d645c74c55c',
  agent: '923bb5c74d70436ee00b69e799cca24a94023420f3818b69561b81feadbd3867',
});

// Old Cursor disk Merkle; the Cursor writer and verifier already agreed.
const OLD_CURSOR = Object.freeze({
  root: '1d56ef053ae0ecc36759c3da399c0e5045a1e6767d050be8072de253ed72650d',
  emptyDirectory: '4b66bf93b3932a9539880b2421e35019af9daf84363a0246280ffcac173b2678',
});

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `content-fingerprint-adoption-${label}-`));
}

function buildAdversarialTree() {
  const dir = tempDir('adversarial');
  fs.cpSync(ADVERSARIAL, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.mkdirSync(path.join(dir, '__pycache__'));
  fs.writeFileSync(path.join(dir, '__pycache__', 'x.pyc'), 'pyc');
  fs.writeFileSync(path.join(dir, 'skip.pyc'), 'pyc2');
  return dir;
}

test('old writer and old verifier disagreed on the prefix-colliding tree', () => {
  assert.notStrictEqual(OLD_WRITER.codex, OLD_VERIFIER.codex);
  assert.notStrictEqual(OLD_WRITER.agent, OLD_VERIFIER.agent);
});

test('Codex fingerprintDir now returns the old writer value on the prefix-colliding tree', () => {
  const dir = buildAdversarialTree();
  try {
    assert.strictEqual(codexFingerprintDir(dir), OLD_WRITER.codex);
    assert.notStrictEqual(codexFingerprintDir(dir), OLD_VERIFIER.codex);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent fingerprintDir now returns the old writer value on the prefix-colliding tree', () => {
  const dir = buildAdversarialTree();
  try {
    assert.strictEqual(agentFingerprintDir(dir), OLD_WRITER.agent);
    assert.notStrictEqual(agentFingerprintDir(dir), OLD_VERIFIER.agent);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Cursor fingerprintPath keeps the old disk Merkle values, including an empty directory', () => {
  const dir = buildAdversarialTree();
  try {
    assert.strictEqual(cursorFingerprintPath(dir), OLD_CURSOR.root);
    assert.strictEqual(cursorFingerprintPath(path.join(dir, 'empty')), OLD_CURSOR.emptyDirectory);
    assert.strictEqual(cursorFingerprintPath(path.join(dir, 'missing')), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Cursor validator recomputes every fingerprints.json entry and names a corrupted one', () => {
  const copy = tempDir('cursor');
  try {
    fs.cpSync(path.join(ROOT, 'plugins', 'dhpk-cursor'), copy, { recursive: true });
    const fingerprintsPath = path.join(copy, 'fingerprints.json');
    const fingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8'));
    assert.deepStrictEqual(validateCursorPackage({ packageRoot: copy }).errors, []);
    const corrupted = { ...fingerprints, agents: '0'.repeat(64) };
    fs.writeFileSync(fingerprintsPath, `${JSON.stringify(corrupted, null, 2)}\n`);
    const errors = validateCursorPackage({ packageRoot: copy }).errors;
    assert.deepStrictEqual(errors, ["fingerprints.json entry 'agents' does not match package content"]);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

run('content-fingerprint-adoption');
