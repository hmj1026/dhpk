'use strict';

// Public Plugin layout cleanup (#1497): internal metadata dropped, nested
// reference entries renamed, listing icon moved to ./assets/, listing counts
// filled from the catalog.

const { test, run, assert } = require('./_lib/tinytest');
const { layoutPublicPlugin } = require('../scripts/lib/public-plugin-layout');

const file = (filePath, text, extra = {}) => ({ path: filePath, bytes: Buffer.from(text), mode: 0o644, ownerId: 'o', ...extra });
const listing = (extra = {}) => ({
  shortDescription: 'Skills',
  longDescription: '{workflowCount} general workflows and {referenceCount} bundled reference resources.',
  composerIcon: './skills/a/assets/icon.svg',
  logo: './skills/a/assets/icon.svg',
  ...extra,
});
const manifest = (extra) => ({ name: 'dhpk', extensions: { 'com.openai': { interface: listing(extra) } } });
const counts = { workflowCount: 3, referenceCount: 7 };

function baseFiles() {
  return [
    file('skills/a/SKILL.md', '---\nname: a\n---\nsee [ref](references/b/SKILL.md)\n'),
    file('skills/a/distribution.yaml', '{}'),
    file('skills/a/assets/icon.svg', '<svg/>'),
    file('skills/a/references/b/SKILL.md', '---\nname: b\n---\nthe selected `SKILL.md` and skills/php/SKILL.md\n'),
    file('skills/a/references/b/distribution.yaml', '{}'),
    file('skills/a/references/b/notes.md', 'back to [SKILL.md](SKILL.md)\n'),
    file('skills/a/references/b/run.js', "const x = 'SKILL.md';\n"),
  ];
}

const layout = (overrides = {}) => layoutPublicPlugin({ files: baseFiles(), manifest: manifest(), counts, ...overrides });
const paths = (result) => result.files.map((entry) => entry.path).sort();
const text = (result, filePath) => result.files.find((entry) => entry.path === filePath).bytes.toString('utf8');

test('layout drops distribution.yaml at every level', () => {
  assert.deepStrictEqual(paths(layout()).filter((entry) => entry.endsWith('distribution.yaml')), []);
});

test('layout renames a nested reference SKILL.md and keeps the top-level one', () => {
  const result = layout();
  assert.ok(paths(result).includes('skills/a/SKILL.md'));
  assert.ok(paths(result).includes('skills/a/references/b/REFERENCE.md'));
  assert.ok(!paths(result).includes('skills/a/references/b/SKILL.md'));
});

test('layout rewrites bare SKILL.md mentions inside renamed reference directories only', () => {
  const result = layout();
  assert.match(text(result, 'skills/a/references/b/REFERENCE.md'), /selected `REFERENCE\.md` and skills\/php\/SKILL\.md/);
  assert.match(text(result, 'skills/a/references/b/notes.md'), /\[REFERENCE\.md\]\(REFERENCE\.md\)/);
  assert.match(text(result, 'skills/a/references/b/run.js'), /SKILL\.md/);
});

test('layout repoints links to a renamed entry from outside its directory', () => {
  assert.strictEqual(text(layout(), 'skills/a/SKILL.md'), '---\nname: a\n---\nsee [ref](references/b/REFERENCE.md)\n');
});

test('layout leaves unresolvable SKILL.md mentions outside renamed directories alone', () => {
  const files = [...baseFiles(), file('skills/a/references/other.md', 'see skills/php/SKILL.md and [x](../SKILL.md) and [y](nowhere/SKILL.md)\n')];
  const result = layoutPublicPlugin({ files, manifest: manifest(), counts });
  assert.strictEqual(text(result, 'skills/a/references/other.md'), 'see skills/php/SKILL.md and [x](../SKILL.md) and [y](nowhere/SKILL.md)\n');
});

test('layout moves the listing icon to ./assets/ and rewrites the listing', () => {
  const result = layout();
  assert.deepStrictEqual(result.assetFiles.map((entry) => entry.path), ['assets/icon.svg']);
  assert.ok(!paths(result).includes('skills/a/assets/icon.svg'));
  const iface = result.manifest.extensions['com.openai'].interface;
  assert.strictEqual(iface.composerIcon, './assets/icon.svg');
  assert.strictEqual(iface.logo, './assets/icon.svg');
});

test('layout fills listing counts from the catalog', () => {
  const iface = layout().manifest.extensions['com.openai'].interface;
  assert.strictEqual(iface.longDescription, '3 general workflows and 7 bundled reference resources.');
});

test('layout does not mutate its inputs', () => {
  const input = manifest();
  layoutPublicPlugin({ files: baseFiles(), manifest: input, counts });
  assert.strictEqual(input.extensions['com.openai'].interface.composerIcon, './skills/a/assets/icon.svg');
  assert.match(input.extensions['com.openai'].interface.longDescription, /\{workflowCount\}/);
});

test('layout fails on an unknown count token', () => {
  const result = layout({ manifest: manifest({ longDescription: '{mystery} workflows' }) });
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join('; '), /unresolved count token/);
});

test('layout fails when the listing icon is not in the content', () => {
  const result = layout({ manifest: manifest({ logo: './skills/a/assets/missing.svg' }) });
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join('; '), /missing\.svg/);
});

test('layout fails when two icons would collide in ./assets/', () => {
  const files = [...baseFiles(), file('skills/z/assets/icon.svg', '<svg id="z"/>')];
  const result = layoutPublicPlugin({ files, manifest: manifest({ logo: './skills/z/assets/icon.svg' }), counts });
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join('; '), /collide/);
});

test('layout requires an OpenAI listing interface', () => {
  const result = layoutPublicPlugin({ files: baseFiles(), manifest: { name: 'dhpk' }, counts });
  assert.strictEqual(result.ok, false);
});

run('public-plugin-layout');
