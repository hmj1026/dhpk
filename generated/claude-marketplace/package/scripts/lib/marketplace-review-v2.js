'use strict';

// dhpk.marketplace-review.v2: per-ID marketplace catalog review rows with
// common / Host-only selection, per-surface Host-only selection identity,
// authority monotonicity, multi-owner internals, optional resources and
// upstream-package withdrawal. v1 stays in skill-purpose-decisions.js.

const fs = require('node:fs');
const path = require('node:path');
const { nonEmptyString, reviewEvidence, reviewFile, reviewObject } = require('./marketplace-review-paths');

const VERSION = 'dhpk.marketplace-review.v2';
const KINDS = Object.freeze(['entry', 'reference', 'branch', 'internal', 'retired', 'withdrawn']);
const SELECTIONS = Object.freeze(['common', 'host-only']);
const LICENSE_STATUSES = Object.freeze(['first-party', 'approved', 'excluded', 'unresolved']);
const ROW_FIELDS = Object.freeze(['id', 'kind', 'owner_id', 'selection', 'host_selection', 'task_selector',
  'version_condition', 'resources', 'behavior_successor', 'test_evidence', 'authority', 'license']);
const WITHDRAWN_FIELDS = Object.freeze(['id', 'kind', 'owner_id', 'upstream_owner', 'behavior_successor',
  'authority', 'license']);
const HOST_SELECTION_FIELDS = Object.freeze(['surfaces', 'selection_id', 'purpose_evidence', 'execution_evidence']);

// Mirrors AUTHORITY_RANK in skill-usage.js for measured effects. The last
// three are disposition labels, not measured effects, so they rank lowest;
// monotonicity is therefore weak for them. Unknown values fail closed.
const AUTHORITY_RANK = Object.freeze({
  'external-write': 4,
  'git-write': 3,
  'workspace-write': 2,
  delegate: 1,
  'read-only': 0,
  'guidance-only': 0,
  'transport-internal': 0,
  'external-package': 0,
});

function rankOf(errors, authority, prefix) {
  if (Object.prototype.hasOwnProperty.call(AUTHORITY_RANK, authority)) return AUTHORITY_RANK[authority];
  errors.push(`${prefix}.authority '${authority}' has no authority rank (unknown)`);
  return null;
}

// PASS evidence under tests/, or an explicit GAP with a reason that is
// structurally valid but reported by marketplaceReviewBlockers.
function reviewTestEvidence(errors, value, prefix, root) {
  if (value && typeof value === 'object' && value.status === 'GAP') {
    reviewObject(errors, value, ['status', 'reason'], prefix);
    if (!nonEmptyString(value.reason)) errors.push(`${prefix}.reason must explain the GAP`);
    return;
  }
  reviewEvidence(errors, value, prefix, root, { test: true });
}

function ownersOf(row) {
  return Array.isArray(row.owner_id) ? row.owner_id : [row.owner_id];
}

function validateOwners(errors, row, rows, prefix) {
  const owners = ownersOf(row);
  if (Array.isArray(row.owner_id)) {
    if (row.kind !== 'internal') errors.push(`${prefix}.owner_id may be an array only for internal rows`);
    if (owners.length === 0) errors.push(`${prefix}.owner_id must name at least one entry owner`);
    if (new Set(owners).size !== owners.length) errors.push(`${prefix}.owner_id contains a duplicate owner`);
  }
  if (row.kind === 'entry') {
    if (row.owner_id !== row.id) errors.push(`${prefix}.owner_id must name the entry itself`);
    return [];
  }
  const valid = [];
  for (const owner of owners) {
    const ownerRow = rows.get(owner);
    if (!ownerRow || ownerRow.kind !== 'entry') {
      errors.push(`${prefix}.owner_id '${owner}' must name a direct entry owner`);
    } else {
      valid.push(ownerRow);
    }
  }
  return valid;
}

function validateResources(errors, row, owners, ctx, prefix) {
  if (!Array.isArray(row.resources)) {
    errors.push(`${prefix}.resources must be an array`);
    return;
  }
  const seen = new Set();
  let required = 0;
  for (const item of row.resources) {
    let resource = item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      reviewObject(errors, item, ['path', 'optional'], `${prefix}.resources`);
      if (item.optional !== true) errors.push(`${prefix}.resources object entries must set optional: true`);
      resource = item.path;
    } else {
      required += 1;
    }
    if (seen.has(resource)) errors.push(`${prefix}.resources contains duplicate path '${resource}'`);
    seen.add(resource);
    const realResource = reviewFile(errors, resource, `${prefix}.resources`, ctx.root);
    if (!realResource) continue;
    const physical = path.relative(fs.realpathSync(ctx.root), realResource).split(path.sep).join('/');
    const resourceOwners = [ctx.skills.get(row.id), ...owners.map((owner) => ctx.skills.get(owner.id))].filter(Boolean);
    const owned = (file) => ctx.declaredResources.has(file) || resourceOwners.some((skill) =>
      nonEmptyString(skill.path) && file.startsWith(`${skill.path}/`));
    if (!owned(resource) || !owned(physical)) {
      errors.push(`${prefix}.resources path '${resource}' is not owned or declared by inventory`);
    }
  }
  if (['reference', 'branch', 'internal'].includes(row.kind) && required === 0) {
    errors.push(`${prefix}.resources must be non-empty with at least one required resource for ${row.kind}`);
  }
}

function validateHostSelection(errors, row, ctx, prefix) {
  const isHostEntry = row.kind === 'entry' && row.selection === 'host-only';
  if (!isHostEntry) {
    if (row.host_selection !== undefined) {
      errors.push(`${prefix}.host_selection is allowed only on host-only entries`);
    }
    return;
  }
  if (!Array.isArray(row.host_selection) || row.host_selection.length === 0) {
    errors.push(`${prefix}.host_selection must list per-surface selections for a host-only entry`);
    return;
  }
  const inventorySurfaces = (ctx.skills.get(row.id) || {}).surfaces || [];
  const covered = new Set();
  const ids = new Set();
  for (const [index, group] of row.host_selection.entries()) {
    const groupPrefix = `${prefix}.host_selection[${index}]`;
    if (!reviewObject(errors, group, HOST_SELECTION_FIELDS, groupPrefix)) continue;
    if (!nonEmptyString(group.selection_id)) errors.push(`${groupPrefix}.selection_id must be a non-empty string`);
    else if (ids.has(group.selection_id)) errors.push(`${groupPrefix}.selection_id '${group.selection_id}' is a duplicate`);
    ids.add(group.selection_id);
    if (!Array.isArray(group.surfaces) || group.surfaces.length === 0) {
      errors.push(`${groupPrefix}.surfaces must be a non-empty array`);
    } else {
      for (const surface of group.surfaces) {
        if (!inventorySurfaces.includes(surface)) {
          errors.push(`${groupPrefix}.surface '${surface}' is not an inventory surface of ${row.id}`);
        } else if (covered.has(surface)) {
          errors.push(`${groupPrefix}.surface '${surface}' appears in more than one selection`);
        }
        covered.add(surface);
      }
    }
    reviewEvidence(errors, group.purpose_evidence, `${groupPrefix}.purpose_evidence`, ctx.root);
    reviewTestEvidence(errors, group.execution_evidence, `${groupPrefix}.execution_evidence`, ctx.root);
  }
  for (const surface of inventorySurfaces) {
    if (!covered.has(surface)) errors.push(`${prefix}.host_selection does not cover inventory surface '${surface}'`);
  }
}

function validateLicense(errors, row, ctx, prefix) {
  if (!reviewObject(errors, row.license, ['status', 'evidence'], `${prefix}.license`)) return;
  if (!LICENSE_STATUSES.includes(row.license.status)) {
    errors.push(`${prefix}.license.status must be ${LICENSE_STATUSES.join('/')}`);
  }
  if (ctx.external.has(row.id) && row.license.status === 'first-party') {
    errors.push(`${prefix}.license cannot claim first-party for an external package skill`);
  }
  if (row.kind === 'entry' && ['excluded', 'unresolved'].includes(row.license.status)) {
    errors.push(`${prefix}.license must be first-party or approved for an entry`);
  }
  if (row.kind === 'withdrawn' && row.license.status !== 'excluded') {
    errors.push(`${prefix}.license.status must be excluded for a withdrawn row`);
  }
  reviewFile(errors, row.license.evidence, `${prefix}.license.evidence`, ctx.root);
}

function validateWithdrawn(errors, row, rows, ctx, prefix) {
  reviewObject(errors, row, WITHDRAWN_FIELDS, prefix);
  const pkg = ctx.externalPackages.get(row.id);
  if (!pkg) errors.push(`${prefix} withdrawn is allowed only for an external package skill`);
  if (!nonEmptyString(row.upstream_owner) || !pkg || row.upstream_owner !== pkg.id) {
    errors.push(`${prefix}.upstream_owner must name the external package that owns ${row.id}`);
  }
  if (row.owner_id === undefined) {
    if (row.behavior_successor !== undefined) {
      errors.push(`${prefix}.behavior_successor requires an entry owner_id`);
    }
  } else {
    if (Array.isArray(row.owner_id)) errors.push(`${prefix}.owner_id must be a single entry for a withdrawn row`);
    else validateOwners(errors, row, rows, prefix);
    reviewEvidence(errors, row.behavior_successor, `${prefix}.behavior_successor`, ctx.root);
  }
}

function validateRow(errors, row, rows, ctx, prefix) {
  if (!KINDS.includes(row.kind)) errors.push(`${prefix}.kind must be ${KINDS.join('/')}`);
  if (!ctx.decisions.has(row.id) || row.authority !== ctx.decisions.get(row.id).authority) {
    errors.push(`${prefix}.authority must match the existing purpose decision authority`);
  }
  validateLicense(errors, row, ctx, prefix);
  if (row.kind === 'withdrawn') {
    validateWithdrawn(errors, row, rows, ctx, prefix);
    return;
  }
  reviewObject(errors, row, ROW_FIELDS, prefix);
  if (!SELECTIONS.includes(row.selection)) errors.push(`${prefix}.selection must be ${SELECTIONS.join('/')}`);
  for (const field of ['task_selector', 'version_condition']) {
    if (!nonEmptyString(row[field])) errors.push(`${prefix}.${field} must be a non-empty string`);
  }
  const owners = validateOwners(errors, row, rows, prefix);
  for (const owner of owners) {
    if (owner.selection !== row.selection) {
      errors.push(`${prefix}.owner_id '${owner.id}' selection '${owner.selection}' must match row selection '${row.selection}'`);
    }
    const childRank = rankOf(errors, row.authority, prefix);
    const ownerRank = rankOf(errors, owner.authority, `${prefix}.owner '${owner.id}'`);
    if (childRank !== null && ownerRank !== null && childRank > ownerRank) {
      errors.push(`${prefix}.authority '${row.authority}' exceeds owner '${owner.id}' authority '${owner.authority}'`);
    }
  }
  validateHostSelection(errors, row, ctx, prefix);
  validateResources(errors, row, owners, ctx, prefix);
  if (row.kind !== 'entry' || row.behavior_successor !== undefined) {
    reviewEvidence(errors, row.behavior_successor, `${prefix}.behavior_successor`, ctx.root);
  }
  reviewTestEvidence(errors, row.test_evidence, `${prefix}.test_evidence`, ctx.root);
}

function validateMarketplaceReviewV2({ inventory, ledger, review, errors, root }) {
  const prefix = 'marketplace_review';
  if (!Array.isArray(review.rows)) {
    errors.push(`${prefix}.rows must be an array`);
    return;
  }
  const skills = new Map((inventory.skills || []).filter((skill) => skill && nonEmptyString(skill.id))
    .map((skill) => [skill.id, skill]));
  const retired = new Set((inventory.retired_skills || []).map((skill) => skill && skill.id));
  const externalPackages = new Map((inventory.external_skill_packages || []).flatMap((item) =>
    (item.stable_ids || []).map((id) => [id, item])));
  const ctx = {
    root,
    skills,
    externalPackages,
    external: new Set(externalPackages.keys()),
    decisions: new Map(ledger.decisions.filter((row) => row && nonEmptyString(row.id)).map((row) => [row.id, row])),
    declaredResources: new Set([
      ...(inventory.supporting_assets || []).map((item) => item.source),
      ...(inventory.skill_routing_families || []).flatMap((item) => Object.values(item.selectors || {})),
      ...Object.values(inventory.standalone_dependencies || {}).flatMap((item) =>
        (item.files || []).map((file) => file.source)),
    ].filter(nonEmptyString)),
  };
  const rows = new Map();
  for (const [index, row] of review.rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${prefix}.rows[${index}] row must be an object`);
      continue;
    }
    if (!nonEmptyString(row.id)) {
      errors.push(`${prefix}.rows[${index}].id must be a non-empty active stable ID`);
      continue;
    }
    if (rows.has(row.id)) errors.push(`${prefix} duplicate review for '${row.id}'`);
    rows.set(row.id, row);
    if (!skills.has(row.id) || retired.has(row.id)) {
      errors.push(`${prefix}.rows[${index}].${row.id}.id must resolve to a current active, non-retired skill`);
    }
  }
  if (skills.size !== 84 || review.rows.length !== 84 || rows.size !== 84) {
    errors.push(`${prefix}.rows must cover exactly 84 active stable IDs`);
  }
  for (const id of skills.keys()) {
    if (!rows.has(id)) errors.push(`${prefix} missing review for active skill '${id}'`);
  }
  for (const [id, row] of rows) validateRow(errors, row, rows, ctx, `${prefix}.${id}`);
}

// Rows that are structurally valid but not release-ready: GAP test or Host
// execution evidence and unresolved licenses.
function marketplaceReviewBlockers({ ledger } = {}) {
  const review = ledger && ledger.marketplace_review;
  const blockers = [];
  for (const row of (review && Array.isArray(review.rows) ? review.rows : [])) {
    if (!row || !nonEmptyString(row.id)) continue;
    if (row.test_evidence && row.test_evidence.status === 'GAP') {
      blockers.push({ id: row.id, field: 'test_evidence', reason: row.test_evidence.reason });
    }
    for (const [index, group] of (Array.isArray(row.host_selection) ? row.host_selection : []).entries()) {
      if (group && group.execution_evidence && group.execution_evidence.status === 'GAP') {
        blockers.push({ id: row.id, field: `host_selection[${index}].execution_evidence`,
          reason: group.execution_evidence.reason });
      }
    }
    if (row.license && row.license.status === 'unresolved') {
      blockers.push({ id: row.id, field: 'license', reason: 'license status is unresolved' });
    }
  }
  return Object.freeze(blockers.map((item) => Object.freeze(item)));
}

module.exports = {
  AUTHORITY_RANK,
  VERSION,
  marketplaceReviewBlockers,
  validateMarketplaceReviewV2,
};
