'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { redactSensitiveText } = require('./redaction');

const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const TREE = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FINGERPRINT = /^(?:sha256:)?[a-f0-9]{64}$/i;
const PRIVATE_KEY_MATERIAL = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const ROLLBACK_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'scopeId',
  'diffId',
  'surface',
  'sourceCommit',
  'sourceTree',
  'planFingerprint',
  'artifactFingerprint',
  'owner',
]);

function sha256(value) {
  const input = Buffer.isBuffer(value) || ArrayBuffer.isView(value) ? value : String(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function isFingerprint(value) {
  return typeof value === 'string' && FINGERPRINT.test(value);
}

function normalizeComparable(field, value) {
  if (typeof value === 'string' && (field === 'sourceCommit' || field === 'sourceTree'
    || field === 'generatedFromCommit' || field === 'generatedFromTree'
    || field === 'baseCommit' || field === 'targetCommit' || field === 'targetTree'
    || /Fingerprint$/.test(field))) {
    return value.toLowerCase();
  }
  return value;
}

function compareIdentity(expected, actual) {
  const errors = [];
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, errors: ['expected identity must be an object'] };
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return { ok: false, errors: ['actual identity must be an object'] };
  }
  Object.keys(expected).forEach((field) => {
    const expectedValue = expected[field];
    if (expectedValue === undefined || expectedValue === null) return;
    if (!Object.prototype.hasOwnProperty.call(actual, field)
      || actual[field] === undefined
      || actual[field] === null) {
      errors.push(`identity field '${field}' is missing`);
      return;
    }
    const left = normalizeComparable(field, expectedValue);
    const right = normalizeComparable(field, actual[field]);
    if (canonicalJson(left) !== canonicalJson(right)) errors.push(`identity field '${field}' does not match`);
  });
  return { ok: errors.length === 0, errors };
}

function validateIdentity(expected, actual) {
  return compareIdentity(expected, actual);
}

function fingerprintForBytes(file) {
  return `sha256:${sha256(fs.readFileSync(file))}`;
}

function fingerprintDirectory(directory) {
  const root = path.resolve(directory);
  const entries = [];
  const visit = (current, relative) => {
    const names = fs.readdirSync(current).sort();
    for (const name of names) {
      const absolute = path.join(current, name);
      const childRelative = relative ? path.join(relative, name) : name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`cannot fingerprint symlink '${childRelative}'`);
      if (stat.isDirectory()) {
        entries.push({ path: childRelative.split(path.sep).join('/'), type: 'directory' });
        visit(absolute, childRelative);
      } else if (stat.isFile()) {
        entries.push({
          path: childRelative.split(path.sep).join('/'),
          type: 'file',
          fingerprint: fingerprintForBytes(absolute),
          mode: stat.mode & 0o777,
        });
      } else {
        throw new Error(`cannot fingerprint special entry '${childRelative}'`);
      }
    }
  };
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`fingerprint root '${directory}' is not a physical directory`);
  visit(root, '');
  return `sha256:${sha256(canonicalJson(entries))}`;
}

function revalidateBytes(reference, expectedFingerprint = null) {
  const descriptor = reference && typeof reference === 'object' && !Array.isArray(reference)
    ? reference
    : { path: reference, fingerprint: expectedFingerprint };
  const file = descriptor.path;
  const expected = descriptor.fingerprint || expectedFingerprint;
  const errors = [];
  if (typeof file !== 'string' || !file) errors.push('byte reference path is required');
  if (!isFingerprint(expected)) errors.push('byte reference fingerprint must be a SHA-256 digest');
  if (errors.length > 0) return { ok: false, errors, path: file || null, expectedFingerprint: expected || null };
  let actualFingerprint;
  try {
    actualFingerprint = descriptor.kind === 'directory'
      ? fingerprintDirectory(file)
      : fingerprintForBytes(file);
  } catch (error) {
    return {
      ok: false,
      errors: [`byte reference is unreadable: ${error.message}`],
      path: file,
      expectedFingerprint: expected,
    };
  }
  if (actualFingerprint.toLowerCase() !== expected.toLowerCase()) {
    errors.push('byte reference fingerprint does not match persisted digest');
  }
  return { ok: errors.length === 0, errors, path: file, expectedFingerprint: expected, actualFingerprint };
}

function redact(value, depth = 0, key = '') {
  if (depth > 5) return '<truncated>';
  if (/authorization|proxy.?authorization|token|password|secret|api.?key|private.?key|signing.?key|cookie|credential/i.test(key)) return '<redacted>';
  if (typeof value === 'string') {
    if (PRIVATE_KEY_MATERIAL.test(value)) return '<redacted>';
    return redactSensitiveText(value, { maxLength: 4096 });
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redact(entry, depth + 1, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([entryKey, entry]) => [
    entryKey,
    redact(entry, depth + 1, entryKey),
  ]));
}

function redactEvidence(value, depth = 0, key = '') {
  if (depth > 12) return '<truncated>';
  if (/authorization|proxy.?authorization|token|password|secret|api.?key|private.?key|signing.?key|cookie|credential/i.test(key)) return '<redacted>';
  if (typeof value === 'string') {
    if (PRIVATE_KEY_MATERIAL.test(value)) return '<redacted>';
    return redactSensitiveText(value, { maxLength: 4096 });
  }
  if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry, depth + 1, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [
    entryKey,
    redactEvidence(entry, depth + 1, entryKey),
  ]));
}

function ensurePhysicalDirectory(directory) {
  const resolved = path.resolve(directory);
  const missing = [];
  let existing = resolved;
  while (true) {
    try {
      const stat = fs.lstatSync(existing);
      if (stat.isSymbolicLink()) throw new Error(`physical path rejects symlink '${existing}'`);
      if (!stat.isDirectory()) throw new Error(`physical path component is not a directory '${existing}'`);
      break;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  let current = existing;
  for (const name of missing) {
    current = path.join(current, name);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`physical path rejects symlink '${current}'`);
    if (!stat.isDirectory()) throw new Error(`physical path component is not a directory '${current}'`);
  }
  return fs.realpathSync(resolved);
}

function assertPhysicalContainment(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`physical root is not a directory '${resolvedRoot}'`);
  }
  if (fs.realpathSync(resolvedRoot) !== resolvedRoot) {
    throw new Error(`physical root containment changed for '${resolvedRoot}'`);
  }
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`path '${resolvedTarget}' is outside physical root '${resolvedRoot}'`);
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  const parts = relative ? relative.split(path.sep) : [];
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`physical path rejects symlink '${current}'`);
      if (current !== resolvedTarget && !stat.isDirectory()) {
        throw new Error(`physical path component is not a directory '${current}'`);
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') break;
      throw error;
    }
  }
  return resolvedTarget;
}

function writeImmutable(file, content, { physicalRoot = null } = {}) {
  if (physicalRoot) assertPhysicalContainment(physicalRoot, file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (physicalRoot) assertPhysicalContainment(physicalRoot, path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temporary, file);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const conflict = new Error(`harness receipt: refusing to overwrite '${path.basename(file)}'`);
      conflict.code = 'EEXIST';
      throw conflict;
    }
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* already cleaned */ }
  }
  const directoryFd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
}

function replayJsonSequence({
  directory,
  includeName = () => true,
  expectedName = null,
  initialChain = null,
  validateRecord = null,
  payloadForDigest,
  digestForPayload,
  storedDigest = null,
  previousChain = null,
  chainFor = (_previous, digest) => digest,
  storedChain,
  onRecord = () => {},
  onIssue = () => {},
}) {
  const names = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(includeName).sort()
    : [];
  const records = [];
  let chainDigest = initialChain;
  names.forEach((name, index) => {
    const sequence = index + 1;
    const file = path.join(directory, name);
    const report = (issue) => onIssue({ sequence, name, file, ...issue });
    if (expectedName && name !== expectedName(sequence)) report({ type: 'ORDER' });
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      report({ type: 'UNREADABLE', error });
      return;
    }
    if (validateRecord) validateRecord(record, { sequence, name, file, previousChain: chainDigest, report });
    const digest = digestForPayload(payloadForDigest(record));
    if (storedDigest && storedDigest(record) !== digest) report({ type: 'DIGEST', digest });
    if (previousChain && previousChain(record) !== chainDigest) report({ type: 'PREVIOUS_CHAIN', digest });
    const computedChain = chainFor(chainDigest, digest, record);
    const persistedChain = storedChain(record);
    if (persistedChain !== computedChain) report({ type: 'CHAIN', digest, computedChain });
    chainDigest = persistedChain;
    records.push(record);
    onRecord(record, { sequence, name, file, digest, computedChain });
  });
  return {
    files: names.map((name) => path.join(directory, name)),
    records,
    recordCount: names.length,
    chainDigest,
  };
}

function readFileLease(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, value: null };
    throw error;
  }
  return { exists: true, value: Number.parseInt(bytes.trim(), 10) };
}

function acquireProcessLock({
  file,
  pid = process.pid,
  isProcessAlive = (owner) => {
    try {
      process.kill(owner, 0);
      return true;
    } catch (error) {
      if (error && error.code === 'ESRCH') return false;
      throw error;
    }
  },
  attempts = 3,
  conflictError = () => new Error('file lease is already active'),
  unavailableError = () => new Error('file lease could not be acquired'),
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      writeImmutable(file, `${pid}\n`);
      return true;
    } catch (error) {
      if (!error || (error.code !== 'EEXIST' && !/refusing to overwrite/.test(error.message))) throw error;
    }
    const current = readFileLease(file);
    if (!current.exists) continue;
    if (!Number.isInteger(current.value) || current.value <= 0 || current.value === pid
      || isProcessAlive(current.value)) throw conflictError();
    const stalePath = `${file}.stale.${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.renameSync(file, stalePath);
      fs.unlinkSync(stalePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  throw unavailableError();
}

function releaseProcessLock({
  file,
  pid = process.pid,
  missingIsSuccess = false,
  ownershipError = () => new Error('file lease ownership does not match'),
}) {
  const current = readFileLease(file);
  if (!current.exists) {
    if (missingIsSuccess) return false;
    throw ownershipError();
  }
  if (current.value !== pid) throw ownershipError();
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
    if (missingIsSuccess) return false;
    throw ownershipError();
  }
  return true;
}

function leaseJournalState({
  directory,
  decode,
  generationFor,
  tokenFor,
  matches,
  invalidError,
  physicalRoot = null,
}) {
  const claimsDirectory = path.join(directory, 'claims');
  if (physicalRoot) assertPhysicalContainment(physicalRoot, claimsDirectory);
  const names = fs.existsSync(claimsDirectory) ? fs.readdirSync(claimsDirectory).sort() : [];
  const claims = names.map((name, index) => {
    const generation = index + 1;
    if (name !== `${String(generation).padStart(12, '0')}.json`) throw invalidError();
    const claimPath = path.join(claimsDirectory, name);
    if (physicalRoot) assertPhysicalContainment(physicalRoot, claimPath);
    const value = decode(fs.readFileSync(claimPath, 'utf8'));
    if (generationFor(value) !== generation || typeof tokenFor(value) !== 'string') throw invalidError();
    return value;
  });
  const current = claims.length > 0 ? claims[claims.length - 1] : null;
  if (!current) return { claims, current: null, released: false };
  const releasePath = path.join(directory, 'releases', `${sha256(tokenFor(current))}.json`);
  if (physicalRoot) assertPhysicalContainment(physicalRoot, releasePath);
  if (!fs.existsSync(releasePath)) return { claims, current, released: false };
  const released = decode(fs.readFileSync(releasePath, 'utf8'));
  if (!matches(current, released)) throw invalidError();
  return { claims, current, released: true };
}

function acquireLeaseJournal({
  directory,
  create,
  encode,
  decode,
  generationFor,
  tokenFor,
  isStale,
  matches,
  attempts = 3,
  conflictError = () => new Error('lease journal has an active owner'),
  unavailableError = () => new Error('lease journal could not be acquired'),
  invalidError = conflictError,
  physicalRoot = null,
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = leaseJournalState({
      directory, decode, generationFor, tokenFor, matches, invalidError, physicalRoot,
    });
    if (state.current && !state.released && !isStale(state.current)) throw conflictError();
    const generation = state.claims.length + 1;
    const candidate = create(generation);
    if (generationFor(candidate) !== generation || typeof tokenFor(candidate) !== 'string') throw invalidError();
    const claimPath = path.join(directory, 'claims', `${String(generation).padStart(12, '0')}.json`);
    try {
      writeImmutable(claimPath, encode(candidate), { physicalRoot });
      return candidate;
    } catch (error) {
      if (!error || (error.code !== 'EEXIST' && !/refusing to overwrite/.test(error.message))) throw error;
    }
  }
  throw unavailableError();
}

function releaseLeaseJournal({
  directory,
  expected,
  encode,
  decode,
  generationFor,
  tokenFor,
  matches,
  ownershipError = () => new Error('lease journal ownership does not match'),
  invalidError = ownershipError,
  physicalRoot = null,
}) {
  const state = leaseJournalState({
    directory, decode, generationFor, tokenFor, matches, invalidError, physicalRoot,
  });
  if (!state.current || state.released || !matches(expected, state.current)) throw ownershipError();
  const releasePath = path.join(directory, 'releases', `${sha256(tokenFor(state.current))}.json`);
  try {
    writeImmutable(releasePath, encode(state.current), { physicalRoot });
  } catch (error) {
    if (!error || (error.code !== 'EEXIST' && !/refusing to overwrite/.test(error.message))) throw error;
    const released = decode(fs.readFileSync(releasePath, 'utf8'));
    if (!matches(state.current, released)) throw ownershipError();
  }
  return true;
}

function assertLeaseJournalOwnership({
  directory,
  expected,
  decode,
  generationFor,
  tokenFor,
  matches,
  isStale = () => false,
  ownershipError = () => new Error('lease journal ownership does not match'),
  invalidError = ownershipError,
  physicalRoot = null,
}) {
  const state = leaseJournalState({
    directory, decode, generationFor, tokenFor, matches, invalidError, physicalRoot,
  });
  if (!state.current || state.released || isStale(state.current)
    || !matches(expected, state.current)) throw ownershipError();
  return true;
}

function resolveGitTree(root, commit) {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: git root is required');
  if (!COMMIT.test(commit)) throw new Error('harness receipt: source commit must be a 40-character SHA');
  try {
    const tree = execFileSync('git', ['rev-parse', '--verify', `${commit}^{tree}`], { cwd: root, encoding: 'utf8' }).trim();
    if (!TREE.test(tree)) throw new Error('resolved source tree is not a 40-character SHA');
    return tree.toLowerCase();
  } catch (error) {
    throw new Error(`harness receipt: cannot resolve source tree: ${error.message}`);
  }
}

function resolveGitCommit(root, revision = 'HEAD') {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: git root is required');
  if (typeof revision !== 'string' || !revision.trim()) throw new Error('harness receipt: git revision is required');
  try {
    const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    if (!COMMIT.test(commit)) throw new Error('resolved source commit is not a 40-character SHA');
    return commit.toLowerCase();
  } catch (error) {
    throw new Error(`harness receipt: cannot resolve source commit: ${error.message}`);
  }
}

function resolveGitBinding(root, revision = 'HEAD') {
  const commit = resolveGitCommit(root, revision);
  return { sourceCommit: commit, sourceTree: resolveGitTree(root, commit) };
}

function resolveGitWorktree(root) {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: git root is required');
  try {
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
    });
    return status.trim().length === 0 ? 'CLEAN' : 'DIRTY';
  } catch (error) {
    throw new Error(`harness receipt: cannot resolve worktree status: ${error.message}`);
  }
}

function validateGitBinding(root, sourceCommit, sourceTree, {
  expectedSourceCommit = null,
  expectedSourceTree = null,
} = {}) {
  const errors = [];
  if (!COMMIT.test(sourceCommit)) errors.push('source commit is not a valid SHA');
  if (!TREE.test(sourceTree)) errors.push('source tree is not a valid SHA');
  if (expectedSourceCommit !== null && expectedSourceCommit !== undefined) {
    if (!COMMIT.test(expectedSourceCommit)) errors.push('expected source commit is not a valid SHA');
    else if (String(sourceCommit).toLowerCase() !== expectedSourceCommit.toLowerCase()) {
      errors.push('source commit does not match expected checkout');
    }
  }
  if (expectedSourceTree !== null && expectedSourceTree !== undefined) {
    if (!TREE.test(expectedSourceTree)) errors.push('expected source tree is not a valid SHA');
    else if (String(sourceTree).toLowerCase() !== expectedSourceTree.toLowerCase()) {
      errors.push('source tree does not match expected checkout');
    }
  }
  if (errors.length === 0 && root) {
    try {
      const current = resolveGitBinding(root);
      if (current.sourceCommit.toLowerCase() !== String(sourceCommit).toLowerCase()) errors.push('source commit does not match current checkout');
      if (current.sourceTree.toLowerCase() !== String(sourceTree).toLowerCase()) errors.push('source tree does not match current checkout');
      const resolved = resolveGitTree(root, sourceCommit);
      if (resolved.toLowerCase() !== sourceTree.toLowerCase()) errors.push('source tree does not match source commit');
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateRollbackOwnership(target, candidate) {
  const errors = [];
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, errors: ['rollback target identity is required'] };
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, errors: ['rollback candidate identity is required'] };
  }
  for (const field of ['surface', 'sourceCommit', 'sourceTree', 'planFingerprint', 'artifactFingerprint']) {
    if (target[field] === undefined || target[field] === null || target[field] === '') {
      errors.push(`rollback target is missing ${field}`);
    }
  }
  if (target.sourceCommit !== undefined && !COMMIT.test(target.sourceCommit)) errors.push('rollback target source commit is invalid');
  if (target.sourceTree !== undefined && !TREE.test(target.sourceTree)) errors.push('rollback target source tree is invalid');
  for (const field of ['planFingerprint', 'artifactFingerprint']) {
    if (target[field] !== undefined && !isFingerprint(target[field])) errors.push(`rollback target ${field} is invalid`);
  }
  const identity = ROLLBACK_FIELDS.reduce((result, field) => {
    if (target[field] !== undefined && target[field] !== null) result[field] = target[field];
    return result;
  }, {});
  errors.push(...compareIdentity(identity, candidate).errors.map((error) => `rollback ownership: ${error}`));
  return { ok: errors.length === 0, errors };
}

function assertRollbackOwnership(target, candidate) {
  const checked = validateRollbackOwnership(target, candidate);
  if (!checked.ok) throw new Error(`rollback ownership check failed: ${checked.errors.join('; ')}`);
  return true;
}

module.exports = {
  SHA256,
  COMMIT,
  TREE,
  SAFE_ID,
  FINGERPRINT,
  ROLLBACK_FIELDS,
  sha256,
  canonicalJson,
  isFingerprint,
  compareIdentity,
  validateIdentity,
  fingerprintForBytes,
  fingerprintDirectory,
  revalidateBytes,
  redact,
  redactEvidence,
  ensurePhysicalDirectory,
  assertPhysicalContainment,
  writeImmutable,
  replayJsonSequence,
  acquireProcessLock,
  releaseProcessLock,
  acquireLeaseJournal,
  releaseLeaseJournal,
  assertLeaseJournalOwnership,
  resolveGitTree,
  resolveGitCommit,
  resolveGitBinding,
  resolveGitWorktree,
  validateGitBinding,
  validateRollbackOwnership,
  assertRollbackOwnership,
};
