'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const skill = fs.readFileSync(path.join(ROOT, 'skills', 'opsx-apply-goal', 'SKILL.md'), 'utf8');

test('CODEX=on proactive peer text names expanded trigger categories', () => {
  for (const phrase of [
    'first-seen query/repository patterns',
    'framework-internal hacks',
    'explicit-rule deferrals',
    'dhpk:codex-bridge independent review',
  ]) {
    assert.ok(skill.includes(phrase), `missing CODEX trigger phrase: ${phrase}`);
  }
});

test('Part 0 and verification checklist carve hard-rule conflicts out of unattended confirmation', () => {
  assert.ok(skill.includes('without stopping for confirmation'), 'baseline kickoff phrase missing');
  assert.ok(skill.includes('ordinary implementation judgment calls only'),
    'missing hard-rule carve-out wording');
  assert.ok(skill.includes('never an explicit project hard-rule conflict'),
    'missing explicit hard-rule conflict limit');
  assert.ok(skill.includes('explicit project hard rules cannot be deferred because a prior design chose a cheaper implementation'),
    'missing design-snapshot hard-rule guardrail');
});

test('Part 2 and Part 4 include unresolved verdict and hard-rule escalation gates', () => {
  assert.ok(skill.includes('.unresolved-verdict'), 'missing unresolved verdict sidecar gate');
  assert.ok(skill.includes('confirmed the output is NONE in conversation (no unresolved reviewer verdict sidecar entries)'),
    'missing unresolved-verdict NONE wording');
  assert.ok(skill.includes('openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md'),
    'missing hard-rule escalation artifact path');
  assert.ok(skill.includes('rule, conflicting decision with file:line evidence, and why compliance is blocked'),
    'missing hard-rule escalation contents');
});

run('opsx-apply-goal-guardrails');
