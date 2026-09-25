#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { installNativeSharedSkills, uninstallNativeSharedSkills } = require('../lib/native-shared-skill-install');
const { classifyHostBinding } = require('../lib/cursor-consumer-evidence');

function parseArgs(argv) {
  const args = {
    action: 'install',
    sourceRoot: null,
    projectRoot: null,
    host: 'cursor',
    selectedStableIds: [],
    declaredSelection: false,
    update: false,
    json: false,
    consumerEvidencePath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'install' || arg === 'update' || arg === 'classify' || arg === 'uninstall') args.action = arg;
    else if (arg === '--source' || arg === '--source-root') args.sourceRoot = argv[++index];
    else if (arg === '--project-root') args.projectRoot = argv[++index];
    else if (arg === '--host') args.host = argv[++index];
    else if (arg === '--selected-id') args.selectedStableIds.push(argv[++index]);
    else if (arg === '--declared-selection') args.declaredSelection = true;
    else if (arg === '--update') args.update = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--consumer-evidence') args.consumerEvidencePath = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.action === 'update') args.update = true;
  return args;
}

function fail(message) {
  console.error(`FAIL [install-native-shared-skills]: ${message}`);
  process.exit(1);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.action === 'classify') {
    const classification = classifyHostBinding(args.host, {
      consumerEvidencePath: args.consumerEvidencePath,
    });
    if (args.json) console.log(JSON.stringify(classification));
    else console.log(`${args.host} bindingShape=${classification.bindingShape} reason=${classification.reason}`);
    process.exit(0);
  }
  if (args.action === 'uninstall') {
    if (!args.sourceRoot || !args.projectRoot) {
      fail('usage: install-native-shared-skills.js uninstall --source <plugin> --project-root <dir> --host cursor|codex [--json]');
    }
    const result = uninstallNativeSharedSkills({
      sourceRoot: path.resolve(args.sourceRoot),
      projectRoot: path.resolve(args.projectRoot),
      host: args.host,
    });
    if (args.json) {
      console.log(JSON.stringify({
        ok: result.ok !== false,
        host: args.host,
        state: result.state || 'UPDATED',
        selectedIds: result.selectedIds || (result.receipt && result.receipt.selectedIds) || [],
      }));
    } else {
      console.log(`install-native-shared-skills: uninstalled ${args.host} Host Bindings`);
    }
    process.exit(0);
  }
  if (!args.sourceRoot || !args.projectRoot || args.selectedStableIds.length === 0) {
    fail('usage: install-native-shared-skills.js install --source <plugin> --project-root <dir> --host cursor|codex --selected-id <id> [--declared-selection] [--update] [--consumer-evidence <file>] [--json]');
  }
  const result = installNativeSharedSkills({
    sourceRoot: path.resolve(args.sourceRoot),
    projectRoot: path.resolve(args.projectRoot),
    host: args.host,
    selectedStableIds: args.selectedStableIds,
    declaredSelection: args.declaredSelection,
    update: args.update,
    consumerEvidencePath: args.consumerEvidencePath,
  });
  const hostBinding = result.receipt
    && result.receipt.hostBindings
    && result.receipt.hostBindings[args.host];
  const bindingShape = hostBinding && hostBinding.bindingShape;
  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      host: args.host,
      selectedIds: result.selectedIds,
      emittedIds: result.emittedIds,
      bindingShape: bindingShape || null,
      reason: (hostBinding && hostBinding.bindingReason) || null,
    }));
  } else {
    console.log(`install-native-shared-skills: wrote ${result.selectedIds.length} selected skills for ${args.host}`);
  }
} catch (error) {
  fail(error.message);
}
