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

function stableValue(value) {
  return canonicalize(value);
}

function projectionEntries(projection) {
  return projection && Array.isArray(projection.entries) ? projection.entries : null;
}

function projectionEntryMap(projection, side, surface, diagnostics, mismatches) {
  const map = new Map();
  const entries = projectionEntries(projection);
  if (!entries) {
    diagnostics.push(`projection surface '${surface}' ${side} projection must contain an entries array`);
    mismatches.push(mismatch({
      stableId: '<projection>',
      surface,
      type: 'invalid',
      field: 'entries',
      expected: side === 'expected' ? projection && projection.entries : undefined,
      actual: side === 'actual' ? projection && projection.entries : undefined,
    }));
    return map;
  }
  for (const entry of entries) {
    const stableId = entry && entry.stableId;
    if (typeof stableId !== 'string' || stableId.trim() === '') {
      diagnostics.push(`projection surface '${surface}' contains an entry without a stable id in ${side} projection`);
      mismatches.push(mismatch({
        stableId: '<entry>',
        surface,
        type: 'invalid',
        expected: side === 'expected' ? entry : undefined,
        actual: side === 'actual' ? entry : undefined,
      }));
      continue;
    }
    if (map.has(stableId)) {
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' is duplicated in ${side} projection`);
      mismatches.push(mismatch({
        stableId,
        surface,
        type: 'duplicate',
        expected: side === 'expected' ? entry : undefined,
        actual: side === 'actual' ? entry : undefined,
      }));
      continue;
    }
    map.set(stableId, entry);
  }
  return map;
}

function mismatch({ stableId, surface, type, field, expected, actual }) {
  return {
    stableId,
    surface,
    type,
    ...(field ? { field } : {}),
    expected,
    actual,
  };
}

function compareSkillRoutingProjections({ expected, actual } = {}) {
  const diagnostics = [];
  const mismatches = [];
  const expectedSurface = expected && typeof expected.surface === 'string' ? expected.surface : '<missing>';
  const actualSurface = actual && typeof actual.surface === 'string' ? actual.surface : '<missing>';
  const surface = expectedSurface === actualSurface
    ? expectedSurface
    : `${expectedSurface} vs ${actualSurface}`;

  if (!expected || typeof expected !== 'object' || !actual || typeof actual !== 'object') {
    diagnostics.push(`projection surface '${surface}' is missing or not an object`);
    mismatches.push(mismatch({ stableId: '<projection>', surface, type: 'invalid', expected, actual }));
    return { ok: false, diagnostics, mismatches };
  }
  if (expected.schema !== actual.schema) {
    diagnostics.push(`projection surface '${surface}' schema drift: expected '${expected.schema}', actual '${actual.schema}'`);
    mismatches.push(mismatch({ stableId: '<projection>', surface, type: 'field', field: 'schema', expected: expected.schema, actual: actual.schema }));
  }
  if (expected.surface !== actual.surface) {
    diagnostics.push(`projection surface '${surface}' surface drift: expected '${expected.surface}', actual '${actual.surface}'`);
    mismatches.push(mismatch({ stableId: '<projection>', surface, type: 'field', field: 'surface', expected: expected.surface, actual: actual.surface }));
  }

  const expectedMap = projectionEntryMap(expected, 'expected', surface, diagnostics, mismatches);
  const actualMap = projectionEntryMap(actual, 'actual', surface, diagnostics, mismatches);
  const ids = new Set([...expectedMap.keys(), ...actualMap.keys()].filter((id) => typeof id === 'string'));
  for (const stableId of [...ids].sort()) {
    const expectedEntry = expectedMap.get(stableId);
    const actualEntry = actualMap.get(stableId);
    if (!actualEntry) {
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' missing from actual projection`);
      mismatches.push(mismatch({ stableId, surface, type: 'missing', expected: expectedEntry, actual: undefined }));
      continue;
    }
    if (!expectedEntry) {
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' is extra in actual projection`);
      mismatches.push(mismatch({ stableId, surface, type: 'extra', expected: undefined, actual: actualEntry }));
      continue;
    }
    for (const field of ENTRY_FIELDS) {
      if (stableValue(expectedEntry[field]) === stableValue(actualEntry[field])) continue;
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' field drift '${field}': expected ${stableValue(expectedEntry[field])}, actual ${stableValue(actualEntry[field])}`);
      mismatches.push(mismatch({ stableId, surface, type: 'field', field, expected: expectedEntry[field], actual: actualEntry[field] }));
    }
  }

  return { ok: mismatches.length === 0, diagnostics, mismatches };
}

module.exports = {
  PROJECTION_SCHEMA,
  BUDGET_FIELDS,
  ENTRY_FIELDS,
  buildSkillRoutingProjection,
  compareSkillRoutingProjections,
  deterministicFingerprint,
};
