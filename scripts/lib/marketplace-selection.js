'use strict';

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

module.exports = { compileMarketplaceSelection };
