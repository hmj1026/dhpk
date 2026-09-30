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
const dispatch = read('skills/flow-guide/references/implementation-dispatch.md');
const deepReasoner = read('agents/deep-reasoner.md');
const codexDeepReasoner = read('agents/codex-deep-reasoner.md');
const goal = read('skills/dhpk-opsx-apply-goal/references/goal-templates.md');
const adaptive = read('skills/flow-guide/SKILL.md');
const command = read('skills/flow-drive/SKILL.md');
const rootAgents = read('AGENTS.md');
const rootClaude = read('CLAUDE.md');
const codexAgents = read('codex/AGENTS.md');
const subagentPrompt = read('docs/subagent-prompt-template.md');
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

test('Codex named specialists use cold standalone dispatch packets', () => {
  for (const text of [policy, codexProjection]) {
    const normalized = flat(text);
    assert.match(normalized, /named specialist[\s\S]{0,360}fork_turns="none"/i,
      'named specialist dispatch must use fork_turns="none"');
    assert.match(normalized, /fork_turns="all"[\s\S]{0,260}default\/inherited/i,
      'full-history dispatch must stay on the default/inherited path');
    assert.match(normalized, /model[\s\S]{0,100}reasoning_effort[\s\S]{0,220}(omit|role defaults)/i,
      'named specialist dispatch must preserve role model/effort defaults');
    assert.match(normalized, /\.codex\/config\.toml[\s\S]{0,300}deep-reasoner[\s\S]{0,300}concurrent[\s\S]{0,300}(restart|new session)/i,
      'unavailable-role troubleshooting must preserve the ordered four-step diagnostic');
  }

  for (const heading of [
    'Working directory',
    'Goal and non-goals',
    'Scope',
    'Constraints and settled decisions',
    'Verification and acceptance',
    'Task identity and evidence',
    'Output contract',
  ]) {
    assert.ok(subagentPrompt.includes(heading), `standalone task packet missing: ${heading}`);
  }
  assert.match(codexAgents, /named specialist[\s\S]{0,260}subagent-prompt-template\.md/i,
    'Codex guidance must point named-specialist dispatches at the packet template');
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
  assert.ok(/OpenSpec[\s\S]{0,240}planner|planner[\s\S]{0,240}OpenSpec/i.test(dispatch),
    'flow-guide dispatch reference missing the multi-task planner gate');
  assert.ok(/OpenSpec[\s\S]{0,240}planner|planner[\s\S]{0,240}OpenSpec/i.test(read('skills/flow-drive/SKILL.md')),
    'flow-drive skill missing the multi-task planner gate');
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
    goal.indexOf('## Part 1 (always)'),
  ));
  for (const phrase of [
    'rules/execution-policy-kernel.md',
    'skills/flow-guide/references/implementation-dispatch.md',
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
  // git status --ignored exceeds Node's 1MiB default in this worktree; the
  // assertion still ignores `!! ` lines and only inspects the change scope.
  const gitList = { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 };
  const changedPaths = execFileSync('git', ['diff', '--name-only', 'HEAD'], gitList)
    .split('\n').filter(Boolean).concat(
    execFileSync('git', ['status', '--short', '--untracked-files=all', '--ignored'], gitList)
      .split('\n').filter(Boolean).filter((line) => !line.startsWith('!! ')).flatMap((line) => line.slice(3).split(' -> ')),
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

// v1 GREEN contract (tests above): execution-policy / kernel / dispatch / goal
// template / projection provenance. Those remain the decision SSOT.
// The family route consumes that SSOT and must not copy the implementation
// dispatch table. See tests/dhpk-do-portable.test.js for the route contract.

test('flow-drive consumes execution-policy and must not duplicate the dispatch table', () => {
  const skillPath = path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'skills/flow-drive/SKILL.md must exist');
  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /execution-policy/, 'flow-drive must point at execution-policy as decision SSOT');
  for (const phrase of [
    'general-purpose` is prohibited for implementation',
    'The "≤2 files" inline bound',
    'Reasoner result: READY_FOR_DISPATCH | DECISION_FOR_USER | BLOCKED',
  ]) {
    assert.ok(!skill.includes(phrase), `flow-drive must not copy dispatch-table phrase: ${phrase}`);
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

{
  // F51 source block: execution-policy-kernel.test.js
  'use strict';

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

  test('always-visible execution kernel preserves safety and completion boundaries', () => {
    const kernel = read('rules/execution-policy-kernel.md');
    for (const phrase of [
      'Safety and authorization',
      'dirty worktree',
      'immutable route parser',
      'explicit-only',
      'Completion boundary',
      'unavailable',
    ]) assert.match(kernel, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.ok(kernel.includes('execution-policy.md'), 'kernel must point to the policy SSOT');
    assert.ok(kernel.length < 6000, 'kernel must stay short enough to remain always visible');
  });

  test('policy skill and rule bind the same kernel before conditional references', () => {
    const skill = read('skills/flow-guide/SKILL.md');
    const policy = read('rules/execution-policy.md');
    assert.ok(
      skill.includes('references/execution-bundle/rules/execution-policy.md'),
      'flow-guide must point to its local policy bundle',
    );
    assert.match(
      policy,
      /always-visible kernel first\s+\(`\$\{POLICY_BUNDLE_ROOT\}\/rules\/execution-policy-kernel\.md`\),\s+then load the conditional sections below/i,
      'the policy must name the kernel before its conditional sections',
    );
    assert.match(skill, /source of truth|authoritative|SSOT/i);
  });

  test('dispatch contract defines bounded context tiers and a complete cold packet', () => {
    const policy = read('rules/execution-policy.md');
    for (const tier of ['`cold`', '`bounded`', '`full`']) {
      assert.ok(policy.includes(tier), `missing context tier ${tier}`);
    }
    for (const field of ['goal and non-goals', 'exact owned files', 'settled interfaces', 'verification and acceptance', 'task/attempt identity']) {
      assert.ok(policy.includes(field), `cold packet missing ${field}`);
    }
    assert.ok(/File count remains a collision and safety gate/.test(policy));
    assert.ok(/does not by itself justify a\s+`full` fork/.test(policy));
  });
}

{
  // F51 source block: policy-static-guardrails.test.js
  'use strict';

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  }

  test('execution policy documents Repository Discovery Gate and hard-rule deferral limits', () => {
    const text = read('rules/execution-policy.md');
    for (const phrase of [
      'Repository Discovery Gate',
      'new DB, SQL, query-builder, criteria, model-persistence, or repository-like code',
      'human-approved exception',
    ]) {
      assert.ok(text.includes(phrase), `rules/execution-policy.md missing: ${phrase}`);
    }
    assert.ok(/explicit project hard rules cannot be deferred/i.test(text),
      'rules/execution-policy.md missing explicit project hard rules cannot be deferred');
  });

  test('implementation-dispatch reference includes anti-rationalization and CODEX trigger details', () => {
    const text = read('skills/flow-guide/references/implementation-dispatch.md');
    for (const phrase of [
      'Repository Discovery Gate',
      'anti-rationalization',
      'first-seen query/repository patterns',
      'framework-internal hacks',
      'explicit-rule deferrals',
      'human-approved exception',
    ]) {
      assert.ok(text.includes(phrase), `implementation-dispatch reference missing: ${phrase}`);
    }
  });

  test('tdd-guide forbids shared framework/vendor edits and requires explicit dependency cleanliness proof', () => {
    const text = read('agents/tdd-guide.md');
    for (const phrase of [
      'Do not edit shared framework, vendor, package-manager dependency, or externally mounted framework source',
      'even temporarily',
      'test-local probe',
      'subclass',
      'reflection helper',
      'teardown restoration',
      'non-git dependency paths must be proven clean with explicit evidence',
    ]) {
      assert.ok(text.includes(phrase), `tdd-guide missing: ${phrase}`);
    }
  });

  test('opsx-load-context surfaces hard-rule escalations before routine resume notes', () => {
    const text = read('skills/dhpk-opsx-load-context/SKILL.md');
    const hardRule = text.indexOf('.hard-rule-escalation.md');
    const resumeNote = text.indexOf('.resume-note.md');
    assert.ok(hardRule >= 0, 'missing hard-rule escalation check');
    assert.ok(resumeNote >= 0, 'missing resume-note check');
    assert.ok(hardRule < resumeNote, 'hard-rule escalation check must precede routine resume-note handling');
    assert.ok(text.includes('blocking human decision'), 'missing blocking human decision wording');
  });

  test('POLICY_BUNDLE_ROOT guardrail caveat has one SSOT home with pointers elsewhere', () => {
    // rules-ssot-dedup: the interpolation-token caveat was deduped. The full
    // paragraph lives ONCE in review-gate-mechanics.md; execution-policy.md and
    // execution-checklist/SKILL.md carry a one-line pointer to it instead, and the
    // old keep-in-sync mirror markers are removed. Markers are literal fragments of
    // the paragraph's first and last sentences.
    const SSOT = 'skills/flow-guide/references/review-gate-mechanics.md';
    const pointers = [
      'rules/execution-policy.md',
      'skills/flow-guide/SKILL.md',
    ];
    const marker = '`${POLICY_BUNDLE_ROOT}` is a markdown-interpolation token';
    const endMarker = '`find / -iname`.';
    const carriesFullParagraph = (rel) => {
      const text = read(rel);
      const start = text.indexOf(marker);
      return start >= 0 && text.indexOf(endMarker, start) >= start;
    };
    // The full paragraph must live in exactly one file — the SSOT.
    const carriers = [SSOT, ...pointers].filter(carriesFullParagraph);
    assert.deepStrictEqual(carriers, [SSOT],
      `the full POLICY_BUNDLE_ROOT guardrail paragraph must live only in ${SSOT}, found in: ${carriers.join(', ') || 'none'}`);
    // Each former mirror now points at the SSOT reference file.
    for (const rel of pointers) {
      assert.ok(read(rel).includes('review-gate-mechanics.md'),
        `${rel} must point to the review-gate-mechanics.md SSOT for the POLICY_BUNDLE_ROOT caveat`);
    }
    // The removed keep-in-sync mirror markers must not resurface.
    for (const rel of [SSOT, ...pointers]) {
      assert.ok(!read(rel).includes('— keep in sync -->'),
        `${rel} must not carry the removed keep-in-sync mirror marker`);
    }
  });
}

{
  // F51 source block: tdd-e2e-contracts.test.js
  'use strict';

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

  test('TDD and E2E routing remains distinct and reports stable metadata', () => {
    const policy = read('rules/execution-policy.md');
    const tdd = read('agents/tdd-guide.md');
    const e2e = read('agents/e2e-runner.md');
    assert.ok(policy.includes('RED PHPUnit') && policy.includes('`tdd-guide`'));
    assert.ok(policy.includes('RED Vitest/Jest'), 'dispatch table missing the RED Vitest/Jest row');
    assert.ok(policy.includes('Playwright user journeys') && policy.includes('`e2e-runner`'));
    for (const token of ['Phase: RED|GREEN|REFACTOR', 'Verdict: PASS|WARNING|FAIL', 'coverage_pct', 'Verification command', 'Test files']) {
      assert.ok(tdd.includes(token), `TDD contract missing ${token}`);
    }
    for (const token of ['pass_rate', 'critical_journey', 'retry_count', 'artifact_paths', '95%', 'Verdict: PASS | WARNING | FAIL']) {
      assert.ok(e2e.includes(token), `E2E contract missing ${token}`);
    }
    assert.ok(e2e.includes('never `waitForTimeout`') && !e2e.includes('sleep('), 'E2E contract must forbid sleep polling');
  });

  test('TDD GREEN handback and scoped-loop contract is explicit', () => {
    const tdd = read('agents/tdd-guide.md');
    for (const token of ['≤2 files', 'fast-worker-ready fix-spec', 'scoped verification command', '--filter <TestClass::method>', 'full applicable suite once', 'REFACTOR: skipped (minimal diff)', 'Cross-worker file-collision guard']) {
      assert.ok(tdd.includes(token), `TDD handback contract missing ${token}`);
    }
  });

  test('E2E application-fix handback, seed cleanup, and helper reuse are explicit', () => {
    const e2e = read('agents/e2e-runner.md');
    for (const token of ['fast-worker-ready fix-spec', 're-run the originating journey as acceptance', 'rolled back', 'explicitly deleted in teardown', 'Reuse shared spec helpers']) {
      assert.ok(e2e.includes(token), `E2E boundary contract missing ${token}`);
    }
  });

  test('execution policy routes review and specialist fix-spec batches through fast-worker', () => {
    const policy = read('rules/execution-policy.md');
    for (const token of ['whole fix batch exceeds the ≤2-file inline bound', 'Specialist fix-spec handback', 'ONE consolidated parallel reviewer batch', 'at most once per change']) {
      assert.ok(policy.includes(token), `execution policy missing ${token}`);
    }
  });
}

{
  // F51 source block: cli-worker-timeout-recovery.test.js
  'use strict';

  // Coverage for the harden-cli-worker-mid-batch-timeout change (deterministic,
  // content-level contract checks — the actual ledger derivation, retry
  // dispatch, and marker write are LLM-agent behavior, not scriptable logic, so
  // these tests prove the *documented contract* is present, consistent, and
  // does not collide with retired sentinel/cleanup mechanics, mirroring the
  // style of tests/parallel-dispatch-contract.test.js and
  // tests/reviewer-contract.test.js):
  // - 3.1 wrapper signal classification (cross-referenced; see run-codex.test.js
  //   / run-agy.test.js for the executable wrapper-behavior proof), first-timeout
  //   recovery, confirmed-file exclusion, sibling-edit non-interference, blocked
  //   scope expansion, same-backend retry
  // - 3.2 second-timeout PARTIAL/BLOCKED, report completeness, marker durability
  //   / non-`.pending-*` naming, explicit reconciliation requirement, no cleanup
  //   authority
  // - 3.3 six-file split recommendation, documented override, no worker
  //   self-expansion of scope

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');

  const DISPATCH_DOC = fs.readFileSync(
    path.join(ROOT, 'skills', 'flow-guide', 'references', 'implementation-dispatch.md'),
    'utf8',
  );
  const CODEX_WORKER = fs.readFileSync(path.join(ROOT, 'agents', 'codex-fast-worker.md'), 'utf8');
  const AGY_WORKER = fs.readFileSync(path.join(ROOT, 'agents', 'agy-fast-worker.md'), 'utf8');
  const CODEX_CANONICAL = fs.readFileSync(path.join(ROOT, 'agents', 'codex-worker.md'), 'utf8');
  const AGY_CANONICAL = fs.readFileSync(path.join(ROOT, 'agents', 'agy-worker.md'), 'utf8');
  const CODEX_DEEP_REASONER = fs.readFileSync(path.join(ROOT, 'agents', 'codex-deep-reasoner.md'), 'utf8');
  const CODEX_BRIDGE_AGENT = fs.readFileSync(path.join(ROOT, 'agents', 'codex-bridge.md'), 'utf8');
  const CODEX_BRIDGE_SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'SKILL.md'), 'utf8');
  const EXECUTION_POLICY = fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8');
  const MODEL_ECONOMICS = fs.readFileSync(path.join(ROOT, 'rules', 'model-economics.md'), 'utf8');
  const MODEL_CONFIG_SPEC = fs.readFileSync(path.join(ROOT, 'openspec', 'specs', 'orchestration-model-config', 'spec.md'), 'utf8');

  // 3.1 — CLI worker and alias prompts point at the dispatch SSOT; that SSOT
  // owns the timeout-recovery state machine (exactly one same-backend retry
  // scoped to remaining ∪ unconfirmed, no self-edit, no backend fallback).
  test('worker and alias prompts point at mid-batch timeout recovery instead of forking it', () => {
    for (const [name, doc] of [
      ['codex-fast-worker.md', CODEX_WORKER],
      ['agy-fast-worker.md', AGY_WORKER],
      ['codex-worker.md', CODEX_CANONICAL],
      ['agy-worker.md', AGY_CANONICAL],
    ]) {
      assert.ok(/CLI worker mid-batch timeout recovery/.test(doc),
        `${name} must name the timeout-recovery section`);
      assert.ok(
        /Mid-batch timeout recovery/.test(doc),
        `${name} must identify mid-batch timeout recovery without freezing one heading spelling`,
      );
      const cursorCopy = fs.readFileSync(path.join(ROOT, 'cursor', 'agents', name), 'utf8');
      assert.ok(
        cursorCopy.includes('skills/flow-guide/references/implementation-dispatch.md'),
        `cursor/agents/${name} dropped the timeout-guidance pointer`,
      );
      assert.doesNotMatch(
        cursorCopy,
        /multi-file dispatch, follow\n§CLI worker/i,
        `cursor/agents/${name} must not leave an orphan follow line`,
      );
    }
  });

  test('the dispatch SSOT defines first-timeout scoped same-backend retry with no self-edit / no fallback', () => {
    assert.ok(/exactly one recovery invocation: same backend, same model\/effort/.test(DISPATCH_DOC),
      'dispatch SSOT must bound recovery to exactly one same-backend retry');
    assert.ok(DISPATCH_DOC.includes('remaining ∪ unconfirmed'),
      'dispatch SSOT must scope the retry to remaining ∪ unconfirmed, never repeating confirmed files');
    assert.ok(/never edits the unresolved files inline/.test(DISPATCH_DOC),
      'dispatch SSOT must forbid self-editing unresolved files during recovery');
    assert.ok(/never falls back to another backend because of a timeout/.test(DISPATCH_DOC),
      'dispatch SSOT must forbid backend fallback triggered by a timeout');
  });

  // 3.1 — an immutable runner receipt is the only timeout evidence; ordinary
  // failures and a bare exit code are never classified speculatively.
  test('timeout recovery is gated on contained runner evidence, never a bare exit code', () => {
    assert.ok(DISPATCH_DOC.includes('dhpk.cli.receipt.v1') && DISPATCH_DOC.includes('TIMEOUT'),
      'dispatch SSOT must require a terminal runner receipt as timeout evidence');
    assert.ok(DISPATCH_DOC.includes('uncontained receipt is `BLOCKED`'),
      'dispatch SSOT must fail closed when receipt evidence is unavailable');
  });

  test('all Codex callers use a contained receipt, not the retired timeout envelope', () => {
    assert.ok(DISPATCH_DOC.includes('dhpk.cli.receipt.v1'), 'dispatch policy must name the terminal receipt');
    assert.ok(!DISPATCH_DOC.includes('dhpk.codex.timeout.v1'), 'dispatch policy must not require the retired timeout envelope');
    for (const [name, doc] of [
      ['codex-worker.md', CODEX_CANONICAL],
      ['codex-deep-reasoner.md', CODEX_DEEP_REASONER],
      ['codex-bridge.md', CODEX_BRIDGE_AGENT],
      ['codex-bridge/SKILL.md', CODEX_BRIDGE_SKILL],
    ]) {
      assert.ok(doc.includes('dhpk.cli.receipt.v1'), `${name} must name the contained receipt`);
      assert.ok(!doc.includes('dhpk.codex.timeout.v1'), `${name} must not require the retired timeout envelope`);
      assert.ok(/independent(?:ly)?[^\n]{0,100}(?:diff|verification)|path-scoped diff/i.test(doc),
        `${name} must require independent diff evidence`);
      assert.ok(/not[\s\S]{0,120}(?:DONE|success)|never[\s\S]{0,120}(?:DONE|success)/i.test(doc),
        `${name} must not treat a salvaged report as success`);
    }
    assert.ok(CODEX_WORKER.includes('skills/flow-guide/references/implementation-dispatch.md'),
      'codex-fast-worker.md must point at the dispatch timeout SSOT rather than restating the receipt machine');
  });

  test('single-file Codex callers surface TIMEOUT_SALVAGED or BLOCKED without retry or fallback', () => {
    for (const [name, doc] of [
      ['codex-deep-reasoner.md', CODEX_DEEP_REASONER],
      ['codex-bridge.md', CODEX_BRIDGE_AGENT],
      ['codex-bridge/SKILL.md', CODEX_BRIDGE_SKILL],
    ]) {
      assert.ok(doc.includes('TIMEOUT_SALVAGED'), `${name} must expose TIMEOUT_SALVAGED classification`);
      assert.ok(doc.includes('BLOCKED'), `${name} must expose BLOCKED classification`);
      assert.ok(/no automatic retry|does not retry|no retry/i.test(doc), `${name} must retain no automatic retry`);
      assert.ok(/no backend fallback|never fall back|without backend fallback/i.test(doc), `${name} must retain no backend fallback`);
      assert.ok(/reconcil/i.test(doc), `${name} must require reconciliation after salvage`);
    }
  });

  test('the Codex bridge documents receipt containment, redaction, and no envelope fabrication', () => {
    for (const phrase of ['dhpk.cli.receipt.v1', 'terminal `TIMEOUT`', 'Missing, invalid, or uncontained', 'redacted report']) {
      assert.ok(CODEX_BRIDGE_SKILL.includes(phrase), `codex-bridge skill must document ${phrase}`);
    }
    assert.ok(!CODEX_BRIDGE_SKILL.includes('dhpk.codex.timeout.v1'), 'bridge must not advertise the retired envelope');
    assert.ok(/do not fabricate a timeout envelope/i.test(CODEX_BRIDGE_SKILL), 'bridge must forbid envelope fabrication');
  });

  test('published timeout configuration describes only the attested portable runner, never a shell backstop', () => {
    for (const [name, document] of [
      ['execution-policy.md', EXECUTION_POLICY],
      ['model-economics.md', MODEL_ECONOMICS],
      ['orchestration-model-config spec', MODEL_CONFIG_SPEC],
    ]) {
      assert.ok(!/wrapper[ -]backstop/i.test(document), `${name} must not advertise a shell wrapper backstop`);
      assert.ok(/portable runner|transport runner|runner deadline/i.test(document), `${name} must name the portable runner deadline`);
    }
  });

  // 3.1 — blocked scope expansion: the pre-existing parallel-dispatch scope
  // boundary is unaffected by the new recovery contract — a worker still cannot
  // expand its own scope, in recovery or otherwise.
  test('scope-expansion is still BLOCKED, not silently granted by timeout recovery', () => {
    assert.ok(/A worker that needs another file returns `RESULT: BLOCKED` and names the required scope expansion\./.test(DISPATCH_DOC),
      'the pre-existing scope-expansion BLOCKED contract must remain intact alongside the new timeout-recovery section');
    assert.ok(/the worker itself never expands or splits its own assigned scope/.test(DISPATCH_DOC),
      'the six-file guideline must reaffirm the worker cannot expand its own scope');
  });

  // 3.1 — sibling out-of-scope edits remain observations only, unaffected by the
  // new recovery contract (regression check: the new section must not grant an
  // implicit cleanup or ownership path over sibling files).
  test('sibling out-of-scope edits remain non-cleanup observations under the new contract', () => {
    assert.ok(/must not modify, revert, reset, clean, or force-delete them/.test(DISPATCH_DOC),
      'sibling out-of-scope edits must stay prohibited from any cleanup action');
    for (const doc of [CODEX_WORKER, AGY_WORKER]) {
      assert.ok(!/git checkout|git restore|git reset|git clean/.test(
        doc.slice(doc.indexOf('## Mid-batch timeout recovery'), doc.indexOf('## Verify and report')),
      ), 'the new timeout-recovery section must not introduce any destructive cleanup command');
    }
  });

  // 3.2 — second timeout is terminal: PARTIAL (any confirmed) vs BLOCKED (none
  // confirmed), both timeout observations, all three ledger sets, next action.
  test('second verified timeout is terminal with PARTIAL/BLOCKED split on confirmed-file evidence', () => {
    assert.ok(/verified runner timeout, the worker stops/.test(DISPATCH_DOC),
      'dispatch SSOT must make a second verified timeout terminal');
    assert.ok(/RESULT: PARTIAL` \(at least one assigned file confirmed\)/.test(DISPATCH_DOC),
      'dispatch SSOT must define PARTIAL as at-least-one-confirmed');
    assert.ok(/RESULT: BLOCKED` \(none confirmed\)/.test(DISPATCH_DOC),
      'dispatch SSOT must define BLOCKED as none-confirmed');
    assert.ok(/naming both timeout observations/.test(DISPATCH_DOC),
      'dispatch SSOT must require both timeout observations, ledger sets, and next action in the terminal report');
  });

  // Generated marker naming and behavior are owned by
  // tests/partial-writer-handoff.test.js. This suite retains the independent
  // documentation contract below.

  test('the marker path, required fields, and reconciliation/no-auto-resolve rule are documented', () => {
    assert.ok(DISPATCH_DOC.includes(
      '.claude/artifacts/sessions/.partial-cli-batch-<backend>-<session-id>-<dispatch-id>.json',
    ), 'the exact control-plane marker path must be documented verbatim');
    for (const field of ['backend', 'session/dispatch identity', 'assigned', 'confirmed', 'remaining', 'unconfirmed', 'next action']) {
      assert.ok(DISPATCH_DOC.includes(field), `marker required-field list must name '${field}'`);
    }
    assert.ok(/is not automatically resolved by the worker or by a reviewer/.test(DISPATCH_DOC),
      'marker must be documented as not automatically resolved (no cleanup authority)');
    assert.ok(/until a human or the orchestrator explicitly reconciles it/.test(DISPATCH_DOC),
      'marker must require explicit human/orchestrator reconciliation');
    assert.ok(/not itself a Review Gate verdict or approval/.test(DISPATCH_DOC),
      'marker must be explicitly distinguished from Review Gate approval');
  });

  // 3.3 — six-file starting guideline with a documented override, and no
  // self-expansion of scope even for an intentionally larger batch.
  test('the six-file starting guideline requires a recorded override, never self-expansion', () => {
    assert.ok(/more than six assigned product files/.test(DISPATCH_DOC),
      'must name the six-file starting guideline threshold');
    assert.ok(/six is an unmeasured starting point, not a wrapper or CLI setting/.test(DISPATCH_DOC),
      'must document six as a tunable guideline, not a hard-coded protocol limit');
    assert.ok(/override reason recorded in the dispatch record and the worker's report/.test(DISPATCH_DOC),
      'an intentionally larger batch must require a recorded override reason');
    assert.ok(/the worker itself never expands or splits its own assigned scope/.test(DISPATCH_DOC),
      'the worker must never expand or split its own assigned scope, even under the override');
  });
}

{
  // F51 source block: parallel-dispatch-contract.test.js
  'use strict';

  // Coverage for the harden-parallel-dispatch-worker-boundaries change:
  // - 1.3 workers/wrappers carry no destructive out-of-scope cleanup authority
  // - 1.4 the dispatch table distinguishes judgment-dense (>=3 files) work from
  //   purely mechanical CLI work, small inline work, and open-ended reasoning
  // - 3.2 scripts/ci/validate-skills.js has no scoped mode and never writes the
  //   shared skill-size-allowlist.json itself, so a worker must report rather
  //   than self-edit the ratchet — proven from the actual script source
  // - 4.2 reviewer sentinel derivation for an assigned edited-file list matches
  //   normal (non-parallel) hook-driven sentinel arming, unaffected by a
  //   sibling's own armed sentinel in the same shared checkout

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const { mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

  const ROOT = path.join(__dirname, '..');
  const FORBIDDEN_CLEANUP = ['git checkout', 'git restore', 'git reset', 'git clean'];

  // 1.3 — worker/wrapper contract carries no destructive cleanup authority.
  test('fast-worker and codex-fast-worker prompts explicitly forbid out-of-scope cleanup commands', () => {
    for (const file of ['fast-worker.md', 'codex-fast-worker.md']) {
      const prompt = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
      for (const cmd of FORBIDDEN_CLEANUP) {
        assert.ok(prompt.includes(cmd), `${file} must name '${cmd}' as prohibited against out-of-scope paths`);
      }
      assert.ok(/forceful deletion|force-delet/i.test(prompt), `${file} must prohibit forceful deletion of out-of-scope paths`);
    }
  });

  test('the shared codex wrapper script contains no forbidden cleanup invocation against sibling files', () => {
    const wrapper = fs.readFileSync(
      path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'scripts', 'run-codex.sh'),
      'utf8'
    );
    for (const cmd of FORBIDDEN_CLEANUP) {
      assert.ok(!wrapper.includes(cmd), `run-codex.sh must never itself invoke '${cmd}'`);
    }
    // The wrapper owns one private request file and removes it with `rm -f` on
    // exit. Recursive deletion would broaden cleanup authority unnecessarily.
    assert.match(wrapper, /trap 'rm -f "\$REQUEST_FILE"' EXIT/);
    assert.doesNotMatch(wrapper, /rm\s+-rf\b/);
  });

  // 1.4 — routing fixtures distinguishing judgment-dense (>=3 files) work from
  // mechanical CLI work, small inline work, and open-ended reasoning work.
  test('the dispatch table names four distinguishable implement-phase routing tiers', () => {
    const dispatchDoc = fs.readFileSync(
      path.join(ROOT, 'skills', 'flow-guide', 'references', 'implementation-dispatch.md'),
      'utf8'
    );
    const policyDoc = fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8');

    // Purely mechanical, spec-exact CLI work.
    assert.ok(/Mechanical with a clear spec/i.test(policyDoc), 'policy must name the purely mechanical tier');
    // Judgment-dense but standardizable, >=3 files, in-process fast-worker default.
    assert.ok(/Judgment-dense but standardizable work touching more than two files/i.test(policyDoc),
      'policy must name the judgment-dense (>2 files) tier as distinct from purely mechanical work');
    assert.ok(/Judgment-Dense Standardizable Batch/.test(dispatchDoc) || /Judgment-Dense Standardizable Batch/.test(policyDoc),
      'the Judgment-Dense Standardizable Batch term must be defined');
    assert.ok(/at least three files/i.test(policyDoc) || /three or more files/i.test(policyDoc),
      'the judgment-dense tier must state its >=3-file bound');
    // Small inline work.
    assert.ok(/Small diff \(roughly ≤2 files/i.test(policyDoc), 'policy must name the small/inline tier');
    // Open-ended reasoning work.
    assert.ok(/Reasoning-heavy \(unknown root cause/i.test(policyDoc), 'policy must name the reasoning-heavy tier');

    // The four tiers must resolve to distinct dispatch targets, not the same route.
    const mechanicalRow = policyDoc.match(/Mechanical with a clear spec[^\n|]*\|\s*`([^`]+)`/);
    const judgmentRow = policyDoc.match(/Judgment-dense but standardizable[^\n|]*\|\s*([^\n|]+)/);
    const smallRow = policyDoc.match(/Small diff \(roughly ≤2 files[^\n|]*\|\s*([^\n|]+)/);
    const reasoningRow = policyDoc.match(/Reasoning-heavy \(unknown root cause[^\n|]*\|\s*`([^`]+)`/);
    assert.ok(mechanicalRow && judgmentRow && smallRow && reasoningRow, 'all four routing rows must be present in the dispatch table');
    assert.ok(!judgmentRow[1].includes('deep-reasoner'), 'judgment-dense work must not route to deep-reasoner');
    assert.ok(!smallRow[1].includes('fast-worker'), 'small inline work must not route to a fast-worker dispatch');
    assert.ok(!reasoningRow[1].includes('fast-worker'), 'reasoning-heavy work must not route to a fast-worker dispatch');
    assert.notStrictEqual(mechanicalRow[1].trim(), reasoningRow[1].trim(), 'mechanical and reasoning-heavy tiers must be distinguishable');
    assert.notStrictEqual(judgmentRow[1].trim(), reasoningRow[1].trim(), 'judgment-dense and reasoning-heavy tiers must be distinguishable');
    assert.notStrictEqual(smallRow[1].trim(), mechanicalRow[1].trim(), 'small-inline and mechanical tiers must be distinguishable');
  });

  // 3.2 — exercise the whole-tree validator through a disposable mini-repo. A
  // plausible scoped implementation must not skip an invalid sibling when a
  // caller supplies the path of a valid skill.
  function makeSkillValidatorRepo() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-skills-mini-')));
    const ci = path.join(root, 'scripts', 'ci');
    fs.mkdirSync(path.join(ci, '_lib'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'scripts', 'ci', 'validate-skills.js'),
      path.join(ci, 'validate-skills.js'),
    );
    fs.cpSync(path.join(ROOT, 'scripts', 'ci', '_lib'), path.join(ci, '_lib'), { recursive: true });
    fs.writeFileSync(
      path.join(ci, 'skill-size-allowlist.json'),
      '{"seed":{},"allowed":[]}\n',
    );
    return root;
  }

  function writeSkillFixture(root, relativePath, content) {
    const directory = path.join(root, relativePath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), content);
  }

  function runSkillValidator(root, args = []) {
    return spawnSync(process.execPath, [path.join(root, 'scripts', 'ci', 'validate-skills.js'), ...args], {
      cwd: root,
      env: { ...process.env },
      encoding: 'utf8',
    });
  }

  test('validate-skills.js has no path-scoped/subset mode (whole-tree only, so a worker cannot safely self-invoke it)', () => {
    const root = makeSkillValidatorRepo();
    try {
      writeSkillFixture(root, 'skills/selected-valid', '---\nname: selected-valid\ndescription: Valid fixture.\n---\n\n# Guide\n');
      writeSkillFixture(root, 'skills/unselected-invalid', '---\nname: unselected-invalid\nfixture-only-key: invalid\n---\n\n# Guide\n');

      const result = runSkillValidator(root, ['skills/selected-valid']);
      const output = result.stdout + result.stderr;
      assert.strictEqual(result.status, 1, output);
      assert.match(output, /skills[\\/]unselected-invalid[\\/]SKILL\.md.*unknown frontmatter key/i,
        'a supplied skill path must not hide an invalid sibling from the whole-tree scan');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('validate-skills.js never writes the shared skill-size-allowlist.json (read-only ratchet consumer)', () => {
    const root = makeSkillValidatorRepo();
    try {
      writeSkillFixture(root, 'skills/valid', '---\nname: valid\ndescription: Valid fixture.\n---\n\n# Guide\n');
      const allowlistPath = path.join(root, 'scripts', 'ci', 'skill-size-allowlist.json');
      const before = fs.readFileSync(allowlistPath);
      const result = runSkillValidator(root);
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      const after = fs.readFileSync(allowlistPath);
      assert.deepStrictEqual(after, before,
        'the read-only validator must leave every allowlist byte unchanged');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('the shared-state contract requires reporting a missing scoped validator rather than inventing a global mutation', () => {
    const dispatchDoc = fs.readFileSync(
      path.join(ROOT, 'skills', 'flow-guide', 'references', 'implementation-dispatch.md'),
      'utf8'
    );
    assert.ok(/dispatcher-provided scoped or no-write equivalent/i.test(dispatchDoc),
      'must require a dispatcher-provided scoped/no-write equivalent before a worker touches shared ratchet state');
    assert.ok(/must not invoke a global read-modify-write path/i.test(dispatchDoc),
      'must forbid a worker from inventing a global mutation path when no scoped equivalent exists');
  });

  // 4.2 — reviewer sentinel derivation for an assigned edited-file list matches
  // normal hook-driven sentinel arming, and a sibling's own sentinel neither
  // suppresses nor is conflated with it.
}

{
  // F51 source block: legacy-cli-role-agent-contract.test.js
  'use strict';

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const DISPATCH_SKILL = 'skills/dhpk-cli-dispatch-context/SKILL.md';
  const TIMEOUT_GUIDANCE = 'skills/flow-guide/references/implementation-dispatch.md';
  const CONTRACTS = Object.freeze([
    Object.freeze({
      alias: 'codex-fast-worker.md',
      canonical: 'codex-worker.md',
      requestedRole: 'codex-fast-worker',
      effectiveRole: 'codex-worker',
      provider: 'codex',
      mode: 'workspace-write',
    }),
    Object.freeze({
      alias: 'agy-fast-worker.md',
      canonical: 'agy-worker.md',
      requestedRole: 'agy-fast-worker',
      effectiveRole: 'agy-worker',
      provider: 'agy',
      mode: 'workspace-write',
    }),
    Object.freeze({
      alias: 'codex-deep-reasoner.md',
      canonical: 'codex-reasoner.md',
      requestedRole: 'codex-deep-reasoner',
      effectiveRole: 'codex-reasoner',
      provider: 'codex',
      mode: 'read-only',
    }),
  ]);

  function readAgent(file) {
    return fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
  }

  function readCursorAgent(file) {
    return fs.readFileSync(path.join(ROOT, 'cursor', 'agents', file), 'utf8');
  }

  function metadata(prompt, field) {
    const match = prompt.match(new RegExp(`^${field}: (.+)$`, 'm'));
    assert.ok(match, `${field} metadata missing`);
    return match[1];
  }

  test('legacy role aliases retain the host capabilities of their canonical roles', () => {
    for (const contract of CONTRACTS) {
      const alias = readAgent(contract.alias);
      const canonical = readAgent(contract.canonical);
      assert.strictEqual(
        metadata(alias, 'tools'),
        metadata(canonical, 'tools'),
        `${contract.alias} must preserve canonical executable tools`,
      );
      if (/^skills:/m.test(canonical)) {
        assert.strictEqual(
          metadata(alias, 'skills'),
          metadata(canonical, 'skills'),
          `${contract.alias} must preserve canonical workflow skills`,
        );
      }
    }
  });

  test('legacy role aliases forward explicit identity and mode through the dispatch skill', () => {
    for (const contract of CONTRACTS) {
      const alias = readAgent(contract.alias);
      for (const expected of [
        DISPATCH_SKILL,
        `requested_role=${contract.requestedRole}`,
        `effective_role=${contract.effectiveRole}`,
        contract.provider,
        contract.mode,
      ]) {
        assert.ok(alias.includes(expected), `${contract.alias} missing launcher contract: ${expected}`);
      }
      assert.doesNotMatch(
        alias,
        /launch-cli-dispatch\.js \\\s*\n\s*--dispatching-agent/,
        `${contract.alias} must not paste the launcher flag block`,
      );
      const cursorCopy = readCursorAgent(contract.alias);
      assert.ok(
        cursorCopy.includes(DISPATCH_SKILL),
        `cursor/agents/${contract.alias} dropped the dispatch-skill pointer`,
      );
      assert.doesNotMatch(
        cursorCopy,
        /launch the provider, follow\nDo not paste/i,
        `cursor/agents/${contract.alias} must not leave an orphan follow line`,
      );
    }
  });

  test('AGY compatibility keeps the dispatching agent distinct from the execution provider', () => {
    const alias = readAgent('agy-fast-worker.md');
    assert.match(alias, /dispatching agent may be Codex/i);
    assert.match(alias, /does not change the execution provider\s+from AGY/i);
    assert.match(alias, /bind provider `agy`/);
    assert.ok(alias.includes(DISPATCH_SKILL), 'agy-fast-worker.md missing dispatch-skill pointer');
  });

  test('legacy worker aliases retain independent verification after backend execution', () => {
    for (const file of ['codex-fast-worker.md', 'agy-fast-worker.md']) {
      const alias = readAgent(file);
      assert.match(alias, /selected backend is not completion evidence/i);
      assert.match(alias, /independently run the assigned verification command/i);
    }
    assert.match(
      readAgent('codex-deep-reasoner.md'),
      /independently verify every cited\s+file:line against the working tree/i,
    );
  });

  test('CLI worker and alias roles point at mid-batch timeout guidance', () => {
    for (const file of [
      'codex-fast-worker.md',
      'agy-fast-worker.md',
      'codex-worker.md',
      'agy-worker.md',
    ]) {
      const text = readAgent(file);
      assert.ok(
        text.includes(TIMEOUT_GUIDANCE),
        `${file} missing implementation-dispatch timeout pointer`,
      );
      assert.match(
        text,
        /CLI worker mid-batch timeout recovery/,
        `${file} must name the timeout-recovery section`,
      );
    }
  });
}

run('opsx-orchestration-decision-policy');
