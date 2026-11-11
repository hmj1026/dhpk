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
// product mktemp) that the test cannot name. The entries already present when
// this is called are recorded; on exit, every entry that matches a prefix and
// was not in that snapshot is removed. Names, not timestamps, decide: birthtime
// is unsupported on many Linux filesystems and mtime/ctime can be back-dated.
function sweepOnExit(prefixes) {
  const root = os.tmpdir();
  const isTarget = (name) => prefixes.some((prefix) => name.startsWith(prefix));
  const existing = new Set();
  try {
    for (const name of fs.readdirSync(root)) if (isTarget(name)) existing.add(name);
  } catch (_error) {
    // An unreadable root has nothing to snapshot or sweep.
  }
  process.on('exit', () => {
    let names;
    try {
      names = fs.readdirSync(root);
    } catch (_error) {
      return;
    }
    for (const name of names) {
      if (!isTarget(name) || existing.has(name)) continue;
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  });
}

module.exports = { makeTempDir, removeTempDir, sweepOnExit };
