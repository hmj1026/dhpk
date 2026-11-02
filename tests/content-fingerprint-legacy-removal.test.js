'use strict';

// OpenSpec remove-legacy-tree-fingerprints task 2.1 (REQ-1, REQ-5). RED until
// the wave that deletes the legacy recipes and tightens the algorithm gates
// lands: the removed names are not exported, and a persisted record without the
// `tree-merkle-v1` marker fails closed with the version-boundary diagnostic.
//
// Field names asserted in the diagnostics: normalizeFingerprintAlgorithm takes
// a caller `algorithm` option, so its field is 'algorithm';
// resolveFingerprintAlgorithm defaults to 'fingerprintAlgorithm' or uses the
// field argument it is given.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fingerprint = require('../scripts/lib/content-fingerprint');

const REMOVED_NAMES = [
  'fileSetFingerprintCodeUnit',
  'fileSetFingerprintLocale',
  'fileSetFingerprintTerminated',
  'merkleFingerprint',
  'buildMerkleTree',
  'fileSetDigest',
  'LEGACY_FINGERPRINT_ALGORITHM',
];

for (const name of REMOVED_NAMES) {
  test(`${name} is not exported`, () => {
    assert.ok(!Object.hasOwn(fingerprint, name), `${name} must be removed from the module exports`);
  });
}

// buildMerkleTree and fileSetDigest are module-internal today, so the export
// check alone cannot fail for them; scan the source for any definition.
test('the module source defines none of the removed recipes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'content-fingerprint.js'), 'utf8');
  for (const name of REMOVED_NAMES) {
    assert.ok(!new RegExp(`(function\\s+|const\\s+)${name}\\b`).test(source), `${name} must not be defined`);
  }
});

test('the remaining tree exports are untouched', () => {
  assert.strictEqual(typeof fingerprint.treeFingerprint, 'function');
  assert.strictEqual(typeof fingerprint.treeNodeFingerprint, 'function');
  assert.strictEqual(fingerprint.TREE_FINGERPRINT_ALGORITHM, 'tree-merkle-v1');
});

test('normalizeFingerprintAlgorithm accepts exactly tree-merkle-v1', () => {
  assert.strictEqual(fingerprint.normalizeFingerprintAlgorithm('tree-merkle-v1'), 'tree-merkle-v1');
});

for (const bad of [undefined, 'legacy', null, '', 'tree-merkle-v2', 0]) {
  test(`normalizeFingerprintAlgorithm(${JSON.stringify(bad) ?? 'undefined'}) throws the version-boundary diagnostic`, () => {
    assert.throws(
      () => fingerprint.normalizeFingerprintAlgorithm(bad),
      (error) => error instanceof Error && error.message === fingerprint.versionBoundaryMessage('algorithm', bad),
    );
  });
}

test('resolveFingerprintAlgorithm throws the diagnostic naming the field when the record has no marker', () => {
  for (const record of [{}, null, undefined]) {
    assert.throws(
      () => fingerprint.resolveFingerprintAlgorithm(record),
      (error) => error instanceof Error && error.message === fingerprint.versionBoundaryMessage('fingerprintAlgorithm', undefined),
      JSON.stringify(record) ?? 'undefined',
    );
  }
  assert.throws(
    () => fingerprint.resolveFingerprintAlgorithm({}, 'fingerprint_algorithm'),
    (error) => error.message === fingerprint.versionBoundaryMessage('fingerprint_algorithm', undefined),
  );
});

test('resolveFingerprintAlgorithm throws the diagnostic with the observed value for an unknown marker', () => {
  for (const bad of ['legacy', 'tree-merkle-v2', null, '', 0, false]) {
    assert.throws(
      () => fingerprint.resolveFingerprintAlgorithm({ fingerprintAlgorithm: bad }),
      (error) => error instanceof Error && error.message === fingerprint.versionBoundaryMessage('fingerprintAlgorithm', bad),
      String(bad),
    );
  }
  assert.strictEqual(fingerprint.resolveFingerprintAlgorithm({ fingerprintAlgorithm: 'tree-merkle-v1' }), 'tree-merkle-v1');
});

run('content-fingerprint-legacy-removal');
