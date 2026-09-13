#!/usr/bin/env node
'use strict';

// Receipt-owned AGY installation lifecycle.
//
//   install|update --source <package> [--target <dir>]
//   uninstall|rollback --target <dir>

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

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const action = args.find((arg) => !arg.startsWith('--'));

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

if (!['plan', 'status', 'install', 'update', 'migrate', 'uninstall', 'rollback'].includes(action)) {
  console.error('usage: install-agy-plugin.js <plan|status|install|update|migrate|uninstall|rollback> [--source <package>] [--target <dir>] [--json]');
  process.exit(2);
}

const explicitTarget = option('target', null);
const targetRoot = explicitTarget ? path.resolve(explicitTarget) : null;
const sourceRoot = path.resolve(option('source', path.join(ROOT, 'plugins', 'dhpk-agy')));
const json = args.includes('--json');

try {
  const result = ['plan', 'status'].includes(action)
    ? inspectAgyInstallTargets({ sourceRoot, targetRoot, homeDirectory: os.homedir() })
    : action === 'migrate'
    ? migrateAgyPlugin({ sourceRoot, homeDirectory: os.homedir() })
    : ['install', 'update'].includes(action)
    ? installAgyPlugin({ sourceRoot, targetRoot: resolveAgyInstallTarget({ targetRoot, homeDirectory: os.homedir() }), mode: action })
    : (action === 'rollback' ? rollbackAgyPlugin({ targetRoot: targetRoot || resolveAgyInstallRoot() }) : uninstallAgyPlugin({ targetRoot: targetRoot || resolveAgyInstallRoot() }));
  const report = { surface: 'agy-plugin', action, ...(targetRoot ? { targetRoot } : {}), ...result };
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(`${report.status || 'PASS'} [install-agy-plugin]: ${action} ${report.targetRoot || report.target?.root || ''}${report.classification ? ` (${report.classification})` : ''}`);
  if (['plan', 'status'].includes(action) && report.status !== 'PASS') process.exit(1);
} catch (error) {
  if (json) console.log(JSON.stringify({ surface: 'agy-plugin', action, status: 'FAIL', error: error.message }, null, 2));
  else console.error(`FAIL [install-agy-plugin]: ${error.message}`);
  process.exit(1);
}
