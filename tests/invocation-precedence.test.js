'use strict';

// Route precedence and invocation-class gate regression tests
// (openspec/changes/clarify-dhpk-skill-invocation-policy specs/
// skill-routing-guidance/spec.md). Static content assertions over the
// dhpk-owned router surfaces — thin commands/do.md adapter, skills/dhpk-next-step/SKILL.md,
// skills/dhpk-opsx-apply-goal/references/goal-templates.md, and
// commands/opsx-apply-resume.md — proving the explicit-only gate and the
// issue #87 opsx:* alias fix are present and did not regress.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const doCmd = read('commands/do.md');
const nextStep = read('skills/dhpk-next-step/SKILL.md');
const goalTemplates = read('skills/dhpk-opsx-apply-goal/references/goal-templates.md');
const resumeCmd = read('commands/opsx-apply-resume.md');
const precedenceSSOT = read('skills/dhpk-execution-policy/references/invocation-precedence.md');

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

test('the precedence SSOT reference file exists and states the fixed order', () => {
  assert.ok(precedenceSSOT.includes('Exact explicit command or skill invocation'));
  assert.ok(precedenceSSOT.includes('Implementation dispatch'));
  assert.ok(/1\.[\s\S]*2\.[\s\S]*3\.[\s\S]*4\.[\s\S]*5\.[\s\S]*6\./.test(precedenceSSOT),
    'precedence SSOT must enumerate all 6 layers in order');
});

test('execution-policy.md points to the precedence SSOT rather than restating it', () => {
  const policy = read('rules/execution-policy.md');
  assert.ok(policy.includes('invocation-precedence.md'));
  assert.ok(policy.includes('invocation-classification.md'));
});

test('/dhpk:do adapter defers MATCH/NO_MATCH invocation-class gating to the precedence SSOT', () => {
  assert.ok(doCmd.includes('@skills/dhpk-do/SKILL.md'), 'do.md must remain a pointer at the portable skill');
  assert.ok(precedenceSSOT.includes('Invocation-class gate'), 'precedence SSOT missing the invocation-class gate section');
  assert.ok(/do NOT call the Skill tool/i.test(precedenceSSOT), 'precedence SSOT must state the explicit-only Skill-tool refusal');
  assert.ok(precedenceSSOT.includes('exact supported invocation syntax'),
    'explicit-only targets must be presented with exact invocation syntax');
});

test('/dhpk:do never unconditionally auto-invokes the explicit-only opsx-apply-goal route', () => {
  assert.ok(!/pass that argument string to the skill and end this session/.test(doCmd),
    'stale unconditional opsx-apply-goal auto-invoke phrasing must not remain');
  assert.ok(!/pass that argument string to the skill and end this session/.test(precedenceSSOT));
  assert.ok(precedenceSSOT.includes('exact supported invocation syntax'),
    'explicit-only targets must be presented rather than auto-invoked');
});

test('/dhpk:do adapter does not pass opsx:* aliases to the Skill tool', () => {
  assert.ok(!/## Step 0/.test(doCmd), 'thin adapter must not keep an independent OpenSpec discover workflow');
  assert.ok(precedenceSSOT.includes('openspec-*'), 'precedence SSOT must name the canonical OpenSpec Skill-tool IDs');
  assert.ok(precedenceSSOT.includes('never passes an `opsx:*` alias to the generic Skill tool'),
    'must forbid passing the opsx:* alias to the Skill tool');
  assert.ok(/invocation\s+restriction/.test(precedenceSSOT),
    'must not bypass the target invocation restriction');
});

test('next-step --go respects the target invocation class', () => {
  assert.ok(nextStep.includes('metadata.dhpk-invocation-class') || nextStep.includes('invocation class'),
    'next-step SKILL.md must reference invocation class before dispatching --go');
  assert.ok(nextStep.includes('explicit-only'), 'next-step SKILL.md must name the explicit-only case for --go');
});

test('issue #87 regression: the opsx-apply-goal generated kickoff uses the canonical Skill-tool ID, not the opsx:apply alias', () => {
  assert.ok(goalTemplates.includes('openspec-apply-change'),
    'goal-templates.md must invoke the canonical Skill ID openspec-apply-change');
  assert.ok(!/invoke (the )?opsx:apply/.test(goalTemplates),
    'goal-templates.md must not instruct invoking the opsx:apply alias as a skill');
});

test('issue #87 regression: opsx-apply-resume.md dispatches the canonical Skill-tool ID, not the opsx:apply alias', () => {
  assert.ok(resumeCmd.includes('openspec-apply-change'));
  assert.ok(!/Directly invoke the `opsx:apply` skill/.test(resumeCmd),
    'opsx-apply-resume.md must not instruct invoking the opsx:apply alias as a skill');
  assert.ok(resumeCmd.includes('never pass the `opsx:apply` human-command alias to the Skill tool'));
});

test('every skill-local route-table.json target resolves to an invocation class or known agent route', () => {
  const routeTable = JSON.parse(read('skills/dhpk-do/references/route-table.json'));
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
  const routeTable = JSON.parse(read('skills/dhpk-do/references/route-table.json'));
  const explicitTargets = new Set(['dhpk-opsx-apply-goal', 'create-pr', 'dhpk-release-creator', 'smart-commit']);
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

test('v2 skill-local route table typed targets (skip while package absent; see dhpk-do-portable)', () => {
  const tablePath = path.join(ROOT, 'skills', 'dhpk-do', 'references', 'route-table.json');
  if (!fs.existsSync(tablePath)) return;
  const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
  assert.strictEqual(table.schema, 'dhpk.route-table.v2');
  for (const rule of table.rules) {
    assert.ok(rule.target && typeof rule.target === 'object', `${rule.label} must declare target`);
    assert.ok(['skill', 'command', 'agent'].includes(rule.target.kind), `${rule.label} kind`);
    assert.match(rule.target.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

test('thin /dhpk:do adapter does not duplicate Common targets; route-table classes remain canonical', () => {
  assert.ok(!/Common targets:/.test(doCmd), 'adapter must not duplicate the target catalog');
  const routeTable = JSON.parse(read('skills/dhpk-do/references/route-table.json'));
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
