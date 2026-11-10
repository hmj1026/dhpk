'use strict';

// js-projection-journal stage 1 (#1240): every effect kind in the publisher's
// transaction journal has an idempotent executor, so an inverse or a cleanup
// can run again after an interrupted recovery with the same result.

const { test, run, assert } = require('./_lib/tinytest');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const publisher = require('../scripts/lib/project-agent-projection-publisher');

const { applyEffect, EFFECT_KINDS } = publisher.__testing;

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function withProject(fn) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-effects-'));
  try {
    fn({ projectRoot }, (relative) => path.join(projectRoot, relative));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error.projectionCode === code, `expected ${code}`);
}

test('testEffectKinds_closedSet', () => {
  assert.deepStrictEqual([...EFFECT_KINDS].sort(), ['chmod', 'copy-tree', 'mkdir', 'remove', 'rename', 'symlink', 'write-file']);
  withProject((roots) => throwsCode(() => applyEffect(roots, { kind: 'unlink', args: {} }), 'UNSAFE_TRANSACTION'));
});

test('testEffectPaths_escapeOrSymlinkedAncestor_failClosed', () => {
  withProject((roots, at) => {
    throwsCode(() => applyEffect(roots, { kind: 'mkdir', args: { paths: ['../outside'] } }), 'UNSAFE_TRANSACTION');
    fs.mkdirSync(at('real'));
    fs.symlinkSync('real', at('alias'));
    throwsCode(() => applyEffect(roots, { kind: 'mkdir', args: { paths: ['alias/child'] } }), 'UNSAFE_TRANSACTION');
    assert.strictEqual(fs.existsSync(at('real/child')), false);
  });
});

test('testMkdir_createsOnceAndRefusesAnOccupiedPath', () => {
  withProject((roots, at) => {
    const effect = { kind: 'mkdir', args: { paths: ['a', 'a/b'] } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.ok(fs.statSync(at('a/b')).isDirectory());
    fs.writeFileSync(at('c'), 'file');
    throwsCode(() => applyEffect(roots, { kind: 'mkdir', args: { paths: ['c'] } }), 'RECOVERY_CONFLICT');
  });
});

test('testRemoveTree_removesTwiceAndRefusesSymlink', () => {
  withProject((roots, at) => {
    fs.mkdirSync(at('stage/deep'), { recursive: true });
    fs.writeFileSync(at('stage/deep/file'), 'x');
    const effect = { kind: 'remove', args: { paths: ['stage'], mode: 'tree' } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.existsSync(at('stage')), false);
    fs.mkdirSync(at('target'));
    fs.symlinkSync('target', at('stage'));
    throwsCode(() => applyEffect(roots, effect), 'UNSAFE_TRANSACTION');
  });
});

test('testRemoveEmpty_removesOnlyEmptyDirectories', () => {
  withProject((roots, at) => {
    fs.mkdirSync(at('a/b'), { recursive: true });
    fs.mkdirSync(at('kept'));
    fs.writeFileSync(at('kept/file'), 'x');
    const effect = { kind: 'remove', args: { paths: ['a/b', 'a', 'kept'], mode: 'empty' } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.existsSync(at('a')), false);
    assert.strictEqual(fs.readFileSync(at('kept/file'), 'utf8'), 'x');
  });
});

test('testRemoveFile_requiresTheRecordedDigest', () => {
  withProject((roots, at) => {
    fs.writeFileSync(at('ours'), 'candidate');
    const effect = { kind: 'remove', args: { paths: ['ours'], mode: 'file', digest: digest('candidate') } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.existsSync(at('ours')), false);
    fs.writeFileSync(at('ours'), 'user edit');
    throwsCode(() => applyEffect(roots, effect), 'RECOVERY_CONFLICT');
    assert.strictEqual(fs.readFileSync(at('ours'), 'utf8'), 'user edit');
  });
});

test('testRemoveLink_requiresTheRecordedTarget', () => {
  withProject((roots, at) => {
    fs.symlinkSync('../ours', at('link'));
    const effect = { kind: 'remove', args: { paths: ['link'], mode: 'link', target: '../ours' } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.existsSync(at('link')), false);
    fs.symlinkSync('../theirs', at('link'));
    throwsCode(() => applyEffect(roots, effect), 'RECOVERY_CONFLICT');
    assert.strictEqual(fs.readlinkSync(at('link')), '../theirs');
  });
});

test('testRename_andItsInverse_areIdempotent', () => {
  withProject((roots, at) => {
    fs.writeFileSync(at('live'), 'old');
    const forward = { kind: 'rename', args: { from: 'live', to: 'backup/managed/live' } };
    const inverse = { kind: 'rename', args: { from: 'backup/managed/live', to: 'live' } };
    applyEffect(roots, forward);
    applyEffect(roots, forward);
    assert.strictEqual(fs.readFileSync(at('backup/managed/live'), 'utf8'), 'old');
    applyEffect(roots, inverse);
    applyEffect(roots, inverse);
    assert.strictEqual(fs.readFileSync(at('live'), 'utf8'), 'old');
    // Neither side exists: the rename never ran, so the inverse has nothing to do.
    applyEffect(roots, { kind: 'rename', args: { from: 'absent', to: 'also-absent' } });
    fs.writeFileSync(at('backup/managed/live'), 'other');
    throwsCode(() => applyEffect(roots, inverse), 'RECOVERY_CONFLICT');
  });
});

test('testSymlink_createsOnceAndRefusesAnotherTarget', () => {
  withProject((roots, at) => {
    const effect = { kind: 'symlink', args: { path: '.codex/skills/sample', target: '../../.agents/skills/sample' } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.readlinkSync(at('.codex/skills/sample')), '../../.agents/skills/sample');
    throwsCode(() => applyEffect(roots, { kind: 'symlink', args: { path: '.codex/skills/sample', target: '../../elsewhere' } }), 'RECOVERY_CONFLICT');
  });
});

test('testChmod_restoresModeAndSkipsAnAbsentFile', () => {
  withProject((roots, at) => {
    fs.writeFileSync(at('script'), '#!/bin/sh\n', { mode: 0o644 });
    const effect = { kind: 'chmod', args: { path: 'script', mode: 0o755 } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.statSync(at('script')).mode & 0o777, 0o755);
    applyEffect(roots, { kind: 'chmod', args: { path: 'absent', mode: 0o644 } });
  });
});

test('testCopyTree_copiesOnceAndRefusesOtherContent', () => {
  withProject((roots, at) => {
    fs.mkdirSync(at('stage'));
    fs.writeFileSync(at('stage/file'), 'candidate');
    const effect = { kind: 'copy-tree', args: { from: 'stage/file', to: 'managed/file', digest: digest('candidate') } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.readFileSync(at('managed/file'), 'utf8'), 'candidate');
    fs.writeFileSync(at('managed/file'), 'user edit');
    throwsCode(() => applyEffect(roots, effect), 'RECOVERY_CONFLICT');
  });
});

test('testWriteFile_isReplayableOnlyWithContent', () => {
  withProject((roots, at) => {
    const effect = { kind: 'write-file', args: { path: 'receipt.json', digest: digest('{}\n'), content: '{}\n' } };
    applyEffect(roots, effect);
    applyEffect(roots, effect);
    assert.strictEqual(fs.readFileSync(at('receipt.json'), 'utf8'), '{}\n');
    // A recorded write without content is still satisfied once its result is in place...
    applyEffect(roots, { kind: 'write-file', args: { path: 'receipt.json', digest: digest('{}\n') } });
    // ...and fails closed when it would have to invent the content.
    throwsCode(() => applyEffect(roots, { kind: 'write-file', args: { path: 'other.json', digest: digest('{}\n') } }), 'UNSAFE_TRANSACTION');
    throwsCode(() => applyEffect(roots, { kind: 'write-file', args: { path: 'receipt.json', digest: digest('x'), content: 'x' } }), 'RECOVERY_CONFLICT');
  });
});

run('project-agent-projection-effects');
