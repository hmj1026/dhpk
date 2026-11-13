'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  DEFAULT_TRAVERSAL_LIMITS,
  createTraversalBudget,
  readFileBounded,
  readDirectoryEntries,
  listFilesNamedRecursively,
  listPhysicalFiles,
  ensurePhysicalDirectory,
  assertPhysicalDirectory,
  physicalPackageRootError,
} = require('../scripts/lib/bounded-filesystem');

test('bounded traversal accounts file bytes before reading and exposes finite defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-fs-'));
  const file = path.join(root, 'payload.bin');
  fs.writeFileSync(file, Buffer.from('1234'));
  try {
    assert.strictEqual(DEFAULT_TRAVERSAL_LIMITS.maxBytes, 128 * 1024 * 1024);
    const budget = createTraversalBudget({ maxBytes: 3 });
    assert.throws(() => budget.readFile(file), /byte budget/i);
    assert.strictEqual(budget.bytes, 0, 'a rejected file must not be charged after the limit is exceeded');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded traversal detects an active real-directory cycle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-cycle-'));
  try {
    const budget = createTraversalBudget({ maxDepth: 8 });
    const realRoot = budget.enterDirectory(root, 0);
    try {
      assert.throws(() => budget.enterDirectory(root, 1), /cycle/i);
    } finally {
      budget.leaveDirectory(realRoot);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded reads reject symlink paths instead of following them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-symlink-'));
  const target = path.join(root, 'target.txt');
  const link = path.join(root, 'link.txt');
  fs.writeFileSync(target, 'secret');
  fs.symlinkSync(target, link);
  try {
    assert.throws(() => readFileBounded(link), /symlink|symbolic|too many levels/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded reads fail closed when the file changes size during the read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-toctou-'));
  const file = path.join(root, 'payload.bin');
  fs.writeFileSync(file, 'payload');
  const originalFstat = fs.fstatSync;
  let calls = 0;
  fs.fstatSync = (...args) => {
    const stat = originalFstat(...args);
    calls += 1;
    if (calls === 2) Object.defineProperty(stat, 'size', { value: stat.size + 1 });
    return stat;
  };
  try {
    assert.throws(() => createTraversalBudget().readFile(file), /changed while reading|size/i);
  } finally {
    fs.fstatSync = originalFstat;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded reads reject a file truncated mid-read without returning a partial or uninitialized buffer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-midread-'));
  const file = path.join(root, 'payload.bin');
  const originalReadSync = fs.readSync;
  try {
    // Truncate after the first (partial) chunk has been read: the next read
    // reports end-of-file while bytes are still owed to the caller.
    fs.writeFileSync(file, Buffer.alloc(200 * 1024, 0x61));
    let reads = 0;
    fs.readSync = (fd, buffer, offset, length, position) => {
      reads += 1;
      const count = originalReadSync(fd, buffer, offset, length, position);
      if (reads === 1) fs.truncateSync(file, count);
      return count;
    };
    let returned = null;
    assert.throws(
      () => { returned = createTraversalBudget().readFile(file, null, 'rel/midread.bin'); },
      (err) => err.message === 'file changed while reading: rel/midread.bin',
    );
    assert.strictEqual(returned, null);

    // Truncate after every byte was read: the post-read size check must still
    // reject the buffer.
    fs.writeFileSync(file, 'payload');
    fs.readSync = (fd, buffer, offset, length, position) => {
      const count = originalReadSync(fd, buffer, offset, length, position);
      fs.truncateSync(file, 3);
      return count;
    };
    assert.throws(
      () => createTraversalBudget().readFile(file, null, 'rel/late.bin'),
      (err) => err.message === 'file changed while reading: rel/late.bin',
    );
  } finally {
    fs.readSync = originalReadSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded directory reads stop at the entry budget before retaining a huge listing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-entries-'));
  try {
    for (let index = 0; index < 4; index += 1) fs.writeFileSync(path.join(root, `entry-${index}`), 'x');
    assert.throws(
      () => readDirectoryEntries(root, { budget: createTraversalBudget({ maxEntries: 2 }) }),
      /entry count/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recursive named-file listing preserves sorting, skips symlinks, and uses bounded directory reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-skill-list-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-skill-outside-'));
  try {
    for (const name of ['z', 'a', 'ä']) {
      const directory = path.join(root, name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'SKILL.md'), name);
    }
    fs.writeFileSync(path.join(outside, 'SKILL.md'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'linked'), 'dir');

    const binary = listFilesNamedRecursively(root, 'SKILL.md', { localeSort: false });
    assert.deepStrictEqual(binary.map((file) => path.relative(root, file).split(path.sep)[0]), ['a', 'z', 'ä']);
    const localized = listFilesNamedRecursively(root, 'SKILL.md', { localeSort: true });
    assert.deepStrictEqual(
      localized.map((file) => path.relative(root, file).split(path.sep)[0]),
      ['a', 'z', 'ä'].sort((left, right) => left.localeCompare(right)),
    );
    assert.throws(
      () => listFilesNamedRecursively(root, 'SKILL.md', { maxEntries: 1 }),
      /entry count/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('T1 golden: createTraversalBudget locks verbatim limit, cycle, entry, byte, file, and read errors', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-golden-')));
  try {
    for (const key of ['maxDepth', 'maxFiles', 'maxEntries', 'maxBytes']) {
      for (const bad of [-1, 1.5, Number.NaN, 'abc']) {
        assert.throws(
          () => createTraversalBudget({ [key]: bad }),
          (err) => err instanceof TypeError && err.message === `${key} must be a non-negative safe integer`,
        );
      }
    }

    const dir = path.join(root, 'dir');
    const nested = path.join(dir, 'nested');
    const fileA = path.join(dir, 'a.txt');
    const fileB = path.join(dir, 'b.txt');
    const missingDir = path.join(root, 'missing-dir');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(fileA, '1234');
    fs.writeFileSync(fileB, '5678');

    const depthBudget = createTraversalBudget({ maxDepth: 0 });
    assert.throws(
      () => depthBudget.enterDirectory(nested, 1),
      (err) => err.message === `maximum directory depth (0) exceeded: ${nested}`,
    );
    assert.throws(
      () => depthBudget.enterDirectory(missingDir, 0),
      (err) => err.message.startsWith(`unable to resolve directory while fingerprinting ${missingDir}: `),
    );
    const entered = depthBudget.enterDirectory(dir, 0);
    assert.throws(
      () => depthBudget.enterDirectory(dir, 0),
      (err) => err.message === `symlink cycle detected while fingerprinting: ${dir}`,
    );
    depthBudget.leaveDirectory(entered);

    const entryBudget = createTraversalBudget({ maxEntries: 1 });
    assert.throws(
      () => readDirectoryEntries(dir, { budget: entryBudget, sort: true }),
      (err) => err.message.startsWith(`maximum fingerprint entry count (1) exceeded: ${dir}${path.sep}`),
    );
    const directEntryBudget = createTraversalBudget({ maxEntries: 0 });
    assert.throws(
      () => directEntryBudget.accountEntry('rel/item.txt'),
      (err) => err.message === 'maximum fingerprint entry count (0) exceeded: rel/item.txt',
    );

    const byteBudget = createTraversalBudget({ maxBytes: 4 });
    assert.throws(
      () => byteBudget.accountBytes(-1, 'rel/bad.bin'),
      (err) => err.message === 'cannot account invalid byte size: rel/bad.bin',
    );
    assert.throws(
      () => byteBudget.accountBytes(5, 'rel/big.bin'),
      (err) => err.message === 'maximum fingerprint byte budget (4 bytes) exceeded: rel/big.bin',
    );

    const fileBudget = createTraversalBudget({ maxFiles: 1 });
    const dirStat = fs.lstatSync(dir);
    assert.throws(
      () => fileBudget.accountFile(dir, dirStat),
      (err) => err.message === `cannot fingerprint non-file entry: ${dir}`,
    );
    assert.throws(
      () => fileBudget.accountFile(fileA, { isFile: () => true, size: -1 }),
      (err) => err.message === `cannot fingerprint file with an invalid size: ${fileA}`,
    );
    assert.strictEqual(fileBudget.readFile(fileA, null, 'rel/a.txt').toString('utf8'), '1234');
    assert.throws(
      () => fileBudget.readFile(fileB, null, 'rel/b.txt'),
      (err) => err.message === 'maximum fingerprint file count (1) exceeded: rel/b.txt',
    );

    const readBudget = createTraversalBudget();
    assert.throws(
      () => readBudget.readFile(fileA, { isSymbolicLink: () => true }, 'rel/link.txt'),
      (err) => err.message === 'refusing to read symlink path: rel/link.txt',
    );
    assert.throws(
      () => readBudget.readFile(fileA, { dev: -1, ino: -1, isSymbolicLink: () => false }, 'rel/swapped.txt'),
      (err) => err.message === 'file identity changed before reading: rel/swapped.txt',
    );

    const originalReadSync = fs.readSync;
    fs.readSync = () => 0;
    try {
      assert.throws(
        () => readBudget.readFile(fileA, null, 'rel/truncated.txt'),
        (err) => err.message === 'file changed while reading: rel/truncated.txt',
      );
    } finally {
      fs.readSync = originalReadSync;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T1 golden: physical directory helpers lock verbatim ancestor, file, missing, and symlink errors', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-phys-golden-')));
  try {
    const realDir = path.join(root, 'real-dir');
    const symlinkTarget = path.join(root, 'symlink-dir');
    const nestedChild = path.join(symlinkTarget, 'child');
    const regularFile = path.join(root, 'regular-file');
    const missingDir = path.join(root, 'does-not-exist');
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, symlinkTarget);
    fs.writeFileSync(regularFile, 'file');

    assert.throws(
      () => ensurePhysicalDirectory(symlinkTarget, 'custom root'),
      (err) => err.message === `refusing symlinked custom root ancestor: ${symlinkTarget}`,
    );
    assert.throws(
      () => assertPhysicalDirectory(symlinkTarget, 'custom root'),
      (err) => err.message === `refusing symlinked custom root ancestor: ${symlinkTarget}`,
    );
    assert.strictEqual(
      physicalPackageRootError(symlinkTarget, 'custom root'),
      `refusing symlinked custom root ancestor: ${symlinkTarget}`,
    );

    assert.throws(
      () => ensurePhysicalDirectory(nestedChild, 'custom root'),
      (err) => err.message === `refusing symlinked custom root ancestor: ${symlinkTarget}`,
    );
    assert.throws(
      () => assertPhysicalDirectory(nestedChild, 'custom root'),
      (err) => err.message === `refusing symlinked custom root ancestor: ${symlinkTarget}`,
    );
    assert.strictEqual(
      physicalPackageRootError(nestedChild, 'custom root'),
      `refusing symlinked custom root ancestor: ${symlinkTarget}`,
    );

    assert.throws(
      () => ensurePhysicalDirectory(regularFile, 'custom root'),
      (err) => err.message === `custom root must be a directory: ${regularFile}`,
    );
    assert.throws(
      () => assertPhysicalDirectory(regularFile, 'custom root'),
      (err) => err.message === `custom root must be a directory: ${regularFile}`,
    );
    assert.strictEqual(
      physicalPackageRootError(regularFile, 'custom root'),
      `custom root must be a physical directory: ${regularFile}`,
    );

    assert.strictEqual(assertPhysicalDirectory(missingDir, 'custom root'), path.resolve(missingDir));
    assert.strictEqual(
      physicalPackageRootError(missingDir, 'custom root'),
      `custom root must be a physical directory: ${missingDir}`,
    );
    assert.strictEqual(physicalPackageRootError(realDir, 'custom root'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const WALKER_LABELS = Object.freeze({
  symlink: 'symlink is not allowed in WALKER TREE',
  unsupported: 'unsupported WALKER TREE entry',
});

function withWalkerTree(build, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-physical-walker-'));
  try {
    build(root);
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('physical file walker returns sorted posix-relative files and recurses into nested directories', () => {
  withWalkerTree((root) => {
    fs.mkdirSync(path.join(root, 'b', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'z.txt'), 'z');
    fs.writeFileSync(path.join(root, 'b', 'deep', 'leaf.txt'), 'leaf');
    fs.writeFileSync(path.join(root, 'a', 'one.txt'), '1');
  }, (root) => {
    assert.deepStrictEqual(listPhysicalFiles(root, WALKER_LABELS), ['a/one.txt', 'b/deep/leaf.txt', 'z.txt']);
  });
});

test('physical file walker returns an empty list for an empty directory', () => {
  withWalkerTree(() => {}, (root) => {
    assert.deepStrictEqual(listPhysicalFiles(root, WALKER_LABELS), []);
  });
});

test('physical file walker rejects a file symlink using the caller label verbatim', () => {
  withWalkerTree((root) => {
    fs.writeFileSync(path.join(root, 'real.txt'), 'x');
    fs.symlinkSync('real.txt', path.join(root, 'link.txt'));
  }, (root) => {
    assert.throws(
      () => listPhysicalFiles(root, WALKER_LABELS),
      (error) => error.message === `symlink is not allowed in WALKER TREE: ${path.join(root, 'link.txt')}`,
    );
  });
});

test('physical file walker rejects a directory symlink without following it', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-physical-walker-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
    withWalkerTree((root) => {
      fs.symlinkSync(outside, path.join(root, 'linked'), 'dir');
    }, (root) => {
      assert.throws(
        () => listPhysicalFiles(root, WALKER_LABELS),
        (error) => error.message === `symlink is not allowed in WALKER TREE: ${path.join(root, 'linked')}`,
      );
    });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('physical file walker rejects a non-regular entry using the caller label verbatim', () => {
  const { spawnSync } = require('node:child_process');
  withWalkerTree((root) => {
    const made = spawnSync('mkfifo', [path.join(root, 'pipe')]);
    assert.strictEqual(made.status, 0, 'mkfifo is required to create a non-regular fixture');
  }, (root) => {
    assert.throws(
      () => listPhysicalFiles(root, WALKER_LABELS),
      (error) => error.message === `unsupported WALKER TREE entry: ${path.join(root, 'pipe')}`,
    );
  });
});

test('physical file walker reports the symlink before later siblings in locale order', () => {
  withWalkerTree((root) => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.symlinkSync('a.txt', path.join(root, 'b.txt'));
    const made = require('node:child_process').spawnSync('mkfifo', [path.join(root, 'c.pipe')]);
    assert.strictEqual(made.status, 0);
  }, (root) => {
    assert.throws(() => listPhysicalFiles(root, WALKER_LABELS), /symlink is not allowed in WALKER TREE: .*b\.txt$/);
  });
});

test('physical file walker enforces entry and depth budgets', () => {
  withWalkerTree((root) => {
    fs.mkdirSync(path.join(root, 'd1', 'd2'), { recursive: true });
    for (const name of ['one', 'two', 'three']) fs.writeFileSync(path.join(root, name), name);
  }, (root) => {
    assert.throws(() => listPhysicalFiles(root, WALKER_LABELS, { maxEntries: 2 }), /maximum fingerprint entry count \(2\) exceeded/);
    assert.throws(() => listPhysicalFiles(root, WALKER_LABELS, { maxDepth: 1 }), /maximum directory depth \(1\) exceeded/);
  });
});

run('bounded-filesystem');
