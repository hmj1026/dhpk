#!/usr/bin/env node
'use strict';

// Standalone publication consumer verifier. This file intentionally imports
// only Node built-ins so a later write-enabled job can download and execute
// this verifier alongside the bundle without checking out the repository.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const SCHEMA = 'dhpk.release-publication-bundle.v1';
const NOTES_DIGEST_SCHEMA = 'dhpk.release-publication-notes-digest.v1';
const PRODUCER = 'release-validation';
const TRUST = 'same-release-workflow';
const TAG = /^v\d+\.\d+\.\d+$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[a-f0-9]{40}$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function digestJson(value) {
  return digestBytes(Buffer.from(JSON.stringify(canonical(value)), 'utf8'));
}

function decodeNotes(data) {
  if (typeof data !== 'string' || !BASE64.test(data) || data.length % 4 !== 0) {
    throw new Error('release notes must be canonical base64');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) throw new Error('release notes must be canonical base64');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.trim()) throw new Error('release notes are empty');
  } catch (error) {
    if (/release notes are empty/.test(error.message)) throw error;
    throw new Error(`release notes are not valid UTF-8: ${error.message}`);
  }
  return bytes;
}

function validateTrustedPublicationNotesDigest(digest, { expectedRunId } = {}) {
  const errors = [];
  if (typeof expectedRunId !== 'string' || expectedRunId.trim() === '') {
    errors.push('expected publication workflow run id is required');
  }
  if (!isRecord(digest)) return { ok: false, errors: [...errors, 'publication notes digest must be an object'] };
  if (!hasOnlyKeys(digest, ['schema', 'producer', 'runId', 'notesSha256', 'digestFingerprint'])) {
    errors.push('publication notes digest contains unknown fields');
  }
  if (digest.schema !== NOTES_DIGEST_SCHEMA) errors.push(`publication notes digest schema must be ${NOTES_DIGEST_SCHEMA}`);
  if (!hasOnlyKeys(digest.producer, ['id', 'trust']) || digest.producer.id !== PRODUCER || digest.producer.trust !== TRUST) {
    errors.push('publication notes digest producer is not the trusted release validation gate');
  }
  if (typeof digest.runId !== 'string' || digest.runId.trim() === '') errors.push('publication notes digest run id is malformed');
  if (typeof digest.runId === 'string' && typeof expectedRunId === 'string' && digest.runId !== expectedRunId) {
    errors.push('publication notes digest belongs to a different workflow run');
  }
  if (!DIGEST.test(String(digest.notesSha256 || ''))) errors.push('publication notes digest is malformed');
  const { digestFingerprint, ...withoutFingerprint } = digest;
  if (!DIGEST.test(String(digestFingerprint || '')) || digestFingerprint !== digestJson(withoutFingerprint)) {
    errors.push('publication notes digest fingerprint is malformed or stale');
  }
  return { ok: errors.length === 0, errors, ...(errors.length === 0 ? { digest } : {}) };
}

function expectedIdentityErrors(expected) {
  const errors = [];
  for (const [key, value] of Object.entries({
    runId: expected.expectedRunId,
    tag: expected.expectedTag,
    version: expected.expectedVersion,
    targetCommit: expected.expectedTargetCommit,
    targetTree: expected.expectedTargetTree,
    notesSha256: expected.expectedNotesSha256,
  })) {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`expected publication ${key} is required`);
    }
  }
  if (typeof expected.expectedTag === 'string' && !TAG.test(expected.expectedTag)) errors.push('expected publication tag is malformed');
  if (typeof expected.expectedVersion === 'string' && !VERSION.test(expected.expectedVersion)) errors.push('expected publication version is malformed');
  if (typeof expected.expectedTag === 'string' && typeof expected.expectedVersion === 'string'
    && expected.expectedTag !== `v${expected.expectedVersion}`) {
    errors.push('expected publication tag and version do not match');
  }
  if (typeof expected.expectedTargetCommit === 'string' && !COMMIT.test(expected.expectedTargetCommit)) {
    errors.push('expected publication target commit is malformed');
  }
  if (typeof expected.expectedTargetTree === 'string' && !COMMIT.test(expected.expectedTargetTree)) {
    errors.push('expected publication target tree is malformed');
  }
  if (typeof expected.expectedNotesSha256 === 'string' && !DIGEST.test(expected.expectedNotesSha256)) {
    errors.push('expected publication notes digest is malformed');
  }
  return errors;
}

function validateTrustedPublicationBundle(bundle, {
  expectedRunId,
  expectedTag,
  expectedVersion,
  expectedTargetCommit,
  expectedTargetTree,
  expectedNotesSha256,
} = {}) {
  const expected = {
    expectedRunId,
    expectedTag,
    expectedVersion,
    expectedTargetCommit,
    expectedTargetTree,
    expectedNotesSha256,
  };
  const errors = expectedIdentityErrors(expected);
  if (!isRecord(bundle)) return { ok: false, errors: [...errors, 'publication bundle must be an object'] };
  if (!hasOnlyKeys(bundle, ['schema', 'producer', 'runId', 'publication', 'bundleFingerprint'])) {
    errors.push('publication bundle contains unknown fields');
  }
  if (bundle.schema !== SCHEMA) errors.push(`publication bundle schema must be ${SCHEMA}`);
  if (!hasOnlyKeys(bundle.producer, ['id', 'trust']) || bundle.producer.id !== PRODUCER || bundle.producer.trust !== TRUST) {
    errors.push('publication bundle producer is not the trusted release validation gate');
  }
  if (typeof bundle.runId !== 'string' || bundle.runId.trim() === '') errors.push('publication workflow run id is malformed');
  if (typeof bundle.runId === 'string' && typeof expectedRunId === 'string' && bundle.runId !== expectedRunId) {
    errors.push('publication bundle belongs to a different workflow run');
  }

  const publication = bundle.publication;
  if (!hasOnlyKeys(publication, ['tag', 'version', 'title', 'target', 'notes'])) {
    errors.push('publication bundle is missing publication metadata');
  } else {
    if (typeof publication.tag !== 'string' || !TAG.test(publication.tag)) errors.push('publication tag is malformed');
    if (typeof publication.version !== 'string' || !VERSION.test(publication.version)) errors.push('publication version is malformed');
    if (publication.tag !== `v${publication.version}`) errors.push('publication tag and version do not match');
    if (publication.tag !== expectedTag) errors.push('publication bundle tag does not match the expected tag');
    if (publication.version !== expectedVersion) errors.push('publication bundle version does not match the expected version');
    if (publication.title !== publication.tag) errors.push('publication title does not match the publication tag');

    if (!hasOnlyKeys(publication.target, ['commit', 'tree'])) {
      errors.push('publication bundle is missing target identity');
    } else {
      if (typeof publication.target.commit !== 'string' || !COMMIT.test(publication.target.commit)) errors.push('publication target commit is malformed');
      if (typeof publication.target.tree !== 'string' || !COMMIT.test(publication.target.tree)) errors.push('publication target tree is malformed');
      if (publication.target.commit !== expectedTargetCommit) errors.push('publication bundle commit does not match the expected commit');
      if (publication.target.tree !== expectedTargetTree) errors.push('publication bundle tree does not match the expected tree');
    }

    const notes = publication.notes;
    if (!hasOnlyKeys(notes, ['encoding', 'data', 'byteLength', 'sha256']) || notes.encoding !== 'base64') {
      errors.push('publication bundle release notes encoding is invalid');
    } else {
      try {
        const bytes = decodeNotes(notes.data);
        if (!Number.isSafeInteger(notes.byteLength) || notes.byteLength !== bytes.length) {
          errors.push('publication bundle release-note byte length is invalid');
        }
        if (!DIGEST.test(String(notes.sha256 || '')) || notes.sha256 !== digestBytes(bytes)) {
          errors.push('publication bundle release-note integrity check failed');
        }
        if (notes.sha256 !== expectedNotesSha256) errors.push('publication bundle notes do not match the expected extracted-notes digest');
      } catch (error) {
        errors.push(`publication bundle release notes are invalid: ${error.message}`);
      }
    }
  }

  const { bundleFingerprint, ...withoutFingerprint } = bundle;
  if (!DIGEST.test(String(bundleFingerprint || '')) || bundleFingerprint !== digestJson(withoutFingerprint)) {
    errors.push('publication bundle fingerprint is malformed or stale');
  }
  return { ok: errors.length === 0, errors, ...(errors.length === 0 ? { bundle } : {}) };
}

function valueFor(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const match = argument.match(/^--([a-z0-9-]+)$/);
    if (!match) throw new Error(`unknown argument '${argument}'`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = valueFor(argv, index, argument);
    index += 1;
  }
  if (args.bundle === undefined) throw new Error('--bundle is required');
  for (const key of ['expectedRunId', 'expectedTag', 'expectedVersion', 'expectedTargetCommit', 'expectedTargetTree']) {
    if (args[key] === undefined) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (args.expectedNotesSha256 === undefined && args.expectedNotesDigestFile === undefined) {
    throw new Error('--expected-notes-sha256 or --expected-notes-digest-file is required');
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const bundle = JSON.parse(fs.readFileSync(path.resolve(args.bundle), 'utf8'));
  let expectedNotesSha256 = args.expectedNotesSha256;
  if (args.expectedNotesDigestFile !== undefined) {
    const digest = JSON.parse(fs.readFileSync(path.resolve(args.expectedNotesDigestFile), 'utf8'));
    const checkedDigest = validateTrustedPublicationNotesDigest(digest, { expectedRunId: args.expectedRunId });
    if (!checkedDigest.ok) {
      process.stdout.write(`${JSON.stringify(checkedDigest, null, 2)}\n`);
      return 1;
    }
    if (expectedNotesSha256 !== undefined && expectedNotesSha256 !== checkedDigest.digest.notesSha256) {
      const mismatch = { ok: false, errors: ['producer and downloaded publication notes digests do not match'] };
      process.stdout.write(`${JSON.stringify(mismatch, null, 2)}\n`);
      return 1;
    }
    expectedNotesSha256 = checkedDigest.digest.notesSha256;
  }
  const checked = validateTrustedPublicationBundle(bundle, {
    expectedRunId: args.expectedRunId,
    expectedTag: args.expectedTag,
    expectedVersion: args.expectedVersion,
    expectedTargetCommit: args.expectedTargetCommit,
    expectedTargetTree: args.expectedTargetTree,
    expectedNotesSha256,
  });
  if (checked.ok && args.notesOutput !== undefined) {
    const notesOutput = path.resolve(args.notesOutput);
    fs.mkdirSync(path.dirname(notesOutput), { recursive: true });
    fs.writeFileSync(notesOutput, decodeNotes(checked.bundle.publication.notes.data), { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(checked, null, 2)}\n`);
  return checked.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`verify-publication-bundle: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SCHEMA,
  NOTES_DIGEST_SCHEMA,
  PRODUCER,
  TRUST,
  validateTrustedPublicationBundle,
  validateTrustedPublicationNotesDigest,
  decodeNotes,
  digestBytes,
  digestJson,
  parseArgs,
  main,
};
