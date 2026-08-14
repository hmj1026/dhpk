#!/usr/bin/env node
'use strict';

// Receipt-owned AGY installation lifecycle.
//
//   install|update --source <package> [--target <dir>]
//   uninstall|rollback --target <dir>

const path = require('node:path');
const {
  resolveAgyInstallRoot,
  installAgyPlugin,
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

if (!['install', 'update', 'uninstall', 'rollback'].includes(action)) {
  console.error('usage: install-agy-plugin.js <install|update|uninstall|rollback> [--source <package>] [--target <dir>] [--json]');
  process.exit(2);
}

const targetRoot = path.resolve(option('target', resolveAgyInstallRoot()));
const sourceRoot = path.resolve(option('source', path.join(ROOT, 'plugins', 'dhpk-agy')));
const json = args.includes('--json');

try {
  const result = ['install', 'update'].includes(action)
    ? installAgyPlugin({ sourceRoot, targetRoot, mode: action })
    : (action === 'rollback' ? rollbackAgyPlugin({ targetRoot }) : uninstallAgyPlugin({ targetRoot }));
  const report = { surface: 'agy-plugin', action, ...result };
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(`PASS [install-agy-plugin]: ${action} ${targetRoot}`);
} catch (error) {
  if (json) console.log(JSON.stringify({ surface: 'agy-plugin', action, status: 'FAIL', error: error.message }, null, 2));
  else console.error(`FAIL [install-agy-plugin]: ${error.message}`);
  process.exit(1);
}
