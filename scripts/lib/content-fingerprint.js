'use strict';

// Single owner of the digest algorithms whose results dhpk persists in a
// checked-in file and later re-computes for comparison (package
// fingerprints.json, provenance.json, distribution inventory digests, release
// manifests, harness receipts).
//
// Every function documents the exact byte recipe it reproduces. Directory trees
// use one recipe, treeFingerprint (tree-merkle-v1); each persisted value records
// its algorithm, and verifiers pick the recipe from that marker. The older
// per-surface tree recipes remain only to verify values written before the
// transition and are removed one minor release later. Recipes with a different
// purpose (content+mode release fingerprints, receipt directory entries) stay
// separate named functions. Pure functions take lists; the only disk
// reader is collectDirectoryEntries. Node built-ins and bounded-filesystem.js
// only, so the module can be mirrored into generated packages unchanged.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');

const UNLIMITED = Object.freeze({
  maxDepth: Number.MAX_SAFE_INTEGER,
  maxFiles: Number.MAX_SAFE_INTEGER,
  maxEntries: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
});

const PROFILE_KEYS = Object.freeze(['profile_policy', 'standalone_dependencies', 'project_agent_projection']);

function compareCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLocale(left, right) {
  return left.localeCompare(right);
}

function isBytecodeName(name) {
  return name === '__pycache__' || name.endsWith('.pyc');
}

// SHA-256 hex of a string (UTF-8) or of raw bytes.
function sha256Hex(input) {
  const data = Buffer.isBuffer(input) || ArrayBuffer.isView(input) ? input : String(input);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

// JSON with every object's keys sorted (UTF-16 order) recursively; arrays keep
// their order.
function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

// 'sha256:' + SHA-256 hex of canonicalJson(value).
function canonicalJsonSha256Prefixed(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function withoutProfileKeys(inventory) {
  const rest = { ...(inventory || {}) };
  for (const key of PROFILE_KEYS) delete rest[key];
  return rest;
}

// Provenance inventoryDigest for Codex native, Cursor, and the consumer gate:
// plain JSON.stringify, so it depends on the inventory's top-level key order.
function inventoryDigestInsertionOrder(inventory) {
  return sha256Hex(JSON.stringify(withoutProfileKeys(inventory)));
}

// Provenance inventoryDigest for the Agent and AGY plugins: key-sorted JSON.
function inventoryDigestKeySorted(inventory) {
  return sha256Hex(canonicalJson(withoutProfileKeys(inventory)));
}

function fileSetDigest(sortedFiles, terminator) {
  const hash = crypto.createHash('sha256');
  for (const file of sortedFiles) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.content);
    if (terminator) hash.update('\0');
  }
  return hash.digest('hex');
}

// files: [{ path, content }] with posix paths. Flat sort of the path by UTF-16
// code unit; per file `path \0 bytes`, no terminator after the bytes.
function fileSetFingerprintCodeUnit(files) {
  return fileSetDigest(files.slice().sort((a, b) => compareCodeUnit(a.path, b.path)), false);
}

// Same recipe as fileSetFingerprintCodeUnit with a flat localeCompare sort.
function fileSetFingerprintLocale(files) {
  return fileSetDigest(files.slice().sort((a, b) => compareLocale(a.path, b.path)), false);
}

// Caller order kept; per file `path \0 bytes \0`.
function fileSetFingerprintTerminated(files) {
  return fileSetDigest(files, true);
}

function buildMerkleTree(entries) {
  const root = { type: 'directory', children: new Map() };
  for (const entry of entries) {
    const names = entry.path.split('/').filter((name) => name !== '');
    if (names.length === 0) continue;
    let node = root;
    let blocked = false;
    for (let index = 0; index < names.length - 1; index += 1) {
      let child = node.children.get(names[index]);
      if (child && child.type === 'file') { blocked = true; break; }
      if (!child) {
        child = { type: 'directory', children: new Map() };
        node.children.set(names[index], child);
      }
      node = child;
    }
    if (blocked) continue;
    const leaf = names[names.length - 1];
    if (entry.type === 'directory') {
      if (!node.children.has(leaf)) node.children.set(leaf, { type: 'directory', children: new Map() });
    } else {
      node.children.set(leaf, { type: 'file', content: entry.content });
    }
  }
  return root;
}

function merkleDigest(node) {
  if (node.type === 'file') {
    return crypto.createHash('sha256').update('file\0').update(node.content).digest('hex');
  }
  const hash = crypto.createHash('sha256').update('directory\0');
  for (const name of [...node.children.keys()].sort(compareCodeUnit)) {
    hash.update(name).update('\0').update(merkleDigest(node.children.get(name))).update('\0');
  }
  return hash.digest('hex');
}

// Merkle tree over entries [{ path, type: 'file'|'directory', content? }].
// A file hashes `file\0 bytes`; a directory hashes `directory\0` followed by
// `name \0 childDigest \0` per child in UTF-16 order. Returns the digest of the
// node at `prefix` ('' is the root) or '' when nothing exists there. Entries
// are not read from disk; directory entries let an empty directory contribute.
function merkleFingerprint(entries, prefix = '') {
  const tree = buildMerkleTree(entries);
  let node = tree;
  for (const name of String(prefix).split('/').filter((part) => part !== '')) {
    node = node.type === 'directory' ? node.children.get(name) : undefined;
    if (!node) return '';
  }
  if (node === tree && tree.children.size === 0) return '';
  return merkleDigest(node);
}

const TREE_FINGERPRINT_ALGORITHM = 'tree-merkle-v1';

function treePathSegments(entryPath) {
  const names = String(entryPath).split('/');
  for (const name of names) {
    if (name === '' || name === '.' || name === '..' || name.includes('\0')) {
      throw new Error(`invalid tree path '${entryPath}'`);
    }
    if (!name.isWellFormed()) throw new Error(`tree path '${entryPath}' is not valid Unicode`);
  }
  return names;
}

function buildTreeNodes(entries) {
  const root = { type: 'directory', children: new Map() };
  for (const entry of entries) {
    if (entry.type === 'directory') continue;
    const names = treePathSegments(entry.path);
    let node = root;
    for (const name of names.slice(0, -1)) {
      let child = node.children.get(name);
      if (!child) {
        child = { type: 'directory', children: new Map() };
        node.children.set(name, child);
      } else if (child.type !== 'directory') {
        throw new Error(`tree path '${entry.path}' conflicts with a file or link`);
      }
      node = child;
    }
    const leaf = names[names.length - 1];
    if (node.children.has(leaf)) throw new Error(`tree path '${entry.path}' conflicts with another entry`);
    node.children.set(leaf, entry.type === 'link'
      ? { type: 'link', target: String(entry.target) }
      : { type: 'file', content: entry.content });
  }
  return root;
}

function treeNodeDigest(node) {
  if (node.type === 'file') return crypto.createHash('sha256').update('file\0').update(node.content).digest('hex');
  if (node.type === 'link') {
    if (!node.target.isWellFormed()) throw new Error('link target is not valid Unicode');
    return crypto.createHash('sha256').update('link\0').update(node.target, 'utf8').digest('hex');
  }
  const hash = crypto.createHash('sha256').update('directory\0');
  for (const name of [...node.children.keys()].sort(compareCodeUnit)) {
    hash.update(name, 'utf8').update('\0').update(treeNodeDigest(node.children.get(name))).update('\0');
  }
  return hash.digest('hex');
}

// Recipe `tree-merkle-v1` (OpenSpec unify-tree-fingerprint-algorithm, design D1).
// entries: [{ path, type: 'file', content }] or [{ path, type: 'link', target }]
// with posix paths relative to the tree root. Directory entries are ignored, so
// an empty directory never contributes; modes and the root path are not inputs.
//   file  = sha256( "file\0" || bytes )
//   link  = sha256( "link\0" || utf8(target text) )
//   dir   = sha256( "directory\0" || per child in UTF-16 code-unit order of its
//                   name: utf8(name) || "\0" || hex(childDigest) || "\0" )
// A tree with no files hashes to sha256("directory\0"). Link entries exist only
// when the walk used the record-links policy (collectDirectoryEntries
// `symlinks: 'record'`); this function hashes whatever it is given and never
// reads the disk. A name that is not valid Unicode, an empty or NUL-bearing
// path segment, or a path used as both a file and a directory is refused.
function treeFingerprint(entries) {
  return treeNodeDigest(buildTreeNodes(entries));
}

// Digest of the node at `prefix` inside the tree described by `entries` ('' is
// the root), or '' when nothing exists there. A file at `prefix` hashes to its
// bare `file\0` leaf (not wrapped in a directory), so a caller that fingerprints
// one file or one subtree of a larger file list gets the same value as the
// subtree hashed on its own. Entries follow treeFingerprint; nothing is read
// from disk.
function treeNodeFingerprint(entries, prefix = '') {
  let node = buildTreeNodes(entries);
  for (const name of String(prefix).split('/').filter((part) => part !== '')) {
    node = node.type === 'directory' ? node.children.get(name) : undefined;
    if (!node) return '';
  }
  return treeNodeDigest(node);
}

const LEGACY_FINGERPRINT_ALGORITHM = 'legacy';

// Selects the recipe a persisted tree value was written with from the record
// that carries it (design D3). An absent field is the legacy per-surface
// recipe, exactly `tree-merkle-v1` is the shared recipe, and anything else
// (including null and the empty string) throws so a verifier fails closed
// instead of trying both recipes.
function resolveFingerprintAlgorithm(record, field = 'fingerprintAlgorithm') {
  if (record === null || typeof record !== 'object' || !Object.prototype.hasOwnProperty.call(record, field)) {
    return LEGACY_FINGERPRINT_ALGORITHM;
  }
  if (record[field] === TREE_FINGERPRINT_ALGORITHM) return TREE_FINGERPRINT_ALGORITHM;
  throw new Error(`unknown fingerprint algorithm in '${field}': ${JSON.stringify(record[field])}`);
}

// Normalizes a caller-supplied `algorithm` option: undefined or 'legacy' keeps
// the per-surface legacy recipe, the tree name selects `tree-merkle-v1`, and
// anything else throws.
function normalizeFingerprintAlgorithm(value) {
  if (value === undefined || value === LEGACY_FINGERPRINT_ALGORITHM) return LEGACY_FINGERPRINT_ALGORITHM;
  if (value === TREE_FINGERPRINT_ALGORITHM) return TREE_FINGERPRINT_ALGORITHM;
  throw new Error(`unknown fingerprint algorithm: ${JSON.stringify(value)}`);
}

// entries: [{ path, content, mode }] in caller order (the release manifest
// feeds per-directory locale order). Content hash is `path \0 bytes`; mode hash
// is `path \0 (mode & 0o7777) \0`; the artifact fingerprint combines both with
// canonicalJsonSha256Prefixed. Directory entries are ignored.
function packageContentAndModeFingerprints(entries) {
  const content = crypto.createHash('sha256');
  const modes = crypto.createHash('sha256');
  for (const entry of entries) {
    if (entry.type === 'directory') continue;
    content.update(entry.path);
    content.update('\0');
    content.update(entry.content);
    modes.update(entry.path);
    modes.update('\0');
    modes.update(String(entry.mode & 0o7777));
    modes.update('\0');
  }
  const contentFingerprint = `sha256:${content.digest('hex')}`;
  const modeFingerprint = `sha256:${modes.digest('hex')}`;
  return {
    contentFingerprint,
    modeFingerprint,
    artifactFingerprint: canonicalJsonSha256Prefixed({ contentFingerprint, modeFingerprint }),
  };
}

// entries as returned by collectDirectoryEntries, in that order. Records
// `{ path, type }` for directories and `{ path, type, fingerprint, mode }` for
// files (`sha256:` byte digest, mode & 0o777), then
// 'sha256:' + SHA-256 hex of the canonical JSON of that list.
function directoryEntriesFingerprint(entries) {
  const records = entries.map((entry) => (entry.type === 'directory'
    ? { path: entry.path, type: 'directory' }
    : {
      path: entry.path,
      type: 'file',
      fingerprint: `sha256:${sha256Hex(entry.content)}`,
      mode: entry.mode & 0o777,
    }));
  return canonicalJsonSha256Prefixed(records);
}

// The only disk reader. Walks a physical directory and returns, in per-directory
// pre-order (a directory entry precedes its contents):
//   { path (posix, relative), type: 'directory' }
//   { path, type: 'file', content: Buffer, mode: stat.mode & 0o7777 }
//   { path, type: 'link', target: string }   (only with symlinks: 'record')
// options:
//   budget        shared traversal budget; opt-in. Without one the walk is
//                 unbounded, as every caller was before the consolidation.
//   order         'codeUnit' (default) or 'locale' sort within each directory
//   skipBytecode  skip __pycache__ and *.pyc names
//   symlinks      walk policy for a symlink (the digest never sees the policy):
//                   'refuse' (default, throws naming the relative path)
//                   'skip'   (leave the link out)
//                   'record' (record-links: emit { path, type: 'link', target }
//                            with the link text exactly as read, never resolved
//                            and never followed; for trees that legitimately hold
//                            links, such as installer destinations and the
//                            cursor/ and codex/ sync trees)
function collectDirectoryEntries(directory, options = {}) {
  const { order = 'codeUnit', skipBytecode = false, symlinks = 'refuse' } = options;
  if (order !== 'codeUnit' && order !== 'locale') throw new TypeError(`unknown directory order: ${order}`);
  if (symlinks !== 'refuse' && symlinks !== 'skip' && symlinks !== 'record') {
    throw new TypeError(`unknown symlink policy: ${symlinks}`);
  }
  const budget = options.budget || createTraversalBudget(UNLIMITED);
  const root = path.resolve(directory);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`fingerprint root '${directory}' is not a physical directory`);
  }
  const entries = [];
  const visit = (current, relative, depth) => {
    const realDirectory = budget.enterDirectory(current, depth);
    try {
      for (const entry of readDirectoryEntries(current, { budget, sort: true, localeSort: order === 'locale' })) {
        if (skipBytecode && isBytecodeName(entry.name)) continue;
        const absolute = path.join(current, entry.name);
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) {
          if (symlinks === 'skip') continue;
          if (symlinks === 'record') {
            entries.push({ path: childRelative, type: 'link', target: fs.readlinkSync(absolute) });
            continue;
          }
          throw new Error(`cannot fingerprint symlink '${childRelative}'`);
        }
        if (stat.isDirectory()) {
          entries.push({ path: childRelative, type: 'directory' });
          visit(absolute, childRelative, depth + 1);
        } else if (stat.isFile()) {
          entries.push({
            path: childRelative,
            type: 'file',
            content: budget.readFile(absolute, stat, childRelative),
            mode: stat.mode & 0o7777,
          });
        } else {
          throw new Error(`cannot fingerprint special entry '${childRelative}'`);
        }
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  visit(root, '', 0);
  return entries;
}

module.exports = {
  sha256Hex,
  canonicalJson,
  canonicalJsonSha256Prefixed,
  inventoryDigestInsertionOrder,
  inventoryDigestKeySorted,
  fileSetFingerprintCodeUnit,
  fileSetFingerprintLocale,
  fileSetFingerprintTerminated,
  merkleFingerprint,
  TREE_FINGERPRINT_ALGORITHM,
  treeFingerprint,
  treeNodeFingerprint,
  LEGACY_FINGERPRINT_ALGORITHM,
  resolveFingerprintAlgorithm,
  normalizeFingerprintAlgorithm,
  packageContentAndModeFingerprints,
  directoryEntriesFingerprint,
  collectDirectoryEntries,
};
