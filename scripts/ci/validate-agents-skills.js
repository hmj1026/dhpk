#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateAgentsSkillsProjection } = require('../lib/agents-skills-package');

function parseArgs(argv) {
  const args = { repoRoot: path.join(__dirname, '..', '..'), outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (!arg.startsWith('--') && !args.outDir) args.outDir = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.repoRoot);
  const outDir = path.resolve(args.outDir || path.join(root, '.agents', 'skills'));
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) throw new Error(`distribution inventory not found: ${inventoryPath}`);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const result = validateAgentsSkillsProjection({ root, inventory, outDir });
  if (!result.ok) {
    console.error(`FAIL [agents-skills]: ${result.errors.join('; ')}`);
    process.exit(1);
  }
  console.log(`PASS [agents-skills]: ${result.selectedIds.length} selected skills; runtime=${result.runtime}`);
} catch (error) {
  console.error(`FAIL [agents-skills]: ${error.message}`);
  process.exit(1);
}
