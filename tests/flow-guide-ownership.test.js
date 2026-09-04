'use strict';

// RED acceptance contracts for the Flow ownership cutover.  The tests keep
// routing at its public parser/result seam and use the canonical Markdown only
// for ownership and mode-boundary checks.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GUIDE = path.join(ROOT, 'skills', 'flow-guide');
const DRIVE = path.join(ROOT, 'skills', 'flow-drive');
const ROUTER = path.join(GUIDE, 'scripts', 'route-result.js');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function routeApi() {
  assert.ok(
    fs.existsSync(ROUTER),
    'RED: flow-guide must own skills/flow-guide/scripts/route-result.js; routing still belongs to the retired flow-drive path',
  );
  const api = require(ROUTER);
  for (const name of ['parseInvocationContext', 'createRouteResult', 'validateRouteResult']) {
    assert.strictEqual(typeof api[name], 'function', `${name} must remain a public route-result seam`);
  }
  return api;
}

function route(input) {
  const api = routeApi();
  return api.createRouteResult(input);
}

function resultKeys(result) {
  return Object.keys(result).sort();
}

test('routing artifacts belong to flow-guide and the former flow-drive owner is gone', () => {
  assert.ok(fs.existsSync(path.join(GUIDE, 'SKILL.md')), 'flow-guide canonical package must exist');
  assert.ok(fs.existsSync(path.join(GUIDE, 'references', 'route-table.json')),
    'flow-guide must own the deterministic route table');
  assert.ok(fs.existsSync(path.join(GUIDE, 'references', 'route-result.schema.json')),
    'flow-guide must own the route-result schema');
  assert.strictEqual(fs.existsSync(path.join(DRIVE, 'scripts', 'route-result.js')), false,
    'flow-drive must not retain the routing implementation');
  assert.strictEqual(fs.existsSync(path.join(DRIVE, 'references', 'route-table.json')), false,
    'flow-drive must not retain a second route table');
});

test('flow-guide exposes exactly help, route, rules, next, and close actions', () => {
  const skill = read('skills/flow-guide/SKILL.md');
  const frontmatter = skill.match(/^argument-hint:\s*["']?([^"'\n]+)["']?\s*$/m);
  assert.ok(frontmatter, 'flow-guide must publish an argument hint');
  const hint = frontmatter[1];
  for (const action of ['help', 'route', 'rules', 'next', 'close']) {
    assert.match(hint, new RegExp(`\\b${action}\\b`), `flow-guide argument hint missing ${action}`);
  }
  for (const removed of ['classify', 'policy', 'checklist']) {
    assert.doesNotMatch(hint, new RegExp(`\\b${removed}\\b`),
      `retired flow-guide action ${removed} must not remain public`);
  }
  assert.match(skill, /help[\s\S]{0,220}usage|usage[\s\S]{0,220}help/i);
  assert.match(skill, /route[\s\S]{0,220}--go|--go[\s\S]{0,220}route/i);
});

test('flow-drive is mode-free and accepts only confirmed implementation input', () => {
  const skill = read('skills/flow-drive/SKILL.md');
  assert.match(skill, /disable-model-invocation:\s*true/);
  assert.match(skill, /\$flow-drive\s+<[^>]*(?:confirmed|spec|change)[^>]*>/i);
  assert.doesNotMatch(skill, /^##\s+Modes\s*$/im);
  for (const removedFlag of ['--mode', '--route-only', '--execute-explicit', '--openspec', '--opsx']) {
    assert.doesNotMatch(skill, new RegExp(`\\${removedFlag}\\b`),
      `flow-drive must not expose removed flag ${removedFlag}`);
  }
  assert.match(skill, /flow-guide[\s\S]{0,180}route|route[\s\S]{0,180}flow-guide/i);
});

test('route result v3 has a closed terminal shape with only a go option', () => {
  const result = route({ host: 'claude', argv: ['trace', 'this', 'module'] });
  assert.deepStrictEqual(resultKeys(result), [
    'action', 'availability', 'cleanedQuery', 'diagnostics', 'disposition',
    'host', 'nextAction', 'options', 'requiredEvidence', 'schema', 'target',
  ]);
  assert.strictEqual(result.schema, 'dhpk.route-result.v3');
  assert.strictEqual(result.action, 'route');
  assert.deepStrictEqual(Object.keys(result.options).sort(), ['go']);
  assert.strictEqual(result.options.go, false);
  assert.ok(Array.isArray(result.diagnostics));
  assert.ok(result.diagnostics.every((item) => typeof item === 'string'));
  assert.ok(Array.isArray(result.requiredEvidence));
  assert.ok(result.requiredEvidence.every((item) => typeof item === 'string'));
  assert.strictEqual(typeof result.nextAction, 'string');
  assert.ok(['available', 'unavailable', 'not-configured'].includes(result.availability));
  assert.ok(['advice', 'ready', 'explicit-required', 'blocked', 'unavailable'].includes(result.disposition));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.options));
});

test('route without --go is read-only advice and preserves the cleaned task text', () => {
  const result = route({ host: 'claude', argv: ['review', 'this', 'change'] });
  assert.strictEqual(result.options.go, false);
  assert.strictEqual(result.disposition, 'advice');
  assert.strictEqual(result.cleanedQuery, 'review this change');
  assert.ok(result.target === null || typeof result.target === 'object');
});

test('route --go can produce one bounded handoff only for an implicit-eligible target', () => {
  const api = routeApi();
  const result = api.createRouteResult({
    host: 'claude',
    argv: ['--go', 'trace', 'how', 'this', 'code', 'works'],
    observed: { invocationClasses: { 'code-trace': 'implicit-eligible' } },
  });
  assert.strictEqual(result.options.go, true);
  assert.ok(result.target, 'the fixture query must resolve a distinct trace owner');
  assert.strictEqual(result.target.invocationClass, 'implicit-eligible');
  assert.strictEqual(result.disposition, 'ready');
  assert.ok(result.target.command.startsWith('$'), 'handoff must carry an exact callable command');
});

test('route --go refuses an explicit-only implementation target without invoking it', () => {
  const api = routeApi();
  const result = api.createRouteResult({
    host: 'claude',
    argv: ['--go', 'implement', 'the', 'confirmed', 'OpenSpec', 'change'],
    observed: { invocationClasses: { 'flow-drive': 'explicit-only' } },
  });
  assert.strictEqual(result.options.go, true);
  assert.ok(result.target, 'implementation query must resolve flow-drive');
  assert.strictEqual(result.target.id, 'flow-drive');
  assert.strictEqual(result.target.invocationClass, 'explicit-only');
  assert.strictEqual(result.disposition, 'explicit-required');
  assert.match(result.target.command, /\$flow-drive\s+<[^>]*(?:spec|change)/i);
  assert.ok(result.diagnostics.some((item) => /explicit|required|human/i.test(item)));
});

test('retired route flags fail closed instead of recreating v2 options', () => {
  const api = routeApi();
  for (const args of [
    ['--route-only', 'task'],
    ['--execute-explicit', 'task'],
    ['--openspec', 'task'],
    ['--opsx', 'task'],
  ]) {
    const result = api.parseInvocationContext(args, { host: 'claude' });
    assert.strictEqual(result.schema, 'dhpk.route-result.v3');
    assert.deepStrictEqual(Object.keys(result.options).sort(), ['go']);
    assert.strictEqual(result.options.go, false);
    assert.ok(result.diagnostics.some((item) => /removed|retired|unsupported|--go|flow-guide/i.test(item)),
      `expected a closed diagnostic for ${args[0]}`);
  }
});

test('route-result validation rejects unknown fields and non-v3 schemas', () => {
  const api = routeApi();
  const result = api.createRouteResult({ host: 'claude', argv: ['trace', 'code'] });
  assert.doesNotThrow(() => api.validateRouteResult(result));
  assert.throws(
    () => api.validateRouteResult({ ...result, backendSelection: null }),
    /unknown|additional|backendSelection/i,
  );
  assert.throws(
    () => api.validateRouteResult({ ...result, schema: 'dhpk.route-result.v2' }),
    /schema|v3/i,
  );
});

run('flow-guide-ownership');
