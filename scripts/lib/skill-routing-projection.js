'use strict';

// Deterministic Claude/Codex-facing view of the inventory-owned family router.
// Family and alias policy is deliberately obtained through
// normalizeSkillRoutingFamilies; this module only enriches that view with
// canonical skill metadata, discovery budgets, and source fingerprints.

const crypto = require('node:crypto');
const PROJECTION_SCHEMA = 'dhpk.skill-routing-projection.v1';
const BUDGET_FIELDS = Object.freeze(['words', 'tokens', 'wordBudget', 'tokenBudget']);
const ENTRY_FIELDS = Object.freeze([
  'name',
  'familyId',
  'routerId',
  'selector',
  'target',
  'invocationClass',
  'surfaces',
  'words',
  'tokens',
  'wordBudget',
  'tokenBudget',
  'sourceFingerprint',
]);

function cloneSorted(value) {
  if (Array.isArray(value)) return value.map(cloneSorted);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = cloneSorted(value[key]);
    return output;
  }
  return value;
}

function canonicalize(value) {
  return JSON.stringify(cloneSorted(value));
}

function deterministicFingerprint(value) {
  return crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function asEntries(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([id, entry]) => ({
    ...(entry && typeof entry === 'object' ? entry : {}),
    id: entry && typeof entry === 'object' && (entry.id || entry.stableId) || id,
  }));
}

function discoveryEntryMap(discoveryEntries) {
  const map = new Map();
  for (const entry of asEntries(discoveryEntries)) {
    if (!entry || typeof entry !== 'object') continue;
    const id = entry.stableId || entry.id;
    if (typeof id !== 'string' || id.trim() === '') continue;
    const surface = typeof entry.surface === 'string' && entry.surface.trim() !== ''
      ? entry.surface
      : '*';
    const key = `${surface}\u0000${id}`;
    if (!map.has(key)) map.set(key, entry);
    if (surface !== '*' && !map.has(`*\u0000${id}`)) map.set(`*\u0000${id}`, entry);
  }
  return map;
}

function lookupDiscoveryEntry(map, id, surface) {
  return map.get(`${surface}\u0000${id}`) || map.get(`*\u0000${id}`) || null;
}

function lookupProvidedFingerprint(sourceFingerprints, candidates) {
  if (!sourceFingerprints) return null;
  const get = (key) => {
    if (sourceFingerprints instanceof Map) return sourceFingerprints.get(key);
    if (typeof sourceFingerprints === 'object' && Object.prototype.hasOwnProperty.call(sourceFingerprints, key)) {
      return sourceFingerprints[key];
    }
    return undefined;
  };
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    const value = get(candidate);
    if (typeof value === 'string' && value.length > 0) return value;
    if (value && typeof value === 'object' && typeof value.sourceFingerprint === 'string' && value.sourceFingerprint.length > 0) {
      return value.sourceFingerprint;
    }
  }
  return null;
}

function sourceFingerprint({ sourceFingerprints, stableId, target, skill }) {
  const provided = lookupProvidedFingerprint(sourceFingerprints, [
    stableId,
    target,
    skill && skill.path,
    skill && skill.path && `${skill.path}/SKILL.md`,
    skill && skill.name,
  ]);
  if (provided !== null) return provided;
  if (skill && typeof skill.source_fingerprint === 'string' && skill.source_fingerprint.length > 0) {
    return skill.source_fingerprint;
  }
  if (skill && typeof skill.sourceFingerprint === 'string' && skill.sourceFingerprint.length > 0) {
    return skill.sourceFingerprint;
  }
  for (const field of ['source_digest', 'canonical_digest', 'digest']) {
    if (skill && typeof skill[field] === 'string' && skill[field].length > 0) return skill[field];
  }
  return deterministicFingerprint({
    stableId,
    canonicalSource: skill && skill.path ? `${skill.path}/SKILL.md` : target,
  });
}

function buildBudgetFields(entry) {
  if (!entry) return {};
  const output = {};
  for (const field of BUDGET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(entry, field)) output[field] = entry[field];
  }
  return output;
}

function buildSkillRoutingProjection({
  inventory,
  surface,
  discoveryEntries = [],
  sourceFingerprints = null,
} = {}) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new TypeError('inventory must be an object');
  }
  if (typeof surface !== 'string' || surface.trim() === '') {
    throw new TypeError('surface must be a non-empty string');
  }

  // Resolve lazily so distribution-inventory.js can re-export this shared
  // projection API without creating a circular initialization dependency.
  const { normalizeSkillRoutingFamilies } = require('./distribution-inventory');
  const families = normalizeSkillRoutingFamilies({ inventory });
  const skills = new Map(
    (Array.isArray(inventory.skills) ? inventory.skills : [])
      .filter((skill) => skill && typeof skill.id === 'string')
      .map((skill) => [skill.id, skill]),
  );
  const discovered = discoveryEntryMap(discoveryEntries);
  const entries = [];

  for (const family of families) {
    if (!family.surfaces.includes(surface)) continue;
    for (const alias of family.aliases) {
      if (!alias.surfaces.includes(surface)) continue;
      const skill = skills.get(alias.id);
      const target = family.selectors[alias.selector];
      const entry = {
        stableId: alias.id,
        name: skill && typeof skill.name === 'string' && skill.name.length > 0 ? skill.name : alias.id,
        familyId: family.id,
        routerId: family.routerId,
        selector: alias.selector,
        target,
        invocationClass: alias.invocationClass,
        surfaces: [...alias.surfaces].sort(),
        ...buildBudgetFields(lookupDiscoveryEntry(discovered, alias.id, surface)),
        sourceFingerprint: sourceFingerprint({ sourceFingerprints, stableId: alias.id, target, skill }),
      };
      entries.push(entry);
    }
  }

  entries.sort((left, right) => left.stableId.localeCompare(right.stableId));
  return freezeDeep({
    schema: PROJECTION_SCHEMA,
    surface,
    entries,
  });
}

function compareSkillRoutingProjections({ expected, actual } = {}) {
  // Legacy facade: the projection-parity module owns comparison. Budget
  // fields remain available only for this characterized compatibility API.
  const { compareRoutingProjections } = require('./distribution-projection-parity');
  return compareRoutingProjections({ expected, actual, includeBudget: true });
}

module.exports = {
  PROJECTION_SCHEMA,
  BUDGET_FIELDS,
  ENTRY_FIELDS,
  buildSkillRoutingProjection,
  compareSkillRoutingProjections,
  deterministicFingerprint,
};
