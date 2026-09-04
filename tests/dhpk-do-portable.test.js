'use strict';

// Regression suite for the portable routing owner after the /dhpk:do and
// flow-drive routing cutover. Flow Guide now owns the advisory route parser;
// Flow Drive remains the explicit implementation entry and is mode-free.
// These tests lock the public v3 result boundary while retaining route-table,
// matcher, authority, availability, and fail-closed coverage from the former
// portable entry suite.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GUIDE = path.join(ROOT, 'skills', 'flow-guide');
const DRIVE = path.join(ROOT, 'skills', 'flow-drive');
const PARSER = path.join(GUIDE, 'scripts', 'route-result.js');
const MATCHER = path.join(GUIDE, 'scripts', 'pre-route.sh');
const TABLE = path.join(GUIDE, 'references', 'route-table.json');
const RESULT_SCHEMA = path.join(GUIDE, 'references', 'route-result.schema.json');
const GUIDE_MD = path.join(GUIDE, 'SKILL.md');
const GUIDE_YAML = path.join(GUIDE, 'agents', 'openai.yaml');
const DRIVE_MD = path.join(DRIVE, 'SKILL.md');
const DO_CMD = path.join(ROOT, 'commands', 'do.md');

const HOSTS = Object.freeze(['claude', 'cursor', 'codex']);
const AVAILABILITY = Object.freeze(['available', 'unavailable', 'not-configured']);
const DISPOSITIONS = Object.freeze([
  'advice', 'explicit-required', 'ready', 'blocked', 'unavailable',
]);
const TOP_LEVEL_KEYS = Object.freeze([
  'schema', 'action', 'host', 'cleanedQuery', 'options', 'target',
  'availability', 'diagnostics', 'disposition', 'requiredEvidence', 'nextAction',
]);
const TARGET_KEYS = Object.freeze(['id', 'publicName', 'invocationClass', 'command']);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Current route-table order is independently locked. The confirmed-spec
// implementation route is intentionally more specific than the unattended
// session route and therefore comes first.
const EXPECTED_TYPED_ROUTES = Object.freeze([
  { label: 'confirmed specification implementation', kind: 'skill', id: 'flow-drive' },
  { label: 'unattended OpenSpec goal session', kind: 'skill', id: 'dhpk-opsx-apply-goal' },
  { label: 'adaptive dev workflow (python build)', kind: 'skill', id: 'flow-guide' },
  { label: 'adaptive dev workflow (rust build)', kind: 'skill', id: 'flow-guide' },
  { label: 'adaptive dev workflow (bug)', kind: 'skill', id: 'flow-guide' },
  { label: 'manual code review', kind: 'command', id: 'review-pending' },
  { label: 'security review', kind: 'skill', id: 'change-verdict' },
  { label: 'code exploration', kind: 'skill', id: 'code-trace' },
  { label: 'project audit', kind: 'skill', id: 'dhpk-project-audit' },
  { label: 'deploy list', kind: 'skill', id: 'dhpk-deploy-list' },
  { label: 'refactor / simplify', kind: 'command', id: 'simplify' },
  { label: 'mine behavioral specs (→ spec-miner)', kind: 'command', id: 'spec-mine' },
  { label: 'tech spec authoring', kind: 'skill', id: 'flow-guide' },
  { label: 'pre-commit checks', kind: 'command', id: 'precommit' },
  { label: 'create PR', kind: 'command', id: 'create-pr' },
  { label: 'create release', kind: 'skill', id: 'dhpk-release-creator' },
  { label: 'smart commit', kind: 'command', id: 'smart-commit' },
  { label: 'feasibility study', kind: 'skill', id: 'flow-guide' },
  { label: 'risk assessment', kind: 'skill', id: 'change-verdict' },
  {
    label: 'Playwright E2E journey (→ e2e-runner; UNAVAILABLE if the Playwright agent capability is unavailable)',
    kind: 'agent',
    id: 'e2e-runner',
  },
  {
    label: 'Unit/integration testing (→ dhpk-tdd-workflow; UNAVAILABLE if TDD capability is unavailable)',
    kind: 'skill',
    id: 'dhpk-tdd-workflow',
  },
  { label: 'adaptive dev workflow (feature)', kind: 'skill', id: 'flow-guide' },
  { label: 'verification loop', kind: 'command', id: 'verify' },
]);

function mustExist(file, phase) {
  assert.ok(fs.existsSync(file), `${path.relative(ROOT, file)} must exist (${phase})`);
}

function read(file) {
  mustExist(file, 'live contract');
  return fs.readFileSync(file, 'utf8');
}

function loadParser() {
  mustExist(PARSER, 'route parser');
  return require(PARSER);
}

function parseV3(argv, host = 'claude') {
  const parser = loadParser();
  assert.strictEqual(typeof parser.parseInvocationContext, 'function',
    'flow-guide route parser must export parseInvocationContext');
  return parser.parseInvocationContext(argv, { host });
}

function routeV3(input) {
  const parser = loadParser();
  assert.strictEqual(typeof parser.createRouteResult, 'function',
    'flow-guide route parser must export createRouteResult');
  return parser.createRouteResult(input);
}

function assertV3Shape(result) {
  assert.deepStrictEqual(Object.keys(result), [...TOP_LEVEL_KEYS]);
  assert.strictEqual(result.schema, 'dhpk.route-result.v3');
  assert.strictEqual(result.action, 'route');
  assert.ok(HOSTS.includes(result.host), `host must be one of ${HOSTS.join('|')}`);
  assert.strictEqual(typeof result.cleanedQuery, 'string');
  assert.deepStrictEqual(Object.keys(result.options), ['go']);
  assert.strictEqual(typeof result.options.go, 'boolean');
  assert.ok(result.target === null || typeof result.target === 'object');
  if (result.target) assert.deepStrictEqual(Object.keys(result.target), [...TARGET_KEYS]);
  assert.ok(AVAILABILITY.includes(result.availability));
  assert.ok(DISPOSITIONS.includes(result.disposition));
  for (const key of ['diagnostics', 'requiredEvidence']) {
    assert.ok(Array.isArray(result[key]));
    assert.ok(result[key].every((item) => typeof item === 'string'));
  }
  assert.strictEqual(typeof result.nextAction, 'string');
}

function assertAdditionalPropertiesFalse(node, where) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertAdditionalPropertiesFalse(item, `${where}[${index}]`));
    return;
  }
  if (node.type === 'object' || node.properties || node.required) {
    assert.strictEqual(node.additionalProperties, false, `${where} must close object fields`);
  }
  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) {
      assertAdditionalPropertiesFalse(child, `${where}.properties.${key}`);
    }
  }
  for (const key of ['$defs', 'definitions', 'items', 'allOf', 'oneOf', 'anyOf', 'not', 'if', 'then', 'else']) {
    if (node[key] && typeof node[key] === 'object') {
      assertAdditionalPropertiesFalse(node[key], `${where}.${key}`);
    }
  }
}

function schemaMentions(schema, token) {
  return JSON.stringify(schema).includes(token);
}

// ---------------------------------------------------------------------------
// 2.1 package + schemas
// ---------------------------------------------------------------------------

test('[2.1] flow-guide is the implicit advisory owner with five intuitive actions', () => {
  const body = read(GUIDE_MD);
  assert.match(body, /^name:\s*flow-guide/m);
  const hint = body.match(/^argument-hint:\s*['"]?([^'"\n]+)['"]?\s*$/m);
  assert.ok(hint, 'flow-guide must publish an argument hint');
  for (const action of ['help', 'route', 'rules', 'next', 'close']) {
    assert.match(hint[1], new RegExp(`\\b${action}\\b`));
  }
  for (const removed of ['classify', 'policy', 'checklist']) {
    assert.doesNotMatch(hint[1], new RegExp(`\\b${removed}\\b`));
  }
  assert.match(body, /dhpk-invocation-class:\s*implicit-eligible/);
  assert.doesNotMatch(body, /disable-model-invocation:\s*true/);
});

test('[2.1] flow-guide usage metadata names the route owner and keeps it read-only', () => {
  const yaml = read(GUIDE_YAML);
  assert.match(yaml, /display_name:\s*["']?Flow Guide/);
  assert.match(yaml, /default_prompt:[\s\S]*\$flow-guide\s+<help\|route\|rules\|next\|close>/);
  assert.doesNotMatch(yaml, /allow_implicit_invocation:\s*false/);
});

test('[2.1] route-result schema is v3 with a closed shape and only a go option', () => {
  const schema = JSON.parse(read(RESULT_SCHEMA));
  assert.match([schema.$id, schema.title, schema.schema].filter(Boolean).join(' '), /dhpk\.route-result\.v3/);
  assertAdditionalPropertiesFalse(schema, 'route-result.schema.json');
  for (const field of TOP_LEVEL_KEYS) {
    assert.ok(schemaMentions(schema, `"${field}"`), `schema must declare ${field}`);
  }
  assert.ok(schemaMentions(schema, '"go"'), 'schema options must declare go');
  for (const removed of ['backendSelection', 'routeOnly', 'codexPeer', 'architect', 'openSpec', 'executeExplicit', 'plan', 'worker', 'reasoner']) {
    assert.ok(!schemaMentions(schema, `"${removed}"`), `v3 schema must not expose ${removed}`);
  }
  for (const host of HOSTS) assert.ok(schemaMentions(schema, host));
  for (const disposition of DISPOSITIONS) assert.ok(schemaMentions(schema, disposition));
  for (const state of AVAILABILITY) assert.ok(schemaMentions(schema, state));
});

test('[2.1] route table remains typed and preserves the ordered 23-rule intent map', () => {
  const table = JSON.parse(read(TABLE));
  assert.strictEqual(table.schema, 'dhpk.route-table.v2');
  assert.strictEqual(table.rules.length, EXPECTED_TYPED_ROUTES.length);
  table.rules.forEach((rule, index) => {
    const expected = EXPECTED_TYPED_ROUTES[index];
    assert.strictEqual(typeof rule.pattern, 'string');
    assert.ok(rule.pattern.length > 0, `rule[${index}] pattern must be non-empty`);
    assert.strictEqual(rule.label, expected.label, `rule[${index}] label`);
    assert.deepStrictEqual(rule.target && { label: rule.label, kind: rule.target.kind, id: rule.target.id }, {
      label: expected.label,
      kind: expected.kind,
      id: expected.id,
    });
    assert.ok(KEBAB.test(rule.target.id), `rule[${index}] target id must be kebab-case`);
    if (rule.target.kind !== 'command') assert.strictEqual(rule.target.portable_skill_id, undefined);
    assert.strictEqual('skill' in rule, false, `rule[${index}] must use typed target as SSOT`);
  });
});

// ---------------------------------------------------------------------------
// 2.2 parser matrix + freeze
// ---------------------------------------------------------------------------

test('[2.2] flow-guide parser and matcher files exist at the owning path', () => {
  mustExist(PARSER, '2.2');
  mustExist(MATCHER, '2.2');
  assert.strictEqual(fs.existsSync(path.join(DRIVE, 'scripts', 'route-result.js')), false);
  assert.strictEqual(fs.existsSync(path.join(DRIVE, 'references', 'route-table.json')), false);
});

test('[2.2] retired routing controls are stripped and fail closed', () => {
  const controls = [
    '--route-only', '--execute-explicit', '--openspec', '--opsx', '--mode=route',
    '--plan=sol:medium', '--worker=codex', '--reasoner=codex:terra:high', '--architect', '--no-architect',
  ];
  for (const control of controls) {
    const result = parseV3([control, 'task']);
    assertV3Shape(result);
    assert.deepStrictEqual(result.options, { go: false });
    assert.strictEqual(result.cleanedQuery, 'task');
    assert.strictEqual(result.disposition, 'blocked', control);
    assert.ok(result.diagnostics.some((item) => item.includes(control.split('=')[0])), control);
  }
});

test('[2.2] retired --codex is diagnostic-only and cannot select a peer', () => {
  const result = parseV3(['--codex', 'review', 'this', 'diff']);
  assertV3Shape(result);
  assert.deepStrictEqual(result.options, { go: false });
  assert.strictEqual(result.cleanedQuery, 'review this diff');
  assert.ok(result.diagnostics.some((item) => /--codex.*retired/i.test(item)));
  assert.strictEqual(result.disposition, 'blocked');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'backendSelection'), false);
});

test('[2.2] standalone --go is the only routing option and malformed forms fail closed', () => {
  const advice = parseV3(['trace', 'this', 'module']);
  assert.deepStrictEqual(advice.options, { go: false });
  assert.strictEqual(advice.disposition, 'advice');
  const malformed = parseV3(['--go=true', 'trace', 'this', 'module']);
  assert.deepStrictEqual(malformed.options, { go: false });
  assert.strictEqual(malformed.cleanedQuery, 'trace this module');
  assert.strictEqual(malformed.disposition, 'blocked');
  assert.ok(malformed.diagnostics.some((item) => /--go=true.*unsupported/i.test(item)));
});

test('[2.2] unknown tokens remain in cleanedQuery in original order', () => {
  const parsed = parseV3([
    'please', '--fast-worker=codex', 'trace', '--feature', 'the', 'login',
  ]);
  assert.deepStrictEqual(parsed.options, { go: false });
  assert.strictEqual(parsed.cleanedQuery, 'please --fast-worker=codex trace --feature the login');
});

test('[2.2] v3 result is recursively frozen and supports claude|cursor|codex hosts', () => {
  const result = routeV3({ host: 'cursor', argv: ['trace', 'this', 'module'] });
  assertV3Shape(result);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.options));
  assert.throws(() => { result.disposition = 'ready'; }, TypeError);
  assert.throws(() => { result.options.go = true; }, TypeError);
});

test('[2.2] --codex on host=codex remains blocked without a replacement route', () => {
  const result = routeV3({ host: 'codex', argv: ['--codex', 'review', 'this', 'diff'] });
  assertV3Shape(result);
  assert.deepStrictEqual(result.options, { go: false });
  assert.strictEqual(result.disposition, 'blocked');
  assert.ok(result.diagnostics.some((item) => /--codex.*retired/i.test(item)));
});

test('[2.2] empty input has no target and returns read-only advice', () => {
  const result = routeV3({ host: 'claude', argv: [] });
  assertV3Shape(result);
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.availability, 'not-configured');
  assert.strictEqual(result.disposition, 'advice');
});

test('[2.2] skill-local matcher uses its typed route table and preserves the label', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-guide-route-'));
  const table = path.join(tmp, 'route-table.json');
  fs.writeFileSync(table, JSON.stringify({
    schema: 'dhpk.route-table.v2',
    rules: [{
      pattern: 'fix\\s+the\\s+bug',
      label: 'bugfix',
      target: { kind: 'skill', id: 'flow-guide' },
    }],
  }));
  try {
    const result = spawnSync('bash', [MATCHER, 'please fix the bug now'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DHPK_ROUTE_TABLE: table },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(result.stdout.trim().split('\t'), ['MATCH', 'flow-guide', 'bugfix']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('[2.2] v3 target commands use public invocation syntax', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--go', 'trace', 'how', 'this', 'code', 'works'],
    observed: { published: ['code-trace'], discovered: ['code-trace'] },
  });
  assertV3Shape(result);
  assert.strictEqual(result.options.go, true);
  assert.strictEqual(result.target.id, 'code-trace');
  assert.strictEqual(result.target.invocationClass, 'implicit-eligible');
  assert.match(result.target.command, /^\$code-trace\b/);
  assert.strictEqual(result.disposition, 'ready');
});

test('[2.2] invalid result fields fail closed before dispatch', () => {
  const parser = loadParser();
  const result = routeV3({ host: 'claude', argv: ['trace', 'code'] });
  assert.doesNotThrow(() => parser.validateRouteResult(result));
  assert.throws(() => parser.validateRouteResult({ ...result, backendSelection: null }), /unknown|additional|backendSelection/i);
  assert.throws(() => parser.validateRouteResult({ ...result, schema: 'dhpk.route-result.v2' }), /schema|v3/i);
  assert.throws(() => parser.validateRouteResult({ ...result, options: { go: false, worker: null } }), /options|unknown|additional/i);
});

// ---------------------------------------------------------------------------
// 3.1 ownership and authority
// ---------------------------------------------------------------------------

test('[3.1] /dhpk:do is retired; flow-guide routes and flow-drive implements', () => {
  assert.strictEqual(fs.existsSync(DO_CMD), false, '/dhpk:do must remain retired');
  const guide = read(GUIDE_MD);
  const drive = read(DRIVE_MD);
  assert.match(guide, /name:\s*flow-guide/);
  assert.match(guide, /`route`[\s\S]*`rules`[\s\S]*`next`[\s\S]*`close`/);
  assert.match(drive, /name:\s*flow-drive/);
  assert.match(drive, /confirmed specification|confirmed work|confirmed-spec-or-change-id/i);
  assert.match(drive, /flow-guide[\s\S]{0,220}route|route[\s\S]{0,220}flow-guide/i);
  assert.doesNotMatch(drive, /^##\s+Modes\s*$/im);
  assert.doesNotMatch(guide, /dhpk-(bug-fix|feature-dev)/);
});

test('[3.1] flow-drive remains explicit-only and does not expose routing flags', () => {
  const drive = read(DRIVE_MD);
  assert.match(drive, /disable-model-invocation:\s*true/);
  assert.match(drive, /dhpk-invocation-class:\s*explicit-only/);
  assert.match(drive, /\$flow-drive\s+<confirmed-spec-or-change-id>/);
  for (const flag of ['--mode', '--route-only', '--execute-explicit', '--openspec', '--opsx']) {
    assert.doesNotMatch(drive, new RegExp(`\\${flag}\\b`), `flow-drive must not publish ${flag}`);
  }
});

test('[3.2] --go reports explicit-required for an available explicit-only target', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--go', 'create', 'a', 'PR'],
    observed: {
      invocationClasses: { 'create-pr': 'explicit-only' },
      discovered: ['create-pr'],
      published: ['create-pr'],
    },
  });
  assertV3Shape(result);
  assert.strictEqual(result.target.id, 'create-pr');
  assert.strictEqual(result.target.invocationClass, 'explicit-only');
  assert.strictEqual(result.availability, 'available');
  assert.strictEqual(result.disposition, 'explicit-required');
  assert.match(result.nextAction, /direct human invocation|explicit-only/i);
});

test('[3.2] retired flags cannot authorize an explicit-only target', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--route-only', '--execute-explicit', 'create', 'a', 'PR'],
    observed: {
      invocationClasses: { 'create-pr': 'explicit-only' },
      discovered: ['create-pr'],
      published: ['create-pr'],
    },
  });
  assertV3Shape(result);
  assert.strictEqual(result.options.go, false);
  assert.strictEqual(result.target.id, 'create-pr');
  assert.strictEqual(result.disposition, 'blocked');
  assert.ok(result.diagnostics.some((item) => /retired|unsupported/i.test(item)));
  assert.notStrictEqual(result.disposition, 'ready');
});

test('[3.2] retired OpenSpec compound controls stop before any dispatch', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--openspec', '--execute-explicit', 'add', 'feature', 'X'],
  });
  assertV3Shape(result);
  assert.strictEqual(result.disposition, 'blocked');
  assert.strictEqual(result.options.go, false);
  assert.ok(result.diagnostics.some((item) => /--openspec/i.test(item)));
  assert.ok(result.diagnostics.some((item) => /--execute-explicit/i.test(item)));
  assert.doesNotMatch(JSON.stringify(result), /openSpecSequence|backendSelection/);
});

// ---------------------------------------------------------------------------
// 3.3 availability and bounded handoffs
// ---------------------------------------------------------------------------

test('[3.3] unavailable target remains typed and keeps the route target', () => {
  const result = routeV3({
    host: 'codex',
    argv: ['--go', 'run', 'a', 'security', 'audit'],
    observed: { published: ['change-verdict'], discovered: [] },
  });
  assertV3Shape(result);
  assert.strictEqual(result.target.id, 'change-verdict');
  assert.strictEqual(result.availability, 'unavailable');
  assert.strictEqual(result.disposition, 'unavailable');
  assert.ok(result.requiredEvidence.length > 0);
});

test('[3.3] an available implicit target receives one bounded ready handoff', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--go', 'fix', 'the', 'checkout', 'bug'],
    observed: { published: ['flow-guide'], discovered: ['flow-guide'] },
  });
  assertV3Shape(result);
  assert.strictEqual(result.target.id, 'flow-guide');
  assert.strictEqual(result.target.invocationClass, 'implicit-eligible');
  assert.strictEqual(result.availability, 'available');
  assert.strictEqual(result.disposition, 'ready');
  assert.match(result.nextAction, /bounded handoff/i);
});

test('[3.3] missing observation remains not-configured and never guesses availability', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--go', 'fix', 'the', 'checkout', 'bug'],
  });
  assertV3Shape(result);
  assert.strictEqual(result.target.id, 'flow-guide');
  assert.strictEqual(result.availability, 'not-configured');
  assert.strictEqual(result.disposition, 'ready');
  assert.match(result.requiredEvidence.join(' '), /not configured|verify/i);
});

test('[3.3] legacy worker and receipt inputs cannot change the v3 result shape', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--go', 'trace', 'this', 'code'],
    observed: { published: ['code-trace'], discovered: ['code-trace'] },
    executables: { claude: true, codex: false, agy: false },
    cliReceipt: { schema: 'dhpk.cli.receipt.v1', status: 'FAILED', reference: 'receipt://cli/1' },
    parentContinuation: false,
    warmReview: { verdict: 'SHIP' },
  });
  assertV3Shape(result);
  assert.strictEqual(result.disposition, 'ready');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'backendSelection'), false);
  assert.doesNotMatch(JSON.stringify(result), /cli\.receipt|FAILED|SHIP|executables/);
});

test('[3.3] route-only advice never claims implementation completion', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['trace', 'this', 'code'],
    cliReceipt: { schema: 'dhpk.cli.receipt.v1', status: 'SUCCEEDED', reference: 'receipt://cli/ok' },
    obligationsComplete: true,
  });
  assertV3Shape(result);
  assert.strictEqual(result.options.go, false);
  assert.strictEqual(result.disposition, 'advice');
  assert.doesNotMatch(JSON.stringify(result), /SUCCEEDED|PASS|obligationsComplete/);
});

test('[3.3] malformed availability objects fail closed under v3 validation', () => {
  const parser = loadParser();
  const result = routeV3({ host: 'claude', argv: [] });
  assert.doesNotThrow(() => parser.validateRouteResult(result));
  assert.throws(() => parser.validateRouteResult({
    ...result,
    availability: { state: 'not-configured', reasonCode: null, evidence: [] },
  }), /availability|invalid/i);
});

// ---------------------------------------------------------------------------
// 4.1 bounded routing invariants
// ---------------------------------------------------------------------------

test('[4.1] unsupported caller context cannot grant write authority', () => {
  const result = routeV3({
    host: 'claude',
    argv: ['--go', 'implement', 'the', 'confirmed', 'OpenSpec', 'change'],
    writeCapable: true,
    parentContinuation: true,
    warmReview: { verdict: 'SHIP' },
    observed: {
      invocationClasses: { 'flow-drive': 'explicit-only' },
      discovered: ['flow-drive'],
      published: ['flow-drive'],
    },
  });
  assertV3Shape(result);
  assert.strictEqual(result.target.id, 'flow-drive');
  assert.strictEqual(result.disposition, 'explicit-required');
  assert.match(result.nextAction, /direct human invocation|explicit-only/i);
});

test('[4.1] --go disposition is deterministic across implicit, explicit, and unavailable routes', () => {
  const implicit = routeV3({
    host: 'claude', argv: ['--go', 'trace', 'this', 'code'],
    observed: { published: ['code-trace'], discovered: ['code-trace'] },
  });
  const explicit = routeV3({
    host: 'claude', argv: ['--go', 'create', 'a', 'PR'],
    observed: {
      invocationClasses: { 'create-pr': 'explicit-only' },
      discovered: ['create-pr'], published: ['create-pr'],
    },
  });
  const unavailable = routeV3({
    host: 'claude', argv: ['--go', 'trace', 'this', 'code'],
    observed: { published: ['code-trace'], discovered: [] },
  });
  assert.strictEqual(implicit.disposition, 'ready');
  assert.strictEqual(explicit.disposition, 'explicit-required');
  assert.strictEqual(unavailable.disposition, 'unavailable');
});

// ---------------------------------------------------------------------------
// 5.1 distribution membership
// ---------------------------------------------------------------------------

test('[5.1] minimal required_core includes flow-drive without a hard-coded family count', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  assert.ok(inventory.profile_policy.required_core_ids.includes('flow-drive'));

  const inventorySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'distribution-inventory.js'), 'utf8');
  const selectionSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'capability-bundle-selection.js'), 'utf8');
  assert.doesNotMatch(inventorySrc, /length !== 9|exactly nine/);
  assert.doesNotMatch(selectionSrc, /length !== 9|exactly nine/);

  const installerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), 'utf8');
  assert.doesNotMatch(installerSrc, /!= 9|length !== 9|exactly nine|exactly the nine/i);
});

run('dhpk-do-portable');
