'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_READ_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const PRIVATE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const STABLE_STAT_FIELDS = Object.freeze([
  'mode',
  'nlink',
  'uid',
  'gid',
  'size',
  'mtimeMs',
  'ctimeMs',
]);
const STABLE_IDENTITY_FIELDS = Object.freeze(['mode', 'nlink', 'uid', 'gid']);

const securityError = (message) => {
  const error = new Error(message);
  error.code = 'ESECURITY';
  return error;
};

const statValue = (stat, field) => String(stat[field]);

const sameIdentity = (left, right) => Boolean(left && right)
  && statValue(left, 'dev') === statValue(right, 'dev')
  && statValue(left, 'ino') === statValue(right, 'ino');

const sameStableStats = (left, right, fields = STABLE_STAT_FIELDS) => sameIdentity(left, right)
  && fields.every((field) => statValue(left, field) === statValue(right, field));

const samePathSnapshot = (left, right) => Boolean(left && right)
  && left.entries.length === right.entries.length
  && left.entries.every((entry, index) => entry.path === right.entries[index].path
    // Directory size and timestamps legitimately change when an immutable
    // temporary or final entry is created.  Ancestor binding therefore uses
    // identity and security-relevant metadata; regular-file data stability is
    // checked separately by the descriptor read/write paths.
    && sameStableStats(entry.stat, right.entries[index].stat, STABLE_IDENTITY_FIELDS));

const resolvedPath = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw securityError(`${name} is required`);
  }
  return path.resolve(value);
};

const assertRoot = (root) => {
  const resolvedRoot = resolvedPath(root, 'physical root');
  let stat;
  try {
    stat = fs.lstatSync(resolvedRoot);
  } catch (_) {
    throw securityError('physical root is unavailable');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw securityError('physical root is not a directory');
  }
  try {
    if (fs.realpathSync(resolvedRoot) !== resolvedRoot) {
      throw securityError('physical root resolves through a symlink');
    }
  } catch (error) {
    if (error && error.code === 'ESECURITY') throw error;
    throw securityError('physical root is unavailable');
  }
  return resolvedRoot;
};

const assertInside = (root, target) => {
  const resolvedRoot = assertRoot(root);
  const resolvedTarget = resolvedPath(target, 'physical path');
  if (resolvedTarget !== resolvedRoot
    && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw securityError('physical path is outside the configured root');
  }
  return { root: resolvedRoot, target: resolvedTarget };
};

const capturePhysicalPath = (root, target, { allowMissingFinal = false } = {}) => {
  const { root: resolvedRoot, target: resolvedTarget } = assertInside(root, target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  const segments = relative ? relative.split(path.sep) : [];
  const entries = [];
  let current = resolvedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT'
        && allowMissingFinal && index === segments.length - 1) break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw securityError('physical path rejects a symlink');
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw securityError('physical path component is not a directory');
    }
    entries.push({ path: current, stat });
  }
  return {
    root: resolvedRoot,
    target: resolvedTarget,
    parent: path.dirname(resolvedTarget),
    entries,
  };
};

const assertPhysicalContainment = (root, target, options = {}) => {
  capturePhysicalPath(root, target, options);
  return path.resolve(target);
};

const ensurePhysicalDirectory = (root, directory) => {
  const resolvedRoot = assertRoot(root);
  const resolvedDirectory = assertInside(resolvedRoot, directory).target;
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  const segments = relative ? relative.split(path.sep) : [];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      try {
        fs.mkdirSync(current, { mode: DIRECTORY_MODE });
      } catch (mkdirError) {
        if (!mkdirError || mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw securityError('physical directory component is invalid');
    }
    try { fs.chmodSync(current, DIRECTORY_MODE); } catch (_) {
      throw securityError('physical directory permissions are unavailable');
    }
  }
  capturePhysicalPath(resolvedRoot, resolvedDirectory);
  return resolvedDirectory;
};

const assertPrivateRegular = (stat, maxBytes = null) => {
  if (!stat || stat.isSymbolicLink() || !stat.isFile()
    || (stat.mode & 0o777) !== PRIVATE_MODE
    || !Number.isSafeInteger(Number(stat.size)) || Number(stat.size) < 0
    || (maxBytes !== null && Number(stat.size) > maxBytes)) {
    throw securityError('physical file is not a bounded private regular file');
  }
};

const requiredReadFlags = () => {
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  if (!Number.isSafeInteger(noFollow) || noFollow === 0
    || !Number.isSafeInteger(nonBlock) || nonBlock === 0) {
    throw securityError('physical reads require O_NOFOLLOW and O_NONBLOCK');
  }
  return fs.constants.O_RDONLY | noFollow | nonBlock;
};

const readPhysicalFile = (root, file, maxBytes = DEFAULT_READ_BYTES) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw securityError('physical read limit is invalid');
  }
  const beforePath = capturePhysicalPath(root, file);
  assertPrivateRegular(beforePath.entries[beforePath.entries.length - 1].stat, maxBytes);
  const flags = requiredReadFlags();
  let descriptor;
  try {
    descriptor = fs.openSync(beforePath.target, flags);
    const before = fs.fstatSync(descriptor);
    assertPrivateRegular(before, maxBytes);
    if (!sameIdentity(before, beforePath.entries[beforePath.entries.length - 1].stat)) {
      throw securityError('physical file identity changed while opening');
    }
    const afterOpenPath = capturePhysicalPath(root, file);
    if (!samePathSnapshot(beforePath, afterOpenPath)
      || !sameStableStats(
        beforePath.entries[beforePath.entries.length - 1].stat,
        afterOpenPath.entries[afterOpenPath.entries.length - 1].stat,
      )) {
      throw securityError('physical path identity changed while opening');
    }
    const expectedSize = Number(before.size);
    const chunks = [];
    let position = 0;
    while (position < expectedSize) {
      const length = Math.min(READ_CHUNK_BYTES, expectedSize - position);
      const chunk = Buffer.alloc(length);
      const count = fs.readSync(descriptor, chunk, 0, length, position);
      if (count !== length) throw securityError('physical file changed while reading');
      chunks.push(chunk);
      position += count;
    }
    const after = fs.fstatSync(descriptor);
    assertPrivateRegular(after, maxBytes);
    if (!sameStableStats(before, after)) throw securityError('physical file changed while reading');
    const afterReadPath = capturePhysicalPath(root, file);
    if (!samePathSnapshot(beforePath, afterReadPath)
      || !sameStableStats(
        beforePath.entries[beforePath.entries.length - 1].stat,
        afterReadPath.entries[afterReadPath.entries.length - 1].stat,
      )) {
      throw securityError('physical path identity changed while reading');
    }
    return Buffer.concat(chunks, expectedSize);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) { /* preserve the bounded read failure */ }
    }
  }
};

const privateTempPath = (file) => `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;

const assertWriteState = ({
  root,
  parent,
  parentSnapshot,
  temporary,
  descriptor,
  temporaryIdentity,
  expectedSize,
}) => {
  const currentParent = capturePhysicalPath(root, parent);
  if (!samePathSnapshot(parentSnapshot, currentParent)) {
    throw securityError('physical parent identity changed');
  }
  const temporaryPath = capturePhysicalPath(root, temporary);
  const temporaryStat = temporaryPath.entries[temporaryPath.entries.length - 1].stat;
  assertPrivateRegular(temporaryStat);
  if (!sameIdentity(temporaryIdentity, temporaryStat)) {
    throw securityError('physical temporary file identity changed');
  }
  const descriptorStat = fs.fstatSync(descriptor);
  assertPrivateRegular(descriptorStat);
  if (!sameIdentity(temporaryIdentity, descriptorStat)
    || Number(descriptorStat.size) !== expectedSize
    || !STABLE_IDENTITY_FIELDS.every((field) => statValue(temporaryStat, field) === statValue(descriptorStat, field))) {
    throw securityError('physical temporary file changed');
  }
  return { parent: currentParent, temporary: temporaryPath, descriptor: descriptorStat };
};

const cleanupTemporary = ({
  root,
  parent,
  parentSnapshot,
  temporary,
  temporaryIdentity,
  allowEmptyExternalCleanup = false,
}) => {
  if (!temporaryIdentity) return;
  let currentParent;
  try {
    currentParent = capturePhysicalPath(root, parent);
  } catch (_) {
    if (allowEmptyExternalCleanup) {
      try {
        const external = fs.lstatSync(temporary);
        if (sameIdentity(temporaryIdentity, external)
          && external.isFile()
          && (external.mode & 0o777) === PRIVATE_MODE
          && Number(external.size) === 0
          && Number(external.nlink) === 1) {
          fs.unlinkSync(temporary);
        }
      } catch (_) { /* identity-guarded best effort for an empty temp only */ }
    }
    return;
  }
  if (!samePathSnapshot(parentSnapshot, currentParent)) return;
  let temporaryPath;
  try {
    temporaryPath = capturePhysicalPath(root, temporary);
  } catch (_) {
    return;
  }
  const stat = temporaryPath.entries[temporaryPath.entries.length - 1].stat;
  if (!sameIdentity(temporaryIdentity, stat)) return;
  try { fs.unlinkSync(temporary); } catch (_) { /* best-effort identity-guarded cleanup */ }
};

const syncDirectory = (root, parent, parentSnapshot) => {
  const before = capturePhysicalPath(root, parent);
  if (!samePathSnapshot(parentSnapshot, before)) throw securityError('physical parent identity changed');
  let descriptor;
  try {
    descriptor = fs.openSync(parent, fs.constants.O_RDONLY);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isDirectory() || !sameIdentity(opened, before.entries[before.entries.length - 1].stat)) {
      throw securityError('physical parent identity changed');
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameStableStats(opened, after, STABLE_STAT_FIELDS)) {
      throw securityError('physical parent changed while syncing');
    }
    const afterPath = capturePhysicalPath(root, parent);
    if (!samePathSnapshot(before, afterPath)) throw securityError('physical parent changed while syncing');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) { /* preserve the sync failure */ }
    }
  }
};

const writePhysicalImmutable = (root, file, content) => {
  const bytes = Buffer.isBuffer(content) || ArrayBuffer.isView(content)
    ? Buffer.from(content)
    : typeof content === 'string' ? Buffer.from(content, 'utf8') : null;
  if (!bytes) throw securityError('physical file content must be bytes or text');
  const resolvedRoot = assertRoot(root);
  const targetPath = assertInside(resolvedRoot, file).target;
  const parent = path.dirname(targetPath);
  ensurePhysicalDirectory(resolvedRoot, parent);
  const parentSnapshot = capturePhysicalPath(resolvedRoot, parent);
  capturePhysicalPath(resolvedRoot, targetPath, { allowMissingFinal: true });
  const temporary = privateTempPath(targetPath);
  let descriptor;
  let temporaryIdentity = null;
  let linked = false;
  let payloadStarted = false;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      PRIVATE_MODE,
    );
    const opened = fs.fstatSync(descriptor);
    assertPrivateRegular(opened);
    if (Number(opened.size) !== 0) throw securityError('physical temporary file is not empty-safe');
    temporaryIdentity = opened;
    // This is the last validation point before payload bytes are written.
    assertWriteState({
      root: resolvedRoot,
      parent,
      parentSnapshot,
      temporary,
      descriptor,
      temporaryIdentity,
      expectedSize: 0,
    });
    payloadStarted = true;
    let position = 0;
    while (position < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, position, bytes.length - position);
      if (!Number.isSafeInteger(count) || count <= 0) throw securityError('physical file write made no progress');
      position += count;
    }
    fs.fsyncSync(descriptor);
    assertWriteState({
      root: resolvedRoot,
      parent,
      parentSnapshot,
      temporary,
      descriptor,
      temporaryIdentity,
      expectedSize: bytes.length,
    });
    fs.closeSync(descriptor);
    descriptor = undefined;

    // Revalidate immediately before the exclusive link.  The same-UID
    // continuous-race limitation is documented by ADR-0018; this blocks a
    // static, persistent, or deterministic namespace swap.
    const beforeLink = capturePhysicalPath(resolvedRoot, parent);
    if (!samePathSnapshot(parentSnapshot, beforeLink)) throw securityError('physical parent identity changed');
    capturePhysicalPath(resolvedRoot, targetPath, { allowMissingFinal: true });
    try {
      fs.linkSync(temporary, targetPath);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        const conflict = new Error(`harness receipt: refusing to overwrite '${path.basename(targetPath)}'`);
        conflict.code = 'EEXIST';
        throw conflict;
      }
      throw error;
    }
    linked = true;
    const finalPath = capturePhysicalPath(resolvedRoot, targetPath);
    const finalStat = finalPath.entries[finalPath.entries.length - 1].stat;
    assertPrivateRegular(finalStat);
    if (!sameIdentity(finalStat, temporaryIdentity) || Number(finalStat.size) !== bytes.length) {
      throw securityError('physical final file identity changed');
    }
    if (!samePathSnapshot(parentSnapshot, capturePhysicalPath(resolvedRoot, parent))) {
      throw securityError('physical parent identity changed');
    }
    fs.unlinkSync(temporary);
    temporaryIdentity = null;
    syncDirectory(resolvedRoot, parent, parentSnapshot);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) { /* preserve the write failure */ }
    }
    if (!linked || temporaryIdentity) {
      cleanupTemporary({
        root: resolvedRoot,
        parent,
        parentSnapshot,
        temporary,
        temporaryIdentity,
        allowEmptyExternalCleanup: !payloadStarted,
      });
    }
  }
};

module.exports = {
  DEFAULT_READ_BYTES,
  DIRECTORY_MODE,
  PRIVATE_MODE,
  READ_CHUNK_BYTES,
  STABLE_STAT_FIELDS,
  sameIdentity,
  sameStableStats,
  capturePhysicalPath,
  assertPhysicalContainment,
  ensurePhysicalDirectory,
  readPhysicalFile,
  writePhysicalImmutable,
};
