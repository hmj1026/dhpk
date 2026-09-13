#!/usr/bin/env node
'use strict';

// Validate an existing physical Cursor package and, optionally, run the
// separate local consumer gate.  Structural PASS never upgrades an absent or
// unexecuted Cursor client probe.

const fs = require('node:fs');
const path = require('node:path');
const {
  verifyCursorPackage,
  runCursorConsumerProbe,
} = require('../lib/cursor-plugin-package');
const { validateSurfaceReceipt } = require('../lib/platform-provenance');

function parseArgs(argv) {
  const args = { packageRoot: null, repoRoot: null, consumer: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-root' || arg === '--package') args.packageRoot = argv[++index];
    else if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--consumer' || arg === '--smoke') args.consumer = true;
    else if (!arg.startsWith('--') && !args.packageRoot) args.packageRoot = arg;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.packageRoot) {
  console.error('usage: node scripts/ci/validate-cursor-plugin-package.js <packageRoot> [--repo-root <root>] [--consumer]');
  process.exit(2);
}
const packageRoot = path.resolve(args.packageRoot);
const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : path.resolve(packageRoot, '..', '..');
const inventoryPath = path.join(repoRoot, 'manifests', 'distribution-inventory.json');
let inventory = null;
try { inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')); } catch (_) { /* validation remains fail-closed for runtime overlap */ }
const verification = verifyCursorPackage({ packageRoot, stage: 'structural', inventory });
const structural = verification.structural || verification;
let provenance = null;
const provenancePath = path.join(packageRoot, 'provenance.json');
const provenanceErrors = [];
if (!fs.existsSync(provenancePath)) provenanceErrors.push('provenance.json is missing');
else {
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    provenanceErrors.push(...validateSurfaceReceipt(provenance, 'cursor-plugin').errors);
  } catch (error) {
    provenanceErrors.push(`provenance.json is not valid JSON: ${error.message}`);
  }
}
const consumer = args.consumer
  ? runCursorConsumerProbe({ packageRoot })
  : { surface: 'cursor-plugin', status: 'NOT_RUN', reason: 'Cursor consumer probe not requested' };
const report = {
  surface: 'cursor-plugin',
  packageRoot,
  structural: structural.ok ? 'PASS' : 'FAIL',
  errors: [...structural.errors, ...provenanceErrors],
  skippedSkills: structural.skippedSkills,
  consumer,
  provenance: provenance ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
if (report.errors.length > 0 || consumer.status === 'FAIL' || consumer.status === 'BLOCKED') process.exit(1);
