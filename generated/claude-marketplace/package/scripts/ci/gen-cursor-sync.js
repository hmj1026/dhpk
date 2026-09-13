#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { materializeCursorSyncTree, validateCursorSyncTree } = require('../lib/cursor-sync-package');

function parseArgs(argv) {
  const args = {
    repoRoot: path.join(__dirname, '..', '..'),
    outDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (!arg.startsWith('--') && !args.outDir) args.outDir = arg;
  }
  return args;
}

function fail(message) {
  console.error(`FAIL [gen-cursor-sync]: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.repoRoot);
const outDir = path.resolve(args.outDir || path.join(root, 'cursor'));
const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
if (!fs.existsSync(inventoryPath)) fail(`distribution inventory not found: ${inventoryPath}`);

let inventory;
try { inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')); } catch (error) { fail(`invalid distribution inventory: ${error.message}`); }

let result;
try {
  result = materializeCursorSyncTree({ inventory, root, outDir });
} catch (error) {
  fail(error.message);
}

const validation = validateCursorSyncTree({ root, outDir, inventory });
if (!validation.ok) fail(validation.errors.join('; '));

console.log(`gen-cursor-sync: wrote ${result.skills.length} skill links, ${result.agents.length} agents, ${result.rules.length} rules, ${result.commands.length} commands, ${result.supporting.length} support files`);
