#!/usr/bin/env node
'use strict';

// Reconcile one explicitly declared canonical skill into the repository-owned
// Codex and Cursor sync surfaces. Native/plugin packages are deliberately out
// of scope: those are regenerated only after the source and mirror inputs land.

const fs = require('node:fs');
const path = require('node:path');

const SURFACES = Object.freeze([
  Object.freeze({ name: 'codex', inventorySurface: 'codex-sync' }),
  Object.freeze({ name: 'cursor', inventorySurface: 'cursor-sync' }),
]);

function parseArgs(argv) {
  const args = { repoRoot: path.join(__dirname, '..', '..'), skill: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--skill') args.skill = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.skill || !/^dhpk-[a-z0-9-]+$/.test(args.skill)) {
    throw new Error('--skill must be one canonical dhpk-* package name');
  }
  return args;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function regularDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a physical directory: ${directory}`);
}

function reconcileMirror({ root, canonicalDir, skill, surface }) {
  const skillsDir = path.join(root, surface.name, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  regularDirectory(skillsDir, `${surface.name}/skills`);

  const destination = path.join(skillsDir, skill);
  const target = `../../skills/${skill}`;
  if (fs.existsSync(destination) || fs.lstatSync(destination, { throwIfNoEntry: false })) {
    const stat = fs.lstatSync(destination);
    if (!stat.isSymbolicLink()) throw new Error(`${surface.name}/skills/${skill} exists but is not a symlink`);
    if (fs.readlinkSync(destination) !== target) {
      throw new Error(`${surface.name}/skills/${skill} has an unexpected target; refusing to overwrite it`);
    }
    if (fs.realpathSync(destination) !== fs.realpathSync(canonicalDir)) {
      throw new Error(`${surface.name}/skills/${skill} does not resolve to its canonical package`);
    }
    return 'verified';
  }

  fs.symlinkSync(target, destination);
  return 'created';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.repoRoot);
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(inventoryPath)) throw new Error(`distribution inventory not found: ${inventoryPath}`);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const skill = (inventory.skills || []).find((entry) => entry && entry.name === args.skill);
  if (!skill) throw new Error(`canonical skill is not registered in the distribution inventory: ${args.skill}`);
  if (!skill.surfaces || !SURFACES.every((surface) => skill.surfaces.includes(surface.inventorySurface))) {
    throw new Error(`${args.skill} must declare both codex-sync and cursor-sync before mirror reconciliation`);
  }

  const canonicalDir = path.resolve(root, skill.path || '');
  if (!isInside(path.join(root, 'skills'), canonicalDir) || path.basename(canonicalDir) !== args.skill) {
    throw new Error(`${args.skill} has an unsafe canonical inventory path: ${skill.path}`);
  }
  regularDirectory(canonicalDir, 'canonical skill');
  const skillFile = path.join(canonicalDir, 'SKILL.md');
  const skillStat = fs.lstatSync(skillFile);
  if (!skillStat.isFile() || skillStat.isSymbolicLink()) throw new Error(`canonical skill is missing a physical SKILL.md: ${skill.path}`);

  const results = SURFACES.map((surface) => ({
    surface: surface.name,
    status: reconcileMirror({ root, canonicalDir, skill: args.skill, surface }),
  }));
  console.log(`PASS [skill-mirror-reconcile]: ${args.skill} ${results.map((result) => `${result.surface}:${result.status}`).join(', ')}`);
}

try {
  main();
} catch (error) {
  console.error(`FAIL [skill-mirror-reconcile]: ${error.message}`);
  process.exit(1);
}
