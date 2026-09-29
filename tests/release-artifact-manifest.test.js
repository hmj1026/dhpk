'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  PACKAGE_SURFACES,
  buildReleaseArtifactManifest,
  validateReleaseArtifactManifest,
  packageFingerprints,
} = require('../scripts/lib/release-artifact-manifest');

const ROOT = path.join(__dirname, '..');

function currentIdentity() {
  const { execFileSync } = require('node:child_process');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return { commit, tree };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function resealManifest(manifest) {
  const body = { ...manifest };
  delete body.manifestFingerprint;
  manifest.manifestFingerprint = `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex')}`;
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

test('release artifact manifest identifies stale targets, untrusted producers, and altered mode fingerprints', () => {
  const identity = currentIdentity();
  const manifest = buildReleaseArtifactManifest({ root: ROOT, targetCommit: identity.commit, targetTree: identity.tree, runId: 'test-run', version: '0.57.1' });
  const validation = {
    root: ROOT,
    targetCommit: identity.commit,
    targetTree: identity.tree,
    expectedRunId: 'test-run',
    expectedVersion: '0.57.1',
  };

  const staleTarget = structuredClone(manifest);
  staleTarget.target.commit = '0'.repeat(40);
  resealManifest(staleTarget);
  const staleTargetResult = validateReleaseArtifactManifest(staleTarget, validation);
  assert.strictEqual(staleTargetResult.ok, false);
  assert.ok(staleTargetResult.errors.includes('manifest target commit/tree is stale or foreign to this checkout'));

  const untrustedProducer = structuredClone(manifest);
  untrustedProducer.producer.id = 'untrusted-cache';
  resealManifest(untrustedProducer);
  const producerResult = validateReleaseArtifactManifest(untrustedProducer, validation);
  assert.strictEqual(producerResult.ok, false);
  assert.ok(producerResult.errors.includes('manifest producer is not the trusted release package gate'));

  const alteredModeFingerprint = structuredClone(manifest);
  alteredModeFingerprint.packages[0].fingerprints.modeFingerprint = `sha256:${'1'.repeat(64)}`;
  resealManifest(alteredModeFingerprint);
  const modeResult = validateReleaseArtifactManifest(alteredModeFingerprint, validation);
  assert.strictEqual(modeResult.ok, false);
  assert.ok(modeResult.errors.includes(`${PACKAGE_SURFACES[0]} manifest identity does not match current provenance`));
});

test('package fingerprints distinguish byte changes from mode changes in a scratch package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-package-fingerprint-'));
  const packageRoot = path.join(root, 'package');
  const packageFile = path.join(packageRoot, 'scripts', 'check.sh');
  try {
    fs.mkdirSync(path.dirname(packageFile), { recursive: true });
    fs.writeFileSync(packageFile, 'original bytes\n', { mode: 0o644 });
    const original = packageFingerprints(packageRoot);

    fs.writeFileSync(packageFile, 'changed bytes\n');
    const byteChange = packageFingerprints(packageRoot);
    assert.notStrictEqual(byteChange.contentFingerprint, original.contentFingerprint);
    assert.strictEqual(byteChange.modeFingerprint, original.modeFingerprint);

    fs.writeFileSync(packageFile, 'original bytes\n');
    fs.chmodSync(packageFile, 0o755);
    const modeChange = packageFingerprints(packageRoot);
    assert.strictEqual(modeChange.contentFingerprint, original.contentFingerprint);
    assert.notStrictEqual(modeChange.modeFingerprint, original.modeFingerprint);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('release-artifact-manifest');
