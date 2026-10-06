'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { SCHEMA, createFlowHandoff, validateFlowHandoff } = require('../scripts/lib/flow-handoff-contract');

test('creates an immutable neutral handoff with bounded evidence', () => {
  const result = createFlowHandoff({
    handoff_id: 'contract-test-handoff', owner: 'flow-drive', host: 'cursor', disposition: 'ready',
    evidence: [{ kind: 'route', state: 'available', detail: 'fixture' }], next_action: 'continue',
  });
  assert.strictEqual(result.schema, SCHEMA);
  assert.strictEqual(result.execution, 'not-started');
  assert.strictEqual(Object.isFrozen(result), true);
  assert.strictEqual(Object.isFrozen(result.evidence), true);
  assert.strictEqual(Object.isFrozen(result.evidence[0]), true);
  assert.throws(() => createFlowHandoff({ handoff_id: 'bad-host', owner: 'flow-guide', host: 'unknown', disposition: 'ready', next_action: 'stop' }), /host/i);
  assert.throws(() => createFlowHandoff({ handoff_id: 'bad-evidence', owner: 'flow-guide', host: 'cursor', disposition: 'ready', evidence: [{ kind: 'route', state: 'guessed', detail: 'fixture' }], next_action: 'stop' }), /state/i);
});

test('preserves CLI reasoning efforts in neutral handoff targets', () => {
  for (const effort of ['xhigh', 'ultra']) {
    const result = createFlowHandoff({
      handoff_id: `cli-${effort}`, owner: 'flow-drive', host: 'claude-code', disposition: 'ready',
      target: { provider: 'codex-cli', role: 'reasoner', effort, transport: 'local-cli' }, next_action: 'execute',
    });
    assert.strictEqual(result.target.effort, effort);
    assert.doesNotThrow(() => validateFlowHandoff(result));
  }
});

test('rejects unsupported target evidence and execution claims', () => {
  assert.throws(() => createFlowHandoff({ handoff_id: 'bad', owner: 'flow-guide', host: 'cursor', disposition: 'ready', target: { provider: 'codex-cli', argv: ['codex'] }, next_action: 'stop' }), /unsupported/i);
  assert.throws(() => validateFlowHandoff({ handoff_id: 'bad', owner: 'flow-guide', host: 'cursor', disposition: 'ready', execution: 'SUCCEEDED', next_action: 'stop' }), /execution/i);
  assert.throws(() => createFlowHandoff({ handoff_id: 'bad-evidence-field', owner: 'flow-guide', host: 'cursor', disposition: 'ready', evidence: [{ kind: 'route', state: 'available', detail: 'fixture', command: 'run' }], next_action: 'stop' }), /unsupported fields/i);
});

test('keeps canonical Role, Effort, and Transport fields separate in a handoff target', () => {
  const result = createFlowHandoff({
    handoff_id: 'contract-target', owner: 'flow-drive', host: 'codex-cli', disposition: 'ready',
    target: { provider: 'codex-cli', model: 'sol5.6', role: 'reasoner', effort: 'high', transport: 'local-cli' }, next_action: 'execute',
  });
  assert.strictEqual(result.target.role, 'reasoner');
  assert.strictEqual(result.target.provider, 'codex-cli');
  assert.strictEqual(result.target.model, 'sol5.6');
  assert.strictEqual(result.target.effort, 'high');
  assert.strictEqual(result.target.transport, 'local-cli');
  assert.strictEqual(Object.isFrozen(result.target), true);
  assert.doesNotThrow(() => validateFlowHandoff(result));
});

// Consolidated source suite: flow-contract.
{

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    SCHEMA,
    createFlowHandoff,
    validateFlowHandoff,
  } = require('../scripts/lib/flow-handoff-contract');

  const ROOT = path.join(__dirname, '..');

  test('flow-guide adapts its closed route result into the shared handoff contract', () => {
    const route = require('../skills/flow-guide/scripts/route-result').createRouteResult({
      host: 'cursor', argv: ['--go', 'implement', 'the', 'confirmed', 'change'],
      observed: { invocationClasses: { 'flow-drive': 'explicit-only' } },
    });
    const handoff = require('../skills/flow-guide/scripts/route-result').createRouteHandoff(route);
    assert.strictEqual(handoff.schema, SCHEMA);
    assert.strictEqual(handoff.owner, route.target.id);
    assert.strictEqual(handoff.host, route.host);
    assert.strictEqual(handoff.disposition, route.disposition);
    assert.deepStrictEqual(handoff.evidence, [{
      kind: 'route-availability',
      state: route.availability,
      detail: route.requiredEvidence[0],
    }]);
    assert.strictEqual(handoff.next_action, route.nextAction);
    assert.strictEqual(handoff.execution, 'not-started');
  });

  test('flow-guide route contract accepts each supported Host identity', () => {
    const { createRouteResult } = require('../skills/flow-guide/scripts/route-result');
    for (const host of ['claude-code', 'codex-cli', 'agy', 'cursor']) {
      const result = createRouteResult({ host, argv: ['inspect', 'the', 'route'] });
      assert.strictEqual(result.host, host);
    }
  });

  test('flow-drive validates confirmation and resolves Roles through the common Dispatch Engine', () => {
    const { prepareDispatch } = require('../skills/flow-drive/scripts/dispatch');
    const result = prepareDispatch({
      change: { confirmed: true, change_id: 'provider-neutral-subagent-orchestration' },
      request: {
        schema: 'dhpk.dispatch.request.v2',
        host_profile: {
          schema: 'dhpk.host.profile.v1', version: 'test.v2', host: 'cursor',
          native_target_agent: 'cursor', native_provider: 'cursor', native_model: 'composer-2.5', native_transport: 'native-runtime',
          allowed_providers: ['cursor', 'openai'],
          access: { cursor: { status: 'AVAILABLE', evidence: 'test native runtime' }, openai: { status: 'AVAILABLE', evidence: 'test reviewer route' } },
          quota_pools: { cursor: 'native', openai: 'codex' }, concurrency_limits: { native: 1, codex: 1 },
          role_defaults: {
            reviewer: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high', effort: 'high', route: 'native', transport: 'native-runtime' },
          },
          observed_at: '2026-09-11T00:00:00.000Z',
        },
        task_id: 'flow-drive-task', attempt_id: 'flow-drive-attempt', role: 'reviewer', authority: 'read-only',
        task: { description_digest: '1'.repeat(64) },
        scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: '2'.repeat(64) } },
        effort: 'high', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 1 },
      },
      catalog: require('../manifests/provider-model-catalog.json'),
    });
    assert.strictEqual(result.resolution.status, 'RESOLVED');
    assert.strictEqual(result.resolution.request.role, 'reviewer');
    assert.strictEqual(result.handoff.execution, 'not-started');
    assert.throws(() => prepareDispatch({ change: { confirmed: false }, request: result.request, catalog: require('../manifests/provider-model-catalog.json') }), /confirmed change/i);
  });
}

// Consolidated source suite: flow-drive-invocation.
{

  // RED contracts for the machine-readable flow-drive intake boundary.
  // The parser must preserve the explicit-only authority while producing an
  // immutable context that downstream policy/dispatch adapters can consume.

  const { test, assert } = require('./_lib/tinytest');
  const { parseInvocation } = require('../skills/flow-drive/scripts/invocation');
  const { createRouteResult } = require('../skills/flow-guide/scripts/route-result');

  test('flow-guide route --go fails closed when target availability is not configured', () => {
    const result = createRouteResult({
      host: 'claude',
      argv: ['--go', 'fix', 'the', 'checkout', 'bug'],
    });

    assert.strictEqual(result.availability, 'not-configured');
    assert.strictEqual(result.disposition, 'blocked');
    assert.match(result.nextAction, /availability|evidence|verify/i);
  });

  test('flow-drive parses the documented implementation options into one immutable context', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--plan=sol:medium',
      '--worker=auto',
      '--cross-provider',
      '--reasoner=codex:terra:high',
      '--architect',
    ]);

    assert.strictEqual(context.schema, 'dhpk.flow-drive-invocation.v1');
    assert.strictEqual(context.status, 'ready');
    assert.strictEqual(context.changeId, 'confirmed-change-123');
    assert.deepStrictEqual(context.options, {
      plan: { enabled: true, model: 'sol', effort: 'medium', mode: 'auto' },
      worker: 'auto',
      workerTarget: null,
      crossProvider: true,
      reasoner: { backend: 'codex', model: 'terra', effort: 'high' },
      architect: true,
    });
    assert.deepStrictEqual(context.diagnostics, []);
    assert.ok(Object.isFrozen(context));
    assert.ok(Object.isFrozen(context.options));
    assert.ok(Object.isFrozen(context.options.plan));
    assert.throws(() => { context.options.worker = 'codex'; }, TypeError);
  });

  test('flow-drive keeps planner mode null when planning is disabled', () => {
    const context = parseInvocation(['confirmed-change-123']);

    assert.strictEqual(context.status, 'ready');
    assert.strictEqual(context.schema, 'dhpk.flow-drive-invocation.v1');
    assert.deepStrictEqual(context.options.plan, {
      enabled: false,
      model: null,
      effort: null,
      mode: null,
    });
    assert.ok(Object.isFrozen(context.options.plan));
  });

  test('flow-drive defaults a bare --plan option to auto mode', () => {
    const context = parseInvocation(['confirmed-change-123', '--plan']);

    assert.strictEqual(context.status, 'ready');
    assert.deepStrictEqual(context.options.plan, {
      enabled: true,
      model: null,
      effort: null,
      mode: 'auto',
    });
  });

  test('flow-drive accepts planner modes in either option order and preserves model and effort', () => {
    for (const mode of ['auto', 'bounded', 'discovery']) {
      const modeFirst = parseInvocation([
        'confirmed-change-123',
        `--plan-mode=${mode}`,
        '--plan=sol:medium',
      ]);
      const planFirst = parseInvocation([
        'confirmed-change-123',
        '--plan=sol:medium',
        `--plan-mode=${mode}`,
      ]);
      const expected = { enabled: true, model: 'sol', effort: 'medium', mode };

      assert.strictEqual(modeFirst.status, 'ready', modeFirst.diagnostics.join('\n'));
      assert.strictEqual(planFirst.status, 'ready', planFirst.diagnostics.join('\n'));
      assert.deepStrictEqual(modeFirst.options.plan, expected);
      assert.deepStrictEqual(planFirst.options.plan, expected);
      assert.ok(Object.isFrozen(modeFirst.options.plan));
      assert.ok(Object.isFrozen(planFirst.options.plan));
    }
  });

  test('flow-drive blocks invalid planner-mode forms', () => {
    const invalidOptions = [
      ['empty', ['--plan', '--plan-mode='], /plan-mode/i],
      ['unknown', ['--plan', '--plan-mode=unknown'], /plan-mode/i],
      ['duplicate', ['--plan', '--plan-mode=bounded', '--plan-mode=discovery'], /plan-mode.*may only be specified once/i],
      ['orphan', ['--plan-mode=bounded'], /--plan-mode.*requires.*--plan/i],
      ['bare', ['--plan-mode'], /plan-mode/i],
      ['separated', ['--plan-mode', 'bounded'], /plan-mode/i],
    ];

    for (const [label, args, diagnostic] of invalidOptions) {
      const context = parseInvocation(['confirmed-change-123', ...args]);

      assert.strictEqual(context.status, 'blocked', label);
      assert.ok(context.diagnostics.some((item) => diagnostic.test(item)), `${label}: ${context.diagnostics.join('\n')}`);
      if (label === 'orphan') {
        assert.strictEqual(context.options.plan.enabled, false);
        assert.strictEqual(context.options.plan.mode, null);
      }
    }
  });

  test('flow-drive fails closed on conflicting architecture flags', () => {
    const context = parseInvocation(['confirmed-change-123', '--architect', '--no-architect']);

    assert.strictEqual(context.status, 'blocked');
    assert.ok(context.diagnostics.some((item) => /architect.*conflict|mutually exclusive/i.test(item)));
    assert.strictEqual(context.options.architect, null);
  });

  test('flow-drive keeps worker selection separate from an explicit worker target', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--worker=auto',
      '--worker-target=codex/gpt-5.6-sol:high',
    ]);

    assert.strictEqual(context.status, 'ready');
    assert.strictEqual(context.options.worker, 'auto');
    assert.deepStrictEqual(context.options.workerTarget, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'high',
    });
  });

  test('flow-drive lets an explicit Codex worker target override AGY selection on Claude Code', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--worker=agy',
      '--worker-target=codex/gpt-6-luna:xhigh',
    ], { host: 'claude-code' });

    assert.strictEqual(context.status, 'ready', context.diagnostics.join('\n'));
    assert.strictEqual(context.options.worker, 'agy');
    assert.deepStrictEqual(context.options.workerTarget, {
      provider: 'codex',
      model: 'gpt-6-luna',
      effort: 'xhigh',
    });
  });

  test('flow-drive rejects malformed worker targets and duplicate target selectors', () => {
    const malformed = parseInvocation(['confirmed-change-123', '--worker-target=auto/model']);
    assert.strictEqual(malformed.status, 'blocked');
    assert.ok(malformed.diagnostics.some((item) => /worker-target.*provider|unsupported/i.test(item)));

    const duplicate = parseInvocation([
      'confirmed-change-123',
      '--worker-target=codex/terra',
      '--worker-target=agy/worker',
    ]);
    assert.strictEqual(duplicate.status, 'blocked');
    assert.ok(duplicate.diagnostics.some((item) => /worker-target.*once/i.test(item)));
  });

  test('flow-drive rejects retired codex and malformed worker/reasoner options', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--codex',
      '--worker=wat',
      '--reasoner=agy:terra:high',
    ]);

    assert.strictEqual(context.status, 'blocked');
    assert.ok(context.diagnostics.some((item) => /--codex.*retired/i.test(item)));
    assert.ok(context.diagnostics.some((item) => /worker/i.test(item)));
    assert.ok(context.diagnostics.some((item) => /reasoner/i.test(item)));
  });

  const CLI_BACKED_SELECTIONS = [
    ['--worker=agy'],
    ['--worker-target=agy/gemini-3.8-flash-high'],
  ];

  for (const selection of CLI_BACKED_SELECTIONS) {
    test(`flow-drive keeps ${selection[0]} blocked on the Claude Code host`, () => {
      const context = parseInvocation(['confirmed-change-123', ...selection], { host: 'claude-code' });

      assert.strictEqual(context.status, 'blocked');
      assert.ok(
        context.diagnostics.some((item) => /AGY dispatch is not supported by (?:the )?parent-session CLI launcher/i.test(item)),
        context.diagnostics.join('\n'),
      );
    });
  }

  test('flow-drive accepts all configured Codex options on Claude Code and normalizes the codex-cli reasoner alias', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--plan=opus:high',
      '--plan-mode=bounded',
      '--worker=codex',
      '--worker-target=codex/gpt-6-luna:xhigh',
      '--cross-provider',
      '--reasoner=codex-cli/gpt-6.1-sol:high',
      '--architect',
    ], { host: 'claude-code' });

    assert.strictEqual(context.status, 'ready', context.diagnostics.join('\n'));
    assert.deepStrictEqual(context.options, {
      plan: { enabled: true, model: 'opus', effort: 'high', mode: 'bounded' },
      worker: 'codex',
      workerTarget: { provider: 'codex', model: 'gpt-6-luna', effort: 'xhigh' },
      crossProvider: true,
      reasoner: { backend: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
      architect: true,
    });
    assert.deepStrictEqual(context.notices, []);
  });

  test('flow-drive discloses native reasoner and worker-target effort overrides on Claude Code', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--reasoner=claude:claude-opus-5-5:medium',
      '--worker-target=claude/claude-opus-5-5:high',
    ], { host: 'claude-code' });

    assert.strictEqual(context.status, 'ready', context.diagnostics.join('\n'));
    assert.ok(
      context.notices.some((item) => /reasoner.*effort 'medium'.*configured effort 'high'/i.test(item)),
      context.notices.join('\n'),
    );
    assert.ok(
      context.notices.some((item) => /worker-target.*effort 'high'.*configured effort 'medium'/i.test(item)),
      context.notices.join('\n'),
    );
  });

  test('flow-drive keeps CLI-backed selections ready when the host is unspecified or CLI-native', () => {
    for (const selection of CLI_BACKED_SELECTIONS) {
      assert.strictEqual(parseInvocation(['confirmed-change-123', ...selection]).status, 'ready');
      assert.strictEqual(parseInvocation(['confirmed-change-123', ...selection], { host: 'codex-cli' }).status, 'ready');
    }
  });

  test('flow-drive keeps native selections ready on the Claude Code host', () => {
    const context = parseInvocation(
      ['confirmed-change-123', '--worker=claude', '--reasoner=claude', '--worker-target=claude/opus'],
      { host: 'claude-code' },
    );

    assert.strictEqual(context.status, 'ready');
    assert.deepStrictEqual(context.diagnostics, []);
  });

  test('flow-drive reports an unapplied planner effort on the Claude Code host', () => {
    const context = parseInvocation(
      ['confirmed-change-123', '--plan=opus:medium', '--plan-mode=bounded'],
      { host: 'claude-code' },
    );

    assert.strictEqual(context.status, 'ready');
    assert.deepStrictEqual(context.options.plan, { enabled: true, model: 'opus', effort: 'medium', mode: 'bounded' });
    assert.ok(
      context.notices.some((item) => /effort 'medium' is not applied/.test(item) && /'high'/.test(item)),
      context.notices.join('\n'),
    );
  });

  test('flow-drive emits no effort notice when the requested effort matches or the host is unspecified', () => {
    assert.deepStrictEqual(parseInvocation(['confirmed-change-123', '--plan=opus:high'], { host: 'claude-code' }).notices, []);
    assert.deepStrictEqual(parseInvocation(['confirmed-change-123', '--plan=opus:medium']).notices, []);
  });

  test('flow-drive lists the legal effort values for every invalid effort', () => {
    const context = parseInvocation([
      'confirmed-change-123',
      '--plan=opus:med',
      '--reasoner=codex:terra:med',
      '--worker-target=codex/terra:med',
    ]);

    assert.strictEqual(context.status, 'blocked');
    const effortDiagnostics = context.diagnostics.filter((item) => /effort 'med'/.test(item));
    assert.strictEqual(effortDiagnostics.length, 3, context.diagnostics.join('\n'));
    for (const item of effortDiagnostics) {
      assert.match(item, /low\|medium\|high\|max\|xhigh\|ultra/);
    }
  });

  test('flow-drive CLI derives the Claude Code host from the environment and keeps Codex intent ready', () => {
    const { spawnSync } = require('node:child_process');
    const script = require.resolve('../skills/flow-drive/scripts/invocation');
    const run = (env) => spawnSync(process.execPath, [script, 'confirmed-change-123', '--worker=codex'], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });

    const claude = run({ CLAUDECODE: '1' });
    assert.strictEqual(claude.status, 0, claude.stdout + claude.stderr);
    assert.strictEqual(JSON.parse(claude.stdout).status, 'ready');

    const neutral = run({});
    assert.strictEqual(neutral.status, 0, neutral.stdout + neutral.stderr);
    assert.strictEqual(JSON.parse(neutral.stdout).status, 'ready');
  });
}

// Consolidated source suite: flow-guide-ownership.
{

  // RED acceptance contracts for the Flow ownership cutover.  The tests keep
  // routing at its public parser/result seam and use the canonical Markdown only
  // for ownership and mode-boundary checks.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

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

  test('flow-guide publishes supported action argument metadata', () => {
    const skill = read('skills/flow-guide/SKILL.md');
    const frontmatter = skill.match(/^argument-hint:\s*["']?([^"'\n]+)["']?\s*$/m);
    assert.ok(frontmatter, 'flow-guide must publish an argument hint');
    const alternatives = frontmatter[1].match(/^<([^>]+)>/)?.[1].split('|');
    assert.deepStrictEqual(alternatives, ['help', 'route', 'rules', 'next', 'close']);
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
      observed: {
        invocationClasses: { 'code-trace': 'implicit-eligible' },
        published: ['code-trace'],
        discovered: ['code-trace'],
      },
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
}

// Consolidated source suite: flow-guide-usage-help.
{

  // RED contracts for progressive, read-only Codex usage discovery through the
  // flow-guide help card.  The helper is intentionally tested as a process
  // boundary so a passing result proves the same generated catalog a user sees.

  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const CARD = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'usage-card.js');
  const CATALOG = path.join(ROOT, 'skills', 'flow-guide', 'references', 'codex-usage-catalog.json');

  function runHelp(args = []) {
    assert.ok(
      fs.existsSync(CARD),
      'RED: skills/flow-guide/scripts/usage-card.js is absent; progressive help is not implemented',
    );
    return spawnSync(process.execPath, [CARD, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15000,
    });
  }

  function output(result) {
    return `${result.stdout || ''}${result.stderr || ''}`;
  }

  function jsonHelp(args = []) {
    const result = runHelp(['--json', ...args]);
    assert.strictEqual(result.status, 0, output(result));
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      assert.fail(`help --json must emit one JSON value: ${error.message}\n${output(result)}`);
    }
  }

  test('generated usage catalog exists under the flow-guide owner', () => {
    assert.ok(fs.existsSync(CATALOG),
      'RED: flow-guide references/codex-usage-catalog.json is absent; generated usage catalog is not available');
    const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    assert.strictEqual(catalog.schema, 'dhpk.skill-usage-catalog.v1');
    assert.ok(Array.isArray(catalog.entries), 'generated usage catalog must expose entries');
    assert.ok(catalog.entries.length > 0, 'generated usage catalog must not be empty');
  });

  test('$flow-guide help lists Codex-invokable public names in deterministic order', () => {
    const result = runHelp([]);
    assert.strictEqual(result.status, 0, output(result));
    const text = output(result);
    const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    const expectedNames = catalog.entries
      .map((entry) => entry.name || entry.publicName)
      .filter((name) => typeof name === 'string')
      .sort((left, right) => left.localeCompare(right));
    assert.match(text, /flow-guide/i);
    assert.match(text, /flow-drive/i);
    assert.match(text, /git-smart-commit/i);
    assert.match(text, /(?:usage|available|codex)/i);

    const names = text.split(/\r?\n/)
      .map((line) => line.match(/^\s*-\s+([a-z][a-z0-9-]*):\s+/i))
      .filter(Boolean)
      .map((match) => match[1]);
    assert.deepStrictEqual(names, expectedNames,
      'help list must include every catalog public name exactly once in deterministic order');
    assert.doesNotMatch(text, /implementation dispatch|review-gate-mechanics|workflow-feature-delivery/i,
      'catalog listing must not load target procedural references');
  });

  test('$flow-guide help flow-drive returns only one explicit-only usage card', () => {
    const card = jsonHelp(['flow-drive']);
    const usage = card.usage || card.entry || card;
    const name = usage.publicName || usage.name || usage.id;
    assert.strictEqual(name, 'flow-drive');
    assert.strictEqual(usage.invocation_class || usage.invocationClass, 'explicit-only');
    assert.strictEqual(usage.effect_authority || usage.effectAuthority, 'workspace-write');
    assert.match(usage.syntax, /^\$flow-drive\b/);
    assert.ok(Array.isArray(usage.actions));
    assert.ok(Array.isArray(usage.options));
    assert.ok(Array.isArray(usage.examples));
    assert.ok(!('procedure' in usage), 'help cards must not carry target procedure prose');
    assert.ok(!('completion' in usage), 'help cards must not carry target completion procedure prose');
  });

  test('help JSON preserves one machine-readable action and option contract', () => {
    const card = jsonHelp(['git-smart-commit']);
    const usage = card.usage || card.entry || card;
    assert.strictEqual(usage.id, 'git-smart-commit');
    assert.strictEqual(usage.name, 'git-smart-commit');
    assert.match(usage.syntax, /^\$git-smart-commit\b/);
    for (const action of usage.actions || []) {
      assert.ok(action.id && action.summary && action.syntax && action.input_kind,
        'each help action must expose public grammar fields');
      assert.match(action.syntax, /^\$git-smart-commit\b/);
    }
    for (const option of usage.options || []) {
      assert.ok(option.id && option.syntax && option.value_kind && typeof option.required === 'boolean',
        'each help option must expose its grammar fields');
    }
  });

  test('unknown and known non-Codex help targets have distinct diagnostics', () => {
    const unknown = runHelp(['does-not-exist']);
    assert.notStrictEqual(unknown.status, 0);
    assert.match(output(unknown), /unknown-skill/i);

    const nonCodex = runHelp(['module-design']);
    assert.notStrictEqual(nonCodex.status, 0);
    assert.match(output(nonCodex), /not-codex-invokable/i);
    assert.doesNotMatch(output(nonCodex), /unknown-skill/i);
  });

  test('help is metadata-only and cannot turn flow-drive into an implicit invocation', () => {
    const result = runHelp(['flow-drive']);
    assert.strictEqual(result.status, 0, output(result));
    assert.doesNotMatch(output(result), /execut(e|ing)|implement(ed|ation)?\s+(started|running)|workspace-write granted/i);
    assert.match(output(result), /explicit-only|direct.*invocation|human/i);
  });
}

run('flow-handoff-contract');
