#!/usr/bin/env node
'use strict';

// Validate a tracked or disposable standard Agent Plugin package.  Structural
// conformance and client execution are intentionally separate gates.

const path = require('node:path');
const {
  verifyAgentPluginPackage,
} = require('../lib/agent-plugin-package');
const { validateSurfaceReceipt } = require('../lib/platform-provenance');
const fs = require('node:fs');

function parseArgs(argv) {
  const args = { packageRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-root' || arg === '--package') args.packageRoot = argv[++index];
    else if (!arg.startsWith('--') && !args.packageRoot) args.packageRoot = arg;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.packageRoot) {
  console.error('usage: validate-agent-plugin-package.js <packageRoot>');
  process.exit(2);
}

const packageRoot = path.resolve(args.packageRoot);
// The compatibility validator remains the report/exit contract. Its internal
// structural adapter now presents the result through verifyDistribution so a
// CLI consumer cannot accidentally treat a raw validator payload as evidence.
const structural = verifyAgentPluginPackage(packageRoot);
const errors = [...structural.errors];
const provenancePath = path.join(packageRoot, 'provenance.json');
let provenance = null;
if (!fs.existsSync(provenancePath)) errors.push('provenance.json is missing');
else {
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    const checked = validateSurfaceReceipt(provenance, 'agent-plugin');
    errors.push(...checked.errors);
  } catch (error) {
    errors.push(`provenance.json is not valid JSON: ${error.message}`);
  }
}

const report = {
  surface: 'agent-plugin',
  packageRoot,
  structural: structural.ok ? 'PASS' : 'FAIL',
  errors,
  warnings: structural.warnings,
  skills: structural.skills,
  mcp: structural.mcp,
  provenance: provenance ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
