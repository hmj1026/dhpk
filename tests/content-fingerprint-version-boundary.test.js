'use strict';

// OpenSpec remove-legacy-tree-fingerprints design D1: every fail-closed
// diagnostic for a persisted record without a recognized algorithm marker comes
// from one message builder. The expected text is written out literally so the
// installer's Python copy can be compared against the same string.

const { test, run, assert } = require('./_lib/tinytest');
const fingerprint = require('../scripts/lib/content-fingerprint');

const TAIL = '; 0.70.0 accepts only records written by 0.69.x or later; to continue, either upgrade through 0.69.x and run one install or update, or uninstall and reinstall';
const head = (field, observed) => `fingerprint algorithm field '${field}' must be "tree-merkle-v1" but the observed value is ${observed}`;

test('the builder names the field and reports an undefined value as absent', () => {
  assert.strictEqual(
    fingerprint.versionBoundaryMessage('fingerprintAlgorithm', undefined),
    `${head('fingerprintAlgorithm', 'absent')}${TAIL}`,
  );
});

test('the builder states the version boundary and both remediation paths', () => {
  const message = fingerprint.versionBoundaryMessage('fingerprint_algorithm', undefined);
  assert.ok(message.includes('0.70.0 accepts only records written by 0.69.x or later'));
  assert.ok(message.includes('upgrade through 0.69.x and run one install or update'));
  assert.ok(message.includes('uninstall and reinstall'));
});

test('the builder renders an observed value as compact JSON: strings quoted, null as null, numbers and booleans bare', () => {
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', 'tree-merkle-v9'), `${head('f', '"tree-merkle-v9"')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', 'legacy'), `${head('f', '"legacy"')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', null), `${head('f', 'null')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', ''), `${head('f', '""')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', 0), `${head('f', '0')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', false), `${head('f', 'false')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', { a: 1, b: [2] }), `${head('f', '{"a":1,"b":[2]}')}${TAIL}`);
});

test('the builder escapes non-ASCII and control characters so the message stays one ASCII line (matches Python json.dumps)', () => {
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', 'café'), `${head('f', '"caf\\u00e9"')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', '😀'), `${head('f', '"\\ud83d\\ude00"')}${TAIL}`);
  assert.strictEqual(fingerprint.versionBoundaryMessage('f', 'a\nb\u007f'), `${head('f', '"a\\nb\\u007f"')}${TAIL}`);
  const message = fingerprint.versionBoundaryMessage('f', 'x y\ud800');
  assert.match(message, /^[\x20-\x7e]+$/);
});

test('requireTreeMerkle returns the marker for the exact string tree-merkle-v1', () => {
  assert.strictEqual(fingerprint.requireTreeMerkle('tree-merkle-v1', 'fingerprintAlgorithm'), 'tree-merkle-v1');
});

test('requireTreeMerkle throws the builder message for absent, null, empty, legacy, unknown, and non-string values', () => {
  for (const bad of [undefined, null, '', 'legacy', 'tree-merkle-v2', 'TREE-MERKLE-V1', ' tree-merkle-v1', 0, false, {}, ['tree-merkle-v1']]) {
    assert.throws(
      () => fingerprint.requireTreeMerkle(bad, 'fingerprint_algorithm'),
      (error) => error instanceof Error && error.message === fingerprint.versionBoundaryMessage('fingerprint_algorithm', bad),
      String(bad),
    );
  }
});

run('content-fingerprint-version-boundary');
