'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { checkPublicPlugin, checkDirectoryPlugin, runClaudeValidate } = require('../scripts/lib/publication-conformance');

const VERSION = '1.2.3';
const manifest = (extra = {}) => Buffer.from(JSON.stringify({ name: 'dhpk', version: VERSION, ...extra }));
const tree = (overrides = {}) => new Map(Object.entries({
  'plugin.json': manifest(),
  'skills/a/SKILL.md': Buffer.from('---\nname: a\n---\n'),
  ...overrides,
}));

test('conformant Public Plugin passes', () => {
  assert.deepStrictEqual(checkPublicPlugin(tree(), { version: VERSION }), []);
});

test('Public Plugin with a hooks directory fails', () => {
  const errors = checkPublicPlugin(tree({ 'hooks/hooks.json': Buffer.from('{}') }), { version: VERSION });
  assert.ok(errors.some((error) => /hooks/.test(error)), errors.join('; '));
});

test('Public Plugin with a hooks manifest key fails', () => {
  const errors = checkPublicPlugin(tree({ 'plugin.json': manifest({ hooks: './hooks/hooks.json' }) }), { version: VERSION });
  assert.ok(errors.some((error) => /hooks/.test(error)), errors.join('; '));
});

test('Public Plugin hooks inside the Codex manifest fail', () => {
  const errors = checkPublicPlugin(tree({ '.codex-plugin/plugin.json': manifest({ hooks: {} }) }), { version: VERSION });
  assert.ok(errors.some((error) => /hooks/.test(error)), errors.join('; '));
});

test('Public Plugin version differing from package.json fails', () => {
  const errors = checkPublicPlugin(tree({ 'plugin.json': manifest({ version: '0.64.4' }) }), { version: VERSION });
  assert.ok(errors.some((error) => /0\.64\.4/.test(error) && /1\.2\.3/.test(error)), errors.join('; '));
});

test('Public Plugin without a manifest fails', () => {
  const files = tree();
  files.delete('plugin.json');
  assert.ok(checkPublicPlugin(files, { version: VERSION }).length > 0);
});

const words = (count) => Buffer.from(Array.from({ length: count }, () => 'word').join(' '));
const directoryManifest = (extra = {}) => Buffer.from(JSON.stringify({
  name: 'dhpk', version: VERSION, homepage: 'https://example.com/dhpk', repository: 'https://example.com/dhpk.git',
  icon: './.claude-plugin/icon.png', ...extra,
}));
// A null override removes that file from the tree.
const directoryTree = (overrides = {}) => {
  const files = new Map(Object.entries({
    '.claude-plugin/plugin.json': directoryManifest(),
    '.claude-plugin/icon.png': Buffer.from('png'),
    'README.md': words(45),
    LICENSE: Buffer.from('MIT'),
    'skills/a/SKILL.md': Buffer.from('---\nname: a\n---\n'),
    ...overrides,
  }));
  for (const [file, value] of [...files]) if (value === null) files.delete(file);
  return files;
};
const directoryErrors = (overrides) => checkDirectoryPlugin(directoryTree(overrides), { version: VERSION });

test('conformant Directory Plugin passes', () => {
  assert.deepStrictEqual(directoryErrors(), []);
});

test('Directory Plugin carrying docs, CI, or release files fails', () => {
  for (const file of ['docs/guide.md', '.github/workflows/ci.yml', 'scripts/ci/gen.js', 'scripts/release/prepare.js']) {
    const errors = directoryErrors({ [file]: Buffer.from('x') });
    assert.ok(errors.some((error) => error.includes(file)), `${file}: ${errors.join('; ')}`);
  }
});

test('Directory Plugin keeps runtime scripts and hooks', () => {
  assert.deepStrictEqual(directoryErrors({
    'scripts/hooks/a.sh': Buffer.from('x'), 'hooks/hooks.json': Buffer.from('{}'), 'scripts/ci/_lib/frontmatter.js': Buffer.from('x'),
  }), []);
});

test('Directory Plugin README under 40 words fails and 40 words passes', () => {
  const errors = directoryErrors({ 'README.md': words(39) });
  assert.ok(errors.some((error) => /40 words/.test(error)), errors.join('; '));
  assert.deepStrictEqual(directoryErrors({ 'README.md': words(40) }), []);
});

test('Directory Plugin missing README or LICENSE fails', () => {
  assert.ok(directoryErrors({ 'README.md': null }).some((error) => /README/.test(error)));
  assert.ok(directoryErrors({ LICENSE: null }).some((error) => /LICENSE/.test(error)));
});

test('Directory Plugin manifest without icon, repository, or URL fields fails', () => {
  for (const field of ['icon', 'repository', 'homepage']) {
    const manifest = JSON.parse(directoryManifest().toString());
    delete manifest[field];
    const errors = directoryErrors({ '.claude-plugin/plugin.json': Buffer.from(JSON.stringify(manifest)) });
    assert.ok(errors.some((error) => error.includes(field)), `${field}: ${errors.join('; ')}`);
  }
});

test('Directory Plugin icon that is not packaged fails', () => {
  const errors = directoryErrors({ '.claude-plugin/icon.png': null });
  assert.ok(errors.some((error) => /icon/.test(error)), errors.join('; '));
});

test('Directory Plugin non-https URL field fails', () => {
  const errors = directoryErrors({ '.claude-plugin/plugin.json': directoryManifest({ repository: 'git@host:x.git' }) });
  assert.ok(errors.some((error) => /repository/.test(error)), errors.join('; '));
});

test('Directory Plugin version differing from package.json fails', () => {
  const errors = directoryErrors({ '.claude-plugin/plugin.json': directoryManifest({ version: '0.64.4' }) });
  assert.ok(errors.some((error) => /0\.64\.4/.test(error) && /1\.2\.3/.test(error)), errors.join('; '));
});

test('Directory Plugin without a manifest fails', () => {
  assert.ok(directoryErrors({ '.claude-plugin/plugin.json': null }).some((error) => /plugin\.json/.test(error)));
});

test('claude plugin validate passes when the runner exits 0', () => {
  const seen = [];
  assert.deepStrictEqual(runClaudeValidate('/pkg', (directory) => { seen.push(directory); return { status: 0, output: 'ok' }; }), []);
  assert.deepStrictEqual(seen, ['/pkg']);
});

test('claude plugin validate failure and missing CLI are reported', () => {
  const failed = runClaudeValidate('/pkg', () => ({ status: 1, output: 'missing README' }));
  assert.ok(failed.some((error) => /exit 1/.test(error) && /missing README/.test(error)), failed.join('; '));
  const missing = runClaudeValidate('/pkg', () => ({ error: 'ENOENT' }));
  assert.ok(missing.some((error) => /could not run/.test(error)), missing.join('; '));
});

run('publication-conformance');
