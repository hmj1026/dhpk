#!/usr/bin/env node
'use strict';

// Receipt-owned AGY installation lifecycle.
//
//   install|update --source <package> [--target <dir>]
//   uninstall|rollback --target <dir>
//
// `plan` exits 0 when the target is ready or current, 1 when an update is
// pending, 2 when blocked, and 64 for a command-line argument error (#1584).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  resolveAgyInstallRoot,
  inspectAgyInstallTargets,
  resolveAgyInstallTarget,
  installAgyPlugin,
  migrateAgyPlugin,
  rollbackAgyPlugin,
  uninstallAgyPlugin,
} = require('../lib/agy-plugin-install');
const planBoundary = require('../lib/plan-boundary-envelope');

const ROOT = path.join(__dirname, '..', '..');
const ACTIONS = ['plan', 'status', 'install', 'update', 'migrate', 'uninstall', 'rollback'];
const VALUE_OPTIONS = ['source', 'target'];
const USAGE = 'usage: install-agy-plugin.js <plan|status|install|update|migrate|uninstall|rollback> [--source <package>] [--target <dir>] [--json]';

function parseArgs(argv) {
  const options = { action: null, source: null, target: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const inline = /^--([^=]+)=(.*)$/.exec(arg);
    if (inline && VALUE_OPTIONS.includes(inline[1])) {
      if (!inline[2]) throw new Error(`--${inline[1]} requires a value`);
      options[inline[1]] = inline[2];
      continue;
    }
    if (arg.startsWith('--') && VALUE_OPTIONS.includes(arg.slice(2))) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option '${arg}'`);
    if (options.action) throw new Error(`unexpected argument '${arg}'`);
    if (!ACTIONS.includes(arg)) throw new Error(`unknown action '${arg}'`);
    options.action = arg;
  }
  if (!options.action) throw new Error('an action is required');
  return options;
}

function recordedSourceVersion(targetRoot) {
  try {
    const recorded = JSON.parse(fs.readFileSync(path.join(targetRoot, 'provenance.json'), 'utf8'));
    return recorded && typeof recorded.sourceVersion === 'string' ? recorded.sourceVersion : null;
  } catch (error) {
    return null;
  }
}

// The plan envelope for one inspected target.
function inspectionEnvelope(report) {
  if (report.status === 'PASS') {
    return report.state === 'STALE'
      ? planBoundary.envelope('CHANGES_PENDING', { reasonCode: 'UPDATE_PENDING', remediation: [planBoundary.remediation('update', report.next_action, { command: `install-agy-plugin.js update --target ${planBoundary.shellWord(report.target.root)}` })] })
      : planBoundary.envelope('READY');
  }
  const target = report.target || null;
  const receipt = target && target.receipt;
  const invalidReceipt = Boolean(receipt && receipt.present && !receipt.valid);
  const affectedPaths = invalidReceipt
    ? [path.join(target.root, 'provenance.json')]
    : (target ? [target.root] : (report.candidates || []).map((candidate) => candidate.root));
  return planBoundary.envelope('BLOCKED', {
    reasonCode: invalidReceipt ? 'INVALID_RECEIPT' : report.classification,
    receiptVersion: invalidReceipt ? recordedSourceVersion(target.root) : (receipt && receipt.source_version) || null,
    affectedPaths,
    remediation: planBoundary.manualRemediation(report.next_action || 'inspect the AGY target before installing'),
  });
}

function errorEnvelope(error, sourceRoot) {
  const invalidSource = /^AGY source package is invalid/.test(error.message);
  return planBoundary.envelope('BLOCKED', {
    reasonCode: invalidSource ? 'INVALID_SOURCE_PACKAGE' : 'INSPECTION_FAILED',
    affectedPaths: invalidSource ? [sourceRoot] : [],
    remediation: planBoundary.manualRemediation(invalidSource
      ? 'Rebuild the AGY package (npm run build:agy) or pass --source <package>.'
      : `Resolve the reported error: ${error.message}`),
  });
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`install-agy-plugin.js: ${error.message}\n${USAGE}`);
  process.exitCode = 64;
}

if (options) {
  const { action, json } = options;
  const targetRoot = options.target ? path.resolve(options.target) : null;
  const sourceRoot = path.resolve(options.source || path.join(ROOT, 'dist', 'on-demand', 'dhpk-agy'));
  const inspection = ['plan', 'status'].includes(action);
  try {
    const result = inspection
      ? inspectAgyInstallTargets({ sourceRoot, targetRoot, homeDirectory: os.homedir() })
      : action === 'migrate'
      ? migrateAgyPlugin({ sourceRoot, homeDirectory: os.homedir() })
      : ['install', 'update'].includes(action)
      ? installAgyPlugin({ sourceRoot, targetRoot: resolveAgyInstallTarget({ targetRoot, homeDirectory: os.homedir() }), mode: action })
      : (action === 'rollback' ? rollbackAgyPlugin({ targetRoot: targetRoot || resolveAgyInstallRoot() }) : uninstallAgyPlugin({ targetRoot: targetRoot || resolveAgyInstallRoot() }));
    const report = { surface: 'agy-plugin', action, ...(targetRoot ? { targetRoot } : {}), ...result, ...(inspection ? inspectionEnvelope(result) : {}) };
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(`${report.status || 'PASS'} [install-agy-plugin]: ${action} ${report.targetRoot || report.target?.root || ''}${report.classification ? ` (${report.classification})` : ''}`);
    if (action === 'plan') process.exitCode = { READY: 0, CHANGES_PENDING: 1, BLOCKED: 2 }[report.verdict];
    else if (action === 'status' && report.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    if (json) console.log(JSON.stringify({ surface: 'agy-plugin', action, status: 'FAIL', error: error.message, ...(action === 'plan' ? errorEnvelope(error, sourceRoot) : {}) }, null, 2));
    else console.error(`FAIL [install-agy-plugin]: ${error.message}`);
    process.exitCode = action === 'plan' ? 2 : 1;
  }
}
