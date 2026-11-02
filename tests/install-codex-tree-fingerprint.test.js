'use strict';

// Python side of the cross-language vectors for `tree-merkle-v1`: the block the
// installer embeds must reproduce every digest recorded in
// tests/fixtures/tree-fingerprint-vectors.json, in the descriptor-pinned walk
// and in the path walk used for installer sources.

const fs = require('node:fs');
const { test, run, assert } = require('./_lib/tinytest');
const { loadVectors, materialize } = require('./_lib/tree-vectors');
const { extractTreeFingerprintBlock, runTreeFingerprint } = require('./_lib/installer-tree-fingerprint');

const fixture = loadVectors();

function casesFor(vector, root) {
  const skip = vector.policy.skipBytecode;
  return [
    { kind: 'fd', dir: root, record_links: vector.policy.links === 'record', skip_bytecode: skip },
    { kind: 'path', dir: root, symlinks: vector.policy.links, skip_bytecode: skip },
  ];
}

function runVectors(vectors, block) {
  const roots = vectors.map((vector) => materialize(vector));
  try {
    const flat = vectors.flatMap((vector, index) => casesFor(vector, roots[index]));
    const results = runTreeFingerprint(flat, block);
    return vectors.map((vector, index) => ({ vector, fd: results[index * 2], path: results[index * 2 + 1] }));
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the installer embeds a tree-fingerprint block', () => {
  const block = extractTreeFingerprintBlock();
  assert.match(block, /tree-merkle-v1/);
  assert.match(block, /directory\\0/);
  assert.ok(block.includes("key=lambda n: n.encode('utf-16-be')"), 'UTF-16 code-unit sort key is missing');
});

test('python reproduces every recorded vector through both walks', () => {
  for (const { vector, fd, path: pathResult } of runVectors(fixture.vectors)) {
    if (vector.expectError) {
      assert.ok(fd.error && fd.error.includes(vector.expectError), `${vector.name}: fd walk should refuse: ${JSON.stringify(fd)}`);
      assert.ok(pathResult.error && pathResult.error.includes(vector.expectError), `${vector.name}: path walk should refuse: ${JSON.stringify(pathResult)}`);
      continue;
    }
    assert.strictEqual(fd.digest, vector.digest, `${vector.name} (fd walk): ${JSON.stringify(fd)}`);
    assert.strictEqual(pathResult.digest, vector.digest, `${vector.name} (path walk): ${JSON.stringify(pathResult)}`);
  }
});

test('mutation check: the default sort key breaks the supplementary-name vectors only', () => {
  const block = extractTreeFingerprintBlock();
  const wrongKey = "key=lambda n: n.encode('utf-16-be')";
  assert.ok(block.includes(wrongKey));
  const mutated = block.split(wrongKey).join('key=None');
  const failing = runVectors(fixture.vectors, mutated)
    .filter(({ vector, fd }) => !vector.expectError && fd.digest !== vector.digest)
    .map(({ vector }) => vector.name);
  assert.ok(failing.includes('supplementary-sorts-before-private-use-and-replacement'),
    `a code-point sort must fail the supplementary vector; failing: ${failing.join(',')}`);
  assert.ok(!failing.includes('nested'), 'a BMP-only tree is insensitive to the sort key');
});

run('install-codex-tree-fingerprint');
