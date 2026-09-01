#!/usr/bin/env node
'use strict';

// Discover and run every tests/**/*.test.js in its own Node process, aggregate
// results, and optionally schedule the files across a bounded worker pool.
// Git env vars are stripped so test subprocesses never accidentally operate on
// the harness's own repo state. Every worker still uses runNodeTest, retaining
// the per-file timeout/process-group boundary that protects the legacy suite.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runNodeTest } = require('../scripts/lib/bounded-child-process');

const TESTS_DIR = __dirname;
const MAX_JOBS = 8;

// A small, intentionally conservative size-derived weight keeps the largest
// fixture-heavy files from landing in the same worker. The fallback weight is
// deterministic for synthetic paths used by unit tests and future shards.
const WEIGHT_HINTS = Object.freeze({
  'install-codex-skills.test.js': 160,
  'consumer-gate-cli.test.js': 80,
  'gen-cursor-plugin-package.test.js': 70,
  'harness-facade-cli.test.js': 55,
  'subagent-stop-verify-autoclear.test.js': 45,
  'run-codex.test.js': 40,
  'resumed-review-reconcile.test.js': 25,
});

// Per-file timeout floors. The default 180s budget is enough for most files,
// but installer copy-mode hashing and harness `release` (seven sequential
// consumer-gate children with a 120s inner cap) overrun that under four-way
// CI contention inside a 2G cgroup.
const TIMEOUT_HINTS = Object.freeze({
  'install-codex-skills.test.js': 300000,
  'harness-facade-cli.test.js': 240000,
});

function findTests(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_lib') continue;
      out.push(...findTests(filePath));
    } else if (entry.name.endsWith('.test.js')) {
      out.push(filePath);
    }
  }
  return out;
}

function parsePositiveInteger(value, label, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^\d+$/.test(String(value))) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new RangeError(`${label} must be in the range 1-${maximum}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^\d+$/.test(String(value))) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new RangeError(`${label} must be in the range 0-${maximum}`);
  }
  return parsed;
}

function parseOptions(argv = process.argv.slice(2), sourceEnv = process.env) {
  const options = {
    shardIndex: 0,
    shardCount: 1,
    jobs: parsePositiveInteger(sourceEnv.DHPK_TEST_JOBS || '1', 'jobs', { maximum: MAX_JOBS }),
    worker: false,
    files: [],
  };
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (positionalOnly) {
      options.files.push(argument);
      continue;
    }
    if (argument === '--') {
      positionalOnly = true;
      continue;
    }
    if (argument === '--worker') {
      options.worker = true;
      continue;
    }

    const match = argument.match(/^--(shard-index|shard-count|jobs)(?:=(.*))?$/);
    if (match) {
      const name = match[1];
      const value = match[2] === undefined ? argv[++index] : match[2];
      if (value === undefined) throw new RangeError(`missing value for --${name}`);
      const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const maximum = key === 'jobs' ? MAX_JOBS : Number.MAX_SAFE_INTEGER;
      options[key] = key === 'shardIndex'
        ? parseNonNegativeInteger(value, key, { maximum })
        : parsePositiveInteger(value, key, { maximum });
      continue;
    }
    if (argument.startsWith('-')) {
      throw new RangeError(`unknown option: ${argument}`);
    }
    options.files.push(argument);
  }

  if (options.shardIndex >= options.shardCount) {
    throw new RangeError('shardIndex must be within the shardCount range');
  }
  // A worker receives an explicit file list and must not recursively create a
  // worker pool of its own.
  if (options.worker) {
    if (options.files.length === 0) throw new RangeError('--worker requires at least one test file');
    options.jobs = 1;
  }
  return options;
}

function assignShard(file, shardCount) {
  const count = parsePositiveInteger(shardCount, 'shardCount');
  // FNV-1a provides a stable, dependency-free assignment for callers that
  // need a file-level shard key. Weighted scheduling below is used by the CLI.
  let hash = 2166136261;
  for (const character of String(file)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

function fileWeight(file) {
  const hint = WEIGHT_HINTS[path.basename(file)];
  if (hint) return hint;
  try {
    // Scale bytes into a modest integer so a very large generated fixture does
    // not overwhelm the static hints while still influencing placement.
    return Math.max(1, Math.ceil(fs.statSync(file).size / 2048));
  } catch (_error) {
    return 1;
  }
}

function fileTimeoutMs(file, defaultTimeoutMs) {
  const timeoutMs = Number(defaultTimeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('defaultTimeoutMs must be a positive integer');
  }
  const hint = TIMEOUT_HINTS[path.basename(file)];
  return hint ? Math.max(timeoutMs, hint) : timeoutMs;
}

function partitionFiles(files, bucketCount) {
  const count = parsePositiveInteger(bucketCount, 'bucketCount');
  const buckets = Array.from({ length: count }, () => []);
  const weights = Array.from({ length: count }, () => 0);
  const entries = files.map((file, originalIndex) => ({
    file,
    originalIndex,
    weight: fileWeight(file),
  }));

  // Place expensive files first, breaking ties by their original discovery
  // order. This makes plans reproducible while minimizing the largest bucket.
  entries.sort((left, right) => (
    right.weight - left.weight || left.originalIndex - right.originalIndex
  ));
  for (const entry of entries) {
    let target = 0;
    for (let index = 1; index < count; index += 1) {
      if (weights[index] < weights[target]) target = index;
    }
    buckets[target].push(entry.file);
    weights[target] += entry.weight;
  }
  return buckets;
}

function prepareEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
    delete env[key];
  }
  if (!env.NODE_OPTIONS || !env.NODE_OPTIONS.includes('--max-old-space-size')) {
    env.NODE_OPTIONS = `--max-old-space-size=2048 ${env.NODE_OPTIONS || ''}`.trim();
  }
  return env;
}

function readTimeoutMs(env) {
  const timeoutMs = Number(env.DHPK_TEST_TIMEOUT_MS || 180000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`Invalid DHPK_TEST_TIMEOUT_MS: ${env.DHPK_TEST_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function runSequential(files, env, timeoutMs) {
  let failed = 0;
  for (const file of files) {
    const relative = path.relative(TESTS_DIR, file);
    console.log(`\n# ${relative}`);
    const result = runNodeTest(file, { env, timeoutMs: fileTimeoutMs(file, timeoutMs) });
    if (result.status !== 0 || result.error) {
      failed += 1;
      if (result.error) console.error(`ERROR in ${relative}: ${result.error.message}`);
    }
  }
  return { failed, total: files.length };
}

function parseWorkerSummary(output, fallbackTotal) {
  const match = output.match(/(PASS|FAIL):\s+(\d+)\/(\d+) test file\(s\) (?:passed|failed)/);
  if (!match) return { failed: fallbackTotal, total: fallbackTotal };
  return {
    failed: match[1] === 'FAIL' ? Number(match[2]) : 0,
    total: Number(match[3]),
  };
}

function runWorker(files, workerIndex, workerCount, env) {
  return new Promise((resolve) => {
    const childEnv = { ...env, DHPK_TEST_JOBS: '1' };
    const child = spawn(process.execPath, [__filename, '--worker', ...files], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ workerIndex, workerCount, files, stdout, stderr, ...result });
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish({ status: null, error }));
    child.once('close', (status, signal) => finish({ status, signal }));
  });
}

async function runParallel(files, jobs, env) {
  if (files.length === 0) return { failed: 0, total: 0 };
  const workerCount = Math.min(jobs, files.length);
  const buckets = partitionFiles(files, workerCount);
  const results = await Promise.all(
    buckets.map((bucket, index) => runWorker(bucket, index, workerCount, env))
  );
  let failed = 0;
  let total = 0;
  for (const result of results.sort((left, right) => left.workerIndex - right.workerIndex)) {
    console.log(`\n# worker ${result.workerIndex + 1}/${result.workerCount}`);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const summary = parseWorkerSummary(
      `${result.stdout}\n${result.stderr}`,
      result.files.length
    );
    failed += summary.failed;
    total += summary.total;
    if (result.error) {
      console.error(`ERROR in worker ${result.workerIndex + 1}: ${result.error.message}`);
    }
  }
  return { failed, total };
}

async function main(argv = process.argv.slice(2), sourceEnv = process.env) {
  const options = parseOptions(argv, sourceEnv);
  const env = prepareEnv(sourceEnv);
  const timeoutMs = readTimeoutMs(env);
  let files = options.files.length ? options.files.slice() : findTests(TESTS_DIR).sort();

  if (!options.files.length && options.shardCount > 1) {
    files = partitionFiles(files, options.shardCount)[options.shardIndex] || [];
  }
  const result = options.worker || options.jobs === 1
    ? runSequential(files, env, timeoutMs)
    : await runParallel(files, options.jobs, env);

  console.log('\n========================================');
  if (result.failed > 0) {
    console.error(`FAIL: ${result.failed}/${result.total} test file(s) failed`);
    return 1;
  }
  console.log(`PASS: ${result.total}/${result.total} test file(s) passed`);
  return 0;
}

if (require.main === module) {
  main().then((status) => process.exitCode = status).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

module.exports = {
  assignShard,
  findTests,
  parseOptions,
  partitionFiles,
  fileTimeoutMs,
};
