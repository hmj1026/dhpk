'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Compile the accepted marketplace catalog (manifests/marketplace-selection.json)
// against the distribution inventory. Common entries become public listings;
// common branches, references, and internal skills fold under their entry
// owner; Host-only rows keep their own identity; withdrawn rows are excluded.
// Any inconsistency fails closed with an empty selection.

const SELECTIONS = Object.freeze(['common', 'host-only', 'withdrawn']);
const CHILD_KINDS = Object.freeze(['branch', 'reference', 'internal']);

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function emptyResult(errors) {
  return freezeDeep({ errors, publicEntries: [], bundledChildren: {}, hostOnly: [], withdrawn: [] });
}

function indexRows(rows, inventoryById, errors) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') {
      errors.push('selection row without a string id');
      continue;
    }
    if (byId.has(row.id)) errors.push(`duplicate selection id: ${row.id}`);
    if (!inventoryById.has(row.id)) errors.push(`selection id not in inventory: ${row.id}`);
    if (!SELECTIONS.includes(row.selection)) errors.push(`${row.id}: unknown selection ${row.selection}`);
    byId.set(row.id, row);
  }
  for (const id of inventoryById.keys()) {
    if (!byId.has(id)) errors.push(`inventory id missing from selection: ${id}`);
  }
  return byId;
}

function checkRow(row, byId, errors) {
  if (row.selection === 'withdrawn') {
    if (row.kind !== 'withdrawn') errors.push(`${row.id}: withdrawn selection requires kind withdrawn`);
    return;
  }
  if (row.kind === 'withdrawn') {
    errors.push(`${row.id}: kind withdrawn requires selection withdrawn`);
    return;
  }
  if (row.kind === 'entry') {
    if (row.owner !== null && row.owner !== row.id) errors.push(`${row.id}: an entry owns itself`);
    return;
  }
  if (!CHILD_KINDS.includes(row.kind)) {
    errors.push(`${row.id}: unknown kind ${row.kind}`);
    return;
  }
  const owner = byId.get(row.owner);
  if (!owner || owner.kind !== 'entry' || owner.selection !== row.selection) {
    errors.push(`${row.id}: owner ${row.owner} is not a ${row.selection} entry`);
  }
}

function checkNames(selected, inventoryById, aliases, errors) {
  const aliasSet = new Set(aliases);
  const owners = new Map();
  for (const row of selected) {
    const name = inventoryById.get(row.id).name;
    if (aliasSet.has(name)) errors.push(`${row.id}: name ${name} is a runtime alias`);
    if (owners.has(name)) errors.push(`name collision: ${name} (${owners.get(name)}, ${row.id})`);
    owners.set(name, row.id);
  }
}

function compileMarketplaceSelection({ inventory, selection, aliases = [] }) {
  const errors = [];
  const skills = Array.isArray(inventory && inventory.skills) ? inventory.skills : [];
  const rows = Array.isArray(selection && selection.skills) ? selection.skills : [];
  const inventoryById = new Map(skills.map((skill) => [skill.id, skill]));

  const byId = indexRows(rows, inventoryById, errors);
  for (const row of byId.values()) checkRow(row, byId, errors);
  const known = [...byId.values()].filter((row) => inventoryById.has(row.id));
  checkNames(known.filter((row) => row.selection !== 'withdrawn'), inventoryById, aliases, errors);
  if (errors.length > 0) return emptyResult(errors);

  const describe = (row) => ({ id: row.id, name: inventoryById.get(row.id).name, kind: row.kind, authority: row.authority });
  const common = known.filter((row) => row.selection === 'common');
  const bundledChildren = {};
  for (const row of common.filter((candidate) => candidate.kind !== 'entry')) {
    bundledChildren[row.owner] = [...(bundledChildren[row.owner] || []), describe(row)];
  }
  return freezeDeep({
    errors: [],
    publicEntries: common.filter((row) => row.kind === 'entry').map(describe),
    bundledChildren,
    hostOnly: known.filter((row) => row.selection === 'host-only').map(describe),
    withdrawn: known.filter((row) => row.selection === 'withdrawn').map((row) => row.id),
  });
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]));
  }
  return value;
}

function copyJson(value) {
  if (Array.isArray(value)) return value.map(copyJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyJson(child)]));
  }
  return value;
}

function compileMarketplacePublicationView({ inventory, selection, aliases = [], hostSurface } = {}) {
  const errors = [];
  let selectionDigest = null;
  try {
    const canonicalSelection = JSON.stringify(canonicalizeJson(selection));
    if (typeof canonicalSelection !== 'string') throw new TypeError('selection is not JSON serializable');
    selectionDigest = createHash('sha256').update(canonicalSelection).digest('hex');
  } catch (_) {
    errors.push('selection must be JSON serializable to compute its digest');
  }

  if (!inventory || !Array.isArray(inventory.skills)) errors.push('inventory.skills must be an array');
  if (!selection || !Array.isArray(selection.skills)) errors.push('selection.skills must be an array');
  if (hostSurface !== undefined && (!Array.isArray(inventory && inventory.surfaces) || !inventory.surfaces.includes(hostSurface))) {
    errors.push(`unknown host surface ${String(hostSurface)}`);
  }

  const emptyView = () => freezeDeep({
    errors,
    publicEntries: [],
    bundledChildren: {},
    hostOnly: [],
    withdrawn: [],
    selectionDigest,
  });
  if (errors.length > 0) return emptyView();

  const compiled = compileMarketplaceSelection({ inventory, selection, aliases });
  errors.push(...compiled.errors);
  if (errors.length > 0) return emptyView();

  const inventoryById = new Map(inventory.skills.map((skill) => [skill.id, skill]));
  const selectionById = new Map(selection.skills.map((row) => [row.id, row]));
  const describe = (compiledRow) => {
    const skill = inventoryById.get(compiledRow.id);
    const row = selectionById.get(compiledRow.id);
    if (typeof skill.path !== 'string' || skill.path.length === 0) errors.push(`${skill.id}: inventory path is required`);
    if (!Array.isArray(skill.profiles)) errors.push(`${skill.id}: inventory profiles must be an array`);
    return {
      ...copyJson(skill),
      authority: row.authority,
      kind: row.kind,
      owner: row.owner,
      selection: row.selection,
      versionCondition: Array.isArray(skill.profiles) ? skill.profiles.filter((profile) => profile !== 'core') : [],
    };
  };

  const publicEntries = compiled.publicEntries.map(describe);
  const bundledChildren = Object.fromEntries(Object.entries(compiled.bundledChildren).map(([owner, children]) => [
    owner,
    children.map(describe),
  ]));
  const hostOnly = hostSurface === undefined ? [] : compiled.hostOnly
    .filter((row) => {
      const skill = inventoryById.get(row.id);
      if (!Array.isArray(skill.surfaces)) {
        errors.push(`${skill.id}: inventory surfaces must be an array`);
        return false;
      }
      return skill.surfaces.includes(hostSurface);
    })
    .map(describe);

  if (errors.length > 0) return emptyView();
  return freezeDeep({ errors, publicEntries, bundledChildren, hostOnly, withdrawn: [...compiled.withdrawn], selectionDigest });
}

const SCRIPT_EXTENSIONS = /\.(?:js|cjs|mjs|sh|py|swift)$/;

function shipsScripts(root, skillPath) {
  const directory = path.join(root, skillPath, 'scripts');
  if (!fs.existsSync(directory)) return false;
  return fs.readdirSync(directory).some((name) => SCRIPT_EXTENSIONS.test(name));
}

function tracingTests(directory, testSources) {
  const needles = [`skills/${directory}/`, `'${directory}'`, `"${directory}"`];
  return testSources
    .filter((source) => needles.some((needle) => source.text.includes(needle)))
    .map((source) => source.file)
    .sort();
}

// Build the 3.1 disposition ledger: one row per inventory ID with its kind,
// owner, authority, selection, version condition (gating profiles; empty for
// core), behavior class, and the test files that trace a scripted skill.
function compileDispositionLedger({ inventory, selection, aliases = [], root, testSources = [] }) {
  const compiled = compileMarketplaceSelection({ inventory, selection, aliases });
  if (compiled.errors.length > 0) return freezeDeep({ errors: [...compiled.errors], rows: [] });
  const rowsById = new Map(selection.skills.map((row) => [row.id, row]));
  const errors = [];
  const rows = inventory.skills.map((skill) => {
    const row = rowsById.get(skill.id);
    const directory = path.basename(skill.path);
    const scripted = row.selection !== 'withdrawn' && shipsScripts(root, skill.path);
    const tests = scripted ? tracingTests(directory, testSources) : [];
    if (scripted && tests.length === 0) errors.push(`${skill.id}: ships scripts but no test traces skills/${directory}`);
    return {
      id: skill.id,
      name: skill.name,
      directory,
      kind: row.kind,
      owner: row.kind === 'entry' ? skill.id : row.owner,
      authority: row.authority,
      selection: row.selection,
      versionCondition: (skill.profiles || []).filter((profile) => profile !== 'core').sort(),
      behavior: row.selection === 'withdrawn' ? 'withdrawn' : (scripted ? 'script' : 'guidance-only'),
      tests,
    };
  });
  if (errors.length > 0) return freezeDeep({ errors, rows: [] });
  return freezeDeep({ errors: [], rows });
}

module.exports = { compileMarketplaceSelection, compileMarketplacePublicationView, compileDispositionLedger };
