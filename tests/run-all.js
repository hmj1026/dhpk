#!/usr/bin/env node
'use strict';

// Discover and run every tests/**/*.test.js in its own node process, aggregate
// results. Git env vars are stripped so test subprocesses never accidentally
// operate on the harness's own repo state.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;

function findTests(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '_lib') continue;
      out.push(...findTests(fp));
    } else if (e.name.endsWith('.test.js')) {
      out.push(fp);
    }
  }
  return out;
}

const env = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
  delete env[k];
}

const files = findTests(TESTS_DIR).sort();
let failed = 0;

for (const file of files) {
  const rel = path.relative(TESTS_DIR, file);
  console.log(`\n# ${rel}`);
  const res = spawnSync('node', [file], { stdio: 'inherit', env });
  if (res.status !== 0) failed += 1;
}

console.log(`\n========================================`);
if (failed > 0) {
  console.error(`FAIL: ${failed}/${files.length} test file(s) failed`);
  process.exit(1);
}
console.log(`PASS: ${files.length}/${files.length} test file(s) passed`);
