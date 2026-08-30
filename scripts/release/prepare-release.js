#!/usr/bin/env node
'use strict';

// One release preparation command: SemVer-validates a target version, checks
// (or deterministically writes) parity across every version-bearing manifest,
// the CHANGELOG.md release heading, and the bilingual AGY generator pin, and
// promotes changelog.d/ fragments.
// Preserves git-flow authority (RELEASE.md): preparation writes and rolls back
// on `develop` only and never merges, tags, or pushes — release-runner.sh still
// owns the commit/PR/tag mechanics once these files are correct. The read-only
// `check` mode may also attest the merged release target when publish-gate.js
// supplies DHPK_RELEASE_TARGET_BRANCH.
//
// Usage:
//   node scripts/release/prepare-release.js check --version X.Y.Z
//   node scripts/release/prepare-release.js write --version X.Y.Z --date YYYY-MM-DD [--summary "..."]
//   node scripts/release/prepare-release.js rollback --backup-reference <manifest>

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { SEMVER_PATTERN, MANIFEST_PATHS, AGY_GENERATOR_DOC_PATHS, checkParity, writeAgyGeneratorDocPins } = require('../lib/release-parity');
const { readFragments, validateFragments, promote } = require('../lib/changelog-fragments');
const { materializeNativePackage } = require('../lib/codex-native-package');
const { materializeAgentPluginPackage } = require('../lib/agent-plugin-package');
const { validateAgentPluginPackage } = require('../lib/agent-plugin-package');
const { materializeCursorPackage } = require('../lib/cursor-plugin-package');
const { validateCursorPackage } = require('../lib/cursor-plugin-package');
const { materializeAgyPluginPackage, validateAgyPluginPackage } = require('../lib/agy-plugin-package');
const { validateSurfaceReceipt, resolveGeneratedFromTree } = require('../lib/platform-provenance');

// The codex-native package (plugins/dhpk/.codex-plugin/plugin.json +
// provenance.json) is generated, derived output — not a hand-patchable
// manifest. `write` mode regenerates it wholesale via materializeNativePackage
// instead of field-patching, so skills/fingerprints/provenance never drift
// from the version bump that produced them.
const NATIVE_PACKAGE_PATHS = new Set([
  'plugins/dhpk/.codex-plugin/plugin.json',
  'plugins/dhpk/provenance.json',
  'plugins/dhpk-agent/plugin.json',
  'plugins/dhpk-agent/provenance.json',
  'plugins/dhpk-cursor/.cursor-plugin/plugin.json',
  'plugins/dhpk-cursor/provenance.json',
  'plugins/dhpk-agy/plugin.json',
  'plugins/dhpk-agy/provenance.json',
]);

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const REQUIRED_BRANCH = 'develop';

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'check' || arg === 'write' || arg === 'rollback') args.mode = arg;
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--summary') args.summary = argv[++i];
    else if (arg === '--operation-key') args.operationKey = argv[++i];
    else if (arg === '--backup-reference') args.backupReference = argv[++i];
    // Test-only override; production always prepares the plugin's own repo.
    else if (arg === '--repo-root') args.root = argv[++i];
    else {
      console.error(`prepare-release: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.mode) {
    console.error('usage: prepare-release.js <check|write|rollback> --version X.Y.Z [--date YYYY-MM-DD] [--summary "..."] [--operation-key <id>] [--backup-reference <manifest>] [--repo-root <path>]');
    process.exit(2);
  }
  return args;
}

function currentBranch(root) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function allowsPublishTargetCheck(args, branch) {
  const targetBranch = process.env.DHPK_RELEASE_TARGET_BRANCH;
  return args.mode === 'check' && Boolean(targetBranch) && branch === targetBranch;
}

function writeManifestVersion(root, relPath, version) {
  const abs = path.join(root, relPath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (relPath.endsWith('marketplace.json')) {
    const entry = (data.plugins || []).find((p) => p.name === 'dhpk');
    if (!entry) throw new Error(`${relPath}: no 'dhpk' plugin entry`);
    entry.version = version;
  } else {
    data.version = version;
  }
  fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
}

function lstatOrNull(candidate) {
  try { return fs.lstatSync(candidate); } catch (error) { return error && error.code === 'ENOENT' ? null : (() => { throw error; })(); }
}

function replaceStagedDirectory(staged, destination, label) {
  const parent = path.dirname(destination);
  const parentStat = lstatOrNull(parent);
  if (!parentStat || !parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error(`${label} destination parent is not a physical directory: ${parent}`);
  const existing = lstatOrNull(destination);
  if (existing && existing.isSymbolicLink()) throw new Error(`${label} destination must not be a symlink: ${destination}`);
  const backup = existing ? `${destination}.backup-${process.pid}-${Date.now()}` : null;
  try {
    if (backup) fs.renameSync(destination, backup);
    fs.renameSync(staged, destination);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (backup && lstatOrNull(backup) && !lstatOrNull(destination)) fs.renameSync(backup, destination);
    throw error;
  }
}

function assertReleaseTarget(target) {
  const parent = path.dirname(target);
  const parentStat = lstatOrNull(parent);
  if (!parentStat || !parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`release target parent is not a physical directory: ${parent}`);
  }
  const existing = lstatOrNull(target);
  if (existing && existing.isSymbolicLink()) throw new Error(`release target must not be a symlink: ${target}`);
}

function isCanonicalReleaseTarget(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const canonicalFiles = new Set([
    path.join(resolvedRoot, 'CHANGELOG.md'),
    ...MANIFEST_PATHS.filter((relPath) => !NATIVE_PACKAGE_PATHS.has(relPath)).map((relPath) => path.join(resolvedRoot, relPath)),
    ...AGY_GENERATOR_DOC_PATHS.map((relPath) => path.join(resolvedRoot, relPath)),
  ]);
  const canonicalDirectories = new Set([
    path.join(resolvedRoot, 'plugins', 'dhpk'),
    path.join(resolvedRoot, 'plugins', 'dhpk-agent'),
    path.join(resolvedRoot, 'plugins', 'dhpk-cursor'),
    path.join(resolvedRoot, 'plugins', 'dhpk-agy'),
  ]);
  if (canonicalFiles.has(resolvedTarget) || canonicalDirectories.has(resolvedTarget)) return true;
  const fragmentDirectory = path.join(resolvedRoot, 'changelog.d');
  return path.dirname(resolvedTarget) === fragmentDirectory
    && /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*\.md|[a-z0-9]+(?:-[a-z0-9]+)*\.none)$/i.test(path.basename(resolvedTarget));
}

function assertCanonicalReleaseTarget(root, target) {
  if (!isCanonicalReleaseTarget(root, target)) {
    throw new Error(`release target is not a canonical release target: ${target}`);
  }
}

function assertPhysicalPathAncestors(root, target, label) {
  const resolvedRoot = path.resolve(root);
  let current = path.resolve(target);
  while (isWithinPath(resolvedRoot, current)) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`${label} path contains a symlink ancestor: ${current}`);
    if (current === resolvedRoot) return;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function uniqueBackupPath(target, index) {
  let candidate = `${target}.dhpk-release-backup-${process.pid}-${index}`;
  let suffix = 0;
  while (lstatOrNull(candidate)) candidate = `${target}.dhpk-release-backup-${process.pid}-${index}-${++suffix}`;
  return candidate;
}

function digestPath(target) {
  const stat = lstatOrNull(target);
  if (!stat) return 'absent';
  if (stat.isSymbolicLink()) throw new Error(`rollback fingerprint refuses symlink: ${target}`);
  if (stat.isFile()) return `file:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
  if (!stat.isDirectory()) throw new Error(`rollback fingerprint refuses special path: ${target}`);
  const hash = crypto.createHash('sha256');
  const visit = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const child = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`rollback fingerprint refuses symlink: ${child}`);
      if (entry.isDirectory()) {
        hash.update(`D:${child}\n`);
        visit(absolute, child);
      } else if (entry.isFile()) {
        hash.update(`F:${child}:${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}\n`);
      } else {
        throw new Error(`rollback fingerprint refuses special path: ${child}`);
      }
    }
  };
  visit(target, '');
  return `directory:${hash.digest('hex')}`;
}

function writeRollbackManifest(manifestPath, manifest) {
  const temporary = `${manifestPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.renameSync(temporary, manifestPath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) { /* preserve the original failure */ }
    throw error;
  }
}

function ensureBackupRoot(backupRoot, operationKey) {
  if (!backupRoot || !operationKey) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationKey)) throw new Error('release operation key is invalid');
  const root = path.resolve(backupRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = lstatOrNull(root);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`release backup root is unsafe: ${root}`);
  const directory = path.join(root, operationKey);
  const manifest = path.join(root, `${operationKey}.json`);
  if (lstatOrNull(directory)) throw new Error(`release backup operation already exists: ${operationKey}`);
  if (lstatOrNull(manifest)) throw new Error(`release backup manifest already exists: ${operationKey}`);
  fs.mkdirSync(directory, { mode: 0o700 });
  return { directory, manifest };
}

function restoreReleaseStates(states) {
  const errors = [];
  for (const state of states.slice().reverse()) {
    try {
      if (state.temp && lstatOrNull(state.temp)) fs.rmSync(state.temp, { recursive: true, force: true });
      if (state.installed && lstatOrNull(state.replacement.target)) fs.rmSync(state.replacement.target, { recursive: true, force: true });
      if (state.backup && lstatOrNull(state.backup) && !lstatOrNull(state.replacement.target)) fs.renameSync(state.backup, state.replacement.target);
    } catch (error) {
      errors.push(`${state.replacement.target}: ${error.message}`);
    }
  }
  return errors;
}

function applyReleaseTransaction(replacements, { backupRoot = null, operationKey = null, root = null } = {}) {
  const targets = new Set();
  for (const replacement of replacements) {
    if (targets.has(replacement.target)) throw new Error(`release transaction contains duplicate target: ${replacement.target}`);
    targets.add(replacement.target);
    if (root) assertCanonicalReleaseTarget(root, replacement.target);
    assertReleaseTarget(replacement.target);
    if (replacement.source && !lstatOrNull(replacement.source)) throw new Error(`release transaction source is missing: ${replacement.source}`);
  }

  const durable = ensureBackupRoot(backupRoot, operationKey);
  const states = replacements.map((replacement, index) => ({ replacement, index, backup: null, temp: null, installed: false, existed: false }));
  try {
    for (const state of states) {
      const { replacement } = state;
      const existing = lstatOrNull(replacement.target);
      if (existing) {
        state.existed = true;
        state.backup = durable
          ? path.join(durable.directory, `${String(state.index).padStart(4, '0')}-${path.basename(replacement.target)}`)
          : uniqueBackupPath(replacement.target, state.index);
        fs.renameSync(replacement.target, state.backup);
      }
      if (!replacement.source) {
        state.installed = true;
        continue;
      }
      state.temp = `${replacement.target}.dhpk-release-stage-${process.pid}-${state.index}`;
      if (lstatOrNull(state.temp)) fs.rmSync(state.temp, { recursive: true, force: true });
      const sourceStat = lstatOrNull(replacement.source);
      if (sourceStat.isDirectory()) fs.cpSync(replacement.source, state.temp, { recursive: true, dereference: true });
      else fs.copyFileSync(replacement.source, state.temp);
      fs.renameSync(state.temp, replacement.target);
      state.temp = null;
      state.installed = true;
    }
  } catch (error) {
    const restoreErrors = restoreReleaseStates(states);
    if (durable && restoreErrors.length === 0) {
      try { fs.rmSync(durable.directory, { recursive: true, force: true }); } catch (_) { /* retain original failure */ }
      try { fs.rmSync(durable.manifest, { force: true }); } catch (_) { /* retain original failure */ }
    }
    if (restoreErrors.length > 0) {
      error.message = `${error.message}; rollback backup retained at ${durable ? durable.directory : 'ephemeral paths'}; restore failures: ${restoreErrors.join('; ')}`;
    }
    throw error;
  }

  if (!durable) {
    for (const state of states) if (state.backup && lstatOrNull(state.backup)) fs.rmSync(state.backup, { recursive: true, force: true });
    return { backupReference: null };
  }
  try {
    const manifest = {
      schema: 'dhpk.release.rollback.v1',
      operationKey,
      createdAt: new Date().toISOString(),
      backupDirectory: durable.directory,
      entries: states.map((state) => ({
        target: state.replacement.target,
        backup: state.backup,
        existed: state.existed,
        recovery: path.join(durable.directory, `.target-${String(state.index).padStart(4, '0')}`),
        publishedFingerprint: digestPath(state.replacement.target),
        backupFingerprint: state.backup ? digestPath(state.backup) : null,
        rollbackStatus: 'PENDING',
      })),
    };
    writeRollbackManifest(durable.manifest, manifest);
    return { backupReference: durable.manifest, manifest };
  } catch (error) {
    const restoreErrors = restoreReleaseStates(states);
    if (restoreErrors.length === 0) {
      try { fs.rmSync(durable.directory, { recursive: true, force: true }); } catch (_) { /* retain original failure */ }
      try { fs.rmSync(durable.manifest, { force: true }); } catch (_) { /* retain original failure */ }
    } else {
      error.message = `${error.message}; rollback backup retained at ${durable.directory}; restore failures: ${restoreErrors.join('; ')}`;
    }
    throw error;
  }
}

function isWithinPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function rollbackReleaseTransaction(reference, { root = null } = {}) {
  const manifestPath = path.resolve(reference || '');
  const manifestStat = lstatOrNull(manifestPath);
  if (!manifestStat || !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('release rollback manifest must be a regular file');
  }
  if (root) {
    const expectedRoot = path.resolve(root, '.claude', 'artifacts', 'release-backups');
    if (!isWithinPath(expectedRoot, manifestPath) || path.dirname(manifestPath) !== expectedRoot) {
      throw new Error('release rollback manifest must be under the repository backup root');
    }
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || manifest.schema !== 'dhpk.release.rollback.v1' || !Array.isArray(manifest.entries)) {
    throw new Error('release rollback manifest is invalid');
  }
  if (manifest.rolledBackAt || manifest.rollbackStatus === 'COMPLETE') {
    throw new Error(`release rollback operation '${manifest.operationKey}' was already applied`);
  }
  if (typeof manifest.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(manifest.operationKey)
    || path.basename(manifestPath) !== `${manifest.operationKey}.json`) {
    throw new Error('release rollback manifest operation identity is invalid');
  }
  const backupDirectory = path.resolve(manifest.backupDirectory || '');
  const backupDirectoryStat = lstatOrNull(backupDirectory);
  if (!backupDirectoryStat || !backupDirectoryStat.isDirectory() || backupDirectoryStat.isSymbolicLink()) {
    throw new Error('release rollback backup directory is missing or unsafe');
  }
  if (path.dirname(backupDirectory) !== path.dirname(manifestPath)) {
    throw new Error('release rollback backup directory is not beside its manifest');
  }
  if (path.basename(backupDirectory) !== manifest.operationKey) {
    throw new Error('release rollback backup directory does not match the manifest operation key');
  }
  const repositoryRoot = path.resolve(root || manifestPath, ...(root ? [] : ['..', '..', '..', '..']));
  assertPhysicalPathAncestors(repositoryRoot, backupDirectory, 'release rollback backup');
  const seenTargets = new Set();
  const seenBackups = new Set();
  const seenRecovery = new Set();
  for (const [entryIndex, entry] of manifest.entries.entries()) {
    if (!entry || typeof entry !== 'object' || typeof entry.target !== 'string' || typeof entry.existed !== 'boolean') {
      throw new Error('release rollback manifest entry is invalid');
    }
    const rollbackStatus = entry.rollbackStatus || 'PENDING';
    if (!['PENDING', 'RESTORED'].includes(rollbackStatus)) {
      throw new Error(`release rollback manifest entry has invalid rollback status: ${rollbackStatus}`);
    }
    const target = path.resolve(entry.target);
    const backup = entry.backup ? path.resolve(entry.backup) : null;
    const recovery = path.resolve(entry.recovery || path.join(backupDirectory, `.target-${String(entryIndex).padStart(4, '0')}`));
    if (!isWithinPath(repositoryRoot, target)) throw new Error('release rollback target escapes the repository root');
    assertCanonicalReleaseTarget(repositoryRoot, target);
    assertPhysicalPathAncestors(repositoryRoot, target, 'release rollback target');
    if (seenTargets.has(target)) throw new Error(`release rollback manifest contains a duplicate target: ${target}`);
    seenTargets.add(target);
    assertReleaseTarget(target);
    if (entry.existed && !backup) throw new Error(`release rollback backup is missing for ${target}`);
    if (!entry.existed && backup) throw new Error(`release rollback absent target has an unexpected backup: ${target}`);
    if (backup && !isWithinPath(backupDirectory, backup)) throw new Error('release rollback backup path is invalid');
    if (backup && path.dirname(backup) !== backupDirectory) throw new Error('release rollback backup must be a direct operation child');
    if (backup && seenBackups.has(backup)) throw new Error(`release rollback manifest contains a duplicate backup: ${backup}`);
    const backupStat = backup ? lstatOrNull(backup) : null;
    if (backup) {
      seenBackups.add(backup);
      assertPhysicalPathAncestors(backupDirectory, backup, 'release rollback backup');
      if (backupStat && backupStat.isSymbolicLink()) throw new Error(`release rollback backup is missing or unsafe: ${backup}`);
      if (rollbackStatus === 'RESTORED' && backupStat) throw new Error(`restored release rollback entry still has a backup: ${backup}`);
    }
    if (!isWithinPath(backupDirectory, recovery) || path.dirname(recovery) !== backupDirectory) {
      throw new Error('release rollback recovery path is invalid');
    }
    if (seenRecovery.has(recovery) || recovery === backup) throw new Error(`release rollback manifest contains a duplicate recovery path: ${recovery}`);
    seenRecovery.add(recovery);
    const recoveryStat = lstatOrNull(recovery);
    if (rollbackStatus === 'RESTORED' && recoveryStat) {
      if (digestPath(recovery) !== entry.publishedFingerprint) throw new Error(`restored release rollback recovery slot changed: ${recovery}`);
    }
    if (rollbackStatus === 'PENDING') {
      const targetFingerprint = digestPath(target);
      const recoveryFingerprint = recoveryStat ? digestPath(recovery) : null;
      const targetAlreadyRestored = Boolean(recoveryStat && backup && !backupStat
        && entry.backupFingerprint && targetFingerprint === entry.backupFingerprint
        && recoveryFingerprint === entry.publishedFingerprint);
      if (recoveryStat) {
        if ((!lstatOrNull(target) && recoveryFingerprint !== entry.publishedFingerprint)
          || (lstatOrNull(target) && !targetAlreadyRestored)) {
          throw new Error(`release rollback recovery slot is inconsistent: ${recovery}`);
        }
      } else if (targetFingerprint !== entry.publishedFingerprint) {
        throw new Error(`release rollback target changed after publication: ${target}`);
      }
      if (backup && !targetAlreadyRestored
        && (!backupStat || !entry.backupFingerprint || digestPath(backup) !== entry.backupFingerprint)) {
        throw new Error(`release rollback backup changed: ${backup}`);
      }
    } else {
      const restored = digestPath(target);
      if (typeof entry.restoredFingerprint !== 'string' || restored !== entry.restoredFingerprint) {
        throw new Error(`restored release rollback target no longer matches its persisted state: ${target}`);
      }
    }
  }
  const persistProgress = () => writeRollbackManifest(manifestPath, manifest);
  try {
    manifest.rollbackStatus = 'IN_PROGRESS';
    persistProgress();
    for (const [entryIndex, entry] of manifest.entries.map((value, index) => [index, value]).reverse()) {
      if ((entry.rollbackStatus || 'PENDING') === 'RESTORED') continue;
      const target = path.resolve(entry.target);
      const backup = entry.backup ? path.resolve(entry.backup) : null;
      const recovery = path.resolve(entry.recovery || path.join(backupDirectory, `.target-${String(entryIndex).padStart(4, '0')}`));
      if (lstatOrNull(recovery)) {
        const targetStat = lstatOrNull(target);
        const backupStat = backup ? lstatOrNull(backup) : null;
        const targetAlreadyRestored = Boolean(targetStat && !backupStat && entry.backupFingerprint
          && digestPath(target) === entry.backupFingerprint
          && digestPath(recovery) === entry.publishedFingerprint);
        if (targetAlreadyRestored) {
          entry.rollbackStatus = 'RESTORED';
          entry.restoredFingerprint = digestPath(target);
          manifest.rollbackStatus = 'PARTIAL';
          // Persist before removing the recovery slot so a crash during
          // cleanup leaves a resumable RESTORED entry, not a PENDING entry
          // with a missing backup.
          persistProgress();
          fs.rmSync(recovery, { recursive: true, force: true });
          continue;
        }
        if (targetStat) throw new Error(`release rollback recovery slot has a conflicting target: ${target}`);
        fs.renameSync(recovery, target);
      }
      if (lstatOrNull(target)) fs.renameSync(target, recovery);
      try {
        if (backup && lstatOrNull(backup)) fs.renameSync(backup, target);
        entry.rollbackStatus = 'RESTORED';
        entry.restoredFingerprint = digestPath(target);
        manifest.rollbackStatus = 'PARTIAL';
        // Persist the new target state before deleting the recovery slot. A
        // crash after publication can then resume by cleaning that slot.
        persistProgress();
        if (lstatOrNull(recovery)) fs.rmSync(recovery, { recursive: true, force: true });
      } catch (error) {
        try {
          if (!lstatOrNull(target) && lstatOrNull(recovery)) fs.renameSync(recovery, target);
        } catch (restoreError) {
          error.message = `${error.message}; recovery compensation failed: ${restoreError.message}`;
        }
        throw error;
      }
    }
    manifest.rollbackStatus = 'COMPLETE';
    manifest.rolledBackAt = new Date().toISOString();
    persistProgress();
    fs.rmSync(backupDirectory, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    error.message = `${error.message}; resumable rollback manifest and remaining backups were retained at ${manifestPath}`;
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'rollback') {
    if (!args.backupReference) {
      console.error('prepare-release: rollback requires --backup-reference <manifest>');
      process.exit(2);
    }
  } else if (!args.version || !SEMVER_PATTERN.test(args.version)) {
    console.error(`prepare-release: version '${args.version}' is not valid semver (X.Y.Z)`);
    process.exit(2);
  }

  const branch = currentBranch(args.root);
  if (branch !== REQUIRED_BRANCH && !allowsPublishTargetCheck(args, branch)) {
    console.error(`prepare-release: must run on '${REQUIRED_BRANCH}' (current: '${branch}'); the develop -> main PR is the release candidate boundary`);
    process.exit(1);
  }

  if (args.mode === 'rollback') {
    try {
      const manifest = rollbackReleaseTransaction(args.backupReference, { root: args.root });
      console.log(`prepare-release: rollback PASS (operation ${manifest.operationKey})`);
    } catch (error) {
      console.error(`prepare-release: rollback FAIL: ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (args.mode === 'check') {
    const result = checkParity(args.root, args.version);
    if (!result.ok) {
      console.error('prepare-release: check FAIL');
      for (const err of result.errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(`prepare-release: check PASS (target ${args.version})`);
    return;
  }

  // write mode
  if (!args.date) {
    console.error('prepare-release: write requires --date YYYY-MM-DD');
    process.exit(2);
  }

  const fragmentDir = path.join(args.root, 'changelog.d');
  const changelogPath = path.join(args.root, 'CHANGELOG.md');
  const { fragments, markers } = readFragments(fragmentDir);
  const validation = validateFragments(fragments, markers);
  if (!validation.ok) {
    console.error('prepare-release: write FAIL (invalid fragments, nothing changed)');
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  const inventory = JSON.parse(fs.readFileSync(path.join(args.root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: args.root, encoding: 'utf8' }).trim();
  const targetTree = resolveGeneratedFromTree(args.root, sourceCommit);
  if (!targetTree) throw new Error('unable to resolve release target source tree');
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-packages-'));
  const stagedNative = path.join(stagingRoot, 'dhpk');
  const stagedAgent = path.join(stagingRoot, 'dhpk-agent');
  const stagedCursor = path.join(stagingRoot, 'dhpk-cursor');
  const stagedAgy = path.join(stagingRoot, 'dhpk-agy');
  try {
    materializeNativePackage({ inventory, root: args.root, outDir: stagedNative, name: 'dhpk', version: args.version, sourceCommit });
    const stagedAgentResult = materializeAgentPluginPackage({ inventory, root: args.root, outDir: stagedAgent, name: 'dhpk', version: args.version, sourceCommit });
    const stagedCursorResult = materializeCursorPackage({ inventory, root: args.root, outDir: stagedCursor, version: args.version, sourceCommit });
    let stagedAgyValidation = { errors: [] };
    let agyReceipt = { errors: [] };
    try {
      materializeAgyPluginPackage({
        inventory,
        root: args.root,
        outDir: stagedAgy,
        version: args.version,
        sourceVersion: args.version,
        sourceCommit,
      });
      stagedAgyValidation = validateAgyPluginPackage(stagedAgy, {
        inventory,
        expectedVersion: args.version,
      });
      const agyProvenance = JSON.parse(fs.readFileSync(path.join(stagedAgy, 'provenance.json'), 'utf8'));
      agyReceipt = validateSurfaceReceipt({ ...agyProvenance, schema: 'dhpk.platform-provenance.v1' }, 'agy-plugin', { root: args.root, targetCommit: sourceCommit, targetTree });
    } catch (error) {
      stagedAgyValidation = { errors: [error.message] };
    }

    const stagedAgentValidation = validateAgentPluginPackage(stagedAgent, {
      allowlist: inventory.portable_frontmatter && inventory.portable_frontmatter.allowlist,
    });
    const stagedCursorValidation = validateCursorPackage({ packageRoot: stagedCursor, expectedManifestName: 'dhpk-cursor', inventory });
    const agentReceipt = validateSurfaceReceipt(JSON.parse(fs.readFileSync(path.join(stagedAgent, 'provenance.json'), 'utf8')), 'agent-plugin', { root: args.root, targetCommit: sourceCommit, targetTree });
    const cursorReceipt = validateSurfaceReceipt(JSON.parse(fs.readFileSync(path.join(stagedCursor, 'provenance.json'), 'utf8')), 'cursor-plugin', { root: args.root, targetCommit: sourceCommit, targetTree });
    const validationErrors = [
      ...stagedAgentValidation.errors,
      ...stagedCursorValidation.errors,
      ...stagedAgyValidation.errors,
      ...agentReceipt.errors,
      ...cursorReceipt.errors,
      ...agyReceipt.errors,
      ...(stagedAgentResult.skippedSkills.length > 0 ? [`Agent Plugin skipped selected skills: ${stagedAgentResult.skippedSkills.map((skill) => skill.id || skill.name).join(', ')}`] : []),
      ...(stagedCursorResult.skippedSkills.length > 0 ? [`Cursor Plugin skipped selected skills: ${stagedCursorResult.skippedSkills.map((skill) => skill.id || skill.name || skill.path).join(', ')}`] : []),
    ];
    if (validationErrors.length > 0) throw new Error(`generated release package validation failed: ${validationErrors.join('; ')}`);

    const stagedChangelog = path.join(stagingRoot, 'CHANGELOG.md');
    fs.copyFileSync(changelogPath, stagedChangelog);
    const stagedFragments = path.join(stagingRoot, 'changelog.d');
    fs.mkdirSync(stagedFragments, { recursive: true });
    for (const entry of fs.readdirSync(fragmentDir, { withFileTypes: true })) {
      if (entry.isFile()) fs.copyFileSync(path.join(fragmentDir, entry.name), path.join(stagedFragments, entry.name));
    }
    const promoted = promote({ fragmentDir: stagedFragments, changelogPath: stagedChangelog, version: args.version, date: args.date, summary: args.summary });

    const stagedFiles = path.join(stagingRoot, 'files');
    fs.mkdirSync(stagedFiles, { recursive: true });
    for (const relPath of MANIFEST_PATHS) {
      if (NATIVE_PACKAGE_PATHS.has(relPath)) continue;
      const destination = path.join(stagedFiles, relPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(args.root, relPath), destination);
      writeManifestVersion(stagedFiles, relPath, args.version);
    }

    for (const relPath of AGY_GENERATOR_DOC_PATHS) {
      const destination = path.join(stagedFiles, relPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(args.root, relPath), destination);
    }
    writeAgyGeneratorDocPins(stagedFiles, args.version);

    const changed = [];
    changed.push('CHANGELOG.md');
    for (const relPath of MANIFEST_PATHS) {
      if (NATIVE_PACKAGE_PATHS.has(relPath)) continue;
      changed.push(relPath);
    }
    for (const relPath of AGY_GENERATOR_DOC_PATHS) changed.push(relPath);
    const replacements = [
      { target: changelogPath, source: stagedChangelog },
      ...MANIFEST_PATHS.filter((relPath) => !NATIVE_PACKAGE_PATHS.has(relPath)).map((relPath) => ({
        target: path.join(args.root, relPath),
        source: path.join(stagedFiles, relPath),
      })),
      ...AGY_GENERATOR_DOC_PATHS.map((relPath) => ({
        target: path.join(args.root, relPath),
        source: path.join(stagedFiles, relPath),
      })),
      { target: path.join(args.root, 'plugins', 'dhpk'), source: stagedNative },
      { target: path.join(args.root, 'plugins', 'dhpk-agent'), source: stagedAgent },
      { target: path.join(args.root, 'plugins', 'dhpk-cursor'), source: stagedCursor },
      { target: path.join(args.root, 'plugins', 'dhpk-agy'), source: stagedAgy },
      ...promoted.consumed.map((relative) => ({ target: path.join(fragmentDir, relative), source: null })),
    ];
    const operationKey = args.operationKey || `release-${args.version}-${Date.now()}`;
    const transaction = applyReleaseTransaction(replacements, {
      backupRoot: path.join(args.root, '.claude', 'artifacts', 'release-backups'),
      operationKey,
      root: args.root,
    });
    changed.push('plugins/dhpk/ (regenerated codex-native package: manifest, skills/, fingerprints.json, provenance.json)');
    changed.push('plugins/dhpk-agent/ (regenerated standard Agent Plugin package)');
    changed.push('plugins/dhpk-cursor/ (regenerated Cursor Plugin package)');
    changed.push('plugins/dhpk-agy/ (regenerated native AGY package)');

    console.log(`prepare-release: write PASS (target ${args.version}); changed files:`);
    for (const f of changed) console.log(`  - ${f}`);
    console.log(`  - rollback-reference: ${transaction.backupReference}`);
  } catch (error) {
    console.error(`prepare-release: write FAIL (generated package validation or atomic replacement): ${error.message}`);
    process.exitCode = 1;
    return;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main();
