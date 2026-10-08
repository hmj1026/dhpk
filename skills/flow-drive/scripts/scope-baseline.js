'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Include scratch and pre-existing WIP, record links without following them.
// A bounded snapshot failure blocks recovery rather than omitting evidence.
function captureScope(workdir) {
  const entries = Object.create(null);
  const limit = 64 * 1024 * 1024;
  let bytes = 0;
  let count = 0;
  const sameIdentity = (before, after) => before.dev === after.dev && before.ino === after.ino && before.mode === after.mode;
  const checkDirectories = (ancestors) => {
    for (const [directory, expected] of ancestors) {
      const actual = fs.lstatSync(directory);
      if (!actual.isDirectory() || !sameIdentity(expected, actual)) throw new Error('scope directory identity changed');
    }
  };
  const visit = (directory, prefix, ancestors) => {
    checkDirectories(ancestors);
    for (const name of fs.readdirSync(directory).sort()) {
      checkDirectories(ancestors);
      if (!prefix && name === '.git') continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      count += 1;
      if (count > 20000) throw new Error('scope snapshot limit');
      if (stat.isSymbolicLink()) {
        entries[relative] = `link:${fs.readlinkSync(file)}`;
        if (!sameIdentity(stat, fs.lstatSync(file))) throw new Error('scope link identity changed');
      }
      else if (stat.isDirectory()) visit(file, relative, [...ancestors, [file, stat]]);
      else if (stat.isFile()) {
        // Never reopen the pathname after inspection. Nonblocking open also
        // makes a FIFO substituted before open fail without waiting for a peer.
        const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
          const opened = fs.fstatSync(descriptor);
          if (!opened.isFile() || !sameIdentity(stat, opened)) throw new Error('scope file identity changed');
          if (opened.size > limit - bytes) throw new Error('scope snapshot limit');
          const hash = crypto.createHash('sha256');
          const buffer = Buffer.alloc(64 * 1024);
          let read = 0;
          for (;;) {
            const amount = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, opened.size - read + 1), null);
            if (!amount) break;
            read += amount;
            if (read > opened.size || read > limit - bytes) throw new Error('scope snapshot limit or file changed');
            hash.update(buffer.subarray(0, amount));
          }
          const after = fs.fstatSync(descriptor);
          checkDirectories(ancestors);
          if (read !== opened.size || !sameIdentity(opened, fs.lstatSync(file))
              || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
            throw new Error('scope file changed during snapshot');
          }
          bytes += read;
          entries[relative] = `${opened.mode}:${hash.digest('hex')}`;
        } finally { fs.closeSync(descriptor); }
      } else throw new Error('scope contains unsupported filesystem entry');
    }
    checkDirectories(ancestors);
  };
  const root = path.resolve(workdir);
  visit(root, '', [[root, fs.lstatSync(root)]]);
  return Object.freeze(entries);
}

function scopeDiff(before, after, assigned) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file]).sort();
  const allowed = new Set(assigned);
  return Object.freeze({
    changed: Object.freeze(changed.filter((file) => allowed.has(file))),
    out_of_scope: Object.freeze(changed.filter((file) => !allowed.has(file))),
  });
}

function validateAssignedPaths(workdir, assigned) {
  const root = fs.realpathSync(workdir);
  for (const file of assigned) {
    if (file.includes('\\')) throw new Error('ambiguous assigned path');
    let current = root;
    for (const segment of file.split('/')) {
      current = path.join(current, segment);
      if (current !== root && !current.startsWith(`${root}${path.sep}`)) throw new Error('assigned path escapes workspace');
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('assigned path traverses a symbolic link');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = Object.freeze({ captureScope, scopeDiff, validateAssignedPaths });
