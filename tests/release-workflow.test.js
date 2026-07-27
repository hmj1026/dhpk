'use strict';

// Regression guards for the Release workflow's immutable-tag contract:
//   - an existing GitHub Release is preserved on rerun instead of being edited;
//   - empty CHANGELOG notes fail before publication;
//   - notes are streamed via stdin so shell syntax in prose stays inert.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

test('release step preserves an existing release instead of editing it', () => {
  const viewIdx = raw.indexOf('gh release view');
  const createIdx = raw.indexOf('gh release create');
  assert.ok(viewIdx !== -1, 'missing "gh release view" existence check');
  assert.ok(createIdx !== -1, 'missing "gh release create"');
  assert.ok(viewIdx < createIdx, '"gh release view" must be checked before "gh release create"');
  assert.ok(!raw.includes('gh release edit'), 'immutable release reruns must not edit existing notes');
});

test('release notes are streamed via stdin, not interpolated inline', () => {
  assert.ok(raw.includes('--notes-file -'), 'missing "--notes-file -" (stdin) usage');
  assert.ok(
    !/--notes\s+"\$\{?NOTES/.test(raw),
    'notes must not be passed inline via --notes "$NOTES" (backticks/$(...) would be shell-expanded)'
  );
});

test('release workflow rejects an empty changelog section', () => {
  assert.ok(raw.includes('empty release notes'), 'missing empty-notes failure message');
  assert.ok(raw.includes('tr -d'), 'missing whitespace-only notes check');
});

test('release workflow verifies the tag commit is contained in main', () => {
  assert.ok(raw.includes('git merge-base --is-ancestor'), 'missing tag-to-main provenance check');
});

run('release-workflow');
