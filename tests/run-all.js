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

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function relativeTestFile(file) {
  return path.relative(TESTS_DIR, file) || path.basename(file);
}

function summarizeTestOutput(output) {
  const summaries = [];
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/^\s*[^:\n]+:\s+(\d+)\/(\d+)\s+passed\b/i);
    if (match) summaries.push({ passed: Number(match[1]), total: Number(match[2]) });
  }
  const skipped = String(output || '').split('\n').filter((line) => (
    /^\s*(?:SKIP|SKIPPED)\b/i.test(line) || /\(skipped\)\s*$/i.test(line)
  )).length;
  if (summaries.length === 0 && skipped === 0) {
    return { status: 'UNAVAILABLE', total: null, passed: null, failed: null, skipped: null };
  }
  const passed = summaries.reduce((total, summary) => total + summary.passed, 0);
  const total = summaries.reduce((sum, summary) => sum + summary.total, 0);
  return {
    status: 'OBSERVED',
    total,
    passed,
    failed: total - passed,
    skipped,
  };
}

function createFileTiming(file, result, durationMs) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    file: relativeTestFile(file),
    duration_ms: Math.round(durationMs),
    status: result.error || result.status !== 0 ? 'FAIL' : 'PASS',
    assertions: summarizeTestOutput(output),
  };
}

function runSequential(files, env, timeoutMs) {
  let failed = 0;
  const fileTimings = [];
  const startedAt = process.hrtime.bigint();
  for (const file of files) {
    const relative = path.relative(TESTS_DIR, file);
    console.log(`\n# ${relative}`);
    const fileStartedAt = process.hrtime.bigint();
    const result = runNodeTest(file, { env, timeoutMs: fileTimeoutMs(file, timeoutMs), captureOutput: true });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fileTimings.push(createFileTiming(file, result, elapsedMilliseconds(fileStartedAt)));
    if (result.status !== 0 || result.error) {
      failed += 1;
      if (result.error) console.error(`ERROR in ${relative}: ${result.error.message}`);
    }
  }
  return {
    failed,
    total: files.length,
    durationMs: elapsedMilliseconds(startedAt),
    fileTimings,
    jobTimings: [{ worker_index: 0, duration_ms: Math.round(elapsedMilliseconds(startedAt)), files: fileTimings }],
  };
}

function parseWorkerSummary(output, fallbackTotal) {
  const match = output.match(/(PASS|FAIL):\s+(\d+)\/(\d+) test file\(s\) (?:passed|failed)/);
  if (!match) return { failed: fallbackTotal, total: fallbackTotal };
  return {
    failed: match[1] === 'FAIL' ? Number(match[2]) : 0,
    total: Number(match[3]),
  };
}

function parseTimingPayload(output) {
  const lines = String(output).split('\n');
  const line = lines.find((entry) => entry.startsWith('DHPK_TEST_TIMING_PAYLOAD='));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('DHPK_TEST_TIMING_PAYLOAD='.length));
  } catch (_error) {
    return null;
  }
}

function runWorker(files, workerIndex, workerCount, env) {
  return new Promise((resolve) => {
    const timingRequested = Boolean(env.DHPK_TEST_TIMING_FILE);
    const childEnv = {
      ...env,
      DHPK_TEST_JOBS: '1',
      ...(timingRequested ? { DHPK_TEST_TIMING_CHILD: '1' } : {}),
    };
    const startedAt = process.hrtime.bigint();
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
      resolve({
        workerIndex,
        workerCount,
        files,
        stdout,
        stderr,
        durationMs: elapsedMilliseconds(startedAt),
        timing: timingRequested ? parseTimingPayload(stdout) : null,
        ...result,
      });
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish({ status: null, error }));
    child.once('close', (status, signal) => finish({ status, signal }));
  });
}

async function runParallel(files, jobs, env) {
  if (files.length === 0) {
    return { failed: 0, total: 0, durationMs: 0, fileTimings: [], jobTimings: [] };
  }
  const startedAt = process.hrtime.bigint();
  const workerCount = Math.min(jobs, files.length);
  const buckets = partitionFiles(files, workerCount);
  const results = await Promise.all(
    buckets.map((bucket, index) => runWorker(bucket, index, workerCount, env))
  );
  let failed = 0;
  let total = 0;
  const fileTimings = [];
  const jobTimings = [];
  for (const result of results.sort((left, right) => left.workerIndex - right.workerIndex)) {
    console.log(`\n# worker ${result.workerIndex + 1}/${result.workerCount}`);
    const visibleStdout = result.stdout
      ? result.stdout.replace(/^DHPK_TEST_TIMING_PAYLOAD=.*\n?/m, '')
      : '';
    if (visibleStdout) process.stdout.write(visibleStdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const summary = parseWorkerSummary(
      `${result.stdout}\n${result.stderr}`,
      result.files.length
    );
    failed += summary.failed;
    total += summary.total;
    const workerFiles = result.timing && Array.isArray(result.timing.file_timings)
      ? result.timing.file_timings
      : result.files.map((file) => ({
        file: relativeTestFile(file),
        duration_ms: null,
        status: result.status === 0 ? 'PASS' : 'FAIL',
        assertions: { status: 'UNAVAILABLE', total: null, passed: null, failed: null, skipped: null },
      }));
    fileTimings.push(...workerFiles);
    jobTimings.push({
      worker_index: result.workerIndex,
      duration_ms: Math.round(result.timing && Number.isFinite(result.timing.duration_ms)
        ? result.timing.duration_ms
        : result.durationMs),
      status: result.status === 0 && !result.error ? 'PASS' : 'FAIL',
      files: workerFiles,
    });
    if (result.error) {
      console.error(`ERROR in worker ${result.workerIndex + 1}: ${result.error.message}`);
    }
  }
  return {
    failed,
    total,
    durationMs: elapsedMilliseconds(startedAt),
    fileTimings,
    jobTimings,
  };
}

function summarizeSuite(fileTimings, predicate = () => true) {
  const files = fileTimings.filter(predicate);
  const observed = files.map((file) => file.assertions).filter((assertions) => assertions && assertions.status === 'OBSERVED');
  const skipObserved = observed.some((assertions) => assertions.skipped != null);
  return {
    status: observed.length === files.length && skipObserved ? 'OBSERVED' : 'PARTIAL',
    files: files.length,
    assertions: {
      total: observed.every((assertions) => assertions.total != null) ? observed.reduce((sum, assertions) => sum + assertions.total, 0) : null,
      passed: observed.every((assertions) => assertions.passed != null) ? observed.reduce((sum, assertions) => sum + assertions.passed, 0) : null,
      failed: observed.every((assertions) => assertions.failed != null) ? observed.reduce((sum, assertions) => sum + assertions.failed, 0) : null,
      skipped: skipObserved ? observed.reduce((sum, assertions) => sum + (assertions.skipped || 0), 0) : null,
    },
  };
}

function isSmokeFile(file) {
  return /(?:^|[-_.])smoke(?:[-_.]|$)/i.test(path.basename(file.file || ''));
}

function createTimingReport({ options, result, durationMs, sourceEnv }) {
  return {
    schema: 'dhpk.test-timing.v1',
    generated_at: new Date().toISOString(),
    source_commit: sourceEnv.DHPK_TEST_SOURCE_COMMIT || null,
    ci: {
      run_id: sourceEnv.DHPK_TEST_RUN_ID || null,
      run_attempt: sourceEnv.DHPK_TEST_RUN_ATTEMPT || null,
      event: sourceEnv.DHPK_TEST_EVENT || null,
      ref: sourceEnv.DHPK_TEST_REF || null,
      head_sha: sourceEnv.DHPK_TEST_HEAD_SHA || null,
      base_ref: sourceEnv.DHPK_TEST_BASE_REF || null,
      base_sha: sourceEnv.DHPK_TEST_BASE_SHA || null,
    },
    runner: {
      command: 'node tests/run-all.js',
      node: process.version,
      platform: process.platform,
      jobs: options.jobs,
      mode: options.worker ? 'worker' : options.jobs === 1 ? 'sequential' : 'parallel',
      shard_index: options.shardIndex,
      shard_count: options.shardCount,
    },
    duration_ms: Math.round(durationMs),
    totals: { files: result.total, failed: result.failed },
    suites: {
      smoke: summarizeSuite(result.fileTimings || [], isSmokeFile),
      full_suite: summarizeSuite(result.fileTimings || []),
    },
    files: result.fileTimings || [],
    jobs: result.jobTimings || [],
  };
}

function writeTimingReport(file, report) {
  const target = path.resolve(process.cwd(), file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
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

  const timingFile = sourceEnv.DHPK_TEST_TIMING_FILE;
  if (timingFile && sourceEnv.DHPK_TEST_TIMING_CHILD === '1') {
    console.log(`DHPK_TEST_TIMING_PAYLOAD=${JSON.stringify({
      duration_ms: Math.round(result.durationMs),
      file_timings: result.fileTimings || [],
      job_timings: result.jobTimings || [],
    })}`);
  } else if (timingFile) {
    try {
      writeTimingReport(timingFile, createTimingReport({
        options,
        result,
        durationMs: result.durationMs,
        sourceEnv,
      }));
    } catch (error) {
      // Timing is diagnostic evidence. A broken artifact destination must not
      // replace the authoritative aggregate test result.
      console.error(`WARNING: unable to write test timing report: ${error.message}`);
    }
  }

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
  createTimingReport,
  parseTimingPayload,
};
