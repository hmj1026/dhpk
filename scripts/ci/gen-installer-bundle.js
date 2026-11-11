#!/usr/bin/env node
'use strict';

// Builds, or checks, the single-file JS installer a packaged harness-setup Skill
// runs (scripts/lib/installer-bundle.js). The bundle is not a tracked source
// file: it is emitted into each package as scripts/lib/dhpk-installer.cjs by
// scripts/lib/marketplace-skill-content.js. This command exists to inspect it
// and to fail CI when it stops being reproducible.
//
//   node scripts/ci/gen-installer-bundle.js --out FILE   write the bundle to FILE
//   node scripts/ci/gen-installer-bundle.js --check      verify the bundle
//
// --check passes when two builds are byte-identical, the closure needs only
// node: built-ins and relative modules, no source module of it is missing from
// git, and the bundle parses. Packages that embed it are checked by
// `npm run check:generated` (they are regenerated and compared).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildInstallerBundle, collectClosure, ENTRY, REPO_ROOT } = require('../lib/installer-bundle');

function parse(argv) {
  const options = { check: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--out') {
      index += 1;
      if (!argv[index]) throw new Error('--out requires a file');
      options.out = argv[index];
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.check === (options.out !== null)) throw new Error('give exactly one of --check or --out FILE');
  return options;
}

function check() {
  const problems = [];
  const first = buildInstallerBundle();
  if (first !== buildInstallerBundle()) problems.push('two builds of the installer bundle differ');
  if (/\r/.test(first)) problems.push('the installer bundle must use LF line endings');
  const tracked = spawnSync('git', ['ls-files', '--', 'scripts'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (tracked.status === 0) {
    const files = new Set(tracked.stdout.split('\n').filter(Boolean));
    for (const record of collectClosure(REPO_ROOT, ENTRY)) {
      if (!files.has(record.id)) problems.push(`${record.id} is part of the installer bundle but not tracked by git`);
    }
  }
  const parsed = spawnSync(process.execPath, ['--check', '-'], { input: first, encoding: 'utf8' });
  if (parsed.status !== 0) problems.push(`the installer bundle does not parse: ${parsed.stderr.trim().split('\n')[0]}`);
  return problems;
}

function main(argv) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    process.stderr.write(`gen-installer-bundle: ${error.message}\n`);
    return 2;
  }
  if (options.out) {
    fs.writeFileSync(path.resolve(options.out), buildInstallerBundle());
    return 0;
  }
  const problems = check();
  if (problems.length === 0) {
    process.stdout.write('gen-installer-bundle: ok\n');
    return 0;
  }
  for (const problem of problems) process.stderr.write(`gen-installer-bundle: ${problem}\n`);
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, check };
