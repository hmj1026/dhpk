'use strict';

// The inventory owns stable identity and publication. This module owns the
// issue #469 decision contract that explains why each active entry remains
// public, optional, internal, or externally owned. It deliberately does not
// mutate the inventory or create aliases.

const fs = require('node:fs');
const path = require('node:path');
const { extract: extractFrontmatter } = require('../ci/_lib/frontmatter');

const SCHEMA = 'dhpk.skill-purpose-decisions.v2';
const CONTRACT_VERSION = 'dhpk.skill-purpose-contract.v2';
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
const DUPLICATE_CONTENT_STATUSES = Object.freeze([
  'distinct',
  'internalized',
  'merged',
  'externally-owned',
  'removed',
]);
const COMPATIBILITY = Object.freeze([
  'stable-id-preserved',
  'public-identity-preserved',
  'frontmatter-name-matches-inventory',
  'canonical-path-matches-inventory',
  'no-permanent-alias',
]);

// Purpose records explain content and disposition; distribution-inventory.json
// remains the only owner of executable identity and publication/migration
// facts.  Keep the current retirement wave closed here so a partial decision
// record cannot make a predecessor disappear from review.
const CURRENT_WAVE = Object.freeze({
  'laravel-5.4-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/5-4.md', contentValue: 'Laravel 5.4 guidance is internalized behind the laravel family selector.' }),
  'laravel-6-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/6.md', contentValue: 'Laravel 6 guidance is internalized behind the laravel family selector.' }),
  'laravel-7-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/7.md', contentValue: 'Laravel 7 guidance is internalized behind the laravel family selector.' }),
  'laravel-8-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/8.md', contentValue: 'Laravel 8 guidance is internalized behind the laravel family selector.' }),
  'laravel-9-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/9.md', contentValue: 'Laravel 9 guidance is internalized behind the laravel family selector.' }),
  'laravel-10-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/10.md', contentValue: 'Laravel 10 guidance is internalized behind the laravel family selector.' }),
  'laravel-11-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/11.md', contentValue: 'Laravel 11 guidance is internalized behind the laravel family selector.' }),
  'laravel-mix-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical Laravel family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/laravel/references/mix.md', contentValue: 'Laravel Mix guidance is internalized behind the laravel family selector.' }),
  'phpunit-9-modern': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical PHPUnit family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/phpunit/references/9.md', contentValue: 'PHPUnit 9 guidance is internalized behind the phpunit family selector.' }),
  'phpunit-10-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical PHPUnit family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/phpunit/references/10.md', contentValue: 'PHPUnit 10 guidance is internalized behind the phpunit family selector.' }),
  'phpunit-11-notes': Object.freeze({ outcome: 'internalize', disposition: 'internalize', authority: 'guidance-only', duplicateStatus: 'internalized', duplicateFact: 'Compared with the canonical PHPUnit family content; the version guidance is retained behind its selector.', duplicateEvidence: 'skills/phpunit/references/11.md', contentValue: 'PHPUnit 11 guidance is internalized behind the phpunit family selector.' }),
  'claude-health': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'guidance-only', duplicateStatus: 'merged', duplicateFact: 'Compared with the harness-govern health mode; the health guidance has one canonical home.', duplicateEvidence: 'skills/harness-govern/SKILL.md', contentValue: 'Harness health guidance is merged into the harness-govern health mode.' }),
  'harness-budget': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'guidance-only', duplicateStatus: 'merged', duplicateFact: 'Compared with the harness-govern budget mode; the budget guidance has one canonical home.', duplicateEvidence: 'skills/harness-govern/SKILL.md', contentValue: 'Harness budget guidance is merged into the harness-govern budget mode.' }),
  'harness-fill': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'guidance-only', duplicateStatus: 'merged', duplicateFact: 'Compared with the harness-govern fill mode; the fill guidance has one canonical home.', duplicateEvidence: 'skills/harness-govern/SKILL.md', contentValue: 'Harness fill guidance is merged into the harness-govern fill mode.' }),
  'harness-revise': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'guidance-only', duplicateStatus: 'merged', duplicateFact: 'Compared with the harness-govern revise mode; the revision guidance has one canonical home.', duplicateEvidence: 'skills/harness-govern/SKILL.md', contentValue: 'Harness revision guidance is merged into the harness-govern revise mode.' }),
  'multi-ai-sync': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'guidance-only', duplicateStatus: 'merged', duplicateFact: 'Compared with the harness-govern sync mode; cross-agent synchronization guidance has one canonical home.', duplicateEvidence: 'skills/harness-govern/SKILL.md', contentValue: 'Cross-agent synchronization guidance is merged into the harness-govern sync mode.' }),
  'agy-commit': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'git-write', duplicateStatus: 'merged', duplicateFact: 'Compared with the git-smart-commit workflow; AGY commit guidance has one canonical commit owner.', duplicateEvidence: 'skills/dhpk-git-smart-commit/SKILL.md', contentValue: 'AGY commit guidance is merged into the git-smart-commit workflow without an AGY adapter.' }),
  'feasibility-study': Object.freeze({ outcome: 'merge', disposition: 'merge', authority: 'guidance-only', duplicateStatus: 'merged', duplicateFact: 'Compared with the software-architecture compare mode; feasibility guidance has one canonical architecture owner.', duplicateEvidence: 'skills/dhpk-module-design/SKILL.md', contentValue: 'Feasibility comparison guidance is merged into the software-architecture compare mode.' }),
  'tech-spec': Object.freeze({ outcome: 'retire', disposition: 'retire', authority: 'external-write', duplicateStatus: 'externally-owned', duplicateFact: 'Compared with the external proposal workflow; DHPK does not copy or execute a second technical-spec authoring surface.', duplicateEvidence: 'openspec/changes/issue-534-skill-distribution-consolidation/design.md', contentValue: 'Technical-spec authoring is owned by the external openspec-propose workflow.' }),
  'create-request': Object.freeze({ outcome: 'retire', disposition: 'retire', authority: 'external-write', duplicateStatus: 'externally-owned', duplicateFact: 'Compared with the external proposal workflow; DHPK does not copy or execute a second request-authoring surface.', duplicateEvidence: 'openspec/changes/issue-534-skill-distribution-consolidation/design.md', contentValue: 'Request authoring is owned by the external openspec-propose workflow.' }),
  'op-session': Object.freeze({ outcome: 'remove', disposition: 'remove', authority: 'external-write', duplicateStatus: 'removed', duplicateFact: 'Compared with the operator-owned OnePassword action; session setup is not duplicated as a distributed skill.', duplicateEvidence: 'skills/harness-govern/SKILL.md', contentValue: 'OnePassword session setup is an operator action, not a distributed skill.' }),
});
const RETIREMENT_OUTCOMES = Object.freeze(['internalize', 'merge', 'retire', 'remove']);
const OUTCOMES = Object.freeze(['retain', ...RETIREMENT_OUTCOMES]);
const EVIDENCE_STATES = Object.freeze(['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'BLOCKED']);
const INVENTORY_DERIVED_FIELDS = Object.freeze([
  'name', 'path', 'publicName', 'canonicalPath', 'surfaces', 'surface',
  'successor', 'migration', 'rollback',
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
  const authority = row.authority || (contract.authority === 'source-usage-or-guidance'
    ? usageAuthority(skill)
    : contract.authority);
  return {
    id: skill.id,
    stableId: skill.id,
    publicName: skill.name,
    path: skill.path,
    outcome: row.outcome || 'retain',
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
    contentValue: row.content_value,
    duplicateContent: clone(row.duplicate_content),
    callers: row.callers.map((caller) => caller),
    evidence: clone(row.evidence),
    family,
    owner,
    source: {
      inventory: 'manifests/distribution-inventory.json',
      skill: `${skill.path}/SKILL.md`,
      contractVersion: ledger.contractVersion,
    },
  };
}

function validateEvidence(errors, evidence, prefix) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  const allowed = new Set(['source', 'structural', 'consumer', 'runtime']);
  for (const field of Object.keys(evidence)) {
    if (!allowed.has(field)) errors.push(`${prefix}.${field} is not allowed`);
  }
  if (!nonEmptyString(evidence.source)) errors.push(`${prefix}.source must be a non-empty repository path or evidence pointer`);
  for (const field of ['structural', 'consumer', 'runtime']) {
    if (evidence[field] !== undefined && !EVIDENCE_STATES.includes(evidence[field])) {
      errors.push(`${prefix}.${field} must be one of ${EVIDENCE_STATES.join('/')}`);
    }
  }
  if (evidence.structural !== 'PASS') errors.push(`${prefix}.structural must be PASS for a checked-in decision`);
}

function validateDuplicateContent(errors, duplicateContent, prefix) {
  if (!duplicateContent || typeof duplicateContent !== 'object' || Array.isArray(duplicateContent)) {
    errors.push(`${prefix} must be an object with an explicit comparison fact and evidence`);
    return;
  }
  const allowed = new Set(['status', 'fact', 'comparison', 'evidence']);
  for (const field of Object.keys(duplicateContent)) {
    if (!allowed.has(field)) errors.push(`${prefix}.${field} is not allowed`);
  }
  if (!DUPLICATE_CONTENT_STATUSES.includes(duplicateContent.status)) {
    errors.push(`${prefix}.status must be one of ${DUPLICATE_CONTENT_STATUSES.join('/')}`);
  }
  for (const field of ['fact', 'comparison']) {
    if (!nonEmptyString(duplicateContent[field])) errors.push(`${prefix}.${field} must be a non-empty comparison fact`);
  }
  if (!duplicateContent.evidence || typeof duplicateContent.evidence !== 'object' || Array.isArray(duplicateContent.evidence)) {
    errors.push(`${prefix}.evidence must be an object with source and PASS status`);
    return;
  }
  if (!nonEmptyString(duplicateContent.evidence.source)) errors.push(`${prefix}.evidence.source must be a non-empty path or evidence pointer`);
  if (duplicateContent.evidence.status !== 'PASS') errors.push(`${prefix}.evidence.status must be PASS for a checked-in comparison`);
  for (const field of Object.keys(duplicateContent.evidence)) {
    if (!['source', 'status'].includes(field)) errors.push(`${prefix}.evidence.${field} is not allowed`);
  }
}

function validateCallers(errors, callers, prefix, root) {
  if (!Array.isArray(callers) || callers.length === 0) {
    errors.push(`${prefix} must be a non-empty array of repository caller paths`);
    return;
  }
  const seen = new Set();
  for (const caller of callers) {
    if (!nonEmptyString(caller) || caller.includes('\\') || path.posix.isAbsolute(caller)
      || caller.includes('..') || caller.includes('*')) {
      errors.push(`${prefix} contains an unsafe caller path '${caller}'`);
      continue;
    }
    if (seen.has(caller)) errors.push(`${prefix} contains duplicate caller '${caller}'`);
    seen.add(caller);
    if (root && !fs.existsSync(path.join(root, caller))) errors.push(`${prefix} caller does not exist: ${caller}`);
  }
}

function validateDecisionShape(errors, row, prefix, { retirement = false } = {}) {
  const allowed = retirement
    ? new Set(['id', 'outcome', 'disposition', 'authority', 'rationale', 'content_value', 'duplicate_content', 'callers', 'evidence'])
    : new Set(['id', 'outcome', 'disposition', 'authority', 'rationale', 'family', 'owner', 'content_value', 'duplicate_content', 'callers', 'evidence']);
  for (const field of Object.keys(row)) {
    if (!allowed.has(field)) errors.push(`${prefix}.${row.id || '<unknown>'}.${field} is not allowed; derive identity/publication facts from distribution inventory`);
    if (INVENTORY_DERIVED_FIELDS.includes(field)) {
      errors.push(`${prefix}.${row.id || '<unknown>'}.${field} must be derived from distribution inventory, not duplicated in the purpose ledger`);
    }
  }
  for (const field of ['id', 'outcome', 'disposition', 'authority', 'rationale', 'content_value']) {
    if (!nonEmptyString(row[field])) errors.push(`${prefix}.${field} must be a non-empty string`);
  }
  if (nonEmptyString(row.authority) && !AUTHORITY.includes(row.authority)) {
    errors.push(`${prefix}.authority must be one of ${AUTHORITY.join('/')}`);
  }
  validateDuplicateContent(errors, row.duplicate_content, `${prefix}.duplicate_content`);
  validateCallers(errors, row.callers, `${prefix}.callers`, null);
  validateEvidence(errors, row.evidence, `${prefix}.evidence`);
}

function validateCurrentWave({ inventory, ledger, errors, root }) {
  const rows = ledger.retirements;
  if (!Array.isArray(rows)) {
    errors.push('purpose decision ledger requires a retirements array for the current retirement wave');
    return [];
  }
  const retiredById = new Map((Array.isArray(inventory.retired_skills) ? inventory.retired_skills : [])
    .filter((entry) => entry && typeof entry.id === 'string')
    .map((entry) => [entry.id, entry]));
  const seen = new Set();
  const result = [];
  rows.forEach((row, index) => {
    const prefix = `retirements[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    validateDecisionShape(errors, row, prefix, { retirement: true });
    if (!nonEmptyString(row.id)) return;
    if (seen.has(row.id)) errors.push(`duplicate retirement purpose decision '${row.id}'`);
    seen.add(row.id);
    const expected = CURRENT_WAVE[row.id];
    const retired = retiredById.get(row.id);
    if (!expected) {
      errors.push(`unexpected current-wave retirement purpose decision '${row.id}'`);
      return;
    }
    if (!retired) errors.push(`retirement purpose decision '${row.id}' does not resolve to the inventory retired ledger`);
    if (row.outcome !== expected.outcome) errors.push(`${prefix}.${row.id}.outcome must be ${expected.outcome}`);
    if (row.disposition !== expected.disposition) errors.push(`${row.id} disposition must be ${expected.disposition}`);
    if (row.authority !== expected.authority) errors.push(`${row.id} authority must be ${expected.authority}`);
    if (row.content_value !== expected.contentValue) errors.push(`${row.id} content_value must describe the reviewed migration outcome`);
    if (!row.duplicate_content || row.duplicate_content.status !== expected.duplicateStatus) {
      errors.push(`${row.id} duplicate_content.status must be ${expected.duplicateStatus}`);
    } else {
      if (row.duplicate_content.fact !== expected.duplicateFact) errors.push(`${row.id} duplicate_content.fact must record the reviewed comparison`);
      if (!row.duplicate_content.comparison || !nonEmptyString(row.duplicate_content.comparison)) errors.push(`${row.id} duplicate_content.comparison is required`);
      if (!row.duplicate_content.evidence || row.duplicate_content.evidence.source !== expected.duplicateEvidence) errors.push(`${row.id} duplicate_content.evidence.source must be ${expected.duplicateEvidence}`);
    }
    validateCallers(errors, row.callers, `${prefix}.${row.id}.callers`, root);
    result.push({
      id: row.id,
      outcome: row.outcome,
      disposition: row.disposition,
      authority: row.authority,
      rationale: row.rationale,
      contentValue: row.content_value,
      duplicateContent: clone(row.duplicate_content),
      callers: row.callers.map((caller) => caller),
      evidence: clone(row.evidence),
      inventory: retired ? {
        retiredIn: retired.retiredIn,
        reasonCode: retired.reasonCode,
        replacements: clone(retired.replacements),
      } : null,
    });
  });
  for (const id of Object.keys(CURRENT_WAVE)) {
    if (!seen.has(id)) errors.push(`missing retirement purpose decision '${id}'`);
  }
  if (rows.length !== Object.keys(CURRENT_WAVE).length) {
    errors.push(`purpose retirement decisions must cover exactly ${Object.keys(CURRENT_WAVE).length} current-wave entries`);
  }
  return result;
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
    validateDecisionShape(errors, row, prefix);
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
    if (row.outcome !== 'retain') errors.push(`${prefix}.${row.id}.outcome must be retain for active decisions`);
    if (!DISPOSITIONS.includes(row.disposition)) {
      errors.push(`${prefix}.${row.id}.disposition must be one of ${DISPOSITIONS.join('/')}`);
      continue;
    }
    if (!nonEmptyString(row.rationale)) errors.push(`${prefix}.${row.id}.rationale is required`);
    const skill = activeById.get(row.id);
    validateCallers(errors, row.callers, `${prefix}.${row.id}.callers`, root);
    if (!nonEmptyString(row.content_value)) errors.push(`${row.id}.content_value is required`);
    if (row.content_value !== readSkillFrontmatter(root, skill).values.description) {
      errors.push(`${row.id}.content_value must match the canonical SKILL.md description`);
    }
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
    const expectedAuthority = contract && contract.authority === 'source-usage-or-guidance'
      ? usageAuthority(skill)
      : contract && contract.authority;
    if (row.authority !== expectedAuthority) errors.push(`${row.id}.authority must match the reviewed authority '${expectedAuthority}'`);
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

  const retirements = validateCurrentWave({ inventory, ledger, errors, root });

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

  return { ok: errors.length === 0, errors, effective: effective.map(clone), retirements: retirements.map(clone) };
}

module.exports = {
  AUTHORITY,
  COMPATIBILITY,
  CONTRACTS,
  CONTRACT_VERSION,
  CURRENT_WAVE,
  DUPLICATE_CONTENT_STATUSES,
  DISPOSITIONS,
  EVIDENCE_STATES,
  INVENTORY_DERIVED_FIELDS,
  OUTCOMES,
  RETIREMENT_OUTCOMES,
  SCHEMA,
  effectiveDecision,
  validateSkillPurposeDecisions,
};
