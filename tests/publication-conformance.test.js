'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { checkPublicPlugin } = require('../scripts/lib/publication-conformance');

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

run('publication-conformance');
