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

run('flow-handoff-contract');
