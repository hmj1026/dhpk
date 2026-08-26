'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function flat(value) {
  return value.replace(/\s+/g, ' ');
}

const policy = read('rules/execution-policy.md');
const kernel = read('rules/execution-policy-kernel.md');
const dispatch = read('skills/dhpk-execution-policy/references/implementation-dispatch.md');
const deepReasoner = read('agents/deep-reasoner.md');
const codexDeepReasoner = read('agents/codex-deep-reasoner.md');
const goal = read('skills/dhpk-opsx-apply-goal/references/goal-templates.md');
const adaptive = read('skills/dhpk-adaptive-dev-workflow/SKILL.md');
const command = read('commands/do.md');
const rootAgents = read('AGENTS.md');
const rootClaude = read('CLAUDE.md');
const codexAgents = read('codex/AGENTS.md');
const docs = [read('docs/basic-operations.md'), read('docs/basic-operations.zh-TW.md')];
const cursorProjection = read('cursor/dhpk/policies/execution-policy.md');
const codexProjection = read('codex/supporting/policies/execution-policy.md');
const inventory = JSON.parse(read('manifests/distribution-inventory.json'));

test('canonical policy defines the decision and reasoner handoff contract', () => {
  for (const phrase of [
    'Decision: CLEAR | REASONER_REQUIRED | HUMAN_REQUIRED | BLOCKED',
    'Reasoner result: READY_FOR_DISPATCH | DECISION_FOR_USER | BLOCKED',
    'non-trivial',
    '## Conclusion',
    'file-and-line',
    '## Next actions',
    'not dispatch a write worker',
  ]) {
    assert.ok(policy.includes(phrase), `execution policy missing: ${phrase}`);
  }
});

test('reasoner workers separate transport status from exactly one decision result', () => {
  assert.ok(/^## Conclusion contract/m.test(deepReasoner),
    'deep reasoner contract must be explicit');
  assert.ok(/second line immediately after that heading[\s\S]{0,240}exactly one/i.test(deepReasoner),
    'deep reasoner must classify immediately after Conclusion');
  for (const result of ['READY_FOR_DISPATCH', 'DECISION_FOR_USER', 'BLOCKED']) {
    assert.ok(deepReasoner.includes(`Reasoner result: ${result}`),
      `deep reasoner missing result classification: ${result}`);
  }
  assert.ok(/Do not emit[\s\S]{0,180}pipe-separated notation[\s\S]{0,160}READY_FOR_DISPATCH \| DECISION_FOR_USER \| BLOCKED/i.test(deepReasoner),
    'deep reasoner must reject the pipe-separated placeholder');

  assert.ok(/RESULT: DONE \| TIMEOUT_SALVAGED \| BLOCKED/.test(codexDeepReasoner),
    'codex reasoner must retain the transport status contract');
  assert.ok(/RESULT.*transport status[\s\S]{0,220}reasoner.*decision/i.test(codexDeepReasoner),
    'codex reasoner must separate transport status from reasoner decision');
  assert.ok(/RESULT: DONE[\s\S]{0,700}DECISION_FOR_USER[\s\S]{0,300}READY_FOR_DISPATCH/i.test(codexDeepReasoner),
    'codex DONE output must preserve DECISION_FOR_USER versus READY_FOR_DISPATCH');
  assert.ok(/RESULT: BLOCKED[\s\S]{0,600}Reasoner result: BLOCKED/i.test(codexDeepReasoner),
    'codex blocked output must preserve the BLOCKED reasoner result');
});

test('dispatch reference distinguishes static facts from reasoner-gated decisions', () => {
  for (const phrase of [
    'REASONER_REQUIRED',
    'READY_FOR_DISPATCH',
    'DECISION_FOR_USER',
    'HUMAN_REQUIRED',
    'BLOCKED',
    'static',
    'behavioral',
    'file-and-line',
  ]) {
    assert.ok(dispatch.includes(phrase), `implementation-dispatch reference missing: ${phrase}`);
  }
});

test('implementation workflows make the planner gate explicit for multi-task OpenSpec apply', () => {
  assert.ok(/OpenSpec apply with two or more unchecked tasks/i.test(policy),
    'policy missing the multi-task planner gate');
  assert.ok(/OpenSpec[\s\S]{0,240}planner|planner[\s\S]{0,240}OpenSpec/i.test(adaptive),
    'adaptive workflow missing the multi-task planner gate');
  assert.ok(/OpenSpec[\s\S]{0,240}planner|planner[\s\S]{0,240}OpenSpec/i.test(command),
    'do command missing the multi-task planner gate');
  assert.ok(/project-owned orchestration decision policy[\s\S]{0,180}planner[\s\S]{0,180}reasoner/i.test(goal),
    'goal template must name the project-owned policy that owns the planner and reasoner gates');
  assert.ok(/two or more unchecked tasks|at least two unchecked tasks/i.test(policy),
    'policy missing the planner threshold');
  assert.ok(/planner=skipped|skip.*planner/i.test(policy),
    'policy missing the recorded single-task planner skip');
  for (const phrase of ['dependency order', 'exact owner', 'write scope', 'next checkpoint']) {
    assert.ok(policy.includes(phrase), `planner result contract missing: ${phrase}`);
  }
});

test('kernel and dispatch require a planner before multi-task OpenSpec writes', () => {
  for (const text of [kernel, dispatch]) {
    assert.ok(/>=2`? unchecked tasks[\s\S]{0,180}(planner|planner.*mandatory)/i.test(text),
      'planner gate missing the >=2 unchecked task threshold');
    assert.ok(/planner[\s\S]{0,180}before (any writer|the first write wave)/i.test(text),
      'planner gate must precede the first writer');
    assert.ok(/planner=skipped/i.test(text),
      'planner gate must record the single-task skip');
    for (const phrase of ['dependency order', 'exact owner', 'next checkpoint']) {
      assert.ok(text.includes(phrase), `planner gate missing: ${phrase}`);
    }
  }
});

test('dispatch-off remains an implementation kill switch without bypassing lifecycle planning', () => {
  assert.ok(/off[\s\S]{0,220}planner gate remains active/i.test(goal),
    'off-mode goal must preserve the mandatory planner gate');
  const normalizedPolicy = flat(policy);
  assert.ok(/implementation worker\/reasoner routing[\s\S]{0,220}planner.*verification gates remain active/i.test(normalizedPolicy),
    'canonical policy must distinguish implementation routing from lifecycle gates');
  assert.ok(/full opt-out of implementation routing[\s\S]{0,220}not a bypass of\s+planner or verification gates/i.test(dispatch),
    'kill switch must state the planner/verification exception');
  for (const text of [kernel, read('.claude-plugin/plugin.json'), read('docs/configuration.md'), read('docs/configuration.zh-TW.md')]) {
    assert.ok(/planner.*(?:gate|gates).*active|planner.*仍然有效/i.test(flat(text)),
      'configuration/kernel guidance must keep planner active when dispatch is off');
  }
});

test('architecture-boundary decisions consult architect before any remaining reasoner gate', () => {
  for (const text of [policy, dispatch]) {
    assert.ok(/domain-boundary[\s\S]{0,220}architect[\s\S]{0,220}(REASONER_REQUIRED|reasoner)/i.test(text),
      'architecture-boundary route must name architect then reasoner');
  }
});

test('reasoner result routing fails closed before writer dispatch', () => {
  const normalized = flat(policy);
  assert.ok(normalized.indexOf('REASONER_REQUIRED') < normalized.indexOf('READY_FOR_DISPATCH'),
    'policy must classify the decision before accepting a reasoner result');
  assert.ok(/DECISION_FOR_USER[\s\S]{0,180}HUMAN_REQUIRED[\s\S]{0,120}pauses/i.test(normalized),
    'user-decision result must pause as HUMAN_REQUIRED');
  assert.ok(/BLOCKED[\s\S]{0,180}(stops|does not dispatch)/i.test(normalized),
    'blocked result must stop without dispatching a writer');
  assert.ok(/READY_FOR_DISPATCH[\s\S]{0,180}(bounded writer|writer dispatch)/i.test(normalized),
    'only a ready result may authorize a bounded writer');
});

test('review and consumer boundaries keep unresolved states non-terminal', () => {
  const normalizedPolicy = flat(policy);
  assert.ok(/missing or invalid reviewer result[\s\S]{0,220}(corrected retry|pending gate)/i.test(normalizedPolicy),
    'policy must keep missing or invalid reviewer evidence unresolved');
  assert.ok(/CRITICAL[\s\S]{0,220}(dedicated confirm-only|blocks|BLOCKED)/i.test(normalizedPolicy),
    'policy must keep critical review findings blocking');
  assert.ok(/queued or\s+partial CI is not completion/i.test(normalizedPolicy),
    'policy must reject queued or partial CI as completion');
  assert.ok(/required consumer evidence[\s\S]{0,160}NOT RUN[\s\S]{0,160}UNAVAILABLE[\s\S]{0,160}non-terminal[\s\S]{0,160}cannot count as completed CI/i.test(normalizedPolicy),
    'policy must keep unavailable required consumer evidence non-terminal');
  for (const document of docs) {
    assert.ok(document.includes('NOT RUN'), 'operations documentation must preserve NOT RUN consumer evidence');
    assert.ok(document.includes('UNAVAILABLE'), 'operations documentation must preserve UNAVAILABLE consumer evidence');
  }
});

test('goal template binds the canonical policy through its orientation pointer', () => {
  const part0 = flat(goal.slice(
    goal.indexOf('**`DISPATCH_ON=true`**'),
    goal.indexOf('### CODEX_STATEMENT'),
  ));
  for (const phrase of [
    'rules/execution-policy-kernel.md',
    'skills/dhpk-execution-policy/references/implementation-dispatch.md',
    'ONE consolidated',
    'codex-bridge only as explicit escalation',
  ]) {
    assert.ok(part0.includes(phrase), `DISPATCH_ON=true block missing policy binding: ${phrase}`);
  }
  assert.ok(/execution-policy/i.test(goal), 'goal template must bind the canonical execution policy');
});

test('project-owned entrypoints and guidance preserve the external boundary', () => {
  for (const text of [command, adaptive, rootAgents, rootClaude, codexAgents]) {
    assert.ok(/execution-policy|orchestration decision policy/i.test(text),
      'entrypoint guidance missing canonical policy pointer');
  }
  assert.ok(/external.*opsx:apply|opsx:apply.*external/i.test(policy),
    'canonical policy missing external /opsx:apply boundary');
  const changedPaths = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).split('\n').filter(Boolean).concat(
    execFileSync('git', ['status', '--short', '--untracked-files=all', '--ignored'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).split('\n').filter(Boolean).flatMap((line) => line.slice(3).split(' -> ')),
  );
  const externalPackagePath = /^(?:plugins\/dhpk\/skills\/opsx-apply[^/]*(?:\/|$)|\.agents\/skills\/openspec-apply[^/]*(?:\/|$))/;
  assert.ok(!changedPaths.some((changedPath) => externalPackagePath.test(changedPath)),
    'change scope must not include an external /opsx:apply or OpenSpec package path');
});

test('generated policy projections carry the canonical decision contract and provenance', () => {
  for (const projection of [cursorProjection, codexProjection]) {
    const normalizedProjection = flat(projection);
    assert.ok(normalizedProjection.includes('REASONER_REQUIRED'), 'generated policy projection missing decision gate');
    assert.ok(normalizedProjection.includes('READY_FOR_DISPATCH'), 'generated policy projection missing reasoner result');
    for (const phrase of [
      'dependency order',
      'exact owner',
      'write scope',
      'next checkpoint',
      'dedicated confirm-only',
      'LOW/WARNING-only',
      'worker verification',
      'diff-scope recheck',
      'verify all tasks and gates',
      'archive/sync OpenSpec',
      'valid changelog fragment',
      'Draft PR targeting `develop`',
      'completed conclusion',
      'human merge gate',
      'Required consumer evidence',
    ]) {
      assert.ok(normalizedProjection.includes(phrase), `generated policy projection missing: ${phrase}`);
    }
    assert.ok(/BLOCK[\s\S]{0,160}CRITICAL[\s\S]{0,160}HIGH[\s\S]{0,200}dedicated confirm-only/.test(normalizedProjection),
      'generated policy projection missing high-severity confirm-only handling');
    assert.ok(/queued or\s+partial CI is not completion/i.test(normalizedProjection),
      'generated policy projection must reject queued or partial CI as completion');
    assert.ok(/required consumer evidence[\s\S]{0,160}NOT RUN[\s\S]{0,160}UNAVAILABLE[\s\S]{0,160}non-terminal[\s\S]{0,160}cannot count as completed CI/i.test(normalizedProjection),
      'generated policy projection must keep unavailable required consumer evidence non-terminal');
  }
  const entry = (inventory.supporting_assets || []).find(
    (candidate) => candidate.id === 'codex-supporting-policies-execution-policy-md',
  );
  assert.ok(entry, 'distribution inventory missing execution policy projection entry');
  const digest = (relativePath) => crypto.createHash('sha256').update(read(relativePath)).digest('hex');
  assert.strictEqual(entry.canonical_digest, digest('rules/execution-policy.md'),
    'canonical policy digest is stale');
  assert.strictEqual(entry.projection_digest, digest('codex/supporting/policies/execution-policy.md'),
    'Codex policy projection digest is stale');
});

test('bilingual lifecycle docs describe review, archive, PR, and completed CI evidence', () => {
  for (const text of docs) {
    for (const phrase of ['review', 'archive', 'Draft PR', 'gh run watch', 'blocked']) {
      assert.ok(text.toLowerCase().includes(phrase.toLowerCase()),
        `lifecycle doc missing ${phrase}`);
    }
    const normalized = flat(text).toLowerCase();
    for (const phrase of ['valid changelog fragment', 'low/warning', 'confirm-only']) {
      assert.ok(normalized.includes(phrase), `lifecycle doc missing ${phrase}`);
    }
  }
});

test('policy contract keeps terminal evidence separate from queued or partial completion', () => {
  for (const phrase of [
    'completed CI conclusion',
    'queued',
    'verify',
    'archive',
    'human merge',
  ]) {
    assert.ok(policy.toLowerCase().includes(phrase.toLowerCase()),
      `policy missing terminal-delivery guard: ${phrase}`);
  }
  const normalized = flat(policy).toLowerCase();
  const order = [
    'verify all tasks and gates',
    'archive/sync openspec',
    'valid changelog',
    'draft pr',
    'actual ci',
    'human merge',
  ].map((phrase) => normalized.indexOf(phrase));
  assert.ok(order.every((index) => index >= 0), 'policy missing a delivery-order boundary');
  assert.ok(order.every((index, position) => position === 0 || index > order[position - 1]),
    'policy delivery order must verify, archive, changelog, PR, CI, then human merge');
  assert.ok(/BLOCK[\s\S]{0,180}CRITICAL[\s\S]{0,180}HIGH[\s\S]{0,220}dedicated confirm-only/i.test(policy),
    'policy missing dedicated confirm-only handling for high-severity findings');
  assert.ok(/LOW\/WARNING-only[\s\S]{0,220}(worker|scoped verification)[\s\S]{0,220}diff-scope recheck/i.test(policy),
    'policy missing the low-severity bounded economy path');
});

run('opsx-orchestration-decision-policy');
