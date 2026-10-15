'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { compileSkillUsageCatalog, validateRuntimeIndex } = require('../scripts/lib/skill-usage');
const {
  createRouteResult,
  validateRouteResult,
} = require('../skills/flow-guide/scripts/route-result');

function runtimeIndex({ actions = true } = {}) {
  return {
    targets: {
      'change-verdict': {
        id: 'change-verdict',
        publicName: 'change-verdict',
        invocationClass: 'implicit-eligible',
        command: '$change-verdict <target>',
        codexInvokable: true,
        ...(actions ? { actions: { pending: '$change-verdict pending [--files=<paths>]' } } : {}),
      },
    },
    aliases: {},
  };
}

function table(target = { kind: 'skill', id: 'change-verdict', skillAction: 'pending' }) {
  return {
    schema: 'dhpk.route-table.v2',
    rules: [{ pattern: 'review', label: 'manual code review', target }],
  };
}

function route(overrides = {}) {
  return createRouteResult({
    argv: ['review', 'the', 'diff'],
    routeTable: table(),
    runtimeIndex: runtimeIndex(),
    ...overrides,
  });
}

function catalog(actions = [{
  id: 'pending',
  summary: 'Review pending changes',
  syntax: '$change-verdict pending [--files=<paths>]',
  input_kind: 'none',
  effect_authority: 'read-only',
}]) {
  return compileSkillUsageCatalog({ inventory: { skills: [{
    id: 'change-verdict',
    name: 'change-verdict',
    invocation_class: 'implicit-eligible',
    surfaces: ['codex-native'],
    usage: {
      display_name: 'Change Verdict',
      summary: 'Summarize evidence for a scoped code review.',
      syntax: '$change-verdict <target>',
      input_kind: 'free-text',
      invocation_class: 'implicit-eligible',
      effect_authority: 'read-only',
      inputs: [{ id: 'target', syntax: '<target>', value_kind: 'string', required: true, summary: 'Select review target' }],
      actions,
      options: [],
      examples: [{ prompt: '$change-verdict pending', summary: 'Review current pending changes' }],
    },
  }] } });
}

test('the public catalog compiler projects only canonical action syntax for routing', () => {
  const index = catalog().runtimeIndex;
  assert.deepStrictEqual(index.targets['change-verdict'].actions, {
    pending: '$change-verdict pending [--files=<paths>]',
  });
  assert.ok(Object.isFrozen(index.targets['change-verdict'].actions));
  const result = route({ runtimeIndex: index });
  assert.strictEqual(result.target.command, '$change-verdict pending [--files=<paths>]');
  assert.strictEqual(result.target.skillAction, 'pending');
  assert.ok(!Object.prototype.hasOwnProperty.call(result.target, 'effect_authority'));
});

test('catalog entries without actions retain the original runtime descriptor and parent command', () => {
  const index = catalog([]).runtimeIndex;
  assert.ok(!Object.prototype.hasOwnProperty.call(index.targets['change-verdict'], 'actions'));
  assert.deepStrictEqual(index.targets['change-verdict'], {
    id: 'change-verdict',
    publicName: 'change-verdict',
    invocationClass: 'implicit-eligible',
    command: '$change-verdict <target>',
    codexInvokable: true,
  });
});

test('a selected skill action returns its complete canonical invocation', () => {
  const result = route();
  assert.deepStrictEqual(result.target, {
    id: 'change-verdict',
    publicName: 'change-verdict',
    invocationClass: 'implicit-eligible',
    command: '$change-verdict pending [--files=<paths>]',
    skillAction: 'pending',
  });
  assert.strictEqual(result.disposition, 'advice');
  assert.ok(Object.isFrozen(result.target));
});

test('selected action invocation is identical across supported providers', () => {
  for (const host of ['claude', 'codex', 'cursor', 'agy']) {
    const result = route({ host });
    assert.strictEqual(result.host, host);
    assert.strictEqual(result.target.command, '$change-verdict pending [--files=<paths>]', host);
    assert.strictEqual(result.target.invocationClass, 'implicit-eligible', host);
  }
});

test('selecting an action preserves explicit-only invocation authority', () => {
  const index = runtimeIndex();
  index.targets['change-verdict'].invocationClass = 'explicit-only';
  const result = route({
    argv: ['--go', 'review', 'diff'],
    runtimeIndex: index,
    observed: { published: ['change-verdict'], discovered: ['change-verdict'] },
  });
  assert.strictEqual(result.target.command, '$change-verdict pending [--files=<paths>]');
  assert.strictEqual(result.target.invocationClass, 'explicit-only');
  assert.strictEqual(result.disposition, 'explicit-required');
});

test('an absent selector preserves the complete parent command and target shape', () => {
  const result = route({ routeTable: table({ kind: 'skill', id: 'change-verdict' }) });
  assert.deepStrictEqual(result.target, {
    id: 'change-verdict',
    publicName: 'change-verdict',
    invocationClass: 'implicit-eligible',
    command: '$change-verdict <target>',
  });
  assert.strictEqual(validateRouteResult(result), true);
});

test('unknown or malformed selectors stop the matched route before a valid fallback', () => {
  for (const skillAction of ['missing', '', 'pending extra', 'pending;echo unsafe', 1, null, ['pending']]) {
    const routeTable = table({ kind: 'skill', id: 'change-verdict', skillAction });
    routeTable.rules.push({ pattern: 'review', label: 'fallback', target: { kind: 'skill', id: 'change-verdict' } });
    const result = route({ argv: ['--go', 'review', 'diff'], routeTable });
    assert.strictEqual(result.target, null, JSON.stringify(skillAction));
    assert.strictEqual(result.disposition, 'unavailable', JSON.stringify(skillAction));
    assert.strictEqual(result.availability, 'unavailable');
    assert.ok(result.diagnostics.some((message) => /action|selector/i.test(message)));
    assert.doesNotMatch(result.nextAction, /\$change-verdict/);
  }
});

test('an action requires normalized action metadata even when parent syntax mentions it', () => {
  const index = runtimeIndex({ actions: false });
  index.targets['change-verdict'].command = '$change-verdict pending [--files=<paths>]';
  const result = route({ argv: ['--go', 'review', 'diff'], runtimeIndex: index });
  assert.strictEqual(result.target, null);
  assert.strictEqual(result.disposition, 'unavailable');
  assert.strictEqual(result.availability, 'unavailable');
  assert.ok(result.diagnostics.some((message) => /action|selector/i.test(message)));
  assert.doesNotMatch(result.nextAction, /\$change-verdict/);
});

test('command and agent route kinds cannot select a skill action', () => {
  for (const kind of ['command', 'agent']) {
    const result = route({
      argv: ['--go', 'review', 'diff'],
      routeTable: table({ kind, id: 'change-verdict', skillAction: 'pending' }),
    });
    assert.strictEqual(result.target, null, kind);
    assert.strictEqual(result.disposition, 'unavailable', kind);
    assert.strictEqual(result.availability, 'unavailable');
    assert.ok(result.diagnostics.some((message) => /action|selector/i.test(message)));
    assert.doesNotMatch(result.nextAction, /\$change-verdict/);
  }
});

test('runtime index validation accepts the closed optional action syntax map', () => {
  const result = validateRuntimeIndex(runtimeIndex());
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
});

test('runtime index validation rejects malformed action maps and entries', () => {
  for (const actions of [null, [], 'pending', { pending: 7 }, { pending: '' }, { 'pending extra': '$change-verdict pending' }]) {
    const index = runtimeIndex();
    index.targets['change-verdict'].actions = actions;
    assert.strictEqual(validateRuntimeIndex(index).ok, false, JSON.stringify(actions));
  }
});

test('selected action metadata survives serialization and public result validation', () => {
  const result = JSON.parse(JSON.stringify(route()));
  assert.strictEqual(result.target.skillAction, 'pending');
  assert.strictEqual(result.target.command, '$change-verdict pending [--files=<paths>]');
  assert.strictEqual(validateRouteResult(result), true);
});

test('result validation accepts a selected action and rejects malformed selector values', () => {
  const result = JSON.parse(JSON.stringify(route({ routeTable: table({ kind: 'skill', id: 'change-verdict' }) })));
  result.target.skillAction = 'pending';
  result.target.command = '$change-verdict pending [--files=<paths>]';
  assert.strictEqual(validateRouteResult(result), true);
  for (const skillAction of ['', 'pending extra', 1, null, ['pending']]) {
    const malformed = JSON.parse(JSON.stringify(result));
    malformed.target.skillAction = skillAction;
    assert.throws(() => validateRouteResult(malformed), /target|action|selector/i);
  }
});

run('skill-action-routing');
