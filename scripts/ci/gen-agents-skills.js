#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  materializeAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
} = require('../lib/agents-skills-package');

function parseArgs(argv) {
  const args = {
    repoRoot: path.join(__dirname, '..', '..'),
    sourceRoot: null,
    projectRoot: null,
    outDir: null,
    profileId: null,
    requestedHosts: [],
    update: false,
    adopt: false,
    repair: false,
    action: 'install',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--source-root') args.sourceRoot = argv[++index];
    else if (arg === '--project-root') args.projectRoot = argv[++index];
    else if (arg === '--out-dir') args.outDir = argv[++index];
    else if (arg === '--profile') args.profileId = argv[++index];
    else if (arg === '--host') args.requestedHosts.push(argv[++index]);
    else if (arg === '--update') args.update = true;
    else if (arg === '--adopt') args.adopt = true;
    else if (arg === '--repair') args.repair = true;
    else if (arg === '--uninstall') args.action = 'uninstall';
    else if (arg === '--rollback') args.action = 'rollback';
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
  const root = path.resolve(args.sourceRoot || args.repoRoot);
  const projectRoot = args.projectRoot ? path.resolve(args.projectRoot) : null;
  const outDir = args.outDir ? path.resolve(args.outDir) : (projectRoot ? null : path.join(root, '.agents', 'skills'));
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (args.action !== 'install' && !projectRoot) fail(`--${args.action} requires --project-root`);
  let inventory = null;
  if (fs.existsSync(inventoryPath)) inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (args.action === 'install') {
    if (!inventory) fail(`distribution inventory not found: ${inventoryPath}`);
    const result = materializeAgentsSkillsProjection({
      root,
      sourceRoot: args.sourceRoot ? root : undefined,
      projectRoot: projectRoot || undefined,
      outDir: outDir || undefined,
      inventory,
      profileId: args.profileId || undefined,
      requestedHosts: args.requestedHosts.length > 0 ? [...new Set(args.requestedHosts)].sort() : undefined,
      allowCanonicalChanges: args.update,
      adopt: args.adopt,
      repair: args.repair,
    });
    console.log(`gen-agents-skills: wrote ${result.selectedIds.length} selected skills and ${result.managedPaths.length} managed files`);
  } else {
    const operation = args.action === 'uninstall' ? uninstallAgentsSkillsProjection : rollbackAgentsSkillsProjection;
    const result = operation({ projectRoot, outDir: outDir || undefined, inventory: inventory || undefined });
    if (!result.ok) fail(result.error && result.error.message ? result.error.message : `${args.action} failed`);
    console.log(`gen-agents-skills: ${args.action} ${result.state || 'completed'}`);
  }
} catch (error) {
  fail(error.message);
}
