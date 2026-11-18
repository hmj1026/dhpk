'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { checkPublicPlugin } = require('../scripts/lib/publication-conformance');

const VERSION = '1.2.3';
const LISTING = {
  shortDescription: 'Skills for software delivery',
  longDescription: 'A plugin with 1 general workflows and 1 bundled specialist reference resources.',
  composerIcon: './assets/icon.svg',
  logo: './assets/icon.svg',
};
const withListing = (overrides = {}) => ({ extensions: { 'com.openai': { interface: { ...LISTING, ...overrides } } } });
const manifest = (extra = {}) => Buffer.from(JSON.stringify({ name: 'dhpk', version: VERSION, ...withListing(), ...extra }));
const tree = (overrides = {}) => new Map(Object.entries({
  'plugin.json': manifest(),
  'skills/a/SKILL.md': Buffer.from('---\nname: a\n---\n'),
  'skills/a/references/b/REFERENCE.md': Buffer.from('---\nname: b\n---\n'),
  'assets/icon.svg': Buffer.from('<svg/>'),
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

const run1 = (files) => checkPublicPlugin(files, { version: VERSION });
const mentions = (errors, pattern) => errors.some((error) => pattern.test(error));

test('conformant Public Plugin passes with catalog counts', () => {
  assert.deepStrictEqual(run1(tree()), []);
});

test('Public Plugin carrying distribution.yaml fails', () => {
  const errors = run1(tree({ 'skills/a/distribution.yaml': Buffer.from('{}') }));
  assert.ok(mentions(errors, /distribution\.yaml/), errors.join('; '));
});

test('Public Plugin skill with dhpk metadata fails', () => {
  const skill = Buffer.from('---\nname: a\nmetadata:\n  dhpk-capability-id: "x"\n---\n');
  const errors = run1(tree({ 'skills/a/SKILL.md': skill }));
  assert.ok(mentions(errors, /dhpk-capability-id/), errors.join('; '));
});

test('Public Plugin with a nested reference SKILL.md fails', () => {
  const errors = run1(tree({ 'skills/a/references/c/SKILL.md': Buffer.from('---\nname: c\n---\n') }));
  assert.ok(mentions(errors, /skills\/a\/references\/c\/SKILL\.md/), errors.join('; '));
});

test('Public Plugin icon outside ./assets/ fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ logo: './skills/a/assets/icon.svg' })) }));
  assert.ok(mentions(errors, /logo/), errors.join('; '));
});

test('Public Plugin icon missing from the tree fails', () => {
  const files = tree();
  files.delete('assets/icon.svg');
  assert.ok(mentions(run1(files), /composerIcon/));
});

test('Public Plugin shortDescription over 30 characters fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ shortDescription: 'x'.repeat(31) })) }));
  assert.ok(mentions(errors, /shortDescription/), errors.join('; '));
});

test('Public Plugin truncated shortDescription fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ shortDescription: 'Skills for software...' })) }));
  assert.ok(mentions(errors, /shortDescription/), errors.join('; '));
});

test('Public Plugin longDescription counts that disagree with the content fail', () => {
  const stale = 'A plugin with 15 general workflows and 45 bundled specialist reference resources.';
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ longDescription: stale })) }));
  assert.ok(mentions(errors, /15 workflows/) && mentions(errors, /45 reference/), errors.join('; '));
});

test('Public Plugin longDescription without counts fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ longDescription: 'No numbers here.' })) }));
  assert.ok(mentions(errors, /longDescription/), errors.join('; '));
});

test('Public Plugin longDescription with an unresolved count token fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ longDescription: '{workflowCount} general workflows and {referenceCount} bundled specialist reference resources.' })) }));
  assert.ok(mentions(errors, /longDescription/), errors.join('; '));
});

run('publication-conformance');
