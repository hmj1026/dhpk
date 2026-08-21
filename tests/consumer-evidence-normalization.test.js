'use strict';

// RED-first contract tests for normalize-consumer-evidence.
//
// These tests deliberately describe the additive seam that the first
// migration wave needs from release-evidence.js.  They do not invoke a
// consumer process and they do not replace the existing release-gate
// characterization suites.  In particular, a structural/package PASS is
// never a runtime proof, and legacy top-level fields remain observable beside
// the richer per-surface records.

const { test, run, assert } = require('./_lib/tinytest');
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

run('consumer-evidence-normalization');
