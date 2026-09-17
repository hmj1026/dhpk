'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  buildTrustedPublicationBundle,
  buildTrustedPublicationNotesDigest,
  digestBytes,
  digestJson,
} = require('../scripts/lib/release-publication-bundle');

const ROOT = path.join(__dirname, '..');
const VERIFIER = path.join(ROOT, 'scripts', 'release', 'verify-publication-bundle.js');
const IDENTITY = Object.freeze({
  runId: '550-run-123',
  tag: 'v0.62.0',
  version: '0.62.0',
  targetCommit: 'a'.repeat(40),
  targetTree: 'b'.repeat(40),
});

function notes() {
  return Buffer.from('**feat(release)** — Preserve `$(literal)` and Unicode 測試.\n', 'utf8');
}

function writeDownloadedInputs(temp) {
  const notesBytes = notes();
  const notesSha256 = digestBytes(notesBytes);
  const bundle = buildTrustedPublicationBundle({
    ...IDENTITY,
    notesBytes,
    expectedNotesSha256: notesSha256,
  });
  fs.writeFileSync(path.join(temp, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  fs.writeFileSync(path.join(temp, 'notes-digest.json'), `${JSON.stringify(buildTrustedPublicationNotesDigest({
    runId: IDENTITY.runId,
    notesSha256,
  }), null, 2)}\n`);
}

function invoke(temp, extraArgs = []) {
  return spawnSync(process.execPath, [
    path.join(temp, 'verify-publication-bundle.js'),
    '--bundle', path.join(temp, 'bundle.json'),
    '--expected-run-id', IDENTITY.runId,
    '--expected-tag', IDENTITY.tag,
    '--expected-version', IDENTITY.version,
    '--expected-target-commit', IDENTITY.targetCommit,
    '--expected-target-tree', IDENTITY.targetTree,
    '--expected-notes-digest-file', path.join(temp, 'notes-digest.json'),
    ...extraArgs,
  ], { cwd: temp, encoding: 'utf8' });
}

function digestFile(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

test('standalone verifier consumes only downloaded bundle, digest, and verifier inputs', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publication-verifier-'));
  try {
    writeDownloadedInputs(temp);
    fs.copyFileSync(VERIFIER, path.join(temp, 'verify-publication-bundle.js'));
    const notesOutput = path.join(temp, 'validated-notes.md');
    const result = invoke(temp, ['--notes-output', notesOutput]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(fs.readFileSync(notesOutput), notes());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('standalone verifier rejects a stale or foreign downloaded digest anchor', () => {
  for (const mutate of [
    (digest) => { digest.notesSha256 = digestBytes(Buffer.from('other notes\n', 'utf8')); },
    (digest) => { digest.runId = 'foreign-run'; },
  ]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publication-verifier-'));
    try {
      writeDownloadedInputs(temp);
      const digestPath = path.join(temp, 'notes-digest.json');
      const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
      mutate(digest);
      fs.writeFileSync(digestPath, `${JSON.stringify(digest, null, 2)}\n`);
      fs.copyFileSync(VERIFIER, path.join(temp, 'verify-publication-bundle.js'));
      const result = invoke(temp);
      assert.notStrictEqual(result.status, 0);
      assert.match(`${result.stdout}${result.stderr}`, /digest|foreign|stale|fingerprint|notes/i);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
});

test('a changed downloaded verifier no longer matches the producer binding', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publication-verifier-'));
  try {
    const copiedVerifier = path.join(temp, 'verify-publication-bundle.js');
    fs.copyFileSync(VERIFIER, copiedVerifier);
    const expectedVerifierSha256 = digestFile(copiedVerifier);
    fs.appendFileSync(copiedVerifier, '\n// tampered verifier\n');
    assert.notStrictEqual(digestFile(copiedVerifier), expectedVerifierSha256);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('producer digest rejects coordinated bundle and digest replacement', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publication-verifier-'));
  try {
    writeDownloadedInputs(temp);
    const bundlePath = path.join(temp, 'bundle.json');
    const digestPath = path.join(temp, 'notes-digest.json');
    const changedNotes = Buffer.from('attacker-controlled notes\n', 'utf8');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    bundle.publication.notes.data = changedNotes.toString('base64');
    bundle.publication.notes.byteLength = changedNotes.length;
    bundle.publication.notes.sha256 = digestBytes(changedNotes);
    const { bundleFingerprint: _bundleFingerprint, ...withoutBundleFingerprint } = bundle;
    bundle.bundleFingerprint = digestJson(withoutBundleFingerprint);
    fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

    const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
    digest.notesSha256 = digestBytes(changedNotes);
    const { digestFingerprint: _digestFingerprint, ...withoutDigestFingerprint } = digest;
    digest.digestFingerprint = digestJson(withoutDigestFingerprint);
    fs.writeFileSync(digestPath, `${JSON.stringify(digest, null, 2)}\n`);
    fs.copyFileSync(VERIFIER, path.join(temp, 'verify-publication-bundle.js'));

    const result = invoke(temp, ['--expected-notes-sha256', digestBytes(notes())]);
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /producer.*downloaded|digest|notes/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('verify-publication-bundle');
