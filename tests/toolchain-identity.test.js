'use strict';

// Coverage for scripts/lib/toolchain-identity.js: resolves the interpreters a
// gate step would run from the step environment's PATH, so release evidence
// records which python3/node/bash actually ran (#1280).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { describeToolchain, toolchainNotes, APPLE_PYTHON } = require('../scripts/lib/toolchain-identity');

function withFakeBin(tools, callback) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-toolchain-')));
  try {
    for (const [name, versionLine] of Object.entries(tools)) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, `#!/bin/sh\necho "${versionLine}"\n`, { mode: 0o755 });
    }
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('records the PATH-resolved path, real path, and version of each command', () => {
  withFakeBin({ python3: 'Python 3.9.6', node: 'v26.13.0' }, (dir) => {
    const toolchain = describeToolchain({ PATH: dir }, ['python3', 'node']);
    assert.deepStrictEqual(toolchain.commands, [
      { command: 'python3', path: path.join(dir, 'python3'), realPath: path.join(dir, 'python3'), version: 'Python 3.9.6' },
      { command: 'node', path: path.join(dir, 'node'), realPath: path.join(dir, 'node'), version: 'v26.13.0' },
    ]);
    assert.deepStrictEqual(toolchain.notes, []);
  });
});

test('follows PATH order and resolves symlinks to their real path', () => {
  withFakeBin({ python3: 'Python 3.13.2' }, (realDir) => {
    const linkDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-toolchain-link-')));
    try {
      fs.symlinkSync(path.join(realDir, 'python3'), path.join(linkDir, 'python3'));
      const toolchain = describeToolchain({ PATH: [linkDir, realDir].join(path.delimiter) }, ['python3']);
      assert.strictEqual(toolchain.commands[0].path, path.join(linkDir, 'python3'));
      assert.strictEqual(toolchain.commands[0].realPath, path.join(realDir, 'python3'));
      assert.strictEqual(toolchain.commands[0].version, 'Python 3.13.2');
    } finally {
      fs.rmSync(linkDir, { recursive: true, force: true });
    }
  });
});

test('a command missing from PATH is recorded as unresolved, not omitted', () => {
  withFakeBin({}, (dir) => {
    const toolchain = describeToolchain({ PATH: dir }, ['python3']);
    assert.deepStrictEqual(toolchain.commands, [{ command: 'python3', path: null, realPath: null, version: null }]);
  });
});

test('skips a non-executable file and a directory named like the command', () => {
  withFakeBin({ python3: 'Python 3.13.2' }, (goodDir) => {
    const badDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-toolchain-bad-')));
    const dirEntry = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-toolchain-dir-')));
    try {
      fs.writeFileSync(path.join(badDir, 'python3'), 'not executable\n', { mode: 0o644 });
      fs.mkdirSync(path.join(dirEntry, 'python3'));
      const toolchain = describeToolchain({ PATH: [badDir, dirEntry, goodDir].join(path.delimiter) }, ['python3']);
      assert.strictEqual(toolchain.commands[0].path, path.join(goodDir, 'python3'));
    } finally {
      fs.rmSync(badDir, { recursive: true, force: true });
      fs.rmSync(dirEntry, { recursive: true, force: true });
    }
  });
});

test('relative PATH entries resolve against the step cwd, not the gate process cwd', () => {
  withFakeBin({ python3: 'Python 3.13.2' }, (dir) => {
    const toolchain = describeToolchain({ PATH: path.basename(dir) }, ['python3'], { cwd: path.dirname(dir) });
    assert.strictEqual(toolchain.commands[0].path, path.join(dir, 'python3'));
  });
});

test('a version probe that exits non-zero records the path with a null version', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-toolchain-fail-')));
  try {
    fs.writeFileSync(path.join(dir, 'python3'), '#!/bin/sh\necho broken >&2\nexit 3\n', { mode: 0o755 });
    const toolchain = describeToolchain({ PATH: dir }, ['python3']);
    assert.deepStrictEqual(toolchain.commands[0], { command: 'python3', path: path.join(dir, 'python3'), realPath: path.join(dir, 'python3'), version: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without Command Line Tools the Apple python3 stub is never invoked', () => {
  if (process.platform !== 'darwin' || !fs.existsSync(APPLE_PYTHON)) return;
  let probed = 0;
  const toolchain = describeToolchain({ PATH: path.dirname(APPLE_PYTHON) }, ['python3'], {
    probeTools: () => { probed += 1; return false; },
  });
  assert.strictEqual(probed, 1);
  assert.strictEqual(toolchain.commands[0].path, APPLE_PYTHON);
  assert.strictEqual(toolchain.commands[0].version, null, 'the stub must not be run when CLT is missing');
  assert.strictEqual(toolchain.notes.length, 1);
});

test('Apple Xcode python3 is flagged because it writes a bytecode cache under HOME', () => {
  const notes = toolchainNotes([{ command: 'python3', path: APPLE_PYTHON, realPath: APPLE_PYTHON, version: 'Python 3.9.6' }]);
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /\/usr\/bin\/python3/);
  assert.match(notes[0], /Library\/Caches\/com\.apple\.python/);
  assert.deepStrictEqual(toolchainNotes([{ command: 'python3', path: '/opt/x/python3', realPath: '/opt/x/python3', version: 'Python 3.13.2' }]), []);
});

run('toolchain-identity');
