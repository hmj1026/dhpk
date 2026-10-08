'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { captureScope } = require('../skills/flow-drive/scripts/scope-baseline');

function raceScenario(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-snapshot-race-'));
  const file = path.join(root, 'assigned.txt');
  fs.writeFileSync(file, 'small baseline');
  const original = fs.openSync;
  let swapped = false;
  fs.openSync = (name, ...args) => {
    if (name === file && !swapped) {
      swapped = true;
      fs.unlinkSync(file);
      if (kind === 'fifo') {
        const result = spawnSync('mkfifo', [file]);
        assert.strictEqual(result.status, 0);
      } else {
        const descriptor = original(file, 'w');
        fs.ftruncateSync(descriptor, 65 * 1024 * 1024);
        fs.closeSync(descriptor);
      }
    }
    return original(name, ...args);
  };
  try { assert.throws(() => captureScope(root), /scope|identity|entry|changed/); }
  finally { fs.openSync = original; fs.rmSync(root, { recursive: true, force: true }); }
}

test('scope snapshot rejects a file swapped for a FIFO without blocking', () => {
  const child = spawnSync(process.execPath, [__filename, '--race', 'fifo'], { encoding: 'utf8', timeout: 1500 });
  assert.strictEqual(child.error, undefined, 'a substituted FIFO must not block the snapshot');
  assert.strictEqual(child.status, 0, child.stderr);
});

test('scope snapshot rejects a file enlarged between inspection and open', () => raceScenario('oversized'));

test('scope traversal rejects a directory replaced by an outside symbolic link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-directory-race-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-directory-outside-'));
  const directory = path.join(root, 'src');
  fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'local.txt'), 'local');
  fs.writeFileSync(path.join(outside, 'local.txt'), 'outside');
  const original = fs.readdirSync;
  fs.readdirSync = (name, ...args) => {
    const names = original(name, ...args);
    if (name === directory) {
      fs.renameSync(directory, path.join(root, 'moved'));
      fs.symlinkSync(outside, directory);
    }
    return names;
  };
  try { assert.throws(() => captureScope(root), /scope|identity|changed|symbolic/); }
  finally { fs.readdirSync = original; fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

if (process.argv[2] === '--race') raceScenario(process.argv[3]);
else run('flow-drive-scope-baseline');
