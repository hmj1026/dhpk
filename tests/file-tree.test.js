'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { walkFiles, readTree, listTrackedFiles } = require('../scripts/lib/file-tree');

function mkTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-file-tree-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

test('walkFiles lists nested files as relative POSIX paths', () => {
  const root = mkTree({ 'a.txt': '1', 'd/b.txt': '2', 'd/e/c.txt': '3' });
  try {
    assert.deepStrictEqual(walkFiles(root).sort(), ['a.txt', 'd/b.txt', 'd/e/c.txt']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('walkFiles applies the file filter and prunes skipped directories', () => {
  const root = mkTree({ 'a.json': '1', 'a.txt': '2', 'node_modules/x.json': '3', 'd/b.json': '4' });
  try {
    const found = walkFiles(root, { filter: (rel) => rel.endsWith('.json'), skipDirectory: (name) => name === 'node_modules' });
    assert.deepStrictEqual(found.sort(), ['a.json', 'd/b.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('readTree maps each selected path to its bytes', () => {
  const root = mkTree({ 'RECEIPT': 'r', 'keep.txt': 'k', 'd/RECEIPT': 'nested' });
  try {
    const tree = readTree(root, (rel) => rel !== 'RECEIPT');
    assert.deepStrictEqual([...tree.keys()].sort(), ['d/RECEIPT', 'keep.txt']);
    assert.strictEqual(tree.get('keep.txt').toString(), 'k');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('listTrackedFiles returns null for a directory that is not a checkout root', () => {
  const root = mkTree({ 'a.txt': '1' });
  try {
    assert.strictEqual(listTrackedFiles(root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('file-tree');
