'use strict';

// Runtime support is an inventory-declared dependency of a generated package,
// not a profile capability.  Keeping it separate prevents a minimal profile
// from acquiring invokable authority merely because one of its agents needs a
// local wrapper and transport implementation.

const INTERNAL_RUNTIME_SURFACES = Object.freeze([
  'agent-plugin',
  'cursor-plugin',
  'agy-plugin',
  'codex-native',
]);

function runtimeSupportSkillIds(inventory, surface) {
  const mapping = inventory && inventory.internal_runtime_skills;
  if (mapping === undefined) return [];
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new Error('internal_runtime_skills must be an object');
  }
  const values = mapping[surface];
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`internal_runtime_skills.${surface} must be a string array`);

  const entries = new Map((inventory.skills || []).map((entry) => [entry && entry.id, entry]));
  const declaredMembership = inventory.surface_membership && inventory.surface_membership[surface];
  const membership = Array.isArray(declaredMembership)
    ? declaredMembership
    : surface === 'codex-native'
      ? [...entries.values()].filter((entry) => (entry.surfaces || []).includes(surface)).map((entry) => entry.id)
      : null;
  if (!Array.isArray(membership)) throw new Error(`internal runtime support requires surface_membership.${surface}`);
  const seen = new Set();
  return values.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') throw new Error(`internal_runtime_skills.${surface} contains an empty/non-string stable id`);
    if (seen.has(id)) throw new Error(`internal_runtime_skills.${surface} contains duplicate stable id '${id}'`);
    seen.add(id);
    const entry = entries.get(id);
    if (!entry || entry.lifecycle === 'deprecated') throw new Error(`internal_runtime_skills.${surface} references unknown stable id '${id}'`);
    if (!membership.includes(id)) {
      throw new Error(`internal_runtime_skills.${surface} references '${id}' outside surface membership`);
    }
    return id;
  });
}

function validateInternalRuntimeSkills({ inventory, skillIds = new Set() } = {}) {
  const errors = [];
  const mapping = inventory && inventory.internal_runtime_skills;
  if (mapping === undefined) return { errors };
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return { errors: ['internal_runtime_skills must be an object when present'] };
  }
  for (const surface of Object.keys(mapping)) {
    if (!INTERNAL_RUNTIME_SURFACES.includes(surface)) {
      errors.push(`internal_runtime_skills declares unsupported surface '${surface}'`);
    }
  }
  for (const surface of INTERNAL_RUNTIME_SURFACES) {
    if (!Object.prototype.hasOwnProperty.call(mapping, surface)) {
      errors.push(`internal_runtime_skills is missing required '${surface}' support`);
      continue;
    }
    try {
      runtimeSupportSkillIds(inventory, surface);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { errors };
}

module.exports = {
  INTERNAL_RUNTIME_SURFACES,
  runtimeSupportSkillIds,
  validateInternalRuntimeSkills,
};
