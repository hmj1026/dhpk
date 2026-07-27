'use strict';

// Route precedence and invocation-class gate regression tests
// (openspec/changes/clarify-dhpk-skill-invocation-policy specs/
// skill-routing-guidance/spec.md). Static content assertions over the
// dhpk-owned router surfaces — commands/do.md, skills/next-step/SKILL.md,
// skills/opsx-apply-goal/references/goal-templates.md, and
// commands/opsx-apply-resume.md — proving the explicit-only gate and the
// issue #87 opsx:* alias fix are present and did not regress.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const flat = (s) => s.replace(/\s+/g, ' ');
const doCmd = read('commands/do.md');
const doCmdFlat = flat(doCmd);
const nextStep = read('skills/next-step/SKILL.md');
const goalTemplates = read('skills/opsx-apply-goal/references/goal-templates.md');
const resumeCmd = read('commands/opsx-apply-resume.md');
const precedenceSSOT = read('skills/dhpk-execution-policy/references/invocation-precedence.md');

// Resolve a bare skill/command name (as referenced by route-table.json or
// do.md's "Common targets" prose) to its declared metadata.dhpk-invocation-class.
// Root-level only — matches the scope of both routing surfaces under test.
function resolveInvocationClass(name) {
  const skillFile = path.join(ROOT, 'skills', name, 'SKILL.md');
  const cmdFile = path.join(ROOT, 'commands', `${name}.md`);
  const file = fs.existsSync(skillFile) ? skillFile : fs.existsSync(cmdFile) ? cmdFile : null;
  if (!file) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^metadata:\s*\n\s+dhpk-invocation-class:\s*(\S+)/m);
  return m ? m[1] : null;
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

test('/dhpk:do gates MATCH and NO_MATCH on the resolved target invocation class', () => {
  assert.ok(doCmd.includes('Invocation-class gate'), 'do.md missing the invocation-class gate section');
  assert.ok(doCmd.includes('does NOT call the Skill tool'), 'do.md must state the explicit-only Skill-tool refusal');
  assert.ok(/MATCH.*resolve.*invocation class/s.test(doCmd) || doCmd.includes('resolve `<skill>`\'s invocation class'),
    'MATCH branch must resolve invocation class before invoking');
  assert.ok(doCmd.includes('explicit-only; run:'), 'do.md must print the exact recommended invocation for explicit-only targets');
});

test('/dhpk:do never unconditionally auto-invokes the explicit-only opsx-apply-goal route', () => {
  assert.ok(!/pass that argument string to the skill and end this session/.test(doCmd),
    'stale unconditional opsx-apply-goal auto-invoke phrasing must not remain');
  assert.ok(doCmdFlat.includes('present the exact invocation `/dhpk:opsx-apply-goal'),
    'do.md must present the exact opsx-apply-goal invocation rather than calling it directly');
});

test('/dhpk:do --openspec discovers Skill-tool availability before invoking openspec-new-change/ff-change', () => {
  assert.ok(doCmd.includes('**Discover** whether the external OpenSpec authoring entries'));
  assert.ok(doCmd.includes('openspec-new-change') && doCmd.includes('openspec-ff-change'));
  assert.ok(doCmd.includes('never pass `opsx:new` or `opsx:ff` to the'), 'must forbid passing the opsx:* alias to the Skill tool');
  assert.ok(doCmd.includes('do not bypass the entry\'s invocation restriction'));
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

test('every scripts/lib/route-table.json target resolves and has a known invocation class', () => {
  const routeTable = JSON.parse(read('scripts/lib/route-table.json'));
  for (const rule of routeTable.rules) {
    const name = rule.skill.replace(/^dhpk:/, '');
    const cls = resolveInvocationClass(name);
    assert.ok(cls, `route-table rule [${rule.label}] target '${rule.skill}' did not resolve to a skill or command`);
    assert.ok(cls === 'explicit-only' || cls === 'implicit-eligible',
      `route-table rule [${rule.label}] target '${rule.skill}' has unknown invocation class '${cls}'`);
  }
});

test('do.md "Common targets" (explicit-only) annotations agree with the actual declared class', () => {
  const m = doCmdFlat.match(/Common targets:([\s\S]*?)If nothing fits/);
  assert.ok(m, 'do.md must have a "Common targets" list to check');
  const list = m[1];
  const nameRe = /`dhpk:([a-z0-9-]+)`(\s*\(explicit-only\))?/g;
  let match;
  let checked = 0;
  while ((match = nameRe.exec(list))) {
    const name = match[1];
    const annotatedExplicitOnly = Boolean(match[2]);
    const cls = resolveInvocationClass(name);
    assert.ok(cls, `do.md Common targets references '${name}' which did not resolve to a skill or command`);
    if (annotatedExplicitOnly) {
      assert.strictEqual(cls, 'explicit-only', `do.md annotates '${name}' as (explicit-only) but its declared class is '${cls}'`);
    } else {
      assert.strictEqual(cls, 'implicit-eligible', `do.md lists '${name}' without an (explicit-only) annotation but its declared class is '${cls}'`);
    }
    checked += 1;
  }
  assert.ok(checked >= 10, `expected to check at least 10 Common targets entries, checked ${checked}`);
});

run('invocation-precedence');
