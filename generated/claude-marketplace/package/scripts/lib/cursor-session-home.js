'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CURSOR_SESSION_ALLOWLIST = Object.freeze([
  '.config/cursor/auth.json',
  '.cursor/cli-config.json',
]);

function hasSymlinkAncestor(root, relative) {
  let current = path.resolve(root);
  const segments = String(relative).replace(/\\/g, '/').split('/').filter(Boolean);
  try {
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  } catch (_) {
    return false;
  }
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

function cloneCursorSessionFiles({ hostHome = process.env.HOME, probeHome } = {}) {
  if (typeof probeHome !== 'string' || !path.isAbsolute(probeHome)) {
    throw new TypeError('probeHome must be an absolute path');
  }
  const copiedFiles = [];
  if (typeof hostHome !== 'string' || !path.isAbsolute(hostHome)) return { copiedFiles };

  for (const relative of CURSOR_SESSION_ALLOWLIST) {
    const source = path.join(hostHome, relative);
    if (hasSymlinkAncestor(hostHome, relative)) continue;
    let stat;
    try { stat = fs.lstatSync(source); } catch (_) { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    let expectedRealpath;
    try { expectedRealpath = fs.realpathSync(source); } catch (_) { continue; }
    const destination = path.join(probeHome, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const fd = fs.openSync(source, fs.constants.O_RDONLY | noFollow);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile()) continue;
      if (typeof stat.dev === 'number' && typeof stat.ino === 'number'
        && (opened.dev !== stat.dev || opened.ino !== stat.ino)) continue;
      try {
        if (fs.realpathSync(source) !== expectedRealpath) continue;
      } catch (_) {
        continue;
      }
      fs.writeFileSync(destination, fs.readFileSync(fd), { mode: 0o600 });
      fs.chmodSync(destination, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    copiedFiles.push(relative);
  }
  return { copiedFiles };
}

function createCursorSessionHome({ hostHome = process.env.HOME } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-home-'));
  let session;
  try {
    session = cloneCursorSessionFiles({ hostHome, probeHome: home });
  } catch (error) {
    fs.rmSync(home, { recursive: true, force: true });
    throw error;
  }
  return {
    home,
    copiedFiles: session.copiedFiles,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

module.exports = {
  CURSOR_SESSION_ALLOWLIST,
  cloneCursorSessionFiles,
  createCursorSessionHome,
};
