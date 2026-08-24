'use strict';

// RED-first tests for harness-facade-receipt-contract task 1.3.

const { test, run, assert } = require('./_lib/tinytest');
const harnessResult = require('../scripts/lib/harness-result');
const harness = require('../scripts/lib/harness');

const REQUIRED = [
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
];
const REQUIRED_RUNTIME = [
  'claude-core',
  'codex-sync',
  'codex-native',
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
  assert.strictEqual(harness.lifecyclePhaseForOutcome(result.outcome), 'COMPLETE');
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

test('full release ignores cursor-sync NOT_RUN for COMPLETE but retains its identity row', () => {
  const result = harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED,
    requiredRuntimeSurfaces: REQUIRED_RUNTIME,
    surfaceResults: all().map((entry) => entry.surface === 'cursor-sync'
      ? { ...entry, status: 'NOT_RUN' }
      : entry),
    fullRelease: true,
  });
  assert.strictEqual(result.outcome, 'COMPLETE');
  assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
  assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
});

test('full release keeps cursor-sync FAIL unhealthy even outside the runtime list', () => {
  const result = harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED,
    requiredRuntimeSurfaces: REQUIRED_RUNTIME,
    surfaceResults: all().map((entry) => entry.surface === 'cursor-sync'
      ? { ...entry, status: 'FAIL' }
      : entry),
    fullRelease: true,
  });
  assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
});

test('full-release aggregation rejects a non-canonical required runtime subset', () => {
  assert.throws(() => harnessResult.aggregateRequiredSurfaces({
    requiredSurfaces: REQUIRED,
    requiredRuntimeSurfaces: ['claude-core'],
    surfaceResults: all(),
    fullRelease: true,
  }), /runtime|required|canonical/i);
});

test('release execution invokes each required consumer probe and preserves its evidence', () => {
  const calls = [];
  const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => {
    calls.push({ root, surface: parsed.surface });
    return {
      outcome: parsed.surface === 'cursor-plugin' ? 'UNAVAILABLE' : 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: parsed.surface === 'cursor-plugin' ? 'UNAVAILABLE' : 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    };
  });

  assert.deepStrictEqual(calls, REQUIRED.map((surface) => ({
    root: '/tmp/dhpk-release-fixture',
    surface,
  })));
  assert.strictEqual(result.outcome, 'PUBLISHED_PENDING');
  assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
  assert.ok(result.surfaceResults.every((entry) => entry.stage === 'CONSUMER'));
  assert.ok(result.surfaceResults.every((entry) => entry.producer === 'fixture-probe'));
});

test('release execution aggregates the explicit runtime list separately from identity rows', () => {
  const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, REQUIRED_RUNTIME, (root, parsed) => ({
    outcome: parsed.surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
    surfaceResults: [{
      surface: parsed.surface,
      status: parsed.surface === 'cursor-sync' ? 'NOT_RUN' : 'PASS',
      stage: 'CONSUMER',
      producer: 'fixture-probe',
    }],
  }));
  assert.strictEqual(result.outcome, 'COMPLETE');
  assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
  assert.deepStrictEqual(result.surfaceResults.map((entry) => entry.surface), REQUIRED);
});

test('release execution rejects a non-canonical required runtime subset before COMPLETE', () => {
  assert.throws(() => harness.runReleaseProbes(
    '/tmp/dhpk-release-fixture',
    REQUIRED,
    ['claude-core'],
    (root, parsed) => ({
      outcome: 'PASS',
      surfaceResults: [{
        surface: parsed.surface,
        status: 'PASS',
        stage: 'CONSUMER',
        producer: 'fixture-probe',
      }],
    }),
  ), /runtime|required|canonical/i);
});

test('release execution fails closed when a probe emits malformed consumer evidence', () => {
  const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
    surfaceResults: [{
      surface: parsed.surface,
      status: parsed.surface === 'cursor-plugin' ? 'UNKNOWN' : 'PASS',
      stage: 'CONSUMER',
      producer: 'fixture-probe',
    }],
  }));

  assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
  const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
  assert.strictEqual(malformed.status, 'FAIL');
  assert.match(malformed.reasons.join('\n'), /invalid status/i);
});

test('release execution rejects foreign rows and conflicting producer outcomes', () => {
  const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => {
    if (parsed.surface !== 'cursor-plugin') {
      return {
        outcome: 'PASS',
        surfaceResults: [{
          surface: parsed.surface,
          status: 'PASS',
          stage: 'CONSUMER',
          producer: 'fixture-probe',
        }],
      };
    }
    return {
      outcome: 'FAIL',
      surfaceResults: [
        { surface: 'cursor-plugin', status: 'PASS', stage: 'CONSUMER', producer: 'fixture-probe' },
        { surface: 'agent-plugin', status: 'FAIL', stage: 'CONSUMER', producer: 'fixture-probe' },
      ],
    };
  });

  assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
  const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
  assert.strictEqual(malformed.status, 'FAIL');
  assert.match(malformed.reasons.join('\n'), /exactly one|foreign|result/i);
});

test('release execution rejects missing top-level probe outcomes', () => {
  const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
    surfaceResults: [{
      surface: parsed.surface,
      status: 'PASS',
      stage: 'CONSUMER',
      producer: 'fixture-probe',
    }],
  }));

  assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
  const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
  assert.strictEqual(malformed.status, 'FAIL');
  assert.match(malformed.reasons.join('\n'), /outcome/i);
});

test('release execution rejects a conflicting top-level probe outcome', () => {
  const result = harness.runReleaseProbes('/tmp/dhpk-release-fixture', REQUIRED, (root, parsed) => ({
    outcome: 'FAIL',
    surfaceResults: [{
      surface: parsed.surface,
      status: 'PASS',
      stage: 'CONSUMER',
      producer: 'fixture-probe',
    }],
  }));

  assert.strictEqual(result.outcome, 'PUBLISHED_UNHEALTHY');
  const malformed = result.surfaceResults.find((entry) => entry.surface === 'cursor-plugin');
  assert.strictEqual(malformed.status, 'FAIL');
  assert.match(malformed.reasons.join('\n'), /disagrees|outcome/i);
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
