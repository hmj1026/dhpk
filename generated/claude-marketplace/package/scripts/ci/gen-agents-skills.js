#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { materializeAgentsSkillsProjection } = require('../lib/agents-skills-package');

function parseArgs(argv) {
  const args = { repoRoot: path.join(__dirname, '..', '..'), outDir: null, update: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (arg === '--update') args.update = true;
    else if (!arg.startsWith('--') && !args.outDir) args.outDir = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function fail(message) {
  console.error(`FAIL [gen-agents-skills]: ${message}`);
  process.exit(1);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.repoRoot);
  const outDir = path.resolve(args.outDir || path.join(root, '.agents', 'skills'));
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) fail(`distribution inventory not found: ${inventoryPath}`);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const result = materializeAgentsSkillsProjection({ root, inventory, outDir, allowCanonicalChanges: args.update });
  console.log(`gen-agents-skills: wrote ${result.selectedIds.length} selected skills and ${result.managedPaths.length} managed files`);
} catch (error) {
  fail(error.message);
}
