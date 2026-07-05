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

// Reverse check (fail-loud): every on-disk agent file must be registered in
// agents[]. Catches a new agents/*.md or modules/*/agents/*.md file that was
// created but never added to the manifest — installed consumers would never
// discover it. INDEX.md is excluded at both levels as a roster doc, not a
// registrable agent: the root-level exclusion matches scripts/ci/catalog.js;
// the module-level one is a deliberate superset (catalog.js's module walk has
// no module INDEX.md to exclude today — this stays correct if one is added).
const walk = (dir, test) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp, test));
    else if (test(fp)) out.push(fp);
  }
  return out;
};
const relPosix = (fp) => path.relative(ROOT, fp).split(path.sep).join('/');
const onDiskAgents = [
  ...walk(path.join(ROOT, 'agents'), (f) => f.endsWith('.md') && !f.endsWith('INDEX.md')),
  ...walk(path.join(ROOT, 'modules'), (f) => /\/agents\/[^/]+\.md$/.test(relPosix(f)) && !f.endsWith('INDEX.md')),
];
const registeredAgents = new Set(
  (plugin.agents || []).map((a) => a.replace(/^\.\//, '').split(path.sep).join('/'))
);
for (const fp of onDiskAgents) {
  const rp = relPosix(fp);
  if (!registeredAgents.has(rp)) {
    r.err(`plugin.json agents[] — unregistered agent file on disk: ${rp} (add it to agents[] or the plugin ships it undiscoverable)`);
  }
}

const counts = {
  agents: (plugin.agents || []).length,
  skills: (plugin.skills || []).length,
  commands: (plugin.commands || []).length,
};
r.done(`agents=${counts.agents} skills=${counts.skills} commands=${counts.commands}`);
