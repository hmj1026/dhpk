#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateAgentsSkillsProjection } = require('../lib/agents-skills-package');

function usage() {
  return [
    'Usage: node scripts/ci/validate-agents-skills.js [options] [out-dir]',
    '  --repo-root <dir>     Canonical repository root (defaults to this checkout)',
    '  --source-root <dir>   Override the canonical source root',
    '  --project-root <dir>  Consumer project whose projection is validated',
    '  --out-dir <dir>       Projection directory (also accepted positionally)',
    '  -h, --help            Show this help without reading the inventory',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    repoRoot: path.join(__dirname, '..', '..'),
    sourceRoot: null,
    projectRoot: null,
    outDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { ...args, help: true };
    else if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--source-root') args.sourceRoot = argv[++index];
    else if (arg === '--project-root') args.projectRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (!arg.startsWith('--') && !args.outDir) args.outDir = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const root = path.resolve(args.sourceRoot || args.repoRoot);
  const projectRoot = args.projectRoot ? path.resolve(args.projectRoot) : null;
  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : (projectRoot ? null : path.join(root, '.agents', 'skills'));
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) throw new Error(`distribution inventory not found: ${inventoryPath}`);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const result = validateAgentsSkillsProjection({
    root,
    sourceRoot: args.sourceRoot ? root : undefined,
    projectRoot: projectRoot || undefined,
    outDir,
    inventory,
  });
  if (!result.ok) {
    console.error(`FAIL [agents-skills]: ${result.errors.join('; ')}`);
    process.exit(1);
  }
  console.log(`PASS [agents-skills]: ${result.selectedIds.length} selected skills; runtime=${result.runtime}`);
} catch (error) {
  console.error(`FAIL [agents-skills]: ${error.message}`);
  process.exit(1);
}
