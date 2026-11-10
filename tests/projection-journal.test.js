'use strict';

// Projection Journal core (js-projection-journal stage 2). Every effect kind
// has an idempotent executor, so an inverse or a cleanup can run again after
// an interrupted recovery with the same result; a crash after any step of a
// transaction recovers to the state before it or after it (REQ-5, REQ-8).

const { test, run, assert } = require('./_lib/tinytest');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const journalCore = require('../scripts/lib/projection-journal');

const { EFFECT_KINDS, SimulatedCrash, ProjectionJournal } = journalCore;
const applyEffect = (roots, effect, options) => journalCore.applyEffect(roots.projectRoot, effect, options);

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

test('testForwardEffects_refuseStateThatChangedSincePlanning', () => {
  withProject((roots, at) => {
    fs.mkdirSync(at('exists'));
    throwsCode(() => applyEffect(roots, { kind: 'mkdir', args: { paths: ['exists'] } }, { forward: true }), 'RECOVERY_CONFLICT');
    throwsCode(() => applyEffect(roots, { kind: 'rename', args: { from: 'gone', to: 'x' } }, { forward: true }), 'MANAGED_CONTENT_CHANGED');
  });
});

// A small transaction exercising every reversible kind, built on the core
// alone: stage directory, parents, copy, chmod, backup rename, symlink, write.
const JOURNAL = '.agents/.journal.json';

function seed(at) {
  fs.mkdirSync(at('.agents/managed'), { recursive: true });
  fs.writeFileSync(at('.agents/managed/old.md'), 'old\n');
}

function scopeFor(projectRoot) {
  const transient = new Set([path.join(projectRoot, '.agents/.stage')]);
  return { transient, isOwned: (absolute) => absolute.startsWith(path.join(projectRoot, '.agents') + path.sep) };
}

function runTransaction(projectRoot, afterStep) {
  const at = (relative) => path.join(projectRoot, relative);
  const journal = ProjectionJournal.begin({ projectRoot, journalPath: at(JOURNAL), afterStep, journal: { schema: 'test.v1', phase: 'prepared' } });
  journalCore.recordTransientDirectory(journal, at('.agents/.stage'));
  // Writes inside the recorded stage are covered by its record.
  fs.writeFileSync(at('.agents/.stage/new.md'), 'new\n', { mode: 0o644 });
  journal.setPhase('publishing');
  journalCore.recordRename(journal, at('.agents/managed/old.md'), at('.agents/.stage/backup/old.md'));
  journalCore.recordParents(journal, at('.agents/managed/deep/new.md'), at('.agents/managed'));
  const digestNew = digest('new\n');
  journal.effect('copy-tree', { from: '.agents/.stage/new.md', to: '.agents/managed/deep/new.md', digest: digestNew }, { kind: 'remove', args: { paths: ['.agents/managed/deep/new.md'], mode: 'file', digest: digestNew } });
  journal.effect('chmod', { path: '.agents/managed/deep/new.md', mode: 0o600 }, { kind: 'chmod', args: { path: '.agents/managed/deep/new.md', mode: 0o644 } });
  journalCore.recordParents(journal, at('.codex/skills/new'), projectRoot);
  journal.effect('symlink', { path: '.codex/skills/new', target: '../../.agents/managed/deep' }, { kind: 'remove', args: { paths: ['.codex/skills/new'], mode: 'link', target: '../../.agents/managed/deep' } });
  journal.publish([{ kind: 'remove', args: { paths: ['.agents/.stage'], mode: 'tree' } }]);
  journal.finish();
}

function tree(projectRoot) {
  const out = {};
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = path.relative(projectRoot, full);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) out[relative] = `link:${fs.readlinkSync(full)}`;
      else if (stat.isDirectory()) { out[relative] = 'dir'; walk(full); }
      else out[relative] = `${(stat.mode & 0o777).toString(8)}:${fs.readFileSync(full, 'utf8')}`;
    }
  };
  walk(projectRoot);
  return out;
}

function recover(projectRoot, afterStep = null) {
  const journalPath = path.join(projectRoot, JOURNAL);
  if (!fs.existsSync(journalPath)) return;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journalCore.validateJournalRecords(journal, { projectRoot, scope: scopeFor(projectRoot) });
  journalCore.recoverJournal(journal, { projectRoot, journalPath, afterStep });
}

function expectedStates() {
  let before;
  let after;
  withProject(({ projectRoot }, at) => {
    seed(at);
    before = tree(projectRoot);
    runTransaction(projectRoot, null);
    after = tree(projectRoot);
  });
  return { before, after };
}

for (const when of ['after', 'mid']) {
  test(`testCoreCrash_${when}EachStep_recoversToBeforeOrAfter`, () => {
    const { before, after } = expectedStates();
    let crashes = 0;
    for (let target = 1; target < 100; target += 1) {
      let done = false;
      withProject(({ projectRoot }, at) => {
        seed(at);
        try {
          runTransaction(projectRoot, { [when]: (step) => { if (step === target) throw new SimulatedCrash(step); } });
          done = true;
          return;
        } catch (error) {
          if (!(error instanceof SimulatedCrash)) throw error;
        }
        crashes += 1;
        recover(projectRoot);
        const state = tree(projectRoot);
        const expected = JSON.stringify(state) === JSON.stringify(before) ? before : after;
        assert.deepStrictEqual(state, expected, `crash ${when} step ${target}`);
      });
      if (done) {
        assert.ok(crashes >= 7, `only ${crashes} crash points`);
        return;
      }
    }
    assert.fail('transaction did not finish');
  });

  // REQ-5 "Recovery is interrupted": recovery killed partway and run again
  // reaches the same state as an uninterrupted recovery.
  test(`testCoreInterruptedRecovery_${when}_rerunReachesSameState`, () => {
    const { before } = expectedStates();
    for (let target = 1; target < 100; target += 1) {
      let finished = false;
      withProject(({ projectRoot }, at) => {
        seed(at);
        try {
          runTransaction(projectRoot, (step) => { if (step === 6) throw new SimulatedCrash(step); });
        } catch (error) {
          if (!(error instanceof SimulatedCrash)) throw error;
        }
        try {
          recover(projectRoot, { [when]: (step) => { if (step === target) throw new SimulatedCrash(step); } });
          finished = true;
        } catch (error) {
          if (!(error instanceof SimulatedCrash)) throw error;
          recover(projectRoot);
        }
        assert.deepStrictEqual(tree(projectRoot), before, `recovery interrupted ${when} step ${target}`);
      });
      if (finished) {
        assert.ok(target > 2, 'recovery hook never ran');
        return;
      }
    }
    assert.fail('recovery did not finish');
  });
}

test('testCoreCommitPoint_publishedOnlyRollsForward', () => {
  withProject(({ projectRoot }, at) => {
    seed(at);
    const journal = ProjectionJournal.begin({ projectRoot, journalPath: at(JOURNAL), journal: { schema: 'test.v1', phase: 'prepared' } });
    journalCore.recordTransientDirectory(journal, at('.agents/.stage'));
    journal.publish([{ kind: 'remove', args: { paths: ['.agents/.stage'], mode: 'tree' } }]);
    throwsCode(() => journal.rollBack(), 'TRANSACTION_COMMITTED');
    recover(projectRoot);
    assert.strictEqual(fs.existsSync(at('.agents/.stage')), false);
    assert.strictEqual(fs.existsSync(at(JOURNAL)), false);
  });
});

test('testCoreValidation_rejectsRecordsOutsideScope', () => {
  withProject(({ projectRoot }) => {
    const scope = scopeFor(projectRoot);
    const journal = (effects, phase = 'publishing') => ({ phase, effects: effects.map((effect, index) => ({ id: index + 1, state: 'done', inverse: null, ...effect })) });
    const rejects = (value) => throwsCode(() => journalCore.validateJournalRecords(value, { projectRoot, scope }), 'UNSAFE_TRANSACTION');
    rejects(journal([{ kind: 'remove', args: { paths: ['src'], mode: 'tree' } }]));
    rejects(journal([{ kind: 'remove', args: { paths: ['src.md'], mode: 'file', digest: 'a'.repeat(64) } }]));
    rejects(journal([{ kind: 'mkdir', args: { paths: ['x'] }, inverse: { kind: 'write-file', args: { path: '.agents/x', digest: 'a'.repeat(64), content: 'x' } } }]));
    rejects(journal([{ kind: 'rename', args: { from: 'a', to: 'b' } }]));
    rejects(journal([{ kind: 'mkdir', args: { paths: ['x'] }, state: 'planned' }], 'published'));
    rejects({ phase: 'unknown', effects: [] });
    journalCore.validateJournalRecords(journal([{ kind: 'remove', args: { paths: ['.agents/.stage'], mode: 'tree' }, state: 'planned' }], 'published'), { projectRoot, scope });
  });
});

run('projection-journal');
