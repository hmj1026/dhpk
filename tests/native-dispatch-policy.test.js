'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  DEFAULT_CROSS_PROVIDER,
  FAILURE_CLASSES,
  ROLE_POLICY,
  createFallbackState,
  resolveFallbackDecision,
  resolveDispatchPlan,
} = require('../scripts/lib/native-dispatch-policy');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');
const providerCatalog = require('../manifests/provider-model-catalog.json');

const ROOT = path.join(__dirname, '..');

test('all delegated roles share the native-only default dispatch plan', () => {
  assert.strictEqual(DEFAULT_CROSS_PROVIDER, false);

  for (const role of ['planner', 'reasoner', 'worker', 'reviewer']) {
    const plan = resolveDispatchPlan({
      role,
      requestedBackend: 'auto',
      configuredOrder: ['codex', 'agy', 'claude'],
    });

    assert.deepStrictEqual(plan, {
      role,
      native_backend: 'claude',
      requested_backend: 'auto',
      candidate_scope: 'native-only',
      candidates: ['claude'],
      suppressed_candidates: [
        { backend: 'codex', reason: 'cross-provider disabled' },
        { backend: 'agy', reason: 'cross-provider disabled' },
      ],
      native_agent: ROLE_POLICY[role].native_agent,
    });
  }
});

test('explicit targets remain directional while automatic cross-provider expansion stays opt-in', () => {
  assert.deepStrictEqual(resolveDispatchPlan({
    role: 'worker',
    requestedBackend: 'codex',
    configuredOrder: ['claude', 'codex', 'agy'],
  }), {
    role: 'worker',
    native_backend: 'claude',
    requested_backend: 'codex',
    candidate_scope: 'explicit',
    candidates: ['codex'],
    suppressed_candidates: [],
    native_agent: 'dhpk:fast-worker',
  });

  assert.deepStrictEqual(resolveDispatchPlan({
    role: 'reasoner',
    requestedBackend: 'auto',
    configuredOrder: ['claude', 'codex', 'agy'],
    crossProvider: true,
  }), {
    role: 'reasoner',
    native_backend: 'claude',
    requested_backend: 'auto',
    candidate_scope: 'cross-provider',
    candidates: ['claude', 'codex', 'agy'],
    suppressed_candidates: [],
    native_agent: 'dhpk:deep-reasoner',
  });
});

test('unknown roles fail closed before a dispatch plan can be created', () => {
  assert.throws(
    () => resolveDispatchPlan({ role: 'architect', requestedBackend: 'auto' }),
    /unknown delegated role: architect/,
  );
});

test('delegated role definitions point to the shared native dispatch policy', () => {
  for (const role of ['planner', 'deep-reasoner', 'fast-worker', 'code-reviewer']) {
    const document = fs.readFileSync(path.join(ROOT, 'agents', `${role}.md`), 'utf8');
    assert.ok(document.includes('Native dispatch baseline'), `${role} missing native dispatch policy reference`);
    assert.ok(document.includes('${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md'), `${role} missing execution policy reference`);
  }
});

test('fallback decisions are native-first, role-preserving, and opt-in for other providers', () => {
  const state = createFallbackState({ retryBudget: 2 });
  const handoff = {
    mode: 'workspace-write',
    assigned_files: ['src/a.js'],
    review_contract: 'required-code-review',
  };

  const result = resolveFallbackDecision({
    role: 'worker',
    selectedBackend: 'codex',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: false,
    failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
    sideEffects: 'none',
    state,
    handoff,
  });

  assert.deepStrictEqual(result, {
    status: 'fallback',
    action: 'dispatch',
    role: 'worker',
    native_agent: 'dhpk:fast-worker',
    requested_backend: 'codex',
    resolved_backend: 'claude',
    failure_class: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE',
    fallback_reason: 'codex unavailable without confirmed side effects; native fallback selected',
    retry_budget_remaining: 1,
    candidate_scope: 'native-only',
    handoff,
    next_state: {
      retry_budget: 1,
      attempted_backends: ['codex'],
      unavailable_backends: ['codex'],
    },
  });
});

test('cross-provider fallback remembers unavailable targets and never loops or resets the budget', () => {
  const first = resolveFallbackDecision({
    role: 'reviewer',
    selectedBackend: 'codex',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    state: createFallbackState({ retryBudget: 2 }),
  });
  assert.strictEqual(first.resolved_backend, 'claude');
  assert.strictEqual(first.retry_budget_remaining, 1);

  const second = resolveFallbackDecision({
    role: 'reviewer',
    selectedBackend: 'claude',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    state: {
      ...first.next_state,
      unavailable_backends: [...first.next_state.unavailable_backends, 'claude'],
    },
  });
  assert.strictEqual(second.resolved_backend, 'agy');
  assert.strictEqual(second.retry_budget_remaining, 0);
  assert.deepStrictEqual(second.next_state.attempted_backends, ['codex', 'claude']);
  assert.deepStrictEqual(second.next_state.unavailable_backends, ['codex', 'claude']);

  const exhausted = resolveFallbackDecision({
    role: 'reviewer',
    selectedBackend: 'agy',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
    sideEffects: 'none',
    state: second.next_state,
  });
  assert.strictEqual(exhausted.status, 'blocked');
  assert.strictEqual(exhausted.action, 'stop');
  assert.strictEqual(exhausted.retry_budget_remaining, 0);
});

test('failure classes that are not availability failures stop without provider switching', () => {
  for (const [failureClass, action] of [
    [FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT, 'stop'],
    [FAILURE_CLASSES.SAFETY_OR_USER_DENIAL, 'stop'],
    [FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE, 'repair'],
    [FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION, 'reconcile'],
  ]) {
    const result = resolveFallbackDecision({
      role: 'worker',
      selectedBackend: 'codex',
      nativeBackend: 'claude',
      configuredOrder: ['codex', 'agy', 'claude'],
      crossProvider: true,
      failureClass,
      sideEffects: 'unknown',
      state: createFallbackState({ retryBudget: 3 }),
    });
    assert.strictEqual(result.status, 'blocked', failureClass);
    assert.strictEqual(result.action, action, failureClass);
    assert.strictEqual(result.resolved_backend, 'codex', failureClass);
    assert.strictEqual(result.retry_budget_remaining, 3, failureClass);
  }
});

test('quota fallback requires cross-provider opt-in and avoids the affected pool', () => {
  const result = resolveFallbackDecision({
    role: 'worker',
    selectedBackend: 'codex',
    nativeBackend: 'claude',
    configuredOrder: ['codex', 'agy', 'claude'],
    crossProvider: true,
    failureClass: FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT,
    affectedPool: 'account-a',
    candidatePools: { codex: 'account-a', claude: 'account-a', agy: 'account-b' },
    state: createFallbackState({ retryBudget: 2 }),
  });

  assert.strictEqual(result.status, 'fallback');
  assert.strictEqual(result.resolved_backend, 'agy');
  assert.strictEqual(result.retry_budget_remaining, 1);
  assert.deepStrictEqual(result.next_state.unavailable_backends, ['codex']);

  const unverifiedPool = resolveFallbackDecision({
    role: 'worker',
    selectedBackend: 'codex',
    crossProvider: true,
    failureClass: FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT,
    affectedPool: 'account-a',
    state: createFallbackState({ retryBudget: 2 }),
  });
  assert.strictEqual(unverifiedPool.status, 'blocked');
});

test('the fallback contract exposes the six canonical failure classes', () => {
  assert.deepStrictEqual(Object.values(FAILURE_CLASSES), [
    'CLI_UNAVAILABLE',
    'AUTHENTICATION_OR_MODEL_UNAVAILABLE',
    'QUOTA_OR_RATE_LIMIT',
    'SAFETY_OR_USER_DENIAL',
    'TASK_OR_SEMANTIC_FAILURE',
    'TIMEOUT_OR_INTERRUPTION',
  ]);
});

test('v2 requests use Host profile and Provider-scoped target resolution through the policy seam', () => {
  const request = {
    schema: SCHEMAS.REQUEST,
    host_profile: {
      schema: SCHEMAS.HOST_PROFILE, version: 'cursor-policy.v2', host: 'cursor', native_target_agent: 'cursor', native_provider: 'cursor', native_model: 'composer-2.5', native_transport: 'native-runtime',
      allowed_providers: ['cursor', 'openai'],
      access: {
        cursor: { status: 'AVAILABLE', evidence: 'native ready' },
        openai: { status: 'AVAILABLE', evidence: 'CLI ready' },
      },
      quota_pools: { cursor: 'native', openai: 'codex' }, concurrency_limits: { native: 1, codex: 1 }, observed_at: '2026-09-11T00:00:00.000Z',
    },
    task_id: 'policy-v2-task', attempt_id: 'policy-v2-attempt', role: 'reasoner', authority: 'read-only',
    task: { description_digest: 'a'.repeat(64) }, scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', transport: 'native-runtime' }, effort: 'high',
    fallback: { allow: true, retry_budget: 1 }, parallelism: { dependencies: [], max_concurrency: 1 },
  };
  const plan = resolveDispatchPlan({ request, catalog: providerCatalog });
  assert.strictEqual(plan.status, 'RESOLVED');
  assert.strictEqual(plan.target.identity, 'codex-cli/gpt-5.6-sol-high');
  assert.strictEqual(plan.request.role, 'reasoner');
});

{
  // Source suite: native-fallback-contract.
  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    FAILURE_CLASSES,
    createFallbackState,
    resolveFallbackDecision,
  } = require('../scripts/lib/native-dispatch-policy');

  const ROOT = path.join(__dirname, '..');
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const normalize = (value) => value.replace(/\s+/g, ' ').trim();
  const FALLBACK_CASES = [
    {
      name: 'CLI unavailable',
      failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
      sideEffects: 'none',
      expectedStatus: 'fallback',
      expectedAction: 'dispatch',
      expectedBackend: 'claude',
    },
    {
      name: 'authentication or model unavailable',
      failureClass: FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
      sideEffects: 'none',
      expectedStatus: 'fallback',
      expectedAction: 'dispatch',
      expectedBackend: 'claude',
    },
    {
      name: 'quota or rate limit',
      failureClass: FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT,
      sideEffects: 'none',
      affectedPool: 'pool-a',
      candidatePools: { codex: 'pool-a', claude: 'pool-a', agy: 'pool-b' },
      expectedStatus: 'fallback',
      expectedAction: 'dispatch',
      expectedBackend: 'agy',
    },
    {
      name: 'safety or user denial',
      failureClass: FAILURE_CLASSES.SAFETY_OR_USER_DENIAL,
      sideEffects: 'unknown',
      expectedStatus: 'blocked',
      expectedAction: 'stop',
      expectedBackend: 'codex',
    },
    {
      name: 'task or semantic failure',
      failureClass: FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE,
      sideEffects: 'unknown',
      expectedStatus: 'blocked',
      expectedAction: 'repair',
      expectedBackend: 'codex',
    },
    {
      name: 'timeout or interruption',
      failureClass: FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION,
      sideEffects: 'unknown',
      expectedStatus: 'blocked',
      expectedAction: 'reconcile',
      expectedBackend: 'codex',
    },
  ];

  function section(document, heading) {
    const headingStart = document.indexOf(`${heading}\n`);
    assert.notStrictEqual(headingStart, -1, `missing section ${heading}`);
    const contentStart = headingStart + heading.length + 1;
    const level = heading.match(/^#+/)[0].length;
    const nextHeading = document.slice(contentStart).search(new RegExp(`^#{1,${level}}\\s`, 'm'));
    return nextHeading === -1
      ? document.slice(contentStart)
      : document.slice(contentStart, contentStart + nextHeading);
  }

  const FAILURE_POLICY_ROWS = [
    '| `CLI_UNAVAILABLE` | Continue to the native candidate after confirming the selected CLI is unavailable; use the next configured candidate only with cross-provider opt-in. | Confirm no provider side effect. |',
    '| `AUTHENTICATION_OR_MODEL_UNAVAILABLE` | Same native-first rule as CLI unavailability when the failed target is confirmed unavailable without side effects. | Preserve the exact auth/model evidence. |',
    '| `QUOTA_OR_RATE_LIMIT` | Avoid the affected model/account/pool; select an explicitly different authorized pool only with cross-provider opt-in. | Do not infer that every provider is exhausted. |',
    '| `SAFETY_OR_USER_DENIAL` | Do not switch providers to evade the restriction or denial. | Stop and use the existing authorization/user-action path. |',
    '| `TASK_OR_SEMANTIC_FAILURE` | Do not switch providers. | Return to the existing repair and acceptance path. |',
    '| `TIMEOUT_OR_INTERRUPTION` | Do not switch providers as a timeout retry. | Stop the old writer, reconcile assigned scope and diff, then use the partial-writer handoff contract. |',
  ];

  test('shared fallback contract is table-driven across all failure classes', () => {
    for (const scenario of FALLBACK_CASES) {
      const handoff = {
        task_scope: 'issue-421-contract',
        write_authority: 'existing-writer',
        review_obligation: 'required',
      };
      const decision = resolveFallbackDecision({
        role: 'worker',
        selectedBackend: 'codex',
        nativeBackend: 'claude',
        configuredOrder: ['codex', 'claude', 'agy'],
        crossProvider: true,
        failureClass: scenario.failureClass,
        sideEffects: scenario.sideEffects,
        affectedPool: scenario.affectedPool,
        candidatePools: scenario.candidatePools,
        state: createFallbackState({ retryBudget: 3 }),
        handoff,
      });

      assert.strictEqual(decision.status, scenario.expectedStatus, scenario.name);
      assert.strictEqual(decision.action, scenario.expectedAction, scenario.name);
      assert.strictEqual(decision.resolved_backend, scenario.expectedBackend, scenario.name);
      assert.deepStrictEqual(decision.handoff, handoff, scenario.name);
      assert.deepStrictEqual(decision.next_state.attempted_backends, ['codex'], scenario.name);
      assert.strictEqual(
        decision.retry_budget_remaining,
        scenario.expectedStatus === 'fallback' ? 2 : 3,
        scenario.name,
      );
    }
  });

  test('shared fallback contract preserves every delegated role and handoff scope', () => {
    const roles = [
      ['planner', 'dhpk:planner'],
      ['reasoner', 'dhpk:deep-reasoner'],
      ['worker', 'dhpk:fast-worker'],
      ['reviewer', 'dhpk:code-reviewer'],
    ];
    for (const [role, nativeAgent] of roles) {
      const decision = resolveFallbackDecision({
        role,
        selectedBackend: 'codex',
        failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
        sideEffects: 'none',
        crossProvider: false,
        handoff: { task_scope: 'same-scope', review_obligation: 'preserve' },
      });
      assert.strictEqual(decision.native_agent, nativeAgent, role);
      assert.strictEqual(decision.resolved_backend, 'claude', role);
      assert.deepStrictEqual(decision.handoff, { task_scope: 'same-scope', review_obligation: 'preserve' }, role);
    }
  });

  test('canonical policy documents all failure classes and state invariants', () => {
    const policy = section(read('rules/execution-policy.md'), '### Failure classification and fallback chain');
    const dispatch = section(read('skills/flow-guide/references/implementation-dispatch.md'), '## Native-first fallback');
    const policyRows = policy.split('\n').filter((line) => line.startsWith('| `'));

    assert.deepStrictEqual(policyRows, FAILURE_POLICY_ROWS);
    assert.ok(normalize(policy).includes(
      'A session records `attempted_backends` and `unavailable_backends` and decrements one shared `retry_budget` for every fallback; switching providers does not reset that budget and a candidate is never revisited.',
    ));
    assert.ok(normalize(policy).includes(
      'The fallback preserves the role, task scope, read/write authority, model contract where applicable, and reviewer contract.',
    ));
    assert.ok(normalize(dispatch).includes(
      'Transport does not perform this selection, retry, or provider switch. It returns one of these canonical classes: `CLI_UNAVAILABLE`, `AUTHENTICATION_OR_MODEL_UNAVAILABLE`, `QUOTA_OR_RATE_LIMIT`, `SAFETY_OR_USER_DENIAL`, `TASK_OR_SEMANTIC_FAILURE`, or `TIMEOUT_OR_INTERRUPTION`.',
    ));
    assert.ok(normalize(dispatch).includes(
      'The session carries `attempted_backends`, `unavailable_backends`, and one shared `retry_budget`. Every fallback consumes one unit, switching providers does not reset it, and unavailable candidates are not probed again.',
    ));
  });

  test('delegated role documents inherit fallback policy without changing contracts', () => {
    const roleFailureEvidence = [
      ['CLI_UNAVAILABLE', 'confirmed CLI or auth/model unavailability with no side effect'],
      ['AUTHENTICATION_OR_MODEL_UNAVAILABLE', 'confirmed CLI or auth/model unavailability with no side effect'],
      ['QUOTA_OR_RATE_LIMIT', 'Quota/rate-limit'],
      ['SAFETY_OR_USER_DENIAL', 'safety/user denial'],
      ['TASK_OR_SEMANTIC_FAILURE', 'task/semantic failure'],
      ['TIMEOUT_OR_INTERRUPTION', 'timeout/interruption'],
    ];
    const delegatedRoles = [
      {
        name: 'planner',
        heading: '## Native dispatch boundary',
        dispatcherOwnership: 'Fallback is also dispatcher-owned and shared by every delegated role.',
        availabilityAction: 'same planning contract to the native planner first',
        classActionStatement: 'Quota/rate-limit, safety/user denial, task/semantic failure, and timeout/interruption retain their existing stop, authorization, repair, or reconciliation paths.',
        crossProvider: 'cross-provider candidates require explicit opt-in',
        noSilentSwitch: 'never silently switches target',
      },
      {
        name: 'deep-reasoner',
        heading: '## Native dispatch boundary',
        dispatcherOwnership: 'Fallback is dispatcher-owned and shared by every delegated role.',
        availabilityAction: 'read-only reasoning contract to the native reasoner first',
        classActionStatement: 'Quota/rate-limit, safety/user denial, task/semantic failure, and timeout/interruption retain their existing stop, authorization, repair, or reconciliation paths.',
        crossProvider: 'cross-provider candidates require explicit opt-in',
        noSilentSwitch: 'never silently switches target',
      },
      {
        name: 'fast-worker',
        heading: '## Native-first fallback contract',
        dispatcherOwnership: 'the dispatcher selects the next target',
        availabilityAction: 'goes to the native worker first',
        noSilentSwitch: 'never silently switch or retry from inside the worker',
        classActions: [
          ['QUOTA_OR_RATE_LIMIT', 'Quota/rate-limit fallback requires an explicitly different authorized pool and cross-provider opt-in.'],
          ['SAFETY_OR_USER_DENIAL', 'Safety/user denial stays on authorization'],
          ['TASK_OR_SEMANTIC_FAILURE', 'task/semantic failure stays on repair'],
          ['TIMEOUT_OR_INTERRUPTION', 'timeout/interruption requires the partial-writer reconciliation contract'],
        ],
      },
      {
        name: 'code-reviewer',
        heading: '## Native dispatch boundary',
        dispatcherOwnership: 'Fallback is dispatcher-owned and shared by every delegated role.',
        availabilityAction: 'request to the native reviewer first',
        classActionStatement: 'Quota/rate-limit, safety/user denial, task/semantic failure, and timeout/interruption retain their existing stop, authorization, repair, or reconciliation paths.',
        crossProvider: 'cross-provider candidates require explicit opt-in',
        noSilentSwitch: 'never silently switches target',
      },
    ];

    for (const role of delegatedRoles) {
      const content = normalize(section(read(`agents/${role.name}.md`), role.heading));
      assert.ok(content.toLowerCase().includes(role.dispatcherOwnership.toLowerCase()), `${role.name} dispatcher ownership`);
      assert.ok(content.toLowerCase().includes(role.availabilityAction.toLowerCase()), `${role.name} availability action`);
      for (const [failureClass, description] of roleFailureEvidence) {
        assert.ok(content.toLowerCase().includes(description.toLowerCase()), `${role.name} missing ${failureClass} policy text`);
      }
      if (role.classActionStatement) {
        assert.ok(content.toLowerCase().includes(role.classActionStatement.toLowerCase()), `${role.name} missing class/action statement`);
        assert.ok(content.toLowerCase().includes(role.crossProvider.toLowerCase()), `${role.name} missing cross-provider gate`);
      }
      for (const [failureClass, action] of role.classActions || []) {
        assert.ok(content.toLowerCase().includes(action.toLowerCase()), `${role.name} missing ${failureClass} action`);
      }
      assert.ok(content.toLowerCase().includes(role.noSilentSwitch.toLowerCase()), `${role.name} may not switch targets`);
    }

    const cliRoleSections = [
      ['codex-worker', '## Backend availability (check first — never simulate)'],
      ['agy-worker', '## Backend availability (check first — never simulate)'],
      ['codex-reasoner', '## Backend availability (check first — never simulate)'],
      ['codex-deep-reasoner', '## Forward through the canonical launcher'],
    ];
    for (const [role, heading] of cliRoleSections) {
      const content = normalize(section(read(`agents/${role}.md`), heading));
      assert.ok(content.includes('dispatcher'), `${role} must leave fallback selection to the dispatcher`);
      assert.ok(content.includes('no provider side effect'), `${role} must require no-side-effect evidence`);
      assert.ok(content.includes('cross-provider candidates require explicit opt-in'), `${role} must preserve opt-in`);
    }
  });

  test('transport contract classifies failures but cannot select a provider', () => {
    const transport = read('skills/dhpk-cli-transport/SKILL.md');
    const classification = normalize(transport.slice(
      transport.indexOf('The dispatcher may attest one `failure_class` on a request.'),
      transport.indexOf('\n## When NOT to Use'),
    ));
    const output = normalize(section(transport, '## Output and verification'));

    assert.ok(classification.includes(
      'The dispatcher may attest one `failure_class` on a request. It is transport evidence, not a switching instruction, and must be one of `CLI_UNAVAILABLE`, `AUTHENTICATION_OR_MODEL_UNAVAILABLE`, `QUOTA_OR_RATE_LIMIT`, `SAFETY_OR_USER_DENIAL`, `TASK_OR_SEMANTIC_FAILURE`, or `TIMEOUT_OR_INTERRUPTION`.',
    ));
    assert.ok(classification.includes(
      'Requested and effective provider fields remain unchanged; the canonical dispatcher policy decides any subsequent handoff.',
    ));
    assert.ok(output.includes('The transport never emits a silent provider switch.'));
  });
}

run('native-dispatch-policy');
