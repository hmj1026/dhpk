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

  test('flow skills do not import each other or duplicate the shared contract', () => {
    const guide = fs.readFileSync(path.join(ROOT, 'skills', 'flow-guide', 'SKILL.md'), 'utf8');
    const drive = fs.readFileSync(path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md'), 'utf8');
    assert.doesNotMatch(guide, /require\([^)]*flow-drive|import[^\n]*flow-drive/i);
    assert.doesNotMatch(drive, /require\([^)]*flow-guide|import[^\n]*flow-guide/i);
    assert.match(guide, /shared.*handoff|neutral.*contract/i);
    assert.match(drive, /shared.*handoff|neutral.*contract/i);
  });

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
      plan: { enabled: true, model: 'sol', effort: 'medium' },
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

  test('flow-guide exposes exactly help, route, rules, next, and close actions', () => {
    const skill = read('skills/flow-guide/SKILL.md');
    const frontmatter = skill.match(/^argument-hint:\s*["']?([^"'\n]+)["']?\s*$/m);
    assert.ok(frontmatter, 'flow-guide must publish an argument hint');
    const hint = frontmatter[1];
    const alternatives = hint.match(/^<([^>]+)>/)?.[1].split('|');
    assert.deepStrictEqual(alternatives, ['help', 'route', 'rules', 'next', 'close'],
      'flow-guide argument hint must expose exactly the supported action alternatives in order');
    for (const removed of ['classify', 'policy', 'checklist']) {
      assert.doesNotMatch(hint, new RegExp(`\\b${removed}\\b`),
        `retired flow-guide action ${removed} must not remain public`);
    }
    assert.match(skill, /help[\s\S]{0,220}usage|usage[\s\S]{0,220}help/i);
    assert.match(skill, /route[\s\S]{0,220}--go|--go[\s\S]{0,220}route/i);
  });

  test('flow-drive is mode-free and accepts only confirmed implementation input', () => {
    const skill = read('skills/flow-drive/SKILL.md');
    assert.match(skill, /disable-model-invocation:\s*true/);
    assert.match(skill, /\$flow-drive\s+<[^>]*(?:confirmed|spec|change)[^>]*>/i);
    assert.doesNotMatch(skill, /^##\s+Modes\s*$/im);
    for (const removedFlag of ['--mode', '--route-only', '--execute-explicit', '--openspec', '--opsx']) {
      assert.doesNotMatch(skill, new RegExp(`\\${removedFlag}\\b`),
        `flow-drive must not expose removed flag ${removedFlag}`);
    }
    assert.match(skill, /flow-guide[\s\S]{0,180}route|route[\s\S]{0,180}flow-guide/i);
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

    const nonCodex = runHelp(['dhpk-module-design']);
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
