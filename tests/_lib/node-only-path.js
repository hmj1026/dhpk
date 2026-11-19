'use strict';

// A PATH that resolves `node` plus the system tools and nothing else.
//   const { NODE_BASH_ONLY_PATH } = require('./_lib/node-only-path');
// The directory holding the running node binary is not safe for this: on
// setup-node runners `npm install -g` puts global CLIs (claude, ...) in the
// same directory, so an "isolated" PATH would still find them. The shim
// directory holds only a `node` symlink and is removed when the process exits.

const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir } = require('./temp-dir');

const NODE_SHIM_DIR = makeTempDir('dhpk-node-only-');
fs.symlinkSync(process.execPath, path.join(NODE_SHIM_DIR, 'node'));

const NODE_BASH_ONLY_PATH = [NODE_SHIM_DIR, '/usr/bin', '/bin'].join(path.delimiter);

module.exports = { NODE_BASH_ONLY_PATH, NODE_SHIM_DIR };
