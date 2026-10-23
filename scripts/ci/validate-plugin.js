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
const { listAgentFiles, relativePosix } = require('../lib/asset-inventory');

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
const onDiskAgents = listAgentFiles(ROOT);
const registeredAgents = new Set(
  (plugin.agents || []).map((a) => a.replace(/^\.\//, '').split(path.sep).join('/'))
);
const agentIndex = path.join(ROOT, 'agents', 'INDEX.md');
if (fs.existsSync(agentIndex)) {
  const indexText = fs.readFileSync(agentIndex, 'utf8');
  const rosterMetadata = indexText.match(/^<!-- dhpk-agent-roster-counts: (\{[^\r\n]*\}) -->$/m);
  const rootAgentCount = [...registeredAgents].filter((entry) => entry.startsWith('agents/')).length;
  const moduleAgentCount = [...registeredAgents].filter((entry) => entry.startsWith('modules/') && entry.includes('/agents/')).length;
  let rosterCounts = null;
  if (rosterMetadata) {
    try { rosterCounts = JSON.parse(rosterMetadata[1]); } catch (_) { /* reported below */ }
  }
  if (!rosterCounts || typeof rosterCounts !== 'object' || Array.isArray(rosterCounts)
    || rosterCounts.schema !== 'dhpk.agent-roster-counts.v1'
    || !['total', 'root', 'module'].every((key) => Number.isSafeInteger(rosterCounts[key]) && rosterCounts[key] >= 0)) {
    r.err('agents/INDEX.md — missing or invalid machine-readable roster count metadata');
  } else {
    if (rosterCounts.total !== registeredAgents.size || rosterCounts.root !== rootAgentCount
      || rosterCounts.module !== moduleAgentCount) {
      r.err(`agents/INDEX.md — roster count drift: metadata declares ${rosterCounts.total} total `
        + `(${rosterCounts.root} root-level, ${rosterCounts.module} module), but plugin.json agents[] `
        + `contains ${registeredAgents.size} (${rootAgentCount} root-level, ${moduleAgentCount} module)`);
    }
  }
}
for (const fp of onDiskAgents) {
  const rp = relativePosix(ROOT, fp);
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
