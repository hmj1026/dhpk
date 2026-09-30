#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { findTests } = require('../../tests/run-all');

const TIMING_SCHEMA = 'dhpk.test-timing.v1';
const EXPECTED_JOBS = 4;
const SHARD_IMBALANCE_WARNING_RATIO = 2.0;
const ARTIFACT_PREFIX = 'dhpk-test-timing-';
const EMPTY_ASSERTIONS = Object.freeze({ total: 0, passed: 0, failed: 0, skipped: 0 });

function failureResult(errors) {
  return {
    ok: false,
    errors,
    durationMs: null,
    files: 0,
    assertions: { ...EMPTY_ASSERTIONS },
  };
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateAssertionSummary(assertions, label, requireObservedStatus = true, allowUnknownSkipped = false) {
  if (!assertions || typeof assertions !== 'object' || Array.isArray(assertions)) {
    return [`${label} has no assertion summary.`];
  }
  if (requireObservedStatus && assertions.status !== 'OBSERVED') {
    return [`${label} assertion evidence is not observed.`];
  }

  const counts = ['total', 'passed', 'failed'];
  if (!allowUnknownSkipped || assertions.skipped !== null) counts.push('skipped');
  const invalidCount = counts.find((field) => !isCount(assertions[field]));
  if (invalidCount) return [`${label} has an invalid ${invalidCount} assertion count.`];
  if (assertions.total !== assertions.passed + assertions.failed) {
    return [`${label} assertion totals are inconsistent.`];
  }
  if (assertions.failed !== 0) return [`${label} contains failed assertions.`];
  return [];
}

function normalizeReportFile(file, label) {
  if (typeof file !== 'string' || file.length === 0 || file.includes('\\')) {
    return { errors: [`${label} has an invalid test file path.`], file: null };
  }
  if (path.posix.isAbsolute(file) || file.split('/').some((part) => part === '..' || part === '.')) {
    return { errors: [`${label} has an unsafe test file path.`], file: null };
  }
  return { errors: [], file };
}

function validateFileTiming(entry, label) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { errors: [`${label} is not a file timing record.`], file: null, assertions: null };
  }

  const normalized = normalizeReportFile(entry.file, label);
  errors.push(...normalized.errors);
  if (entry.status !== 'PASS') errors.push(`${label} did not pass.`);
  if (!isNonNegativeNumber(entry.duration_ms)) errors.push(`${label} has no valid duration.`);
  errors.push(...validateAssertionSummary(entry.assertions, label));

  return {
    errors,
    file: normalized.file,
    assertions: entry.assertions,
  };
}

function sumAssertionRecords(records) {
  return records.reduce((totals, record) => ({
    total: totals.total + record.assertions.total,
    passed: totals.passed + record.assertions.passed,
    failed: totals.failed + record.assertions.failed,
    skipped: totals.skipped + record.assertions.skipped,
  }), { ...EMPTY_ASSERTIONS });
}

function sameCounts(actual, expected) {
  return actual
    && actual.total === expected.total
    && actual.passed === expected.passed
    && actual.failed === expected.failed
    && actual.skipped === expected.skipped;
}

function validateSuiteSummary(suite, label, records, allowPartialWhenEmpty = false) {
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
    return [`${label} suite summary is missing.`];
  }
  const allowedStatuses = allowPartialWhenEmpty && records.length === 0
    ? ['OBSERVED', 'PARTIAL']
    : ['OBSERVED'];
  if (!allowedStatuses.includes(suite.status)) {
    return [`${label} suite assertion evidence is not observed.`];
  }
  if (!isCount(suite.files) || suite.files !== records.length) {
    return [`${label} suite file totals are inconsistent.`];
  }
  const partialEmpty = allowPartialWhenEmpty && records.length === 0 && suite.status === 'PARTIAL';
  const expected = partialEmpty
    ? { ...EMPTY_ASSERTIONS, skipped: null }
    : sumAssertionRecords(records);
  const assertionErrors = validateAssertionSummary(suite.assertions, `${label} suite`, false, partialEmpty);
  if (!sameCounts(suite.assertions, expected)) assertionErrors.push(`${label} suite assertion totals are inconsistent.`);
  return assertionErrors;
}

function validateShardReport(report, shardIndex, options) {
  const errors = [];
  const label = `shard ${shardIndex}`;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { errors: [`${label} timing report is not an object.`], files: [], durationMs: null };
  }
  if (report.schema !== TIMING_SCHEMA) errors.push(`${label} has an unsupported timing schema.`);
  if (report.source_commit !== options.checkoutSha) errors.push(`${label} checkout commit does not match CI.`);

  const ci = report.ci;
  if (!ci || typeof ci !== 'object' || Array.isArray(ci)) {
    errors.push(`${label} CI identity is missing.`);
  } else {
    if (ci.run_id !== options.runId) errors.push(`${label} run id does not match CI.`);
    if (ci.run_attempt !== options.runAttempt) errors.push(`${label} run attempt does not match CI.`);
    if (ci.head_sha !== options.headSha) errors.push(`${label} pull request head does not match CI.`);
  }

  const runner = report.runner;
  if (!runner || typeof runner !== 'object' || Array.isArray(runner)) {
    errors.push(`${label} runner topology is missing.`);
  } else {
    if (runner.command !== 'node tests/run-all.js') errors.push(`${label} used an unexpected test command.`);
    if (runner.jobs !== EXPECTED_JOBS) errors.push(`${label} worker count does not match CI.`);
    if (runner.shard_index !== shardIndex) errors.push(`${label} shard index does not match its artifact.`);
    if (runner.shard_count !== options.shardCount) errors.push(`${label} shard count does not match CI.`);
    if (runner.mode !== 'parallel') errors.push(`${label} did not run in parallel mode.`);
  }

  const durationMs = report.duration_ms;
  if (!isNonNegativeNumber(durationMs)) errors.push(`${label} has no valid shard duration.`);

  const fileEntries = Array.isArray(report.files) ? report.files : null;
  if (!fileEntries) {
    errors.push(`${label} has no file timing list.`);
  }
  const fileResults = (fileEntries || []).map((entry, index) => (
    validateFileTiming(entry, `${label} file ${index + 1}`)
  ));
  fileResults.forEach((result) => errors.push(...result.errors));
  const files = fileResults
    .filter((result) => result.file !== null && result.assertions)
    .map((result) => ({ file: result.file, assertions: result.assertions }));

  const totals = report.totals;
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) {
    errors.push(`${label} report totals are missing.`);
  } else {
    const failedFiles = fileEntries ? fileEntries.filter((entry) => entry && entry.status === 'FAIL').length : 0;
    if (totals.files !== files.length) errors.push(`${label} file totals are inconsistent.`);
    if (totals.failed !== failedFiles || totals.failed !== 0) errors.push(`${label} failure totals are inconsistent.`);
  }

  const smokeFiles = files.filter((entry) => /(?:^|[-_.])smoke(?:[-_.]|$)/i.test(path.posix.basename(entry.file)));
  const suites = report.suites;
  if (!suites || typeof suites !== 'object' || Array.isArray(suites)) {
    errors.push(`${label} suite summaries are missing.`);
  } else {
    errors.push(...validateSuiteSummary(suites.full_suite, `${label} full`, files, true));
    errors.push(...validateSuiteSummary(suites.smoke, `${label} smoke`, smokeFiles, true));
  }

  const jobEntries = Array.isArray(report.jobs) ? report.jobs : null;
  const jobFiles = [];
  if (!jobEntries) {
    errors.push(`${label} worker timing list is missing.`);
  } else {
    if (runner && Number.isInteger(runner.jobs) && runner.jobs > 0 && fileEntries) {
      const expectedWorkerCount = Math.min(runner.jobs, fileEntries.length);
      if (jobEntries.length !== expectedWorkerCount) {
        errors.push(`${label} active worker count does not match its file count.`);
      }
    }
    jobEntries.forEach((job, index) => {
      const jobLabel = `${label} worker ${index + 1}`;
      if (!job || typeof job !== 'object' || Array.isArray(job)) {
        errors.push(`${jobLabel} is not a timing record.`);
        return;
      }
      if (job.worker_index !== index) errors.push(`${jobLabel} index is inconsistent.`);
      if (job.status !== 'PASS') errors.push(`${jobLabel} did not pass.`);
      if (!isNonNegativeNumber(job.duration_ms)) errors.push(`${jobLabel} has no valid duration.`);
      if (!Array.isArray(job.files)) errors.push(`${jobLabel} has no file timing list.`);
      else job.files.forEach((entry, fileIndex) => {
        const result = validateFileTiming(entry, `${jobLabel} file ${fileIndex + 1}`);
        errors.push(...result.errors);
        if (result.file !== null && result.assertions) jobFiles.push({ file: result.file });
      });
    });
  }
  const reportedPaths = files.map((entry) => entry.file).sort();
  const workerPaths = jobFiles.map((entry) => entry.file).sort();
  if (reportedPaths.length !== workerPaths.length
    || reportedPaths.some((file, index) => file !== workerPaths[index])) {
    errors.push(`${label} worker timing files do not cover its reported test files exactly once.`);
  }

  return { errors, files, durationMs: isNonNegativeNumber(durationMs) ? durationMs : null };
}

function verifyShardReports(input = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failureResult(['verification options must be an object.']);
  }

  const {
    root = process.cwd(),
    directory,
    shardCount,
    runId,
    runAttempt,
    checkoutSha,
    headSha,
  } = input;
  if (typeof root !== 'string' || root.length === 0) errors.push('repository root is required.');
  if (typeof directory !== 'string' || directory.length === 0) errors.push('artifact directory is required.');
  if (!Number.isInteger(shardCount) || shardCount < 1) errors.push('shard count must be a positive integer.');
  if (typeof runId !== 'string' || runId.length === 0) errors.push('CI run id is required.');
  if (typeof runAttempt !== 'string' || runAttempt.length === 0) errors.push('CI run attempt is required.');
  if (typeof checkoutSha !== 'string' || checkoutSha.length === 0) errors.push('checkout commit is required.');
  if (typeof headSha !== 'string' || headSha.length === 0) errors.push('pull request head commit is required.');
  if (errors.length > 0) return failureResult(errors);

  try {
    const resolvedRoot = path.resolve(root);
    const testsDirectory = path.join(resolvedRoot, 'tests');
    const expectedFiles = findTests(testsDirectory)
      .map((file) => path.relative(testsDirectory, file).split(path.sep).join('/'))
      .sort();
    const resolvedDirectory = path.resolve(directory);
    const directoryEntries = fs.existsSync(resolvedDirectory)
      ? fs.readdirSync(resolvedDirectory, { withFileTypes: true })
      : [];
    const expectedDirectories = Array.from({ length: shardCount }, (_, index) => (
      `${ARTIFACT_PREFIX}${runId}-${runAttempt}-shard-${index}`
    ));
    const expectedDirectorySet = new Set(expectedDirectories);
    const artifactDirectories = directoryEntries.filter((entry) => entry.name.startsWith(ARTIFACT_PREFIX));

    if (!fs.existsSync(resolvedDirectory)) errors.push('artifact directory does not exist.');
    artifactDirectories
      .filter((entry) => !expectedDirectorySet.has(entry.name))
      .forEach(() => errors.push('unexpected shard timing artifact directory found.'));

    const allFiles = [];
    const shardDurations = [];
    expectedDirectories.forEach((directoryName, shardIndex) => {
      const directoryEntry = directoryEntries.find((entry) => entry.name === directoryName);
      if (!directoryEntry) {
        errors.push(`shard ${shardIndex} timing artifact is missing.`);
        return;
      }
      if (!directoryEntry.isDirectory()) {
        errors.push(`shard ${shardIndex} artifact path is not a directory.`);
        return;
      }

      const reportPath = path.join(resolvedDirectory, directoryName, 'dhpk-test-timing.json');
      if (!fs.existsSync(reportPath)) {
        errors.push(`shard ${shardIndex} timing report is missing.`);
        return;
      }

      let report;
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      } catch (error) {
        errors.push(`shard ${shardIndex} timing report is not valid JSON.`);
        return;
      }
      const result = validateShardReport(report, shardIndex, {
        shardCount, runId, runAttempt, checkoutSha, headSha,
      });
      errors.push(...result.errors);
      allFiles.push(...result.files);
      if (result.durationMs !== null) shardDurations.push(result.durationMs);
    });

    const fileCounts = allFiles.reduce((counts, item) => ({
      ...counts,
      [item.file]: (counts[item.file] || 0) + 1,
    }), {});
    expectedFiles
      .filter((file) => !fileCounts[file])
      .forEach((file) => errors.push(`discovered test file has no shard result: ${file}.`));
    Object.keys(fileCounts)
      .filter((file) => !expectedFiles.includes(file))
      .forEach((file) => errors.push(`shard report contains an undiscovered test file: ${file}.`));
    Object.keys(fileCounts)
      .filter((file) => fileCounts[file] > 1)
      .forEach((file) => errors.push(`test file appears in multiple shard reports: ${file}.`));

    if (errors.length > 0) return failureResult(errors);
    const assertions = sumAssertionRecords(allFiles);
    return {
      ok: true,
      errors: [],
      durationMs: Math.max(...shardDurations),
      shardDurations: shardDurations.slice(),
      files: allFiles.length,
      assertions,
    };
  } catch (error) {
    return failureResult([`unable to verify shard timing evidence: ${error.message}`]);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  const names = new Set(['--directory', '--count', '--run-id', '--run-attempt', '--checkout-sha', '--head-sha', '--summary']);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!names.has(name)) throw new Error(`unknown option: ${name}`);
    if (Object.prototype.hasOwnProperty.call(options, name)) throw new Error(`duplicate option: ${name}`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`value is required for ${name}`);
    }
    options[name] = value;
    index += 1;
  }

  const required = ['--directory', '--count', '--run-id', '--run-attempt', '--checkout-sha', '--head-sha'];
  const missing = required.find((name) => !options[name]);
  if (missing) throw new Error(`${missing} is required`);
  if (!/^\d+$/.test(options['--count']) || Number(options['--count']) < 1) {
    throw new Error('--count must be a positive integer');
  }

  return {
    directory: options['--directory'],
    shardCount: Number(options['--count']),
    runId: options['--run-id'],
    runAttempt: options['--run-attempt'],
    checkoutSha: options['--checkout-sha'],
    headSha: options['--head-sha'],
    summary: options['--summary'] || null,
  };
}

function formatSummary(result) {
  const lines = [
    '## CI test shard timing verification',
    '',
    `PASS: ${result.files} discovered test file(s), ${result.assertions.total} assertion(s); parallel duration ${result.durationMs} ms.`,
  ];
  const shardDurations = Array.isArray(result.shardDurations) ? result.shardDurations : [];
  let fastest = null;
  let slowest = null;
  shardDurations.forEach((durationMs, shardIndex) => {
    if (!isNonNegativeNumber(durationMs)) return;
    if (!fastest || durationMs < fastest.durationMs) fastest = { shardIndex, durationMs };
    if (!slowest || durationMs > slowest.durationMs) slowest = { shardIndex, durationMs };
  });
  if (fastest && slowest && shardDurations.filter(isNonNegativeNumber).length >= 2) {
    const imbalanced = fastest.durationMs === 0
      ? slowest.durationMs > 0
      : slowest.durationMs / fastest.durationMs > SHARD_IMBALANCE_WARNING_RATIO;
    if (imbalanced) {
      lines.push(`WARNING: shard timing imbalance; slowest shard ${slowest.shardIndex} took ${slowest.durationMs} ms, fastest shard ${fastest.shardIndex} took ${fastest.durationMs} ms.`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = verifyShardReports({ ...options, root: process.cwd() });
  if (!result.ok) {
    result.errors.forEach((error) => process.stderr.write(`FAIL: ${error}\n`));
    return 1;
  }

  const summary = formatSummary(result);
  if (options.summary) {
    const target = path.resolve(options.summary);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${summary}\n`);
  } else {
    process.stdout.write(`${summary}\n`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`verify-test-shards: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { main, parseArgs, verifyShardReports };
