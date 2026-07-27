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

function changedFilesSince(root, diffBase) {
  const out = execFileSync('git', ['diff', '--name-only', `${diffBase}...HEAD`], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// True when the diff adds a "## X.Y.Z — ..." release heading to CHANGELOG.md,
// i.e. this is a release PR whose fragments were already promoted and deleted.
const RELEASE_HEADING_ADDED = /^\+## \d+\.\d+\.\d+ /m;

function releaseSectionAddedSince(root, diffBase) {
  const out = execFileSync('git', ['diff', '--unified=0', `${diffBase}...HEAD`, '--', 'CHANGELOG.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  return RELEASE_HEADING_ADDED.test(out);
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
