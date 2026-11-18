'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { selectRuntimeFiles } = require('../scripts/lib/directory-plugin-runtime');

const entry = (text) => ({ content: Buffer.from(text), mode: 0o644 });
const tree = (paths) => new Map(paths.map((file) => [file, entry(file)]));
const selected = (paths) => [...selectRuntimeFiles(tree(paths)).keys()].sort();

test('runtime directories and hook scripts are kept', () => {
  const paths = ['skills/a/SKILL.md', 'agents/a.md', 'hooks/hooks.json', 'scripts/hooks/a.sh', 'scripts/lib/a.js', 'manifests/m.json'];
  assert.deepStrictEqual(selected(paths), [...paths].sort());
});

test('docs, CI, release, and maintainer files are dropped', () => {
  const dropped = ['docs/a.md', 'docs/adr/0001.md', 'scripts/ci/gen.js', 'scripts/release/prepare.js', 'scripts/maintainer/x.js', 'scripts/validate/v.js'];
  assert.deepStrictEqual(selected(['skills/a/SKILL.md', ...dropped]), ['skills/a/SKILL.md']);
});

test('the shared CI library that runtime scripts require is kept', () => {
  assert.deepStrictEqual(selected(['scripts/ci/_lib/frontmatter.js', 'scripts/ci/gen.js']), ['scripts/ci/_lib/frontmatter.js']);
});

test('selection returns a new Map and leaves its input intact', () => {
  const input = tree(['docs/a.md', 'skills/a/SKILL.md']);
  const output = selectRuntimeFiles(input);
  assert.notStrictEqual(output, input);
  assert.strictEqual(input.size, 2);
});

run('directory-plugin-runtime');
