#!/usr/bin/env node
'use strict';

// Reconcile manifests/distribution-inventory.json against canonical skill/module
// packages, the module catalog, and per-skill Codex metadata (task 1.4).
//   FAIL: a canonical skill/module missing its lifecycle entry, an invalid
//         lifecycle value, duplicate surface membership, a duplicate entry id,
//         an optional module absent from manifests/module-catalog.json, a
//         codex-sync surface with no codex/skills/ mirror, or a codex-sync/
//         codex-native surface with no agents/openai.yaml.
//
// generatedPromotedSkillIds (the deprecated-leak check) stays empty until the
// Claude publication generator (task 2.2) exists — this gate only reconciles
// the inventory itself, not a generated surface.

const fs = require('fs');
const path = require('path');
const { createReporter } = require('./_lib/report');
const { collectInventory, relativePosix, readJson } = require('../lib/asset-inventory');
const {
  validateDistributionInventory,
  validateSupportingAssets,
  reconcileDistribution,
  verifyClaudeProjection,
} = require('../lib/distribution-inventory');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'manifests', 'distribution-inventory.json');
const r = createReporter('distribution');

if (!fs.existsSync(MANIFEST)) {
  r.err('manifests/distribution-inventory.json not found — run scripts/ci/gen-distribution-inventory.js --write');
  r.done('distribution inventory');
}

const inventory = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const inv = collectInventory(ROOT);
const canonicalSkillPaths = inv.paths.skills.map((fp) => path.dirname(relativePosix(ROOT, fp)));
const canonicalModulePaths = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `modules/${e.name}`);

const structural = validateDistributionInventory({
  inventory,
  canonicalSkillPaths,
  canonicalModulePaths,
});
for (const msg of structural.errors) r.err(msg);

const supporting = validateSupportingAssets({ inventory, root: ROOT });
for (const msg of supporting.errors) r.err(msg);

const codexSkillsDir = path.join(ROOT, 'codex', 'skills');
const codexMirrorNames = fs.existsSync(codexSkillsDir) ? fs.readdirSync(codexSkillsDir) : [];

const moduleCatalog = readJson(ROOT, 'manifests/module-catalog.json');
const moduleCatalogIds = [];
if (moduleCatalog && Array.isArray(moduleCatalog.stacks)) {
  for (const st of moduleCatalog.stacks) {
    for (const v of st.versions || []) {
      if (v && v.module) moduleCatalogIds.push(v.module);
    }
  }
}

const cursorSkillsDir = path.join(ROOT, 'cursor', 'skills');
const cursorMirrorNames = fs.existsSync(cursorSkillsDir) ? fs.readdirSync(cursorSkillsDir) : [];

const reconcile = reconcileDistribution({
  inventory,
  codexMirrorNames,
  cursorMirrorNames,
  moduleCatalogIds,
  hasOpenaiMetadata: (skill) => fs.existsSync(path.join(ROOT, skill.path, 'agents', 'openai.yaml')),
});
for (const msg of reconcile.errors) r.err(msg);

const claudePlugin = readJson(ROOT, '.claude-plugin/plugin.json');
const claudeVerification = verifyClaudeProjection({
  inventory,
  pluginSkills: claudePlugin && Array.isArray(claudePlugin.skills) ? claudePlugin.skills : [],
});
if (!claudeVerification.ok) {
  const diagnostics = claudeVerification.evidence && Array.isArray(claudeVerification.evidence.diagnostics)
    ? claudeVerification.evidence.diagnostics
    : [claudeVerification.error && claudeVerification.error.message || 'Claude projection verification failed'];
  for (const diagnostic of diagnostics) r.err(diagnostic);
}

r.done(`${inventory.skills.length} skills, ${inventory.modules.length} modules reconciled`);
