'use strict';

// Canonical command-to-Skill ownership and evidence boundary. Root commands
// are Claude Host surfaces; this manifest deliberately remains separate from
// the distribution skill/module inventory so Host-only authority cannot be
// mistaken for portable Codex parity.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extract } = require('../ci/_lib/frontmatter');

const SCHEMA = 'dhpk.command-skill-disposition.v1';
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
  for (const key of Object.keys(evidence)) if (!fields.includes(key)) errors.push(prefix + '.' + key + ' is unsupported');
  for (const key of fields) {
    if (!EVIDENCE_STATES.includes(evidence[key])) errors.push(prefix + '.' + key + ' must be one of ' + EVIDENCE_STATES.join('/'));
  }
  if (evidence.structural !== 'PASS') errors.push(prefix + '.structural must be PASS for a checked-in disposition');
  if (evidence.consumer === 'PASS') errors.push(prefix + '.consumer PASS requires separate consumer evidence and cannot be fabricated');
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
  const allowedFields = new Set(['id', 'path', 'host_surface', 'public_name', 'argument_contract', 'authority', 'skill_owner', 'disposition', 'reason', 'evidence']);

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
  }

  for (const expected of canonical) if (!paths.has(expected)) errors.push('missing command disposition: ' + expected);
  for (const actual of paths) if (!canonicalSet.has(actual)) errors.push('unexpected command disposition: ' + actual);
  if (root && typeof manifest.source_revision === 'string' && manifest.source_revision !== commandSourceRevision(root, canonical)) {
    errors.push('command disposition source_revision does not match canonical command contents');
  }
  return { ok: errors.length === 0, errors, canonicalPaths: canonical };
}

module.exports = {
  AUTHORITIES,
  AUTHORITY_RANK,
  DISPOSITIONS,
  EVIDENCE_STATES,
  SCHEMA,
  canonicalCommandPaths,
  commandSourceRevision,
  stableStringify,
  validateCommandSkillDispositions,
};
