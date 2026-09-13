#!/usr/bin/env node
'use strict';

// Controlled runner entrypoint.  This command performs only bounded readiness
// checks; it does not invoke a consumer and therefore cannot produce runtime
// PASS evidence.

const path = require('node:path');
const receipts = require('../lib/harness-receipt');
const inventoryApi = require('../lib/distribution-inventory');
const preflight = require('../lib/consumer-runtime-preflight');

function parseArgs(argv) {
  const parsed = { root: process.cwd(), json: false };
  const valueOptions = new Map([
    ['--root', 'root'],
    ['--task-id', 'taskId'],
    ['--attempt-id', 'attemptId'],
    ['--source-commit', 'sourceCommit'],
    ['--source-tree', 'sourceTree'],
    ['--target-commit', 'targetCommit'],
    ['--target-tree', 'targetTree'],
    ['--surfaces', 'surfaces'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (valueOptions.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`option value is required for '${arg}'`);
      parsed[valueOptions.get(arg)] = value;
    } else throw new Error(`unknown argument '${String(arg).slice(0, 120)}'`);
  }
  if (parsed.help) return parsed;
  if (!parsed.taskId || !parsed.attemptId) throw new Error('--task-id and --attempt-id are required');
  if (parsed.surfaces) parsed.surfaces = parsed.surfaces.split(',').map((surface) => surface.trim()).filter(Boolean);
  return parsed;
}

function usage() {
  return 'usage: consumer-runtime-preflight.js --root <checkout> --task-id <id> --attempt-id <id> [--surfaces <id,id,...>] [--json]';
}

function main(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    if (parsed.help) return { status: 0, payload: { usage: usage() } };
    const root = path.resolve(parsed.root);
    const binding = receipts.resolveGitBinding(root);
    const worktree = receipts.resolveGitWorktree(root);
    const inventory = JSON.parse(require('node:fs').readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    const identity = {
      taskId: parsed.taskId,
      attemptId: parsed.attemptId,
      sourceCommit: parsed.sourceCommit || binding.sourceCommit,
      sourceTree: parsed.sourceTree || binding.sourceTree,
      targetCommit: parsed.targetCommit || binding.sourceCommit,
      targetTree: parsed.targetTree || binding.sourceTree,
      worktree,
      selectedSurfaces: parsed.surfaces || required.requiredSurfaces,
      requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
    };
    const mismatches = [];
    if (identity.selectedSurfaces.length !== required.requiredSurfaces.length
      || identity.selectedSurfaces.some((surface, index) => surface !== required.requiredSurfaces[index])) {
      mismatches.push('full-release preflight must use the canonical required surface list');
    }
    if (identity.sourceCommit !== binding.sourceCommit) mismatches.push('sourceCommit does not match current checkout');
    if (identity.sourceTree !== binding.sourceTree) mismatches.push('sourceTree does not match current checkout');
    if (identity.targetCommit !== binding.sourceCommit) mismatches.push('targetCommit does not match current checkout');
    if (identity.targetTree !== binding.sourceTree) mismatches.push('targetTree does not match current checkout');
    const result = preflight.preflightForCheckout({ root, env, identity });
    if (required.errors.length > 0 || mismatches.length > 0) {
      result.status = 'BLOCKED';
      result.outcome = 'BLOCKED';
      result.reasonCode = 'IDENTITY_INVALID';
      result.errors = [...(result.errors || []), ...required.errors, ...mismatches].slice(0, 20);
      result.diagnostics = [...(result.diagnostics || []), ...mismatches, ...required.errors].slice(0, 20);
    }
    result.runnerCapabilities = result.runner;
    result.identity = { ...result.identity, worktree };
    result.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
    return { status: result.exitCode, payload: result };
  } catch (error) {
    return {
      status: 64,
      payload: { schema: 'dhpk.consumer-runtime-preflight.v1', status: 'BLOCKED', outcome: 'USAGE', diagnostics: [preflight.boundedDiagnostic(error.message)] },
    };
  }
}

if (require.main === module) {
  const result = main();
  if (result.payload && result.payload.usage) process.stdout.write(`${result.payload.usage}\n`);
  else process.stdout.write(`${JSON.stringify(result.payload)}\n`);
  process.exit(result.status);
}

module.exports = { parseArgs, main, usage };
