'use strict';

// Coverage for scripts/lib/release-evidence.js: the three-named-stage
// release verdict (SOURCE, PACKAGE, CONSUMER) and its overall-state
// derivation. A source PASS must never collapse into consumer readiness
// (openspec/changes/harden-dhpk-release-contracts/specs/consumer-post-install-validation/spec.md).

const { test, run, assert } = require('./_lib/tinytest');
const { buildEvidence, validateEvidence, STAGES, VERDICTS, OVERALL_STATES } = require('../scripts/lib/release-evidence');

function stage(verdict, overrides = {}) {
  return {
    verdict,
    commands: [{ cmd: 'node tests/run-all.js', exitCode: verdict === VERDICTS.PASS ? 0 : 1 }],
    environment: 'ubuntu-latest',
    artifacts: [],
    failureReasons: verdict === VERDICTS.PASS ? [] : ['example failure'],
    ...overrides,
  };
}

test('STAGES has exactly SOURCE, PACKAGE, CONSUMER', () => {
  assert.deepStrictEqual([...STAGES].sort(), ['CONSUMER', 'PACKAGE', 'SOURCE'].sort());
});

test('buildEvidence rejects a missing stage', () => {
  assert.throws(() => buildEvidence({ version: '1.0.0', stages: { SOURCE: stage(VERDICTS.PASS) } }), /PACKAGE|CONSUMER/);
});

test('source PASS + package FAIL yields overall BLOCKED, not consumer readiness', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: {
      SOURCE: stage(VERDICTS.PASS),
      PACKAGE: stage(VERDICTS.FAIL, { failureReasons: ['staged package missing declared asset'] }),
      CONSUMER: stage(VERDICTS.PENDING, { commands: [], failureReasons: [] }),
    },
  });
  assert.strictEqual(evidence.stages.SOURCE.verdict, VERDICTS.PASS);
  assert.strictEqual(evidence.stages.PACKAGE.verdict, VERDICTS.FAIL);
  assert.strictEqual(evidence.overall, OVERALL_STATES.BLOCKED);
});

test('an UNAVAILABLE package smoke test blocks publication (does not count as PASS)', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: {
      SOURCE: stage(VERDICTS.PASS),
      PACKAGE: stage(VERDICTS.UNAVAILABLE, { failureReasons: ['smoke test environment unavailable'] }),
      CONSUMER: stage(VERDICTS.PENDING, { commands: [], failureReasons: [] }),
    },
  });
  assert.strictEqual(evidence.overall, OVERALL_STATES.BLOCKED);
});

test('SOURCE and PACKAGE PASS with CONSUMER pending reports PUBLISHED_PENDING, not COMPLETE', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: {
      SOURCE: stage(VERDICTS.PASS),
      PACKAGE: stage(VERDICTS.PASS),
      CONSUMER: stage(VERDICTS.PENDING, { commands: [], failureReasons: [] }),
    },
  });
  assert.strictEqual(evidence.overall, OVERALL_STATES.PUBLISHED_PENDING);
  assert.notStrictEqual(evidence.overall, OVERALL_STATES.COMPLETE);
});

test('all three stages PASS reports COMPLETE', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: { SOURCE: stage(VERDICTS.PASS), PACKAGE: stage(VERDICTS.PASS), CONSUMER: stage(VERDICTS.PASS) },
  });
  assert.strictEqual(evidence.overall, OVERALL_STATES.COMPLETE);
});

test('a CONSUMER FAIL after publication reports PUBLISHED_UNHEALTHY, never COMPLETE', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: {
      SOURCE: stage(VERDICTS.PASS),
      PACKAGE: stage(VERDICTS.PASS),
      CONSUMER: stage(VERDICTS.FAIL, { failureReasons: ['installed cache cannot load released assets'] }),
    },
  });
  assert.strictEqual(evidence.overall, OVERALL_STATES.PUBLISHED_UNHEALTHY);
});

test('a SOURCE FAIL reports BLOCKED regardless of other stages', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: {
      SOURCE: stage(VERDICTS.FAIL, { failureReasons: ['tests/run-all.js failed'] }),
      PACKAGE: stage(VERDICTS.PENDING, { commands: [], failureReasons: [] }),
      CONSUMER: stage(VERDICTS.PENDING, { commands: [], failureReasons: [] }),
    },
  });
  assert.strictEqual(evidence.overall, OVERALL_STATES.BLOCKED);
});

test('validateEvidence rejects an unknown verdict value', () => {
  const result = validateEvidence({
    version: '1.0.0',
    stages: {
      SOURCE: stage('MAYBE'),
      PACKAGE: stage(VERDICTS.PASS),
      CONSUMER: stage(VERDICTS.PASS),
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /verdict/i.test(e)));
});

test('validateEvidence passes a well-formed evidence document', () => {
  const evidence = buildEvidence({
    version: '1.0.0',
    stages: { SOURCE: stage(VERDICTS.PASS), PACKAGE: stage(VERDICTS.PASS), CONSUMER: stage(VERDICTS.PASS) },
  });
  const result = validateEvidence(evidence);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
});

run('release-evidence');
