#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function fail(message) {
  process.stderr.write(`::error::${message}\n`);
  process.exitCode = 1;
}

function classifyHarnessResult(result, rawExit) {
  const current = result && result.schema === 'dhpk.harness.result.v2';
  const hasAcceptance = result && Object.prototype.hasOwnProperty.call(result, 'acceptance');
  if (!current) {
    if (hasAcceptance) throw new Error('non-current harness JSON cannot carry current acceptance evidence');
    return 'LEGACY';
  }

  const acceptance = result.acceptance;
  if (!acceptance || !['PASS', 'FAIL', 'BLOCKED'].includes(acceptance.verdict)
    || !Array.isArray(acceptance.requiredChecks) || acceptance.requiredChecks.length === 0
    || !Array.isArray(acceptance.excludedChecks)) {
    throw new Error('current harness JSON has an invalid acceptance envelope');
  }

  const expectedExit = result.outcome === 'COMPLETE' ? 0 : 1;
  if (result.exitCode !== expectedExit || Number(rawExit) !== expectedExit) {
    throw new Error(`current outcome ${result.outcome} requires exit ${expectedExit}`);
  }
  if (acceptance.verdict !== 'PASS' && result.outcome === 'COMPLETE') {
    throw new Error('current non-pass acceptance cannot report COMPLETE');
  }
  return 'CURRENT';
}

function main(argv) {
  const [resultFile, rawExit, ...unexpected] = argv;
  if (!resultFile || rawExit === undefined || unexpected.length > 0) {
    fail('usage: validate-harness-result.js <result-file> <process-exit>');
    return;
  }

  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } catch (_) {
    fail('harness result could not be read as JSON');
    return;
  }

  try {
    process.stdout.write(`${classifyHarnessResult(result, rawExit)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { classifyHarnessResult };
