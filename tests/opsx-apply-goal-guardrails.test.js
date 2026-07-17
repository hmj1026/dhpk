'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'opsx-apply-goal');

// The skill was refactored into SKILL.md + references/*.md (progressive
// disclosure). Package-level guardrail phrases assert the safety clauses exist
// somewhere in the skill *package*; read the whole package: SKILL.md plus every
// references/*.md.
const refsDir = path.join(SKILL_DIR, 'references');
const skill = [
  fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'),
  ...fs
    .readdirSync(refsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(refsDir, f), 'utf8')),
].join('\n');

// Since harvest-advice-20260712 the emitted Part 0 is a bounded kickoff: the
// behavioral elaborations (premise routing, doubt cycle, CODEX high-stakes peer
// path, expanded triggers, session-end self-check) moved to
// rules/execution-policy.md and bind goal sessions via the orientation read.
// Assert the inline survivors inside the emitted DISPATCH_ON=true block
// specifically (the doc prose around it may legitimately *name* the relocated
// concepts), and assert the relocated phrases in the policy file.
const goalTemplatesRaw = fs.readFileSync(path.join(refsDir, 'goal-templates.md'), 'utf8');
// The template blocks are hard-wrapped prose — normalize whitespace so phrase
// assertions cannot be broken by a line-wrap position change.
const flat = (s) => s.replace(/\s+/g, ' ');
const goalTemplates = flat(goalTemplatesRaw);
const dispatchPart0 = flat(goalTemplatesRaw.slice(
  goalTemplatesRaw.indexOf('**`DISPATCH_ON=true`**'),
  goalTemplatesRaw.indexOf('### CODEX_STATEMENT'),
));
const policy = flat(fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8'));

test('CODEX declaration is one line in the template; elaborations live in execution-policy', () => {
  // one-line declarations, pointing at the policy sections
  assert.ok(
    goalTemplates.includes(
      'CODEX is ON for this session: apply execution-policy §In-flight doubt cycle and §CODEX=on high-stakes parallel peer path',
    ),
    'missing one-line CODEX=on declaration pointing at policy sections',
  );
  assert.ok(goalTemplates.includes('session-end zero-dispatch self-check'),
    'CODEX=on line must name the session-end self-check the policy defines');
  assert.ok(goalTemplates.includes('cross-model doubt skipped (CODEX=off)'),
    'missing skip-announced CODEX=off one-liner');
  // the expanded trigger list and self-check procedure reside in the policy
  for (const phrase of [
    'first-seen query/repository pattern',
    'framework-internal hack',
    'explicit-rule deferral',
    'dispatched `codex-bridge` 0 times',
  ]) {
    assert.ok(policy.includes(phrase), `execution-policy missing relocated CODEX phrase: ${phrase}`);
  }
  // the template no longer restates the proactive peer elaboration
  assert.ok(!goalTemplates.includes('dhpk:codex-bridge independent review'),
    'template must not restate the CODEX=on proactive peer elaboration');
});

test('relocated dispatch elaborations exist in execution-policy, not the emitted Part 0', () => {
  for (const phrase of [
    'when unsure between inline and a worker, dispatch',
    'scratch executable probe',
    'multi-file doc-consistency',
    'whole implement-step footprint',
    'orientation step',
  ]) {
    assert.ok(policy.includes(phrase), `execution-policy missing relocated dispatch phrase: ${phrase}`);
  }
  for (const phrase of ['premise', 'when unsure', 'doubt cycle', 'Repository Discovery Gate', 'verify its output']) {
    assert.ok(!dispatchPart0.includes(phrase),
      `emitted DISPATCH_ON=true Part 0 must not restate relocated elaboration: ${phrase}`);
  }
});

test('emitted Part 0 carries the compact directive inline survivors', () => {
  assert.ok(dispatchPart0.includes('You are the orchestrator'), 'missing orchestrator naming');
  assert.ok(dispatchPart0.includes('repo="<project>"') && dispatchPart0.includes('gitnexus'),
    'missing explicit multi-repo gitnexus guidance');
  for (const role of ['<FAST_WORKER_CLAUSE>', 'dhpk:deep-reasoner', 'dhpk:tdd-guide', '<E2E_ROSTER_CLAUSE>']) {
    assert.ok(dispatchPart0.includes(role), `missing roster role: ${role}`);
  }
  assert.ok(dispatchPart0.includes('<TASK_DIGEST>'), 'missing bounded task digest placeholder');
  assert.ok(!dispatchPart0.includes('head -40 openspec/changes/<CHANGE_ID>/tasks.md'),
    'kickoff must not duplicate the tasks.md orientation read');
  assert.ok(dispatchPart0.includes('ONE consolidated parallel batch per wave'),
    'missing consolidated reviewer-wave contract');
  assert.ok(dispatchPart0.includes('codex-bridge only as explicit escalation, at most once per change'),
    'missing codex-bridge escalation bound');
  assert.ok(/never\s+general-purpose/.test(dispatchPart0), 'missing never-general-purpose rule');
  assert.ok(dispatchPart0.includes('≤2-file whole-implement-step'), 'missing inline footprint bound');
  assert.ok(dispatchPart0.includes('bookkeeping'), 'missing orchestrator bookkeeping carve-out');
  // self-locating policy pointer, read by the orientation command
  assert.ok(dispatchPart0.includes('CLAUDE_PLUGIN_ROOT') && dispatchPart0.includes('rules/execution-policy.md'),
    'missing self-locating execution-policy pointer');
  assert.ok(dispatchPart0.includes('never filesystem-scan'), 'missing never-filesystem-scan clause');
});

test('goal generator documents fast-worker override, task digest, and conditional e2e composition', () => {
  for (const phrase of [
    '--fast-worker=<claude|codex|agy|auto>',
    'flag > userConfig > shipped default',
    'HAS_E2E',
    '200 UTF-8 bytes',
    '<FAST_WORKER_CLAUSE>',
    '<TASK_DIGEST>',
    '<E2E_ROSTER_CLAUSE>',
  ]) {
    assert.ok(skill.includes(phrase), `missing goal-generation contract: ${phrase}`);
  }
});

test('/dhpk:do carries fast-worker override through every implementation-class route', () => {
  const command = fs.readFileSync(path.join(ROOT, 'commands', 'do.md'), 'utf8');
  for (const route of ['dhpk:adaptive-dev-workflow', 'dhpk:bug-fix', 'dhpk:feature-dev', 'dhpk:opsx-apply-goal']) {
    assert.ok(command.includes(route), `do command missing implementation route ${route}`);
  }
  assert.ok(command.includes('forward the invocation override to every implementation-class route'));
  assert.ok(command.includes('downstream route MUST call the shared fast-worker backend selector'));
  assert.ok(command.includes('FAST_WORKER_OVERRIDE=<actual value|unset>'),
    'do command must preserve the actual override outside the cleaned query');
  assert.ok(command.includes('Pass both the cleaned query and the named invocation context'),
    'do command must forward the value-bearing invocation context');
  for (const skillName of ['adaptive-dev-workflow', 'bug-fix', 'feature-dev']) {
    const downstream = fs.readFileSync(path.join(ROOT, 'skills', skillName, 'SKILL.md'), 'utf8');
    assert.ok(downstream.includes('FAST_WORKER_OVERRIDE'), `${skillName} does not consume the named override`);
    assert.ok(downstream.includes('scripts/fast-worker-selector.js'), `${skillName} bypasses the shared selector`);
    assert.ok(downstream.includes('--backend "$FAST_WORKER_OVERRIDE"'),
      `${skillName} does not pass the carried value to the shared selector`);
  }
});

test('Part 0 and verification checklist carve hard-rule conflicts out of unattended confirmation', () => {
  assert.ok(skill.includes('without stopping for confirmation'), 'baseline kickoff phrase missing');
  assert.ok(skill.includes('ordinary implementation judgment calls only'),
    'missing hard-rule carve-out wording');
  assert.ok(skill.includes('never an explicit project hard-rule conflict'),
    'missing explicit hard-rule conflict limit');
  assert.ok(dispatchPart0.includes('project hard rules cannot be deferred because a prior design chose a cheaper implementation'),
    'missing inline design-snapshot hard-rule guardrail');
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

test('stop and verification clauses use mechanical formulations, not judgment adjectives', () => {
  // turn budget: finish the current item, no half-edited file (no "next safe point")
  assert.ok(goalTemplates.includes('stop after finishing the current tasks.md item'),
    'missing finish-current-item turn checkpoint');
  assert.ok(goalTemplates.includes('no half-edited file'), 'missing no-half-edited-file clause');
  assert.ok(!goalTemplates.includes('next safe point'), 'stale "next safe point" phrasing remains');
  // pre-existing failure/warning: git stash reappearance + named in summary (no "unrelated" judgment)
  assert.ok(/reproduces identically on a `git stash`-ed clean HEAD/.test(goalTemplates),
    'missing mechanical git-stash pre-existing test');
  assert.ok(goalTemplates.includes('named in the completion summary'),
    'missing completion-summary naming requirement');
  assert.ok(!goalTemplates.includes('unrelated to the change'),
    'stale "unrelated to the change" judgment clause remains');
  // smoke evidence: Verdict line + observed output line (no "key observed value")
  assert.ok(goalTemplates.includes('at least one observed output line'),
    'missing observed-output-line smoke evidence requirement');
  assert.ok(!goalTemplates.includes('key observed value'),
    'stale "key observed value" phrasing remains');
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

test('4000-char paste guard: single variant, measured length, hard-stop wiring', () => {
  // threshold + Block A row
  assert.ok(skill.includes('4000'), 'missing 4000-character threshold reference');
  assert.ok(skill.includes('Goal length'), 'missing Block A Goal length row');
  assert.ok(skill.includes('GOAL_MODE'), 'missing GOAL_MODE state tracking');
  for (const state of ['full', 'BLOCKED']) {
    assert.ok(skill.includes(state), `missing GOAL_MODE state: ${state}`);
  }
  // the compact-variant machinery is gone: no compacted mode, no compact template sections
  assert.ok(!skill.includes('compacted'), 'stale compacted GOAL_MODE remains');
  assert.ok(!skill.includes('compact variant'), 'stale compact template variant section remains');
  assert.ok(skill.includes('should-never-fire'), 'missing should-never-fire regression semantics');
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
