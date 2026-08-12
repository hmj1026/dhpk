#!/usr/bin/env node
'use strict';

// One release preparation command: SemVer-validates a target version, checks
// (or deterministically writes) parity across every version-bearing manifest
// and the CHANGELOG.md release heading, and promotes changelog.d/ fragments.
// Preserves git-flow authority (RELEASE.md): preparation runs on `develop`
// only and never merges, tags, or pushes — release-runner.sh still owns the
// commit/PR/tag mechanics once these files are correct.
//
// Usage:
//   node scripts/release/prepare-release.js check --version X.Y.Z
//   node scripts/release/prepare-release.js write --version X.Y.Z --date YYYY-MM-DD [--summary "..."]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SEMVER_PATTERN, MANIFEST_PATHS, checkParity } = require('../lib/release-parity');
const { readFragments, validateFragments, promote } = require('../lib/changelog-fragments');
const { materializeNativePackage } = require('../lib/codex-native-package');
const { materializeAgentPluginPackage } = require('../lib/agent-plugin-package');
const { validateAgentPluginPackage } = require('../lib/agent-plugin-package');
const { materializeCursorPackage } = require('../lib/cursor-plugin-package');
const { validateCursorPackage } = require('../lib/cursor-plugin-package');
const { validateSurfaceReceipt } = require('../lib/platform-provenance');

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
]);

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const REQUIRED_BRANCH = 'develop';

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'check' || arg === 'write') args.mode = arg;
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--summary') args.summary = argv[++i];
    // Test-only override; production always prepares the plugin's own repo.
    else if (arg === '--repo-root') args.root = argv[++i];
    else {
      console.error(`prepare-release: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.mode) {
    console.error('usage: prepare-release.js <check|write> --version X.Y.Z [--date YYYY-MM-DD] [--summary "..."] [--repo-root <path>]');
    process.exit(2);
  }
  return args;
}

function currentBranch(root) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
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

function uniqueBackupPath(target, index) {
  let candidate = `${target}.dhpk-release-backup-${process.pid}-${index}`;
  let suffix = 0;
  while (lstatOrNull(candidate)) candidate = `${target}.dhpk-release-backup-${process.pid}-${index}-${++suffix}`;
  return candidate;
}

function applyReleaseTransaction(replacements) {
  const targets = new Set();
  for (const replacement of replacements) {
    if (targets.has(replacement.target)) throw new Error(`release transaction contains duplicate target: ${replacement.target}`);
    targets.add(replacement.target);
    assertReleaseTarget(replacement.target);
    if (replacement.source && !lstatOrNull(replacement.source)) throw new Error(`release transaction source is missing: ${replacement.source}`);
  }

  const states = replacements.map((replacement, index) => ({ replacement, index, backup: null, temp: null, installed: false }));
  try {
    for (const state of states) {
      const { replacement } = state;
      const existing = lstatOrNull(replacement.target);
      if (existing) {
        state.backup = uniqueBackupPath(replacement.target, state.index);
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
    for (const state of states.slice().reverse()) {
      try {
        if (state.temp && lstatOrNull(state.temp)) fs.rmSync(state.temp, { recursive: true, force: true });
        if (state.installed && lstatOrNull(state.replacement.target)) fs.rmSync(state.replacement.target, { recursive: true, force: true });
        if (state.backup && lstatOrNull(state.backup) && !lstatOrNull(state.replacement.target)) fs.renameSync(state.backup, state.replacement.target);
      } catch (_) { /* retain the original failure; caller receives the failed transaction */ }
    }
    throw error;
  }

  for (const state of states) if (state.backup && lstatOrNull(state.backup)) fs.rmSync(state.backup, { recursive: true, force: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.version || !SEMVER_PATTERN.test(args.version)) {
    console.error(`prepare-release: version '${args.version}' is not valid semver (X.Y.Z)`);
    process.exit(2);
  }

  const branch = currentBranch(args.root);
  if (branch !== REQUIRED_BRANCH) {
    console.error(`prepare-release: must run on '${REQUIRED_BRANCH}' (current: '${branch}'); the develop -> main PR is the release candidate boundary`);
    process.exit(1);
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
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-packages-'));
  const stagedNative = path.join(stagingRoot, 'dhpk');
  const stagedAgent = path.join(stagingRoot, 'dhpk-agent');
  const stagedCursor = path.join(stagingRoot, 'dhpk-cursor');
  try {
    materializeNativePackage({ inventory, root: args.root, outDir: stagedNative, name: 'dhpk', version: args.version, sourceCommit });
    const stagedAgentResult = materializeAgentPluginPackage({ inventory, root: args.root, outDir: stagedAgent, name: 'dhpk', version: args.version, sourceCommit });
    const stagedCursorResult = materializeCursorPackage({ inventory, root: args.root, outDir: stagedCursor, version: args.version, sourceCommit });

    const stagedAgentValidation = validateAgentPluginPackage(stagedAgent, {
      allowlist: inventory.portable_frontmatter && inventory.portable_frontmatter.allowlist,
    });
    const stagedCursorValidation = validateCursorPackage({ packageRoot: stagedCursor, expectedManifestName: 'dhpk-cursor' });
    const agentReceipt = validateSurfaceReceipt(JSON.parse(fs.readFileSync(path.join(stagedAgent, 'provenance.json'), 'utf8')), 'agent-plugin');
    const cursorReceipt = validateSurfaceReceipt(JSON.parse(fs.readFileSync(path.join(stagedCursor, 'provenance.json'), 'utf8')), 'cursor-plugin');
    const validationErrors = [
      ...stagedAgentValidation.errors,
      ...stagedCursorValidation.errors,
      ...agentReceipt.errors,
      ...cursorReceipt.errors,
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

    const changed = [];
    changed.push('CHANGELOG.md');
    for (const relPath of MANIFEST_PATHS) {
      if (NATIVE_PACKAGE_PATHS.has(relPath)) continue;
      changed.push(relPath);
    }
    const replacements = [
      { target: changelogPath, source: stagedChangelog },
      ...MANIFEST_PATHS.filter((relPath) => !NATIVE_PACKAGE_PATHS.has(relPath)).map((relPath) => ({
        target: path.join(args.root, relPath),
        source: path.join(stagedFiles, relPath),
      })),
      { target: path.join(args.root, 'plugins', 'dhpk'), source: stagedNative },
      { target: path.join(args.root, 'plugins', 'dhpk-agent'), source: stagedAgent },
      { target: path.join(args.root, 'plugins', 'dhpk-cursor'), source: stagedCursor },
      ...promoted.consumed.map((relative) => ({ target: path.join(fragmentDir, relative), source: null })),
    ];
    applyReleaseTransaction(replacements);
    changed.push('plugins/dhpk/ (regenerated codex-native package: manifest, skills/, fingerprints.json, provenance.json)');
    changed.push('plugins/dhpk-agent/ (regenerated standard Agent Plugin package)');
    changed.push('plugins/dhpk-cursor/ (regenerated Cursor Plugin package)');

    console.log(`prepare-release: write PASS (target ${args.version}); changed files:`);
    for (const f of changed) console.log(`  - ${f}`);
  } catch (error) {
    console.error(`prepare-release: write FAIL (generated package validation or atomic replacement): ${error.message}`);
    process.exitCode = 1;
    return;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main();
