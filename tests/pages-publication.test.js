'use strict';

// Privacy and support pages are published on GitHub Pages and every manifest
// points there (#1499). Static checks only: the live URL needs repository
// Pages settings that a test cannot change.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const { renderOpenaiSubmissionManifest } = require('../scripts/lib/host-manifests.js');

const ROOT = path.resolve(__dirname, '..');
const PAGES_BASE = 'https://hmj1026.github.io/dhpk';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('listing metadata privacy and support URLs point at GitHub Pages', () => {
  const iface = JSON.parse(read('manifests/listing-metadata.json')).extensions['com.openai'].interface;
  assert.strictEqual(iface.privacyPolicyURL, `${PAGES_BASE}/privacy.html`);
  assert.strictEqual(iface.supportURL, `${PAGES_BASE}/support.html`);
});

test('the rendered OpenAI manifest carries the same Pages URLs', () => {
  const iface = renderOpenaiSubmissionManifest(ROOT, '0.0.0').extensions['com.openai'].interface;
  assert.strictEqual(iface.privacyPolicyURL, `${PAGES_BASE}/privacy.html`);
  assert.strictEqual(iface.supportURL, `${PAGES_BASE}/support.html`);
});

test('the privacy policy is finalized and carries no DRAFT marker', () => {
  const text = read('docs/privacy.md');
  assert.doesNotMatch(text, /DRAFT/i);
  assert.doesNotMatch(text, /this draft/i);
});

test('the support page no longer calls the support URL a candidate', () => {
  assert.doesNotMatch(read('docs/support.md'), /candidate support URL/i);
});

test('the Pages workflow publishes exactly the privacy and support pages with pinned actions', () => {
  const workflow = read('.github/workflows/pages.yml');
  assert.match(workflow, /docs\/privacy\.md/);
  assert.match(workflow, /docs\/support\.md/);
  assert.match(workflow, /deploy-pages@[0-9a-f]{40}/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /uses: [^\n]*@(v\d|main|master)\b/);
});

run('pages-publication');
