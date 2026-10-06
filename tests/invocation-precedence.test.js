'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Resolve a bare skill/command name (as referenced by route-table.json) to its
// declared metadata.dhpk-invocation-class. Root-level only — matches the scope
// of both routing surfaces under test.
function resolveInvocationClass(name) {
  const skillFile = path.join(ROOT, 'skills', name, 'SKILL.md');
  const cmdFile = path.join(ROOT, 'commands', `${name}.md`);
  const file = fs.existsSync(skillFile) ? skillFile : fs.existsSync(cmdFile) ? cmdFile : null;
  if (!file) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^metadata:\s*\n\s+dhpk-invocation-class:\s*(\S+)/m);
  return m ? m[1] : null;
}

function resolveAgentRoute(kind, id) {
  if (kind !== 'agent') return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id || ''))) return null;
  const file = path.join(ROOT, 'agents', id + '.md');
  return fs.existsSync(file) ? id : null;
}






test('every skill-local route-table.json target resolves to an invocation class or known agent route', () => {
  const routeTable = JSON.parse(read('skills/flow-guide/references/route-table.json'));
  for (const rule of routeTable.rules) {
    const kind = rule.target && rule.target.kind;
    const id = rule.target && rule.target.id;
    const agent = resolveAgentRoute(kind, id);
    if (agent) {
      assert.strictEqual(agent, 'e2e-runner', `route-table agent target '${id}' must be the Playwright e2e-runner role`);
      continue;
    }
    const cls = resolveInvocationClass(id);
    assert.ok(cls, `route-table rule [${rule.label}] target '${kind}:${id}' did not resolve to a skill or command`);
    assert.ok(cls === 'explicit-only' || cls === 'implicit-eligible',
      `route-table rule [${rule.label}] target '${kind}:${id}' has unknown invocation class '${cls}'`);
  }
});

test('real route-table explicit-only targets retain their canonical classes', () => {
  const routeTable = JSON.parse(read('skills/flow-guide/references/route-table.json'));
  const explicitTargets = new Set(['create-pr', 'release-creator', 'smart-commit']);
  const implicitTargets = new Set(['review-pending']);
  for (const target of explicitTargets) {
    assert.ok(routeTable.rules.some((rule) => rule.target && rule.target.id === target), `route table must contain ${target}`);
    assert.strictEqual(resolveInvocationClass(target), 'explicit-only', `${target} must remain explicit-only`);
  }
  for (const target of implicitTargets) {
    assert.ok(routeTable.rules.some((rule) => rule.target && rule.target.id === target), `route table must contain ${target}`);
    assert.strictEqual(resolveInvocationClass(target), 'implicit-eligible', `${target} must remain implicit-eligible`);
  }
});

test('default route table does not target frozen Codex-MCP candidates', () => {
  const routeTable = JSON.parse(read('skills/flow-guide/references/route-table.json'));
  const frozen = new Set([
    'dhpk-codex-architect', 'dhpk-codex-implement', 'dhpk-change-review',
    'dhpk-doc-review', 'dhpk-test-review', 'dhpk-codebase-exploration',
    'dhpk-feature-verify', 'dhpk-issue-analyze', 'dhpk-feasibility-study',
    'codex-review', 'codex-review-branch', 'codex-review-doc',
    'codex-review-fast', 'codex-security', 'codex-test-gen',
    'codex-test-review', 'review-spec',
  ]);
  const violations = routeTable.rules
    .map((rule) => rule.target && rule.target.id)
    .filter((id) => frozen.has(id));
  assert.deepStrictEqual(violations, [], `default route table targets frozen MCP entries: ${violations.join(', ')}`);
});

test('flow-guide route table keeps typed targets', () => {
  const tablePath = path.join(ROOT, 'skills', 'flow-guide', 'references', 'route-table.json');
  if (!fs.existsSync(tablePath)) return;
  const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
  assert.strictEqual(table.schema, 'dhpk.route-table.v2');
  for (const rule of table.rules) {
    assert.ok(rule.target && typeof rule.target === 'object', `${rule.label} must declare target`);
    assert.ok(['skill', 'command', 'agent'].includes(rule.target.kind), `${rule.label} kind`);
    assert.match(rule.target.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

test('flow-guide route table targets retain canonical invocation classes', () => {
  const routeTable = JSON.parse(read('skills/flow-guide/references/route-table.json'));
  let checked = 0;
  for (const rule of routeTable.rules) {
    const kind = rule.target && rule.target.kind;
    const id = rule.target && rule.target.id;
    if (kind === 'agent') continue;
    const cls = resolveInvocationClass(id);
    assert.ok(cls, `route-table target '${id}' did not resolve to a skill or command`);
    assert.ok(cls === 'explicit-only' || cls === 'implicit-eligible',
      `route-table target '${id}' has unknown invocation class '${cls}'`);
    checked += 1;
  }
  assert.ok(checked >= 10, `expected to check at least 10 route-table entries, checked ${checked}`);
});

run('invocation-precedence');
