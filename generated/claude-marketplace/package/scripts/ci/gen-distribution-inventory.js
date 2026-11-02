#!/usr/bin/env node
'use strict';

// Compile directory-owned Skill facts into the v2 projection input while
// preserving editorial lifecycle, surfaces, profiles and inventory contracts.
// --check is read-only; --write updates compiled fields; no args prints a summary.
// Legacy v1 bootstrap and supporting-digest refresh remain separate routes.

const fs = require('fs');
const path = require('path');
const {
  classifyCanonicalInventory,
  preserveProjectionContract,
  refreshSupportingDigests,
  serializeInventory,
  writeInventoryAtomically,
} = require('../lib/distribution-inventory');
const { compileClaudeProjection } = require('../lib/claude-projection-adapter');
const { classifyWritePolicy } = require('../lib/distribution-inventory-regeneration');
const { compileDirectoryInventory, inventoryDrift } = require('../lib/skill-distribution-compile');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'manifests', 'distribution-inventory.json');

function loadExisting(out) {
  const exists = fs.existsSync(out);
  return { exists, parsed: exists ? JSON.parse(fs.readFileSync(out, 'utf8')) : undefined };
}

function assertClaudeProjectionCompiles(inventory, stderr) {
  const compiled = compileClaudeProjection({ inventory });
  if (!compiled.ok) {
    stderr(`gen-distribution-inventory: Claude projection compilation failed: ${compiled.error.message}`);
    return null;
  }
  return compiled;
}

function run(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const root = options.root || ROOT;
  const out = options.out || path.join(root, 'manifests', 'distribution-inventory.json');
  const stdoutTarget = options.stdout || process.stdout;
  const stderrTarget = options.stderr || process.stderr;
  let stdout = '';
  let stderr = '';
  const print = (message) => {
    stdout += `${message}\n`;
    stdoutTarget.write(`${message}\n`);
  };
  const error = (message) => {
    stderr += `${message}\n`;
    stderrTarget.write(`${message}\n`);
  };
  let existing;
  let outputExists;
  try {
    ({ exists: outputExists, parsed: existing } = loadExisting(out));
  } catch (cause) {
    error(`gen-distribution-inventory: invalid/malformed existing inventory JSON: ${cause.message}`);
    return { status: 1, stdout, stderr };
  }

  if (argv.includes('--refresh-supporting-digests')) {
    if (!outputExists || !existing || typeof existing !== 'object' || Array.isArray(existing)) {
      error('gen-distribution-inventory: no checked-in inventory to refresh');
      return { status: 2, stdout, stderr };
    }
    const refreshed = refreshSupportingDigests(existing, root);
    if (!assertClaudeProjectionCompiles(refreshed, error)) return { status: 1, stdout, stderr };
    (options.writeInventory || writeInventoryAtomically)(out, serializeInventory(refreshed));
    print('gen-distribution-inventory: refreshed transformed supporting-asset provenance.');
    return { status: 0, stdout, stderr };
  }

  if (argv.includes('--write')) {
    const policy = classifyWritePolicy(outputExists, existing);
    if (policy.action === 'reject' && (!existing || existing.schema !== 'dhpk.distribution-inventory.v2' || !Array.isArray(existing.skills) || !Array.isArray(existing.modules))) {
      error(`gen-distribution-inventory: ${policy.diagnostic}`);
      return { status: 1, stdout, stderr };
    }
    let generated;
    try {
      generated = preserveProjectionContract(classifyCanonicalInventory(root), existing);
      if (existing && existing.schema === 'dhpk.distribution-inventory.v2') generated = compileDirectoryInventory(root, existing, generated);
    } catch (cause) {
      error(`gen-distribution-inventory: ${cause.message}`);
      return { status: 1, stdout, stderr };
    }
    if (!assertClaudeProjectionCompiles(generated, error)) return { status: 1, stdout, stderr };
    (options.writeInventory || writeInventoryAtomically)(out, serializeInventory(generated));
    print(`gen-distribution-inventory --write: wrote ${generated.skills.length} skills + ${generated.modules.length} modules.`);
    return { status: 0, stdout, stderr };
  }

  if (argv.includes('--check')) {
    try {
      if (!existing || existing.schema !== 'dhpk.distribution-inventory.v2') throw new Error('--check requires an existing v2 inventory');
      const generated = compileDirectoryInventory(root, existing, { skills: [] });
      const drift = inventoryDrift(existing, generated);
      if (drift.length) throw new Error(drift.join('; '));
      print(`PASS [distribution-inventory]: ${generated.skills.length} directory-authored Skill rows`);
      return { status: 0, stdout, stderr };
    } catch (cause) { error(`gen-distribution-inventory: ${cause.message}`); return { status: 1, stdout, stderr }; }
  }

  let inv;
  try {
    inv = outputExists ? existing : classifyCanonicalInventory(root);
  } catch (cause) {
    error(`gen-distribution-inventory: ${cause.message}`);
    return { status: 1, stdout, stderr };
  }
  if (!assertClaudeProjectionCompiles(inv, error)) return { status: 1, stdout, stderr };
  print('dhpk distribution inventory:');
  print(`  skills:  ${inv.skills.length}  (promoted ${inv.skills.filter((s) => s.lifecycle === 'promoted').length}, optional ${inv.skills.filter((s) => s.lifecycle === 'optional').length}, experimental ${inv.skills.filter((s) => s.lifecycle === 'experimental').length}, deprecated ${inv.skills.filter((s) => s.lifecycle === 'deprecated').length})`);
  print(`  modules: ${inv.modules.length}  (optional ${inv.modules.filter((m) => m.lifecycle === 'optional').length})`);
  print(`  codex-sync surface: ${inv.skills.filter((s) => s.surfaces.includes('codex-sync')).length} skills`);
  return { status: 0, stdout, stderr };
}

if (require.main === module) process.exit(run().status);

module.exports = { run };
