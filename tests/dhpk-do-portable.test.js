'use strict';

// Public-contract suite for the flow-drive portable routing skill.
// (tasks 1.3–1.4). Expected values come from design.md Decision 2 and
// specs/dhpk-do-portable-entry/spec.md — not from scripts/lib/route-result.js.
//
// Do not treat the v1 live parser as v2. This file loads only
// skills/flow-drive/scripts/route-result.js.
//
// Wave map (which assertions turn GREEN when):
//   2.1  package files, explicit-only SKILL.md, openai.yaml, v2 JSON schemas
//   2.2  skill-local parser/matcher, typed routes, freeze, parser matrix
//   3.1  thin /dhpk:do adapter (also in validate-commands.test.js)
//   3.2  execute-explicit one-use + OpenSpec compound preflight
//   3.3  host availability, selector fallback, CLI receipt fold-in
//   4.1  warm-review SHIP / one FIX-THEN-SHIP / one RECONSULT
//   5.1  inventory stable id `do`; no exact-nine count literal

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'skills', 'flow-drive');
const PARSER = path.join(SKILL, 'scripts', 'route-result.js');
const MATCHER = path.join(SKILL, 'scripts', 'pre-route.sh');
const TABLE = path.join(SKILL, 'references', 'route-table.json');
const RESULT_SCHEMA = path.join(SKILL, 'references', 'route-result.schema.json');
const SKILL_MD = path.join(SKILL, 'SKILL.md');
const OPENAI_YAML = path.join(SKILL, 'agents', 'openai.yaml');
const DO_CMD = path.join(ROOT, 'commands', 'do.md');

const HOSTS = Object.freeze(['claude', 'cursor', 'codex']);
const DISPOSITIONS = Object.freeze([
  'route-only', 'explicit-required', 'ready', 'blocked', 'unavailable',
]);
const AVAIL_STATES = Object.freeze(['not-checked', 'available', 'unavailable']);
const REASON_CODES = Object.freeze([
  'NOT_PUBLISHED', 'NOT_DISCOVERED', 'POLICY_RESTRICTED',
  'HOST_UNSUPPORTED', 'DEPENDENCY_UNAVAILABLE',
]);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODEL_TOKEN = /^[A-Za-z0-9._-]+$/;

// Current v1 table labels/kinds/ids, locked independently so a v2 cutover must
// preserve order, label, and intent. kind is the published callable kind, not
// a filesystem guess at test time.
const EXPECTED_TYPED_ROUTES = Object.freeze([
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

function mustExist(file, wave) {
  assert.ok(fs.existsSync(file), `${path.relative(ROOT, file)} must exist (${wave})`);
}

function read(file) {
  mustExist(file, '2.1');
  return fs.readFileSync(file, 'utf8');
}

function loadParser() {
  mustExist(PARSER, '2.2');
  return require(PARSER);
}

function parseV2(argv, host = 'claude') {
  const mod = loadParser();
  assert.strictEqual(typeof mod.parseInvocationContext, 'function',
    'skills/flow-drive/scripts/route-result.js must export parseInvocationContext');
  const parsed = mod.parseInvocationContext(argv, { host });
  assert.ok(parsed && parsed.options, 'v2 parser must return nested options (not v1 flat keys)');
  return parsed;
}

function routeV2(input) {
  const mod = loadParser();
  assert.strictEqual(typeof mod.createRouteResult, 'function',
    'skills/flow-drive/scripts/route-result.js must export createRouteResult');
  return mod.createRouteResult(input);
}

function assertAdditionalPropertiesFalse(node, where) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertAdditionalPropertiesFalse(item, `${where}[${i}]`));
    return;
  }
  const isObjectSchema = node.type === 'object' || node.properties || node.required;
  if (isObjectSchema) {
    assert.strictEqual(
      node.additionalProperties,
      false,
      `${where} must set additionalProperties: false`,
    );
  }
  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) {
      assertAdditionalPropertiesFalse(child, `${where}.properties.${key}`);
    }
  }
  for (const key of ['$defs', 'definitions', 'patternProperties', 'items', 'additionalProperties',
    'allOf', 'oneOf', 'anyOf', 'not', 'if', 'then', 'else', 'prefixItems']) {
    if (node[key] && typeof node[key] === 'object' && node[key] !== false) {
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

test('[2.1] canonical package is explicit-only with disable-model-invocation', () => {
  const body = read(SKILL_MD);
  assert.match(body, /^---[\s\S]*disable-model-invocation:\s*true/m);
  assert.match(body, /^---[\s\S]*metadata:\s*\n\s+dhpk-invocation-class:\s*explicit-only/m);
  assert.match(body, /^---[\s\S]*\nname:\s*['"]?flow-drive['"]?/m);
});

test('[2.1] openai.yaml forbids implicit invocation and names $flow-drive', () => {
  const yaml = read(OPENAI_YAML);
  assert.match(yaml, /allow_implicit_invocation:\s*false/);
  assert.match(yaml, /\$flow-drive/);
  assert.match(yaml, /default_prompt:/);
});

test('[2.1] route-result schema is dhpk.route-result.v2 with additionalProperties false', () => {
  const schema = JSON.parse(read(RESULT_SCHEMA));
  const identity = [schema.$id, schema.title, schema.schema, JSON.stringify(schema.properties && schema.properties.schema)]
    .filter(Boolean).join(' ');
  assert.match(identity, /dhpk\.route-result\.v2/);
  assertAdditionalPropertiesFalse(schema, 'route-result.schema.json');
  for (const field of [
    'schema', 'host', 'cleanedQuery', 'options', 'target',
    'availability', 'backendSelection', 'diagnostics', 'disposition',
  ]) {
    assert.ok(schemaMentions(schema, `"${field}"`), `schema must declare field ${field}`);
  }
  for (const field of [
    'routeOnly', 'codexPeer', 'architect', 'openSpec',
    'executeExplicit', 'plan', 'worker', 'reasoner',
  ]) {
    assert.ok(schemaMentions(schema, `"${field}"`), `schema options must declare ${field}`);
  }
  for (const host of HOSTS) assert.ok(schemaMentions(schema, host), `schema must allow host ${host}`);
  for (const disposition of DISPOSITIONS) {
    assert.ok(schemaMentions(schema, disposition), `schema must allow disposition ${disposition}`);
  }
  for (const state of AVAIL_STATES) {
    assert.ok(schemaMentions(schema, state), `schema must allow availability.state ${state}`);
  }
  for (const code of REASON_CODES) {
    assert.ok(schemaMentions(schema, code), `schema must allow reasonCode ${code}`);
  }
});

test('[2.1] route table is dhpk.route-table.v2 with typed kebab targets', () => {
  const table = JSON.parse(read(TABLE));
  assert.strictEqual(table.schema, 'dhpk.route-table.v2');
  assert.ok(Array.isArray(table.rules) && table.rules.length === EXPECTED_TYPED_ROUTES.length,
    `v2 table must keep ${EXPECTED_TYPED_ROUTES.length} ordered rules`);
  table.rules.forEach((rule, index) => {
    const expected = EXPECTED_TYPED_ROUTES[index];
    assert.strictEqual(typeof rule.pattern, 'string');
    assert.ok(rule.pattern.length > 0, `rule[${index}] pattern must be non-empty`);
    assert.strictEqual(rule.label, expected.label, `rule[${index}] label`);
    assert.ok(rule.target && typeof rule.target === 'object', `rule[${index}] needs target`);
    assert.strictEqual(rule.target.kind, expected.kind, `rule[${index}] kind`);
    assert.strictEqual(rule.target.id, expected.id, `rule[${index}] id`);
    assert.ok(KEBAB.test(rule.target.id), `rule[${index}] id must be kebab-case`);
    if (rule.target.kind === 'command') {
      if (rule.target.portable_skill_id != null) {
        assert.ok(KEBAB.test(rule.target.portable_skill_id),
          `rule[${index}] portable_skill_id must be kebab-case`);
      }
    } else {
      assert.strictEqual(
        rule.target.portable_skill_id,
        undefined,
        `rule[${index}] portable_skill_id is permitted only when kind=command`,
      );
    }
    assert.ok(!('skill' in rule), `rule[${index}] must not keep the v1 skill field as SSOT`);
  });
});

// ---------------------------------------------------------------------------
// 2.2 parser matrix + freeze (skill-local module; fail because the file is missing)
// ---------------------------------------------------------------------------

test('[2.2] skill-local parser and matcher files exist (no RED stubs)', () => {
  mustExist(PARSER, '2.2');
  mustExist(MATCHER, '2.2');
});

test('[2.2] --route-only wins over every other mode and is stripped', () => {
  const parsed = parseV2([
    '--execute-explicit', '--codex', '--plan=sol:high', '--route-only',
    '--worker=codex', 'fix', 'the', 'bug',
  ]);
  assert.strictEqual(parsed.options.routeOnly, true);
  assert.strictEqual(parsed.options.executeExplicit, true);
  assert.strictEqual(parsed.cleanedQuery, 'fix the bug');
  assert.ok(!parsed.cleanedQuery.includes('--route-only'));
});

test('[2.2] retired --codex is stripped without enabling a peer', () => {
  const parsed = parseV2(['--codex', '--codex', 'review', 'this', 'diff']);
  assert.strictEqual(parsed.options.codexPeer, false);
  assert.strictEqual(parsed.cleanedQuery, 'review this diff');
  assert.strictEqual(parsed.target, null);
  assert.strictEqual(parsed.disposition, 'blocked');
  assert.ok(parsed.diagnostics.some((d) => d.code === 'DEPRECATED_CODEX_FLAG'));
});

test('[2.2] last --architect / --no-architect occurrence wins', () => {
  assert.strictEqual(parseV2(['--architect', '--no-architect', 'task']).options.architect, false);
  assert.strictEqual(parseV2(['--no-architect', '--architect', 'task']).options.architect, true);
});

test('[2.2] --openspec and --opsx are aliases, idempotent, and stripped', () => {
  const parsed = parseV2(['--opsx', '--openspec', 'add', 'feature', 'X']);
  assert.strictEqual(parsed.options.openSpec, true);
  assert.strictEqual(parsed.cleanedQuery, 'add feature X');
});

test('[2.2] --execute-explicit is stripped and does not stay in cleanedQuery', () => {
  const parsed = parseV2(['--execute-explicit', 'create', 'a', 'PR']);
  assert.strictEqual(parsed.options.executeExplicit, true);
  assert.strictEqual(parsed.cleanedQuery, 'create a PR');
});

test('[2.2] last --plan[=model[:effort]] wins; extra segments warn EXTRA_SEGMENTS', () => {
  const parsed = parseV2(['--plan', '--plan=sol:low', 'implement', 'it']);
  assert.deepStrictEqual(parsed.options.plan, { enabled: true, model: 'sol', effort: 'low' });
  const extra = routeV2({ host: 'claude', argv: ['--plan=sol:medium:left', 'implement', 'it'] });
  assert.deepStrictEqual(extra.options.plan, { enabled: true, model: 'sol', effort: 'medium' });
  assert.ok(extra.diagnostics.some((d) => d.code === 'EXTRA_SEGMENTS'),
    'extra plan segments must warn EXTRA_SEGMENTS');
});

test('[2.2] last --worker= wins with requested/value/valid; empty or unknown is invalid', () => {
  const ok = parseV2(['--worker=auto', '--worker=codex', 'implement', 'it']);
  assert.deepStrictEqual(ok.options.worker, { requested: 'codex', value: 'codex', valid: true });
  const empty = parseV2(['--worker=', 'implement', 'it']);
  assert.strictEqual(empty.options.worker.valid, false);
  assert.strictEqual(empty.options.worker.value, null);
  const bad = parseV2(['--worker=fast-worker', 'implement', 'it']);
  assert.strictEqual(bad.options.worker.valid, false);
  assert.strictEqual(bad.cleanedQuery, 'implement it');
});

test('[2.2] last --reasoner=backend[:model[:effort]] wins; extra segments warn', () => {
  const parsed = parseV2(['--reasoner=claude', '--reasoner=codex:terra:high', 'implement', 'it']);
  assert.deepStrictEqual(parsed.options.reasoner, {
    enabled: true, backend: 'codex', model: 'terra', effort: 'high', valid: true,
  });
  const extra = routeV2({ host: 'claude', argv: ['--reasoner=codex:terra:high:left', 'implement', 'it'] });
  assert.ok(extra.diagnostics.some((d) => d.code === 'EXTRA_SEGMENTS'));
  const empty = parseV2(['--reasoner=', 'implement', 'it']);
  assert.strictEqual(empty.options.reasoner.valid, false);
});

test('[2.2] unknown tokens including --fast-worker stay in cleanedQuery in original order', () => {
  const parsed = parseV2([
    'please', '--fast-worker=codex', 'implement', '--feature', 'the', 'login',
  ]);
  assert.strictEqual(parsed.options.routeOnly, false);
  assert.strictEqual(parsed.options.worker, null);
  assert.strictEqual(parsed.cleanedQuery, 'please --fast-worker=codex implement --feature the login');
});

test('[2.2] recognized flags may occur anywhere and remaining tokens join with one space', () => {
  const parsed = parseV2(['implement', '--codex', 'the', '--openspec', 'login', 'feature']);
  assert.strictEqual(parsed.options.codexPeer, false);
  assert.strictEqual(parsed.options.openSpec, true);
  assert.strictEqual(parsed.cleanedQuery, 'implement the login feature');
  assert.strictEqual(parsed.target, null);
  assert.strictEqual(parsed.disposition, 'blocked');
});

test('[2.2] v2 result is recursively frozen and uses host claude|cursor|codex', () => {
  const result = routeV2({ host: 'cursor', argv: ['--route-only', 'fix', 'the', 'bug'] });
  assert.strictEqual(result.schema, 'dhpk.route-result.v2');
  assert.ok(HOSTS.includes(result.host), `host must be one of ${HOSTS.join('|')}`);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.options));
  assert.throws(() => { result.disposition = 'ready'; }, TypeError);
  assert.throws(() => { result.options.routeOnly = false; }, TypeError);
});

test('[2.2] --codex on host=codex remains blocked and does not set codexPeer', () => {
  const result = routeV2({ host: 'codex', argv: ['--codex', 'review', 'this', 'diff'] });
  assert.strictEqual(result.options.codexPeer, false);
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.disposition, 'blocked');
  assert.ok(result.diagnostics.some((d) => d.code === 'DEPRECATED_CODEX_FLAG'));
});

test('[2.2] NO_QUERY leaves target null', () => {
  const result = routeV2({ host: 'claude', argv: [] });
  assert.strictEqual(result.target, null);
});

test('[2.2] skill-local matcher uses a v2 override table and preserves the label', () => {
  mustExist(MATCHER, '2.2');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-v2-route-'));
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
    const res = spawnSync('bash', [MATCHER, 'please fix the bug now'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, DHPK_ROUTE_TABLE: table },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /bugfix/);
    assert.match(res.stdout, /flow-guide/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('[2.2] non-null plan/worker model tokens match the documented charset', () => {
  const parsed = parseV2(['--plan=gpt-5.6-sol:medium', '--reasoner=codex:gpt-5.6-sol:high', 'task']);
  assert.ok(MODEL_TOKEN.test(parsed.options.plan.model));
  assert.ok(MODEL_TOKEN.test(parsed.options.reasoner.model));
});

test('[2.2] invalid result fields fail closed before dispatch', () => {
  const mod = loadParser();
  assert.strictEqual(typeof mod.validateRouteResult, 'function',
    'public contract validation must be exported as validateRouteResult');
  assert.throws(() => mod.validateRouteResult({ schema: 'nope' }), /schema|invalid|enum/i);
  assert.throws(
    () => mod.validateRouteResult({
      schema: 'dhpk.route-result.v2',
      extra: true,
    }),
    /additional|unknown|invalid/i,
  );
});

// ---------------------------------------------------------------------------
// 3.1 thin adapter (duplicate of validate-commands so this suite stands alone)
// ---------------------------------------------------------------------------

test('[3.1] retired /dhpk:do alias is absent and flow-drive owns route/implement modes', () => {
  assert.strictEqual(fs.existsSync(DO_CMD), false, '/dhpk:do must remain retired without a compatibility alias');
  const body = fs.readFileSync(SKILL_MD, 'utf8');
  assert.match(body, /name:\s*flow-drive/);
  assert.match(body, /`route`[\s\S]*`implement`/);
  assert.ok(!/Common targets:/.test(body), 'flow-drive must not duplicate the target catalog');
  assert.ok(!/Implementation dispatch/.test(body), 'flow-drive must not copy the dispatch table');
});

// ---------------------------------------------------------------------------
// 3.2 explicit authority + OpenSpec compound
// ---------------------------------------------------------------------------

test('[3.2] explicit-only target without --execute-explicit returns explicit-required', () => {
  const result = routeV2({
    host: 'claude',
    argv: ['create', 'a', 'PR'],
    observed: {
      invocationClasses: { 'create-pr': 'explicit-only' },
      discovered: ['create-pr'],
      published: ['create-pr'],
    },
  });
  assert.strictEqual(result.disposition, 'explicit-required');
  assert.strictEqual(result.target && result.target.id, 'create-pr');
});

test('[3.2] --route-only plus --execute-explicit stays route-only and is not ready', () => {
  const result = routeV2({
    host: 'claude',
    argv: ['--route-only', '--execute-explicit', 'create', 'a', 'PR'],
    observed: {
      invocationClasses: { 'create-pr': 'explicit-only' },
      discovered: ['create-pr'],
      published: ['create-pr'],
    },
  });
  assert.strictEqual(result.disposition, 'route-only');
  assert.strictEqual(result.options.routeOnly, true);
  assert.strictEqual(result.options.executeExplicit, true);
  assert.notStrictEqual(result.disposition, 'ready');
});

test('[3.2] OpenSpec compound sequence with any explicit-only entry stops; flag does not authorize it', () => {
  const result = routeV2({
    host: 'claude',
    argv: ['--openspec', '--execute-explicit', 'add', 'feature', 'X'],
    observed: {
      openSpecSequence: [
        { id: 'openspec-new-change', invocationClass: 'explicit-only', callable: true },
        { id: 'openspec-ff-change', invocationClass: 'implicit-eligible', callable: true },
      ],
    },
  });
  assert.ok(result.disposition === 'explicit-required' || result.disposition === 'blocked',
    `compound explicit sequence must stop, got ${result.disposition}`);
  assert.notStrictEqual(result.disposition, 'ready');
  const blob = JSON.stringify(result);
  assert.match(blob, /openspec-new-change/);
});

// ---------------------------------------------------------------------------
// 3.3 availability, selector fallback, CLI receipts
// ---------------------------------------------------------------------------

test('[3.3] unavailable Codex target stays on that target with a typed reason', () => {
  const result = routeV2({
    host: 'codex',
    argv: ['run', 'a', 'security', 'audit'],
    observed: {
      published: ['change-verdict'],
      discovered: [],
    },
  });
  assert.strictEqual(result.disposition, 'unavailable');
  assert.strictEqual(result.availability.state, 'unavailable');
  assert.ok(REASON_CODES.includes(result.availability.reasonCode));
  assert.ok(result.target && result.target.id === 'change-verdict');
  assert.ok(Array.isArray(result.availability.evidence) && result.availability.evidence.length > 0);
});

test('[3.3] missing-executable fallback keeps the route target and records MISSING_EXECUTABLE', () => {
  const result = routeV2({
    host: 'claude',
    argv: ['--worker=codex', 'implement', 'the', 'login', 'feature'],
    observed: {
      executables: { claude: true, codex: false, agy: false },
    },
  });
  assert.ok(result.target, 'selector fallback must not clear or substitute the route target');
  assert.strictEqual(result.backendSelection.requested, 'codex');
  assert.strictEqual(result.backendSelection.selected, 'claude');
  assert.strictEqual(result.backendSelection.fallbackUsed, true);
  assert.strictEqual(result.backendSelection.reasonCode, 'MISSING_EXECUTABLE');
});

test('[3.3] launched FAILED CLI receipt becomes blocked, never unavailable, and keeps nested status', () => {
  const result = routeV2({
    host: 'claude',
    argv: ['implement', 'the', 'login', 'feature'],
    cliReceipt: { schema: 'dhpk.cli.receipt.v1', status: 'FAILED', reference: 'receipt://cli/1' },
  });
  assert.strictEqual(result.disposition, 'blocked');
  assert.notStrictEqual(result.disposition, 'unavailable');
  const blob = JSON.stringify(result);
  assert.match(blob, /dhpk\.cli\.receipt\.v1/);
  assert.match(blob, /FAILED/);
});

test('[3.3] launched BLOCKED TIMEOUT PARTIAL receipts all fold to blocked', () => {
  for (const status of ['BLOCKED', 'TIMEOUT', 'PARTIAL']) {
    const result = routeV2({
      host: 'claude',
      argv: ['implement', 'the', 'login', 'feature'],
      cliReceipt: { schema: 'dhpk.cli.receipt.v1', status, reference: `receipt://cli/${status}` },
    });
    assert.strictEqual(result.disposition, 'blocked', status);
    assert.match(JSON.stringify(result), new RegExp(status));
  }
});

test('[3.3] SUCCEEDED plus completed gates may PASS; SUCCEEDED without gates must not', () => {
  const pass = routeV2({
    host: 'claude',
    argv: ['implement', 'the', 'login', 'feature'],
    cliReceipt: { schema: 'dhpk.cli.receipt.v1', status: 'SUCCEEDED', reference: 'receipt://cli/ok' },
    obligationsComplete: true,
  });
  assert.ok(pass.finalVerdict === 'PASS' || pass.verdict === 'PASS' || pass.disposition === 'ready',
    'SUCCEEDED + gates must yield PASS');
  const incomplete = routeV2({
    host: 'claude',
    argv: ['implement', 'the', 'login', 'feature'],
    cliReceipt: { schema: 'dhpk.cli.receipt.v1', status: 'SUCCEEDED', reference: 'receipt://cli/ok' },
    obligationsComplete: false,
  });
  assert.ok(incomplete.finalVerdict !== 'PASS' && incomplete.verdict !== 'PASS',
    'SUCCEEDED without completed gates must not PASS');
});

test('[3.3] availability not-checked has null reason and no evidence; available needs evidence', () => {
  const mod = loadParser();
  const notChecked = {
    schema: 'dhpk.route-result.v2',
    host: 'claude',
    cleanedQuery: 'task',
    options: {
      routeOnly: true, codexPeer: false, architect: false, openSpec: false,
      executeExplicit: false, plan: null, worker: null, reasoner: null,
    },
    target: null,
    availability: { state: 'not-checked', reasonCode: null, evidence: [] },
    backendSelection: null,
    diagnostics: [],
    disposition: 'route-only',
  };
  assert.doesNotThrow(() => mod.validateRouteResult(notChecked));
  assert.throws(() => mod.validateRouteResult({
    ...notChecked,
    availability: { state: 'available', reasonCode: null, evidence: [] },
  }), /evidence|available/i);
});

// ---------------------------------------------------------------------------
// 4.1 warm review
// ---------------------------------------------------------------------------

test('[4.1] missing parent continuation blocks before write-capable dispatch', () => {
  const result = routeV2({
    host: 'claude',
    argv: ['--plan', 'implement', 'the', 'login', 'feature'],
    writeCapable: true,
    parentContinuation: false,
  });
  assert.strictEqual(result.disposition, 'blocked');
});

test('[4.1] SHIP continues; a second FIX-THEN-SHIP or RECONSULT is blocked', () => {
  const ship = routeV2({
    host: 'claude',
    argv: ['--plan', 'implement', 'the', 'login', 'feature'],
    parentContinuation: true,
    warmReview: { verdict: 'SHIP' },
  });
  assert.notStrictEqual(ship.disposition, 'blocked');

  const secondFix = routeV2({
    host: 'claude',
    argv: ['--plan', 'implement', 'the', 'login', 'feature'],
    parentContinuation: true,
    warmReview: { verdict: 'FIX-THEN-SHIP', fixBatchesApplied: 1 },
  });
  assert.strictEqual(secondFix.disposition, 'blocked');

  const secondReconsult = routeV2({
    host: 'claude',
    argv: ['--plan', 'implement', 'the', 'login', 'feature'],
    parentContinuation: true,
    warmReview: { verdict: 'RECONSULT', reconsultsApplied: 1 },
  });
  assert.strictEqual(secondReconsult.disposition, 'blocked');
});

test('[4.1] one FIX-THEN-SHIP batch and one RECONSULT remain allowed', () => {
  const fix = routeV2({
    host: 'claude',
    argv: ['--plan', 'implement', 'the', 'login', 'feature'],
    parentContinuation: true,
    warmReview: { verdict: 'FIX-THEN-SHIP', fixBatchesApplied: 0 },
  });
  assert.notStrictEqual(fix.disposition, 'blocked');
  const reconsult = routeV2({
    host: 'claude',
    argv: ['--plan', 'implement', 'the', 'login', 'feature'],
    parentContinuation: true,
    warmReview: { verdict: 'RECONSULT', reconsultsApplied: 0 },
  });
  assert.notStrictEqual(reconsult.disposition, 'blocked');
});

// ---------------------------------------------------------------------------
// 5.1 distribution membership
// ---------------------------------------------------------------------------

test('[5.1] minimal required_core includes flow-drive and production validators do not hard-code nine', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  const core = inventory.profile_policy.required_core_ids;
  assert.ok(Array.isArray(core), 'profile_policy.required_core_ids must be an array');
  assert.ok(core.includes('flow-drive'), "minimal required_core_ids must include stable id 'flow-drive'");

  const inventorySrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'distribution-inventory.js'), 'utf8');
  const selectionSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'capability-bundle-selection.js'), 'utf8');
  assert.doesNotMatch(inventorySrc, /length !== 9/);
  assert.doesNotMatch(inventorySrc, /exactly nine/);
  assert.doesNotMatch(selectionSrc, /length !== 9/);
  assert.doesNotMatch(selectionSrc, /exactly nine/);

  const installerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), 'utf8');
  assert.doesNotMatch(installerSrc, /!= 9/);
  assert.doesNotMatch(installerSrc, /length !== 9/);
  assert.doesNotMatch(installerSrc, /exactly nine/i);
  assert.doesNotMatch(installerSrc, /exactly the nine/);
});

run('dhpk-do-portable');
