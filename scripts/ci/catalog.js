#!/usr/bin/env node
'use strict';

// Reports authoritative asset counts and checks machine-readable distribution
// invariants. Human-readable prose counts are informational and are not gated.
//
//   node scripts/ci/catalog.js            print the count table
//   node scripts/ci/catalog.js --check    validate the retired Codex MCP surface
//                                          and profile projection sets
//   node scripts/ci/catalog.js --check all  same as --check
//   node scripts/ci/catalog.js --write    regenerate manifests/profile-projection-sets.json
//
// --check also fails when manifests/profile-projection-sets.json (the per-profile,
// per-Host skill sets the native installers project into the Shared Project
// Projection, ADR-0023) is stale against install-profiles + the inventory.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { CODEX_MCP_COMMAND_NAMES, collectInventory } = require('../lib/asset-inventory');
const { computeScopedCounts } = require('../lib/distribution-inventory');
const {
  MANIFEST_REL: PROJECTION_SETS_REL,
  computeProfileProjectionSets,
  formatProfileProjectionSets,
  diffProfileProjectionSets,
  describeDrift,
} = require('../lib/profile-projection-sets');

const ROOT = path.join(__dirname, '..', '..');
const p = (...s) => path.join(ROOT, ...s);
// Codex MCP is retired. Keep this as an exact zero policy rather than a
// ceiling: a newly introduced grant must fail CI even if it is the first one.
const RETIRED_CODEX_MCP_SURFACE = Object.freeze({ skills: 0, commands: 0, commandGrants: 0 });

// Explicit ownership for newly added top-level test suites. Keep keys exact so
// a similarly named suite cannot inherit another suite's owner by accident.
const SUITE_OWNER_REGISTRY = Object.freeze({
});

function computeCounts() {
  return collectInventory(ROOT).counts;
}

function retiredCodexMcpErrors(counts, inventory) {
  const errors = [];
  if (counts.mcpCodexSkills !== RETIRED_CODEX_MCP_SURFACE.skills) {
    errors.push(`MCP-backed Codex skill surface is retired: expected ${RETIRED_CODEX_MCP_SURFACE.skills}, computed ${counts.mcpCodexSkills}`);
  }
  if (counts.codexCommands !== RETIRED_CODEX_MCP_SURFACE.commands) {
    errors.push(`MCP-backed Codex command surface is retired: expected ${RETIRED_CODEX_MCP_SURFACE.commands}, computed ${counts.codexCommands}`);
  }
  if (counts.mcpCodexCommands !== RETIRED_CODEX_MCP_SURFACE.commandGrants) {
    errors.push(`MCP-backed Codex command grants are retired: expected ${RETIRED_CODEX_MCP_SURFACE.commandGrants}, computed ${counts.mcpCodexCommands}`);
  }
  const unexpected = (inventory && inventory.paths && Array.isArray(inventory.paths.mcpCodexCommands)
    ? inventory.paths.mcpCodexCommands
    : [])
    .map((filePath) => path.basename(filePath))
    .filter((name) => !CODEX_MCP_COMMAND_NAMES.includes(name));
  if (unexpected.length > 0) {
    errors.push(`MCP-backed Codex command grant found outside the retired zero-grant surface: ${unexpected.join(', ')}`);
  }
  return errors;
}

function readJsonFile(rel) {
  return JSON.parse(fs.readFileSync(p(rel), 'utf8'));
}

// Returns the number of stale (profile, Host) projection sets. --write
// regenerates the manifest; --check reports each stale set by name.
function checkOrWriteProjectionSets({ write }) {
  let expected;
  try {
    expected = computeProfileProjectionSets({
      inventory: readJsonFile('manifests/distribution-inventory.json'),
      profiles: readJsonFile('manifests/install-profiles.json'),
      moduleCatalog: readJsonFile('manifests/module-catalog.json'),
    });
  } catch (error) {
    console.error(`DRIFT ${PROJECTION_SETS_REL}: cannot generate projection sets: ${error.message}`);
    return 1;
  }
  const expectedText = formatProfileProjectionSets(expected);
  const fp = p(PROJECTION_SETS_REL);
  const actualText = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
  if (actualText === expectedText) return 0;
  if (write) {
    fs.writeFileSync(fp, expectedText);
    console.log(`FIX ${PROJECTION_SETS_REL}: regenerated per-profile projection sets`);
    return 0;
  }
  if (actualText === null) {
    console.error(`DRIFT ${PROJECTION_SETS_REL}: file is missing; run catalog.js --write`);
    return 1;
  }
  let declared;
  try {
    declared = JSON.parse(actualText);
  } catch (error) {
    console.error(`DRIFT ${PROJECTION_SETS_REL}: invalid JSON (${error.message}); run catalog.js --write`);
    return 1;
  }
  const drift = diffProfileProjectionSets(declared, expected);
  for (const entry of drift) console.error(`DRIFT ${PROJECTION_SETS_REL}: ${describeDrift(entry)}`);
  if (drift.length === 0) {
    console.error(`DRIFT ${PROJECTION_SETS_REL}: content differs from the generated manifest; run catalog.js --write`);
    return 1;
  }
  return drift.length;
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function hasValidSuiteOwner(suiteRel) {
  if (!Object.prototype.hasOwnProperty.call(SUITE_OWNER_REGISTRY, suiteRel)) return false;
  const ownerRel = SUITE_OWNER_REGISTRY[suiteRel];
  if (typeof ownerRel !== 'string'
    || ownerRel.length === 0
    || ownerRel.trim() !== ownerRel
    || ownerRel.includes('\\')
    || path.posix.isAbsolute(ownerRel)
    || path.posix.normalize(ownerRel) !== ownerRel
    || ownerRel === suiteRel) {
    return false;
  }

  const ownerPath = path.resolve(ROOT, ...ownerRel.split('/'));
  if (!isPathWithin(ROOT, ownerPath)) return false;

  try {
    if (!fs.lstatSync(ownerPath).isFile()) return false;
    return isPathWithin(fs.realpathSync(ROOT), fs.realpathSync(ownerPath));
  } catch {
    return false;
  }
}

function warnForUnownedAddedSuites(diffBase) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(diffBase || '')) {
    console.warn('WARNING [catalog]: suite-owner comparison unavailable; --diff-base must be a full commit SHA.');
    return;
  }

  const comparison = spawnSync('git', [
    'diff',
    '--no-renames',
    '--diff-filter=A',
    '--name-only',
    '-z',
    `${diffBase}...HEAD`,
    '--',
    'tests/',
  ], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });

  if (comparison.error || comparison.status !== 0 || !Buffer.isBuffer(comparison.stdout)) {
    console.warn('WARNING [catalog]: suite-owner comparison unavailable; no admission warnings were evaluated.');
    return;
  }

  const addedSuites = comparison.stdout.toString('utf8')
    .split('\0')
    .filter((filePath) => /^tests\/[^/]+\.test\.js$/.test(filePath))
    .sort();

  for (const suiteRel of addedSuites) {
    if (!hasValidSuiteOwner(suiteRel)) {
      console.warn(`WARNING [catalog]: newly added test suite ${suiteRel} has no valid owner registered in SUITE_OWNER_REGISTRY.`);
    }
  }
}

function checkOrWrite({ write, diffBase }) {
  if (!write && diffBase !== undefined) warnForUnownedAddedSuites(diffBase);

  const inventory = collectInventory(ROOT);
  const retirementErrors = retiredCodexMcpErrors(inventory.counts, inventory);
  for (const error of retirementErrors) console.error(`RETIREMENT ${error}`);
  if (retirementErrors.length > 0) return 1;

  const staleProjectionSets = checkOrWriteProjectionSets({ write });
  if (write) return staleProjectionSets > 0 ? 1 : 0;
  if (staleProjectionSets > 0) {
    console.error(`FAIL [catalog]: ${staleProjectionSets} projection set(s) in ${PROJECTION_SETS_REL} are stale.`);
    return 1;
  }

  console.log('PASS [catalog]: retired Codex MCP surface and profile projection sets are current.');
  return 0;
}

function printTable() {
  const c = computeCounts();
  console.log('dhpk catalog:');
  console.log(`  agents:   ${c.agentsTotal}  (root ${c.agentsRoot} + module ${c.agentsModule})`);
  console.log(`  skills:   ${c.skillsTotal}  (base ${c.skillsBase} + module ${c.skillsModule})`);
  console.log(`  commands: ${c.commands}`);
  console.log(`  modules:  ${c.modules}`);
  console.log(`  codex:    ${c.mcpCodexSkills} MCP-backed skills + ${c.codexCommands} commands`);
  console.log(`  hooks:    ${c.hookEvents} events (hooks/hooks.json)`);

  const inventoryPath = p('manifests', 'distribution-inventory.json');
  if (fs.existsSync(inventoryPath)) {
    const dist = computeScopedCounts(JSON.parse(fs.readFileSync(inventoryPath, 'utf8')));
    // Scoped, independently-derived counts (harness-count-integrity spec):
    // a documentation claim about the default install surface must cite
    // claudePublished/codexPublished/promotedCore, never the canonical total.
    console.log(
      `  distribution: canonical ${dist.canonical} = promoted-core ${dist.promotedCore} + optional ${dist.optional} + experimental ${dist.experimental} + deprecated ${dist.deprecated}`
    );
    console.log(`                claude-published ${dist.claudePublished}, codex-published ${dist.codexPublished}`);
  }
}

const args = process.argv.slice(2);
const diffBaseIndex = args.indexOf('--diff-base');
const inlineDiffBase = args.find((arg) => arg.startsWith('--diff-base='));
const hasDiffBase = diffBaseIndex !== -1 || inlineDiffBase !== undefined;
const diffBase = inlineDiffBase !== undefined
  ? inlineDiffBase.slice('--diff-base='.length)
  : (diffBaseIndex === -1 ? undefined : args[diffBaseIndex + 1]);
if (args.includes('--check')) process.exit(checkOrWrite({
  write: false,
  ...(hasDiffBase ? { diffBase: diffBase === undefined ? '' : diffBase } : {}),
}));
else if (args.includes('--write')) process.exit(checkOrWrite({ write: true }));
else printTable();
