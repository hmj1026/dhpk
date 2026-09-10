'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  MARKER_SCHEMA,
  deriveCompletionLedger,
  preparePartialHandoff,
} = require('../scripts/lib/partial-writer-handoff');

test('completion ledger requires report plus attributable path-scoped diff and excludes siblings', () => {
  const ledger = deriveCompletionLedger({
    assignedFiles: ['src/a.js', 'src/b.js', 'src/c.js'],
    reportedFiles: ['src/a.js', 'src/b.js', 'sibling.txt'],
    changedFiles: ['src/a.js', 'src/b.js', 'sibling.txt'],
    attributableFiles: ['src/a.js'],
  });

  assert.deepStrictEqual(ledger.assigned, ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.deepStrictEqual(ledger.confirmed, ['src/a.js']);
  assert.deepStrictEqual(ledger.unconfirmed, ['src/b.js']);
  assert.deepStrictEqual(ledger.remaining, ['src/c.js']);
  assert.deepStrictEqual(ledger.out_of_scope, ['sibling.txt']);
  assert.strictEqual(ledger.disjoint, true);
});

test('handoff blocks until the old writer, scope, and diff are all reconciled', () => {
  const ledger = deriveCompletionLedger({ assignedFiles: ['a.js'], reportedFiles: ['a.js'], changedFiles: ['a.js'], attributableFiles: ['a.js'] });
  for (const key of ['writerStopped', 'scopeVerified', 'diffVerified']) {
    const options = { backend: 'codex', sessionId: 'session1', dispatchId: 'dispatch1', ledger, writerStopped: true, scopeVerified: true, diffVerified: true, timeoutObservations: ['first', 'second'] };
    options[key] = false;
    const result = preparePartialHandoff(options);
    assert.strictEqual(result.status, 'blocked', key);
  }
});

test('partial handoff creates an auditable marker and only retries unresolved assigned files', () => {
  const ledger = deriveCompletionLedger({
    assignedFiles: ['a.js', 'b.js'],
    reportedFiles: ['a.js'],
    changedFiles: ['a.js', 'b.js'],
    attributableFiles: ['a.js'],
  });
  const result = preparePartialHandoff({
    backend: 'codex',
    sessionId: 'session1',
    dispatchId: 'dispatch1',
    ledger,
    writerStopped: true,
    scopeVerified: true,
    diffVerified: true,
    timeoutObservations: [{ status: 'TIMEOUT' }, { status: 'TIMEOUT' }],
  });

  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.result, 'PARTIAL');
  assert.deepStrictEqual(result.recovery_scope, ['b.js']);
  assert.deepStrictEqual(result.out_of_scope, []);
  assert.strictEqual(result.marker.schema, MARKER_SCHEMA);
  assert.deepStrictEqual(result.marker.confirmed, ['a.js']);
  assert.deepStrictEqual(result.marker.remaining, []);
  assert.deepStrictEqual(result.marker.unconfirmed, ['b.js']);
  assert.match(result.marker.marker_path, /^\.claude\/artifacts\/sessions\/.partial-cli-batch-codex-session1-dispatch1\.json$/);
  assert.ok(!result.marker.marker_path.includes('.pending-'));
  assert.strictEqual(result.marker.review_gate_verdict, null);
});

test('no confirmed file produces a terminal BLOCKED handoff without a partial marker', () => {
  const ledger = deriveCompletionLedger({ assignedFiles: ['a.js'], reportedFiles: [], changedFiles: [], attributableFiles: [] });
  const result = preparePartialHandoff({
    backend: 'agy',
    sessionId: 'session1',
    dispatchId: 'dispatch1',
    ledger,
    writerStopped: true,
    scopeVerified: true,
    diffVerified: true,
    timeoutObservations: [{ status: 'TIMEOUT' }, { status: 'TIMEOUT' }],
  });
  assert.strictEqual(result.result, 'BLOCKED');
  assert.strictEqual(result.marker, null);
  assert.deepStrictEqual(result.recovery_scope, ['a.js']);
});

run('partial-writer-handoff');
