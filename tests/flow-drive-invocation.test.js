'use strict';

// RED contracts for the machine-readable flow-drive intake boundary.
// The parser must preserve the explicit-only authority while producing an
// immutable context that downstream policy/dispatch adapters can consume.

const { test, run, assert } = require('./_lib/tinytest');
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

run('flow-drive-invocation');
