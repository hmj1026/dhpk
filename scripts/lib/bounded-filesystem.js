'use strict';

// Shared traversal accounting for package generators, validators, and
// consumer fingerprints.  These callers often inspect a path supplied by a
// checkout, installed surface, or generated artifact.  A symlink cycle or a
// single oversized file must fail closed before readFileSync can allocate an
// unbounded Buffer.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TRAVERSAL_LIMITS = Object.freeze({
  maxDepth: 64,
  maxFiles: 20000,
  maxEntries: 40000,
  maxBytes: 128 * 1024 * 1024,
});

const READ_CHUNK_BYTES = 64 * 1024;
const NAME_COLLATOR = new Intl.Collator();

function positiveLimit(value, fallback, label) {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return numeric;
}

function createTraversalBudget(options = {}) {
  const limits = {
    maxDepth: positiveLimit(options.maxDepth, DEFAULT_TRAVERSAL_LIMITS.maxDepth, 'maxDepth'),
    maxFiles: positiveLimit(options.maxFiles, DEFAULT_TRAVERSAL_LIMITS.maxFiles, 'maxFiles'),
    maxEntries: positiveLimit(options.maxEntries, DEFAULT_TRAVERSAL_LIMITS.maxEntries, 'maxEntries'),
    maxBytes: positiveLimit(options.maxBytes, DEFAULT_TRAVERSAL_LIMITS.maxBytes, 'maxBytes'),
  };
  const activeDirectories = new Set();
  let files = 0;
  let entries = 0;
  let bytes = 0;

  function sameFileIdentity(left, right) {
    if (!left || !right) return false;
    return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
  }

  function openPhysicalFile(filePath) {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) throw new Error(`cannot fingerprint non-file entry: ${filePath}`);
      return { fd, stat };
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }

  return {
    limits: Object.freeze(limits),
    get files() { return files; },
    get entries() { return entries; },
    get bytes() { return bytes; },
    enterDirectory(directory, depth) {
      if (depth > limits.maxDepth) {
        throw new Error(`maximum directory depth (${limits.maxDepth}) exceeded: ${directory}`);
      }
      let realDirectory;
      try {
        realDirectory = fs.realpathSync(directory);
      } catch (error) {
        throw new Error(`unable to resolve directory while fingerprinting ${directory}: ${error.message}`);
      }
      if (activeDirectories.has(realDirectory)) {
        throw new Error(`symlink cycle detected while fingerprinting: ${directory}`);
      }
      activeDirectories.add(realDirectory);
      return realDirectory;
    },
    leaveDirectory(realDirectory) {
      activeDirectories.delete(realDirectory);
    },
    // displayPath may be a thunk so hot callers only build the path on failure.
    accountEntry(displayPath) {
      if (entries + 1 > limits.maxEntries) {
        const shown = typeof displayPath === 'function' ? displayPath() : displayPath;
        throw new Error(`maximum fingerprint entry count (${limits.maxEntries}) exceeded: ${shown}`);
      }
      entries += 1;
    },
    accountBytes(size, displayPath = '(generated output)') {
      const numeric = Number(size);
      if (!Number.isSafeInteger(numeric) || numeric < 0) {
        throw new Error(`cannot account invalid byte size: ${displayPath}`);
      }
      if (bytes + numeric > limits.maxBytes) {
        throw new Error(`maximum fingerprint byte budget (${limits.maxBytes} bytes) exceeded: ${displayPath}`);
      }
      bytes += numeric;
    },
    accountFile(filePath, stat, displayPath = filePath) {
      if (!stat || !stat.isFile()) throw new Error(`cannot fingerprint non-file entry: ${filePath}`);
      const size = Number(stat.size);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`cannot fingerprint file with an invalid size: ${filePath}`);
      }
      if (files + 1 > limits.maxFiles) {
        throw new Error(`maximum fingerprint file count (${limits.maxFiles}) exceeded: ${displayPath}`);
      }
      this.accountBytes(size, displayPath);
      files += 1;
    },
    readFile(filePath, stat = null, displayPath = filePath) {
      const opened = openPhysicalFile(filePath);
      try {
        if (stat && stat.isSymbolicLink && stat.isSymbolicLink()) {
          throw new Error(`refusing to read symlink path: ${displayPath}`);
        }
        if (stat && !sameFileIdentity(stat, opened.stat)) {
          throw new Error(`file identity changed before reading: ${displayPath}`);
        }
        this.accountFile(filePath, opened.stat, displayPath);
        const expectedSize = Number(opened.stat.size);
        // The size was accounted above, so one allocation is bounded.  The
        // buffer is not zero-filled; it is only returned once every byte was
        // read, and any short read or size change throws instead.
        const result = Buffer.allocUnsafe(expectedSize);
        let position = 0;
        while (position < expectedSize) {
          const length = Math.min(READ_CHUNK_BYTES, expectedSize - position);
          const count = fs.readSync(opened.fd, result, position, length, position);
          if (!count) throw new Error(`file changed while reading: ${displayPath}`);
          position += count;
        }
        const finalStat = fs.fstatSync(opened.fd);
        if (!sameFileIdentity(opened.stat, finalStat) || Number(finalStat.size) !== expectedSize) {
          throw new Error(`file changed while reading: ${displayPath}`);
        }
        return result;
      } finally {
        fs.closeSync(opened.fd);
      }
    },
  };
}

function readFileBounded(filePath, options = {}) {
  const budget = createTraversalBudget(options);
  return budget.readFile(filePath);
}

function readDirectoryEntries(directory, { budget = createTraversalBudget(), sort = false, localeSort = false } = {}) {
  const handle = fs.opendirSync(directory);
  const entries = [];
  try {
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      budget.accountEntry(() => path.join(directory, entry.name));
      entries.push(entry);
    }
  } finally {
    handle.closeSync();
  }
  if (!sort) return entries;
  return entries.sort(localeSort
    ? (left, right) => NAME_COLLATOR.compare(left.name, right.name)
    : (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

function listFilesNamedRecursively(directory, name, options = {}) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('file name must be a non-empty string');
  const files = [];
  const budget = createTraversalBudget(options);
  const walk = (current, depth) => {
    const realDirectory = budget.enterDirectory(current, depth);
    try {
      for (const entry of readDirectoryEntries(current, { budget, sort: true, localeSort: options.localeSort === true })) {
        const child = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(child, depth + 1);
        else if (entry.isFile() && entry.name === name) files.push(child);
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(directory, 0);
  return files;
}

// Path guards shared by the Host package generators. Only copies that were
// identical across generators live here; drifted variants stay local (#1248).

function lstatOrNull(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function assertPhysicalAncestors(directory, label) {
  let current = path.resolve(directory);
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

// `create` selects ensure semantics: a missing directory is created and a
// symlink gets its own error. Without it a missing directory passes and a
// symlink falls through to the "must be a directory" error.
function checkPhysicalDirectory(directory, label, create) {
  assertPhysicalAncestors(directory, label);
  const stat = lstatOrNull(directory);
  if (!stat) {
    if (create) fs.mkdirSync(directory, { recursive: true });
    return path.resolve(directory);
  }
  if (create && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${directory}`);
  if (fs.realpathSync(directory) !== path.resolve(directory)) {
    throw new Error(`refusing ${label} whose realpath escapes its lexical root: ${directory}`);
  }
  return path.resolve(directory);
}

function ensurePhysicalDirectory(directory, label) {
  return checkPhysicalDirectory(directory, label, true);
}

// Like ensurePhysicalDirectory but never creates: a missing directory passes.
function assertPhysicalDirectory(directory, label) {
  return checkPhysicalDirectory(directory, label, false);
}

// Every symlink at or below `directory`, the root itself included.
function findSymlinks(directory, options = {}) {
  const budget = createTraversalBudget(options);
  const walk = (current, depth) => {
    const found = [];
    const stat = lstatOrNull(current);
    if (!stat) return found;
    if (stat.isSymbolicLink()) return [current];
    if (!stat.isDirectory()) return found;
    const realDirectory = budget.enterDirectory(current, depth);
    try {
      for (const entry of readDirectoryEntries(current, { budget, sort: true, localeSort: true })) {
        const child = path.join(current, entry.name);
        if (entry.isSymbolicLink()) found.push(child);
        else if (entry.isDirectory()) found.push(...walk(child, depth + 1));
      }
      return found;
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  return walk(directory, 0);
}

function physicalPackageRootError(directory, label) {
  try {
    assertPhysicalAncestors(directory, label);
    const stat = lstatOrNull(directory);
    if (!stat || !stat.isDirectory()) return `${label} must be a physical directory: ${directory}`;
    if (fs.realpathSync(directory) !== path.resolve(directory)) {
      return `${label} realpath escapes its lexical root: ${directory}`;
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

module.exports = {
  lstatOrNull,
  isInside,
  assertPhysicalAncestors,
  ensurePhysicalDirectory,
  assertPhysicalDirectory,
  findSymlinks,
  physicalPackageRootError,
  DEFAULT_TRAVERSAL_LIMITS,
  createTraversalBudget,
  readFileBounded,
  readDirectoryEntries,
  listFilesNamedRecursively,
};
