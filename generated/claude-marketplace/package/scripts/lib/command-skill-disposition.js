'use strict';

// Canonical command-to-Skill ownership and evidence boundary. Root commands
// are Claude Host surfaces; this manifest deliberately remains separate from
// the distribution skill/module inventory so Host-only authority cannot be
// mistaken for portable Codex parity.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extract } = require('../ci/_lib/frontmatter');

const SCHEMA = 'dhpk.command-skill-disposition.v2';
const DISPOSITIONS = Object.freeze([
  'existing-skill-owner',
  'thin-front-door',
  'new-reusable-skill',
  'host-only',
  'retired',
]);
const AUTHORITIES = Object.freeze([
  'read-only',
  'delegate',
  'workspace-write',
  'git-write',
  'external-write',
]);
const AUTHORITY_RANK = Object.freeze({
  'read-only': 0,
  delegate: 1,
  'workspace-write': 2,
  'git-write': 3,
  'external-write': 4,
});
const EVIDENCE_STATES = Object.freeze(['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'BLOCKED']);
const OUTCOMES = Object.freeze(['retain', 'merge', 'internalize', 'retire', 'remove']);
const REMOVED_COMMAND_IDS = Object.freeze([
  'check-skill', 'create-dev', 'do', 'codex-review', 'codex-review-fast',
  'codex-review-branch', 'codex-review-doc', 'codex-security',
  'codex-test-review', 'review-spec',
]);
const FRONT_DOOR_PARITY_IDS = Object.freeze(new Set(['flow-guide', 'flow-drive']));
const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function commandSourceRevision(root, paths) {
  const hash = crypto.createHash('sha256');
  for (const relative of [...paths].sort()) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  return 'sha256:' + hash.digest('hex');
}

function canonicalCommandPaths(root) {
  const dir = path.join(root, 'commands');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md')
    .map((entry) => 'commands/' + entry.name)
    .sort();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unquoteScalar(value) {
  return typeof value === 'string' ? value.replace(/^(['"])(.*)\1$/, '$2') : value;
}

function validateEvidence(errors, evidence, prefix) {
  if (!isObject(evidence)) {
    errors.push(prefix + ' must be an object');
    return;
  }
  const fields = ['structural', 'host_smoke', 'consumer'];
  const allowedFields = new Set([...fields, 'source']);
  for (const key of Object.keys(evidence)) if (!allowedFields.has(key)) errors.push(prefix + '.' + key + ' is unsupported');
  if (evidence.source !== undefined && (typeof evidence.source !== 'string' || evidence.source.trim() === '')) {
    errors.push(prefix + '.source must be a non-empty evidence path');
  }
  for (const key of fields) {
    if (!EVIDENCE_STATES.includes(evidence[key])) errors.push(prefix + '.' + key + ' must be one of ' + EVIDENCE_STATES.join('/'));
  }
  if (evidence.structural !== 'PASS') errors.push(prefix + '.structural must be PASS for a checked-in disposition');
  if (evidence.consumer === 'PASS') errors.push(prefix + '.consumer PASS requires separate consumer evidence and cannot be fabricated');
}

function validateCallers(errors, callers, prefix, root) {
  if (!Array.isArray(callers) || callers.length === 0) {
    errors.push(prefix + ' must be a non-empty array of repository caller paths');
    return;
  }
  const seen = new Set();
  for (const caller of callers) {
    if (typeof caller !== 'string' || caller.trim() === '' || caller.includes('\\')
      || path.posix.isAbsolute(caller) || caller.includes('..') || caller.includes('*')) {
      errors.push(prefix + ' contains an unsafe caller path: ' + caller);
      continue;
    }
    if (seen.has(caller)) errors.push(prefix + ' contains duplicate caller: ' + caller);
    seen.add(caller);
    if (root && !fs.existsSync(path.join(root, caller))) errors.push(prefix + ' caller does not exist: ' + caller);
  }
}

function removedCommandSourceRevision(rows) {
  const hash = crypto.createHash('sha256');
  hash.update(stableStringify((Array.isArray(rows) ? rows : []).slice().sort((left, right) => (
    String(left && left.id || '').localeCompare(String(right && right.id || ''))
  ))));
  return 'sha256:' + hash.digest('hex');
}

function validateRemovedCommands({ manifest, root, activeIds, skillIds, activePaths, activeNames, errors }) {
  const rows = manifest.removed_commands;
  if (!Array.isArray(rows)) {
    errors.push('command disposition manifest requires a removed_commands array');
    return;
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  const allowed = new Set([
    'id', 'path', 'public_name', 'outcome', 'disposition', 'successor',
    'reason', 'callers', 'evidence',
  ]);
  for (const [index, row] of rows.entries()) {
    const prefix = 'removed_commands[' + index + ']';
    if (!isObject(row)) {
      errors.push(prefix + ' must be an object');
      continue;
    }
    for (const key of Object.keys(row)) if (!allowed.has(key)) errors.push(prefix + '.' + key + ' is unsupported');
    if (typeof row.id !== 'string' || !IDENTIFIER.test(row.id)) errors.push(prefix + '.id must be a lower-case identifier');
    if (typeof row.id === 'string') {
      if (seenIds.has(row.id)) errors.push('duplicate removed command id: ' + row.id);
      seenIds.add(row.id);
      if (!REMOVED_COMMAND_IDS.includes(row.id)) errors.push('unexpected removed command: ' + row.id);
      if (activeIds.has(row.id)) errors.push('removed command ' + row.id + ' is also active');
    }
    if (typeof row.path !== 'string' || row.path !== 'commands/' + row.id + '.md') {
      errors.push(prefix + '.path must identify the removed canonical path for ' + (row.id || '<unknown>'));
    }
    if (typeof row.path === 'string') {
      if (seenPaths.has(row.path)) errors.push('duplicate removed command path: ' + row.path);
      seenPaths.add(row.path);
      if (activePaths.has(row.path)) errors.push('removed command path is active: ' + row.path);
      if (root && fs.existsSync(path.join(root, row.path))) errors.push('removed command path is present: ' + row.path);
    }
    if (typeof row.public_name !== 'string' || row.public_name !== '/dhpk:' + row.id) {
      errors.push(prefix + '.public_name must be /dhpk:' + (row.id || '<unknown>'));
    }
    if (row.outcome !== 'remove') errors.push(prefix + '.outcome must be remove');
    if (row.disposition !== 'removed') errors.push(prefix + '.disposition must be removed');
    if (!isObject(row.successor) || typeof row.successor.id !== 'string' || typeof row.successor.kind !== 'string') {
      errors.push(prefix + '.successor must declare kind and id');
    } else if (row.successor.kind === 'skill' && skillIds.size > 0 && !skillIds.has(row.successor.id)) {
      errors.push(prefix + '.successor must reference an active Skill: ' + row.successor.id);
    }
    if (typeof row.reason !== 'string' || row.reason.trim() === '') errors.push(prefix + '.reason is required');
    validateCallers(errors, row.callers, prefix + '.callers', root);
    validateEvidence(errors, row.evidence, prefix + '.evidence');
    if (activeNames.has(row.public_name)) errors.push('removed command public name is active: ' + row.public_name);
  }
  for (const id of REMOVED_COMMAND_IDS) if (!seenIds.has(id)) errors.push('missing removed command: ' + id);
  if (rows.length !== REMOVED_COMMAND_IDS.length) errors.push('removed_commands must contain exactly ' + REMOVED_COMMAND_IDS.length + ' rows');
  if (typeof manifest.removed_source_revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(manifest.removed_source_revision)) {
    errors.push('removed_source_revision must be a SHA-256 digest of the canonical removed ledger');
  } else if (manifest.removed_source_revision !== removedCommandSourceRevision(rows)) {
    errors.push('command disposition removed_source_revision does not match the canonical removed ledger');
  }
}

function validateCommandSkillDispositions({ manifest, root, skillIds = [], skills = [] } = {}) {
  const errors = [];
  if (!isObject(manifest)) return { ok: false, errors: ['command disposition manifest must be an object'] };
  if (manifest.schema !== SCHEMA) errors.push('command disposition manifest schema must be ' + SCHEMA);
  if (!Array.isArray(manifest.commands)) {
    errors.push('command disposition manifest commands must be an array');
    return { ok: false, errors };
  }

  const canonical = root ? canonicalCommandPaths(root) : manifest.commands.map((row) => row.path).sort();
  const canonicalSet = new Set(canonical);
  const ids = new Set();
  const paths = new Set();
  const names = new Set();
  const owners = new Map();
  const ownerRecords = new Map((Array.isArray(skills) ? skills : []).filter((skill) => isObject(skill) && typeof skill.id === 'string').map((skill) => [skill.id, skill]));
  const allowedFields = new Set(['id', 'path', 'host_surface', 'public_name', 'argument_contract', 'authority', 'skill_owner', 'outcome', 'disposition', 'reason', 'callers', 'evidence']);

  for (const [index, row] of manifest.commands.entries()) {
    const prefix = 'commands[' + index + ']';
    if (!isObject(row)) {
      errors.push(prefix + ' must be an object');
      continue;
    }
    for (const key of Object.keys(row)) if (!allowedFields.has(key)) errors.push(prefix + '.' + key + ' is unsupported');
    for (const field of ['id', 'path', 'host_surface', 'public_name', 'authority', 'disposition']) {
      if (typeof row[field] !== 'string' || row[field].trim() === '') errors.push(prefix + '.' + field + ' must be a non-empty string');
    }
    if (typeof row.argument_contract !== 'string') errors.push(prefix + '.argument_contract must be a string');
    if (row.outcome !== 'retain') errors.push(prefix + '.outcome must be retain for an active physical command');
    if (typeof row.id === 'string') {
      if (!IDENTIFIER.test(row.id) || ids.has(row.id)) errors.push(prefix + '.id must be unique lower-case identifier');
      ids.add(row.id);
    }
    if (typeof row.path === 'string') {
      if (!canonicalSet.has(row.path)) errors.push(prefix + '.path must identify one canonical root command: ' + row.path);
      if (paths.has(row.path)) errors.push(prefix + '.path is duplicated: ' + row.path);
      paths.add(row.path);
      const expectedId = path.basename(row.path, '.md');
      if (row.id !== expectedId) errors.push(prefix + '.id must match command filename ' + expectedId);
    }
    if (row.host_surface !== 'claude-command') errors.push(prefix + '.host_surface must be claude-command');
    const expectedPublic = typeof row.id === 'string' ? '/dhpk:' + row.id : null;
    if (expectedPublic && row.public_name !== expectedPublic) errors.push(prefix + '.public_name must be ' + expectedPublic);
    if (typeof row.public_name === 'string') {
      if (names.has(row.public_name)) errors.push(prefix + '.public_name is duplicated: ' + row.public_name);
      names.add(row.public_name);
    }
    if (!AUTHORITIES.includes(row.authority)) errors.push(prefix + '.authority must be one of ' + AUTHORITIES.join('/'));
    if (!DISPOSITIONS.includes(row.disposition)) errors.push(prefix + '.disposition must be one of ' + DISPOSITIONS.join('/'));
    if (row.disposition === 'retired') errors.push(prefix + '.disposition retired is not valid for the active physical command set; use removed_commands');
    if (row.skill_owner !== null && row.skill_owner !== undefined && typeof row.skill_owner !== 'string') errors.push(prefix + '.skill_owner must be a stable Skill id or null');
    if (typeof row.skill_owner === 'string') {
      if (skillIds.length > 0 && !skillIds.includes(row.skill_owner)) errors.push(prefix + '.skill_owner does not reference an inventory Skill: ' + row.skill_owner);
      if (owners.has(row.skill_owner)) errors.push(prefix + '.skill_owner conflicts with ' + owners.get(row.skill_owner));
      else owners.set(row.skill_owner, row.id);
      const owner = ownerRecords.get(row.skill_owner);
      const ownerAuthority = owner && owner.usage && owner.usage.effect_authority;
      if (typeof ownerAuthority === 'string'
          && AUTHORITY_RANK[row.authority] !== undefined
          && AUTHORITY_RANK[ownerAuthority] !== undefined
          && AUTHORITY_RANK[row.authority] > AUTHORITY_RANK[ownerAuthority]) {
        errors.push(prefix + '.authority exceeds Skill owner ' + row.skill_owner + ' maximum ' + ownerAuthority);
      }
      if (row.disposition === 'thin-front-door'
          && typeof ownerAuthority === 'string'
          && row.authority !== ownerAuthority) {
        errors.push(prefix + '.authority must match Skill owner ' + row.skill_owner + ' authority ' + ownerAuthority);
      }
    }
    if (root && row.disposition === 'thin-front-door' && FRONT_DOOR_PARITY_IDS.has(row.id) && typeof row.path === 'string') {
      const commandPath = path.join(root, row.path);
      if (!fs.existsSync(commandPath)) {
        errors.push(prefix + '.path does not exist: ' + row.path);
      } else {
        const source = fs.readFileSync(commandPath, 'utf8');
        const frontmatter = extract(source);
        const argumentHint = unquoteScalar(frontmatter.values['argument-hint'] || '');
        if (argumentHint !== row.argument_contract) {
          errors.push(prefix + '.argument_contract must match argument-hint in ' + row.path);
        }
        const ownerReference = 'canonical `$' + row.skill_owner + '` Skill';
        if (typeof row.skill_owner === 'string' && !source.includes(ownerReference)) {
          errors.push(prefix + '.path must forward to ' + ownerReference);
        }
      }
    }
    if (['host-only', 'retired'].includes(row.disposition) && (typeof row.reason !== 'string' || row.reason.trim() === '')) {
      errors.push(prefix + '.reason is required for ' + row.disposition);
    }
    if (['thin-front-door', 'existing-skill-owner', 'new-reusable-skill'].includes(row.disposition)
        && (typeof row.skill_owner !== 'string' || row.skill_owner.trim() === '')) {
      errors.push(prefix + '.skill_owner is required for ' + row.disposition);
    }
    validateEvidence(errors, row.evidence, prefix + '.evidence');
    validateCallers(errors, row.callers, prefix + '.callers', root);
  }

  for (const expected of canonical) if (!paths.has(expected)) errors.push('missing command disposition: ' + expected);
  for (const actual of paths) if (!canonicalSet.has(actual)) errors.push('unexpected command disposition: ' + actual);
  if (root && typeof manifest.source_revision === 'string' && manifest.source_revision !== commandSourceRevision(root, canonical)) {
    errors.push('command disposition source_revision does not match canonical command contents');
  }
  validateRemovedCommands({
    manifest,
    root,
    activeIds: ids,
    skillIds: new Set(Array.isArray(skillIds) ? skillIds : []),
    activePaths: paths,
    activeNames: names,
    errors,
  });
  return { ok: errors.length === 0, errors, canonicalPaths: canonical };
}

module.exports = {
  AUTHORITIES,
  AUTHORITY_RANK,
  DISPOSITIONS,
  EVIDENCE_STATES,
  OUTCOMES,
  REMOVED_COMMAND_IDS,
  SCHEMA,
  canonicalCommandPaths,
  commandSourceRevision,
  removedCommandSourceRevision,
  stableStringify,
  validateCommandSkillDispositions,
};
