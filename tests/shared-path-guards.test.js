'use strict';

// Behavior of the helpers that #1248 converged into shared modules, pinned to
// the strictest variant each Host previously carried.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { findSymlinks, assertPhysicalDirectory, ensurePhysicalDirectory } = require('../scripts/lib/bounded-filesystem');
const { fingerprintPath } = require('../scripts/lib/content-fingerprint');
const { sanitizeMarkdownLinks, CANONICAL_REPOSITORY_URL } = require('../scripts/lib/markdown-link-sanitizer');

function tmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-shared-guards-')));
}

test('findSymlinks reports a symlinked root itself and nested links in sorted order', () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, 'tree/b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tree/file.txt'), 'x');
    fs.symlinkSync('file.txt', path.join(root, 'tree/z-link'));
    fs.symlinkSync('../file.txt', path.join(root, 'tree/b/a-link'));
    fs.symlinkSync('tree', path.join(root, 'root-link'));
    assert.deepStrictEqual(findSymlinks(path.join(root, 'tree')), [path.join(root, 'tree/b/a-link'), path.join(root, 'tree/z-link')]);
    assert.deepStrictEqual(findSymlinks(path.join(root, 'root-link')), [path.join(root, 'root-link')]);
    assert.deepStrictEqual(findSymlinks(path.join(root, 'missing')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assertPhysicalDirectory never creates, and refuses files and symlinked directories', () => {
  const root = tmp();
  try {
    assert.strictEqual(assertPhysicalDirectory(path.join(root, 'absent'), 'probe'), path.join(root, 'absent'));
    assert.strictEqual(fs.existsSync(path.join(root, 'absent')), false);
    fs.writeFileSync(path.join(root, 'file'), 'x');
    assert.throws(() => assertPhysicalDirectory(path.join(root, 'file'), 'probe'), /probe must be a directory/);
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync('real', path.join(root, 'linked'));
    assert.throws(() => assertPhysicalDirectory(path.join(root, 'linked'), 'probe'), /refusing symlinked probe/);
    assert.strictEqual(ensurePhysicalDirectory(path.join(root, 'made/deep'), 'probe'), path.join(root, 'made/deep'));
    assert.ok(fs.statSync(path.join(root, 'made/deep')).isDirectory());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fingerprintPath fingerprints files and directory trees and refuses symlinks', () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, 'dir/sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dir/a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'dir/sub/b.txt'), 'b');
    const tree = fingerprintPath(path.join(root, 'dir'));
    assert.match(tree, /^[a-f0-9]{64}$/);
    assert.match(fingerprintPath(path.join(root, 'dir/a.txt')), /^[a-f0-9]{64}$/);
    assert.strictEqual(fingerprintPath(path.join(root, 'missing')), '');
    fs.writeFileSync(path.join(root, 'dir/sub/b.txt'), 'changed');
    assert.notStrictEqual(fingerprintPath(path.join(root, 'dir')), tree);
    fs.symlinkSync('dir', path.join(root, 'link'));
    assert.throws(() => fingerprintPath(path.join(root, 'link')), /symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sanitizeMarkdownLinks rewrites in-root links and drops missing or escaping ones', () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, 'skills/x/references'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills/x/references/guide.md'), '# g');
    const source = path.join(root, 'skills/x/SKILL.md');
    const text = '[guide](references/guide.md#top) [gone](missing.md) [out](../../../etc/passwd) [web](https://example.com) [anchor](#here)';
    assert.strictEqual(
      sanitizeMarkdownLinks(text, source, root),
      `[guide](${CANONICAL_REPOSITORY_URL}skills/x/references/guide.md#top) [gone] [out] [web](https://example.com) [anchor](#here)`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('standalone dependency paths reject drive prefixes', () => {
  const { resolveStandaloneSkillDependencies } = require('../scripts/lib/standalone-skill-dependencies');
  const root = tmp();
  try {
    fs.writeFileSync(path.join(root, 'asset.md'), 'x');
    const inventory = (file) => ({ standalone_dependencies: { demo: { files: [file] } } });
    for (const file of [{ source: 'C:/asset.md', destination: 'asset.md' }, { source: 'asset.md', destination: 'D:evil.md' }]) {
      assert.throws(() => resolveStandaloneSkillDependencies(inventory(file), 'demo', root), /must be a safe relative path/, JSON.stringify(file));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('shared-path-guards');
