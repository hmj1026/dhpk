#!/usr/bin/env node
'use strict';

// Structural/provenance validation is separate from an installed AGY CLI
// consumer probe.  A successful exit here never claims runtime support.

const fs = require('node:fs');
const path = require('node:path');
const {
  validateAgyPluginPackage,
} = require('../lib/agy-plugin-package');

const ROOT = path.join(__dirname, '..', '..');
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (positional.length !== 1) {
  console.error('usage: node scripts/ci/validate-agy-plugin-package.js <packageRoot>');
  process.exit(2);
}

const packageRoot = path.resolve(positional[0]);
const inventoryPath = path.join(ROOT, 'manifests', 'distribution-inventory.json');
const inventory = fs.existsSync(inventoryPath)
  ? JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
  : null;
const report = validateAgyPluginPackage(packageRoot, { inventory });
console.log(JSON.stringify({
  surface: 'agy-plugin',
  packageRoot,
  structural: report.ok ? 'PASS' : 'FAIL',
  errors: report.errors,
  warnings: report.warnings,
  agents: report.agents,
  skills: report.skills,
  rules: report.rules,
  provenance: report.provenance ? 'PASS' : 'FAIL',
}, null, 2));
process.exit(report.ok ? 0 : 1);
