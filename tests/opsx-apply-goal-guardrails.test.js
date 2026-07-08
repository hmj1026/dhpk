'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'opsx-apply-goal');

// The skill was refactored into SKILL.md + references/*.md (progressive
// disclosure). The guardrail phrases below assert the safety clauses exist
// somewhere in the skill *package*, not in one specific file, so read the whole
// package: SKILL.md plus every references/*.md.
const refsDir = path.join(SKILL_DIR, 'references');
const skill = [
  fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'),
  ...fs
    .readdirSync(refsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(refsDir, f), 'utf8')),
].join('\n');

// Some guardrails must be proven in the *compact* Part 0 template specifically,
// not merely somewhere in the package — the safety phrases also appear in
// SKILL.md's verification checklist, which would let a whole-package match pass
// even if the compact template dropped the rule. Slice the compact Part 0
// section out of goal-templates.md so those assertions stay meaningful.
const goalTemplates = fs.readFileSync(path.join(refsDir, 'goal-templates.md'), 'utf8');
const compactPart0 = goalTemplates.slice(
  goalTemplates.indexOf('### Part 0 — compact variant'),
  goalTemplates.indexOf('### CODEX_STATEMENT — compact variant'),
);

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

test('smoke gate: flags, HAS_SMOKE conditioning, Block A row, and self-escaping hatch are wired', () => {
  // flags parsed
  assert.ok(skill.includes('--smoke') && skill.includes('--no-smoke'),
    'missing --smoke/--no-smoke flags');
  assert.ok(skill.includes('HAS_SMOKE'), 'missing HAS_SMOKE detection flag');
  // Part 3 line emitted iff HAS_SMOKE=true
  assert.ok(skill.includes('ONLY when `HAS_SMOKE=true`') || skill.includes('only when `HAS_SMOKE=true`'),
    'smoke gate line is not conditioned on HAS_SMOKE=true');
  // PASS satisfies, and the FAIL-does-not-satisfy rule is stated
  assert.ok(skill.includes('Verdict: PASS'), 'missing Verdict: PASS satisfy condition');
  assert.ok(skill.includes('Verdict: FAIL') && /does NOT satisfy the gate/.test(skill),
    'missing FAIL-does-not-satisfy rule');
  // Block A enum states (on/off, both flag and signal variants)
  for (const state of ['on (signal)', 'on (--smoke)', 'off (--no-smoke)', 'off (no strong signal, hint emitted)']) {
    assert.ok(skill.includes(state), `missing Block A smoke-gate state: ${state}`);
  }
  // self-escaping hatch (branch b) is discoverable in the Part 3 gate text
  assert.ok(skill.includes('could not be driven this session'),
    'missing self-escaping hatch note wording');
  assert.ok(skill.includes("failing command's output"),
    'missing escape-hatch evidence requirement');
});

test('4000-char paste guard: threshold, compact fallback, and hard-block wiring', () => {
  // threshold + Block A row
  assert.ok(skill.includes('4000'), 'missing 4000-character threshold reference');
  assert.ok(skill.includes('Goal length'), 'missing Block A Goal length row');
  assert.ok(skill.includes('GOAL_MODE'), 'missing GOAL_MODE state tracking');
  for (const state of ['full', 'compacted', 'BLOCKED']) {
    assert.ok(skill.includes(state), `missing GOAL_MODE state: ${state}`);
  }
  // compact Part 0 variant preserves safety-critical clauses
  assert.ok(skill.includes('Part 0 — compact variant'), 'missing compact Part 0 section');
  assert.ok(skill.includes('CODEX_STATEMENT — compact variant'), 'missing compact CODEX_STATEMENT section');
  assert.ok(compactPart0.includes('Repository Discovery Gate before'), 'compact Part 0 must keep the Repository Discovery Gate rule');
  assert.ok(/never\s+general-purpose/.test(compactPart0), 'compact Part 0 must keep the never-general-purpose rule');
  // hard-block behavior and operator guidance
  assert.ok(skill.includes('No /goal command was emitted this run'), 'missing hard-stop notice');
  assert.ok(skill.includes('do **not** print Block B, C, or C2') || skill.includes('do not print Block B, C, or C2'),
    'missing suppression of Block B/C/C2 when blocked');
  for (const bullet of [
    'turn off the orchestration_dispatch project setting',
    'drop --codex (removes the CODEX statement)',
    'drop --smoke / pass --no-smoke (removes the smoke-gate line)',
    'fewer verification gates detected',
  ]) {
    assert.ok(skill.includes(bullet), `missing hard-stop guidance bullet: ${bullet}`);
  }
});

run('opsx-apply-goal-guardrails');
