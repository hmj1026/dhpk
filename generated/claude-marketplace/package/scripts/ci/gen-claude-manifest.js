#!/usr/bin/env node
'use strict';

// Deterministic Claude plugin.json skills[] generation/check (task 2.2), derived
// from manifests/distribution-inventory.json via generateClaudeSkillRoots().
//   node scripts/ci/gen-claude-manifest.js            print a summary
//   node scripts/ci/gen-claude-manifest.js --check    fail (exit 1) if
//                                                      .claude-plugin/plugin.json
//                                                      skills[] does not match the
//                                                      inventory-derived root set
//
// Claude's plugin.json has no per-skill granularity (design.md decision 3): a
// directory root stays registered as long as one of its skills is not
// deprecated. So this compares the ROOT SET only — order is not semantically
// significant to the host and is not enforced. agents[], commands[], hooks,
// rules, and userConfig are untouched by this script; only skills[] is derived
// from the inventory. Because generateClaudeSkillRoots() is a pure function of
// an inventory object, task 5.4's rollback proof calls it directly against a
// prior inventory revision without touching this CLI.

const fs = require('fs');
const path = require('path');
const { compileClaudeProjection, verifyClaudeProjection } = require('../lib/distribution-inventory');

const ROOT = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT, 'manifests', 'distribution-inventory.json');
const PLUGIN_JSON_PATH = path.join(ROOT, '.claude-plugin', 'plugin.json');

function loadInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
}

function checkMode() {
  const inventory = loadInventory();
  const plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON_PATH, 'utf8'));
  const verification = verifyClaudeProjection({ inventory, pluginSkills: plugin.skills || [] });
  if (!verification.ok) {
    if (verification.error) {
      console.error(`FAIL [gen-claude-manifest]: ${verification.error.message}`);
      return 1;
    }
    for (const diagnostic of verification.evidence && verification.evidence.diagnostics || []) {
      if (diagnostic.startsWith('DRIFT ') || diagnostic.startsWith('FAIL ')) console.error(diagnostic);
    }
    return 1;
  }
  const registeredSet = new Set(plugin.skills || []);
  console.log(`PASS [gen-claude-manifest]: plugin.json skills[] (${registeredSet.size} roots) matches the inventory-derived root set.`);
  return 0;
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  process.exit(checkMode());
} else {
  const compiled = compileClaudeProjection({ inventory: loadInventory() });
  if (!compiled.ok) {
    console.error(`FAIL [gen-claude-manifest]: ${compiled.error.message}`);
    process.exit(1);
  }
  const generated = compiled.generated;
  console.log('dhpk Claude publication surface (generated from distribution inventory):');
  console.log(`  roots:              ${generated.roots.length}`);
  console.log(`  generated skill ids: ${generated.generatedSkillIds.length} (excludes deprecated; host cannot hide within a shared root)`);
}
