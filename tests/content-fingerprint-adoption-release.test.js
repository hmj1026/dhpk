'use strict';

// Adoption checks for the release, dispatch, and traversal-budget call sites
// that moved onto scripts/lib/content-fingerprint.js. Oracles are the removed
// local implementations, restated here so the moved output stays pinned.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fingerprint = require('../scripts/lib/content-fingerprint');
const receipts = require('../scripts/lib/receipt-primitives');
const { packageFingerprints } = require('../scripts/lib/release-artifact-manifest');
const { buildDispatchProjection } = require('../scripts/lib/dispatch-projection');

const ROOT = path.resolve(__dirname, '..');
const ADVERSARIAL = path.join(__dirname, 'fixtures', 'content-fingerprint', 'adversarial');

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `content-fingerprint-adoption-${label}-`));
}

// Removed release-artifact-manifest.js implementation, verbatim recipe.
function legacyCanonical(value) {
  if (Array.isArray(value)) return value.map(legacyCanonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, legacyCanonical(value[key])]));
}

function legacyPackageFingerprints(root) {
  const content = crypto.createHash('sha256');
  const modes = crypto.createHash('sha256');
  const walk = (directory, relative) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const absolute = path.join(directory, entry.name);
      const rel = path.posix.join(relative, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) { walk(absolute, rel); continue; }
      content.update(rel); content.update('\0'); content.update(fs.readFileSync(absolute));
      modes.update(rel); modes.update('\0'); modes.update(String(stat.mode & 0o7777)); modes.update('\0');
    }
  };
  walk(root, '');
  const contentFingerprint = `sha256:${content.digest('hex')}`;
  const modeFingerprint = `sha256:${modes.digest('hex')}`;
  const artifactFingerprint = `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(legacyCanonical({ contentFingerprint, modeFingerprint }))).digest('hex')}`;
  return { contentFingerprint, modeFingerprint, artifactFingerprint };
}

test('release packageFingerprints matches the removed walker on the adversarial tree and a real package', () => {
  for (const root of [ADVERSARIAL, path.join(ROOT, 'plugins', 'dhpk-cursor')]) {
    assert.deepStrictEqual(packageFingerprints(root), legacyPackageFingerprints(root));
  }
});

test('release packageFingerprints still reports a symlink as an error', () => {
  const dir = tempDir('symlink');
  try {
    fs.writeFileSync(path.join(dir, 'real.txt'), 'x');
    fs.symlinkSync('real.txt', path.join(dir, 'link.txt'));
    assert.throws(() => packageFingerprints(dir), /symlink/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('projection fingerprint equals the dispatch-contract digest recipe', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'dispatch-contract.js'), 'utf8');
  const body = source.match(/function digest\(value\) \{\n([\s\S]*?)\n\}/);
  assert.ok(body, 'dispatch-contract.js must keep its local digest(value)');
  const contractDigest = new Function('crypto', `return function digest(value) {\n${body[1]}\n};`)(crypto);
  for (const value of [['a.js', 'b.js'], [], { z: 1, a: ['é', '\u{1F600}'] }, 'text']) {
    assert.strictEqual(contractDigest(value), fingerprint.sha256Hex(JSON.stringify(value)));
  }
  const projection = buildDispatchProjection({
    surface: 'cursor-plugin',
    catalog: require('../manifests/provider-model-catalog.json'),
    hostProfiles: require('../manifests/host-profiles.json'),
  });
  const { fingerprint: recorded, ...rest } = projection;
  assert.strictEqual(recorded, contractDigest(rest));
});

test('fingerprintDirectory has no default traversal budget for very large trees', () => {
  const dir = tempDir('large');
  try {
    const bulk = path.join(dir, 'bulk');
    fs.mkdirSync(bulk);
    for (let index = 0; index < 20001; index += 1) fs.writeFileSync(path.join(bulk, `f${index}`), '');
    let deep = path.join(dir, 'deep');
    for (let index = 0; index < 66; index += 1) deep = path.join(deep, 'd');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'leaf.txt'), 'leaf');
    const first = receipts.fingerprintDirectory(dir);
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(receipts.fingerprintDirectory(dir), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit traversal budget still bounds collectDirectoryEntries', () => {
  const dir = tempDir('budget');
  try {
    fs.writeFileSync(path.join(dir, 'a'), '1');
    fs.writeFileSync(path.join(dir, 'b'), '2');
    const { createTraversalBudget } = require('../scripts/lib/bounded-filesystem');
    assert.throws(
      () => fingerprint.collectDirectoryEntries(dir, { budget: createTraversalBudget({ maxFiles: 1 }) }),
      /maximum fingerprint file count/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('standalone publication verifier digests equal the shared module on the same vectors', () => {
  const verifier = require('../scripts/release/verify-publication-bundle');
  const vectors = [
    { b: 2, a: { z: [3, { y: 1, x: 2 }], m: null }, c: 'plain' },
    [{ b: 1, a: 2 }, [{ d: 4, c: 3 }]],
    { 'é': '\u00e9', emoji: '\u{1F600}', 'key \u4e2d': ['\u4e2d\u6587'] },
    'scalar',
    {},
  ];
  for (const value of vectors) {
    assert.strictEqual(verifier.digestJson(value), fingerprint.canonicalJsonSha256Prefixed(value));
    assert.strictEqual(
      verifier.digestJson(value),
      `sha256:${fingerprint.sha256Hex(Buffer.from(fingerprint.canonicalJson(value), 'utf8'))}`,
    );
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from([0x80, 0xff, 0x00]), Buffer.from('\u4e2d\u6587 \u{1F600}')]) {
    assert.strictEqual(verifier.digestBytes(bytes), `sha256:${fingerprint.sha256Hex(bytes)}`);
  }
});

run('content-fingerprint-adoption-release');
