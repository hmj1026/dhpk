'use strict';

// Regression guard for two historical Release-workflow failures:
//   - v0.10.0: `gh release create` on a tag whose release already existed
//     failed with HTTP 422 "Release.tag_name already exists". Fixed with an
//     upsert (view -> edit else create) pattern.
//   - v0.2.3: CHANGELOG notes interpolated inline into the shell command let
//     backticks/$(...) in the notes get expanded by the runner shell,
//     causing a syntax error. Fixed by piping notes via stdin (--notes-file -).
// This test asserts both fixes stay in place, not that the workflow runs.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

test('release step upserts instead of unconditionally creating', () => {
  const viewIdx = raw.indexOf('gh release view');
  const createIdx = raw.indexOf('gh release create');
  assert.ok(viewIdx !== -1, 'missing "gh release view" existence check');
  assert.ok(raw.includes('gh release edit'), 'missing "gh release edit" fallback');
  assert.ok(createIdx !== -1, 'missing "gh release create"');
  assert.ok(viewIdx < createIdx, '"gh release view" must be checked before "gh release create"');
});

test('release notes are streamed via stdin, not interpolated inline', () => {
  assert.ok(raw.includes('--notes-file -'), 'missing "--notes-file -" (stdin) usage');
  assert.ok(
    !/--notes\s+"\$\{?NOTES/.test(raw),
    'notes must not be passed inline via --notes "$NOTES" (backticks/$(...) would be shell-expanded)'
  );
});

run('release-workflow');
