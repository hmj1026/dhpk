'use strict';

// Projection Journal core (ADR-0036, js-projection-journal stage 2).
//
// Every filesystem effect of a transaction is a record
// `{ id, kind, args, inverse, state }`. A record is flushed as `planned`
// before its effect runs and becomes `done` with the next flush, so only the
// last record can be ambiguous after a crash. Before the commit point
// (`published`) recovery applies the inverse of every record that may have
// run, newest first; after it, recovery finishes the remaining cleanup
// records. Inverses are idempotent, so an interrupted recovery can run again.
// Writes inside a journaled transient directory are covered by that
// directory's record.
//
// The core knows nothing about receipts or Hosts: callers own the journal
// header, choose which paths a record may touch (`scope`), and decide when to
// publish. All paths in records are relative to the project root.

const fs = require('node:fs');
const path = require('node:path');
const { sha256Hex } = require('./content-fingerprint');
const { safeRelative, safeLinkTarget, inside } = require('./projection-artifact-store');

const EFFECT_KINDS = Object.freeze(['mkdir', 'rename', 'symlink', 'remove', 'write-file', 'copy-tree', 'chmod']);
const EFFECT_REMOVE_MODES = Object.freeze(['tree', 'empty', 'file', 'link']);
const EFFECT_STATES = Object.freeze(['planned', 'done', 'undone']);
const EFFECT_PHASES = Object.freeze(['staging', 'prepared', 'publishing', 'held', 'published', 'rolling-back']);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

// Test-only sentinel for in-process crash injection: no catch or finally block
// reacts to it, so the journal is left as a SIGKILL leaves it.
class SimulatedCrash extends Error {
  constructor(step) {
    super(`simulated crash after step ${step}`);
    this.name = 'SimulatedCrash';
    this.step = step;
  }
}

function isSimulatedCrash(error) {
  return error instanceof SimulatedCrash;
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.projectionCode = code;
  error.projectionDetails = details;
  return error;
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(parent, candidate) {
  return inside(path.resolve(parent), path.resolve(candidate));
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key])]));
  }
  return value;
}

function assertPhysicalAncestors(candidate, label, boundary) {
  let current = path.resolve(candidate);
  const stop = path.resolve(boundary);
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw fail('UNSAFE_PATH', `${label} has a symlinked ancestor: ${current}`, { paths: [current] });
    if (current === stop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

// Writes the journal with sorted keys, fsync'd, then renamed into place.
function writeJournalFile(journalPath, value, projectRoot) {
  const parent = path.dirname(journalPath);
  assertPhysicalAncestors(parent, 'transaction journal parent', projectRoot);
  const temporary = path.join(parent, `.${path.basename(journalPath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(clone(value))}\n`, { mode: 0o600 });
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, journalPath);
  } finally {
    if (lstatOrNull(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function effectRelative(projectRoot, absolute) {
  const relative = path.relative(projectRoot, absolute).split(path.sep).join('/');
  if (!safeRelative(relative)) throw fail('UNSAFE_PATH', 'transaction effect path must be a normalized relative path', { paths: [relative] });
  return relative;
}

// The leaf may be a Host Binding symlink; every ancestor must be physical.
function effectAbsolute(projectRoot, relative) {
  try {
    if (!safeRelative(relative)) throw fail('UNSAFE_PATH', 'transaction effect path must be a normalized relative path', { paths: [relative] });
    const candidate = path.resolve(projectRoot, relative);
    if (!isInside(projectRoot, candidate) || candidate === projectRoot) throw fail('PATH_ESCAPE', `transaction effect path escapes the project: ${relative}`, { paths: [relative] });
    assertPhysicalAncestors(path.dirname(candidate), 'transaction effect path', projectRoot);
    return candidate;
  } catch (error) {
    throw fail('UNSAFE_TRANSACTION', error.message, error.projectionDetails || {});
  }
}

function effectConflict(relative, message) {
  return fail('RECOVERY_CONFLICT', `${message}: ${relative}`, { paths: [relative] });
}

function ensureEffectParent(projectRoot, target) {
  assertPhysicalAncestors(path.dirname(target), 'transaction effect parent', projectRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function fileDigestOrNull(target) {
  const stat = lstatOrNull(target);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  return sha256Hex(fs.readFileSync(target));
}

function removeEffect(projectRoot, { paths, mode, digest = null, target = null }) {
  for (const relative of paths) {
    const absolute = effectAbsolute(projectRoot, relative);
    const stat = lstatOrNull(absolute);
    if (!stat) continue;
    if (mode === 'tree') {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('UNSAFE_TRANSACTION', `transaction directory is not a physical directory: ${relative}`, { paths: [relative] });
      fs.rmSync(absolute, { recursive: true, force: true });
    } else if (mode === 'empty') {
      if (!stat.isSymbolicLink() && stat.isDirectory() && fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute);
    } else if (mode === 'file') {
      if (stat.isSymbolicLink() || !stat.isFile()) throw effectConflict(relative, 'interrupted publication target is unsafe');
      if (digest && sha256Hex(fs.readFileSync(absolute)) !== digest) throw effectConflict(relative, 'interrupted publication target changed outside the transaction');
      fs.rmSync(absolute, { force: true });
    } else {
      if (!stat.isSymbolicLink() || fs.readlinkSync(absolute) !== target) throw effectConflict(relative, 'transaction binding changed outside the transaction');
      fs.rmSync(absolute, { force: true });
    }
  }
}

// Applies one effect from its data alone. Recovery uses it for inverses and for
// the cleanup that finishes a published transaction; each branch is idempotent:
// an effect whose result is already in place succeeds without change.
// `forward` is the first run of a recorded effect: it must find the state the
// record was planned against, so a path that appeared or vanished in between
// is a conflict instead of an already-completed effect.
function applyEffect(projectRoot, { kind, args }, { forward = false } = {}) {
  switch (kind) {
    case 'mkdir':
      for (const relative of args.paths) {
        const absolute = effectAbsolute(projectRoot, relative);
        const stat = lstatOrNull(absolute);
        if (stat) {
          if (forward || stat.isSymbolicLink() || !stat.isDirectory()) throw effectConflict(relative, 'transaction directory path is occupied');
          continue;
        }
        assertPhysicalAncestors(path.dirname(absolute), 'transaction directory parent', projectRoot);
        fs.mkdirSync(absolute);
      }
      return;
    case 'remove':
      removeEffect(projectRoot, args);
      return;
    case 'rename': {
      const from = effectAbsolute(projectRoot, args.from);
      const to = effectAbsolute(projectRoot, args.to);
      if (!lstatOrNull(from)) {
        if (forward) throw fail('MANAGED_CONTENT_CHANGED', `transaction rename source disappeared: ${args.from}`, { paths: [args.from] });
        return;
      }
      if (lstatOrNull(to)) throw effectConflict(args.to, 'transaction rename target is occupied');
      if (args.linkOnly && !lstatOrNull(from).isSymbolicLink()) throw effectConflict(args.from, 'transaction may only move a Host Binding symlink here');
      ensureEffectParent(projectRoot, to);
      fs.renameSync(from, to);
      return;
    }
    case 'symlink': {
      const absolute = effectAbsolute(projectRoot, args.path);
      const stat = lstatOrNull(absolute);
      if (stat) {
        if (stat.isSymbolicLink() && fs.readlinkSync(absolute) === args.target) return;
        throw effectConflict(args.path, 'transaction binding path is occupied');
      }
      ensureEffectParent(projectRoot, absolute);
      fs.symlinkSync(args.target, absolute, 'dir');
      return;
    }
    case 'chmod': {
      const absolute = effectAbsolute(projectRoot, args.path);
      const stat = lstatOrNull(absolute);
      if (!stat) return;
      if (stat.isSymbolicLink() || !stat.isFile()) throw effectConflict(args.path, 'transaction mode target is unsafe');
      fs.chmodSync(absolute, args.mode);
      return;
    }
    case 'copy-tree': {
      const from = effectAbsolute(projectRoot, args.from);
      const to = effectAbsolute(projectRoot, args.to);
      const existing = fileDigestOrNull(to);
      if (existing !== null) {
        if (existing === args.digest) return;
        throw effectConflict(args.to, 'transaction copy target is occupied');
      }
      ensureEffectParent(projectRoot, to);
      fs.copyFileSync(from, to);
      if (args.digest && fileDigestOrNull(to) !== args.digest) throw effectConflict(args.to, 'transaction copy drifted');
      return;
    }
    case 'write-file': {
      const absolute = effectAbsolute(projectRoot, args.path);
      const existing = fileDigestOrNull(absolute);
      if (existing !== null && existing === args.digest) return;
      if (typeof args.content !== 'string') throw fail('UNSAFE_TRANSACTION', `transaction write-file effect is not replayable: ${args.path}`, { paths: [args.path] });
      if (existing !== null) throw effectConflict(args.path, 'transaction write target is occupied');
      ensureEffectParent(projectRoot, absolute);
      fs.writeFileSync(absolute, args.content);
      return;
    }
    default:
      throw fail('UNSAFE_TRANSACTION', `unknown transaction effect kind: ${kind}`);
  }
}

class ProjectionJournal {
  // `afterStep` is a test-only crash hook. A function, or `{ after, mid }`:
  // `after` runs once a step's effect is done; `mid` runs between a record's
  // flush and its effect (or, while rolling back, between an inverse and the
  // flush that records it). `onRolledBack` runs after a complete rollback.
  constructor({ projectRoot, journalPath, journal, afterStep = null, onRolledBack = null }) {
    this.projectRoot = projectRoot;
    this.journalPath = journalPath;
    this.journal = journal;
    const hooks = typeof afterStep === 'function' ? { after: afterStep } : (afterStep || {});
    this.afterStep = typeof hooks.after === 'function' ? hooks.after : null;
    this.midStep = typeof hooks.mid === 'function' ? hooks.mid : null;
    this.onRolledBack = typeof onRolledBack === 'function' ? onRolledBack : null;
    this.step = 0;
    this.finished = false;
    this.committed = false;
  }

  // Starts a journal from its header; refuses to replace an existing one.
  static begin({ journal, ...options }) {
    if (lstatOrNull(options.journalPath)) throw fail('TRANSACTION_EXISTS', 'project projection transaction journal already exists');
    const created = new ProjectionJournal({ ...options, journal: { ...journal, effects: [] } });
    created.flush();
    return created;
  }

  flush() {
    writeJournalFile(this.journalPath, this.journal, this.projectRoot);
  }

  tick(record) {
    this.step += 1;
    if (this.afterStep) this.afterStep(this.step, record);
  }

  settleLast() {
    const last = this.journal.effects[this.journal.effects.length - 1];
    if (last && last.state === 'planned') last.state = 'done';
  }

  // Records the effect and its inverse, flushes the journal, then runs it.
  effect(kind, args, inverse, perform = null) {
    if (!EFFECT_KINDS.includes(kind) || (inverse && !EFFECT_KINDS.includes(inverse.kind))) throw fail('UNSAFE_TRANSACTION', `unknown transaction effect kind: ${kind}`);
    this.settleLast();
    const record = { id: this.journal.effects.length + 1, kind, args, inverse: inverse || null, state: 'planned' };
    this.journal.effects.push(record);
    this.flush();
    if (this.midStep) this.midStep(this.step + 1, record);
    if (perform) perform();
    else applyEffect(this.projectRoot, record, { forward: true });
    this.tick(record);
    return record;
  }

  setPhase(phase) {
    this.settleLast();
    this.journal.phase = phase;
    this.flush();
  }

  hold() {
    this.setPhase('held');
    this.finished = true;
  }

  // The commit point: the phase and every cleanup record reach disk together.
  // The in-memory journal changes only after the flush succeeds, so a failed
  // flush still rolls back from the phase before it.
  publish(cleanups) {
    this.settleLast();
    const effects = this.journal.effects.slice();
    for (const cleanup of cleanups) effects.push({ id: effects.length + 1, ...cleanup, inverse: null, state: 'planned' });
    const next = { ...this.journal, phase: 'published', effects };
    writeJournalFile(this.journalPath, next, this.projectRoot);
    this.journal = next;
    this.committed = true;
  }

  // Runs every cleanup that has not completed, then retires the journal.
  finish() {
    for (const record of this.journal.effects) {
      if (record.state === 'done') continue;
      applyEffect(this.projectRoot, record);
      record.state = 'done';
      this.tick(record);
    }
    this.close();
  }

  // Undoes every effect that may have run, newest first. Only the last record
  // can still be `planned` while its effect already ran. Returns the phase the
  // transaction was in when the rollback started.
  rollBack() {
    // Past the commit point only roll-forward is allowed (REQ-4).
    if (this.committed || this.journal.phase === 'published') throw fail('TRANSACTION_COMMITTED', 'project projection transaction is published and can only be finished, not rolled back');
    // One attempt per process: a failed rollback leaves the journal for recovery.
    this.finished = true;
    if (this.journal.phase !== 'rolling-back') {
      this.journal.rollingBackFrom = this.journal.phase;
      this.journal.phase = 'rolling-back';
      this.flush();
    }
    const effects = this.journal.effects;
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const record = effects[index];
      if (record.state === 'undone' || (record.state === 'planned' && index !== effects.length - 1)) continue;
      if (!record.inverse) throw fail('UNSAFE_TRANSACTION', `project projection transaction effect ${record.id} (${record.kind}) cannot be undone`);
      // An interrupted copy may leave a partial file. Its target was absent
      // when the record was planned, so the file is this transaction's even
      // though its digest does not match yet.
      const partialCopy = record.state === 'planned' && record.kind === 'copy-tree';
      applyEffect(this.projectRoot, partialCopy ? { ...record.inverse, args: { ...record.inverse.args, digest: null } } : record.inverse);
      if (this.midStep) this.midStep(this.step + 1, record);
      record.state = 'undone';
      this.flush();
      this.tick(record);
    }
    if (this.onRolledBack) this.onRolledBack();
    this.close();
    return this.journal.rollingBackFrom;
  }

  close() {
    fs.rmSync(this.journalPath, { force: true });
    this.finished = true;
  }
}

// Records the creation of a transient directory before it exists.
function recordTransientDirectory(journal, directory) {
  const relative = effectRelative(journal.projectRoot, directory);
  journal.effect('mkdir', { paths: [relative] }, { kind: 'remove', args: { paths: [relative], mode: 'tree' } });
  return directory;
}

// Records the missing ancestors of `target` inside `boundary` (the boundary
// itself included, never the project root) as one mkdir.
function recordParents(journal, target, boundary) {
  const { projectRoot } = journal;
  if (!isInside(boundary, target) || !isInside(projectRoot, boundary)) throw fail('PATH_ESCAPE', `transaction target escapes its root: ${target}`, { paths: [target] });
  const missing = [];
  let current = path.dirname(target);
  while (current !== projectRoot && isInside(projectRoot, current) && !lstatOrNull(current)) {
    missing.unshift(current);
    current = path.dirname(current);
  }
  if (missing.length === 0) return;
  const relatives = missing.map((directory) => effectRelative(projectRoot, directory));
  journal.effect('mkdir', { paths: relatives }, { kind: 'remove', args: { paths: relatives.slice().reverse(), mode: 'empty' } });
}

function recordRename(journal, source, target) {
  const from = effectRelative(journal.projectRoot, source);
  const to = effectRelative(journal.projectRoot, target);
  journal.effect('rename', { from, to }, { kind: 'rename', args: { from: to, to: from } });
}

// Empty directories below `root` (never `root` itself), deepest first.
function emptyDirectoriesBelow(root) {
  const found = [];
  const walk = (directory) => {
    const stat = lstatOrNull(directory);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return true;
    let empty = true;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && walk(child)) continue;
      empty = false;
    }
    if (empty && directory !== root) found.push(directory);
    return empty;
  };
  walk(root);
  return found;
}

function recordRemoveEmptyDirectories(journal, root) {
  const directories = emptyDirectoriesBelow(root).map((directory) => effectRelative(journal.projectRoot, directory));
  if (directories.length === 0) return;
  journal.effect('remove', { paths: directories, mode: 'empty' }, { kind: 'mkdir', args: { paths: directories.slice().reverse() } });
}

// Recovery replays a journal it did not necessarily write (a project may ship
// one), so each record may touch only what its owner touches. `scope` gives
// `transient` (a Set of absolute directories the transaction may delete as a
// tree) and `isOwned(absolute)` (paths the transaction may remove, copy,
// chmod, or rename). Rules:
// - `remove` tree: only `transient` directories;
// - `remove` file, `copy-tree`, `chmod`, `rename`: owned paths, and a rename
//   that leaves them may move only a symlink (a Host Binding);
// - `remove` link / empty and `mkdir`: anywhere in the project, because they
//   only delete a symlink with the recorded target or an empty directory, or
//   create an empty directory.
function validateEffectArgs(projectRoot, effect, label, scope) {
  if (!effect || typeof effect !== 'object' || !EFFECT_KINDS.includes(effect.kind) || !effect.args || typeof effect.args !== 'object') {
    throw fail('UNSAFE_TRANSACTION', `project projection transaction ${label} is invalid`);
  }
  const { kind, args } = effect;
  const unsafe = (reason) => fail('UNSAFE_TRANSACTION', `project projection transaction ${label} ${reason}`);
  const absolute = (relative) => {
    if (typeof relative !== 'string') throw unsafe('has an invalid path');
    return effectAbsolute(projectRoot, relative);
  };
  const linkTarget = (target) => {
    if (!safeLinkTarget(target)) throw unsafe('has an unsafe link target');
  };
  if (args.digest !== undefined && args.digest !== null && !DIGEST_PATTERN.test(args.digest)) throw unsafe('has an invalid digest');
  if (args.content !== undefined) throw unsafe('carries file content');
  if (['mkdir', 'remove'].includes(kind) && (!Array.isArray(args.paths) || args.paths.length === 0)) throw unsafe('has no paths');
  switch (kind) {
    case 'mkdir':
      args.paths.forEach(absolute);
      return;
    case 'remove': {
      if (!EFFECT_REMOVE_MODES.includes(args.mode)) throw unsafe('has an invalid remove mode');
      const targets = args.paths.map(absolute);
      if (args.mode === 'tree' && targets.some((target) => !scope.transient.has(target))) throw unsafe('removes a directory the transaction does not own');
      if (args.mode === 'file' && (!args.digest || targets.length !== 1 || !scope.isOwned(targets[0]))) throw unsafe('removes a file the transaction does not own');
      if (args.mode === 'link') {
        if (targets.length !== 1) throw unsafe('removes more than one link');
        linkTarget(args.target);
      }
      return;
    }
    case 'rename': {
      const from = absolute(args.from);
      const to = absolute(args.to);
      if (!scope.isOwned(from) && !scope.isOwned(to)) throw unsafe('renames paths the transaction does not own');
      // A rename that leaves the owned paths is a Host Binding backup or
      // restore; the executor then refuses to move anything but a symlink.
      if (!scope.isOwned(from) || !scope.isOwned(to)) effect.args = { ...args, linkOnly: true };
      return;
    }
    case 'copy-tree':
    case 'chmod':
    case 'write-file':
    case 'symlink':
      [args.from, args.to, args.path].filter((value) => value !== undefined).forEach((relative) => {
        const target = absolute(relative);
        if (kind !== 'symlink' && !scope.isOwned(target)) throw unsafe('touches a path the transaction does not own');
      });
      if (kind === 'symlink') linkTarget(args.target);
      if (['copy-tree', 'write-file'].includes(kind) && !args.digest) throw unsafe('has no digest');
      return;
    default:
      throw unsafe('has an unknown kind');
  }
}

// Validates the phase and every record of a journal against `scope`.
function validateJournalRecords(journal, { projectRoot, scope }) {
  if (!EFFECT_PHASES.includes(journal.phase)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an invalid phase');
  if (journal.phase === 'rolling-back' && !EFFECT_PHASES.includes(journal.rollingBackFrom)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction rollback origin is invalid');
  if (!Array.isArray(journal.effects)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction effects are invalid');
  journal.effects.forEach((record, index) => {
    if (!record || record.id !== index + 1 || !EFFECT_STATES.includes(record.state)) throw fail('UNSAFE_TRANSACTION', `project projection transaction effect ${index + 1} is invalid`);
    validateEffectArgs(projectRoot, record, `effect ${record.id}`, scope);
    if (record.inverse !== null) validateEffectArgs(projectRoot, record.inverse, `effect ${record.id} inverse`, scope);
    // After the commit point recovery only finishes cleanup of transient trees.
    if (journal.phase === 'published' && record.state !== 'done' && !(record.kind === 'remove' && record.args.mode === 'tree')) {
      throw fail('UNSAFE_TRANSACTION', `project projection transaction effect ${record.id} is not a cleanup and cannot be finished`);
    }
  });
}

// Recovers a validated journal by its commit point: a published journal is
// finished, anything else is rolled back. Returns the phase it recovered from.
function recoverJournal(journal, options) {
  const transaction = new ProjectionJournal({ ...options, journal });
  if (journal.phase === 'published') {
    transaction.finish();
    return 'published';
  }
  return transaction.rollBack();
}

module.exports = {
  EFFECT_KINDS,
  EFFECT_REMOVE_MODES,
  EFFECT_STATES,
  EFFECT_PHASES,
  SimulatedCrash,
  isSimulatedCrash,
  ProjectionJournal,
  applyEffect,
  effectRelative,
  effectAbsolute,
  recordTransientDirectory,
  recordParents,
  recordRename,
  recordRemoveEmptyDirectories,
  validateJournalRecords,
  recoverJournal,
};
