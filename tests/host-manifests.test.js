'use strict';

// Single version source: package.json plus one listing-metadata file feed every
// Host manifest, and the declared outputs are the only manifests that exist.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  LISTING_METADATA,
  declaredOutputs,
  readSourceVersion,
  renderOpenaiSubmissionManifest,
  undeclaredManifests,
} = require('../scripts/lib/host-manifests');

const ROOT = path.join(__dirname, '..');

test('the OpenAI submission manifest takes its version from package.json, not from a file copy', () => {
  const manifest = renderOpenaiSubmissionManifest(ROOT);
  assert.strictEqual(manifest.version, readSourceVersion(ROOT));
  assert.strictEqual(manifest.name, 'dhpk');
});

test('an explicit version overrides only the version field of the rendered manifest', () => {
  const base = renderOpenaiSubmissionManifest(ROOT);
  const pinned = renderOpenaiSubmissionManifest(ROOT, '9.9.9');
  assert.strictEqual(pinned.version, '9.9.9');
  assert.deepStrictEqual({ ...pinned, version: base.version }, base);
});

test('the OpenAI listing interface exists in one source file only', () => {
  const listing = JSON.parse(fs.readFileSync(path.join(ROOT, LISTING_METADATA), 'utf8'));
  assert.ok(listing.extensions['com.openai'].interface);
  assert.strictEqual(listing.version, undefined);
  assert.strictEqual(fs.existsSync(path.join(ROOT, 'manifests/openai-submission.json')), false);
});

test('the OpenAI submission manifest carries no Claude package listing entries', () => {
  assert.strictEqual(renderOpenaiSubmissionManifest(ROOT).packages, undefined);
});

test('Claude listing text names no removed commands and places stack skills in dhpk-stacks', () => {
  const { packages } = JSON.parse(fs.readFileSync(path.join(ROOT, LISTING_METADATA), 'utf8'));
  const texts = [
    packages['claude-core'].description,
    packages['claude-stacks'].description,
    ...Object.values(packages['claude-marketplace'].plugins),
  ];
  for (const text of texts) assert.ok(!/routed command/i.test(text), text);
  assert.match(packages['claude-core'].description, /stack skills ship separately in dhpk-stacks/);
  assert.match(packages['claude-stacks'].description, /stack skills/);
});

test('every manifest file in the repository is declared by a generator', () => {
  assert.deepStrictEqual(undeclaredManifests(ROOT), []);
});

test('declared outputs name each generator and are unique', () => {
  const paths = declaredOutputs().map((o) => o.path);
  assert.strictEqual(new Set(paths).size, paths.length);
  assert.ok(declaredOutputs().every((o) => typeof o.generator === 'string' && o.generator.length > 0));
});

run('host-manifests');
