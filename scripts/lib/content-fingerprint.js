'use strict';

// Single owner of the digest algorithms whose results dhpk persists in a
// checked-in file and later re-computes for comparison (package
// fingerprints.json, provenance.json, distribution inventory digests, release
// manifests, harness receipts).
//
// Every function documents the exact byte recipe it reproduces. Directory trees
// use one recipe, treeFingerprint (tree-merkle-v1); each persisted value records
// its algorithm, and verifiers require that marker. Only tree-merkle-v1 exists;
// the older per-surface tree recipes are removed. Recipes with a different
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

// Observed-value rule shared with the installer's Python copy of the message
// (OpenSpec remove-legacy-tree-fingerprints, design D1): `absent` for undefined,
// otherwise compact JSON (no space after ':' or ',') with every character
// outside printable ASCII written as a lowercase \uXXXX escape per UTF-16 unit,
// which is what Python json.dumps(value, separators=(',', ':')) produces. The
// result is one ASCII line.
function renderObservedValue(observed) {
  if (observed === undefined) return 'absent';
  const json = JSON.stringify(observed);
  if (json === undefined) return String(observed).replace(/[^\x20-\x7e]/g, '?');
  return json.replace(/[^\x20-\x7e]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// The one diagnostic for a persisted record whose algorithm marker is absent or
// unrecognized. Names the field, states the observed value, states the 0.70.0
// version boundary, and gives both remediation paths.
function versionBoundaryMessage(field, observed) {
  return `fingerprint algorithm field '${field}' must be "${TREE_FINGERPRINT_ALGORITHM}" but the observed value is ${renderObservedValue(observed)}`
    + '; 0.70.0 accepts only records written by 0.69.x or later'
    + '; to continue, either upgrade through 0.69.x and run one install or update, or uninstall and reinstall';
}

// Fail-closed gate: returns the marker for exactly 'tree-merkle-v1', and throws
// versionBoundaryMessage(field, value) for anything else, absent included.
function requireTreeMerkle(value, field) {
  if (value === TREE_FINGERPRINT_ALGORITHM) return TREE_FINGERPRINT_ALGORITHM;
  throw new Error(versionBoundaryMessage(field, value));
}

// Selects the recipe a persisted tree value was written with from the record
// that carries it. Only tree-merkle-v1 exists: an absent field, a non-object
// record, or any other value throws the version-boundary diagnostic.
function resolveFingerprintAlgorithm(record, field = 'fingerprintAlgorithm') {
  const observed = record !== null && typeof record === 'object' && Object.prototype.hasOwnProperty.call(record, field)
    ? record[field]
    : undefined;
  return requireTreeMerkle(observed, field);
}

// Validates a caller-supplied `algorithm` option: exactly tree-merkle-v1, else
// the version-boundary diagnostic (absent included).
function normalizeFingerprintAlgorithm(value) {
  return requireTreeMerkle(value, 'algorithm');
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

// Fingerprint of one file or one directory tree under tree-merkle-v1. Walk
// order does not matter: tree digests re-sort children by code unit.
function fingerprintPath(target, options = {}) {
  requireTreeMerkle(options.algorithm === undefined ? TREE_FINGERPRINT_ALGORITHM : options.algorithm, 'fingerprintAlgorithm');
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error && error.code === 'ENOENT') return ''; throw error; }
  if (stat.isSymbolicLink()) throw new Error(`cannot fingerprint symlink entry: ${target}`);
  const budget = createTraversalBudget(options);
  if (stat.isFile()) {
    const file = [{ path: 'node', type: 'file', content: budget.readFile(target, stat) }];
    return treeNodeFingerprint(file, 'node');
  }
  if (!stat.isDirectory()) throw new Error(`cannot fingerprint special entry: ${target}`);
  const walked = collectDirectoryEntries(target, { budget, skipBytecode: true, symlinks: 'refuse' });
  return treeFingerprint(walked.filter((entry) => entry.type === 'file'));
}

module.exports = {
  fingerprintPath,
  sha256Hex,
  canonicalJson,
  canonicalJsonSha256Prefixed,
  inventoryDigestInsertionOrder,
  inventoryDigestKeySorted,
  TREE_FINGERPRINT_ALGORITHM,
  treeFingerprint,
  treeNodeFingerprint,
  versionBoundaryMessage,
  requireTreeMerkle,
  resolveFingerprintAlgorithm,
  normalizeFingerprintAlgorithm,
  packageContentAndModeFingerprints,
  directoryEntriesFingerprint,
  collectDirectoryEntries,
};
