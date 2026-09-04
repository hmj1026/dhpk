'use strict';

// RED contracts for the inventory-owned Codex usage grammar.  These tests are
// deliberately kept at the pure usage-module seam: they do not parse SKILL.md
// prose, invoke a target skill, or reimplement the validator.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const USAGE_MODULE = path.join(ROOT, 'scripts', 'lib', 'skill-usage.js');

function usageApi() {
  assert.ok(
    fs.existsSync(USAGE_MODULE),
    'RED: scripts/lib/skill-usage.js is absent; the inventory-owned usage validator is not implemented',
  );
  return require(USAGE_MODULE);
}

function skill(overrides = {}) {
  return {
    id: 'flow-drive',
    name: 'flow-drive',
    invocation_class: 'explicit-only',
    surfaces: ['codex-native'],
    ...overrides,
  };
}

function usage(overrides = {}) {
  return {
    display_name: 'Flow Drive',
    summary: 'Implement one confirmed specification with bounded verification',
    syntax: '$flow-drive <confirmed-spec-or-change-id>',
    input_kind: 'identifier',
    invocation_class: 'explicit-only',
    effect_authority: 'workspace-write',
    actions: [{
      id: 'apply',
      summary: 'Apply the confirmed specification',
      syntax: '$flow-drive <confirmed-spec-or-change-id>',
      input_kind: 'identifier',
      effect_authority: 'workspace-write',
    }],
    options: [{
      id: 'plan',
      syntax: '--plan[=<model>:<effort>]',
      value_kind: 'string',
      required: false,
      summary: 'Request a planning pass before implementation',
      applies_to: ['apply'],
    }],
    examples: [{
      prompt: '$flow-drive consolidate-remaining-dhpk-skill-families',
      summary: 'Apply a confirmed OpenSpec change',
    }],
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateUsageContract(skillValue = skill(), usageValue = usage()) {
  const api = usageApi();
  assert.strictEqual(typeof api.validateSkillUsage, 'function',
    'skill-usage.js must expose validateSkillUsage at the public contract seam');
  try {
    const result = api.validateSkillUsage({ skill: skillValue, usage: usageValue });
    if (Array.isArray(result)) return { errors: result };
    if (result && Array.isArray(result.errors)) return result;
    if (result === true || (result && result.ok === true)) return { errors: [] };
    assert.fail(`validateSkillUsage returned no observable error contract: ${JSON.stringify(result)}`);
  } catch (error) {
    return { errors: [String(error && error.message ? error.message : error)] };
  }
}

function assertUsageError(skillValue, usageValue, pattern) {
  const result = validateUsageContract(skillValue, usageValue);
  assert.ok(result.errors.length > 0, 'expected usage validation to fail');
  assert.match(result.errors.join('\n'), pattern);
}

test('a valid Codex usage contract passes the pure validator', () => {
  const result = validateUsageContract();
  assert.deepStrictEqual(result.errors, []);
});

test('usage schema rejects unsupported procedural fields', () => {
  const candidate = usage({ completion: 'run every release gate before merging' });
  assertUsageError(skill(), candidate, /flow-drive|usage|unknown|unsupported|completion/i);
});

test('usage schema rejects duplicate action and option identifiers', () => {
  const candidate = usage({
    actions: [usage().actions[0], { ...usage().actions[0], summary: 'same public action' }],
    options: [usage().options[0], { ...usage().options[0], summary: 'same public option' }],
  });
  assertUsageError(skill(), candidate, /flow-drive|duplicate|action|option/i);
});

test('usage schema rejects unknown action references and invalid enum defaults', () => {
  const candidate = usage({
    options: [{
      ...usage().options[0],
      id: 'format',
      value_kind: 'enum',
      default: 'yaml',
      enum_values: ['json', 'text'],
      applies_to: ['missing-action'],
    }],
  });
  assertUsageError(skill(), candidate, /flow-drive|applies_to|action|enum|default/i);
});

test('usage schema rejects empty examples and examples with extra fields', () => {
  const empty = usage({ examples: [{ prompt: '', summary: 'missing command' }] });
  assertUsageError(skill(), empty, /flow-drive|example|empty|prompt/i);

  const extra = usage({ examples: [{
    ...usage().examples[0],
    notes: 'procedural detail belongs in SKILL.md',
  }] });
  assertUsageError(skill(), extra, /flow-drive|example|unknown|unsupported|notes/i);
});

test('usage schema rejects grammar that does not begin with the canonical public name', () => {
  const candidate = usage({
    syntax: 'flow-drive <confirmed-spec-or-change-id>',
    examples: [{ ...usage().examples[0], prompt: 'flow-drive change-id' }],
  });
  assertUsageError(skill(), candidate, /flow-drive|syntax|\$/i);
});

test('usage schema rejects invocation-class drift before projection', () => {
  const candidate = usage({ invocation_class: 'implicit-eligible' });
  assertUsageError(skill(), candidate, /flow-drive|invocation|explicit-only|mismatch/i);
});

test('usage schema rejects child authority above the parent maximum', () => {
  const candidate = usage({
    actions: [{
      ...usage().actions[0],
      effect_authority: 'external-write',
    }],
  });
  assertUsageError(skill(), candidate, /flow-drive|effect|authority|maximum|external-write/i);
});

test('normalization returns a deterministic closed usage object', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.normalizeSkillUsage, 'function',
    'skill-usage.js must expose normalizeSkillUsage at the public contract seam');
  const candidate = usage({
    actions: [usage().actions[0]],
    options: [usage().options[0]],
  });
  const normalized = api.normalizeSkillUsage({ skill: skill(), usage: candidate });
  assert.ok(normalized && typeof normalized === 'object', 'normalized usage must be an object');
  assert.deepStrictEqual(Object.keys(normalized).sort(), [
    'actions', 'display_name', 'effect_authority', 'examples', 'input_kind',
    'invocation_class', 'options', 'summary', 'syntax',
  ]);
  assert.ok(Object.isFrozen(normalized), 'normalized usage must be immutable');
  assert.ok(Object.isFrozen(normalized.actions), 'normalized actions must be immutable');
  assert.ok(Object.isFrozen(normalized.options), 'normalized options must be immutable');
});

test('normalization does not mutate the caller-owned usage object', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.normalizeSkillUsage, 'function');
  const candidate = usage({
    actions: [usage().actions[0]],
    options: [usage().options[0]],
  });
  const before = clone(candidate);
  api.normalizeSkillUsage({ skill: skill(), usage: candidate });
  assert.deepStrictEqual(candidate, before);
});

test('usage renderer discloses grammar and authority without procedure prose', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.renderSkillUsageCard, 'function',
    'skill-usage.js must expose renderSkillUsageCard at the help-card seam');
  const card = api.renderSkillUsageCard({
    skill: skill(),
    usage: usage(),
    catalogEvidence: { schema: 'dhpk.skill-usage-catalog.v1', state: 'PASS' },
  });
  assert.ok(card && typeof card === 'object', 'usage card must be a structured value');
  assert.strictEqual(card.name || card.publicName || card.id, 'flow-drive');
  assert.match(card.syntax || card.usage && card.usage.syntax, /^\$flow-drive\b/);
  assert.strictEqual(
    card.invocation_class || card.invocationClass || card.usage && (card.usage.invocation_class || card.usage.invocationClass),
    'explicit-only',
  );
  assert.ok(JSON.stringify(card).includes('plan'), 'usage card must expose the option grammar');
  assert.doesNotMatch(JSON.stringify(card), /load references and execute|completion procedure/i);
});

run('skill-usage-contract');
