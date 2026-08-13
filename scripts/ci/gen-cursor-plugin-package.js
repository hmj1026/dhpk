#!/usr/bin/env node
'use strict';

// Materialize the inventory-selected Cursor Plugin projection.
//
//   node scripts/ci/gen-cursor-plugin-package.js <outDir>
//     [--repo-root <path>] [--version=X.Y.Z] [--source-commit=<sha>]
//     [--smoke]

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  compileCursorPackage,
  materializeCursorPackage,
  verifyCursorPackage,
  runCursorConsumerProbe,
} = require('../lib/cursor-plugin-package');

function parseArgs(argv) {
  const args = {
    repoRoot: path.join(__dirname, '..', '..'),
    outDir: null,
    version: null,
    sourceCommit: null,
    smoke: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (arg === '--smoke') args.smoke = true;
    else if (arg.startsWith('--version=')) args.version = arg.slice('--version='.length);
    else if (arg === '--version') args.version = argv[++index];
    else if (arg.startsWith('--source-commit=')) args.sourceCommit = arg.slice('--source-commit='.length);
    else if (arg === '--source-commit') args.sourceCommit = argv[++index];
    else if (!arg.startsWith('--') && !args.outDir) args.outDir = arg;
  }
  return args;
}

function resolveSourceCommit(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function readVersion(root, explicit) {
  if (explicit) return explicit;
  const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function fail(message) {
  console.error(`FAIL [gen-cursor-plugin-package]: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.outDir) fail('usage: node scripts/ci/gen-cursor-plugin-package.js <outDir> [--repo-root <path>] [--version=X.Y.Z] [--smoke]');
const root = path.resolve(args.repoRoot);
const outDir = path.resolve(args.outDir);
const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
if (!fs.existsSync(inventoryPath)) fail(`distribution inventory not found: ${inventoryPath}`);

let inventory;
try { inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')); } catch (error) { fail(`invalid distribution inventory: ${error.message}`); }

let result;
try {
  const compiledProjection = compileCursorPackage({
    inventory,
    root,
    outDir,
    version: readVersion(root, args.version),
    sourceCommit: args.sourceCommit || resolveSourceCommit(root),
  });
  result = materializeCursorPackage({
    inventory,
    root,
    outDir,
    version: readVersion(root, args.version),
    sourceCommit: args.sourceCommit || resolveSourceCommit(root),
    compiledProjection,
  });
} catch (error) {
  fail(error.message);
}

const validation = verifyCursorPackage({ packageRoot: outDir, stage: 'structural' });
const structural = validation.structural || validation;
if (!structural.ok) {
  for (const error of structural.errors) console.error(`ERROR [gen-cursor-plugin-package]: ${error}`);
  fail('generated Cursor package failed package-boundary, frontmatter, hook, variable, or secret validation');
}

const consumer = args.smoke
  ? runCursorConsumerProbe({ packageRoot: outDir })
  : { status: 'NOT_RUN', reason: 'Cursor consumer probe not requested' };
const payload = {
  surface: 'cursor-plugin',
  packageRoot: outDir,
  skillCount: result.skillNames.length,
  skippedSkills: result.skippedSkills,
  structural: 'PASS',
  consumer,
};
if (args.smoke) {
  console.log(JSON.stringify(payload));
  if (consumer.status === 'FAIL' || consumer.status === 'BLOCKED') process.exit(1);
} else {
  console.log(`PASS [gen-cursor-plugin-package]: wrote ${result.skillNames.length} Cursor skills and validated package structure (${consumer.status})`);
}
