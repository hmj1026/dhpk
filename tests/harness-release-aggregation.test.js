'use strict';

// RED-first tests for harness-facade-receipt-contract task 1.3.

const { test, run, assert } = require('./_lib/tinytest');
const harnessResult = require('../scripts/lib/harness-result');

const REQUIRED = [
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
];

function all(status = 'PASS') {
  return REQUIRED.map((surface) => ({ surface, status }));
}

test('full-release aggregation requires exactly the seven canonical surfaces', () => {
  assert.deepStrictEqual(harnessResult.REQUIRED_SURFACES, REQUIRED);
  const result = harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED,
    surfaceResults: all(),
    fullRelease: true,
  });
  assert.strictEqual(result.outcome, 'COMPLETE');
});

test('unavailable and failed surfaces remain non-complete', () => {
  const pending = harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED,
    surfaceResults: all().map((entry) => entry.surface === 'cursor-plugin'
      ? { ...entry, status: 'UNAVAILABLE' }
      : entry),
    fullRelease: true,
  });
  assert.strictEqual(pending.outcome, 'PUBLISHED_PENDING');

  const unhealthy = harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED,
    surfaceResults: all().map((entry) => entry.surface === 'agy-plugin'
      ? { ...entry, status: 'FAIL' }
      : entry),
    fullRelease: true,
  });
  assert.strictEqual(unhealthy.outcome, 'PUBLISHED_UNHEALTHY');
});

test('missing or unknown required surfaces fail closed', () => {
  assert.throws(() => harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED.slice(0, -1),
    surfaceResults: all(),
    fullRelease: true,
  }), /required|surface|incomplete/i);
  assert.throws(() => harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: [...REQUIRED, 'unknown-surface'],
    surfaceResults: all(),
    fullRelease: true,
  }), /required|surface|unknown/i);
});

test('lifecycle phase and command outcome remain separate', () => {
  const result = harnessResult.createResult({ phase: 'verify', lifecyclePhase: 'RED', outcome: 'NOT_RUN' });
  assert.strictEqual(result.lifecyclePhase, 'RED');
  assert.strictEqual(result.outcome, 'NOT_RUN');
  assert.strictEqual(harnessResult.exitCodeForOutcome(result.outcome), 2);
});

run('harness-release-aggregation');
