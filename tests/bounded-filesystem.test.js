'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { DEFAULT_TRAVERSAL_LIMITS, createTraversalBudget, readFileBounded, readDirectoryEntries } = require('../scripts/lib/bounded-filesystem');

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

run('bounded-filesystem');
