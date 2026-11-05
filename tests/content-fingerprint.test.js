'use strict';

// Characterization of every persisted-digest algorithm owned by
// scripts/lib/content-fingerprint.js. Expected values are golden vectors that
// were computed by the pre-consolidation implementations (or taken from the
// checked-in plugins/* packages), so a regression in the shared module is
// caught against an oracle that does not use the module itself.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fingerprint = require('../scripts/lib/content-fingerprint');

const ROOT = path.resolve(__dirname, '..');
// 原 fixture 的 B.txt 與 b.txt 在大小寫不敏感檔案系統衝突，磁碟路徑改為獨立名稱。
const ADVERSARIAL = path.join(__dirname, 'fixtures', 'content-fingerprint', 'adversarial');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `content-fingerprint-${label}-`));
}

// The checked-in fixture holds plain files only. Git cannot store empty
// directories, bytecode (ignored), or non-default modes, so those are added to
// a throwaway copy.
function buildAdversarialTree() {
  const dir = tempDir('adversarial');
  fs.cpSync(ADVERSARIAL, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.mkdirSync(path.join(dir, '__pycache__'));
  fs.writeFileSync(path.join(dir, '__pycache__', 'x.pyc'), 'pyc');
  fs.writeFileSync(path.join(dir, 'skip.pyc'), 'pyc2');
  for (const file of ['a.txt', 'a/inner.txt', 'upper-B.txt', 'b.txt', 'sub/Z.txt', 'sub/a.txt', 'sub/binary.bin']) {
    fs.chmodSync(path.join(dir, file), 0o644);
  }
  fs.chmodSync(path.join(dir, 'b.txt'), 0o755);
  return dir;
}

function filesOnly(entries) {
  return entries.filter((entry) => entry.type === 'file');
}

// ---------------------------------------------------------------------------
// Pure byte and JSON recipes
// ---------------------------------------------------------------------------

test('sha256Hex matches the published SHA-256 vectors for strings and bytes', () => {
  assert.strictEqual(fingerprint.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.strictEqual(fingerprint.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(fingerprint.sha256Hex(Buffer.from([0x80])), '76be8b528d0075f7aae98d6fa57a6d3c83ae480a8469e668d7b0af968995ac71');
});

test('sha256Hex encodes strings as UTF-8 and distinguishes raw bytes', () => {
  const expected = '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c';
  assert.strictEqual(fingerprint.sha256Hex('é'), expected);
  assert.strictEqual(fingerprint.sha256Hex(Buffer.from('é', 'utf8')), expected);
  assert.notStrictEqual(fingerprint.sha256Hex(Buffer.from([0x80])), fingerprint.sha256Hex(Buffer.from([0x81])));
});

test('canonicalJson sorts object keys deeply and keeps array order', () => {
  assert.strictEqual(fingerprint.canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.strictEqual(
    fingerprint.canonicalJson({ z: [{ y: 1, x: [3, { b: 1, a: 2 }] }], a: null, 'é': '€', u: undefined }),
    '{"a":null,"z":[{"x":[3,{"a":2,"b":1}],"y":1}],"é":"€"}',
  );
});

test('canonicalJsonSha256Prefixed prefixes the digest of the canonical JSON', () => {
  assert.strictEqual(
    fingerprint.canonicalJsonSha256Prefixed({ b: 2, a: 1 }),
    'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
  );
  assert.strictEqual(
    fingerprint.canonicalJsonSha256Prefixed({ z: [{ y: 1, x: [3, { b: 1, a: 2 }] }], a: null, 'é': '€' }),
    'sha256:1c96ed4ef013ffdb4ca23a0cf9ab1400c1f74d8dffab1e325420c889153ce124',
  );
});

// ---------------------------------------------------------------------------
// Inventory digests
// ---------------------------------------------------------------------------

const INVENTORY = Object.freeze({
  schema: 'x',
  profile_policy: { p: 1 },
  skills: [{ id: 'b', name: 'B' }, { id: 'a' }],
  standalone_dependencies: [1],
  zeta: 1,
  alpha: { y: 2, x: 1 },
  project_agent_projection: { q: 1 },
});

const INVENTORY_REORDERED = Object.freeze({
  alpha: INVENTORY.alpha,
  zeta: 1,
  skills: INVENTORY.skills,
  schema: 'x',
  project_agent_projection: { q: 1 },
  standalone_dependencies: [1],
  profile_policy: { p: 1 },
});

const EMPTY_OBJECT_DIGEST = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

test('inventory digests keep their two distinct serializations', () => {
  assert.strictEqual(fingerprint.inventoryDigestInsertionOrder(INVENTORY), 'eb922c878d9335862d66333c19a5692f0376fcf8891e11048babc22f49c9fa33');
  assert.strictEqual(fingerprint.inventoryDigestKeySorted(INVENTORY), 'ec5d597b51016afbd4248374f4595c6ecd997bac6acffda9dda93c1bda71e89f');
});

test('reordering top-level inventory keys changes only the insertion-order digest (documented risk)', () => {
  assert.strictEqual(fingerprint.inventoryDigestInsertionOrder(INVENTORY_REORDERED), '0d8e6685409c14e78e583a472706642400739f1cafb7b318ef0ab21e2927aeff');
  assert.notStrictEqual(
    fingerprint.inventoryDigestInsertionOrder(INVENTORY_REORDERED),
    fingerprint.inventoryDigestInsertionOrder(INVENTORY),
  );
  assert.strictEqual(
    fingerprint.inventoryDigestKeySorted(INVENTORY_REORDERED),
    fingerprint.inventoryDigestKeySorted(INVENTORY),
  );
});

test('both inventory digests exclude the three compiler-owned keys through one removal', () => {
  const { profile_policy: _p, standalone_dependencies: _s, project_agent_projection: _a, ...rest } = INVENTORY;
  assert.strictEqual(fingerprint.inventoryDigestInsertionOrder(INVENTORY), fingerprint.inventoryDigestInsertionOrder(rest));
  assert.strictEqual(fingerprint.inventoryDigestKeySorted(INVENTORY), fingerprint.inventoryDigestKeySorted(rest));
});

test('inventory digests treat a missing inventory as an empty object', () => {
  for (const missing of [null, undefined]) {
    assert.strictEqual(fingerprint.inventoryDigestInsertionOrder(missing), EMPTY_OBJECT_DIGEST);
    assert.strictEqual(fingerprint.inventoryDigestKeySorted(missing), EMPTY_OBJECT_DIGEST);
  }
});

test('inventory digests do not mutate the inventory they receive', () => {
  const copy = JSON.parse(JSON.stringify(INVENTORY));
  fingerprint.inventoryDigestInsertionOrder(copy);
  fingerprint.inventoryDigestKeySorted(copy);
  assert.deepStrictEqual(copy, JSON.parse(JSON.stringify(INVENTORY)));
});

test('checked-in provenance inventoryDigest values are reproduced from the real inventory', () => {
  const inventory = readJson('manifests/distribution-inventory.json');
  const insertion = fingerprint.inventoryDigestInsertionOrder(inventory);
  const sorted = fingerprint.inventoryDigestKeySorted(inventory);
  assert.strictEqual(readJson('plugins/dhpk/provenance.json').inventoryDigest, insertion);
  assert.strictEqual(readJson('plugins/dhpk-cursor/provenance.json').inventoryDigest, insertion);
  assert.strictEqual(readJson('plugins/dhpk-agent/provenance.json').inventoryDigest, sorted);
  assert.strictEqual(readJson('plugins/dhpk-agy/provenance.json').inventoryDigest, sorted);
  assert.notStrictEqual(insertion, sorted);
});

test('supporting-asset canonical and projection digests are digests of the file bytes', () => {
  const inventory = readJson('manifests/distribution-inventory.json');
  const pairs = inventory.supporting_assets.filter((asset) => asset.canonical_digest);
  assert.ok(pairs.length >= 14, 'expected the checked-in supporting-asset digest pairs');
  for (const asset of pairs) {
    const canonical = fs.readFileSync(path.join(ROOT, asset.canonical_source));
    const projection = fs.readFileSync(path.join(ROOT, asset.source));
    assert.strictEqual(fingerprint.sha256Hex(canonical), asset.canonical_digest, `canonical digest: ${asset.id}`);
    assert.strictEqual(fingerprint.sha256Hex(projection), asset.projection_digest, `projection digest: ${asset.id}`);
    // Hashing the decoded string equals hashing the bytes only for valid UTF-8
    // (design D3); every tracked policy file must stay valid UTF-8.
    for (const bytes of [canonical, projection]) {
      assert.ok(Buffer.from(bytes.toString('utf8')).equals(bytes), `invalid UTF-8: ${asset.id}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Real package fixtures: persisted fingerprints are the oracle
// ---------------------------------------------------------------------------

test('Codex native fingerprints.json entries are reproduced from the package on disk', () => {
  const recorded = readJson('plugins/dhpk/fingerprints.json');
  const algorithm = fingerprint.resolveFingerprintAlgorithm(readJson('plugins/dhpk/provenance.json'));
  const names = Object.keys(recorded);
  assert.ok(names.length > 0);
  for (const name of names) {
    const entries = fingerprint.collectDirectoryEntries(path.join(ROOT, 'plugins', 'dhpk', 'skills', name), { skipBytecode: true });
    assert.strictEqual(algorithm, 'tree-merkle-v1');
    assert.strictEqual(fingerprint.treeFingerprint(filesOnly(entries)), recorded[name], `codex skill ${name}`);
  }
});

test('Agent plugin fingerprints.json entries are reproduced from the package on disk', () => {
  const recorded = readJson('plugins/dhpk-agent/fingerprints.json').skills;
  const algorithm = fingerprint.resolveFingerprintAlgorithm(readJson('plugins/dhpk-agent/provenance.json'));
  const names = Object.keys(recorded);
  assert.ok(names.length > 0);
  for (const name of names) {
    const entries = fingerprint.collectDirectoryEntries(path.join(ROOT, 'plugins', 'dhpk-agent', 'skills', name), { order: 'locale', skipBytecode: true });
    assert.strictEqual(algorithm, 'tree-merkle-v1');
    assert.strictEqual(fingerprint.treeFingerprint(filesOnly(entries)), recorded[name], `agent skill ${name}`);
  }
});

test('Cursor fingerprints.json entries are reproduced from the package on disk', () => {
  const recorded = readJson('plugins/dhpk-cursor/fingerprints.json');
  const keys = Object.keys(recorded);
  assert.ok(keys.length > 0);
  const entries = fingerprint.collectDirectoryEntries(path.join(ROOT, 'plugins', 'dhpk-cursor'), { skipBytecode: true });
  for (const key of keys) {
    assert.strictEqual(fingerprint.treeNodeFingerprint(filesOnly(entries), key), recorded[key], `cursor entry ${key}`);
  }
});

test('AGY fingerprints.json file entries are SHA-256 digests of the file bytes', () => {
  const recorded = readJson('plugins/dhpk-agy/fingerprints.json').files;
  const relatives = Object.keys(recorded);
  assert.ok(relatives.length > 0);
  for (const relative of relatives) {
    const bytes = fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk-agy', relative));
    assert.strictEqual(fingerprint.sha256Hex(bytes), recorded[relative], `agy file ${relative}`);
  }
});

// ---------------------------------------------------------------------------
// Synthetic and adversarial trees
// ---------------------------------------------------------------------------

// Legacy writer and verifier values describe the original case-distinct tree.
// The portable Merkle, package, and receipt values are independently calculated.
// The VERIFIER values are recorded as data: the old
// disk walkers sort per directory, so they disagree with the writers when a
// file name and a directory name collide on a prefix (a.txt beside a/).
const ADVERSARIAL_WRITER = Object.freeze({
  codeUnit: 'bccb2fd5c913a88ec051b2742f7f923a21c17d091cdf15e38af6a5c7229b406f',
  locale: '5210043f319dc84e262ddee0a77724c368655b6c2601abd5b2246d5bc89a2c62',
  terminatedCodeUnitOrder: 'dff9ebb5c84a93fdc945861a921f607ab6b9888c71d883611a0ec73800f785c2',
  merkleFilesOnlyRoot: '7cd0eb904f97b8f1fb8739c89f8a769b1e5cc23c7eb53270d7aca42b451aa283',
  merkleSub: 'a92dd0a8df68924d910d7e498dc50cb49d431009322633a066543d1da83bb37c',
});

const ADVERSARIAL_LEGACY_VERIFIER = Object.freeze({
  codex: '4b4bd3d47a947dad0b6bb88c8c1ee5839992753591309fa285dd2d645c74c55c',
  agent: '923bb5c74d70436ee00b69e799cca24a94023420f3818b69561b81feadbd3867',
  cursorRootWithEmptyDirectory: '1d56ef053ae0ecc36759c3da399c0e5045a1e6767d050be8072de253ed72650d',
  cursorEmptyDirectory: '4b66bf93b3932a9539880b2421e35019af9daf84363a0246280ffcac173b2678',
});

const ADVERSARIAL_PACKAGE = Object.freeze({
  contentFingerprint: 'sha256:fa5267abd7d72ef804f848bc854eb94a73d60a50dc6dce97937f335601e6820c',
  modeFingerprint: 'sha256:ef5ef43837565656b9eb8bf031152a7d669329e0b13789128df1507db8f99f39',
  artifactFingerprint: 'sha256:b68f1089cb962f49001bdd90897c39ab54fd12f67198588baa67d217092bcb3c',
});

const ADVERSARIAL_RECEIPT_DIRECTORY = 'sha256:c998499fbdd7157a0996c1abad90ebac4f258174cc02f0f25237a74dfdaaa7db';

test('collector skips bytecode, keeps empty directories, and lists directories before their contents', () => {
  const dir = buildAdversarialTree();
  try {
    const entries = fingerprint.collectDirectoryEntries(dir, { skipBytecode: true });
    const listed = entries.map((entry) => `${entry.type}:${entry.path}`);
    assert.deepStrictEqual(listed, [
      'directory:a',
      'file:a/inner.txt',
      'file:a.txt',
      'file:b.txt',
      'directory:empty',
      'directory:sub',
      'file:sub/Z.txt',
      'file:sub/a.txt',
      'file:sub/binary.bin',
      'file:upper-B.txt',
    ]);
    const withBytecode = fingerprint.collectDirectoryEntries(dir, { skipBytecode: false }).map((entry) => entry.path);
    assert.ok(withBytecode.includes('skip.pyc'));
    assert.ok(withBytecode.includes('__pycache__/x.pyc'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collector honours locale ordering per directory', () => {
  const dir = buildAdversarialTree();
  try {
    const paths = fingerprint.collectDirectoryEntries(dir, { order: 'locale', skipBytecode: true })
      .filter((entry) => !entry.path.includes('/')).map((entry) => entry.path);
    assert.deepStrictEqual(paths, ['a', 'a.txt', 'b.txt', 'empty', 'sub', 'upper-B.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collector refuses symlinks and non-physical roots', () => {
  const dir = tempDir('symlink');
  try {
    fs.writeFileSync(path.join(dir, 'real.txt'), 'x');
    fs.symlinkSync('real.txt', path.join(dir, 'link.txt'));
    assert.throws(() => fingerprint.collectDirectoryEntries(dir), /cannot fingerprint symlink 'link.txt'/);
    assert.throws(() => fingerprint.collectDirectoryEntries(path.join(dir, 'real.txt')), /not a physical directory/);
    fs.symlinkSync(dir, `${dir}-alias`);
    try {
      assert.throws(() => fingerprint.collectDirectoryEntries(`${dir}-alias`), /not a physical directory/);
    } finally {
      fs.rmSync(`${dir}-alias`, { force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('adversarial tree: writer values differ from the recorded legacy disk-walker values', () => {
  const dir = buildAdversarialTree();
  try {
    const flat = filesOnly(fingerprint.collectDirectoryEntries(dir, { skipBytecode: true }));
    // The old disk walkers visited a/inner.txt before a.txt (directory 'a' sorts
    // before 'a.txt' per directory); the flat writer sort visits a.txt first.
    // The two recorded values disagree on purpose.
    assert.notStrictEqual(ADVERSARIAL_WRITER.codeUnit, ADVERSARIAL_LEGACY_VERIFIER.codex);
    assert.notStrictEqual(ADVERSARIAL_WRITER.locale, ADVERSARIAL_LEGACY_VERIFIER.agent);
    assert.ok(flat.some((entry) => entry.path === 'a.txt') && flat.some((entry) => entry.path === 'a/inner.txt'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tree fingerprint reproduces the pinned writer values on the adversarial tree (empty directory and bytecode never count)', () => {
  const dir = buildAdversarialTree();
  try {
    const files = filesOnly(fingerprint.collectDirectoryEntries(dir, { skipBytecode: true }));
    assert.strictEqual(fingerprint.treeFingerprint(files), ADVERSARIAL_WRITER.merkleFilesOnlyRoot);
    assert.strictEqual(fingerprint.treeNodeFingerprint(files, 'sub'), ADVERSARIAL_WRITER.merkleSub);
    assert.strictEqual(fingerprint.treeNodeFingerprint(files, 'empty'), '');
    const all = fingerprint.collectDirectoryEntries(dir, { skipBytecode: true });
    assert.strictEqual(fingerprint.treeFingerprint(all), ADVERSARIAL_WRITER.merkleFilesOnlyRoot);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tree node fingerprint of an absent prefix is empty and of a single file hashes file bytes', () => {
  const files = [{ path: 'rules/a.mdc', type: 'file', content: Buffer.from('hello') }];
  assert.strictEqual(fingerprint.treeNodeFingerprint(files, 'missing'), '');
  assert.strictEqual(
    fingerprint.treeNodeFingerprint(files, 'rules/a.mdc'),
    fingerprint.sha256Hex(Buffer.concat([Buffer.from('file\0'), Buffer.from('hello')])),
  );
});

test('package content and mode fingerprints reproduce the recorded recipe and separate content from mode', () => {
  const dir = buildAdversarialTree();
  try {
    const files = filesOnly(fingerprint.collectDirectoryEntries(dir, { order: 'locale', skipBytecode: true }));
    assert.deepStrictEqual(fingerprint.packageContentAndModeFingerprints(files), ADVERSARIAL_PACKAGE);
    const changedMode = files.map((file) => (file.path === 'a.txt' ? { ...file, mode: 0o755 } : file));
    const result = fingerprint.packageContentAndModeFingerprints(changedMode);
    assert.strictEqual(result.contentFingerprint, ADVERSARIAL_PACKAGE.contentFingerprint);
    assert.notStrictEqual(result.modeFingerprint, ADVERSARIAL_PACKAGE.modeFingerprint);
    assert.notStrictEqual(result.artifactFingerprint, ADVERSARIAL_PACKAGE.artifactFingerprint);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('directory entries fingerprint matches the receipt recipe (modes recorded, bytecode kept)', () => {
  const dir = buildAdversarialTree();
  try {
    const entries = fingerprint.collectDirectoryEntries(dir, { skipBytecode: false });
    assert.strictEqual(fingerprint.directoryEntriesFingerprint(entries), ADVERSARIAL_RECEIPT_DIRECTORY);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collector can skip symlinks, enforces the traversal budget, and rejects unknown options', () => {
  const dir = tempDir('options');
  try {
    fs.writeFileSync(path.join(dir, 'real.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'y');
    fs.symlinkSync('real.txt', path.join(dir, 'link.txt'));
    const skipped = fingerprint.collectDirectoryEntries(dir, { symlinks: 'skip' }).map((entry) => entry.path);
    assert.deepStrictEqual(skipped, ['other.txt', 'real.txt']);
    fs.rmSync(path.join(dir, 'link.txt'));
    const { createTraversalBudget } = require('../scripts/lib/bounded-filesystem');
    assert.throws(
      () => fingerprint.collectDirectoryEntries(dir, { budget: createTraversalBudget({ maxFiles: 1 }) }),
      /maximum fingerprint file count/,
    );
    assert.throws(() => fingerprint.collectDirectoryEntries(dir, { order: 'natural' }), /unknown directory order/);
    assert.throws(() => fingerprint.collectDirectoryEntries(dir, { symlinks: 'follow' }), /unknown symlink policy/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the module depends only on Node built-ins and bounded-filesystem', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'content-fingerprint.js'), 'utf8');
  const required = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepStrictEqual(required, ['./bounded-filesystem', 'node:crypto', 'node:fs', 'node:path']);
});

// 原始大小寫同名路徑只能在記憶體共存；保留舊向量以防排序與雜湊回歸。
test('original case-distinct in-memory tree retains its recorded fingerprints', () => {
  const dir = buildAdversarialTree();
  try {
    const entries = fingerprint.collectDirectoryEntries(dir).map((entry) => (
      entry.path === 'upper-B.txt' ? { ...entry, path: 'B.txt' } : entry
    ));
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const codeUnitOrder = ['B.txt', '__pycache__', '__pycache__/x.pyc', 'a', 'a/inner.txt', 'a.txt', 'b.txt', 'empty', 'skip.pyc', 'sub', 'sub/Z.txt', 'sub/a.txt', 'sub/binary.bin'];
    const localeFiles = ['a/inner.txt', 'a.txt', 'b.txt', 'B.txt', 'sub/a.txt', 'sub/binary.bin', 'sub/Z.txt'];
    const complete = codeUnitOrder.map((name) => byPath.get(name));
    const source = localeFiles.map((name) => byPath.get(name));
    assert.strictEqual(fingerprint.treeFingerprint(source), '84ffd53938ed50bf6c1b6665f92cbf9feb93dba1e10da374a32531eba7cd2122');
    assert.strictEqual(fingerprint.treeFingerprint(complete), 'a81026d753add0b0096322e11412efde9b8257e6a3cbb5186462d8afacee3fa7');
    assert.strictEqual(fingerprint.directoryEntriesFingerprint(complete), 'sha256:580d562a776f02e67392cf5848dbb18a8294409cf0b7e0dea77519132fff113f');
    // 這兩個舊配方依路徑與內容建立紀錄，無須在磁碟建立大小寫同名檔案。
    const crypto = require('node:crypto');
    const record = (entry) => entry.type === 'directory' ? `D:${entry.path}\n`
      : `F:${entry.path}:${crypto.createHash('sha256').update(entry.content).digest('hex')}\n`;
    const localeOrder = ['__pycache__', '__pycache__/x.pyc', 'a', 'a/inner.txt', 'a.txt', 'b.txt', 'B.txt', 'empty', 'skip.pyc', 'sub', 'sub/a.txt', 'sub/binary.bin', 'sub/Z.txt'];
    const digestRecords = (names) => crypto.createHash('sha256').update(names.map((name) => record(byPath.get(name))).join('')).digest('hex');
    assert.strictEqual(digestRecords(localeOrder), '082c1b81f402a9162e67dc4d42165c8f7514b04e72ee5e041faa8f5b5178232c');
    assert.strictEqual(digestRecords(localeOrder.filter((name) => !name.startsWith('__pycache__') && name !== 'skip.pyc')), 'fe4ae3943f5ff730191cb595c5d83c68a78db0094dd4c7196de21a579f177db1');
    assert.deepStrictEqual(fingerprint.packageContentAndModeFingerprints(source), {
      contentFingerprint: 'sha256:923bb5c74d70436ee00b69e799cca24a94023420f3818b69561b81feadbd3867',
      modeFingerprint: 'sha256:b31c98683390e97e4079921cd89cc1ec2c7757aef576a21c7098891cdb94cc2f',
      artifactFingerprint: 'sha256:33834a3adf417353e49dbb518ff93816708afc9da2093b8b782a6efe6bf316ae',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('content-fingerprint');
