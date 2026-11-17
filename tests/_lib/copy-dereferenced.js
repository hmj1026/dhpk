'use strict';

// Copy a tree with every symlink replaced by its target's content, at any
// depth. fs.cpSync({ dereference: true }) keeps nested symlinks on Node 24, so
// an installer fixture copied that way can still point into the checkout, and
// the installer then rejects it as a source that escapes the plugin root
// (ADR 0038). File modes are kept so copied scripts stay executable.

const fs = require('fs');
const path = require('path');

function copyDereferenced(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      copyDereferenced(path.join(source, name), path.join(destination, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o777);
}

module.exports = { copyDereferenced };
