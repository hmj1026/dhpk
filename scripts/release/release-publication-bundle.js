#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildTrustedPublicationBundle,
  buildTrustedPublicationNotesDigest,
  decodeNotes,
  validateTrustedPublicationNotesDigest,
  validateTrustedPublicationBundle,
} = require('../lib/release-publication-bundle');

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
    const name = match[1];
    const value = valueFor(argv, index, argument);
    index += 1;
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = value;
  }

  const building = args.output !== undefined;
  const validating = args.bundle !== undefined;
  if (building === validating) throw new Error('one of --output or --bundle is required');
  if (building) {
    if (args.notesOutput !== undefined) throw new Error('--notes-output is only valid with --bundle');
    for (const key of ['notesFile', 'runId', 'tag', 'version', 'targetCommit', 'targetTree', 'expectedNotesSha256']) {
      if (args[key] === undefined) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required with --output`);
    }
  } else {
    if (args.digestOutput !== undefined) throw new Error('--digest-output is only valid with --output');
    for (const key of ['expectedRunId', 'expectedTag', 'expectedVersion', 'expectedTargetCommit', 'expectedTargetTree']) {
      if (args[key] === undefined) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required with --bundle`);
    }
    if (args.expectedNotesSha256 === undefined && args.expectedNotesDigestFile === undefined) {
      throw new Error('--expected-notes-sha256 or --expected-notes-digest-file is required with --bundle');
    }
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.output !== undefined) {
    const bundle = buildTrustedPublicationBundle({
      runId: args.runId,
      tag: args.tag,
      version: args.version,
      targetCommit: args.targetCommit,
      targetTree: args.targetTree,
      expectedNotesSha256: args.expectedNotesSha256,
      notesBytes: fs.readFileSync(path.resolve(args.notesFile)),
    });
    const output = path.resolve(args.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
    if (args.digestOutput !== undefined) {
      const digestOutput = path.resolve(args.digestOutput);
      const digest = buildTrustedPublicationNotesDigest({
        runId: args.runId,
        notesSha256: args.expectedNotesSha256,
      });
      fs.mkdirSync(path.dirname(digestOutput), { recursive: true });
      fs.writeFileSync(digestOutput, `${JSON.stringify(digest, null, 2)}\n`, { mode: 0o600 });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, bundleFingerprint: bundle.bundleFingerprint, output: '<bundle>' }, null, 2)}\n`);
    return 0;
  }

  const bundle = JSON.parse(fs.readFileSync(path.resolve(args.bundle), 'utf8'));
  let expectedNotesSha256 = args.expectedNotesSha256;
  if (args.expectedNotesDigestFile !== undefined) {
    const digest = JSON.parse(fs.readFileSync(path.resolve(args.expectedNotesDigestFile), 'utf8'));
    const checkedDigest = validateTrustedPublicationNotesDigest(digest, { expectedRunId: args.expectedRunId });
    if (!checkedDigest.ok) throw new Error(checkedDigest.errors.join('; '));
    if (expectedNotesSha256 !== undefined && expectedNotesSha256 !== checkedDigest.digest.notesSha256) {
      throw new Error('producer and downloaded publication notes digests do not match');
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
    process.stderr.write(`release-publication-bundle: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, main };
