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
for (const fp of onDiskAgents) {
  const rp = relativePosix(ROOT, fp);
  if (!registeredAgents.has(rp)) {
    r.err(`plugin.json agents[] — unregistered agent file on disk: ${rp} (add it to agents[] or the plugin ships it undiscoverable)`);
  }
}

// Installed-plugin resolvability (install-manifest integrity): the goal
// orientation instruction reads rules/execution-policy.md from the plugin
// root, and skills/opsx-apply-goal/scripts/* require()/source local files at
// runtime. A missing or relocated local file ships a consumer-side
// `Cannot find module` / POLICY-UNRESOLVED failure, so resolve the static
// dependency graph here, before release.
//   - relative require('...') edges are resolved and recursed into
//   - `node:` built-ins need no packaged file
//   - bare external packages / dynamic (non-literal) requires must be in
//     REQUIRE_ALLOWLIST or fail, naming the owner file and reference
//   - shell `source`/`.` edges and `node "<path>"` invocations are resolved
//     after reducing a leading ${CLAUDE_PLUGIN_ROOT...}/ prefix to the root
const GOAL_SCRIPTS_DIR = path.join(ROOT, 'skills', 'opsx-apply-goal', 'scripts');
const REQUIRE_ALLOWLIST = new Set([]); // bare packages / dynamic paths explicitly sanctioned
const SHELL_SOURCE_ALLOWLIST = new Set([]); // dynamic shell source expressions explicitly sanctioned

function isInsideRoot(candidate) {
  const relative = path.relative(ROOT, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveJsDep(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function checkScriptGraph(entryDir) {
  if (!fs.existsSync(entryDir)) return;
  const queue = fs.readdirSync(entryDir)
    .filter((f) => /\.(js|sh)$/.test(f))
    .map((f) => path.join(entryDir, f));
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.js')) {
      for (const m of src.matchAll(/\brequire\s*\(([^)\n]*)\)/g)) {
        const expression = m[1].trim();
        const literal = /^(['"`])([^'"`\n]*)\1$/.exec(expression);
        if (!literal || (literal[1] === '`' && literal[2].includes('${'))) {
          if (!REQUIRE_ALLOWLIST.has(expression)) r.err(`${rel} — dynamic require() expression is not allow-listed`);
          continue;
        }
        const spec = literal[2];
        if (spec.startsWith('node:')) continue;
        if (!spec.startsWith('.') && !spec.startsWith('/')) {
          if (!REQUIRE_ALLOWLIST.has(spec)) r.err(`${rel} — bare external require('${spec}') is not allow-listed`);
          continue;
        }
        if (spec.startsWith('/')) {
          r.err(`${rel} — local require '${spec}' escapes packaged layout`);
          continue;
        }
        const resolved = resolveJsDep(file, spec);
        if (resolved && !isInsideRoot(resolved)) r.err(`${rel} — local require '${spec}' escapes packaged layout`);
        else if (!resolved) r.err(`${rel} — unresolved local require('${spec}')`);
        else if (resolved.endsWith('.js')) queue.push(resolved);
      }
    } else {
      for (const m of src.matchAll(/^\s*(?:source|\.)\s+(['"]?)(\$\{CLAUDE_PLUGIN_ROOT[^}]*\}\/)?([^'"\s;]+)\1/gm)) {
        const [, , rootPrefix, spec] = m;
        if (spec.includes('$')) {
          if (!SHELL_SOURCE_ALLOWLIST.has(spec)) r.err(`${rel} — dynamic shell source '${spec}' is not allow-listed`);
          continue;
        }
        const resolved = rootPrefix ? path.join(ROOT, spec) : path.resolve(path.dirname(file), spec);
        if (!isInsideRoot(resolved)) r.err(`${rel} — shell source '${spec}' escapes packaged layout`);
        else if (!fs.existsSync(resolved)) r.err(`${rel} — unresolved shell source '${spec}'`);
        else if (/\.(?:js|sh)$/.test(resolved)) queue.push(resolved);
      }
      for (const m of src.matchAll(/\bnode\s+"\$\{CLAUDE_PLUGIN_ROOT[^}]*\}\/([^"]+)"/g)) {
        const resolved = path.join(ROOT, m[1]);
        if (!fs.existsSync(resolved)) r.err(`${rel} — unresolved node invocation path '${m[1]}'`);
        else queue.push(resolved);
      }
    }
  }
}

if (fs.existsSync(GOAL_SCRIPTS_DIR)) {
  checkScriptGraph(GOAL_SCRIPTS_DIR);
  // The goal template's Part 0 orientation command reads this path off the
  // plugin root; POLICY-UNRESOLVED in consumers means it went missing.
  if (!fs.existsSync(path.join(ROOT, 'rules', 'execution-policy.md'))) {
    r.err('rules/execution-policy.md — goal-orientation-referenced policy path missing from packaged layout');
  }
}

const counts = {
  agents: (plugin.agents || []).length,
  skills: (plugin.skills || []).length,
  commands: (plugin.commands || []).length,
};
r.done(`agents=${counts.agents} skills=${counts.skills} commands=${counts.commands}`);
