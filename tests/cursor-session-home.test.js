'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  CURSOR_SESSION_ALLOWLIST,
  cloneCursorSessionFiles,
  createCursorSessionHome,
} = require('../scripts/lib/cursor-session-home');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('clones only allowlisted Cursor session files with private permissions', () => {
  const hostHome = tempRoot('dhpk-cursor-session-host-');
  const probeHome = tempRoot('dhpk-cursor-session-probe-');
  try {
    fs.mkdirSync(path.join(hostHome, '.config', 'cursor'), { recursive: true });
    fs.mkdirSync(path.join(hostHome, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(hostHome, '.config', 'cursor', 'auth.json'), '{"accessToken":"fixture"}\n', { mode: 0o644 });
    fs.writeFileSync(path.join(hostHome, '.cursor', 'cli-config.json'), '{"profile":"fixture"}\n', { mode: 0o644 });
    fs.writeFileSync(path.join(hostHome, '.config', 'cursor', 'unlisted.json'), '{}\n', { mode: 0o644 });

    const result = cloneCursorSessionFiles({ hostHome, probeHome });
    assert.deepStrictEqual(result.copiedFiles, [...CURSOR_SESSION_ALLOWLIST]);
    for (const relative of CURSOR_SESSION_ALLOWLIST) {
      const destination = path.join(probeHome, relative);
      assert.strictEqual(fs.statSync(destination).mode & 0o777, 0o600);
    }
    assert.strictEqual(fs.existsSync(path.join(probeHome, '.config', 'cursor', 'unlisted.json')), false);
  } finally {
    fs.rmSync(hostHome, { recursive: true, force: true });
    fs.rmSync(probeHome, { recursive: true, force: true });
  }
});

test('skips symlinked session ancestors and rejects non-absolute probe homes', () => {
  const hostHome = tempRoot('dhpk-cursor-session-symlink-host-');
  const outside = tempRoot('dhpk-cursor-session-symlink-outside-');
  const probeHome = tempRoot('dhpk-cursor-session-symlink-probe-');
  try {
    fs.mkdirSync(path.join(outside, 'cursor'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'cursor', 'auth.json'), '{"token":"outside"}\n');
    fs.symlinkSync(path.join(outside, 'cursor'), path.join(hostHome, '.config'), 'dir');
    assert.deepStrictEqual(cloneCursorSessionFiles({ hostHome, probeHome }).copiedFiles, []);
    assert.throws(() => cloneCursorSessionFiles({ hostHome, probeHome: 'relative-home' }), /absolute path/);
  } finally {
    fs.rmSync(hostHome, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(probeHome, { recursive: true, force: true });
  }
});

test('createCursorSessionHome always provides cleanup for the disposable profile', () => {
  const hostHome = tempRoot('dhpk-cursor-session-cleanup-host-');
  const session = createCursorSessionHome({ hostHome });
  try {
    assert.ok(path.isAbsolute(session.home));
    assert.ok(fs.existsSync(session.home));
    assert.deepStrictEqual(session.copiedFiles, []);
  } finally {
    session.cleanup();
  }
  assert.strictEqual(fs.existsSync(session.home), false);
  fs.rmSync(hostHome, { recursive: true, force: true });
});

run('cursor-session-home');
