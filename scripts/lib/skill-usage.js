'use strict';

// Inventory-owned public grammar for Codex-invokable skills.
//
// This module intentionally knows nothing about a skill's procedure. A usage
// record is limited to the information needed to discover and invoke a skill:
// identity, syntax, actions, options, authority, and examples. The canonical
// SKILL.md remains the owner of safety rules, workflow steps, references, and
// completion criteria.

const crypto = require('node:crypto');

const USAGE_SCHEMA = 'dhpk.skill-usage.v1';
const CATALOG_SCHEMA = 'dhpk.skill-usage-catalog.v1';
const CARD_SCHEMA = 'dhpk.skill-usage-card.v1';

const INPUT_KINDS = Object.freeze([
  'none',
  'free-text',
  'identifier',
  'path',
  'action-first',
  'mixed',
]);
const INVOCATION_CLASSES = Object.freeze(['implicit-eligible', 'explicit-only']);
const EFFECT_AUTHORITIES = Object.freeze([
  'read-only',
  'delegate',
  'workspace-write',
  'git-write',
  'external-write',
]);
const VALUE_KINDS = Object.freeze(['boolean', 'string', 'enum']);

const USAGE_KEYS = Object.freeze([
  'display_name',
  'summary',
  'syntax',
  'input_kind',
  'invocation_class',
  'effect_authority',
  'actions',
  'options',
  'examples',
]);
const ACTION_KEYS = Object.freeze([
  'id',
  'summary',
  'syntax',
  'input_kind',
  'effect_authority',
]);
const OPTION_KEYS = Object.freeze([
  'id',
  'syntax',
  'value_kind',
  'required',
  'summary',
  'default',
  'enum_values',
  'applies_to',
]);
const EXAMPLE_KEYS = Object.freeze(['prompt', 'summary']);

// Higher values carry more authority. A child action can never grant more
// authority than the usage record itself.
const AUTHORITY_RANK = Object.freeze({
  'read-only': 0,
  delegate: 1,
  'workspace-write': 2,
  'git-write': 3,
  'external-write': 4,
});

const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) {
    const output = {};
    for (const key of Object.keys(value)) output[key] = clone(value[key]);
    return output;
  }
  return value;
}

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableClone(value[key])]),
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function skillId(skill) {
  if (!isRecord(skill)) return '<unknown>';
  const id = skill.id || skill.name || skill.publicName;
  return typeof id === 'string' && id.trim() ? id.trim() : '<unknown>';
}

function publicName(skill) {
  if (!isRecord(skill)) return '';
  const name = skill.name || skill.publicName;
  return typeof name === 'string' ? name.trim() : '';
}

function canonicalInvocationClass(skill) {
  if (!isRecord(skill)) return null;
  const value = skill.invocation_class !== undefined
    ? skill.invocation_class
    : skill.invocationClass;
  return typeof value === 'string' ? value.trim() : value;
}

function hasCodexSurface(skill) {
  return isRecord(skill)
    && Array.isArray(skill.surfaces)
    && skill.surfaces.some((surface) => surface === 'codex-native' || surface === 'codex-sync')
    && skill.invokable !== false
    && skill.lifecycle !== 'deprecated';
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function addUnknownKeys(errors, value, allowed, prefix, owner) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push(owner + ' usage.' + prefix + key + ' is unsupported or unknown');
    }
  }
}

function requireString(errors, value, field, owner, limits) {
  const options = limits || {};
  if (typeof value !== 'string') {
    errors.push(owner + ' usage.' + field + ' must be a string');
    return false;
  }
  const min = options.min === undefined ? 1 : options.min;
  const max = options.max === undefined ? 512 : options.max;
  if (value.trim().length < min) errors.push(owner + ' usage.' + field + ' must not be empty');
  if (value.length > max) errors.push(owner + ' usage.' + field + ' exceeds ' + max + ' characters');
  if (/[\r\n]/.test(value) || value.includes(String.fromCharCode(0))) {
    errors.push(owner + ' usage.' + field + ' must be a single line');
  }
  return value.trim().length >= min
    && value.length <= max
    && !/[\r\n]/.test(value)
    && !value.includes(String.fromCharCode(0));
}

function requireEnum(errors, value, field, allowed, owner) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    errors.push(owner + ' usage.' + field + ' must be one of: ' + allowed.join(', '));
    return false;
  }
  return true;
}

function startsWithPublicCommand(value, name) {
  if (typeof value !== 'string' || !name) return false;
  const prefix = '$' + name;
  if (value === prefix) return true;
  return value.startsWith(prefix + ' ') || value.startsWith(prefix + '\t');
}

function validateAction(errors, action, index, name, parentAuthority, actionIds, owner) {
  const prefix = 'actions[' + index + ']';
  if (!isRecord(action)) {
    errors.push(owner + ' usage.' + prefix + ' must be an object');
    return;
  }
  addUnknownKeys(errors, action, ACTION_KEYS, prefix + '.', owner);

  const idValid = requireString(errors, action.id, prefix + '.id', owner, { max: 64 });
  if (idValid && !IDENTIFIER.test(action.id)) {
    errors.push(owner + ' usage.' + prefix + '.id must be a lower-case public identifier');
  }
  if (idValid && actionIds.has(action.id)) {
    errors.push(owner + " usage has duplicate action id '" + action.id + "'");
  } else if (idValid) {
    actionIds.add(action.id);
  }

  requireString(errors, action.summary, prefix + '.summary', owner, { max: 256 });
  const syntaxValid = requireString(errors, action.syntax, prefix + '.syntax', owner, { max: 512 });
  if (syntaxValid && !startsWithPublicCommand(action.syntax, name)) {
    errors.push(owner + ' usage.' + prefix + '.syntax must begin with $' + name);
  }
  requireEnum(errors, action.input_kind, 'input_kind', INPUT_KINDS, owner);
  const authorityValid = requireEnum(
    errors,
    action.effect_authority,
    'effect_authority',
    EFFECT_AUTHORITIES,
    owner,
  );
  if (authorityValid && AUTHORITY_RANK[action.effect_authority] > AUTHORITY_RANK[parentAuthority]) {
    errors.push(
      owner
      + " usage."
      + prefix
      + ".effect_authority '"
      + action.effect_authority
      + "' exceeds parent maximum '"
      + parentAuthority
      + "'",
    );
  }
}

function validateOption(errors, option, index, actionIds, optionIds, owner) {
  const prefix = 'options[' + index + ']';
  if (!isRecord(option)) {
    errors.push(owner + ' usage.' + prefix + ' must be an object');
    return;
  }
  addUnknownKeys(errors, option, OPTION_KEYS, prefix + '.', owner);

  const idValid = requireString(errors, option.id, prefix + '.id', owner, { max: 64 });
  if (idValid && !IDENTIFIER.test(option.id)) {
    errors.push(owner + ' usage.' + prefix + '.id must be a lower-case public identifier');
  }
  if (idValid && optionIds.has(option.id)) {
    errors.push(owner + " usage has duplicate option id '" + option.id + "'");
  } else if (idValid) {
    optionIds.add(option.id);
  }

  const syntaxValid = requireString(errors, option.syntax, prefix + '.syntax', owner, { max: 512 });
  if (syntaxValid && !/^--\S+$/.test(option.syntax)) {
    errors.push(owner + ' usage.' + prefix + '.syntax must be a single command-line option beginning with --');
  }
  const valueKindValid = requireEnum(errors, option.value_kind, 'value_kind', VALUE_KINDS, owner);
  if (typeof option.required !== 'boolean') {
    errors.push(owner + ' usage.' + prefix + '.required must be boolean');
  }
  requireString(errors, option.summary, prefix + '.summary', owner, { max: 256 });

  if (hasOwn(option, 'enum_values')) {
    if (!Array.isArray(option.enum_values) || option.enum_values.length === 0) {
      errors.push(owner + ' usage.' + prefix + '.enum_values must be a non-empty string array');
    } else {
      const values = new Set();
      option.enum_values.forEach((value, valueIndex) => {
        if (typeof value !== 'string' || value.trim() === '') {
          errors.push(owner + ' usage.' + prefix + '.enum_values[' + valueIndex + '] must be a non-empty string');
        } else if (values.has(value)) {
          errors.push(owner + " usage." + prefix + ".enum_values contains duplicate '" + value + "'");
        } else {
          values.add(value);
        }
      });
      if (valueKindValid && option.value_kind !== 'enum') {
        errors.push(owner + ' usage.' + prefix + '.enum_values is only valid for value_kind enum');
      }
    }
  } else if (valueKindValid && option.value_kind === 'enum') {
    errors.push(owner + ' usage.' + prefix + '.enum_values is required for value_kind enum');
  }

  if (hasOwn(option, 'default')) {
    if (option.value_kind === 'boolean' && typeof option.default !== 'boolean') {
      errors.push(owner + ' usage.' + prefix + '.default must be boolean for value_kind boolean');
    }
    if (option.value_kind === 'string' && typeof option.default !== 'string') {
      errors.push(owner + ' usage.' + prefix + '.default must be string for value_kind string');
    }
    if (option.value_kind === 'enum'
        && (!Array.isArray(option.enum_values) || !option.enum_values.includes(option.default))) {
      errors.push(owner + ' usage.' + prefix + '.default must be one of enum_values');
    }
  }

  if (hasOwn(option, 'applies_to')) {
    if (!Array.isArray(option.applies_to)) {
      errors.push(owner + ' usage.' + prefix + '.applies_to must be an array of action ids');
    } else {
      const seen = new Set();
      option.applies_to.forEach((actionId, actionIndex) => {
        if (typeof actionId !== 'string' || actionId.trim() === '') {
          errors.push(owner + ' usage.' + prefix + '.applies_to[' + actionIndex + '] must be a non-empty action id');
        } else if (seen.has(actionId)) {
          errors.push(owner + " usage." + prefix + ".applies_to contains duplicate action id '" + actionId + "'");
        } else {
          seen.add(actionId);
          if (!actionIds.has(actionId)) {
            errors.push(owner + " usage." + prefix + ".applies_to references unknown action '" + actionId + "'");
          }
        }
      });
    }
  }
}

function validateExample(errors, example, index, name, owner) {
  const prefix = 'examples[' + index + ']';
  if (!isRecord(example)) {
    errors.push(owner + ' usage.' + prefix + ' must be an object');
    return;
  }
  addUnknownKeys(errors, example, EXAMPLE_KEYS, prefix + '.', owner);
  const promptValid = requireString(errors, example.prompt, prefix + '.prompt', owner, { max: 512 });
  if (promptValid && !startsWithPublicCommand(example.prompt, name)) {
    errors.push(owner + ' usage.' + prefix + '.prompt must begin with $' + name);
  }
  requireString(errors, example.summary, prefix + '.summary', owner, { max: 256 });
}

// Validate one inventory-owned usage record without reading the target skill.
// The return value is structured so CI can report all contract errors in one
// pass. No normalization or source mutation occurs here.
function validateSkillUsage(input) {
  const values = input || {};
  const skill = values.skill;
  const usage = values.usage;
  const owner = skillId(skill);
  const errors = [];
  const name = publicName(skill);
  const canonicalClass = canonicalInvocationClass(skill);
  const codexSelected = hasCodexSurface(skill);

  if (!isRecord(skill)) errors.push(owner + ' skill entry must be an object');
  if (!name) {
    errors.push(owner + ' skill entry is missing a public name');
  } else if (!IDENTIFIER.test(name)) {
    errors.push(owner + " skill public name '" + name + "' is not a lower-case identifier");
  }

  if (usage === undefined || usage === null) {
    if (codexSelected) errors.push(owner + ' Codex-invokable skill is missing usage contract');
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }
  if (!isRecord(usage)) {
    errors.push(owner + ' usage must be an object');
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  addUnknownKeys(errors, usage, USAGE_KEYS, '', owner);
  requireString(errors, usage.display_name, 'display_name', owner, { max: 64 });
  requireString(errors, usage.summary, 'summary', owner, { min: 25, max: 64 });
  const syntaxValid = requireString(errors, usage.syntax, 'syntax', owner, { max: 512 });
  if (syntaxValid && !startsWithPublicCommand(usage.syntax, name)) {
    errors.push(owner + ' usage.syntax must begin with $' + name);
  }
  requireEnum(errors, usage.input_kind, 'input_kind', INPUT_KINDS, owner);
  const invocationValid = requireEnum(
    errors,
    usage.invocation_class,
    'invocation_class',
    INVOCATION_CLASSES,
    owner,
  );
  if (invocationValid && canonicalClass !== usage.invocation_class) {
    errors.push(
      owner
      + " usage.invocation_class '"
      + usage.invocation_class
      + "' mismatches canonical invocation '"
      + (canonicalClass || 'missing')
      + "'",
    );
  }
  const parentAuthorityValid = requireEnum(
    errors,
    usage.effect_authority,
    'effect_authority',
    EFFECT_AUTHORITIES,
    owner,
  );
  if (parentAuthorityValid
      && (usage.effect_authority === 'git-write' || usage.effect_authority === 'external-write')
      && usage.invocation_class !== 'explicit-only') {
    errors.push(owner + " usage.effect_authority '" + usage.effect_authority + "' requires explicit-only invocation");
  }

  if (!Array.isArray(usage.actions)) errors.push(owner + ' usage.actions must be an array');
  if (!Array.isArray(usage.options)) errors.push(owner + ' usage.options must be an array');
  if (!Array.isArray(usage.examples)) errors.push(owner + ' usage.examples must be an array');

  const actionIds = new Set();
  if (Array.isArray(usage.actions) && parentAuthorityValid) {
    usage.actions.forEach((action, index) => validateAction(
      errors,
      action,
      index,
      name,
      usage.effect_authority,
      actionIds,
      owner,
    ));
  }
  const optionIds = new Set();
  if (Array.isArray(usage.options)) {
    usage.options.forEach((option, index) => validateOption(
      errors,
      option,
      index,
      actionIds,
      optionIds,
      owner,
    ));
  }
  if (Array.isArray(usage.examples)) {
    usage.examples.forEach((example, index) => validateExample(errors, example, index, name, owner));
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function normalizeAction(action) {
  return {
    id: action.id,
    summary: action.summary,
    syntax: action.syntax,
    input_kind: action.input_kind,
    effect_authority: action.effect_authority,
  };
}

function normalizeOption(option) {
  const normalized = {
    id: option.id,
    syntax: option.syntax,
    value_kind: option.value_kind,
    required: option.required,
    summary: option.summary,
  };
  for (const field of ['default', 'enum_values', 'applies_to']) {
    if (!hasOwn(option, field)) continue;
    normalized[field] = clone(option[field]);
    if (field === 'applies_to') normalized[field].sort();
  }
  return normalized;
}

function normalizeExample(example) {
  return { prompt: example.prompt, summary: example.summary };
}

// Return a closed, deeply immutable usage object. Invalid records throw a
// descriptive error because normalization is a compiler boundary.
function normalizeSkillUsage(input) {
  const values = input || {};
  const result = validateSkillUsage(values);
  if (!result.ok) throw new Error(result.errors.join('; '));
  const usage = values.usage;
  const normalized = {
    display_name: usage.display_name,
    summary: usage.summary,
    syntax: usage.syntax,
    input_kind: usage.input_kind,
    invocation_class: usage.invocation_class,
    effect_authority: usage.effect_authority,
    actions: usage.actions.map(normalizeAction),
    options: usage.options.map(normalizeOption),
    examples: usage.examples.map(normalizeExample),
  };
  return freezeDeep(normalized);
}

function usageFingerprint(input) {
  return fingerprint(normalizeSkillUsage(input));
}

// Render only the public grammar and catalog evidence. Procedure, safety, and
// completion prose cannot enter this object because only normalized fields are
// copied.
function renderSkillUsageCard(input) {
  const values = input || {};
  const normalized = normalizeSkillUsage(values);
  const skill = values.skill || {};
  const card = {
    schema: CARD_SCHEMA,
    id: skillId(skill),
    name: publicName(skill),
    display_name: normalized.display_name,
    summary: normalized.summary,
    syntax: normalized.syntax,
    input_kind: normalized.input_kind,
    invocation_class: normalized.invocation_class,
    effect_authority: normalized.effect_authority,
    actions: normalized.actions,
    options: normalized.options,
    examples: normalized.examples,
  };
  if (values.catalogEvidence !== null && values.catalogEvidence !== undefined) {
    card.catalogEvidence = clone(values.catalogEvidence);
  }
  return freezeDeep(card);
}

function resolveInventoryRevision(inventory, requested) {
  if (requested !== undefined && requested !== null && String(requested).trim() !== '') {
    return requested;
  }
  if (isRecord(inventory)) {
    for (const field of ['sourceInventoryRevision', 'inventoryRevision', 'revision', 'version']) {
      if (inventory[field] !== undefined
          && inventory[field] !== null
          && String(inventory[field]).trim() !== '') {
        return inventory[field];
      }
    }
  }
  // Older inventories have no explicit revision. Binding to their complete
  // deterministic digest prevents a stale catalog from being mistaken for the
  // current source.
  return 'sha256:' + fingerprint(inventory);
}

function isCodexInvokableSkill(skill) {
  return hasCodexSurface(skill);
}

// Compile the Codex usage catalog from an inventory object. The compiler is
// pure: it neither reads SKILL.md nor writes generated files.
function compileSkillUsageCatalog(input) {
  const values = input || {};
  const inventory = values.inventory;
  if (!isRecord(inventory)) throw new Error('skill usage catalog requires an inventory object');
  if (!Array.isArray(inventory.skills)) {
    throw new Error('skill usage catalog inventory.skills must be an array');
  }

  const selected = inventory.skills.filter(isCodexInvokableSkill);
  const entries = [];
  const ids = new Set();
  const names = new Set();
  const errors = [];

  for (const skill of selected) {
    const id = skillId(skill);
    const name = publicName(skill);
    if (ids.has(id)) errors.push(id + ' duplicate Codex stable id');
    ids.add(id);
    if (names.has(name)) errors.push(id + " duplicate Codex public name '" + name + "'");
    names.add(name);

    const validation = validateSkillUsage({ skill, usage: skill.usage });
    if (!validation.ok) {
      errors.push(...validation.errors);
      continue;
    }
    let normalized;
    try {
      normalized = normalizeSkillUsage({ skill, usage: skill.usage });
    } catch (error) {
      errors.push(id + ' usage normalization failed: ' + error.message);
      continue;
    }
    entries.push({
      id,
      name,
      usage: normalized,
      usageFingerprint: fingerprint(normalized),
    });
  }

  if (errors.length > 0) throw new Error(errors.join('; '));
  entries.sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ));

  return freezeDeep({
    schema: CATALOG_SCHEMA,
    sourceInventoryRevision: resolveInventoryRevision(inventory, values.inventoryRevision),
    entries,
  });
}

function serializeSkillUsageCatalog(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n';
}

module.exports = {
  ACTION_KEYS,
  AUTHORITY_RANK,
  CARD_SCHEMA,
  CATALOG_SCHEMA,
  EFFECT_AUTHORITIES,
  INPUT_KINDS,
  INVOCATION_CLASSES,
  OPTION_KEYS,
  USAGE_KEYS,
  USAGE_SCHEMA,
  VALUE_KINDS,
  compileSkillUsageCatalog,
  fingerprint,
  hasCodexSurface,
  isCodexInvokableSkill,
  normalizeSkillUsage,
  renderSkillUsageCard,
  resolveInventoryRevision,
  serializeSkillUsageCatalog,
  stableStringify,
  usageFingerprint,
  validateSkillUsage,
};
