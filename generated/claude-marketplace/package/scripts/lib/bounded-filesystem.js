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
    accountEntry(displayPath) {
      if (entries + 1 > limits.maxEntries) {
        throw new Error(`maximum fingerprint entry count (${limits.maxEntries}) exceeded: ${displayPath}`);
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
        const chunks = [];
        let remaining = expectedSize;
        let position = 0;
        while (remaining > 0) {
          const length = Math.min(64 * 1024, remaining);
          const chunk = Buffer.alloc(length);
          const count = fs.readSync(opened.fd, chunk, 0, length, position);
          if (!count) throw new Error(`file changed while reading: ${displayPath}`);
          chunks.push(count === length ? chunk : chunk.subarray(0, count));
          position += count;
          remaining -= count;
        }
        const finalStat = fs.fstatSync(opened.fd);
        if (!sameFileIdentity(opened.stat, finalStat) || Number(finalStat.size) !== expectedSize) {
          throw new Error(`file changed while reading: ${displayPath}`);
        }
        return Buffer.concat(chunks, expectedSize);
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
      budget.accountEntry(path.join(directory, entry.name));
      entries.push(entry);
    }
  } finally {
    handle.closeSync();
  }
  if (!sort) return entries;
  return entries.sort(localeSort
    ? (left, right) => left.name.localeCompare(right.name)
    : (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

module.exports = { DEFAULT_TRAVERSAL_LIMITS, createTraversalBudget, readFileBounded, readDirectoryEntries };
