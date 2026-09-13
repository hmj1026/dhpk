'use strict';

// The Claude marketplace source must be a consumer-shaped package, not the
// repository root. The root carries development-only CLAUDE.md instructions;
// a marketplace cache copies that file and strict validation rejects it.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const MARKETPLACE = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
const ENTRY = MARKETPLACE.plugins.find((plugin) => plugin.name === 'dhpk');
const GENERATOR = require('../scripts/ci/gen-claude-marketplace-package');

function resolvePackagePath(value) {
  return path.resolve(ROOT, value.replace(/^\.\//, ''));
}

function assertNoSymlinks(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `marketplace package must not depend on symlink '${absolute}'`);
    if (entry.isDirectory()) assertNoSymlinks(absolute);
  }
}

test('Claude marketplace points at a physical package without root project context', () => {
  assert.ok(ENTRY, 'Claude marketplace must declare the dhpk plugin');
  assert.notStrictEqual(ENTRY.source, './', 'Claude marketplace must not publish the repository root');

  const packageRoot = resolvePackagePath(ENTRY.source);
  assert.ok(fs.existsSync(path.join(packageRoot, '.claude-plugin', 'plugin.json')),
    'marketplace source must contain a Claude plugin manifest');
  assert.strictEqual(fs.existsSync(path.join(packageRoot, 'CLAUDE.md')), false,
    'marketplace package must exclude development-only root CLAUDE.md');
  assertNoSymlinks(packageRoot);
});

test('Claude marketplace package contains every manifest-declared asset root', () => {
  const packageRoot = resolvePackagePath(ENTRY.source);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const relative of [...(manifest.skills || []), ...(manifest.agents || []), ...(manifest.commands || [])]) {
    assert.ok(fs.existsSync(path.join(packageRoot, relative.replace(/^\.\//, ''))),
      `marketplace package is missing manifest asset '${relative}'`);
  }
});

test('Claude marketplace generator rejects output paths that overlap canonical sources', () => {
  assert.throws(
    () => GENERATOR.materialize({ out: ROOT }),
    /overlaps canonical source path/i,
  );
});

test('Claude marketplace generator rejects symlinked output parents', () => {
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-claude-output-'));
  const alias = path.join(temp, 'alias');
  try {
    fs.symlinkSync(ROOT, alias, 'dir');
    assert.throws(
      () => GENERATOR.materialize({ out: path.join(alias, 'agents', 'nested') }),
      /overlaps canonical source path/i,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('gen-claude-marketplace-package');
