'use strict';

// Loads the shared cross-language vectors for the `tree-merkle-v1` recipe and
// materializes a vector's tree on disk. Both the Node test and the Python test
// (which extracts the installer's tree-fingerprint block) consume them, so the
// two languages are pinned to the same recorded digests.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VECTOR_FILE = path.resolve(__dirname, '..', 'fixtures', 'tree-fingerprint-vectors.json');

function loadVectors() {
  return JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
}

// entries: { path, type: 'file', base64 } | { path, type: 'link', target } |
// { path, type: 'directory' }. Returns the temp root; the caller removes it.
function materialize(vector) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tree-vector-')));
  for (const entry of vector.entries) {
    const absolute = path.join(root, ...entry.path.split('/'));
    if (entry.type === 'directory') {
      fs.mkdirSync(absolute, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (entry.type === 'link') fs.symlinkSync(entry.target, absolute);
    else fs.writeFileSync(absolute, Buffer.from(entry.base64, 'base64'));
  }
  return root;
}

module.exports = { VECTOR_FILE, loadVectors, materialize };
