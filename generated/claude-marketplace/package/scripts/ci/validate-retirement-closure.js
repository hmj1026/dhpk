#!/usr/bin/env node
'use strict';

// One CI gate for the issue #534 P2 breaking wave. The composed validator
// delegates schema checks to the inventory-owned purpose/command validators
// and then checks path absence, successor closure, and active references.

const { createReporter } = require('./_lib/report');
const { validateRetirementClosure } = require('../lib/retirement-closure');

const ROOT = require('node:path').join(__dirname, '..', '..');

function main(root = ROOT) {
  const reporter = createReporter('retirement-closure');
  const result = validateRetirementClosure({ root });
  for (const error of result.errors) reporter.err(error);
  if (result.ok) {
    reporter.done(`validated ${result.currentWaveIds.length} current-wave skills and ${result.removedCommandIds.length} removed commands; no active references remain`);
    return true;
  }
  return false;
}

if (require.main === module) {
  try {
    if (!main()) process.exitCode = 1;
  } catch (error) {
    const reporter = createReporter('retirement-closure');
    reporter.err(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
