'use strict';

// Vectors for the shared tree recipe `tree-merkle-v1` (OpenSpec change
// unify-tree-fingerprint-algorithm, REQ-1; design D1 and D2). Expected digests
// were produced by an independent Python hashlib reference of the recipe in
// design D1, not by the module under test.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fingerprint = require('../scripts/lib/content-fingerprint');

const ADVERSARIAL = path.join(__dirname, 'fixtures', 'content-fingerprint', 'adversarial');

const VECTORS = Object.freeze({
  empty: '4b66bf93b3932a9539880b2421e35019af9daf84363a0246280ffcac173b2678',
  single: '431eba9b79bc272b0eb31f1e7e158d73b4a8587d425cf7df06974f8cf00ffa9d',
  nested: 'a2ced6e74f6c85355f88590f53178818da7ad9d43c2461d4298f59a64f6b041c',
  prefix: 'a81569bd2277351f0bf7fb260b248379e3158250d50718527b127f452e8494dd',
  binary: '8e54ad80121f9fc42d80ab782598c9000d92efa7493c5f47dae4cf348588e1fc',
  astral: '0fffe9e38f37e154e8ee92e788568242a6e2ab1d1a96f425248590e75aae0245',
  link: '2fc9dfe52e0b25b9cd7a7f3772652f3df3df104bafbd571777300689bbb72d8f',
  linkSameText: '468aee9f7003b75e692b71bd3662135e3a4d75ff6c8e4649b1f5d266c7b3f8cb',
  // Existing writer value for the adversarial fixture files only (empty
  // directory and bytecode excluded); the legacy merkleFingerprint produced it.
  adversarialFiles: '84ffd53938ed50bf6c1b6665f92cbf9feb93dba1e10da374a32531eba7cd2122',
});

const file = (entryPath, content) => ({ path: entryPath, type: 'file', content: Buffer.from(content) });
const link = (entryPath, target) => ({ path: entryPath, type: 'link', target });

function tempDir(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `tree-merkle-${label}-`)));
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

test('the algorithm marker is the string tree-merkle-v1', () => {
  assert.strictEqual(fingerprint.TREE_FINGERPRINT_ALGORITHM, 'tree-merkle-v1');
});

test('a root with no files hashes to sha256 of "directory" NUL', () => {
  assert.strictEqual(fingerprint.treeFingerprint([]), VECTORS.empty);
  assert.strictEqual(VECTORS.empty, crypto.createHash('sha256').update('directory\0').digest('hex'));
});

test('a single file and a nested tree match the reference vectors', () => {
  assert.strictEqual(fingerprint.treeFingerprint([file('a.txt', 'alpha')]), VECTORS.single);
  assert.strictEqual(fingerprint.treeFingerprint([
    file('top.txt', 'top'), file('a/x.txt', 'x'), file('a/b/c.txt', 'deep'),
  ]), VECTORS.nested);
});

test('input order does not matter', () => {
  const forward = [file('top.txt', 'top'), file('a/x.txt', 'x'), file('a/b/c.txt', 'deep')];
  assert.strictEqual(fingerprint.treeFingerprint(forward.slice().reverse()), VECTORS.nested);
});

test('a.md beside a/ is unambiguous: same from disk and memory, different from the swapped tree', () => {
  const tree = [file('a.md', 'md'), file('a/b', 'inner')];
  assert.strictEqual(fingerprint.treeFingerprint(tree), VECTORS.prefix);
  assert.notStrictEqual(fingerprint.treeFingerprint([file('a.md', 'inner'), file('a/b', 'md')]), VECTORS.prefix);
  const dir = tempDir('prefix');
  try {
    fs.mkdirSync(path.join(dir, 'a'));
    fs.writeFileSync(path.join(dir, 'a.md'), 'md');
    fs.writeFileSync(path.join(dir, 'a', 'b'), 'inner');
    assert.strictEqual(fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(dir)), VECTORS.prefix);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file and a directory claiming the same path are refused', () => {
  assert.throws(() => fingerprint.treeFingerprint([file('a', 'x'), file('a/b', 'y')]), /conflicts/);
});

test('binary bytes and an empty file are hashed as bytes', () => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  assert.strictEqual(fingerprint.treeFingerprint([
    { path: 'bin', type: 'file', content: bytes }, file('empty', ''),
  ]), VECTORS.binary);
});

test('names sort by UTF-16 code unit: a supplementary character precedes U+FFFD', () => {
  const entries = [file('�', 'bmp'), file('\u{10000}', 'astral')];
  assert.strictEqual(fingerprint.treeFingerprint(entries), VECTORS.astral);
  assert.strictEqual(fingerprint.treeFingerprint(entries.slice().reverse()), VECTORS.astral);
});

test('empty directory entries are dropped, including those a disk walk returns', () => {
  assert.strictEqual(
    fingerprint.treeFingerprint([{ path: 'empty', type: 'directory' }, file('a.txt', 'alpha'), { path: 'd/e', type: 'directory' }]),
    VECTORS.single,
  );
  const dir = buildAdversarialTree();
  try {
    const entries = fingerprint.collectDirectoryEntries(dir, { skipBytecode: true });
    assert.ok(entries.some((entry) => entry.type === 'directory' && entry.path === 'empty'));
    assert.strictEqual(fingerprint.treeFingerprint(entries), VECTORS.adversarialFiles);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file modes and the root path do not contribute', () => {
  const first = buildAdversarialTree();
  const second = buildAdversarialTree();
  try {
    fs.chmodSync(path.join(second, 'b.txt'), 0o755);
    fs.chmodSync(path.join(first, 'b.txt'), 0o600);
    const digest = (dir) => fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(dir, { skipBytecode: true }));
    assert.strictEqual(digest(first), VECTORS.adversarialFiles);
    assert.strictEqual(digest(second), VECTORS.adversarialFiles);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test('bytecode is skipped by the walk option, so it never reaches the digest', () => {
  const dir = buildAdversarialTree();
  try {
    const skipped = fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(dir, { skipBytecode: true }));
    const kept = fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(dir, { skipBytecode: false }));
    assert.strictEqual(skipped, VECTORS.adversarialFiles);
    assert.notStrictEqual(kept, skipped);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a link node hashes link NUL plus the target text and matches the reference vector', () => {
  assert.strictEqual(fingerprint.treeFingerprint([link('l', '../../skills/flow-guide'), file('f', 'x')]), VECTORS.link);
  const only = fingerprint.treeFingerprint([link('l', '../../skills/flow-guide')]);
  const node = crypto.createHash('sha256').update('link\0../../skills/flow-guide').digest('hex');
  const expected = crypto.createHash('sha256').update('directory\0').update('l\0').update(node).update('\0').digest('hex');
  assert.strictEqual(only, expected);
});

test('a link beside a file with the same target text hashes differently from two files', () => {
  assert.strictEqual(fingerprint.treeFingerprint([link('a', 'target'), file('b', 'target')]), VECTORS.linkSameText);
  assert.notStrictEqual(
    fingerprint.treeFingerprint([link('a', 'target'), file('b', 'target')]),
    fingerprint.treeFingerprint([file('a', 'target'), file('b', 'target')]),
  );
});

test('the record-links walk reads a symlink as its target text and ignores the target content', () => {
  const dir = tempDir('links');
  try {
    fs.writeFileSync(path.join(dir, 'f'), 'x');
    fs.symlinkSync('../../skills/flow-guide', path.join(dir, 'l'));
    const entries = fingerprint.collectDirectoryEntries(dir, { symlinks: 'record' });
    assert.deepStrictEqual(entries.find((entry) => entry.path === 'l'), { path: 'l', type: 'link', target: '../../skills/flow-guide' });
    assert.strictEqual(fingerprint.treeFingerprint(entries), VECTORS.link);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a recorded link to an existing target is unchanged when the target content changes', () => {
  const dir = tempDir('link-target');
  try {
    fs.writeFileSync(path.join(dir, 'real.txt'), 'one');
    fs.symlinkSync('real.txt', path.join(dir, 'l'));
    const before = fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(dir, { symlinks: 'record' }).filter((entry) => entry.path === 'l'));
    fs.writeFileSync(path.join(dir, 'real.txt'), 'two');
    const after = fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(dir, { symlinks: 'record' }).filter((entry) => entry.path === 'l'));
    assert.strictEqual(before, after);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the default walk refuses a symlink naming its relative path, and unknown policies are rejected', () => {
  const dir = tempDir('refuse');
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.symlinkSync('x', path.join(dir, 'sub', 'l'));
    assert.throws(() => fingerprint.collectDirectoryEntries(dir), /cannot fingerprint symlink 'sub\/l'/);
    assert.throws(() => fingerprint.collectDirectoryEntries(dir, { symlinks: 'follow' }), /unknown symlink policy/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a name that is not valid Unicode is refused', () => {
  assert.throws(() => fingerprint.treeFingerprint([file('bad\ud800name', 'x')]), /not valid Unicode/);
});

test('a path with an empty segment or a NUL is refused', () => {
  assert.throws(() => fingerprint.treeFingerprint([file('a//b', 'x')]), /invalid tree path/);
  assert.throws(() => fingerprint.treeFingerprint([file('a\0b', 'x')]), /invalid tree path/);
});

test('legacy merkleFingerprint is untouched: it agrees on files and still reports an empty tree as empty', () => {
  const entries = [file('a.txt', 'alpha')];
  assert.strictEqual(fingerprint.merkleFingerprint(entries), fingerprint.treeFingerprint(entries));
  assert.strictEqual(fingerprint.merkleFingerprint([]), '');
});

run('content-fingerprint-tree-merkle');
