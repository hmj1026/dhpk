'use strict';

// restricted-path.js — builds a PATH containing only explicitly named real
// binaries (via symlinks), for tests that must prove behavior when a specific
// tool (e.g. `timeout`/`gtimeout`) is absent from PATH. Prepending a stub dir to
// the inherited process.env.PATH is not enough for an "absence" test — the real
// binary is still reachable later in that inherited PATH. This resolves each
// named tool with the *inherited* PATH once, then symlinks only those into a
// fresh directory so the constructed PATH cannot see anything else.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveOnRealPath(name) {
  const res = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  const resolved = (res.stdout || '').trim();
  if (!resolved) {
    throw new Error(`restricted-path: could not resolve required tool '${name}' on the real PATH`);
  }
  return resolved;
}

// Returns a directory containing symlinks (named `name`) to the real resolved
// binary for each entry in `names`. Caller composes PATH from this directory
// plus any stub dir — deliberately NOT the inherited process.env.PATH.
function buildToolsOnlyDir(names) {
  const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restricted-path-tools-'));
  for (const name of names) {
    fs.symlinkSync(resolveOnRealPath(name), path.join(toolsDir, name));
  }
  return toolsDir;
}

module.exports = { buildToolsOnlyDir };
