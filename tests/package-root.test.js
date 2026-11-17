'use strict';

// Coverage for scripts/lib/package-root.js (ADR 0038): the owning package root
// comes from the physical script location, never from the environment.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');
const { resolveOwningPackageRoot } = require('../scripts/lib/package-root');

function makePackage(parent, name, asset = 'skills') {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, asset), { recursive: true });
  return fs.realpathSync(root);
}

function withTemp(fn) {
  return fn(fs.realpathSync(makeTempDir('package-root-')));
}

function withEnv(value, fn) {
  const previous = process.env.CLAUDE_PLUGIN_ROOT;
  if (value === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = value;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = previous;
  }
}

test('resolves the package that contains the starting directory', () => withTemp((tmp) => {
  const pkg = makePackage(tmp, 'pkg');
  const got = resolveOwningPackageRoot({ fromDir: path.join(pkg, 'scripts', 'lib'), levelsUp: 2, requiredAsset: 'skills' });
  assert.strictEqual(got, pkg);
}));

test('ignores CLAUDE_PLUGIN_ROOT whether unset, empty, missing, foreign, or another copy', () => withTemp((tmp) => {
  const pkg = makePackage(tmp, 'pkg');
  const other = makePackage(tmp, 'other-copy');
  const foreign = path.join(tmp, 'foreign');
  fs.mkdirSync(foreign);
  const args = { fromDir: path.join(pkg, 'scripts', 'lib'), levelsUp: 2, requiredAsset: 'skills' };
  for (const value of [undefined, '', path.join(tmp, 'does-not-exist'), foreign, other]) {
    assert.strictEqual(withEnv(value, () => resolveOwningPackageRoot(args)), pkg, `env=${String(value)}`);
  }
}));

test('supports a package path containing spaces', () => withTemp((tmp) => {
  const pkg = makePackage(tmp, 'my package dir');
  const got = resolveOwningPackageRoot({ fromDir: path.join(pkg, 'scripts', 'lib'), levelsUp: 2, requiredAsset: 'skills' });
  assert.strictEqual(got, pkg);
}));

test('resolves a symlinked starting directory to the physical package', () => withTemp((tmp) => {
  const pkg = makePackage(tmp, 'pkg');
  const alias = path.join(tmp, 'alias-lib');
  fs.symlinkSync(path.join(pkg, 'scripts', 'lib'), alias);
  const got = resolveOwningPackageRoot({ fromDir: alias, levelsUp: 2, requiredAsset: 'skills' });
  assert.strictEqual(got, pkg);
}));

test('throws when the required asset is missing, without searching elsewhere', () => withTemp((tmp) => {
  const pkg = makePackage(tmp, 'pkg', 'other-asset');
  const sibling = makePackage(tmp, 'sibling');
  let error = null;
  withEnv(sibling, () => {
    try {
      resolveOwningPackageRoot({ fromDir: path.join(pkg, 'scripts', 'lib'), levelsUp: 2, requiredAsset: 'skills' });
    } catch (e) { error = e; }
  });
  assert.ok(error, 'expected throw');
  assert.match(error.message, /package root unresolved.*skills/);
}));

test('throws when the starting directory does not exist', () => withTemp((tmp) => {
  assert.throws(
    () => resolveOwningPackageRoot({ fromDir: path.join(tmp, 'nope'), levelsUp: 1, requiredAsset: 'skills' }),
    /package root unresolved/,
  );
}));

run('package-root');
