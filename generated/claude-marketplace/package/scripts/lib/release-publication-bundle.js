'use strict';

// Publication validation lives in a Node-built-in-only standalone verifier so
// a later publisher can use it without checking out this repository. This
// module adds the validation-stage builder while re-exporting that one source
// of truth for consumer validation.

const verifier = require('../release/verify-publication-bundle');

const {
  SCHEMA,
  NOTES_DIGEST_SCHEMA,
  PRODUCER,
  TRUST,
  digestBytes,
  digestJson,
  decodeNotes,
} = verifier;
const TAG = /^v\d+\.\d+\.\d+$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[a-f0-9]{40}$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/i;

function requireBuildIdentity({ runId, tag, version, targetCommit, targetTree }) {
  if (typeof runId !== 'string' || runId.trim() === '') throw new Error('publication workflow run id is required');
  if (typeof tag !== 'string' || !TAG.test(tag)) throw new Error('publication tag must match vX.Y.Z');
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('publication version must match X.Y.Z');
  if (tag !== `v${version}`) throw new Error('publication tag and version do not match');
  if (typeof targetCommit !== 'string' || !COMMIT.test(targetCommit)
    || typeof targetTree !== 'string' || !COMMIT.test(targetTree)) {
    throw new Error('publication target commit/tree is invalid');
  }
}

function buildTrustedPublicationBundle({
  runId,
  tag,
  version,
  targetCommit,
  targetTree,
  notesBytes,
  expectedNotesSha256,
} = {}) {
  requireBuildIdentity({ runId, tag, version, targetCommit, targetTree });
  if (!Buffer.isBuffer(notesBytes)) throw new Error('release notes bytes are required');
  const notes = decodeNotes(notesBytes.toString('base64'));
  if (!DIGEST.test(String(expectedNotesSha256 || '')) || expectedNotesSha256 !== digestBytes(notes)) {
    throw new Error('release notes do not match the expected extracted-notes digest');
  }
  const bundle = {
    schema: SCHEMA,
    producer: { id: PRODUCER, trust: TRUST },
    runId,
    publication: {
      tag,
      version,
      title: tag,
      target: { commit: targetCommit, tree: targetTree },
      notes: {
        encoding: 'base64',
        data: notes.toString('base64'),
        byteLength: notes.length,
        sha256: digestBytes(notes),
      },
    },
  };
  return { ...bundle, bundleFingerprint: digestJson(bundle) };
}

function buildTrustedPublicationNotesDigest({ runId, notesSha256 } = {}) {
  if (typeof runId !== 'string' || runId.trim() === '') throw new Error('publication workflow run id is required');
  if (!DIGEST.test(String(notesSha256 || ''))) throw new Error('publication notes digest is malformed');
  const digest = {
    schema: NOTES_DIGEST_SCHEMA,
    producer: { id: PRODUCER, trust: TRUST },
    runId,
    notesSha256,
  };
  return { ...digest, digestFingerprint: digestJson(digest) };
}

module.exports = {
  ...verifier,
  buildTrustedPublicationBundle,
  buildTrustedPublicationNotesDigest,
};
