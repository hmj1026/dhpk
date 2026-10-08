'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Include scratch and pre-existing WIP, record links without following them.
// A bounded snapshot failure blocks recovery rather than omitting evidence.
function captureScope(workdir) {
  const entries = Object.create(null);
  let bytes = 0;
  let count = 0;
  const visit = (directory, prefix) => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (!prefix && name === '.git') continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      count += 1;
      if (count > 20000) throw new Error('scope snapshot limit');
      if (stat.isSymbolicLink()) entries[relative] = `link:${fs.readlinkSync(file)}`;
      else if (stat.isDirectory()) visit(file, relative);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > 64 * 1024 * 1024) throw new Error('scope snapshot limit');
        entries[relative] = `${stat.mode}:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
      } else throw new Error('scope contains unsupported filesystem entry');
    }
  };
  visit(path.resolve(workdir), '');
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
