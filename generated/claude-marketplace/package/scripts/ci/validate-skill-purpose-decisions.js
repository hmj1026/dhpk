#!/usr/bin/env node
'use strict';

// CI gate for issue #469. The checked-in ledger is a decision record, while
// manifests/distribution-inventory.json remains the identity/publication SSOT.

const fs = require('node:fs');
const path = require('node:path');
const { createReporter } = require('./_lib/report');
const { validateSkillPurposeDecisions } = require('../lib/skill-purpose-decisions');

const ROOT = path.join(__dirname, '..', '..');
const INVENTORY_FILE = path.join(ROOT, 'manifests', 'distribution-inventory.json');
const LEDGER_FILE = path.join(ROOT, 'manifests', 'skill-purpose-decisions.json');
const reporter = createReporter('skill-purpose-decisions');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    reporter.err(`${path.relative(ROOT, file)} cannot be read: ${error.message}`);
    return null;
  }
}

function main() {
  const inventory = readJson(INVENTORY_FILE);
  const ledger = readJson(LEDGER_FILE);
  if (!inventory || !ledger) return false;
  const result = validateSkillPurposeDecisions({ inventory, ledger, root: ROOT });
  for (const error of result.errors) reporter.err(error);
  if (result.ok) {
    reporter.done(`${result.effective.length} active skills have an explicit purpose disposition`);
    return true;
  }
  return false;
}

if (require.main === module) {
  try {
    if (!main()) process.exitCode = 1;
  } catch (error) {
    reporter.err(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
