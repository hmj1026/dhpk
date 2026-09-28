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
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)) {
    throw new Error("restricted-path: invalid tool name '" + name + "'");
  }
  const res = spawnSync('bash', ['-c', 'command -v -- "$1"', 'restricted-path', name], { encoding: 'utf8' });
  const resolved = (res.stdout || '').trim();
  if (res.error || res.status !== 0 || !resolved) {
    throw new Error("restricted-path: could not resolve required tool '" + name + "' on the real PATH");
  }
  try {
    if (!path.isAbsolute(resolved)) throw new Error('resolved path is not absolute');
    const realPath = fs.realpathSync(resolved);
    if (!fs.statSync(realPath).isFile()) throw new Error('resolved path is not a regular file');
    fs.accessSync(realPath, fs.constants.X_OK);
    return realPath;
  } catch (error) {
    throw new Error("restricted-path: required tool '" + name + "' is not an executable file: " + error.message);
  }
}

// Returns a directory containing symlinks (named `name`) to the real resolved
// binary for each entry in `names`. Caller composes PATH from this directory
// plus any stub dir — deliberately NOT the inherited process.env.PATH.
function buildToolsOnlyDir(names) {
  const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restricted-path-tools-'));
  try {
    for (const name of names) {
      fs.symlinkSync(resolveOnRealPath(name), path.join(toolsDir, name));
    }
    return toolsDir;
  } catch (error) {
    fs.rmSync(toolsDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { buildToolsOnlyDir };
