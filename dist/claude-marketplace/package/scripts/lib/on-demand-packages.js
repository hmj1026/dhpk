'use strict';

// Host packages that are built on demand instead of being committed: the
// Agent Plugin, Cursor Plugin and AGY Plugin (ADR 0040). They are built into a
// gitignored directory, archived, and attached to the GitHub Release by the
// release workflow. Only the Published Packages stay committed.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ON_DEMAND_ROOT = 'dist/on-demand';
const ON_DEMAND_LOCK_TIMEOUT_MS = 120_000;
const ON_DEMAND_LOCK_POLL_MS = 25;
// Generous grace window for a newly created lock directory whose owner.json
// has not landed yet (e.g., under heavy CPU/I/O loadavg 5-20), while staying
// well below ON_DEMAND_LOCK_TIMEOUT_MS so crashed empty locks still recover.
const ON_DEMAND_LOCK_STALE_GRACE_MS = 10_000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const HELD_LOCKS = new Set();
const ON_DEMAND_PACKAGES = Object.freeze({
  'agent-plugin': Object.freeze({ name: 'dhpk-agent' }),
  'cursor-plugin': Object.freeze({ name: 'dhpk-cursor' }),
  'agy-plugin': Object.freeze({ name: 'dhpk-agy' }),
});
const ON_DEMAND_SURFACES = Object.freeze(Object.keys(ON_DEMAND_PACKAGES));

function sleepMs(milliseconds) {
  Atomics.wait(SLEEP_BUFFER, 0, 0, milliseconds);
}

function resolveLockDir(packageDir) {
  const resolved = path.resolve(packageDir);
  const parentDir = path.dirname(resolved);
  fs.mkdirSync(parentDir, { recursive: true });
  const canonicalParent = fs.realpathSync(parentDir);
  return {
    parentDir: canonicalParent,
    lockDir: path.join(canonicalParent, `.${path.basename(resolved)}.build-lock`),
  };
}

function canonicalPackagePath(packageDir) {
  const resolved = path.resolve(packageDir);
  const parentDir = path.dirname(resolved);
  try {
    return path.join(fs.realpathSync(parentDir), path.basename(resolved));
  } catch (_) {
    return resolved;
  }
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameDirectory(left, right) {
  if (!left || !right) return false;
  return left.dev === right.dev && left.ino === right.ino;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

// Returns:
// - { kind: 'owner', owner } for a valid owner record (positive integer pid)
// - { kind: 'tombstone' } for an owner.json explicitly sealed for reclamation
// - { kind: 'missing' } when owner.json is absent, partial, or invalid
function readLockState(lockDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (parsed.tombstone === true) return { kind: 'tombstone' };
      if (Number.isSafeInteger(parsed.pid) && parsed.pid > 0) return { kind: 'owner', owner: parsed };
    }
  } catch (_) {
    // Missing, partial, or invalid owner.json is treated as ownerless.
  }
  return { kind: 'missing' };
}

function readLockOwner(lockDir) {
  const state = readLockState(lockDir);
  return state.kind === 'owner' ? state.owner : null;
}

function isMatchingOwner(owner, expected) {
  return Boolean(owner && expected && owner.pid === expected.pid && owner.token === expected.token);
}

// Returns true when stale, false when live/within grace, or null when absent.
function isLockDirectoryStale(lockDir, staleGraceMs) {
  const state = readLockState(lockDir);
  if (state.kind === 'tombstone') return true;
  if (state.kind === 'owner') return !processIsAlive(state.owner.pid);
  const stat = lstatOrNull(lockDir);
  if (!stat) return null;
  return (Date.now() - stat.mtimeMs) >= staleGraceMs;
}

function tryRetireStaleGuard(reclaimDir, staleGraceMs) {
  const stale = isLockDirectoryStale(reclaimDir, staleGraceMs);
  if (stale !== true) return stale === null;
  const retiring = `${reclaimDir}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.renameSync(reclaimDir, retiring);
  } catch (error) {
    if (error && error.code === 'ENOENT') return true;
    return false;
  }
  if (isLockDirectoryStale(retiring, staleGraceMs) === false) {
    try {
      fs.renameSync(retiring, reclaimDir);
    } catch (_) {
      // Best-effort restore if another reclaimer already claimed the guard.
    }
    return false;
  }
  fs.rmSync(retiring, { recursive: true, force: true });
  return true;
}

function acquireReclaimGuard(lockDir, staleGraceMs) {
  const reclaimDir = `${lockDir}.reclaim`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let acquiredStat;
    try {
      fs.mkdirSync(reclaimDir);
      acquiredStat = fs.lstatSync(reclaimDir);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        if (attempt === 0 && tryRetireStaleGuard(reclaimDir, staleGraceMs)) continue;
        return null;
      }
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
    const ownerRecord = {
      pid: process.pid,
      token: crypto.randomBytes(12).toString('hex'),
      createdAt: Date.now(),
    };
    if (claimLockOwnership(reclaimDir, acquiredStat, ownerRecord)) {
      return { reclaimDir, ownerRecord, acquiredStat };
    }
    return null;
  }
  return null;
}

function releaseReclaimGuard(guard) {
  if (!guard) return;
  releaseOnDemandSurfaceLock(guard.reclaimDir, guard.ownerRecord, guard.acquiredStat);
}

// Atomically seals an expired ownerless lock directory with a tombstone
// owner.json before retiring it, so a slow original acquirer waking up right
// at the grace boundary cannot claim owner.json concurrently with reclamation.
function tombstoneOwnerlessLock(lockDir, expectedStat, reclaimDir) {
  if (!sameDirectory(expectedStat, lstatOrNull(lockDir))) return 'changed';
  const ownerPath = path.join(lockDir, 'owner.json');
  const tombstoneTmp = path.join(reclaimDir, `.tombstone-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  const payload = `${JSON.stringify({ tombstone: true, reclaimedBy: process.pid, reclaimedAt: Date.now() })}\n`;
  try {
    fs.writeFileSync(tombstoneTmp, payload, { mode: 0o600 });
    if (!sameDirectory(expectedStat, lstatOrNull(lockDir))) return 'changed';
    try {
      fs.linkSync(tombstoneTmp, ownerPath);
      return 'tombstoned';
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'ENOTSUP' || error.code === 'ENOSYS')) {
        if (!sameDirectory(expectedStat, lstatOrNull(lockDir))) return 'changed';
        fs.writeFileSync(ownerPath, payload, { flag: 'wx', mode: 0o600 });
        return 'tombstoned';
      }
      throw error;
    }
  } catch (error) {
    if (error && error.code === 'EEXIST') return 'exists';
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'absent';
    throw error;
  } finally {
    try {
      fs.unlinkSync(tombstoneTmp);
    } catch (_) {
      // Ignore cleanup errors on the tombstone temp file.
    }
  }
}

function tryReclaimStaleLock(lockDir, staleGraceMs) {
  const initial = isLockDirectoryStale(lockDir, staleGraceMs);
  if (initial === null) return true;
  if (!initial) return false;
  const guard = acquireReclaimGuard(lockDir, staleGraceMs);
  if (!guard) return false;
  try {
    const targetStat = lstatOrNull(lockDir);
    if (!targetStat) return true;
    const state = readLockState(lockDir);
    if (state.kind === 'owner') {
      if (processIsAlive(state.owner.pid)) return false;
    } else if (state.kind === 'missing') {
      if ((Date.now() - targetStat.mtimeMs) < staleGraceMs) return false;
      const outcome = tombstoneOwnerlessLock(lockDir, targetStat, guard.reclaimDir);
      if (outcome === 'absent') return true;
      if (outcome === 'changed') return false;
      if (outcome === 'exists') {
        const afterState = readLockState(lockDir);
        if (afterState.kind === 'owner' && processIsAlive(afterState.owner.pid)) return false;
        if (afterState.kind === 'missing') {
          const ownerStat = lstatOrNull(path.join(lockDir, 'owner.json'));
          if (!ownerStat || (Date.now() - ownerStat.mtimeMs) < staleGraceMs) return false;
        }
      }
    }
    if (!sameDirectory(targetStat, lstatOrNull(lockDir))) return false;
    const retiring = `${lockDir}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockDir, retiring);
    } catch (error) {
      if (error && error.code === 'ENOENT') return true;
      return false;
    }
    // Defense-in-depth: if an external actor replaced lockDir with a live or
    // freshly created lock outside the reclaim protocol, restore it instead of
    // destroying it.
    if (isLockDirectoryStale(retiring, staleGraceMs) === false) {
      try {
        fs.renameSync(retiring, lockDir);
      } catch (_) {
        // Best-effort restore if another process already claimed the slot.
      }
      return false;
    }
    fs.rmSync(retiring, { recursive: true, force: true });
    return true;
  } finally {
    releaseReclaimGuard(guard);
  }
}

function claimLockOwnership(lockDir, acquiredStat, ownerRecord) {
  if (!sameDirectory(acquiredStat, lstatOrNull(lockDir))) return false;
  const ownerPath = path.join(lockDir, 'owner.json');
  const ownerTmp = path.join(lockDir, `.owner-${process.pid}-${ownerRecord.token}.tmp`);
  const payload = `${JSON.stringify(ownerRecord)}\n`;
  let wroteOwnerFile = false;
  try {
    fs.writeFileSync(ownerTmp, payload, { mode: 0o600 });
    if (!sameDirectory(acquiredStat, lstatOrNull(lockDir))) return false;
    try {
      fs.linkSync(ownerTmp, ownerPath);
      wroteOwnerFile = true;
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'ENOTSUP' || error.code === 'ENOSYS')) {
        if (!sameDirectory(acquiredStat, lstatOrNull(lockDir))) return false;
        fs.writeFileSync(ownerPath, payload, { flag: 'wx', mode: 0o600 });
        wroteOwnerFile = true;
      } else {
        throw error;
      }
    }
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EEXIST' || error.code === 'ENOTDIR')) {
      return false;
    }
    try {
      fs.unlinkSync(ownerTmp);
    } catch (_) {
      // Ignore cleanup errors on the error path.
    }
    if (sameDirectory(acquiredStat, lstatOrNull(lockDir))) {
      try {
        fs.rmdirSync(lockDir);
      } catch (_) {
        // Only removes the directory if it is still empty and ours.
      }
    }
    throw error;
  } finally {
    try {
      fs.unlinkSync(ownerTmp);
    } catch (_) {
      // Already removed or lock directory was retired.
    }
  }
  const currentStat = lstatOrNull(lockDir);
  const currentOwner = readLockOwner(lockDir);
  if (sameDirectory(acquiredStat, currentStat) && isMatchingOwner(currentOwner, ownerRecord)) {
    return true;
  }
  // If a fallback `flag: 'wx'` write landed in a replacement lock directory
  // with our own unique token, release that misplaced claim so we never leave
  // our live PID stranded in another process's lock directory.
  if (wroteOwnerFile && isMatchingOwner(currentOwner, ownerRecord)) {
    releaseOnDemandSurfaceLock(lockDir, ownerRecord);
  }
  return false;
}

function releaseOnDemandSurfaceLock(lockDir, ownerRecord, acquiredStat = null) {
  if (acquiredStat && !sameDirectory(acquiredStat, lstatOrNull(lockDir))) return false;
  if (!isMatchingOwner(readLockOwner(lockDir), ownerRecord)) return false;
  const releasing = `${lockDir}.release-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.renameSync(lockDir, releasing);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  if (!isMatchingOwner(readLockOwner(releasing), ownerRecord)) {
    try {
      fs.renameSync(releasing, lockDir);
    } catch (_) {
      // Best-effort restore if another process already claimed the slot.
    }
    return false;
  }
  fs.rmSync(releasing, { recursive: true, force: true });
  return true;
}

// Serializes concurrent on-demand builds and verifiers targeting the same
// package directory so ProjectionArtifactStore activation and tar archiving
// never race across parallel CI or test runs. Re-entrant within one process.
function withOnDemandSurfaceLock(packageDir, fn, {
  timeoutMs = ON_DEMAND_LOCK_TIMEOUT_MS,
  pollMs = ON_DEMAND_LOCK_POLL_MS,
  staleGraceMs = ON_DEMAND_LOCK_STALE_GRACE_MS,
} = {}) {
  const { lockDir } = resolveLockDir(packageDir);
  if (HELD_LOCKS.has(lockDir)) return fn();
  const deadline = Date.now() + timeoutMs;
  let ownerRecord = null;
  let acquiredStat = null;
  while (true) {
    let candidateStat;
    try {
      fs.mkdirSync(lockDir);
      candidateStat = fs.lstatSync(lockDir);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        if (tryReclaimStaleLock(lockDir, staleGraceMs)) continue;
        if (Date.now() >= deadline) {
          throw new Error(`timed out waiting for on-demand package lock: ${lockDir}`);
        }
        sleepMs(pollMs);
        continue;
      }
      if (error && error.code === 'ENOENT') {
        if (Date.now() >= deadline) {
          throw new Error(`timed out waiting for on-demand package lock: ${lockDir}`);
        }
        sleepMs(pollMs);
        continue;
      }
      throw error;
    }
    const candidate = {
      pid: process.pid,
      token: crypto.randomBytes(12).toString('hex'),
      createdAt: Date.now(),
    };
    if (claimLockOwnership(lockDir, candidateStat, candidate)) {
      ownerRecord = candidate;
      acquiredStat = candidateStat;
      break;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for on-demand package lock: ${lockDir}`);
    }
    sleepMs(pollMs);
  }
  try {
    HELD_LOCKS.add(lockDir);
    return fn();
  } finally {
    HELD_LOCKS.delete(lockDir);
    releaseOnDemandSurfaceLock(lockDir, ownerRecord, acquiredStat);
  }
}

// Acquires locks for several package directories in canonical sorted order so
// multi-surface callers never deadlock against one another.
function withOnDemandLocks(packageDirs, fn, options) {
  const unique = [...new Set(packageDirs.map((dir) => canonicalPackagePath(dir)))].sort();
  const acquire = (index) => (
    index >= unique.length
      ? fn()
      : withOnDemandSurfaceLock(unique[index], () => acquire(index + 1), options)
  );
  return acquire(0);
}

function isOnDemandSurface(surface) {
  return Object.prototype.hasOwnProperty.call(ON_DEMAND_PACKAGES, surface);
}

function onDemandPackageName(surface) {
  if (!isOnDemandSurface(surface)) throw new Error(`'${surface}' is not an on-demand package surface`);
  return ON_DEMAND_PACKAGES[surface].name;
}

// Repository-relative default output of `distribution build <surface>`.
function onDemandRelativeDir(surface) {
  return `${ON_DEMAND_ROOT}/${onDemandPackageName(surface)}`;
}

function onDemandPackageDir(root, surface) {
  return path.join(root, ...onDemandRelativeDir(surface).split('/'));
}

function onDemandArchiveName(surface, version) {
  return `${onDemandPackageName(surface)}-${version}.tar.gz`;
}

// Writes <parent>/<name>-<version>.tar.gz atomically via a unique temporary
// archive, holding the package directory under its own name so extracting
// beside a sibling package reproduces the layout Cursor expects (`../dhpk-agent`).
function archiveOnDemandPackage({ surface, packageDir, version }) {
  const parentDir = path.dirname(packageDir);
  const archiveName = onDemandArchiveName(surface, version);
  const archivePath = path.join(parentDir, archiveName);
  const tempPath = path.join(parentDir, `.${archiveName}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const result = spawnSync('tar', ['-czf', tempPath, '-C', parentDir, path.basename(packageDir)], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`archive failed: ${String(result.stderr || result.error || 'tar exited non-zero').trim()}`);
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tempPath)).digest('hex');
    fs.renameSync(tempPath, archivePath);
    return { archivePath, sha256 };
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

module.exports = {
  ON_DEMAND_ROOT,
  ON_DEMAND_SURFACES,
  ON_DEMAND_LOCK_STALE_GRACE_MS,
  isOnDemandSurface,
  onDemandPackageName,
  onDemandRelativeDir,
  onDemandPackageDir,
  onDemandArchiveName,
  archiveOnDemandPackage,
  withOnDemandSurfaceLock,
  withOnDemandLocks,
};
