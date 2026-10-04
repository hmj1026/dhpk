'use strict';

// Coverage for scripts/lib/release-evidence.js: the three-named-stage
// release verdict (SOURCE, PACKAGE, CONSUMER) and its overall-state
// derivation. A source PASS must never collapse into consumer readiness
// (openspec/changes/harden-dhpk-release-contracts/specs/consumer-post-install-validation/spec.md).

const { test, run, assert } = require('./_lib/tinytest');
const { buildEvidence, validateEvidence, normalizeConsumerEvidence, STAGES, VERDICTS, OVERALL_STATES } = require('../scripts/lib/release-evidence');
const releaseEvidence = require('../scripts/lib/release-evidence');

const CONSUMER_CHECK_IDENTITY = {
  contractVersion: 'consumer-check-identity.v1',
  sourceFingerprint: `sha256:${'1'.repeat(64)}`,
  artifactFingerprint: `sha256:${'2'.repeat(64)}`,
  selectionFingerprint: `sha256:${'3'.repeat(64)}`,
  hostVersion: 'codex-cli fixture 1.0',
  configFingerprint: `sha256:${'4'.repeat(64)}`,
};

const CODEX_NATIVE_PROOF = {
  executionOrigin: 'native',
  adapterRoute: 'codex-named-role',
  roles: [{ id: 'security-reviewer', agentTypeAccepted: true, threadId: 'thread-previous', childCompleted: true }],
  registryPreconditions: {
    disposableCodexHome: true,
    authReference: 'symlink',
    projectTrust: 'trusted',
    userConfigIgnored: false,
  },
  cliVersion: 'codex-cli fixture 1.0',
};

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

function requirementEvidenceReport({
  surface = 'codex-sync',
  host = 'codex',
  capability = 'named-role-security-reviewer',
  trigger = 'explicit-native',
  requestedEvidenceKind = 'native',
  evidenceKind = requestedEvidenceKind,
  status = 'PASS',
  adapter = { id: 'codex-named-role-probe', version: '1.0.0' },
  nativeProof = null,
  contractEvidence = null,
  identity = null,
  authorized = true,
  evidenceReuse = null,
} = {}) {
  const verdict = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'BLOCKED';
  const checkKey = `${surface}:${capability}:${evidenceKind}`;
  const evidence = {
    id: 'selected-capability',
    host,
    capability,
    trigger,
    reason: 'Verify only the selected capability.',
    question: 'Did the selected check pass?',
    requestedEvidenceKind,
    evidenceKind,
    authorized,
    checkKey,
    status,
    adapter,
    ...(identity ? { identity } : {}),
    ...(evidenceReuse ? { evidenceReuse } : {}),
    ...(contractEvidence ? { contractEvidence } : {}),
    ...(nativeProof ? { nativeProof } : {}),
    ...(evidenceKind === 'native' && status === 'PASS' ? { runtimeVerified: true } : {}),
  };
  const evidenceRef = `surfaceResults.${surface}.requirementEvidence.check1`;
  return {
    version: '0.43.0',
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    adapter: { id: 'consumer-gate', version: '1.0.0' },
    planFingerprint: `sha256:${'a'.repeat(64)}`,
    artifactFingerprint: `sha256:${'b'.repeat(64)}`,
    schemaVersion: 2,
    verdict,
    runtimeVerified: true,
    surfaceResults: [{
      surface,
      status: 'PASS',
      adapter,
      commands: [],
      environment: { CI: 'true' },
      artifacts: [],
      diagnostics: [],
      reasons: [],
      checkedClaims: [],
      installationEvidence: { status: 'PASS', reason: 'Selected installation contract passed.' },
      runtimeEvidence: { status: 'NOT_RUN', reason: 'No aggregate runtime claim was made.' },
      requirementEvidence: { check1: evidence },
    }],
    acceptance: {
      verdict,
      requiredChecks: [
        {
          id: `install.${surface}`,
          surface,
          kind: 'installation',
          reason: 'Selected installation contract passed.',
          status: 'PASS',
          evidenceRef: `surfaceResults.${surface}.installationEvidence`,
        },
        {
          id: 'requirement.selected-capability',
          surface,
          kind: evidenceKind,
          reason: 'Verify only the selected capability.',
          status,
          evidenceRef,
        },
      ],
      excludedChecks: [],
    },
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


  // Merged from tests/consumer-evidence-normalization.test.js.
  {

    // RED-first contract tests for normalize-consumer-evidence.
    //
    // These tests deliberately describe the additive seam that the first
    // migration wave needs from release-evidence.js.  They do not invoke a
    // consumer process and they do not replace the existing release-gate
    // characterization suites.  In particular, a structural/package PASS is
    // never a runtime proof, and legacy top-level fields remain observable beside
    // the richer per-surface records.

    const releaseEvidence = require('../scripts/lib/release-evidence');

    const CLOSED_STATUSES = [
      'PASS',
      'FAIL',
      'NOT_RUN',
      'NOT_CONFIGURED',
      'SKIP_INCOMPATIBLE',
      'BLOCKED',
      'UNAVAILABLE',
    ];

    const PLAN = 'sha256:' + 'a'.repeat(64);
    const ARTIFACT = 'sha256:' + 'b'.repeat(64);

    function normalize(input) {
      assert.strictEqual(
        typeof releaseEvidence.normalizeConsumerEvidence,
        'function',
        'RED: release-evidence must export normalizeConsumerEvidence',
      );
      return releaseEvidence.normalizeConsumerEvidence(input);
    }

    function baseSurface(overrides = {}) {
      return {
        surface: 'cursor-plugin',
        status: 'PASS',
        adapter: { id: 'consumer-platform-probe', version: '1.0.0' },
        commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform cursor', exitCode: 0 }],
        environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
        artifacts: [{ path: '<sandbox>/plugin.json', fingerprint: ARTIFACT }],
        diagnostics: [{ stream: 'stdout', text: 'cursor probe completed' }],
        reasons: [],
        checkedClaims: ['manifest', 'consumer-route'],
        ...overrides,
      };
    }

    function baseEvidence(overrides = {}) {
      return {
        version: '0.43.0',
        stage: 'CONSUMER',
        producer: 'consumer-platform-probe',
        adapter: { id: 'consumer-platform-probe', version: '1.0.0' },
        planFingerprint: PLAN,
        artifactFingerprint: ARTIFACT,
        surfaceResults: [baseSurface()],
        ...overrides,
      };
    }

    test('normalizes schema-v2 acceptance checks and preserves their observed states', () => {
      const acceptance = {
        verdict: 'PASS',
        requiredChecks: [{
          id: 'install.cursor-plugin',
          surface: 'cursor-plugin',
          kind: 'installation',
          reason: 'Selected package structure and resource closure passed',
          status: 'PASS',
          evidenceRef: 'surfaceResults.cursor-plugin.installationEvidence',
        }],
        excludedChecks: [{
          id: 'runtime.cursor-plugin',
          surface: 'cursor-plugin',
          kind: 'native',
          reason: 'Native runtime was not requested',
          status: 'UNAVAILABLE',
          evidenceRef: 'surfaceResults.cursor-plugin.runtimeEvidence',
        }],
      };
      const surface = baseSurface({
        installationEvidence: { status: 'PASS', reason: 'Package structure passed' },
        runtimeEvidence: { status: 'UNAVAILABLE', reason: 'No Cursor client was configured' },
      });
      const evidence = normalize(baseEvidence({ schemaVersion: 2, acceptance, surfaceResults: [surface] }));

      assert.strictEqual(evidence.schemaVersion, 2);
      assert.deepStrictEqual(evidence.acceptance, acceptance);
      assert.deepStrictEqual(evidence.surfaceResults[0].installationEvidence, surface.installationEvidence);
      assert.deepStrictEqual(evidence.surfaceResults[0].runtimeEvidence, surface.runtimeEvidence);
    });

    test('rejects arbitrary caller fields as evidence for a passing acceptance check', () => {
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        verdict: 'PASS',
        acceptance: {
          verdict: 'PASS',
          requiredChecks: [{
            id: 'install.cursor-plugin',
            surface: 'cursor-plugin',
            kind: 'installation',
            reason: 'Claimed installation evidence',
            status: 'PASS',
            evidenceRef: 'surfaceResults.cursor-plugin.fakeProof',
          }],
          excludedChecks: [],
        },
        surfaceResults: [baseSurface({ fakeProof: { status: 'PASS' } })],
      })), /evidenceRef|typed|supported/i);
    });

    test('does not accept runtime observations as installation evidence', () => {
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        verdict: 'PASS',
        acceptance: {
          verdict: 'PASS',
          requiredChecks: [{
            id: 'install.cursor-plugin',
            surface: 'cursor-plugin',
            kind: 'installation',
            reason: 'Claimed installation evidence',
            status: 'PASS',
            evidenceRef: 'surfaceResults.cursor-plugin.runtimeEvidence',
          }],
          excludedChecks: [],
        },
        surfaceResults: [baseSurface({
          installationEvidence: { status: 'FAIL', reason: 'Installation was invalid' },
          runtimeEvidence: { status: 'PASS', reason: 'Runtime was observed' },
        })],
      })), /evidenceRef|typed|supported/i);
    });

    test('rejects malformed schema-v2 acceptance checks instead of preserving them as valid evidence', () => {
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: {
          verdict: 'PASS',
          requiredChecks: [{ id: 'install.cursor-plugin', surface: 'cursor-plugin', status: 'PASS' }],
          excludedChecks: [],
        },
      })), /acceptance/i);
    });

    test('allows only a blocked scope-selection receipt to carry empty surface results', () => {
      const evidence = normalize({
        version: '0.43.0',
        stage: 'CONSUMER',
        producer: 'consumer-gate',
        adapter: { id: 'consumer-gate', version: '1.0.0' },
        schemaVersion: 2,
        surfaceResults: [],
        acceptance: {
          verdict: 'BLOCKED',
          requiredChecks: [{
            id: 'scope.configuration',
            surface: 'consumer-scope',
            kind: 'contract',
            reason: 'No configured or explicitly selected consumer surface exists',
            status: 'BLOCKED',
            evidenceRef: null,
          }],
          excludedChecks: [{
            id: 'scope.claude-core',
            surface: 'claude-core',
            kind: 'installation',
            reason: 'No configured-target marker was found',
            status: 'NOT_CONFIGURED',
            evidenceRef: null,
          }],
        },
      });
      assert.deepStrictEqual(evidence.surfaceResults, []);
      assert.strictEqual(evidence.acceptance.verdict, 'BLOCKED');

      assert.throws(() => normalize({
        stage: 'CONSUMER',
        producer: 'consumer-gate',
        schemaVersion: 2,
        surfaceResults: [],
        acceptance: {
          verdict: 'PASS',
          requiredChecks: [{
            id: 'scope.configuration', surface: 'consumer-scope', kind: 'contract',
            reason: 'No scope', status: 'PASS', evidenceRef: null,
          }],
          excludedChecks: [],
        },
      }), /surface results|scope-selection/i);
    });

    test('rejects acceptance checks that mismatch their referenced surface or observed status', () => {
      const passingCheck = {
        id: 'install.cursor-plugin',
        surface: 'cursor-plugin',
        kind: 'installation',
        reason: 'Package installation contract passed',
        status: 'PASS',
        evidenceRef: 'surfaceResults.cursor-plugin.installationEvidence',
      };
      const baseAcceptance = { verdict: 'PASS', requiredChecks: [passingCheck], excludedChecks: [] };
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: baseAcceptance,
        surfaceResults: [baseSurface({ installationEvidence: { status: 'FAIL' } })],
      })), /acceptance.*status|status.*acceptance/i);

      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: {
          ...baseAcceptance,
          requiredChecks: [{ ...passingCheck, surface: 'agent-plugin' }],
        },
        surfaceResults: [
          baseSurface({ installationEvidence: { status: 'PASS' } }),
          baseSurface({ surface: 'agent-plugin', installationEvidence: { status: 'PASS' } }),
        ],
      })), /acceptance.*surface|surface.*acceptance/i);

      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: {
          ...baseAcceptance,
          requiredChecks: [{
            ...passingCheck,
            evidenceRef: 'surfaceResults.cursor-plugin.installationEvidence.reason',
          }],
        },
        surfaceResults: [baseSurface({ installationEvidence: { status: 'FAIL', reason: 'package is invalid' } })],
      })), /acceptance.*status|status.*acceptance/i);
    });

    test('rejects dangling acceptance references through null intermediate values', () => {
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: {
          verdict: 'BLOCKED',
          requiredChecks: [{
            id: 'runtime.cursor-plugin',
            surface: 'cursor-plugin',
            kind: 'native',
            reason: 'Runtime evidence was not requested',
            status: 'PENDING',
            evidenceRef: 'surfaceResults.cursor-plugin.runtimeEvidence.status',
          }],
          excludedChecks: [],
        },
        surfaceResults: [baseSurface({ runtimeEvidence: null })],
      })), /acceptance.*evidenceRef|evidenceRef.*acceptance/i);
    });

    test('bounds schema-v2 required and excluded acceptance check counts', () => {
      const checks = (prefix) => Array.from({ length: 101 }, (_, index) => ({
        id: `${prefix}-${index}`,
        surface: 'cursor-plugin',
        kind: 'native',
        reason: 'Bounded pending native check',
        status: 'PENDING',
        evidenceRef: null,
      }));
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: { verdict: 'BLOCKED', requiredChecks: checks('required'), excludedChecks: [] },
      })), /acceptance.*count|too many.*acceptance/i);
      assert.throws(() => normalize(baseEvidence({
        schemaVersion: 2,
        acceptance: { verdict: 'PASS', requiredChecks: [{
          id: 'install.cursor-plugin',
          surface: 'cursor-plugin',
          kind: 'installation',
          reason: 'Package structure passed',
          status: 'PASS',
          evidenceRef: 'surfaceResults.cursor-plugin.installationEvidence',
        }], excludedChecks: checks('excluded') },
        surfaceResults: [baseSurface({ installationEvidence: { status: 'PASS' } })],
      })), /acceptance.*count|too many.*acceptance/i);
    });

    test('keeps historical consumer evidence unversioned and without synthesized acceptance', () => {
      const historical = normalize(baseEvidence());
      assert.strictEqual(historical.schemaVersion, undefined);
      assert.strictEqual(historical.acceptance, undefined);
    });

    test('does not preserve runtimeVerified on schema-v2 installation-only acceptance', () => {
      const surface = baseSurface({
        status: 'PASS',
        installationEvidence: { status: 'PASS', reason: 'Package installation structure passed' },
      });
      const evidence = normalize(baseEvidence({
        schemaVersion: 2,
        runtimeVerified: true,
        acceptance: {
          verdict: 'PASS',
          requiredChecks: [{
            id: 'install.cursor-plugin',
            surface: 'cursor-plugin',
            kind: 'installation',
            reason: 'Package installation structure passed',
            status: 'PASS',
            evidenceRef: 'surfaceResults.cursor-plugin.installationEvidence',
          }],
          excludedChecks: [],
        },
        surfaceResults: [surface],
      }));
      assert.strictEqual(Object.prototype.hasOwnProperty.call(evidence, 'runtimeVerified'), false);

      const historical = normalize(baseEvidence({ runtimeVerified: true }));
      assert.strictEqual(historical.runtimeVerified, true, 'legacy behavior remains unchanged without acceptance');
    });

    test('roundtrips a flat capability identity and typed proof for an explicitly reused native result', () => {
      const source = requirementEvidenceReport({
        identity: CONSUMER_CHECK_IDENTITY,
        nativeProof: CODEX_NATIVE_PROOF,
        authorized: false,
        evidenceReuse: {
          decision: 'REUSED',
          origin: { envelopeIndex: 0, surface: 'codex-sync', slot: 'check1', checkId: 'prior-capability' },
          mismatchFields: [],
        },
      });

      const normalized = normalizeConsumerEvidence(JSON.parse(JSON.stringify(source)));
      const evidence = normalized.surfaceResults[0].requirementEvidence.check1;
      assert.deepStrictEqual(evidence.identity, CONSUMER_CHECK_IDENTITY);
      assert.deepStrictEqual(evidence.nativeProof, CODEX_NATIVE_PROOF);
      assert.strictEqual(evidence.authorized, false, 'reuse must not copy execution authorization');
      assert.strictEqual(evidence.evidenceReuse.decision, 'REUSED');
      assert.strictEqual(evidence.evidenceReuse.origin.checkId, 'prior-capability');

      const roundTrip = normalizeConsumerEvidence(JSON.parse(JSON.stringify(normalized)));
      const roundTripEvidence = roundTrip.surfaceResults[0].requirementEvidence.check1;
      assert.deepStrictEqual(roundTripEvidence.identity, CONSUMER_CHECK_IDENTITY);
      assert.deepStrictEqual(roundTripEvidence.nativeProof, CODEX_NATIVE_PROOF);
      assert.strictEqual(roundTripEvidence.evidenceReuse.origin.envelopeIndex, 0);
      assert.strictEqual(roundTripEvidence.runtimeVerified, true);
    });

    test('rejects malformed capability identity fields instead of filling missing values', () => {
      const release = require('../scripts/lib/release-evidence');
      assert.strictEqual(typeof release.normalizeConsumerCheckIdentity, 'function');
      assert.deepStrictEqual(
        release.normalizeConsumerCheckIdentity(CONSUMER_CHECK_IDENTITY),
        CONSUMER_CHECK_IDENTITY,
      );
      for (const identity of [
        { ...CONSUMER_CHECK_IDENTITY, sourceFingerprint: undefined },
        { ...CONSUMER_CHECK_IDENTITY, artifactFingerprint: 'not-a-sha256' },
        { ...CONSUMER_CHECK_IDENTITY, contractVersion: 'consumer-check-identity.v2' },
        { ...CONSUMER_CHECK_IDENTITY, extra: 'not in the frozen identity contract' },
      ]) {
        assert.throws(() => release.normalizeConsumerCheckIdentity(identity));
      }
    });

    test('matches native evidence by exact capability identity while ignoring request attribution', () => {
      const release = require('../scripts/lib/release-evidence');
      assert.strictEqual(typeof release.matchConsumerCheckEvidence, 'function');
      const oldEnvelope = normalizeConsumerEvidence(requirementEvidenceReport({
        identity: CONSUMER_CHECK_IDENTITY,
        nativeProof: CODEX_NATIVE_PROOF,
      }));
      oldEnvelope.producer = 'harness';
      oldEnvelope.workflow = 'different-workflow';
      const previous = oldEnvelope.surfaceResults[0].requirementEvidence.check1;
      previous.id = 'old-request-id';
      previous.reason = 'old request reason';
      previous.question = 'old request question';
      const expected = {
        checkKey: 'codex-sync:named-role-security-reviewer:native',
        evidenceKind: 'native',
        identity: CONSUMER_CHECK_IDENTITY,
      };
      const candidate = {
        envelopeIndex: 0,
        surface: 'codex-sync',
        slot: 'check1',
        evidence: previous,
        producer: oldEnvelope.producer,
        workflow: oldEnvelope.workflow,
      };

      const selected = release.matchConsumerCheckEvidence(expected, [candidate]);
      assert.strictEqual(selected.decision, 'REUSED');
      assert.strictEqual(selected.selected.id, 'old-request-id');
      assert.deepStrictEqual(selected.mismatchFields, []);
    });

    test('reports each changed identity component and rejects non-native or contradictory candidates', () => {
      const release = require('../scripts/lib/release-evidence');
      assert.strictEqual(typeof release.matchConsumerCheckEvidence, 'function');
      const expected = {
        checkKey: 'codex-sync:named-role-security-reviewer:native',
        evidenceKind: 'native',
        identity: CONSUMER_CHECK_IDENTITY,
      };
      const passEnvelope = normalizeConsumerEvidence(requirementEvidenceReport({
        identity: CONSUMER_CHECK_IDENTITY,
        nativeProof: CODEX_NATIVE_PROOF,
      }));
      const passEvidence = passEnvelope.surfaceResults[0].requirementEvidence.check1;
      const candidate = (evidence, envelopeIndex = 0) => ({
        envelopeIndex,
        surface: 'codex-sync',
        slot: 'check1',
        evidence,
      });

      for (const field of ['sourceFingerprint', 'artifactFingerprint', 'selectionFingerprint', 'hostVersion', 'configFingerprint']) {
        const changed = {
          ...passEvidence,
          identity: {
            ...CONSUMER_CHECK_IDENTITY,
            [field]: field === 'hostVersion' ? 'codex-cli fixture 2.0' : `sha256:${'f'.repeat(64)}`,
          },
        };
        const rejected = release.matchConsumerCheckEvidence(expected, [candidate(changed)]);
        assert.strictEqual(rejected.decision, 'REJECTED', field);
        assert.ok(rejected.mismatchFields.includes(field), `${field}: ${JSON.stringify(rejected)}`);
      }

      const markerOnly = release.matchConsumerCheckEvidence(expected, [candidate({
        ...passEvidence,
        nativeProof: undefined,
        runtimeVerified: true,
      })]);
      assert.notStrictEqual(markerOnly.decision, 'REUSED', 'runtimeVerified alone cannot replace typed native proof');

      const failedEnvelope = normalizeConsumerEvidence(requirementEvidenceReport({
        identity: CONSUMER_CHECK_IDENTITY,
        status: 'FAIL',
        nativeProof: null,
      }));
      const failed = failedEnvelope.surfaceResults[0].requirementEvidence.check1;
      const conflict = release.matchConsumerCheckEvidence(expected, [
        candidate(passEvidence, 0),
        candidate(failed, 1),
      ]);
      assert.strictEqual(conflict.decision, 'CONFLICT');
    });

    test('exports exactly the closed canonical consumer status vocabulary', () => {
      assert.ok(releaseEvidence.CONSUMER_EVIDENCE_STATUSES, 'RED: missing CONSUMER_EVIDENCE_STATUSES');
      assert.deepStrictEqual(
        Object.values(releaseEvidence.CONSUMER_EVIDENCE_STATUSES).sort(),
        [...CLOSED_STATUSES].sort(),
      );
    });

    test('normalizes a platform result into one stage-bound per-surface record', () => {
      const evidence = normalize(baseEvidence());
      assert.strictEqual(evidence.stage, 'CONSUMER');
      assert.strictEqual(evidence.producer, 'consumer-platform-probe');
      assert.deepStrictEqual(evidence.adapter, { id: 'consumer-platform-probe', version: '1.0.0' });
      assert.strictEqual(evidence.planFingerprint, PLAN);
      assert.strictEqual(evidence.artifactFingerprint, ARTIFACT);
      assert.ok(Array.isArray(evidence.surfaceResults));
      assert.strictEqual(evidence.surfaceResults.length, 1);
      assert.strictEqual(evidence.surfaceResults[0].surface, 'cursor-plugin');
      assert.strictEqual(evidence.surfaceResults[0].status, 'PASS');
    });

    test('retains commands, environment, artifacts, diagnostics, reasons, and checked claims', () => {
      const surface = baseSurface({
        commands: [{ cmd: 'probe --safe', exitCode: 17, durationMs: 42 }],
        environment: { HOME: '<sandbox>', PATH: '<allowlisted>', CI: 'true' },
        artifacts: [{ path: '<sandbox>/output.json', fingerprint: 'sha256:' + 'c'.repeat(64) }],
        diagnostics: [{ stream: 'stderr', text: 'bounded diagnostic', code: 'E_PROBE' }],
        reasons: ['consumer route exited 17'],
        checkedClaims: ['manifest', 'version', 'fingerprint'],
        status: 'FAIL',
      });
      const evidence = normalize(baseEvidence({ surfaceResults: [surface] }));
      assert.deepStrictEqual(evidence.surfaceResults[0].commands, surface.commands);
      assert.deepStrictEqual(evidence.surfaceResults[0].environment, surface.environment);
      assert.deepStrictEqual(evidence.surfaceResults[0].artifacts, surface.artifacts);
      assert.deepStrictEqual(evidence.surfaceResults[0].diagnostics, surface.diagnostics);
      assert.deepStrictEqual(evidence.surfaceResults[0].reasons, surface.reasons);
      assert.deepStrictEqual(evidence.surfaceResults[0].checkedClaims, surface.checkedClaims);
    });

    test('normalization redacts credentials and bounds oversized diagnostics', () => {
      const marker = 'CONSUMER_EVIDENCE_SECRET_MARKER_123456789';
      const evidence = normalize(baseEvidence({
        surfaceResults: [baseSurface({
          diagnostics: [{
            stream: 'stderr',
            text: `Authorization: Bearer ${marker}\n${'x'.repeat(20000)}`,
          }],
        })],
      }));
      const diagnosticText = JSON.stringify(evidence.surfaceResults[0].diagnostics);
      assert.doesNotMatch(diagnosticText, new RegExp(marker));
      assert.match(diagnosticText, /<redacted>/i);
      assert.ok(diagnosticText.length < 12000, `diagnostics were not bounded: ${diagnosticText.length}`);
    });

    test('normalization redacts sensitive adapter metadata as well as result values', () => {
      const marker = 'ADAPTER_SECRET_MARKER_123456789';
      const evidence = normalize(baseEvidence({
        adapter: { id: 'consumer-platform-probe', version: '1.0.0', token: marker },
        surfaceResults: [baseSurface({ adapter: { id: 'consumer-platform-probe', token: marker } })],
      }));
      const serialized = JSON.stringify(evidence);
      assert.doesNotMatch(serialized, new RegExp(marker));
      assert.match(serialized, /redacted/i);
    });

    test('rejects an invalid status rather than synthesizing consumer PASS', () => {
      assert.throws(
        () => normalize(baseEvidence({ surfaceResults: [baseSurface({ status: 'PENDING' })] })),
        /status|verdict|closed|invalid/i,
      );
      assert.throws(
        () => normalize(baseEvidence({ surfaceResults: [baseSurface({ status: 'WARN' })] })),
        /status|closed|invalid/i,
      );
    });

    test('rejects missing stage, surface, or status fields as a structured normalization failure', () => {
      for (const [label, patch] of [
        ['stage', { stage: undefined }],
        ['surface', { surfaceResults: [baseSurface({ surface: undefined })] }],
        ['status', { surfaceResults: [baseSurface({ status: undefined })] }],
      ]) {
        assert.throws(
          () => normalize(baseEvidence(patch)),
          /stage|surface|status|verdict|required|missing/i,
          `missing ${label} must fail closed`,
        );
      }
      assert.throws(() => normalize({ surfaceResults: [baseSurface()] }), /stage|missing|invalid/i);
      assert.throws(() => normalize(baseEvidence({ stage: 'RUNTIME' })), /stage|invalid/i);
    });

    test('rejects duplicate surface records instead of silently merging evidence', () => {
      assert.throws(
        () => normalize(baseEvidence({ surfaceResults: [baseSurface(), baseSurface()] })),
        /duplicate|surface/i,
      );
    });

    test('rejects missing or stale projection bindings when plan and artifact identities apply', () => {
      assert.throws(
        () => normalize(baseEvidence({ artifactFingerprint: undefined })),
        /artifact|binding|fingerprint|required/i,
      );
      assert.throws(
        () => normalize(baseEvidence({ surfaceResults: [baseSurface({ planFingerprint: 'sha256:' + 'd'.repeat(64) })] })),
        /plan|stale|mismatch|binding|fingerprint/i,
      );
    });

    test('rejects a surface stage override and incomplete per-surface identity pair', () => {
      assert.throws(
        () => normalize(baseEvidence({ surfaceResults: [baseSurface({ stage: 'PACKAGE' })] })),
        /stage|enclosing/i,
      );
      assert.throws(
        () => normalize(baseEvidence({ planFingerprint: undefined, artifactFingerprint: undefined, surfaceResults: [baseSurface({ planFingerprint: PLAN })] })),
        /pair|artifact|binding/i,
      );
      assert.throws(
        () => normalize(baseEvidence({ surfaceResults: [baseSurface({ artifactFingerprint: 'not-a-fingerprint' })] })),
        /pair|fingerprint|invalid/i,
      );
    });

    test('keeps structural PASS separate from consumer-runtime proof', () => {
      const evidence = normalize(baseEvidence({
        stage: 'PACKAGE',
        producer: 'package-gate',
        adapter: { id: 'package-validator', version: '1.0.0' },
        runtimeVerified: true,
        runtimeStatus: 'PASS',
        surfaceResults: [baseSurface({
          surface: 'agent-plugin',
          status: 'PASS',
          checkedClaims: ['package-manifest', 'planned-output-fingerprints'],
        })],
      }));
      assert.strictEqual(evidence.stage, 'PACKAGE');
      assert.strictEqual(evidence.surfaceResults[0].status, 'PASS');
      assert.notStrictEqual(evidence.runtimeVerified, true, 'structural PASS must not claim runtime verification');
      assert.notStrictEqual(evidence.runtimeStatus, 'PASS', 'structural PASS must not become runtime PASS');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(evidence, 'runtimeVerified'), false);
      const unavailable = normalize(baseEvidence({ runtimeVerified: true, surfaceResults: [baseSurface({ status: 'UNAVAILABLE' })] }));
      assert.strictEqual(Object.prototype.hasOwnProperty.call(unavailable, 'runtimeVerified'), false);
    });

    test('preserves each non-pass surface outcome when aggregate evidence is PASS-compatible', () => {
      const evidence = normalize(baseEvidence({
        aggregate: { verdict: 'PASS', legacySurfaceStatus: 'WARN', warnings: ['native surface differs'] },
        surfaceResults: [
          baseSurface({ surface: 'codex-sync', status: 'PASS' }),
          baseSurface({ surface: 'codex-native', status: 'UNAVAILABLE', reasons: ['codex CLI is not installed'] }),
        ],
      }));
      assert.strictEqual(evidence.aggregate.verdict, 'PASS');
      assert.strictEqual(evidence.aggregate.legacySurfaceStatus, 'WARN');
      assert.deepStrictEqual(evidence.aggregate.warnings, ['native surface differs']);
      assert.strictEqual(evidence.surfaceResults.find((r) => r.surface === 'codex-native').status, 'UNAVAILABLE');
      assert.notStrictEqual(evidence.surfaceResults.find((r) => r.surface === 'codex-native').status, 'PASS');
    });

    test('does not merge install lifecycle summaries into the canonical consumer vocabulary', () => {
      assert.throws(
        () => normalize(baseEvidence({
          lifecycle: { aggregate: 'INSTALL_PASS' },
          surfaceResults: [baseSurface({ status: 'INSTALL_PASS' })],
        })),
        /status|verdict|lifecycle|closed|invalid/i,
      );
      const evidence = normalize(baseEvidence({ lifecycle: { aggregate: 'INSTALL_PASS' } }));
      assert.deepStrictEqual(evidence.lifecycle, { aggregate: 'INSTALL_PASS' });
      assert.ok(CLOSED_STATUSES.includes(evidence.surfaceResults[0].status));
    });

    test('legacy compatibility marker preserves top-level gate fields and does not create false runtime PASS', () => {
      const legacy = {
        version: '0.43.0',
        stage: 'CONSUMER',
        compatibility: { legacy: true },
        verdict: 'UNAVAILABLE',
        commands: [{ cmd: 'node scripts/release/consumer-gate.js', exitCode: 0 }],
        environment: 'ci',
        artifacts: ['claude-official-strict: NOT RUN'],
        failureReasons: ['claude CLI not found on PATH'],
        surfaceResults: [baseSurface({ surface: 'claude', status: 'UNAVAILABLE' })],
      };
      const evidence = normalize(legacy);
      assert.strictEqual(evidence.verdict, 'UNAVAILABLE');
      assert.deepStrictEqual(evidence.commands, legacy.commands);
      assert.strictEqual(evidence.environment, legacy.environment);
      assert.deepStrictEqual(evidence.artifacts, legacy.artifacts);
      assert.deepStrictEqual(evidence.failureReasons, legacy.failureReasons);
      assert.deepStrictEqual(evidence.compatibility, { legacy: true });
      assert.strictEqual(evidence.surfaceResults[0].status, 'UNAVAILABLE');
    });
  }

test('accepts a bounded singleton Codex role proof only on its capability evidence', () => {
  const report = requirementEvidenceReport({
    nativeProof: {
      executionOrigin: 'native',
      adapterRoute: 'codex-named-role',
      roles: [{ id: 'security-reviewer', agentTypeAccepted: true, threadId: 'thread-1', childCompleted: true }],
      registryPreconditions: { disposableCodexHome: true, authReference: 'symlink', projectTrust: 'trusted', userConfigIgnored: false },
      cliVersion: 'codex-cli fixture',
    },
  });
  const normalized = normalizeConsumerEvidence(report);
  const requirement = normalized.surfaceResults[0].requirementEvidence.check1;
  assert.strictEqual(requirement.status, 'PASS');
  assert.deepStrictEqual(requirement.nativeProof.roles, [{
    id: 'security-reviewer',
    agentTypeAccepted: true,
    threadId: 'thread-1',
    childCompleted: true,
  }]);
  assert.strictEqual(requirement.nativeProof.cliVersion, 'codex-cli fixture');
  assert.strictEqual(requirement.runtimeVerified, true);
  assert.notStrictEqual(normalized.runtimeVerified, true);
  assert.strictEqual(normalized.acceptance.requiredChecks[1].evidenceRef, 'surfaceResults.codex-sync.requirementEvidence.check1');
});

test('accepts Cursor package-loader native proof only with a challenged sandboxed authenticated session', () => {
  const makeReport = (nativeProof) => requirementEvidenceReport({
    surface: 'cursor-plugin',
    host: 'cursor',
    capability: 'package-loader',
    adapter: { id: 'consumer-platform-probe', version: '1.0.0' },
    nativeProof,
  });
  const validProof = {
    executionOrigin: 'native',
    adapterRoute: 'cursor-plugin-loader',
    exit_code: 0,
    network: 'shared',
    challenge_verified: true,
    loader_attestation: true,
    session_files: ['.config/cursor/auth.json'],
  };
  const normalized = normalizeConsumerEvidence(makeReport(validProof));
  assert.deepStrictEqual(normalized.surfaceResults[0].requirementEvidence.check1.nativeProof, validProof);
  for (const invalidProof of [
    { ...validProof, network: 'unknown' },
    { ...validProof, challenge_verified: false },
    { ...validProof, loader_attestation: false },
    { ...validProof, session_files: [] },
    { ...validProof, exit_code: 1 },
  ]) {
    assert.throws(() => normalizeConsumerEvidence(makeReport(invalidProof)), /native|proof|runtime|evidence/i);
  }
});

test('fixture and mismatched Codex role proofs cannot satisfy native acceptance', () => {
  const proof = {
    executionOrigin: 'native',
    adapterRoute: 'codex-named-role',
    roles: [{ id: 'security-reviewer', agentTypeAccepted: true, threadId: 'thread-1', childCompleted: true }],
    registryPreconditions: { disposableCodexHome: true, authReference: 'symlink', projectTrust: 'trusted', userConfigIgnored: false },
  };
  assert.throws(() => normalizeConsumerEvidence(requirementEvidenceReport({
    nativeProof: { ...proof, executionOrigin: 'fixture' },
  })), /native|proof|origin|evidence/i);
  assert.throws(() => normalizeConsumerEvidence(requirementEvidenceReport({
    nativeProof: { ...proof, executionOrigin: 'static' },
  })), /native|proof|origin|evidence/i);
  assert.throws(() => normalizeConsumerEvidence(requirementEvidenceReport({
    capability: 'named-role-explorer',
    nativeProof: proof,
  })), /native|proof|role|capability/i);
  assert.throws(() => normalizeConsumerEvidence(requirementEvidenceReport({
    surface: 'codex-native',
    nativeProof: proof,
  })), /native|proof|surface|capability/i);
});

test('contract proof cannot set runtimeVerified and preserves receipt-bound hashes beyond envelope depth', () => {
  const report = requirementEvidenceReport({
    requestedEvidenceKind: 'contract',
    evidenceKind: 'contract',
    trigger: 'activation-defect',
    adapter: { id: 'codex-role-materialization', version: '1.0.0' },
    contractEvidence: {
      status: 'PASS',
      adapterRoute: 'codex-role-materialization',
      role: {
        path: 'agents/security-reviewer.toml',
        sourceFingerprint: 'c'.repeat(64),
        destinationFingerprint: 'c'.repeat(64),
      },
      resources: [{
        path: '.codex/dhpk/agent-traps/_common/prompt-defense.md',
        sourceFingerprint: 'd'.repeat(64),
        destinationFingerprint: 'd'.repeat(64),
      }],
    },
  });
  report.surfaceResults[0].requirementEvidence.check1.runtimeVerified = true;
  const normalized = normalizeConsumerEvidence(report);
  const requirement = normalized.surfaceResults[0].requirementEvidence.check1;
  assert.strictEqual(requirement.contractEvidence.role.path, 'agents/security-reviewer.toml');
  assert.strictEqual(requirement.contractEvidence.role.sourceFingerprint, 'c'.repeat(64));
  assert.strictEqual(requirement.contractEvidence.role.destinationFingerprint, 'c'.repeat(64));
  assert.strictEqual(requirement.contractEvidence.resources[0].sourceFingerprint, 'd'.repeat(64));
  assert.notStrictEqual(requirement.runtimeVerified, true);
  assert.notStrictEqual(normalized.runtimeVerified, true);
});

test('Codex role contract rejects resource paths that exceed the bounded evidence length', () => {
  const report = requirementEvidenceReport({
    requestedEvidenceKind: 'contract',
    evidenceKind: 'contract',
    trigger: 'activation-defect',
    adapter: { id: 'codex-role-materialization', version: '1.0.0' },
    contractEvidence: {
      status: 'PASS',
      adapterRoute: 'codex-role-materialization',
      role: {
        path: 'agents/security-reviewer.toml',
        sourceFingerprint: 'c'.repeat(64),
        destinationFingerprint: 'c'.repeat(64),
      },
      resources: [{
        path: `.codex/dhpk/${'a'.repeat(20_000)}.md`,
        sourceFingerprint: 'd'.repeat(64),
        destinationFingerprint: 'd'.repeat(64),
      }],
    },
  });
  assert.throws(() => normalizeConsumerEvidence(report), /resource.*(?:invalid|bounded|length|path)|path.*(?:invalid|bounded|length)/i);
});

test('binds each requirement evidence slot bijectively to one exact required acceptance check', () => {
  const codexRoleProof = {
    executionOrigin: 'native',
    adapterRoute: 'codex-named-role',
    roles: [{ id: 'security-reviewer', agentTypeAccepted: true, threadId: 'thread-1', childCompleted: true }],
    registryPreconditions: {
      disposableCodexHome: true,
      authReference: 'symlink',
      projectTrust: 'trusted',
      userConfigIgnored: false,
    },
  };
  const invalidReports = [
    ['omitted required check', (report) => {
      report.acceptance.requiredChecks = report.acceptance.requiredChecks
        .filter((check) => check.id !== 'requirement.selected-capability');
    }],
    ['excluded requirement', (report) => {
      const [installation] = report.acceptance.requiredChecks;
      const requirement = report.acceptance.requiredChecks[1];
      report.acceptance.requiredChecks = [installation];
      report.acceptance.excludedChecks.push(requirement);
    }],
    ['substituted installation reference', (report) => {
      report.acceptance.requiredChecks[1].evidenceRef = 'surfaceResults.codex-sync.installationEvidence';
    }],
    ['mismatched requirement id', (report) => {
      report.acceptance.requiredChecks[1].id = 'requirement.different-capability';
    }],
    ['mismatched effective evidence kind', (report) => {
      report.acceptance.requiredChecks[1].kind = 'contract';
    }],
    ['mismatched requirement status', (report) => {
      report.acceptance.requiredChecks[1].status = 'BLOCKED';
      report.acceptance.verdict = 'BLOCKED';
      report.verdict = 'BLOCKED';
    }],
    ['duplicate reference to one evidence slot', (report) => {
      report.acceptance.requiredChecks.push({
        ...report.acceptance.requiredChecks[1],
        id: 'requirement.duplicate-reference',
      });
    }],
    ['unreferenced requirement evidence slot', (report) => {
      report.surfaceResults[0].requirementEvidence.check2 = {
        ...report.surfaceResults[0].requirementEvidence.check1,
        id: 'unreferenced-capability',
      };
    }],
  ];

  for (const [label, mutate] of invalidReports) {
    const report = requirementEvidenceReport({ nativeProof: codexRoleProof });
    mutate(report);
    assert.throws(
      () => normalizeConsumerEvidence(report),
      /requirement|acceptance|evidenceRef/i,
      label,
    );
  }

  const blockedLoader = requirementEvidenceReport({
    surface: 'cursor-plugin',
    host: 'cursor',
    capability: 'package-loader',
    status: 'BLOCKED',
    adapter: { id: 'consumer-platform-probe', version: '1.0.0' },
  });
  blockedLoader.surfaceResults[0].requirementEvidence.check1.authorized = false;
  blockedLoader.surfaceResults[0].requirementEvidence.check1.observedStatus = 'UNAVAILABLE';
  blockedLoader.acceptance.requiredChecks = blockedLoader.acceptance.requiredChecks
    .filter((check) => check.id === 'install.cursor-plugin');
  blockedLoader.acceptance.verdict = 'PASS';
  blockedLoader.verdict = 'PASS';
  assert.throws(
    () => normalizeConsumerEvidence(blockedLoader),
    /requirement|acceptance/i,
    'a blocked native loader cannot pass through installation-only acceptance',
  );

  assert.doesNotThrow(() => normalizeConsumerEvidence(requirementEvidenceReport({ status: 'BLOCKED' })));
  assert.doesNotThrow(() => normalizeConsumerEvidence(requirementEvidenceReport({ status: 'FAIL' })));
});

run('release-evidence');
