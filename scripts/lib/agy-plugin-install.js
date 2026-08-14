'use strict';

// Receipt-owned installation for the native AGY package.  The installer is
// intentionally conservative: a target without a matching AGY receipt is
// foreign, and a changed owned file is a collision rather than an overwrite.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PACKAGE_SCHEMA, validateAgyPluginPackage } = require('./agy-plugin-package');
const { validateSurfaceReceipt } = require('./platform-provenance');

const SURFACE = 'agy-plugin';
const PACKAGE_METADATA = new Set(['plugin.json', 'provenance.json', 'fingerprints.json']);

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPhysicalPath(root, candidate, label) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  if (!isInside(rootPath, candidatePath)) throw new Error(`${label} escapes root: ${candidate}`);
  let current = candidatePath;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
    if (current === rootPath) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidatePath;
}

function ensurePhysicalDirectory(directory, label) {
  const resolved = path.resolve(directory);
  let current = resolved;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = lstatOrNull(resolved);
  if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${resolved}`);
  if (stat && !stat.isDirectory()) throw new Error(`${label} must be a directory: ${resolved}`);
  if (!stat) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function relativeFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in AGY installation: ${child}`);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(path.relative(root, child).split(path.sep).join('/'));
      else throw new Error(`unsupported AGY installation entry: ${child}`);
    }
  };
  walk(root);
  return files.sort();
}

function copyTreePreservingEntries(sourceRoot, destinationRoot, directoryModes) {
  const copyEntry = (source, destination) => {
    const stat = lstatOrNull(source);
    if (!stat) throw new Error(`AGY staging source disappeared: ${source}`);
    if (stat.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(source), destination);
      return;
    }
    if (stat.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      directoryModes.set(destination, stat.mode & 0o7777);
      for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        copyEntry(path.join(source, entry.name), path.join(destination, entry.name));
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`unsupported AGY staging entry: ${source}`);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode & 0o7777);
  };

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    copyEntry(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name));
  }
}

function makeStagingParentsWritable(root, candidate) {
  let current = path.dirname(candidate);
  while (isInside(root, current)) {
    const stat = lstatOrNull(current);
    if (!stat) {
      fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    } else {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`AGY staging parent is unsafe: ${current}`);
      fs.chmodSync(current, stat.mode | 0o700);
    }
    if (current === root) break;
    current = path.dirname(current);
  }
}

function removeStagedEntry(root, relative) {
  const target = assertPhysicalPath(root, path.join(root, relative), 'AGY staging path');
  const stat = lstatOrNull(target);
  if (!stat) return;
  if (stat.isSymbolicLink() || stat.isDirectory()) throw new Error(`AGY staging path is not a regular file: ${relative}`);
  if (!stat.isFile()) throw new Error(`unsupported AGY staging entry: ${relative}`);
  fs.unlinkSync(target);
}

function copySourceFileToStaging(sourceRoot, stagingRoot, relative) {
  const source = assertPhysicalPath(sourceRoot, path.join(sourceRoot, relative), 'AGY source path');
  const sourceStat = lstatOrNull(source);
  if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error(`AGY source file is not a regular file: ${relative}`);
  }
  const destination = assertPhysicalPath(stagingRoot, path.join(stagingRoot, relative), 'AGY staging path');
  makeStagingParentsWritable(stagingRoot, destination);
  removeStagedEntry(stagingRoot, relative);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, sourceStat.mode & 0o7777);
}

function restoreDirectoryModes(directoryModes) {
  for (const [directory, mode] of [...directoryModes.entries()].sort((left, right) => right[0].length - left[0].length)) {
    const stat = lstatOrNull(directory);
    if (stat && stat.isDirectory() && !stat.isSymbolicLink()) fs.chmodSync(directory, mode);
  }
}

function readReceipt(root) {
  const receiptPath = path.join(root, 'provenance.json');
  const receiptStat = lstatOrNull(receiptPath);
  if (!receiptStat) return null;
  if (receiptStat.isSymbolicLink() || !receiptStat.isFile()) throw new Error('AGY target receipt is not a regular file');
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch (error) { throw new Error(`AGY target receipt is invalid JSON: ${error.message}`); }
  const checked = validateSurfaceReceipt({ ...receipt, schema: 'dhpk.platform-provenance.v1' }, SURFACE);
  if (!checked.ok || receipt.schema !== 'dhpk.agy-plugin.v1') throw new Error(`AGY target receipt is not owned by dhpk: ${checked.errors.join('; ')}`);
  return receipt;
}

function ownedFileMatches(root, relative, receipt) {
  const target = assertPhysicalPath(root, path.join(root, relative), 'AGY target path');
  const stat = lstatOrNull(target);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`AGY owned path is not a regular file: ${relative}`);
  return Boolean(receipt.fingerprints && receipt.fingerprints[relative])
    && digest(fs.readFileSync(target)) === receipt.fingerprints[relative];
}

function metadataMatches(root, relative, receipt) {
  if (!PACKAGE_METADATA.has(relative)) return false;
  const target = assertPhysicalPath(root, path.join(root, relative), 'AGY metadata path');
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  if (relative === 'provenance.json') {
    return fs.readFileSync(target, 'utf8') === `${JSON.stringify(receipt)}\n`;
  }
  if (relative !== 'fingerprints.json') return false;
  return fs.readFileSync(target, 'utf8') === `${JSON.stringify({ files: receipt.fingerprints || {}, schema: PACKAGE_SCHEMA })}\n`;
}

function removeEmptyDirectories(root) {
  const directories = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(child);
        directories.push(child);
      }
    }
  };
  walk(root);
  for (const directory of directories.sort((a, b) => b.length - a.length)) {
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
}

function removeReceiptOwned(root, receipt) {
  const removed = [];
  const files = Object.keys(receipt.fingerprints || {}).sort();
  // Preflight every generated file and metadata before deleting anything so a
  // later collision cannot leave a partially rolled-back package.
  for (const relative of files) {
    if (!ownedFileMatches(root, relative, receipt)) throw new Error(`AGY rollback collision: ${relative} was changed outside the receipt`);
  }
  for (const relative of ['fingerprints.json', 'provenance.json']) {
    const target = assertPhysicalPath(root, path.join(root, relative), 'AGY rollback path');
    const stat = lstatOrNull(target);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`AGY rollback metadata is not a regular file: ${relative}`);
    if (!metadataMatches(root, relative, receipt)) throw new Error(`AGY rollback collision: ${relative} was changed outside the receipt`);
  }
  for (const relative of files) {
    fs.unlinkSync(path.join(root, relative));
    removed.push(relative);
  }
  for (const relative of ['fingerprints.json', 'provenance.json']) {
    const target = path.join(root, relative);
    const stat = lstatOrNull(target);
    if (!stat) continue;
    fs.unlinkSync(target);
    removed.push(relative);
  }
  removeEmptyDirectories(root);
  return removed.sort();
}

function resolveAgyInstallRoot(homeDirectory = os.homedir()) {
  if (typeof homeDirectory !== 'string' || homeDirectory.length === 0 || !path.isAbsolute(homeDirectory)) {
    throw new Error('homeDirectory must be an absolute path');
  }
  return path.join(homeDirectory, '.gemini', 'config', 'plugins', 'dhpk');
}

function installAgyPlugin({ sourceRoot, targetRoot, mode = 'update' } = {}) {
  if (!sourceRoot || !targetRoot) throw new Error('sourceRoot and targetRoot are required');
  if (!['install', 'update'].includes(mode)) throw new Error(`unsupported AGY install mode: ${mode}`);
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (isInside(source, target) || isInside(target, source)) {
    throw new Error('AGY source and target roots must be independent directories');
  }
  const checked = validateAgyPluginPackage(source);
  if (!checked.ok) throw new Error(`AGY source package is invalid: ${checked.errors.join('; ')}`);
  ensurePhysicalDirectory(path.dirname(target), 'AGY target parent');
  const targetStat = lstatOrNull(target);
  if (targetStat && (targetStat.isSymbolicLink() || !targetStat.isDirectory())) throw new Error(`AGY target root must be a physical directory: ${target}`);

  const existingReceipt = readReceipt(target);
  const sourceFiles = relativeFiles(source);
  const collisions = [];
  for (const relative of sourceFiles) {
    const destination = path.join(target, relative);
    const stat = lstatOrNull(destination);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      collisions.push(relative);
      continue;
    }
    if (!existingReceipt || ((relative === 'provenance.json' || relative === 'fingerprints.json')
      ? !metadataMatches(target, relative, existingReceipt)
      : (!existingReceipt.fingerprints || !Object.prototype.hasOwnProperty.call(existingReceipt.fingerprints, relative) || !ownedFileMatches(target, relative, existingReceipt)))) {
      collisions.push(relative);
    }
  }
  if (collisions.length > 0) throw new Error(`AGY installation collision with foreign or changed files: ${collisions.sort().join(', ')}`);

  const staleFiles = [];
  if (existingReceipt) {
    for (const relative of Object.keys(existingReceipt.fingerprints || {}).sort()) {
      if (sourceFiles.includes(relative)) continue;
      if (!ownedFileMatches(target, relative, existingReceipt)) throw new Error(`AGY update collision: stale owned file changed: ${relative}`);
      staleFiles.push(relative);
    }
  }

  // Build the complete next installation beside the target.  Nothing in the
  // live target is deleted or overwritten until every source copy and receipt
  // check has succeeded.  Foreign files (including foreign symlinks) are
  // copied as entries, never followed, so an update remains receipt-owned and
  // preserves user material.
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(target), `.agy-plugin-stage-${process.pid}-`));
  const directoryModes = new Map();
  const removed = [...staleFiles];
  let promoted = false;
  try {
    const targetMode = targetStat ? targetStat.mode & 0o7777 : 0o755;
    fs.chmodSync(stagingRoot, targetMode | 0o700);
    directoryModes.set(stagingRoot, targetMode);
    if (targetStat) copyTreePreservingEntries(target, stagingRoot, directoryModes);
    for (const relative of staleFiles) removeStagedEntry(stagingRoot, relative);
    for (const relative of sourceFiles) copySourceFileToStaging(source, stagingRoot, relative);
    removeEmptyDirectories(stagingRoot);
    restoreDirectoryModes(directoryModes);
    fs.chmodSync(stagingRoot, targetMode);

    const stagedReceipt = readReceipt(stagingRoot);
    if (!stagedReceipt) throw new Error('AGY staged installation has no owner receipt');
    const backup = targetStat ? path.join(path.dirname(target), `.agy-plugin-backup-${process.pid}-${Date.now()}`) : null;
    if (backup) {
      fs.renameSync(target, backup);
      try {
        fs.renameSync(stagingRoot, target);
      } catch (error) {
        fs.renameSync(backup, target);
        promoted = false;
        throw error;
      }
      promoted = true;
      fs.rmSync(backup, { recursive: true, force: true });
    } else {
      fs.renameSync(stagingRoot, target);
      promoted = true;
    }
    return {
      targetRoot: target,
      mode,
      installed: sourceFiles,
      removed: removed.sort(),
      previousReceipt: existingReceipt,
      receipt: stagedReceipt,
    };
  } finally {
    if (!promoted && lstatOrNull(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function rollbackAgyPlugin({ targetRoot, receipt = null } = {}) {
  if (!targetRoot) throw new Error('targetRoot is required');
  const target = path.resolve(targetRoot);
  const stat = lstatOrNull(target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`AGY target root is missing or unsafe: ${target}`);
  const current = readReceipt(target);
  if (!current) throw new Error('AGY target has no owner receipt');
  if (receipt && JSON.stringify(receipt.fingerprints || {}) !== JSON.stringify(current.fingerprints || {})) {
    throw new Error('AGY rollback receipt does not match the installed owner receipt');
  }
  const removed = removeReceiptOwned(target, current);
  return { targetRoot: target, removed, receipt: current };
}

function uninstallAgyPlugin(options = {}) {
  return rollbackAgyPlugin(options);
}

module.exports = {
  SURFACE,
  resolveAgyInstallRoot,
  installAgyPlugin,
  rollbackAgyPlugin,
  uninstallAgyPlugin,
};
