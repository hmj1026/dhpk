#!/usr/bin/env node
'use strict';

// Discover and run every tests/**/*.test.js in its own node process, aggregate
// results. Git env vars are stripped so test subprocesses never accidentally
// operate on the harness's own repo state.

const fs = require('node:fs');
const path = require('node:path');
const { runNodeTest } = require('../scripts/lib/bounded-child-process');

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
if (!env.NODE_OPTIONS || !env.NODE_OPTIONS.includes('--max-old-space-size')) {
  env.NODE_OPTIONS = `--max-old-space-size=2048 ${env.NODE_OPTIONS || ''}`.trim();
}

const files = findTests(TESTS_DIR).sort();
// Integration-heavy suites may legitimately need more than one minute while
// still remaining bounded. Keep the override for environments with a tighter
// budget, but make the default large enough for the standard CI suite.
const timeoutMs = Number(env.DHPK_TEST_TIMEOUT_MS || 180000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
  console.error(`Invalid DHPK_TEST_TIMEOUT_MS: ${env.DHPK_TEST_TIMEOUT_MS}`);
  process.exit(2);
}
let failed = 0;

for (const file of files) {
  const rel = path.relative(TESTS_DIR, file);
  console.log(`\n# ${rel}`);
  const res = runNodeTest(file, { env, timeoutMs });
  if (res.status !== 0 || res.error) {
    failed += 1;
    if (res.error) console.error(`ERROR in ${rel}: ${res.error.message}`);
  }
}

console.log(`\n========================================`);
if (failed > 0) {
  console.error(`FAIL: ${failed}/${files.length} test file(s) failed`);
  process.exit(1);
}
console.log(`PASS: ${files.length}/${files.length} test file(s) passed`);
