'use strict';

// The inventory owns stable identity and publication. This module owns the
// issue #469 decision contract that explains why each active entry remains
// public, optional, internal, or externally owned. It deliberately does not
// mutate the inventory or create aliases.

const fs = require('node:fs');
const path = require('node:path');
const { extract: extractFrontmatter } = require('../ci/_lib/frontmatter');

const SCHEMA = 'dhpk.skill-purpose-decisions.v1';
const CONTRACT_VERSION = 'dhpk.skill-purpose-contract.v1';
const BASELINE_SCHEMA = 'dhpk.skill-baseline.v1';
const DISPOSITIONS = Object.freeze([
  'retain-standalone',
  'retain-family',
  'retain-optional',
  'retain-internal',
  'retain-external',
]);
const AUTHORITY = Object.freeze([
  'read-only',
  'guidance-only',
  'workspace-write',
  'git-write',
  'delegate',
  'external-write',
  'transport-internal',
  'external-package',
]);
const COMPATIBILITY = Object.freeze([
  'stable-id-preserved',
  'public-identity-preserved',
  'frontmatter-name-matches-inventory',
  'canonical-path-matches-inventory',
  'no-permanent-alias',
]);

const CONTRACTS = Object.freeze({
  'retain-standalone': Object.freeze({
    authority: 'source-usage-or-guidance',
    independentUse: true,
    successorKind: 'self',
    compatibility: COMPATIBILITY,
  }),
  'retain-family': Object.freeze({
    authority: 'source-usage-or-guidance',
    independentUse: true,
    successorKind: 'family',
    compatibility: [...COMPATIBILITY, 'family-selector-preserved'],
  }),
  'retain-optional': Object.freeze({
    authority: 'source-usage-or-guidance',
    independentUse: true,
    successorKind: 'self',
    compatibility: COMPATIBILITY,
  }),
  'retain-internal': Object.freeze({
    authority: 'transport-internal',
    independentUse: false,
    successorKind: 'runtime-support',
    compatibility: ['stable-id-preserved', 'canonical-path-matches-inventory', 'no-permanent-alias'],
  }),
  'retain-external': Object.freeze({
    authority: 'external-package',
    independentUse: true,
    successorKind: 'external-package',
    compatibility: ['stable-id-preserved', 'public-identity-preserved', 'canonical-path-matches-inventory', 'no-permanent-alias'],
  }),
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function readSkillFrontmatter(root, skill) {
  const file = path.join(root, skill.path, 'SKILL.md');
  if (!fs.existsSync(file)) return { present: false, values: {} };
  return extractFrontmatter(fs.readFileSync(file, 'utf8'));
}

function usageAuthority(skill) {
  const usage = skill.usage || {};
  if (nonEmptyString(usage.effect_authority)) return usage.effect_authority;
  const actions = Array.isArray(usage.actions) ? usage.actions : [];
  const authorities = [...new Set(actions.map((action) => action && action.effect_authority).filter(nonEmptyString))];
  if (authorities.length === 1) return authorities[0];
  if (authorities.length > 1) return 'external-write';
  return 'guidance-only';
}

function activeExternalOwner(inventory, id) {
  return (inventory.external_skill_packages || []).find((entry) => (
    entry && Array.isArray(entry.stable_ids) && entry.stable_ids.includes(id)
  )) || null;
}

function activeFamily(inventory, id) {
  return (inventory.skill_routing_families || []).find((family) => family && family.id === id) || null;
}

function effectiveDecision({ inventory, ledger, row, root = process.cwd() } = {}) {
  const skill = (inventory.skills || []).find((entry) => entry && entry.id === row.id);
  if (!skill) throw new Error(`unknown active skill '${row && row.id}'`);
  const contract = CONTRACTS[row.disposition];
  if (!contract) throw new Error(`unsupported disposition '${row.disposition}'`);
  const frontmatter = readSkillFrontmatter(root, skill);
  const family = row.family || (row.disposition === 'retain-family' ? skill.id : null);
  const owner = row.owner || (row.disposition === 'retain-external' ? (activeExternalOwner(inventory, skill.id) || {}).id : null);
  const authority = contract.authority === 'source-usage-or-guidance'
    ? usageAuthority(skill)
    : contract.authority;
  return {
    id: skill.id,
    stableId: skill.id,
    publicName: skill.name,
    path: skill.path,
    disposition: row.disposition,
    task: {
      source: 'skill.frontmatter.description',
      value: frontmatter.values.description || null,
    },
    authority,
    independentUse: contract.independentUse,
    successor: { kind: contract.successorKind, id: family || owner || skill.id },
    compatibility: [...contract.compatibility],
    rationale: row.rationale,
    family,
    owner,
    source: {
      inventory: 'manifests/distribution-inventory.json',
      skill: `${skill.path}/SKILL.md`,
      contractVersion: ledger.contractVersion,
    },
  };
}

function validateSkillPurposeDecisions({ inventory, ledger, root = process.cwd() } = {}) {
  const errors = [];
  const effective = [];
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return { ok: false, errors: ['inventory must be an object'], effective };
  }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return { ok: false, errors: ['purpose decision ledger must be an object'], effective };
  }
  if (ledger.schema !== SCHEMA) errors.push(`purpose decision ledger schema must be ${SCHEMA}`);
  if (ledger.contractVersion !== CONTRACT_VERSION) errors.push(`purpose decision ledger contractVersion must be ${CONTRACT_VERSION}`);
  if (!ledger.baseline || ledger.baseline.path !== 'docs/baselines/issue-467-develop-bba2873.json') {
    errors.push('purpose decision ledger must reference the issue #467 baseline path');
  }
  if (!Array.isArray(ledger.decisions)) {
    return { ok: false, errors: [...errors, 'purpose decision ledger requires a decisions array'], effective };
  }

  const activeSkills = (inventory.skills || []).filter((entry) => entry && typeof entry.id === 'string');
  const activeById = new Map(activeSkills.map((entry) => [entry.id, entry]));
  const retiredIds = new Set((inventory.retired_skills || []).map((entry) => entry && entry.id).filter(nonEmptyString));
  const rowsById = new Map();
  for (const [index, row] of ledger.decisions.entries()) {
    const prefix = `decision[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const allowed = new Set(['id', 'disposition', 'rationale', 'family', 'owner', 'publicName', 'path']);
    for (const field of Object.keys(row)) if (!allowed.has(field)) errors.push(`${prefix}.${field} is not allowed`);
    if (!nonEmptyString(row.id)) {
      errors.push(`${prefix}.id must be a non-empty string`);
      continue;
    }
    if (rowsById.has(row.id)) errors.push(`duplicate purpose decision '${row.id}'`);
    rowsById.set(row.id, row);
    if (!activeById.has(row.id)) {
      errors.push(`purpose decision '${row.id}' does not resolve to an active skill`);
      continue;
    }
    if (retiredIds.has(row.id)) errors.push(`purpose decision '${row.id}' conflicts with the retired ledger`);
    if (!DISPOSITIONS.includes(row.disposition)) {
      errors.push(`${prefix}.${row.id}.disposition must be one of ${DISPOSITIONS.join('/')}`);
      continue;
    }
    if (!nonEmptyString(row.rationale)) errors.push(`${prefix}.${row.id}.rationale is required`);
    const skill = activeById.get(row.id);
    if (row.publicName !== undefined && row.publicName !== skill.name) errors.push(`${row.id}.publicName must match inventory name '${skill.name}'`);
    if (row.path !== undefined && row.path !== skill.path) errors.push(`${row.id}.path must match inventory path '${skill.path}'`);
    const contract = CONTRACTS[row.disposition];
    const external = activeExternalOwner(inventory, row.id);
    const family = activeFamily(inventory, row.id);
    if (row.disposition === 'retain-internal' && (skill.invokable !== false || skill.discoveryVisible !== false)) {
      errors.push(`${row.id} retain-internal requires invokable=false and discoveryVisible=false`);
    }
    if (row.disposition !== 'retain-internal' && (skill.invokable === false || skill.discoveryVisible === false)) {
      errors.push(`${row.id} is an internal skill and must retain-internal`);
    }
    if (row.disposition === 'retain-external' && !external) errors.push(`${row.id} retain-external requires an external skill package owner`);
    if (row.disposition === 'retain-external' && external && row.owner !== external.id) {
      errors.push(`${row.id}.owner must match external skill package '${external.id}'`);
    }
    if (row.disposition !== 'retain-external' && external) errors.push(`${row.id} belongs to external package '${external.id}' and must retain-external`);
    if (row.disposition === 'retain-family' && !family) errors.push(`${row.id} retain-family requires an inventory skill_routing_families entry`);
    if (row.family !== undefined && (!family || row.family !== family.id)) errors.push(`${row.id}.family must match its inventory routing family`);
    if (contract && contract.authority === 'source-usage-or-guidance' && !AUTHORITY.includes(usageAuthority(skill))) {
      errors.push(`${row.id} resolves to unsupported source authority '${usageAuthority(skill)}'`);
    }
    const frontmatter = readSkillFrontmatter(root, skill);
    if (!nonEmptyString(frontmatter.values.description)) errors.push(`${row.id} is missing the task source description`);
    if (frontmatter.values.name !== skill.name) errors.push(`${row.id} SKILL.md name must match inventory public name '${skill.name}'`);
    try {
      effective.push(effectiveDecision({ inventory, ledger, row, root }));
    } catch (error) {
      errors.push(`${prefix}.${row.id}: ${error.message}`);
    }
  }

  for (const skill of activeSkills) {
    if (!rowsById.has(skill.id)) errors.push(`missing decision for active skill '${skill.id}'`);
  }
  if (rowsById.size !== activeSkills.length) errors.push(`purpose decisions must cover exactly ${activeSkills.length} active skills`);

  const baselinePath = ledger.baseline && path.join(root, ledger.baseline.path);
  if (baselinePath && fs.existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      if (baseline.schema !== BASELINE_SCHEMA) errors.push(`baseline must use ${BASELINE_SCHEMA}`);
      const baselineIds = new Set((baseline.static && baseline.static.skills || []).map((entry) => entry && entry.id).filter(nonEmptyString));
      for (const id of activeById.keys()) if (!baselineIds.has(id)) errors.push(`active skill '${id}' is absent from the issue #467 baseline`);
      for (const id of baselineIds) if (!activeById.has(id)) errors.push(`baseline skill '${id}' is absent from the current inventory`);
    } catch (error) {
      errors.push(`cannot read issue #467 baseline: ${error.message}`);
    }
  } else {
    errors.push(`issue #467 baseline is missing at '${ledger.baseline && ledger.baseline.path}'`);
  }

  return { ok: errors.length === 0, errors, effective: effective.map(clone) };
}

module.exports = {
  AUTHORITY,
  COMPATIBILITY,
  CONTRACTS,
  CONTRACT_VERSION,
  DISPOSITIONS,
  SCHEMA,
  effectiveDecision,
  validateSkillPurposeDecisions,
};
