#!/usr/bin/env node
'use strict';

// Render the aggregate runner's optional timing evidence without becoming a
// second result gate. The test command owns pass/fail; this helper must still
// produce a useful summary when the test process failed, was cancelled, or
// never created its timing file.

const fs = require('node:fs');
const path = require('node:path');

function readTimingFile(file, filesystem = fs) {
  const target = path.resolve(file);
  if (!filesystem.existsSync(target)) {
    return {
      status: 'NOT_RUN',
      reason: 'timing file was not produced',
      file: target,
      report: null,
    };
  }
  try {
    const report = JSON.parse(filesystem.readFileSync(target, 'utf8'));
    if (!report || report.schema !== 'dhpk.test-timing.v1') {
      return {
        status: 'UNAVAILABLE',
        reason: 'timing file has an unsupported schema',
        file: target,
        report: null,
      };
    }
    return { status: 'OBSERVED', reason: null, file: target, report };
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      reason: `timing file is not valid JSON: ${error.message}`,
      file: target,
      report: null,
    };
  }
}

function formatDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return 'unknown';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function formatSuiteEvidence(label, suite) {
  const assertions = suite && suite.assertions || {};
  return `- ${label}: ${suite && suite.status || 'UNAVAILABLE'}; files=${suite && suite.files != null ? suite.files : 'unknown'}; assertions=${assertions.total != null ? assertions.total : 'unknown'}; skipped=${assertions.skipped != null ? assertions.skipped : 'unknown'}`;
}

function summarizeTiming(observed) {
  const lines = ['## Test timing evidence', ''];
  lines.push(`Evidence status: **${observed.status}**`);
  if (observed.reason) {
    lines.push(`Reason: ${observed.reason}`, '');
    return `${lines.join('\n')}\n`;
  }

  const report = observed.report;
  const runner = report.runner || {};
  const ci = report.ci || {};
  const totals = report.totals || {};
  lines.push(`Source commit: \`${report.source_commit || 'unknown'}\``);
  lines.push(`Runtime: \`${runner.node || 'unknown'}\` on \`${runner.platform || 'unknown'}\``);
  lines.push(`Command: \`${runner.command || 'unknown'}\`; jobs=${runner.jobs || 'unknown'}, shard=${runner.shard_index ?? 'unknown'}/${runner.shard_count ?? 'unknown'}`);
  lines.push(`Duration: ${formatDuration(report.duration_ms)}; files=${totals.files ?? 'unknown'}; failed=${totals.failed ?? 'unknown'}`);
  if (ci.run_id) lines.push(`CI run: \`${ci.run_id}\` attempt \`${ci.run_attempt || 'unknown'}\``);
  if (ci.event || ci.ref) lines.push(`Event/ref: \`${ci.event || 'unknown'}\` / \`${ci.ref || 'unknown'}\``);
  if (ci.base_ref || ci.base_sha) lines.push(`Base: \`${ci.base_ref || 'unknown'}\` / \`${ci.base_sha || 'unknown'}\``);
  lines.push('');
  lines.push('### Suite assertion evidence');
  lines.push(formatSuiteEvidence('smoke', report.suites && report.suites.smoke));
  lines.push(formatSuiteEvidence('full suite', report.suites && report.suites.full_suite));
  lines.push('');

  const files = Array.isArray(report.files) ? report.files.slice() : [];
  const failed = files.filter((entry) => entry.status === 'FAIL');
  const slowest = files
    .filter((entry) => Number.isFinite(Number(entry.duration_ms)))
    .sort((left, right) => Number(right.duration_ms) - Number(left.duration_ms))
    .slice(0, 5);
  lines.push('### Slowest files');
  if (slowest.length === 0) lines.push('- none recorded');
  else for (const entry of slowest) lines.push(`- \`${entry.file}\`: ${formatDuration(entry.duration_ms)} (${entry.status || 'unknown'})`);
  lines.push('');
  lines.push('### Failed files');
  if (failed.length === 0) lines.push('- none recorded');
  else for (const entry of failed) lines.push(`- \`${entry.file}\`: ${entry.status || 'FAIL'}`);
  lines.push('');
  lines.push('Timing is diagnostic evidence; the test command remains the authoritative pass/fail gate.');
  return `${lines.join('\n')}\n`;
}

function writeSummary(content, summaryFile, filesystem = fs) {
  if (!summaryFile) return false;
  const target = path.resolve(summaryFile);
  filesystem.mkdirSync(path.dirname(target), { recursive: true });
  filesystem.appendFileSync(target, content);
  return true;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { file: null, summary: process.env.GITHUB_STEP_SUMMARY || null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') options.file = argv[++index];
    else if (argument === '--summary') options.summary = argv[++index];
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.file) throw new Error('--file is required');
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const output = summarizeTiming(readTimingFile(options.file));
  if (!writeSummary(output, options.summary)) process.stdout.write(output);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    // This is a diagnostic step after the authoritative test command. Keep a
    // malformed invocation visible while preserving the test job's result.
    console.error(`render-test-timing: ${error.message}`);
    process.exitCode = 0;
  }
}

module.exports = {
  formatDuration,
  formatSuiteEvidence,
  parseArgs,
  readTimingFile,
  summarizeTiming,
  writeSummary,
};
