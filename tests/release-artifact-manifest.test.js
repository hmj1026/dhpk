'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  PACKAGE_SURFACES,
  buildReleaseArtifactManifest,
  validateReleaseArtifactManifest,
} = require('../scripts/lib/release-artifact-manifest');

const ROOT = path.join(__dirname, '..');

function currentIdentity() {
  const { execFileSync } = require('node:child_process');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return { commit, tree };
}

test('release artifact manifest binds all four package surfaces and validates cleanly', () => {
  const identity = currentIdentity();
  const manifest = buildReleaseArtifactManifest({ root: ROOT, targetCommit: identity.commit, targetTree: identity.tree, runId: 'test-run', version: '0.57.1' });
  assert.deepStrictEqual(manifest.packageSurfaces, PACKAGE_SURFACES);
  assert.strictEqual(manifest.packages.length, 4);
  assert.ok(manifest.packages.every((entry) => entry.bindingFingerprint.startsWith('sha256:')));
  const checked = validateReleaseArtifactManifest(manifest, {
    root: ROOT,
    targetCommit: identity.commit,
    targetTree: identity.tree,
    expectedRunId: 'test-run',
    expectedVersion: '0.57.1',
  });
  assert.strictEqual(checked.ok, true, checked.errors.join('; '));
});

test('release artifact manifest fails closed for stale target, producer, bytes, and modes', () => {
  const identity = currentIdentity();
  const manifest = buildReleaseArtifactManifest({ root: ROOT, targetCommit: identity.commit, targetTree: identity.tree, runId: 'test-run', version: '0.57.1' });
  const stale = structuredClone(manifest);
  stale.target.commit = '0'.repeat(40);
  stale.producer = { id: 'untrusted-cache', trust: 'same-release-workflow' };
  stale.packages[0].fingerprints.modeFingerprint = 'sha256:' + '1'.repeat(64);
  const checked = validateReleaseArtifactManifest(stale, {
    root: ROOT,
    targetCommit: identity.commit,
    targetTree: identity.tree,
    expectedRunId: 'test-run',
    expectedVersion: '0.57.1',
  });
  assert.strictEqual(checked.ok, false);
  assert.ok(checked.errors.some((error) => /stale|foreign|trusted|identity|modes/i.test(error)));
});

run('release-artifact-manifest');
