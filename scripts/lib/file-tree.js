'use strict';

// Shared tree readers. Every caller that needs "the files under a directory" or
// "the files Git tracks" goes through here so the walk and the filter live once.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const acceptAll = () => true;
const skipNone = () => false;

// Relative POSIX paths of the non-directory entries under `directory`, in walk
// order. `filter(relative, entry)` keeps a file; `skipDirectory(name)` prunes a
// directory before it is descended into.
function walkFiles(directory, { filter = acceptAll, skipDirectory = skipNone } = {}) {
  const found = [];
  const visit = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skipDirectory(entry.name)) visit(path.join(current, entry.name), relative);
      } else if (filter(relative, entry)) {
        found.push(relative);
      }
    }
  };
  visit(directory, '');
  return found;
}

// path -> bytes for the files `walkFiles` selects.
function readTree(directory, filter = acceptAll) {
  return new Map(walkFiles(directory, { filter }).map((relative) => [relative, fs.readFileSync(path.join(directory, relative))]));
}

// Git-tracked files when `root` is itself a Git checkout, so gitignored local
// artifacts never count; null when `root` is not a checkout root.
function listTrackedFiles(root) {
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(root)) return null;
  const res = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) return null;
  return res.stdout.split('\0').filter(Boolean);
}

module.exports = { walkFiles, readTree, listTrackedFiles };
