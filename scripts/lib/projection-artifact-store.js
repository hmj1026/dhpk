'use strict';

// Filesystem implementation of the ProjectionArtifactStore port.  Callers
// receive only a plan-bound session; destination paths and link targets are
// validated against that plan before any staged mutation is made.

const fs = require('node:fs');
const path = require('node:path');
const { createDistributionArtifact, projectionError, SYMLINK_POLICIES } = require('./distribution-projection-contract');
const { sha256Hex } = require('./content-fingerprint');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');

// Shared path-safety predicates (also used by the Projection Receipt
// publisher).  They reject the union of everything either prior implementation
// rejected: empty values, NUL, backslash, absolute paths, any drive prefix, and
// '.', '..', or empty segments.
function hasDriveOrSeparatorHazard(value) {
  return typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/.test(value);
}

function safeRelative(value) {
  if (hasDriveOrSeparatorHazard(value)) return false;
  return !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function safeLinkTarget(value) {
  if (hasDriveOrSeparatorHazard(value)) return false;
  if (value.split('/').some((part) => part === '' || part === '.')) return false;
  return path.posix.normalize(value) === value;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function stagedManifest(stageRoot) {
  const files = new Map();
  const directories = new Set(['']);
  const budget = createTraversalBudget();

  const walk = (directory, relative = '', depth = 0) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget, sort: true, localeSort: true })) {
        const child = path.join(directory, entry.name);
        const childRelative = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) {
          directories.add(childRelative);
          walk(child, childRelative, depth + 1);
        } else if (entry.isSymbolicLink()) {
          files.set(childRelative, { type: 'symlink', target: fs.readlinkSync(child) });
        } else if (entry.isFile()) {
          files.set(childRelative, { type: 'file', fingerprint: sha256Hex(budget.readFile(child)), mode: fs.statSync(child).mode & 0o7777 });
        } else {
          files.set(childRelative, { type: 'other' });
        }
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };

  walk(stageRoot, '', 0);
  return { files, directories };
}

function assertStagedManifest(plan, stageRoot, written, links, fail) {
  const planned = new Map();
  for (const entry of plan.entries) {
    if (planned.has(entry.destination)) {
      fail('DUPLICATE_PLANNED_PATH', `planned destination is duplicated: '${entry.destination}'`, {
        paths: [entry.destination],
      });
    }
    planned.set(entry.destination, entry);
  }

  const ledger = new Map();
  for (const output of written) ledger.set(output.destination, { ...output, type: 'file' });
  for (const link of links) ledger.set(link.destination, { ...link, type: 'symlink' });
  if (ledger.size !== plan.entries.length) {
    fail('STAGED_TREE_INCOMPLETE', 'staged tree mutation ledger does not cover the compiled plan', {
      stableIds: plan.entries.map((entry) => entry.stableId),
    });
  }

  const observed = stagedManifest(stageRoot);
  const allowedDirectories = new Set(['']);
  for (const destination of planned.keys()) {
    const parts = destination.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirectories.add(parts.slice(0, index).join('/'));
    }
  }
  for (const directory of observed.directories) {
    if (!allowedDirectories.has(directory)) {
      fail('UNEXPECTED_STAGED_ENTRY', `staged directory is absent from the compiled plan: '${directory}'`, {
        paths: [directory],
      });
    }
  }

  for (const [destination, actual] of observed.files) {
    if (!planned.has(destination) || !ledger.has(destination)) {
      fail('UNEXPECTED_STAGED_ENTRY', `staged entry is absent from the compiled plan: '${destination}'`, {
        paths: [destination],
      });
    }
    const entry = planned.get(destination);
    const recorded = ledger.get(destination);
    if (actual.type !== recorded.type) {
      fail('STAGED_ENTRY_TYPE_DRIFT', `staged entry type changed for '${destination}'`, {
        stableIds: [entry.stableId],
        paths: [destination],
      });
    }
    if (actual.type === 'file') {
      if (actual.fingerprint !== recorded.fingerprint) {
        fail('STAGED_CONTENT_DRIFT', `staged content changed after store write for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
      if (entry.expectedFingerprint && actual.fingerprint !== entry.expectedFingerprint) {
        fail('STAGED_CONTENT_MISMATCH', `staged content does not match the compiled plan for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
      if (entry.mode !== null && entry.mode !== undefined && actual.mode !== entry.mode) {
        fail('STAGED_MODE_MISMATCH', `staged mode does not match the compiled plan for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
    } else if (actual.type === 'symlink') {
      if (actual.target !== recorded.target || (entry.symlink && entry.symlink.target && actual.target !== entry.symlink.target)) {
        fail('STAGED_LINK_DRIFT', `staged link target changed for '${destination}'`, {
          stableIds: [entry.stableId],
          paths: [destination],
        });
      }
    }
  }

  for (const destination of planned.keys()) {
    if (!observed.files.has(destination)) {
      fail('STAGED_TREE_INCOMPLETE', `compiled output is missing from the staged tree: '${destination}'`, {
        paths: [destination],
      });
    }
  }
}

class ProjectionArtifactStore {
  constructor({ root, sourceRoot = root, publishRoot = null, ownership = null, fs: fileSystem = fs } = {}) {
    if (typeof root !== 'string' || root.trim() === '') throw new TypeError('ProjectionArtifactStore root is required');
    this.root = path.resolve(root);
    this.sourceRoot = path.resolve(sourceRoot);
    this.publishRoot = path.resolve(publishRoot || path.join(this.root, 'published'));
    if (!inside(this.root, this.publishRoot)) {
      throw new TypeError('ProjectionArtifactStore publishRoot must be contained by root');
    }
    // Default ownership declaration for every session; begin() may override it.
    this.ownership = ownership;
    // Injectable so tests can fail publish-time filesystem calls deterministically.
    this.fs = fileSystem;
    fs.mkdirSync(this.root, { recursive: true });
  }

  begin(plan, { ownership = this.ownership } = {}) {
    if (!plan || !Array.isArray(plan.entries) || !plan.planFingerprint) throw new TypeError('begin requires a compiled plan');
    const verifyOwnership = ownershipVerifier(ownership);
    reconcileScratch(this.root, this.publishRoot);
    const stageRoot = fs.mkdtempSync(path.join(this.root, `${STAGE_PREFIX}${process.pid}-`));
    const entries = new Map(plan.entries.map((entry) => [entry.stableId, entry]));
    const written = [];
    const links = [];
    let staged = false;
    let activated = false;

    const fail = (code, message, details = {}) => {
      throw Object.assign(new Error(message), { projectionCode: code, projectionDetails: details });
    };

    const entryFor = (output) => {
      if (!output || typeof output !== 'object') fail('INVALID_OUTPUT', 'planned output must be an object');
      const entry = entries.get(output.stableId);
      if (!entry) fail('UNPLANNED_OUTPUT', `output stable id '${output.stableId}' is absent from the plan`, { stableIds: [output.stableId] });
      if (output.destination !== entry.destination) fail('UNPLANNED_PATH', `output destination '${output.destination}' does not match the plan`, { stableIds: [entry.stableId], paths: [output.destination] });
      if (!safeRelative(entry.destination)) fail('UNSAFE_PATH', `planned destination is not safe: '${entry.destination}'`, { stableIds: [entry.stableId], paths: [entry.destination] });
      return entry;
    };

    const stagedPath = (relative) => {
      const target = path.resolve(stageRoot, relative);
      if (!inside(stageRoot, target)) fail('PATH_ESCAPE', `staged path escapes the artifact root: '${relative}'`, { paths: [relative] });
      return target;
    };

    const session = {
      // The stage root is exposed only for adapter-side structural validation.
      // stage() audits the complete staged manifest before returning a
      // candidate; activate() is the only operation that replaces the active
      // root. publish() remains a compatibility convenience for callers that
      // intentionally request both phases.
      stageRoot,
      write: (output) => {
        const entry = entryFor(output);
        if (entry.symlink && entry.symlink.policy !== 'forbid' && output.linkTarget) {
          fail('LINK_REQUIRED', `entry '${entry.stableId}' requires link()`, { stableIds: [entry.stableId] });
        }
        const target = stagedPath(entry.destination);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (typeof output.content !== 'string' && !Buffer.isBuffer(output.content)) {
          fail('INVALID_CONTENT', `output '${entry.stableId}' requires string or Buffer content`, { stableIds: [entry.stableId] });
        }
        const mode = output.mode === undefined || output.mode === null ? entry.mode : output.mode;
        if (mode !== null && mode !== undefined && (!Number.isInteger(mode) || mode < 0 || mode > 0o7777)) {
          fail('INVALID_MODE', `output '${entry.stableId}' requires a valid file mode`, { stableIds: [entry.stableId] });
        }
        if (entry.mode !== null && entry.mode !== undefined && mode !== entry.mode) {
          fail('MODE_MISMATCH', `output mode does not match the compiled plan for '${entry.stableId}'`, { stableIds: [entry.stableId] });
        }
        fs.writeFileSync(target, output.content);
        // writeFileSync's mode is masked by the umask; apply the plan's mode exactly.
        if (mode !== null && mode !== undefined) fs.chmodSync(target, mode);
        written.push({
          stableId: entry.stableId,
          destination: entry.destination,
          fingerprint: sha256Hex(createTraversalBudget().readFile(target)),
          mode: fs.statSync(target).mode & 0o7777,
          ...(entry.skillId ? {
            skillId: entry.skillId,
            publicName: entry.publicName,
            invocationClass: entry.invocationClass,
            lifecycle: entry.lifecycle,
            usageSchema: entry.usageSchema,
            usage: entry.usage,
            usageFingerprint: entry.usageFingerprint,
            provenance: entry.provenance,
          } : {}),
        });
      },
      link: (output) => {
        const entry = entryFor(output);
        const policy = entry.symlink && entry.symlink.policy ? entry.symlink.policy : 'forbid';
        if (policy === 'forbid') fail('SYMLINK_FORBIDDEN', `symlink is forbidden for '${entry.stableId}'`, { stableIds: [entry.stableId] });
        const targetText = output.target || (entry.symlink && entry.symlink.target);
        if (!safeLinkTarget(targetText)) fail('INVALID_LINK', `link target must be relative: '${targetText}'`, { stableIds: [entry.stableId] });
        const target = stagedPath(entry.destination);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // Judge the link where it will finally live: stage and publish roots can
        // differ in depth, so the staged location is not authoritative.
        const finalDirectory = path.dirname(path.join(this.publishRoot, entry.destination));
        const resolved = path.resolve(finalDirectory, targetText);
        if (policy === 'contained-relative' && !inside(this.publishRoot, resolved)) {
          fail('LINK_ESCAPE', `link target escapes artifact ownership root: '${targetText}'`, { stableIds: [entry.stableId] });
        }
        if (policy === 'declared-source-relative' && !inside(this.sourceRoot, resolved)) {
          fail('LINK_ESCAPE', `link target escapes declared source root: '${targetText}'`, { stableIds: [entry.stableId] });
        }
        fs.symlinkSync(targetText, target);
        links.push({ stableId: entry.stableId, destination: entry.destination, target: targetText, policy });
      },
      // Stage-time digest of a written file, so adapters can render receipts
      // (fingerprints.json / provenance.json) without re-reading the stage.
      fingerprintOf: (destination) => {
        const record = written.findLast((output) => output.destination === destination);
        if (!record) {
          fail('FINGERPRINT_UNAVAILABLE', `no written file output for '${destination}'`, { paths: [destination] });
        }
        return record.fingerprint;
      },
      stage: () => {
        if (staged) fail('ALREADY_STAGED', 'artifact has already been staged');
        assertStagedManifest(plan, stageRoot, written, links, fail);
        staged = true;
        return { outputs: written, links, stageRoot, artifactFingerprint: digestManifest(written, links) };
      },
      activate: () => {
        if (!staged) fail('NOT_STAGED', 'artifact must be staged before activation');
        if (activated) fail('ALREADY_ACTIVATED', 'artifact has already been activated');
        const publishRoot = this.publishRoot;
        const backupRoot = path.join(this.root, `${BACKUP_PREFIX}${process.pid}-${Date.now()}-${rootTag(publishRoot)}`);
        const existing = lstatOrNull(publishRoot);
        if (existing) {
          const verdict = verifyOwnership(publishRoot, existing);
          if (!verdict.ok) {
            fail('OWNERSHIP_REFUSED', `refusing to replace '${publishRoot}': ${verdict.message}`, { paths: [publishRoot], reason: verdict.code });
          }
        }
        const io = this.fs;
        try {
          if (existing) io.renameSync(publishRoot, backupRoot);
          io.renameSync(stageRoot, publishRoot);
        } catch (error) {
          // Rollback applies only while the stage rename has not succeeded.
          if (lstatOrNull(publishRoot) && !lstatOrNull(stageRoot)) io.renameSync(publishRoot, stageRoot);
          if (lstatOrNull(backupRoot) && !lstatOrNull(publishRoot)) io.renameSync(backupRoot, publishRoot);
          throw error;
        }
        activated = true;
        const warnings = [];
        // Best effort: a failed cleanup must never undo the published tree.
        if (lstatOrNull(backupRoot)) {
          try {
            io.rmSync(backupRoot, { recursive: true, force: true });
          } catch (error) {
            warnings.push({ code: 'BACKUP_CLEANUP_FAILED', path: backupRoot, message: `previous tree backup was not removed: ${error.message}` });
          }
        }
        return { outputs: written, links, artifactFingerprint: digestManifest(written, links), ...(warnings.length > 0 ? { warnings } : {}) };
      },
      publish: () => {
        if (!staged) session.stage();
        return session.activate();
      },
      abort: () => {
        if (!activated && fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
      },
    };
    return session;
  }
}

const STAGE_PREFIX = '.projection-stage-';
const BACKUP_PREFIX = '.projection-backup-';
const STAGE_NAME = /^\.projection-stage-(\d+)-[A-Za-z0-9]{6}$/;
// Backups carry the creating PID and, since the restore rule, a short tag of
// the publish root they came from (older names have no tag).
const BACKUP_NAME = /^\.projection-backup-(\d+)-\d+(?:-([0-9a-f]{8}))?$/;

function projectionFailure(code, message, details = {}) {
  return Object.assign(new Error(message), { projectionCode: code, projectionDetails: details });
}

function rootTag(publishRoot) {
  return sha256Hex(publishRoot).slice(0, 8);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return Boolean(error && error.code === 'EPERM');
  }
}

// Reconcile scratch directories left by processes that no longer exist.
// Decided by PID liveness only, never by age, so a slow concurrent build is
// untouched.  Names without a parsable PID (older stage names) are left alone.
// A dead backup is the last accepted tree of an interrupted activation: when
// the publish root is missing it is restored, never deleted; several candidates
// are refused rather than guessed.  Only backups tagged with THIS publish
// root's tag are candidates.  Backups tagged for another root belong to that
// root's store, and legacy untagged backups cannot be attributed to any root
// (a shared store root such as cursor/ would restore one into the wrong
// subdirectory); both are left in place and never restored or removed.
//
// Limitations of the PID liveness check: a PID is meaningful only inside its
// own PID namespace.  A store root shared across containers or across WSL /
// Windows interop can therefore misjudge liveness (a live foreign builder
// looks dead, or a dead one looks alive).  PID reuse errs safe: a reused PID
// makes a dead entry look alive, so it stays an orphan and is never deleted.
function reconcileScratch(storeRoot, publishRoot) {
  const tag = rootTag(publishRoot);
  const candidates = [];
  for (const entry of fs.readdirSync(storeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stage = STAGE_NAME.exec(entry.name);
    const backup = stage ? null : BACKUP_NAME.exec(entry.name);
    const match = stage || backup;
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || processIsAlive(pid)) continue;
    if (stage) {
      fs.rmSync(path.join(storeRoot, entry.name), { recursive: true, force: true });
    } else if (backup[2] === tag) {
      candidates.push(entry.name);
    }
  }
  if (candidates.length === 0) return;
  if (!lstatOrNull(publishRoot)) {
    if (candidates.length > 1) {
      throw projectionFailure('AMBIGUOUS_BACKUP_RESTORE', `publish root '${publishRoot}' is missing and ${candidates.length} interrupted-activation backups exist; restore one manually`, {
        paths: candidates.map((name) => path.join(storeRoot, name)),
      });
    }
    fs.renameSync(path.join(storeRoot, candidates[0]), publishRoot);
    return;
  }
  for (const name of candidates) fs.rmSync(path.join(storeRoot, name), { recursive: true, force: true });
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

// Default ownership proof: a physical directory whose provenance.json records
// the declared owner.  The store reads only the `owner` field, so it still
// knows no Host receipt schema.
function defaultOwnershipVerifier(owner) {
  return (existingRoot) => {
    const receipt = path.join(existingRoot, 'provenance.json');
    const stat = lstatOrNull(receipt);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      return { ok: false, code: 'NO_OWNER_RECEIPT', message: 'existing tree has no owner receipt' };
    }
    let recorded = null;
    try {
      recorded = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    } catch {
      return { ok: false, code: 'INVALID_OWNER_RECEIPT', message: 'existing owner receipt is not valid JSON' };
    }
    if (!recorded || typeof recorded !== 'object' || recorded.owner !== owner) {
      return { ok: false, code: 'FOREIGN_OWNER', message: `existing tree is not owned by '${owner}'` };
    }
    return { ok: true };
  };
}

// An existing publish root is always gated.  A caller that declares no owner
// can only publish into a missing root.  The physical-directory rule always
// applies; a surface verifier can only tighten it.
function ownershipVerifier(ownership) {
  if (!ownership) {
    return (existingRoot, stat) => {
      if (stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(existingRoot).length === 0) return { ok: true };
      return { ok: false, code: 'OWNER_NOT_DECLARED', message: 'no owner was declared for this publish root' };
    };
  }
  const surfaceVerify = typeof ownership.verify === 'function'
    ? ownership.verify
    : (typeof ownership.owner === 'string' && ownership.owner ? defaultOwnershipVerifier(ownership.owner) : null);
  if (!surfaceVerify) throw new TypeError('ownership requires a verify function or an owner');
  return (existingRoot, stat) => {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false, code: 'NOT_PHYSICAL_DIRECTORY', message: 'existing publish root is not a physical directory' };
    }
    // An empty directory holds nothing to lose (a caller may pre-create its
    // output directory), so the declared-owner receipt is not required of it.
    // A caller-supplied verify still judges it: that surface decides.
    if (typeof ownership.verify !== 'function' && fs.readdirSync(existingRoot).length === 0) return { ok: true };
    const verdict = surfaceVerify(existingRoot);
    if (!verdict || verdict.ok !== true) {
      return {
        ok: false,
        code: (verdict && verdict.code) || 'OWNERSHIP_UNPROVEN',
        message: (verdict && verdict.message) || 'ownership verification failed',
      };
    }
    return { ok: true };
  };
}

function digestManifest(outputs, links) {
  return sha256Hex(JSON.stringify({ outputs, links }));
}

module.exports = {
  ProjectionArtifactStore,
  safeRelative,
  safeLinkTarget,
  inside,
};
