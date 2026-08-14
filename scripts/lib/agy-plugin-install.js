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
const { createTraversalBudget, readFileBounded, readDirectoryEntries } = require('./bounded-filesystem');

const SURFACE = 'agy-plugin';
const PACKAGE_METADATA = new Set(['plugin.json', 'provenance.json', 'fingerprints.json']);
const DIAGNOSTIC_SCHEMA = 'dhpk.agy-install-plan.v1';
const DIFF_PREVIEW_LIMIT = 20;

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

function assertExistingPhysicalAncestors(directory, label) {
  let current = path.resolve(directory);
  while (true) {
    const stat = lstatOrNull(current);
    if (stat) {
      if (stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
      if (!stat.isDirectory()) throw new Error(`${label} ancestor must be a directory: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function relativeFiles(root, options = {}) {
  const files = [];
  const budget = createTraversalBudget(options);
  const walk = (directory, depth) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget, sort: true, localeSort: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in AGY installation: ${child}`);
        if (entry.isDirectory()) walk(child, depth + 1);
        else if (entry.isFile()) files.push(path.relative(root, child).split(path.sep).join('/'));
        else throw new Error(`unsupported AGY installation entry: ${child}`);
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(root, 0);
  return files.sort();
}

function copyTreePreservingEntries(sourceRoot, destinationRoot, directoryModes) {
  const budget = createTraversalBudget();
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
      for (const entry of readDirectoryEntries(source, { budget, sort: true, localeSort: true })) {
        copyEntry(path.join(source, entry.name), path.join(destination, entry.name));
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`unsupported AGY staging entry: ${source}`);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode & 0o7777);
  };

  for (const entry of readDirectoryEntries(sourceRoot, { budget, sort: true, localeSort: true })) {
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
  try { receipt = JSON.parse(readFileBounded(receiptPath).toString('utf8')); } catch (error) { throw new Error(`AGY target receipt is invalid JSON: ${error.message}`); }
  const checked = validateSurfaceReceipt({ ...receipt, schema: 'dhpk.platform-provenance.v1' }, SURFACE);
  if (!checked.ok || receipt.schema !== 'dhpk.agy-plugin.v1') throw new Error(`AGY target receipt is not owned by dhpk: ${checked.errors.join('; ')}`);
  return receipt;
}

function readJsonFile(root, relative, label) {
  const target = assertPhysicalPath(root, path.join(root, relative), label);
  const stat = lstatOrNull(target);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} is not a regular file: ${relative}`);
  try {
    return JSON.parse(readFileBounded(target).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function sourceFileDigests(sourceRoot, sourceFiles, budget = createTraversalBudget()) {
  const files = {};
  for (const relative of sourceFiles) {
    const source = assertPhysicalPath(sourceRoot, path.join(sourceRoot, relative), 'AGY source path');
    const stat = lstatOrNull(source);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`AGY source file is not a regular file: ${relative}`);
    }
    files[relative] = digest(budget.readFile(source, stat, `AGY source path: ${relative}`));
  }
  return files;
}

function preview(values) {
  return values.slice(0, DIFF_PREVIEW_LIMIT);
}

function compareSourceInventory(sourceRoot, targetRoot, sourceFiles, sourceDigests, budget = createTraversalBudget()) {
  const same = [];
  const changed = [];
  const missing = [];
  const unsafe = [];
  for (const relative of sourceFiles) {
    let target;
    try {
      target = assertPhysicalPath(targetRoot, path.join(targetRoot, relative), 'AGY target path');
    } catch (error) {
      unsafe.push(relative);
      changed.push(relative);
      continue;
    }
    const stat = lstatOrNull(target);
    if (!stat) {
      missing.push(relative);
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      changed.push(relative);
      continue;
    }
    if (digest(budget.readFile(target, stat, `AGY target path: ${relative}`)) === sourceDigests[relative]) same.push(relative);
    else changed.push(relative);
  }
  return {
    counts: { same: same.length, changed: changed.length, missing: missing.length },
    changed_preview: preview(changed),
    missing_preview: preview(missing),
    unsafe_preview: preview(unsafe),
    preview_limit: DIFF_PREVIEW_LIMIT,
  };
}

function inspectAgyPlugin({ sourceRoot, targetRoot } = {}) {
  if (!sourceRoot || !targetRoot) throw new Error('sourceRoot and targetRoot are required');
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (isInside(source, target) || isInside(target, source)) {
    throw new Error('AGY source and target roots must be independent directories');
  }
  const checked = validateAgyPluginPackage(source);
  if (!checked.ok) throw new Error(`AGY source package is invalid: ${checked.errors.join('; ')}`);
  assertExistingPhysicalAncestors(path.dirname(target), 'AGY target');

  const sourceManifest = readJsonFile(source, 'plugin.json', 'AGY source manifest');
  const sourceFiles = relativeFiles(source);
  const sourceDigests = sourceFileDigests(source, sourceFiles);
  const sourceFingerprint = digest(JSON.stringify(sourceDigests));
  const sourceReport = {
    version: sourceManifest && sourceManifest.version,
    fingerprint: sourceFingerprint,
    file_count: sourceFiles.length,
  };
  const targetStat = lstatOrNull(target);
  const baseTarget = {
    root: target,
    exists: Boolean(targetStat),
    git_marker: { present: false, physical: false },
    manifest: { present: false, valid: false },
    receipt: { present: false, valid: false },
  };
  if (!targetStat) {
    return {
      schema: DIAGNOSTIC_SCHEMA,
      status: 'PASS',
      state: 'READY',
      classification: 'ABSENT',
      source: sourceReport,
      target: baseTarget,
      diff: { counts: { same: 0, changed: 0, missing: sourceFiles.length }, changed_preview: [], missing_preview: preview(sourceFiles), unsafe_preview: [], preview_limit: DIFF_PREVIEW_LIMIT },
      next_action: 'run install-agy-plugin.js install after reviewing the source package',
      mutation: { performed: false },
    };
  }
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    return {
      schema: DIAGNOSTIC_SCHEMA,
      status: 'BLOCKED',
      state: 'BLOCKED',
      classification: 'UNSAFE_TARGET',
      source: sourceReport,
      target: { ...baseTarget, error: 'AGY target root must be a physical directory' },
      diff: { counts: { same: 0, changed: 0, missing: sourceFiles.length }, changed_preview: [], missing_preview: preview(sourceFiles), unsafe_preview: [], preview_limit: DIFF_PREVIEW_LIMIT },
      next_action: 'owner must inspect and replace the unsafe target root before installation',
      mutation: { performed: false },
    };
  }

  const gitMarker = lstatOrNull(path.join(target, '.git'));
  baseTarget.git_marker = {
    present: Boolean(gitMarker),
    physical: Boolean(gitMarker && !gitMarker.isSymbolicLink()),
  };
  try {
    const manifest = readJsonFile(target, 'plugin.json', 'AGY target manifest');
    baseTarget.manifest = {
      present: Boolean(manifest),
      valid: Boolean(manifest && typeof manifest === 'object'),
      name: manifest && manifest.name,
      version: manifest && manifest.version,
    };
  } catch (error) {
    baseTarget.manifest = { present: true, valid: false, error: error.message };
  }
  try {
    const receipt = readReceipt(target);
    baseTarget.receipt = {
      present: Boolean(lstatOrNull(path.join(target, 'provenance.json'))),
      valid: Boolean(receipt),
      schema: receipt && receipt.schema,
      source_version: receipt && receipt.sourceVersion,
    };
  } catch (error) {
    baseTarget.receipt = {
      present: Boolean(lstatOrNull(path.join(target, 'provenance.json'))),
      valid: false,
      error: error.message,
    };
  }
  const diff = compareSourceInventory(source, target, sourceFiles, sourceDigests);
  let classification = 'AGY_OWNED';
  let state = 'CURRENT';
  let status = 'PASS';
  let nextAction = null;
  if (baseTarget.git_marker.present && !baseTarget.git_marker.physical) {
    classification = 'UNSAFE_TARGET';
    state = 'BLOCKED';
    status = 'BLOCKED';
    nextAction = 'owner must inspect and replace the symlinked .git marker before installation';
  } else if (baseTarget.git_marker.present && !baseTarget.receipt.valid) {
    classification = 'FOREIGN_CHECKOUT';
    state = 'BLOCKED';
    status = 'BLOCKED';
    nextAction = 'owner must independently back up, move, or retire the foreign checkout, then run a clean AGY install';
  } else if (!baseTarget.receipt.valid) {
    classification = 'UNOWNED_TARGET';
    state = 'BLOCKED';
    status = 'BLOCKED';
    nextAction = 'owner must independently back up, move, or retire the unowned target, then run a clean AGY install';
  } else if (diff.counts.changed || diff.counts.missing || diff.unsafe_preview.length) {
    classification = diff.unsafe_preview.length ? 'UNSAFE_TARGET' : 'OWNED_CHANGED';
    state = 'BLOCKED';
    status = 'BLOCKED';
    nextAction = 'owner must review changed target files and receipt ownership before running AGY update';
  }
  return {
    schema: DIAGNOSTIC_SCHEMA,
    status,
    state,
    classification,
    source: sourceReport,
    target: baseTarget,
    diff,
    next_action: nextAction,
    mutation: { performed: false },
  };
}

function ownedFileMatches(root, relative, receipt) {
  const target = assertPhysicalPath(root, path.join(root, relative), 'AGY target path');
  const stat = lstatOrNull(target);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`AGY owned path is not a regular file: ${relative}`);
  return Boolean(receipt.fingerprints && receipt.fingerprints[relative])
    && digest(readFileBounded(target)) === receipt.fingerprints[relative];
}

function metadataMatches(root, relative, receipt) {
  if (!PACKAGE_METADATA.has(relative)) return false;
  const target = assertPhysicalPath(root, path.join(root, relative), 'AGY metadata path');
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  if (relative === 'provenance.json') {
    return readFileBounded(target).toString('utf8') === `${JSON.stringify(receipt)}\n`;
  }
  if (relative !== 'fingerprints.json') return false;
  return readFileBounded(target).toString('utf8') === `${JSON.stringify({ files: receipt.fingerprints || {}, schema: PACKAGE_SCHEMA })}\n`;
}

function removeEmptyDirectories(root) {
  const directories = [];
  const budget = createTraversalBudget();
  const walk = (directory, depth) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          walk(child, depth + 1);
          directories.push(child);
        }
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(root, 0);
  for (const directory of directories.sort((a, b) => b.length - a.length)) {
    if (readDirectoryEntries(directory).length === 0) fs.rmdirSync(directory);
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
  inspectAgyPlugin,
  sourceFileDigests,
  compareSourceInventory,
  installAgyPlugin,
  rollbackAgyPlugin,
  uninstallAgyPlugin,
};
