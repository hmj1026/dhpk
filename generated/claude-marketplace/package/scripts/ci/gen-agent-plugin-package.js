#!/usr/bin/env node
'use strict';

// Generate the physical, inventory-selected Agent Plugins package.
//
//   node scripts/ci/gen-agent-plugin-package.js <outDir> [--version=X.Y.Z]
//
// The generator is intentionally a thin filesystem/CLI wrapper.  Selection,
// normalization, package-boundary checks, and provenance live in the pure
// scripts/lib/agent-plugin-package.js library so tests can exercise disposable
// roots without mutating the checkout.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  compileAgentPluginPackage,
  materializeAgentPluginPackage,
  validateAgentPluginPackage,
} = require('../lib/agent-plugin-package');

const ROOT = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT, 'manifests', 'distribution-inventory.json');
const CLAUDE_MANIFEST_PATH = path.join(ROOT, '.claude-plugin', 'plugin.json');

const args = process.argv.slice(2);
const outArg = args.find((arg) => !arg.startsWith('--'));
if (!outArg) {
  console.error('usage: node scripts/ci/gen-agent-plugin-package.js <outDir> [--version=X.Y.Z]');
  process.exit(2);
}

function resolveSourceCommit() {
  const result = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const inventory = readJson(INVENTORY_PATH);
const sourceManifest = readJson(CLAUDE_MANIFEST_PATH);
const versionArg = args.find((arg) => arg.startsWith('--version='));
const version = versionArg ? versionArg.slice('--version='.length) : sourceManifest.version;
const outDir = path.resolve(outArg);

let result;
try {
  const compiledProjection = compileAgentPluginPackage({
    inventory,
    root: ROOT,
    outDir,
    name: 'dhpk',
    version,
    sourceCommit: resolveSourceCommit(),
    manifestMetadata: sourceManifest,
  });
  result = materializeAgentPluginPackage({
    inventory,
    root: ROOT,
    outDir,
    name: 'dhpk',
    version,
    sourceCommit: resolveSourceCommit(),
    manifestMetadata: sourceManifest,
    compiledProjection,
  });
} catch (error) {
  console.error(`FAIL [gen-agent-plugin-package]: ${error.message}`);
  process.exit(1);
}

const validation = validateAgentPluginPackage(outDir, {
  allowlist: inventory.portable_frontmatter && inventory.portable_frontmatter.allowlist,
});
for (const warning of validation.warnings) console.error(`WARN [gen-agent-plugin-package]: ${warning}`);
for (const skipped of result.skippedSkills) console.error(`WARN [gen-agent-plugin-package]: skipped ${skipped.id || skipped.name}: ${skipped.reason}`);
for (const invalid of result.mcp.invalid || []) console.error(`WARN [gen-agent-plugin-package]: skipped MCP server ${invalid.name}: ${invalid.errors.join('; ')}`);
for (const error of result.mcp.errors || []) {
  if (!(result.mcp.invalid || []).some((invalid) => invalid.errors.includes(error))) console.error(`WARN [gen-agent-plugin-package]: MCP configuration: ${error}`);
}
for (const error of validation.errors) console.error(`ERROR [gen-agent-plugin-package]: ${error}`);
if (!validation.ok) {
  console.error('FAIL [gen-agent-plugin-package]: generated candidate failed portable package validation.');
  process.exit(1);
}

console.log(`PASS [gen-agent-plugin-package]: wrote ${result.skillIds.length} portable skills to ${outDir} (version ${version}).`);
