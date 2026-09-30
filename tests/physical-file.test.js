'use strict';

// Direct contract coverage for the dependency-free physical filesystem seam.
// These tests keep the public helper honest without requiring /proc, a daemon,
// or a platform-specific test service.

const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const physicalFile = require('../scripts/lib/physical-file');

function temporaryDirectory(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function removePath(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.rmSync(target, { recursive: true, force: true });
  } else {
    fs.unlinkSync(target);
  }
}

function writePrivate(file, content) {
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function assertSecurityFailure(fn) {
  assert.throws(fn, (error) => error && error.code === 'ESECURITY');
}

function assertPathSnapshotChangeRejected(phase) {
  const root = temporaryDirectory('dhpk-physical-path-snapshot-');
  const file = path.join(root, 'payload.bin');
  const payload = Buffer.from('the public reader must bind path snapshots\n');
  writePrivate(file, payload);
  const targetStatCall = phase === 'after-open' ? 2 : 3;
  const originalOpenSync = fs.openSync;
  const originalLstatSync = fs.lstatSync;
  const originalCloseSync = fs.closeSync;
  let descriptor;
  let targetStatCalls = 0;
  let changedTargetStats = 0;
  let descriptorClosed = false;
  try {
    assert.deepStrictEqual(physicalFile.readPhysicalFile(root, file, payload.length), payload);
    fs.openSync = function captureTarget(target, ...args) {
      const opened = originalOpenSync.call(fs, target, ...args);
      if (typeof target === 'string' && path.resolve(target) === file) descriptor = opened;
      return opened;
    };
    fs.lstatSync = function changeOnlyOwnedPathSnapshot(target, ...args) {
      const stat = originalLstatSync.call(fs, target, ...args);
      if (typeof target === 'string' && path.resolve(target) === file) {
        targetStatCalls += 1;
        if (descriptor !== undefined && targetStatCalls === targetStatCall) {
          stat.mtimeMs += 1;
          changedTargetStats += 1;
        }
      }
      return stat;
    };
    fs.closeSync = function observeTargetClose(target, ...args) {
      if (target === descriptor) descriptorClosed = true;
      return originalCloseSync.call(fs, target, ...args);
    };

    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, file, payload.length));
    assert.strictEqual(descriptor !== undefined, true);
    assert.strictEqual(targetStatCalls, targetStatCall);
    assert.strictEqual(changedTargetStats, 1);
    assert.strictEqual(descriptorClosed, true);
    assert.deepStrictEqual(fs.readFileSync(file), payload);
  } finally {
    fs.closeSync = originalCloseSync;
    fs.lstatSync = originalLstatSync;
    fs.openSync = originalOpenSync;
    removePath(root);
  }
}

function loadPhysicalFileWithoutOpenFlags() {
  const modulePath = require.resolve('../scripts/lib/physical-file');
  const originalLoad = Module._load;
  const previousModule = require.cache[modulePath];
  const fakeFs = Object.create(fs);
  Object.defineProperty(fakeFs, 'constants', {
    value: Object.freeze({
      ...fs.constants,
      O_NOFOLLOW: undefined,
      O_NONBLOCK: undefined,
    }),
  });
  Module._load = function load(request, parent, isMain) {
    if (request === 'node:fs') return fakeFs;
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    if (previousModule) require.cache[modulePath] = previousModule;
  }
}

test('readPhysicalFile reads private bytes without consulting /proc', () => {
  const root = temporaryDirectory('dhpk-physical-read-');
  const file = path.join(root, 'payload.bin');
  const payload = Buffer.from('bounded physical payload\n', 'utf8');
  writePrivate(file, payload);
  const originalOpenSync = fs.openSync;
  fs.openSync = (target, ...args) => {
    if (typeof target === 'string' && path.resolve(target).startsWith(`${path.sep}proc${path.sep}`)) {
      throw new Error('physical-file test forbids /proc access');
    }
    return originalOpenSync(target, ...args);
  };
  try {
    assert.deepStrictEqual(physicalFile.readPhysicalFile(root, file, payload.length), payload);
  } finally {
    fs.openSync = originalOpenSync;
    removePath(root);
  }
});

test('readPhysicalFile fails closed when required open flags are unavailable', () => {
  const root = temporaryDirectory('dhpk-physical-flags-');
  const file = path.join(root, 'payload.bin');
  writePrivate(file, Buffer.from('payload'));
  const unavailableFlags = loadPhysicalFileWithoutOpenFlags();
  try {
    assertSecurityFailure(() => unavailableFlags.readPhysicalFile(root, file, 64));
  } finally {
    removePath(root);
  }
});

test('writePhysicalImmutable persists exact private bytes', () => {
  const root = temporaryDirectory('dhpk-physical-write-');
  const file = path.join(root, 'nested', 'payload.bin');
  const payload = Buffer.from([0x00, 0xff, 0x0a, 0x7f]);
  try {
    physicalFile.writePhysicalImmutable(root, file, payload);
    assert.deepStrictEqual(fs.readFileSync(file), payload);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    removePath(root);
  }
});

test('writePhysicalImmutable tolerates directory entry-count nlink changes', () => {
  const root = temporaryDirectory('dhpk-physical-directory-nlink-');
  const file = path.join(root, 'nested', 'payload.bin');
  const unrelated = path.join(root, 'nested', 'unrelated.tmp');
  const payload = Buffer.from('directory nlink changes are not identity changes\n');
  const originalLstatSync = fs.lstatSync;
  const originalOpenSync = fs.openSync;
  const originalFsyncSync = fs.fsyncSync;
  let unrelatedAdded = false;
  let unrelatedRemoved = false;
  fs.lstatSync = (target, ...args) => {
    const stat = originalLstatSync(target, ...args);
    if (stat.isDirectory()) {
      // APFS changes directory nlink as entries are created and removed. Model
      // that portable filesystem behavior while leaving regular-file stats
      // untouched, so the public writer is tested at its real seam.
      stat.nlink = 2 + fs.readdirSync(target).length;
    }
    return stat;
  };
  fs.openSync = (target, ...args) => {
    const descriptor = originalOpenSync(target, ...args);
    if (!unrelatedAdded && typeof target === 'string' && target.startsWith(`${file}.`)) {
      const sibling = originalOpenSync(
        unrelated,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600,
      );
      try {
        fs.writeSync(sibling, Buffer.from('unrelated activity\n'));
      } finally {
        fs.closeSync(sibling);
      }
      unrelatedAdded = true;
    }
    return descriptor;
  };
  fs.fsyncSync = (descriptor) => {
    originalFsyncSync(descriptor);
    if (unrelatedAdded && !unrelatedRemoved) {
      fs.unlinkSync(unrelated);
      unrelatedRemoved = true;
    }
  };
  try {
    physicalFile.writePhysicalImmutable(root, file, payload);
    assert.strictEqual(unrelatedAdded, true);
    assert.strictEqual(unrelatedRemoved, true);
    assert.deepStrictEqual(fs.readFileSync(file), payload);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['payload.bin']);
  } finally {
    fs.fsyncSync = originalFsyncSync;
    fs.openSync = originalOpenSync;
    fs.lstatSync = originalLstatSync;
    removePath(root);
  }
});

test('writePhysicalImmutable keeps regular-file nlink identity checks', () => {
  const root = temporaryDirectory('dhpk-physical-file-nlink-');
  const file = path.join(root, 'payload.bin');
  const originalFstatSync = fs.fstatSync;
  let descriptor;
  fs.fstatSync = (target, ...args) => {
    const stat = originalFstatSync(target, ...args);
    if (descriptor === undefined) descriptor = target;
    else if (target === descriptor && stat.isFile()) stat.nlink += 1;
    return stat;
  };
  try {
    assertSecurityFailure(() => physicalFile.writePhysicalImmutable(root, file, 'must reject'));
    assert.strictEqual(fs.existsSync(file), false);
  } finally {
    fs.fstatSync = originalFstatSync;
    removePath(root);
  }
});

test('writePhysicalImmutable refuses EEXIST without overwriting the existing file', () => {
  const root = temporaryDirectory('dhpk-physical-existing-');
  const file = path.join(root, 'payload.bin');
  const original = Buffer.from('keep-existing-bytes\n');
  writePrivate(file, original);
  try {
    assert.throws(
      () => physicalFile.writePhysicalImmutable(root, file, Buffer.from('replacement\n')),
      (error) => error && error.code === 'EEXIST',
    );
    assert.deepStrictEqual(fs.readFileSync(file), original);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepStrictEqual(fs.readdirSync(root), ['payload.bin']);
  } finally {
    removePath(root);
  }
});

test('writePhysicalImmutable rejects an ancestor swap before opening its temporary file', () => {
  const root = temporaryDirectory('dhpk-physical-race-');
  const outside = temporaryDirectory('dhpk-physical-race-outside-');
  const parent = path.join(root, 'nested');
  const backup = path.join(root, 'nested.backup');
  const file = path.join(parent, 'payload.bin');
  fs.mkdirSync(parent, { mode: 0o700 });
  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = (target, ...args) => {
    if (!swapped && typeof target === 'string' && path.dirname(path.resolve(target)) === parent) {
      swapped = true;
      fs.renameSync(parent, backup);
      fs.symlinkSync(outside, parent, 'dir');
    }
    return originalOpenSync(target, ...args);
  };
  try {
    assert.throws(
      () => physicalFile.writePhysicalImmutable(root, file, Buffer.from('must stay inside\n')),
      (error) => error && (error.code === 'ESECURITY' || error.code === 'ELOOP'),
    );
    assert.strictEqual(swapped, true);
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'ancestor swap must not leave payload outside root');
  } finally {
    fs.openSync = originalOpenSync;
    if (swapped) {
      removePath(parent);
      fs.renameSync(backup, parent);
    }
    removePath(root);
    removePath(outside);
  }
});

test('readPhysicalFile rejects a static symlink', () => {
  const root = temporaryDirectory('dhpk-physical-symlink-');
  const outside = temporaryDirectory('dhpk-physical-symlink-outside-');
  const target = path.join(outside, 'payload.bin');
  const link = path.join(root, 'payload.bin');
  writePrivate(target, Buffer.from('outside'));
  fs.symlinkSync(target, link);
  try {
    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, link, 64));
  } finally {
    removePath(root);
    removePath(outside);
  }
});

test('readPhysicalFile rejects a symlinked root without reading external bytes', () => {
  const realRoot = temporaryDirectory('dhpk-physical-read-root-');
  const linkParent = temporaryDirectory('dhpk-physical-read-root-link-');
  const linkRoot = path.join(linkParent, 'root');
  const file = path.join(realRoot, 'payload.bin');
  const payload = Buffer.from('private root bytes\n');
  writePrivate(file, payload);
  fs.symlinkSync(realRoot, linkRoot, 'dir');
  try {
    assert.deepStrictEqual(physicalFile.readPhysicalFile(realRoot, file, payload.length), payload);
    assertSecurityFailure(() => physicalFile.readPhysicalFile(
      linkRoot,
      path.join(linkRoot, 'payload.bin'),
      payload.length,
    ));
    assert.deepStrictEqual(fs.readFileSync(file), payload);
  } finally {
    removePath(linkParent);
    removePath(realRoot);
  }
});

test('readPhysicalFile rejects a target outside configured root', () => {
  const root = temporaryDirectory('dhpk-physical-read-boundary-');
  const outside = temporaryDirectory('dhpk-physical-read-outside-');
  const insideFile = path.join(root, 'inside.bin');
  const outsideFile = path.join(outside, 'outside.bin');
  const insideBytes = Buffer.from('inside root\n');
  const outsideBytes = Buffer.from('outside root\n');
  writePrivate(insideFile, insideBytes);
  writePrivate(outsideFile, outsideBytes);
  try {
    assert.deepStrictEqual(physicalFile.readPhysicalFile(root, insideFile, insideBytes.length), insideBytes);
    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, outsideFile, outsideBytes.length));
    assert.deepStrictEqual(fs.readFileSync(outsideFile), outsideBytes);
  } finally {
    removePath(root);
    removePath(outside);
  }
});

test('readPhysicalFile rejects post-read identity change and closes descriptor', () => {
  const root = temporaryDirectory('dhpk-physical-read-identity-');
  const file = path.join(root, 'payload.bin');
  const payload = Buffer.from('descriptor identity must remain stable\n');
  writePrivate(file, payload);
  const originalOpenSync = fs.openSync;
  const originalFstatSync = fs.fstatSync;
  const originalCloseSync = fs.closeSync;
  let descriptor;
  let descriptorFstats = 0;
  let descriptorClosed = false;
  try {
    assert.deepStrictEqual(physicalFile.readPhysicalFile(root, file, payload.length), payload);
    fs.openSync = function captureTarget(target, ...args) {
      const opened = originalOpenSync.call(fs, target, ...args);
      if (typeof target === 'string' && path.resolve(target) === file) descriptor = opened;
      return opened;
    };
    fs.fstatSync = function changeOnlyPostReadStat(target, ...args) {
      const stat = originalFstatSync.call(fs, target, ...args);
      if (target === descriptor) {
        descriptorFstats += 1;
        if (descriptorFstats === 2) stat.mtimeMs += 1;
      }
      return stat;
    };
    fs.closeSync = function observeTargetClose(target, ...args) {
      if (target === descriptor) descriptorClosed = true;
      return originalCloseSync.call(fs, target, ...args);
    };
    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, file, payload.length));
    assert.strictEqual(descriptor !== undefined, true);
    assert.strictEqual(descriptorFstats, 2);
    assert.strictEqual(descriptorClosed, true);
    assert.deepStrictEqual(fs.readFileSync(file), payload);
  } finally {
    fs.closeSync = originalCloseSync;
    fs.fstatSync = originalFstatSync;
    fs.openSync = originalOpenSync;
    removePath(root);
  }
});

test('readPhysicalFile rejects a short read and closes descriptor', () => {
  const root = temporaryDirectory('dhpk-physical-read-short-');
  const file = path.join(root, 'payload.bin');
  const payload = Buffer.from('the public reader must reject short data\n');
  writePrivate(file, payload);
  const originalOpenSync = fs.openSync;
  const originalReadSync = fs.readSync;
  const originalCloseSync = fs.closeSync;
  let descriptor;
  let targetedReads = 0;
  let descriptorClosed = false;
  try {
    assert.deepStrictEqual(physicalFile.readPhysicalFile(root, file, payload.length), payload);
    fs.openSync = function captureTarget(target, ...args) {
      const opened = originalOpenSync.call(fs, target, ...args);
      if (typeof target === 'string' && path.resolve(target) === file) descriptor = opened;
      return opened;
    };
    fs.readSync = function shortReadOnlyTarget(target, buffer, offset, length, position) {
      if (target === descriptor && targetedReads === 0) {
        targetedReads += 1;
        return originalReadSync.call(fs, target, buffer, offset, length - 1, position);
      }
      return originalReadSync.apply(fs, arguments);
    };
    fs.closeSync = function observeTargetClose(target, ...args) {
      if (target === descriptor) descriptorClosed = true;
      return originalCloseSync.call(fs, target, ...args);
    };
    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, file, payload.length));
    assert.strictEqual(descriptor !== undefined, true);
    assert.strictEqual(targetedReads, 1);
    assert.strictEqual(descriptorClosed, true);
    assert.deepStrictEqual(fs.readFileSync(file), payload);
  } finally {
    fs.closeSync = originalCloseSync;
    fs.readSync = originalReadSync;
    fs.openSync = originalOpenSync;
    removePath(root);
  }
});

test('readPhysicalFile rejects an after-open path snapshot change and closes descriptor', () => {
  assertPathSnapshotChangeRejected('after-open');
});

test('readPhysicalFile rejects an after-read path snapshot change and closes descriptor', () => {
  assertPathSnapshotChangeRejected('after-read');
});

test('readPhysicalFile rejects non-regular files and bytes above maxBytes', () => {
  const root = temporaryDirectory('dhpk-physical-limits-');
  const directory = path.join(root, 'directory');
  const file = path.join(root, 'payload.bin');
  fs.mkdirSync(directory, { mode: 0o700 });
  writePrivate(file, Buffer.from('0123456789'));
  try {
    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, directory, 64));
    assertSecurityFailure(() => physicalFile.readPhysicalFile(root, file, 4));
  } finally {
    removePath(root);
  }
});

run('physical-file');
