'use strict';

// scripts/lib/content-fingerprint.js holds the version-boundary diagnostic
// once; the Codex/Cursor installer and the Publisher report it through that
// function (OpenSpec remove-legacy-tree-fingerprints, D1). The installer's
// embedded Python, which held a second copy, is gone (js-projection-journal
// stage 5), so only the Node builder is pinned here. Like the Python it replaced,
// it renders JSON with every non-ASCII and control character escaped.

const { test, run, assert } = require('./_lib/tinytest');
const { versionBoundaryMessage } = require('../scripts/lib/content-fingerprint');

const CASES = [
  { name: 'null', observed: null, rendered: 'null' },
  { name: 'unknown string', observed: 'tree-merkle-v9', rendered: '"tree-merkle-v9"' },
  { name: 'empty string', observed: '', rendered: '""' },
  { name: 'non-ASCII', observed: 'algorithme-été-中文', rendered: '"algorithme-\\u00e9t\\u00e9-\\u4e2d\\u6587"' },
  { name: 'astral character', observed: 'v\u{1F600}', rendered: '"v\\ud83d\\ude00"' },
  { name: 'quote and backslash', observed: 'a"b\\c', rendered: '"a\\"b\\\\c"' },
  { name: 'control characters', observed: 'a\tb\u007f', rendered: '"a\\tb\\u007f"' },
  { name: 'number', observed: 2, rendered: '2' },
  { name: 'object', observed: { a: [1, 'b'] }, rendered: '{"a":[1,"b"]}' },
];

for (const entry of CASES) {
  test(`the message renders a ${entry.name} observed value as JSON`, () => {
    const message = versionBoundaryMessage('fingerprint_algorithm', entry.observed);
    assert.ok(message.includes(`the observed value is ${entry.rendered};`), message);
  });
}

test('the message pins the field, the observed value, the version boundary and both remediation paths', () => {
  const absent = versionBoundaryMessage('fingerprint_algorithm', undefined);
  const unknown = versionBoundaryMessage('fingerprint_algorithm', 'x');
  assert.strictEqual(
    absent,
    'fingerprint algorithm field \'fingerprint_algorithm\' must be "tree-merkle-v1" but the observed value is absent; '
    + '0.70.0 accepts only records written by 0.69.x or later; '
    + 'to continue, either upgrade through 0.69.x and run one install or update, or uninstall and reinstall',
  );
  assert.ok(unknown.includes('the observed value is "x";'));
});

run('install-codex-version-boundary');
