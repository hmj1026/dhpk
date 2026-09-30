'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SCHEMA,
  PRODUCER,
  buildTrustedPublicationBundle,
  buildTrustedPublicationNotesDigest,
  digestBytes,
  digestJson,
  validateTrustedPublicationBundle,
} = require('../scripts/lib/release-publication-bundle');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'release-publication-bundle.js');
const IDENTITY = Object.freeze({
  runId: '550-run-123',
  tag: 'v0.62.0',
  version: '0.62.0',
  targetCommit: 'a'.repeat(40),
  targetTree: 'b'.repeat(40),
});

function validNotes() {
  return Buffer.from('**feat(release)** — Preserve `$(literal)` and Unicode 測試.\n', 'utf8');
}

function validBundle(overrides = {}) {
  return buildTrustedPublicationBundle({
    ...IDENTITY,
    notesBytes: validNotes(),
    expectedNotesSha256: digestBytes(validNotes()),
    ...overrides,
  });
}

function validate(bundle, overrides = {}) {
  return validateTrustedPublicationBundle(bundle, {
    expectedRunId: IDENTITY.runId,
    expectedTag: IDENTITY.tag,
    expectedVersion: IDENTITY.version,
    expectedTargetCommit: IDENTITY.targetCommit,
    expectedTargetTree: IDENTITY.targetTree,
    expectedNotesSha256: digestBytes(validNotes()),
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [`expected${key[0].toUpperCase()}${key.slice(1)}`, value])),
  });
}

function refingerprint(bundle) {
  const { bundleFingerprint: _ignored, ...withoutFingerprint } = bundle;
  bundle.bundleFingerprint = digestJson(withoutFingerprint);
  return bundle;
}

test('trusted publication bundle preserves exact release-note bytes and validates without a checkout', () => {
  const notesBytes = validNotes();
  const bundle = validBundle({ notesBytes });

  assert.strictEqual(bundle.schema, SCHEMA);
  assert.deepStrictEqual(bundle.producer, { id: PRODUCER, trust: 'same-release-workflow' });
  assert.strictEqual(bundle.publication.tag, IDENTITY.tag);
  assert.strictEqual(bundle.publication.version, IDENTITY.version);
  assert.strictEqual(bundle.publication.title, IDENTITY.tag);
  assert.strictEqual(bundle.publication.notes.encoding, 'base64');
  assert.deepStrictEqual(Buffer.from(bundle.publication.notes.data, 'base64'), notesBytes);
  assert.ok(bundle.publication.notes.sha256.startsWith('sha256:'));
  assert.ok(bundle.bundleFingerprint.startsWith('sha256:'));

  const checked = validate(bundle);
  assert.strictEqual(checked.ok, true, checked.errors.join('; '));
});

test('trusted publication bundle rejects missing, malformed, stale, and foreign identity', () => {
  const cases = [
    ['missing run id', (bundle) => { delete bundle.runId; }],
    ['wrong producer', (bundle) => { bundle.producer.id = 'generic-cache'; }],
    ['wrong tag', (bundle) => { bundle.publication.tag = 'v9.9.9'; }],
    ['wrong version', (bundle) => { bundle.publication.version = '9.9.9'; }],
    ['wrong commit', (bundle) => { bundle.publication.target.commit = 'c'.repeat(40); }],
    ['wrong tree', (bundle) => { bundle.publication.target.tree = 'd'.repeat(40); }],
    ['wrong workflow run', null],
  ];

  for (const [label, mutate] of cases) {
    const bundle = validBundle();
    if (mutate) mutate(bundle);
    const checked = validate(bundle, label === 'wrong workflow run' ? { runId: 'foreign-run' } : {});
    assert.strictEqual(checked.ok, false, `${label} unexpectedly validated`);
    assert.ok(checked.errors.length > 0, `${label} should explain rejection`);
  }
});

test('trusted publication bundle rejects tampered notes, metadata, and fingerprint', () => {
  const mutations = [
    (bundle) => { bundle.publication.notes.data = Buffer.from('tampered', 'utf8').toString('base64'); },
    (bundle) => { bundle.publication.notes.sha256 = 'sha256:' + '0'.repeat(64); },
    (bundle) => { bundle.publication.title = 'wrong-title'; },
    (bundle) => { bundle.bundleFingerprint = 'sha256:' + '0'.repeat(64); },
  ];

  for (const mutate of mutations) {
    const bundle = validBundle();
    mutate(bundle);
    const checked = validate(bundle);
    assert.strictEqual(checked.ok, false, 'tampered bundle unexpectedly validated');
    assert.ok(checked.errors.some((error) => /integrity|fingerprint|notes|metadata|title/i.test(error)), checked.errors.join('; '));
  }
});

test('trusted publication bundle rejects malformed scalar types and unknown fields', () => {
  const numericRunId = refingerprint({ ...validBundle(), runId: 550 });
  const numericRunIdResult = validate(numericRunId, { runId: 550 });
  assert.strictEqual(numericRunIdResult.ok, false);
  assert.ok(numericRunIdResult.errors.some((error) => /run id|runId|malformed/i.test(error)), numericRunIdResult.errors.join('; '));

  const extraField = refingerprint({ ...validBundle(), unexpected: true });
  const extraFieldResult = validate(extraField);
  assert.strictEqual(extraFieldResult.ok, false);
  assert.ok(extraFieldResult.errors.some((error) => /unknown|unexpected|field|shape/i.test(error)), extraFieldResult.errors.join('; '));
});

test('trusted publication bundle rejects a writer that changes notes and recomputes its internal fingerprints', () => {
  const changedNotes = Buffer.from('rewritten release notes\n', 'utf8');
  const rewritten = validBundle({
    notesBytes: changedNotes,
    expectedNotesSha256: digestBytes(changedNotes),
  });
  const checked = validate(rewritten);
  assert.strictEqual(checked.ok, false);
  assert.ok(checked.errors.some((error) => /external|expected|integrity|notes/i.test(error)), checked.errors.join('; '));
});

test('builder and validator fail closed for empty notes and incomplete expected identity', () => {
  assert.throws(
    () => validBundle({ notesBytes: Buffer.from(' \n', 'utf8') }),
    /release notes.*empty|empty.*release notes/i,
  );

  const checked = validate(validBundle(), { targetTree: null });
  assert.strictEqual(checked.ok, false);
  assert.ok(checked.errors.some((error) => /expected.*tree|identity/i.test(error)), checked.errors.join('; '));
});

test('publication bundle CLI writes and validates a portable bundle', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publication-bundle-'));
  try {
    const notesPath = path.join(temp, 'notes.md');
    const outputPath = path.join(temp, 'bundle.json');
    const digestPath = path.join(temp, 'notes-digest.json');
    const validatedNotesPath = path.join(temp, 'validated-notes.md');
    fs.writeFileSync(notesPath, validNotes());
    const build = spawnSync(process.execPath, [
      CLI,
      '--output', outputPath,
      '--notes-file', notesPath,
      '--run-id', IDENTITY.runId,
      '--tag', IDENTITY.tag,
      '--version', IDENTITY.version,
      '--target-commit', IDENTITY.targetCommit,
      '--target-tree', IDENTITY.targetTree,
      '--expected-notes-sha256', digestBytes(validNotes()),
      '--digest-output', digestPath,
    ], { cwd: temp, encoding: 'utf8' });
    assert.strictEqual(build.status, 0, build.stderr);
    assert.ok(fs.existsSync(outputPath));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(digestPath, 'utf8')), buildTrustedPublicationNotesDigest({
      runId: IDENTITY.runId,
      notesSha256: digestBytes(validNotes()),
    }));

    const verify = spawnSync(process.execPath, [
      CLI,
      '--bundle', outputPath,
      '--expected-run-id', IDENTITY.runId,
      '--expected-tag', IDENTITY.tag,
      '--expected-version', IDENTITY.version,
      '--expected-target-commit', IDENTITY.targetCommit,
      '--expected-target-tree', IDENTITY.targetTree,
      '--expected-notes-digest-file', digestPath,
      '--notes-output', validatedNotesPath,
    ], { cwd: temp, encoding: 'utf8' });
    assert.strictEqual(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /"ok": true/);
    assert.deepStrictEqual(fs.readFileSync(validatedNotesPath), validNotes());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


  // Merged from tests/verify-publication-bundle.test.js.
  {

    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const os = require('node:os');
    const path = require('node:path');
    const { spawnSync } = require('node:child_process');
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
        const independentlyDigestBytes = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
        const expectedProducerDigest = independentlyDigestBytes(notes());
        const changedNotes = Buffer.from('attacker-controlled notes\n', 'utf8');
        const changedNotesDigest = independentlyDigestBytes(changedNotes);
        const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
        bundle.publication.notes.data = changedNotes.toString('base64');
        bundle.publication.notes.byteLength = changedNotes.length;
        bundle.publication.notes.sha256 = changedNotesDigest;
        const { bundleFingerprint: _bundleFingerprint, ...withoutBundleFingerprint } = bundle;
        bundle.bundleFingerprint = digestJson(withoutBundleFingerprint);
        fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

        const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
        digest.notesSha256 = changedNotesDigest;
        const { digestFingerprint: _digestFingerprint, ...withoutDigestFingerprint } = digest;
        digest.digestFingerprint = digestJson(withoutDigestFingerprint);
        fs.writeFileSync(digestPath, `${JSON.stringify(digest, null, 2)}\n`);
        fs.copyFileSync(VERIFIER, path.join(temp, 'verify-publication-bundle.js'));

        const result = invoke(temp, ['--expected-notes-sha256', expectedProducerDigest]);
        const output = `${result.stdout}${result.stderr}`;
        assert.notStrictEqual(result.status, 0, output);
        assert.match(output, /producer and downloaded publication notes digests do not match/);
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });
  }

run('release-publication-bundle');
