'use strict';

const { readSkillDirectories } = require('./skill-distribution-source');

const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function compileSkillMap(root, existing, key) {
  const records = new Map();
  for (const skill of readSkillDirectories(root)) {
    if (records.has(skill.id)) throw new Error(`duplicate Skill identity ${skill.id}`);
    records.set(skill.id, skill.distribution[key]);
  }
  const order = [...Object.keys(existing.skills || {}), ...[...records.keys()].sort()];
  const skills = {};
  for (const id of order) if (records.get(id) !== undefined && !Object.prototype.hasOwnProperty.call(skills, id)) skills[id] = records.get(id);
  return { ...existing, skills };
}

function skillMapDrift(existing, generated, key) {
  return [...new Set([...Object.keys(existing.skills || {}), ...Object.keys(generated.skills || {})])]
    .filter(id => !same((existing.skills || {})[id], (generated.skills || {})[id]))
    .map(id => `${id}: ${key} differs from Skill directory`);
}

function compileDirectoryInventory(root, existing, defaults) {
  if (!Array.isArray(existing.skills) || !Array.isArray(existing.modules)) throw new Error('invalid v2 inventory: skills and modules must be arrays');
  const generated = [];
  const seen = new Set();
  const directories = readSkillDirectories(root);
  const order = [...existing.skills.map(row => row.path), ...directories.map(skill => skill.path).sort()];
  for (const directoryPath of order) {
    const skill = directories.find(candidate => candidate.path === directoryPath);
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    const prior = existing.skills.find(row => row.id === skill.id);
    const seed = (defaults.skills || []).find(row => row.path === skill.path) || { lifecycle: 'promoted', surfaces: ['claude-core'] };
    const entry = { ...(prior || seed), id: skill.id, name: skill.name, path: skill.path, capability_id: skill.capability_id };
    for (const key of ['invocation_class', 'name_style']) {
      if (skill[key] !== undefined) entry[key] = skill[key];
      else delete entry[key];
    }
    for (const key of ['usage', 'standalone_dependencies']) {
      if (skill.distribution[key] !== undefined) entry[key] = skill.distribution[key];
      else delete entry[key];
    }
    generated.push(entry);
  }
  if (new Set(directories.map(skill => skill.id)).size !== directories.length) throw new Error('duplicate Skill identity in directory metadata');
  return { ...existing, skills: generated };
}

function inventoryDrift(existing, generated) {
  const errors = [];
  for (const id of new Set([...existing.skills.map(row => row.id), ...generated.skills.map(row => row.id)])) {
    const prior = existing.skills.find(row => row.id === id);
    const next = generated.skills.find(row => row.id === id);
    if (!prior || !next) { errors.push(`${id}: directory/inventory membership drift`); continue; }
    for (const key of ['id', 'name', 'path', 'capability_id', 'invocation_class', 'usage', 'standalone_dependencies', 'name_style']) {
      if (!same(prior[key], next[key])) errors.push(`${id}: ${key} differs from Skill directory`);
    }
  }
  return errors;
}

function assertDirectoryInventory(root, inventory) {
  if (inventory.schema !== 'dhpk.distribution-inventory.v2') return;
  const generated = compileDirectoryInventory(root, inventory, { skills: [] });
  const errors = inventoryDrift(inventory, generated);
  if (errors.length) throw new Error(errors.join('; '));
}

module.exports = { serialize, same, compileSkillMap, skillMapDrift, compileDirectoryInventory, inventoryDrift, assertDirectoryInventory };
