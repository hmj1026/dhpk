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

run('release-publication-bundle');
