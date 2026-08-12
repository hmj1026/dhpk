#!/usr/bin/env node
'use strict';

// Bootstrap generator for manifests/distribution-inventory.json.
//   node scripts/ci/gen-distribution-inventory.js            print a summary of
//                                                             the checked-in file
//   node scripts/ci/gen-distribution-inventory.js --write    (re)generate the file
//                                                             from the deterministic
//                                                             default classification
//
// Default classification (task 1.3): root skills/ -> promoted/claude-core, module
// skills/modules -> optional/claude-module, codex-sync added wherever codex/skills/
// already mirrors the entry. Run --write once to bootstrap a new canonical skill's
// entry, then hand-edit lifecycle/surfaces for any deliberate reclassification (e.g.
// deprecating a skill) — a manual edit is expected to diverge from the default and
// is not itself a drift failure. Coverage/reconciliation (missing entries, invalid
// lifecycle, duplicate surfaces, deprecated-leak, module-catalog/codex-mirror
// consistency) is enforced by the always-current scripts/ci/validate-distribution.js
// gate, not by this generator.

const fs = require('fs');
const path = require('path');
const { classifyCanonicalInventory, preserveProjectionContract, refreshSupportingDigests, serializeInventory } = require('../lib/distribution-inventory');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'manifests', 'distribution-inventory.json');

function loadExisting() {
  return fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
}

const args = process.argv.slice(2);
if (args.includes('--refresh-supporting-digests')) {
  const existing = loadExisting();
  if (!existing) {
    console.error('gen-distribution-inventory: no checked-in inventory to refresh');
    process.exit(2);
  }
  fs.writeFileSync(OUT, serializeInventory(refreshSupportingDigests(existing, ROOT)));
  console.log('gen-distribution-inventory: refreshed transformed supporting-asset provenance.');
} else if (args.includes('--write')) {
  const generated = preserveProjectionContract(classifyCanonicalInventory(ROOT), loadExisting());
  fs.writeFileSync(OUT, serializeInventory(generated));
  console.log(`gen-distribution-inventory --write: wrote ${generated.skills.length} skills + ${generated.modules.length} modules.`);
} else {
  const inv = loadExisting() || classifyCanonicalInventory(ROOT);
  console.log('dhpk distribution inventory:');
  console.log(`  skills:  ${inv.skills.length}  (promoted ${inv.skills.filter((s) => s.lifecycle === 'promoted').length}, optional ${inv.skills.filter((s) => s.lifecycle === 'optional').length}, experimental ${inv.skills.filter((s) => s.lifecycle === 'experimental').length}, deprecated ${inv.skills.filter((s) => s.lifecycle === 'deprecated').length})`);
  console.log(`  modules: ${inv.modules.length}  (optional ${inv.modules.filter((m) => m.lifecycle === 'optional').length})`);
  console.log(`  codex-sync surface: ${inv.skills.filter((s) => s.surfaces.includes('codex-sync')).length} skills`);
}
