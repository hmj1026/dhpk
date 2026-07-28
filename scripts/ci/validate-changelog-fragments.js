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
    else if (arg === '--base-ref') args.baseRef = argv[++i];
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
// CHANGELOG.md and deleted.
//
// Everything a PR writes to its own files is author-controlled, so content
// alone can always be forged — a contributor wanting to skip the fragment
// requirement could append a version heading AND bump the manifest to match in
// the same commit. The base ref cannot be forged that way: it is supplied by
// the CI event, and only the release PR targets `main`. So the exemption needs
// all three, and the first is the trust boundary:
//
//   0. the PR's base ref is RELEASE_BASE_REF — this is the release PR at all;
//   1. the diff ADDS a "## X.Y.Z ..." heading that did not exist at the diff
//      base — a genuinely new section, not a reworded or re-dated old one; and
//   2. that X.Y.Z equals the plugin manifest version at HEAD — prepare-release
//      moves the manifests and CHANGELOG.md in lockstep.
//
// Everything unknown fails closed — absent `--base-ref`, a non-release base, or
// an unreadable manifest all mean no exemption and the ordinary fragment
// requirement stands.
const RELEASE_BASE_REF = 'main';
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

// CHANGELOG.md absent at the base is itself proof the section is new. Any other
// git failure is a harness fault and must not be read as evidence, so only the
// "does not exist" case is tolerated — `git cat-file -e` distinguishes them.
function changelogAtBase(root, diffBase) {
  const spec = `${diffBase}:CHANGELOG.md`;
  try {
    execFileSync('git', ['cat-file', '-e', spec], { cwd: root, stdio: 'ignore' });
  } catch {
    return '';
  }
  return git(root, ['show', spec]);
}

function releaseSectionAddedSince(root, diffBase, baseRef) {
  if (baseRef !== RELEASE_BASE_REF) return false;

  const diff = git(root, ['diff', '--unified=0', `${diffBase}...HEAD`, '--', 'CHANGELOG.md']);
  const addedVersions = [...diff.matchAll(ADDED_RELEASE_HEADING)].map((m) => m[1]);
  if (addedVersions.length === 0) return false;

  const manifestVersion = pluginManifestVersion(root);
  if (!manifestVersion || !addedVersions.includes(manifestVersion)) return false;

  return !headingPresent(changelogAtBase(root, diffBase), manifestVersion);
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
    const releaseSectionAdded = releaseSectionAddedSince(args.root, args.diffBase, args.baseRef);
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
