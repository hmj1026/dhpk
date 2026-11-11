'use strict';

// Test temp directories that clean up after themselves (issue #1322).
//   const { makeTempDir } = require('./_lib/temp-dir');
//   const dir = makeTempDir('dhpk-foo-');
// The directory is removed when the process exits, so tests need no finally.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const created = new Set();
let hooked = false;

function removeAll() {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created.clear();
}

function makeTempDir(prefix) {
  if (!hooked) {
    hooked = true;
    process.on('exit', removeAll);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.add(dir);
  return dir;
}

// Remove one directory now and forget it (for tests that clean up early).
function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  created.delete(dir);
}

// For directories made by the code under test (a script's default log dir, a
// product mktemp) that the test cannot name. On exit, remove entries of the temp
// root that match a prefix and were created after this module loaded, so an
// older or concurrent run's directories are never touched.
const loadedAtMs = Date.now();
function sweepOnExit(prefixes) {
  process.on('exit', () => {
    const root = os.tmpdir();
    let names;
    try {
      names = fs.readdirSync(root);
    } catch (_error) {
      return;
    }
    for (const name of names) {
      if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
      const full = path.join(root, name);
      try {
        if (fs.lstatSync(full).birthtimeMs >= loadedAtMs) fs.rmSync(full, { recursive: true, force: true });
      } catch (_error) {
        // Already gone or unreadable: nothing further to clean.
      }
    }
  });
}

module.exports = { makeTempDir, removeTempDir, sweepOnExit };
