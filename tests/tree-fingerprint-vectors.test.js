'use strict';

// Node side of the cross-language vectors for `tree-merkle-v1`
// (tests/fixtures/tree-fingerprint-vectors.json). The installer's Python block
// is held to the same recorded digests by tests/install-codex-tree-fingerprint.test.js.

const fs = require('node:fs');
const { test, run, assert } = require('./_lib/tinytest');
const fingerprint = require('../scripts/lib/content-fingerprint');
const { loadVectors, materialize } = require('./_lib/tree-vectors');

const fixture = loadVectors();

function nodeDigest(vector, root) {
  return fingerprint.treeFingerprint(fingerprint.collectDirectoryEntries(root, {
    symlinks: vector.policy.links,
    skipBytecode: vector.policy.skipBytecode,
  }));
}

test('the fixture names the shared algorithm and covers the required trees', () => {
  assert.strictEqual(fixture.algorithm, fingerprint.TREE_FINGERPRINT_ALGORITHM);
  const names = fixture.vectors.map((vector) => vector.name);
  for (const required of ['empty-root', 'nested', 'prefix-collision-file-beside-directory',
    'supplementary-sorts-before-private-use-and-replacement', 'link-node',
    'empty-file-and-binary-bytes', 'empty-directory-does-not-contribute',
    'link-refused-by-the-default-walk']) {
    assert.ok(names.includes(required), `missing vector ${required}`);
  }
});

for (const vector of fixture.vectors) {
  test(`node reproduces vector ${vector.name} from a tree on disk`, () => {
    const root = materialize(vector);
    try {
      if (vector.expectError) {
        assert.throws(() => nodeDigest(vector, root), new RegExp(vector.expectError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return;
      }
      assert.strictEqual(nodeDigest(vector, root), vector.digest);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('vectors with the same logical files share one digest regardless of empty directories', () => {
  const byName = Object.fromEntries(fixture.vectors.map((vector) => [vector.name, vector.digest]));
  assert.strictEqual(byName['empty-directory-does-not-contribute'], byName['nested-only-empty-directories-do-not-contribute']);
  assert.notStrictEqual(byName['bytecode-skipped'], byName['bytecode-kept-by-the-complete-view']);
  assert.notStrictEqual(byName['prefix-collision-file-beside-directory'], byName['prefix-collision-swapped']);
});

run('tree-fingerprint-vectors');
