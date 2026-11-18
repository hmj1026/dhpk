#!/usr/bin/env node
'use strict';

// Checks the JS installer modules a packaged harness-setup Skill ships
// (scripts/lib/installer-modules.js):
//
//   node scripts/ci/check-installer-modules.js --check
//
// Passes when the entry's require() closure resolves using only relative modules
// and node: built-ins, every module is git-tracked, and none exceeds
// MAX_MODULE_BYTES. Packages that copy the modules are checked by
// `npm run check:generated` (they are regenerated and compared).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectClosure, ENTRY, MAX_MODULE_BYTES, REPO_ROOT } = require('../lib/installer-modules');

function check({ root = REPO_ROOT, entry = ENTRY } = {}) {
  const problems = [];
  let closure;
  try {
    closure = collectClosure(root, entry);
  } catch (error) {
    return [error.message];
  }
  const tracked = spawnSync('git', ['ls-files', '--', 'scripts'], { cwd: root, encoding: 'utf8' });
  const files = tracked.status === 0 ? new Set(tracked.stdout.split('\n').filter(Boolean)) : null;
  for (const record of closure) {
    if (!record.id.startsWith('scripts/')) problems.push(`${record.id} is outside scripts/ and would not ship with the Skill`);
    if (files && !files.has(record.id)) problems.push(`${record.id} is an installer module but not tracked by git`);
    const size = fs.statSync(path.join(root, record.id)).size;
    if (size > MAX_MODULE_BYTES) problems.push(`${record.id} is ${size} bytes; installer modules are limited to ${MAX_MODULE_BYTES}`);
  }
  return problems;
}

function main(argv) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    process.stderr.write('check-installer-modules: usage: check-installer-modules.js --check\n');
    return 2;
  }
  const problems = check();
  if (problems.length === 0) {
    process.stdout.write('check-installer-modules: ok\n');
    return 0;
  }
  for (const problem of problems) process.stderr.write(`check-installer-modules: ${problem}\n`);
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, check };
