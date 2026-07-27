#!/usr/bin/env node
'use strict';

// Check mode (default): validate changelog.d/ fragment schema, and — when
// --diff-base is given — that the diff since that ref carries a fragment or
// .none marker for any non-test-only change.
//
// Write mode (--write): promote the current fragment set into CHANGELOG.md
// and delete the consumed fragments. Never runs implicitly from check mode.
//
// Usage:
//   node scripts/ci/validate-changelog-fragments.js
//   node scripts/ci/validate-changelog-fragments.js --diff-base origin/develop
//   node scripts/ci/validate-changelog-fragments.js --write --version X.Y.Z --date YYYY-MM-DD [--summary "..."]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readFragments, validateFragments, checkCoverage, promote } = require('../lib/changelog-fragments');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { write: false, root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') args.write = true;
    else if (arg === '--diff-base') args.diffBase = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--summary') args.summary = argv[++i];
    // Test-only override; production always validates the plugin's own repo.
    else if (arg === '--repo-root') args.root = argv[++i];
    else {
      console.error(`validate-changelog-fragments: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  return args;
}

// A git failure here (unreachable diff base, not a repo) is a harness fault,
// not a fragment-coverage verdict — report it as one instead of dumping a raw
// stack trace from execFileSync.
function git(root, gitArgs) {
  try {
    return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  } catch (err) {
    console.error(`validate-changelog-fragments: git ${gitArgs.join(' ')} failed`);
    console.error(`  ${(err.stderr || err.message || '').toString().trim()}`);
    process.exit(2);
  }
}

function changedFilesSince(root, diffBase) {
  const out = git(root, ['diff', '--name-only', `${diffBase}...HEAD`]);
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// Recognises the one PR shape that legitimately carries no pending fragment:
// the release PR, whose fragments prepare-release already promoted into
// CHANGELOG.md and deleted. Sniffing "a version heading appeared" alone would
// hand every PR an easy opt-out of the fragment requirement, so this demands
// two things a stray CHANGELOG edit cannot both satisfy:
//
//   1. the diff ADDS a "## X.Y.Z ..." heading that did not exist at the diff
//      base — a genuinely new section, not a reworded or re-dated old one; and
//   2. that X.Y.Z equals the plugin manifest version at HEAD — prepare-release
//      moves the manifests and CHANGELOG.md in lockstep, so a hand-written
//      section without the bump does not qualify.
//
// Anything unreadable (missing or malformed manifest) fails closed: no
// exemption, the ordinary fragment requirement stands.
const ADDED_RELEASE_HEADING = /^\+## (\d+\.\d+\.\d+)(?=[\s.])/gm;
const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');

function pluginManifestVersion(root) {
  try {
    const raw = fs.readFileSync(path.join(root, PLUGIN_MANIFEST), 'utf8');
    const version = JSON.parse(raw).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function headingPresent(text, version) {
  return new RegExp(`^## ${version.replace(/\./g, '\\.')}(?=[\\s.])`, 'm').test(text);
}

function releaseSectionAddedSince(root, diffBase) {
  const diff = git(root, ['diff', '--unified=0', `${diffBase}...HEAD`, '--', 'CHANGELOG.md']);
  const addedVersions = [...diff.matchAll(ADDED_RELEASE_HEADING)].map((m) => m[1]);
  if (addedVersions.length === 0) return false;

  const manifestVersion = pluginManifestVersion(root);
  if (!manifestVersion || !addedVersions.includes(manifestVersion)) return false;

  // `git show` exits non-zero when CHANGELOG.md is absent at the base, which is
  // itself proof the section is new — so this one call stays tolerant.
  let baseChangelog = '';
  try {
    baseChangelog = execFileSync('git', ['show', `${diffBase}:CHANGELOG.md`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    baseChangelog = '';
  }
  return !headingPresent(baseChangelog, manifestVersion);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fragmentDir = path.join(args.root, 'changelog.d');
  const changelogPath = path.join(args.root, 'CHANGELOG.md');

  if (!fs.existsSync(fragmentDir)) {
    console.error(`validate-changelog-fragments: missing ${fragmentDir}`);
    process.exit(2);
  }

  const { fragments, markers } = readFragments(fragmentDir);
  const validation = validateFragments(fragments, markers);

  if (!validation.ok) {
    console.error('validate-changelog-fragments: FAIL');
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  if (args.diffBase) {
    const changedFiles = changedFilesSince(args.root, args.diffBase);
    const releaseSectionAdded = releaseSectionAddedSince(args.root, args.diffBase);
    const coverage = checkCoverage({ changedFiles, fragments, markers, releaseSectionAdded });
    if (!coverage.ok) {
      console.error('validate-changelog-fragments: FAIL (missing release fragment)');
      console.error(`  changed files since ${args.diffBase} have no changelog.d/*.md or *.none:`);
      for (const f of coverage.uncovered) console.error(`  - ${f}`);
      console.error('  Add a changelog.d/<category>.<slug>.md fragment, or a changelog.d/<slug>.none marker for internal-only changes.');
      process.exit(1);
    }
  }

  if (args.write) {
    if (!args.version || !args.date) {
      console.error('validate-changelog-fragments: --write requires --version and --date');
      process.exit(2);
    }
    const result = promote({
      fragmentDir,
      changelogPath,
      version: args.version,
      date: args.date,
      summary: args.summary,
    });
    console.log(`validate-changelog-fragments: promoted ${result.consumed.length} fragment(s) into CHANGELOG.md`);
    for (const f of result.consumed) console.log(`  - ${f}`);
    return;
  }

  console.log(`validate-changelog-fragments: PASS (${fragments.length} fragment(s), ${markers.length} marker(s))`);
}

main();
