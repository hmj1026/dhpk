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
const ON_DEMAND_LOCK_STALE_GRACE_MS = 500;
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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

function tryReclaimStaleLock(lockDir, staleGraceMs) {
  let stale = false;
  let validOwner = false;
  const ownerFile = path.join(lockDir, 'owner.json');
  try {
    const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
      validOwner = true;
      stale = !processIsAlive(owner.pid);
    }
  } catch (_) {
    // Missing or unreadable owner.json falls through to the grace-window check.
  }
  if (!validOwner) {
    try {
      const stat = fs.lstatSync(lockDir);
      stale = (Date.now() - stat.mtimeMs) >= staleGraceMs;
    } catch (statError) {
      if (statError && statError.code === 'ENOENT') return true;
    }
  }
  if (!stale) return false;
  const retiring = `${lockDir}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.renameSync(lockDir, retiring);
  } catch (error) {
    if (error && error.code === 'ENOENT') return true;
    return false;
  }
  fs.rmSync(retiring, { recursive: true, force: true });
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
  const resolved = path.resolve(packageDir);
  const parentDir = path.dirname(resolved);
  const lockDir = path.join(parentDir, `.${path.basename(resolved)}.build-lock`);
  if (HELD_LOCKS.has(lockDir)) return fn();
  fs.mkdirSync(parentDir, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      if (tryReclaimStaleLock(lockDir, staleGraceMs)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for on-demand package lock: ${lockDir}`);
      }
      sleepMs(pollMs);
    }
  }
  try {
    const ownerTmp = path.join(lockDir, `.owner-${process.pid}.tmp`);
    fs.writeFileSync(ownerTmp, `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`, { mode: 0o600 });
    fs.renameSync(ownerTmp, path.join(lockDir, 'owner.json'));
    HELD_LOCKS.add(lockDir);
    return fn();
  } finally {
    HELD_LOCKS.delete(lockDir);
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

// Acquires locks for several package directories in canonical sorted order so
// multi-surface callers never deadlock against one another.
function withOnDemandLocks(packageDirs, fn, options) {
  const unique = [...new Set(packageDirs.map((dir) => path.resolve(dir)))].sort();
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
  isOnDemandSurface,
  onDemandPackageName,
  onDemandRelativeDir,
  onDemandPackageDir,
  onDemandArchiveName,
  archiveOnDemandPackage,
  withOnDemandSurfaceLock,
  withOnDemandLocks,
};
