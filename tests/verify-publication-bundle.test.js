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
const RELEASE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'release.yml');
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

function extractPublicationVerifierGuard(workflowText) {
  const stepHeader = '      - name: Validate trusted publication bundle';
  const stepStart = workflowText.indexOf(stepHeader);
  assert.notStrictEqual(stepStart, -1, 'release workflow is missing the trusted publication validation step');
  assert.strictEqual(
    workflowText.indexOf(stepHeader, stepStart + stepHeader.length),
    -1,
    'release workflow has duplicate trusted publication validation steps',
  );

  const nextStepStart = workflowText.indexOf('\n      - name: ', stepStart + stepHeader.length);
  const stepText = workflowText.slice(stepStart, nextStepStart === -1 ? workflowText.length : nextStepStart);
  assert.match(
    stepText,
    /^\s+VERIFIER_SHA256:\s*\$\{\{\s*needs\.release\.outputs\.release_verifier_sha256\s*\}\}\s*$/m,
    'release workflow no longer binds the verifier digest to the release producer output',
  );

  const runMarker = '        run: |';
  const runStart = stepText.indexOf(runMarker);
  assert.notStrictEqual(runStart, -1, 'trusted publication validation step is missing its Bash run block');
  assert.strictEqual(stepText.indexOf(runMarker, runStart + runMarker.length), -1, 'trusted publication step has multiple run blocks');

  const runLines = stepText.slice(runStart + runMarker.length).replace(/^\r?\n/, '').split(/\r?\n/);
  const shellLines = [];
  for (const line of runLines) {
    if (line.startsWith('          ')) {
      shellLines.push(line.slice(10));
    } else if (line.trim() === '') {
      if (shellLines.length > 0) shellLines.push('');
    } else {
      break;
    }
  }
  const shell = shellLines.join('\n').trimEnd();
  assert.ok(shell.length > 0, 'trusted publication validation step has an empty Bash run block');

  const digestAssignment = shell.indexOf('actual_verifier_sha256=');
  const sha256sum = shell.indexOf('sha256sum "$verifier"');
  const comparison = shell.indexOf('if [ "$actual_verifier_sha256" != "$VERIFIER_SHA256" ]; then');
  const diagnostic = shell.indexOf('publication consumer: downloaded verifier digest does not match the producer binding');
  const failureExit = diagnostic === -1 ? -1 : shell.indexOf('exit 1', diagnostic);
  const comparisonEnd = failureExit === -1 ? -1 : shell.indexOf('\nfi', failureExit);
  const verifierExecution = shell.indexOf('node "$verifier"');

  assert.ok(digestAssignment !== -1 && sha256sum > digestAssignment, 'trusted publication step no longer computes the downloaded verifier digest');
  assert.ok(comparison > sha256sum, 'trusted publication step no longer compares the downloaded digest with the producer binding');
  assert.ok(diagnostic > comparison && failureExit > diagnostic, 'trusted publication digest mismatch no longer fails with the producer-binding diagnostic');
  assert.ok(comparisonEnd > failureExit && verifierExecution > comparisonEnd, 'trusted publication verifier execution must follow the digest mismatch guard');
  return shell;
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

test('publish consumer rejects a changed downloaded verifier before executing it', () => {
  const workflowPath = process.env.DHPK_VERIFY_PUBLICATION_WORKFLOW_PATH || RELEASE_WORKFLOW;
  const workflowText = fs.readFileSync(workflowPath, 'utf8');
  const shellGuard = extractPublicationVerifierGuard(workflowText);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publication-verifier-'));
  try {
    const verifierDir = path.join(temp, 'dhpk-release-publication-bundle-verifier');
    const bundleDir = path.join(temp, 'dhpk-release-publication-bundle');
    const digestDir = path.join(temp, 'dhpk-release-publication-notes-digest');
    fs.mkdirSync(verifierDir);
    fs.mkdirSync(bundleDir);
    fs.mkdirSync(digestDir);

    const copiedVerifier = path.join(temp, 'verify-publication-bundle.js');
    fs.copyFileSync(VERIFIER, copiedVerifier);
    const expectedVerifierSha256 = digestFile(copiedVerifier);
    fs.copyFileSync(copiedVerifier, path.join(verifierDir, 'verify-publication-bundle.js'));
    fs.writeFileSync(path.join(bundleDir, 'dhpk-release-publication-bundle.json'), '{}\n');
    fs.writeFileSync(path.join(digestDir, 'dhpk-release-publication-notes-digest.json'), '{}\n');

    const mockBin = path.join(temp, 'mock-bin');
    fs.mkdirSync(mockBin);
    const nodeTrace = path.join(temp, 'node-invocations.log');
    const mockNode = path.join(mockBin, 'node');
    fs.writeFileSync(mockNode, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_NODE_TRACE"\n', { mode: 0o755 });
    fs.chmodSync(mockNode, 0o755);
    const mockSha256sum = path.join(mockBin, 'sha256sum');
    fs.writeFileSync(mockSha256sum, '#!/bin/sh\nexec shasum -a 256 "$@"\n', { mode: 0o755 });
    fs.chmodSync(mockSha256sum, 0o755);

    const runGuard = () => spawnSync('bash', [
      '--noprofile',
      '--norc',
      '-e',
      '-o', 'pipefail',
      '-c', shellGuard,
    ], {
      cwd: temp,
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: temp,
        VERIFIER_SHA256: expectedVerifierSha256,
        EXPECTED_NOTES_SHA256: digestBytes(notes()),
        TARGET_COMMIT: IDENTITY.targetCommit,
        TARGET_TREE: IDENTITY.targetTree,
        GITHUB_RUN_ID: IDENTITY.runId,
        GITHUB_REF_NAME: IDENTITY.tag,
        MOCK_NODE_TRACE: nodeTrace,
        PATH: `${mockBin}${path.delimiter}${process.env.PATH || ''}`,
      },
    });

    const originalResult = runGuard();
    assert.strictEqual(originalResult.status, 0, `${originalResult.stdout}${originalResult.stderr}`);
    assert.match(fs.readFileSync(nodeTrace, 'utf8'), /verify-publication-bundle\.js/);

    fs.rmSync(nodeTrace, { force: true });
    fs.appendFileSync(path.join(verifierDir, 'verify-publication-bundle.js'), '\n// tampered downloaded verifier\n');
    const tamperedResult = runGuard();
    assert.notStrictEqual(tamperedResult.status, 0);
    assert.match(tamperedResult.stderr, /downloaded verifier digest does not match the producer binding/);
    assert.strictEqual(fs.existsSync(nodeTrace), false, 'the downloaded verifier ran before its producer binding was checked');
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
