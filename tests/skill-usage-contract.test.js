'use strict';

// RED contracts for the inventory-owned Codex usage grammar.  These tests are
// deliberately kept at the pure usage-module seam: they do not parse SKILL.md
// prose, invoke a target skill, or reimplement the validator.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { resolveSkillIdentity } = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const USAGE_MODULE = path.join(ROOT, 'scripts', 'lib', 'skill-usage.js');
const CARD = path.join(ROOT, 'skills/flow-guide/scripts/usage-card.js');
const GENERATOR = path.join(ROOT, 'scripts/ci/gen-skill-usage.js');

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
    inputs: [{
      id: 'confirmed-spec-or-change-id',
      syntax: '<confirmed-spec-or-change-id>',
      value_kind: 'string',
      required: true,
      summary: 'Select the confirmed specification or change',
    }],
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
  const result = api.validateSkillUsage({ skill: skillValue, usage: usageValue });
  assert.ok(result && typeof result === 'object' && !Array.isArray(result), 'validator must return a result object');
  assert.deepStrictEqual(Object.keys(result).sort(), ['errors', 'ok'], 'validator result must use its closed public shape');
  assert.strictEqual(typeof result.ok, 'boolean', 'validator result must expose a boolean ok field');
  assert.ok(Array.isArray(result.errors), 'validator result must expose an errors array');
  assert.ok(Object.isFrozen(result), 'validator result must be immutable');
  assert.ok(Object.isFrozen(result.errors), 'validator diagnostics must be immutable');
  assert.strictEqual(result.ok, result.errors.length === 0, 'ok must agree with whether errors are present');
  return result;
}

function assertUsageError(skillValue, usageValue, pattern) {
  const result = validateUsageContract(skillValue, usageValue);
  assert.strictEqual(result.ok, false, 'invalid usage must return ok=false');
  assert.ok(result.errors.length > 0, 'expected usage validation to fail');
  assert.ok(
    result.errors.some((error) => pattern.test(error)),
    `expected a fault-specific diagnostic matching ${pattern}, got: ${result.errors.join('\n')}`,
  );
}

function usageCardHelp(args = []) {
  return spawnSync(process.execPath, [CARD, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function usageCardJsonHelp(name) {
  const result = usageCardHelp(['--json', name]);
  assert.strictEqual(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  return JSON.parse(result.stdout);
}

test('a valid Codex usage contract passes the pure validator', () => {
  const result = validateUsageContract();
  assert.deepStrictEqual(result.errors, []);
});

test('usage schema rejects unsupported procedural fields', () => {
  const candidate = usage({ completion: 'run every release gate before merging' });
  assertUsageError(skill(), candidate, /usage\.completion is unsupported or unknown/i);
});

test('usage schema rejects duplicate action and option identifiers', () => {
  const candidate = usage({
    actions: [usage().actions[0], { ...usage().actions[0], summary: 'same public action' }],
    options: [usage().options[0], { ...usage().options[0], summary: 'same public option' }],
  });
  const result = validateUsageContract(skill(), candidate);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.includes("flow-drive usage has duplicate action id 'apply'"), result.errors.join('\n'));
  assert.ok(result.errors.includes("flow-drive usage has duplicate option id 'plan'"), result.errors.join('\n'));
});

test('usage schema requires closed positional-input metadata and valid enum defaults', () => {
  const missing = usage({
    inputs: [{ id: 'input', syntax: '<input>', value_kind: 'string', required: true }],
  });
  assertUsageError(skill(), missing, /usage\.inputs\[0\]\.summary must be a string/);

  const invalid = usage({
    inputs: [{
      ...usage().inputs[0],
      value_kind: 'enum',
      enum_values: ['one'],
      default: 'two',
    }],
  });
  assertUsageError(skill(), invalid, /usage\.inputs\[0\]\.default must be one of enum_values/);
});

test('usage schema validates legacy compatibility markers without promoting them', () => {
  const candidate = usage({
    options: [
      usage().options[0],
      {
        id: 'legacy-plan',
        syntax: '--legacy-plan',
        value_kind: 'boolean',
        required: false,
        summary: 'Retired planning compatibility diagnostic',
        legacy: {
          replacement_id: 'plan',
          diagnostic_only: true,
          reason: 'Use the canonical plan option instead',
        },
      },
    ],
  });
  const result = validateUsageContract(skill(), candidate);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.errors, []);
  const normalized = usageApi().normalizeSkillUsage({ skill: skill(), usage: candidate });
  assert.strictEqual(normalized.options[1].legacy.diagnostic_only, true);
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
  const result = validateUsageContract(skill(), candidate);
  assert.strictEqual(result.ok, false);
  assert.ok(
    result.errors.includes("flow-drive usage.options[0].applies_to references unknown action 'missing-action'"),
    result.errors.join('\n'),
  );
  assert.ok(result.errors.includes('flow-drive usage.options[0].default must be one of enum_values'), result.errors.join('\n'));
});

test('usage schema rejects empty examples and examples with extra fields', () => {
  const empty = usage({ examples: [{ prompt: '', summary: 'missing command' }] });
  assertUsageError(skill(), empty, /usage\.examples\[0\]\.prompt must not be empty/);

  const extra = usage({ examples: [{
    ...usage().examples[0],
    notes: 'procedural detail belongs in SKILL.md',
  }] });
  assertUsageError(skill(), extra, /usage\.examples\[0\]\.notes is unsupported or unknown/);
});

test('usage schema rejects grammar that does not begin with the canonical public name', () => {
  const candidate = usage({
    syntax: 'flow-drive <confirmed-spec-or-change-id>',
    examples: [{ ...usage().examples[0], prompt: 'flow-drive change-id' }],
  });
  assertUsageError(skill(), candidate, /usage\.syntax must begin with \$flow-drive/);
});

test('usage schema rejects invocation-class drift before projection', () => {
  const candidate = usage({ invocation_class: 'implicit-eligible' });
  assertUsageError(skill(), candidate, /usage\.invocation_class 'implicit-eligible' mismatches canonical invocation 'explicit-only'/);
});

test('usage schema rejects child authority above the parent maximum', () => {
  const candidate = usage({
    actions: [{
      ...usage().actions[0],
      effect_authority: 'external-write',
    }],
  });
  assertUsageError(
    skill(),
    candidate,
    /usage\.actions\[0\]\.effect_authority 'external-write' exceeds parent maximum 'workspace-write'/,
  );
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
    'actions', 'display_name', 'effect_authority', 'examples', 'input_kind', 'inputs',
    'invocation_class', 'options', 'summary', 'syntax',
  ]);
  assert.ok(Object.isFrozen(normalized), 'normalized usage must be immutable');
  assert.ok(Object.isFrozen(normalized.actions), 'normalized actions must be immutable');
  assert.ok(Object.isFrozen(normalized.inputs), 'normalized inputs must be immutable');
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

test('$flow-guide help cards disclose inputs, enums, defaults, and retired markers', () => {
  const card = usageCardJsonHelp('flow-drive');
  assert.deepStrictEqual(card.inputs.map((input) => input.id), ['task-input']);
  const worker = card.options.find((option) => option.id === 'worker');
  assert.deepStrictEqual(worker.enum_values, ['claude', 'codex', 'agy', 'auto']);
  const crossProvider = card.options.find((option) => option.id === 'cross-provider');
  assert.strictEqual(crossProvider.default, false);
  const retired = card.options.find((option) => option.id === 'codex');
  assert.strictEqual(retired.legacy.diagnostic_only, true);
  assert.strictEqual(retired.legacy.replacement_id, 'worker');
});

test('$flow-guide help variants remain metadata-only and deterministic', () => {
  for (const name of ['flow-guide', 'flow-drive']) {
    const first = usageCardHelp([name]);
    const second = usageCardHelp([name]);
    assert.strictEqual(first.status, 0, (first.stdout || '') + (first.stderr || ''));
    assert.strictEqual(second.status, 0, (second.stdout || '') + (second.stderr || ''));
    assert.strictEqual(second.stdout, first.stdout, `${name} help output must be deterministic`);
    assert.match(first.stdout, new RegExp('\\$' + name));
    assert.doesNotMatch(first.stdout, /execute target|load target procedure|workspace-write granted/i);
  }
  assert.match(usageCardHelp(['flow-drive']).stdout, /--worker-target=<provider>\/\\?<model>|--worker-target=<provider>\/\\?\\<model>/i);
});

test('generated usage artifacts bind to one catalog revision and derive Argument Hints', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/flow-guide/references/codex-usage-catalog.json'), 'utf8'));
  assert.strictEqual(catalog.schema, 'dhpk.skill-usage-catalog.v1');
  assert.match(catalog.sourceInventoryRevision, /^sha256:[a-f0-9]{64}$/);

  const generatorCheck = spawnSync(process.execPath, [GENERATOR, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(generatorCheck.status, 0, (generatorCheck.stdout || '') + (generatorCheck.stderr || ''));
  assert.ok(generatorCheck.stdout.includes('catalog matches inventory'), generatorCheck.stdout);
  assert.ok(
    generatorCheck.stdout.includes('source ' + catalog.sourceInventoryRevision),
    `generator check must report the catalog revision ${catalog.sourceInventoryRevision}`,
  );

  const documentation = fs.readFileSync(path.join(ROOT, 'docs/codex-skill-usage.md'), 'utf8');
  assert.ok(
    documentation.includes('Source inventory revision: `' + catalog.sourceInventoryRevision + '`.'),
    'generated usage documentation must disclose the catalog source revision',
  );

  const flowDrive = inventory.skills.find((skill) => skill.id === 'flow-drive');
  assert.ok(flowDrive, 'the source inventory must contain flow-drive');
  const expectedArgumentHint = '<task-text|task-file|confirmed-spec-or-change-id> [--cross-provider] [--plan[=<model>:<effort>]] [--plan-mode=auto|bounded|discovery] [--worker=<worker>] [--worker-target=<provider>/<model>[:<effort>]] [--reasoner=<provider>[/<model>[:<effort>]]] [--architect|--no-architect]';
  assert.strictEqual(flowDrive.usage.syntax, '$flow-drive ' + expectedArgumentHint);
  const frontmatter = fs.readFileSync(path.join(ROOT, 'skills/flow-drive/SKILL.md'), 'utf8');
  assert.ok(
    frontmatter.split(/\r?\n/).includes("argument-hint: '" + expectedArgumentHint + "'"),
    'flow-drive frontmatter must project the independently specified public grammar',
  );

  const helpCard = usageCardJsonHelp('flow-drive');
  assert.deepStrictEqual(helpCard.catalogEvidence, {
    schema: 'dhpk.skill-usage-catalog.v1',
    state: 'PASS',
    sourceInventoryRevision: catalog.sourceInventoryRevision,
    path: 'references/codex-usage-catalog.json',
  });
});

test('generator check detects manual edits to generated usage documentation', () => {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-usage-projection-')));
  try {
    fs.mkdirSync(path.join(fixture, 'manifests'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'skills/flow-guide/references'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'docs'), { recursive: true });
    for (const relative of ['manifests/distribution-inventory.json', 'manifests/marketplace-selection.json', 'skills/flow-guide/references/codex-usage-catalog.json', 'docs/codex-skill-usage.md', 'docs/codex-skill-usage.zh-TW.md']) {
      const destination = path.join(fixture, relative);
      fs.copyFileSync(path.join(ROOT, relative), destination);
    }
    fs.appendFileSync(path.join(fixture, 'docs/codex-skill-usage.md'), 'manual edit\n');
    const result = spawnSync(process.execPath, [GENERATOR, '--check', '--root', fixture], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notStrictEqual(result.status, 0);
    assert.match((result.stdout || '') + (result.stderr || ''), /documentation|drift/i);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Codex metadata keeps the narrow OpenAI interface without custom argument schema', () => {
  for (const name of ['flow-guide', 'flow-drive']) {
    const metadata = fs.readFileSync(path.join(ROOT, 'skills', name, 'agents/openai.yaml'), 'utf8');
    assert.doesNotMatch(metadata, /argument_schema|input_schema|parameters:|arguments:/i);
    assert.match(metadata, new RegExp('default_prompt: "Use \\$' + name));
  }
});

test('renamed shipped skill preserves stable identity and routes its old public name', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  const skill = inventory.skills.find((entry) => entry.id === 'software-architecture');
  assert.ok(skill, 'the shipped inventory must retain the software-architecture stable ID');

  const oldNameResolution = resolveSkillIdentity({ inventory, identifier: 'dhpk-module-design' });
  const legacyNameResolution = resolveSkillIdentity({ inventory, identifier: 'software-architecture' });
  const runtimeIndex = usageApi().compileSkillUsageCatalog({ inventory }).runtimeIndex;
  const matchingTargets = Object.values(runtimeIndex.targets)
    .filter((target) => target.id === 'software-architecture')
    .map(({ id, publicName }) => ({ id, publicName }));

  assert.deepStrictEqual({
    canonical: {
      id: skill.id,
      capabilityId: skill.capability_id,
      name: skill.name,
      path: skill.path,
      surfaces: skill.surfaces,
      retainsLegacyName: skill.legacy_names.includes('software-architecture'),
      oldPublicNameIsNotLegacy: !skill.legacy_names.includes('dhpk-module-design'),
    },
    oldNameResolution: {
      state: oldNameResolution.state,
      stableId: oldNameResolution.stableId,
      publicName: oldNameResolution.publicName,
      oldName: oldNameResolution.oldName,
    },
    legacyNameResolution: {
      state: legacyNameResolution.state,
      stableId: legacyNameResolution.stableId,
      publicName: legacyNameResolution.publicName,
    },
    runtime: {
      targetsForStableId: matchingTargets,
      oldNameAlias: runtimeIndex.aliases['dhpk-module-design'] || null,
    },
  }, {
    canonical: {
      id: 'software-architecture',
      capabilityId: 'dhpk.skill.software-architecture',
      name: 'module-design',
      path: 'skills/module-design',
      surfaces: ['claude-core', 'cursor-sync'],
      retainsLegacyName: true,
      oldPublicNameIsNotLegacy: true,
    },
    oldNameResolution: {
      state: 'renamed',
      stableId: 'software-architecture',
      publicName: 'module-design',
      oldName: 'dhpk-module-design',
    },
    legacyNameResolution: {
      state: 'active',
      stableId: 'software-architecture',
      publicName: 'module-design',
    },
    runtime: {
      targetsForStableId: [{ id: 'software-architecture', publicName: 'module-design' }],
      oldNameAlias: { target: 'module-design', disposition: 'renamed' },
    },
  });
});

run('skill-usage-contract');
