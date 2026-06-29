#!/usr/bin/env node
'use strict';

// Validate .claude-plugin/plugin.json references resolve on disk.
//   FAIL: an agents[] file that does not exist; a skills[] directory that does
//         not exist; a commands[] path that does not exist; version not semver.
// These are the paths Claude Code loads at install time — a stale entry ships a
// broken plugin.

const fs = require('fs');
const path = require('path');
const { createReporter } = require('./_lib/report');

const ROOT = path.join(__dirname, '..', '..');
const PLUGIN_JSON = path.join(ROOT, '.claude-plugin', 'plugin.json');

const r = createReporter('plugin');

if (!fs.existsSync(PLUGIN_JSON)) {
  r.err('.claude-plugin/plugin.json not found');
  r.done('plugin manifest');
}

let plugin;
try {
  plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
} catch (e) {
  r.err(`plugin.json — invalid JSON: ${e.message}`);
  r.done('plugin manifest'); // exits 1 because an error was recorded
}

const resolve = (p) => path.join(ROOT, p.replace(/^\.\//, ''));

if (!/^\d+\.\d+\.\d+/.test(plugin.version || '')) {
  r.warn(`plugin.json — version '${plugin.version}' is not semver`);
}

for (const a of plugin.agents || []) {
  if (!fs.existsSync(resolve(a))) r.err(`plugin.json agents[] — missing file: ${a}`);
}
for (const s of plugin.skills || []) {
  if (!fs.existsSync(resolve(s))) r.err(`plugin.json skills[] — missing directory: ${s}`);
}
for (const c of plugin.commands || []) {
  if (!fs.existsSync(resolve(c))) r.err(`plugin.json commands[] — missing path: ${c}`);
}

const counts = {
  agents: (plugin.agents || []).length,
  skills: (plugin.skills || []).length,
  commands: (plugin.commands || []).length,
};
r.done(`agents=${counts.agents} skills=${counts.skills} commands=${counts.commands}`);
