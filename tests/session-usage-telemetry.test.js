'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { test, run, assert } = require('./_lib/tinytest');

process.env.DHPK_SESSION_USAGE_AUDIT_TEST_MODE = '1';

const ROOT = path.join(__dirname, '..');
const AUDIT = path.join(ROOT, 'skills', 'dhpk-session-usage-audit', 'scripts', 'session-usage-audit');
const CONTRACT = path.join(ROOT, 'skills', 'dhpk-session-usage-audit', 'scripts', 'lib', 'usage-contract');
const FIXTURE = path.join(__dirname, 'fixtures', 'session-usage-telemetry', 'contract.json');
let audit;
let usageContract;
try {
  audit = require(AUDIT);
} catch (error) {
  audit = { __loadError: error };
}
try {
  usageContract = require(CONTRACT);
} catch (error) {
  usageContract = { __loadError: error };
}

function readFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function fixtureHome(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-session-telemetry-${label}-`));
}

function writeSession(home, relativePath, record) {
  const file = path.join(home, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

function fixtureRecord(sessionId, text = '/dhpk:dhpk-issue-analyze') {
  return {
    type: 'assistant',
    timestamp: '2026-08-06T01:00:00Z',
    sessionId,
    message: {
      content: [{ type: 'text', text }],
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: 80,
        output_tokens: 10,
        prompt: 'SYNTHETIC_PROMPT_SENTINEL',
      },
    },
    credential: 'PRIVATE_TELEMETRY_SENTINEL',
  };
}

function runFixtureAudit(home, output, additionalArgs = [], extraOptions = {}) {
  const fixture = readFixture();
  return audit.runAudit({
    argv: [
      '--date', fixture.syntheticInput.dateRange.from,
      '--source', fixture.syntheticInput.source,
      ...additionalArgs,
    ],
    home,
    testFixtureHome: true,
    output,
    now: new Date('2026-08-06T04:00:00Z'),
    timeZone: fixture.syntheticInput.timeZone,
    write: true,
    ...extraOptions,
  });
}

test('Phase 1 exposes the nullable telemetry contract helper', () => {
  assert.ifError(usageContract.__loadError);
  assert.strictEqual(typeof usageContract.createScalar, 'function');
});

test('the existing audit accepts the opt-in telemetry flag', () => {
  assert.ifError(audit.__loadError);
  assert.doesNotThrow(() => audit.parseArgs(['--usage-telemetry'], { home: process.env.HOME }));
});

test('scalar contract preserves observed zero separately from an unsupported counter', () => {
  assert.ifError(usageContract.__loadError);
  const fixture = readFixture();
  const evidence = `evidence:${'a'.repeat(64)}`;
  const zero = usageContract.createScalar({
    field: 'cache_write_input', value: 0, status: 'observed', evidence_refs: [evidence],
  });
  const unsupported = usageContract.createScalar({
    field: 'cache_read_input', value: null, status: 'unsupported', evidence_refs: [],
    reason: fixture.phase1.unsupportedReason,
  });

  assert.deepStrictEqual(Object.keys(zero).sort(), [...fixture.scalarFields].sort());
  assert.strictEqual(zero.value, 0);
  assert.strictEqual(zero.status, 'observed');
  assert.deepStrictEqual(zero.evidence_refs, [evidence]);
  assert.strictEqual(unsupported.value, null);
  assert.strictEqual(unsupported.status, 'unsupported');
  assert.strictEqual(unsupported.reason, fixture.phase1.unsupportedReason);
});

test('invalid negative and unsafe counters become null conflicts', () => {
  assert.ifError(usageContract.__loadError);
  const fixture = readFixture();
  for (const value of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    const result = usageContract.createScalar({ field: 'reported_input', value, status: 'observed' });
    assert.strictEqual(result.value, null);
    assert.strictEqual(result.status, 'conflict');
    assert.strictEqual(result.reason, fixture.phase1.invalidCounterReason);
  }
});

test('requested and observed effort remain separate opaque nullable identities', () => {
  assert.ifError(usageContract.__loadError);
  const fixture = readFixture();
  const evidence = `evidence:${'b'.repeat(64)}`;
  const requested = usageContract.createScalar({
    field: 'requested_effort', value: 'high', status: 'observed', evidence_refs: [evidence],
  });
  const observed = usageContract.createScalar({
    field: 'observed_effort', value: null, status: 'unavailable', evidence_refs: [],
    reason: fixture.phase1.missingReason,
  });
  const serialized = JSON.stringify({ requested, observed });

  assert.match(requested.value, new RegExp(fixture.phase1.identityPattern));
  assert.strictEqual(requested.status, 'observed');
  assert.deepStrictEqual(requested.evidence_refs, [evidence]);
  assert.match(requested.evidence_refs[0], new RegExp(fixture.phase1.evidenceRefPattern));
  assert.strictEqual(observed.value, null);
  assert.strictEqual(observed.status, 'unavailable');
  assert.ok(!serialized.includes('high'));
});

test('derived scalar requires a rule and evidence inputs and freezes its nested DTO', () => {
  assert.ifError(usageContract.__loadError);
  const evidence = `evidence:${'c'.repeat(64)}`;
  const derived = usageContract.createScalar({
    field: 'fresh_input',
    value: 20,
    status: 'derived',
    evidence_refs: [evidence],
    derivation: { rule: 'inclusive-input-minus-cache', inputs: [evidence] },
  });

  assert.deepStrictEqual(derived.derivation, { rule: 'inclusive-input-minus-cache', inputs: [evidence] });
  assert.ok(Object.isFrozen(derived));
  assert.ok(Object.isFrozen(derived.evidence_refs));
  assert.ok(Object.isFrozen(derived.derivation));
  assert.ok(Object.isFrozen(derived.derivation.inputs));
  assert.throws(() => usageContract.createScalar({
    field: 'fresh_input', value: 20, status: 'derived', evidence_refs: [evidence],
  }), /derivation/i);
});

test('scalar contract rejects unknown fields and untrusted evidence references', () => {
  assert.ifError(usageContract.__loadError);
  assert.throws(() => usageContract.createScalar({ field: 'prompt', value: 'secret' }), /field/i);
  assert.throws(() => usageContract.createScalar({
    field: 'reported_input', value: 1, status: 'observed', evidence_refs: ['/tmp/private/session.jsonl'],
  }), /evidence/i);
});

test('Phase 1 builder leaves counters and identities nullable and unsupported', () => {
  assert.ifError(usageContract.__loadError);
  const fixture = readFixture();
  const telemetry = usageContract.buildTelemetry({
    selection: {
      dateRange: fixture.syntheticInput.dateRange,
      timeZone: fixture.syntheticInput.timeZone,
      agents: [],
      source: fixture.syntheticInput.source,
      maxBytes: 1024,
      maxSessions: 1,
    },
  });

  assert.strictEqual(telemetry.schema, fixture.telemetrySchema);
  assert.deepStrictEqual(Object.keys(telemetry.metrics).sort(), [...fixture.counterFields].sort());
  assert.deepStrictEqual(Object.keys(telemetry.identities).sort(), [...fixture.identityFields].sort());
  for (const field of fixture.counterFields) {
    assert.strictEqual(telemetry.metrics[field].value, null, `${field} must not be fabricated`);
    assert.strictEqual(telemetry.metrics[field].status, 'unsupported');
    assert.strictEqual(telemetry.metrics[field].reason, fixture.phase1.unsupportedReason);
  }
  for (const field of fixture.identityFields) {
    assert.strictEqual(telemetry.identities[field].value, null, `${field} must remain unknown in Phase 1`);
    assert.strictEqual(telemetry.identities[field].status, 'unsupported');
    assert.strictEqual(telemetry.identities[field].reason, fixture.phase1.unsupportedReason);
  }
  assert.deepStrictEqual(telemetry.observations, []);
  for (const total of fixture.phase1.totals) {
    assert.strictEqual(telemetry.totals[total].known_subtotal.value, null);
    assert.strictEqual(telemetry.totals[total].complete_total.value, null);
    assert.strictEqual(telemetry.totals[total].complete, false);
    assert.strictEqual(telemetry.totals[total].known_subtotal.reason, fixture.phase1.unsupportedReason);
  }
});

test('coverage separates scan limits from unsupported usage semantics and ancestry', () => {
  assert.ifError(usageContract.__loadError);
  const fixture = readFixture();
  const telemetry = usageContract.buildTelemetry({
    selection: {
      dateRange: fixture.syntheticInput.dateRange,
      timeZone: fixture.syntheticInput.timeZone,
      agents: [],
      source: fixture.syntheticInput.source,
      maxBytes: 1024,
      maxSessions: 1,
    },
    sourceStats: [{
      path: '/tmp/SYNTHETIC_HOME/.claude/projects/demo/session.jsonl',
      kind: 'claude-transcript',
      stats: { records: 1, malformed: 0, partial: false },
    }],
    omittedSources: [{
      kind: 'private-store', path: '/tmp/SYNTHETIC_HOME/.config/orca/orchestration.db',
      status: 'UNSUPPORTED', reason: 'unsupported-source',
    }],
    partial: true,
  });

  assert.strictEqual(telemetry.coverage.scan.legacy_scan_complete, false);
  assert.strictEqual(telemetry.coverage.scan.complete, null);
  assert.strictEqual(telemetry.coverage.scan.status, 'unavailable');
  assert.strictEqual(telemetry.coverage.scan.reason, fixture.phase1.legacyScanUnknownReason);
  assert.strictEqual(telemetry.coverage.source.complete, false);
  for (const dimension of fixture.phase1.coverageDimensions) {
    assert.strictEqual(telemetry.coverage[dimension].complete, false, `${dimension} must remain independently incomplete`);
  }
});

test('contract builder does not serialize raw source paths or arbitrary metadata', () => {
  assert.ifError(usageContract.__loadError);
  const fixture = readFixture();
  const privatePath = `/tmp/${fixture.syntheticInput.unsupportedStoreSentinel}/session.jsonl`;
  const telemetry = usageContract.buildTelemetry({
    selection: {
      dateRange: fixture.syntheticInput.dateRange,
      timeZone: fixture.syntheticInput.timeZone,
      agents: ['CUSTOM_AGENT_FILTER_SENTINEL'],
      source: fixture.syntheticInput.source,
      maxBytes: 1024,
      maxSessions: 1,
      home: `/tmp/${fixture.syntheticInput.secretSentinel}`,
    },
    sourceStats: [{
      path: privatePath,
      kind: 'claude-transcript',
      stats: { records: 1, malformed: 0, partial: false, secret: fixture.syntheticInput.secretSentinel },
    }],
    partial: false,
  });
  const serialized = JSON.stringify(telemetry);

  assert.ok(!serialized.includes(privatePath));
  assert.ok(!serialized.includes(fixture.syntheticInput.secretSentinel));
  assert.ok(!serialized.includes('CUSTOM_AGENT_FILTER_SENTINEL'));
});

test('opt-in sidecar leaves report.v1 return value and all legacy files byte-identical', () => {
  assert.ifError(audit.__loadError);
  const fixture = readFixture();
  const home = fixtureHome('parity');
  const output = path.join(home, 'audit-output');
  writeSession(
    home,
    '.claude/projects/synthetic/session.jsonl',
    fixtureRecord('synthetic-session-1', [
      '/dhpk:dhpk-issue-analyze',
      fixture.syntheticInput.promptSentinel,
      fixture.syntheticInput.secretSentinel,
  ].join(' ')),
  );
  fs.mkdirSync(path.join(home, '.config', 'orca'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'orca', 'orchestration.db'), fixture.syntheticInput.unsupportedStoreSentinel);
  try {
    const legacy = runFixtureAudit(home, output);
    assert.strictEqual(legacy.schema, fixture.syntheticInput.reportSchema);
    assert.strictEqual(fs.existsSync(path.join(output, fixture.syntheticInput.sidecarFile)), false);
    const legacyFiles = Object.fromEntries(fixture.legacyReportFiles.map((name) => [
      name,
      fs.readFileSync(path.join(output, name), 'utf8'),
    ]));

    const optedIn = runFixtureAudit(home, output, ['--usage-telemetry']);
    assert.deepStrictEqual(optedIn, legacy);
    for (const name of fixture.legacyReportFiles) {
      assert.strictEqual(fs.readFileSync(path.join(output, name), 'utf8'), legacyFiles[name], `${name} changed with telemetry enabled`);
    }

    const sidecarPath = path.join(output, fixture.syntheticInput.sidecarFile);
    assert.ok(fs.existsSync(sidecarPath));
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    assert.strictEqual(sidecar.schema, fixture.telemetrySchema);
    assert.strictEqual(sidecar.metrics.reported_input.value, null);
    assert.strictEqual(sidecar.metrics.reported_input.status, 'unsupported');
    assert.strictEqual(sidecar.observations.length, fixture.phase1.observations);
    assert.strictEqual(sidecar.coverage.source.complete, false);
    assert.ok(sidecar.omitted_sources.length > 0);
    assert.ok(!JSON.stringify(sidecar).includes(fixture.syntheticInput.secretSentinel));
    assert.ok(!JSON.stringify(sidecar).includes(fixture.syntheticInput.promptSentinel));
    assert.ok(!JSON.stringify(sidecar).includes(home));
    assert.strictEqual(fs.statSync(output).mode & 0o777, fixture.sourceBoundary.outputMode);
    assert.strictEqual(fs.statSync(sidecarPath).mode & 0o777, fixture.sourceBoundary.sidecarMode);
    const sidecarBytes = fs.readFileSync(sidecarPath, 'utf8');

    const latestLegacy = runFixtureAudit(home, output);
    assert.deepStrictEqual(latestLegacy, legacy);
    assert.strictEqual(fs.readFileSync(sidecarPath, 'utf8'), sidecarBytes);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('telemetry opt-in preserves the selected current-user home boundary', () => {
  assert.ifError(audit.__loadError);
  const externalHome = fixtureHome('outside-current-home');
  try {
    assert.throws(
      () => audit.parseArgs(['--usage-telemetry', '--home', externalHome], { home: process.env.HOME }),
      /--home must stay inside the current user home/,
    );
  } finally {
    fs.rmSync(externalHome, { recursive: true, force: true });
  }
});

test('telemetry scan limits remain partial without claiming usage completeness', () => {
  assert.ifError(audit.__loadError);
  const fixture = readFixture();
  const home = fixtureHome('scan-limit');
  const output = path.join(home, 'audit-output');
  writeSession(home, '.claude/projects/a/session.jsonl', fixtureRecord('session-a'));
  writeSession(home, '.claude/projects/b/session.jsonl', fixtureRecord('session-b'));
  try {
    const report = runFixtureAudit(home, output, ['--usage-telemetry', '--max-sessions', '1']);
    const telemetry = JSON.parse(fs.readFileSync(path.join(output, fixture.syntheticInput.sidecarFile), 'utf8'));
    assert.strictEqual(report.stats.partial, true);
    assert.strictEqual(telemetry.coverage.scan.legacy_scan_complete, false);
    assert.strictEqual(telemetry.coverage.scan.complete, null);
    assert.strictEqual(telemetry.coverage.scan.reason, fixture.phase1.legacyScanUnknownReason);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('opted-in source selection respects active Orca accounts, roots, and symlinks', () => {
  assert.ifError(audit.__loadError);
  const fixture = readFixture();
  const home = fixtureHome('source-boundary');
  const accountRoot = path.join(
    home,
    '.config',
    'orca',
    'codex-accounts',
    fixture.sourceBoundary.activeOrcaAccount,
    'home',
    'sessions',
  );
  const inactiveRoot = path.join(
    home,
    '.config',
    'orca',
    'codex-accounts',
    fixture.sourceBoundary.inactiveOrcaAccount,
    'home',
    'sessions',
  );
  const externalRoot = path.join(home, '.private', 'outside-allowlist');
  const output = path.join(home, 'audit-output');
  const activeFile = writeSession(home, path.relative(home, path.join(accountRoot, 'active.jsonl')), fixtureRecord('active-session'));
  writeSession(home, path.relative(home, path.join(inactiveRoot, 'inactive.jsonl')), fixtureRecord('inactive-session', fixture.syntheticInput.promptSentinel));
  const outsideFile = path.join(externalRoot, 'outside.jsonl');
  fs.mkdirSync(externalRoot, { recursive: true });
  fs.writeFileSync(outsideFile, `${JSON.stringify(fixtureRecord('unlisted-session', fixture.syntheticInput.secretSentinel))}\n`);
  fs.symlinkSync(outsideFile, path.join(accountRoot, 'linked.jsonl'));
  fs.mkdirSync(path.join(home, '.config', 'orca'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'orca', 'orchestration.db'), fixture.syntheticInput.unsupportedStoreSentinel);
  try {
    const report = runFixtureAudit(home, output, ['--usage-telemetry', '--source', 'orca'], {
      activeOrcaAccounts: [fixture.sourceBoundary.activeOrcaAccount],
    });
    const telemetry = JSON.parse(fs.readFileSync(path.join(output, fixture.syntheticInput.sidecarFile), 'utf8'));
    assert.strictEqual(report.stats.sources, fixture.sourceBoundary.selectedSourceCount);
    assert.strictEqual(report.records.length, 1);
    assert.deepStrictEqual(telemetry.sources.map((source) => source.kind), ['orca-codex-session']);
    assert.strictEqual(telemetry.coverage.scan.scanned_sources, fixture.sourceBoundary.selectedSourceCount);
    assert.strictEqual(telemetry.coverage.source.complete, false);
    const serialized = JSON.stringify(telemetry);
    assert.ok(!serialized.includes(activeFile));
    assert.ok(!serialized.includes(fixture.sourceBoundary.inactiveOrcaAccount));
    assert.ok(!serialized.includes('unlisted-session'));
    assert.ok(!serialized.includes(fixture.syntheticInput.secretSentinel));
    assert.ok(!serialized.includes(fixture.syntheticInput.promptSentinel));
    assert.ok(!serialized.includes(fixture.syntheticInput.unsupportedStoreSentinel));
    assert.ok(!serialized.includes(home));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('opt-in fallback output must remain inside the current user home', () => {
  assert.ifError(audit.__loadError);
  const home = fixtureHome('fallback-boundary');
  const originalCwd = process.cwd();
  try {
    process.chdir('/var');
    assert.throws(
      () => audit.runAudit({
        argv: ['--date', '2026-08-06', '--usage-telemetry'],
        home,
        testFixtureHome: true,
        now: new Date('2026-08-06T04:00:00Z'),
        timeZone: 'UTC',
      }),
      /--output must stay inside the current user home/,
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('telemetry opt-in rejects a symlinked output path before following its alias', () => {
  assert.ifError(audit.__loadError);
  const home = fixtureHome('output-alias');
  const realOutput = path.join(home, 'real-output');
  const linkedOutput = path.join(home, 'linked-output');
  fs.mkdirSync(realOutput, { recursive: true });
  fs.symlinkSync(realOutput, linkedOutput, 'dir');
  try {
    assert.throws(
      () => runFixtureAudit(home, linkedOutput, ['--usage-telemetry']),
      /symlink|ELOOP|nofollow/i,
    );
    assert.deepStrictEqual(fs.readdirSync(realOutput), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('telemetry opt-in rejects a symlinked sidecar target without touching its contents', () => {
  assert.ifError(audit.__loadError);
  const home = fixtureHome('output-symlink');
  const output = path.join(home, 'audit-output');
  const externalTarget = path.join(home, 'external-target.json');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(externalTarget, 'untouched');
  fs.symlinkSync(externalTarget, path.join(output, 'usage-telemetry.json'));
  try {
    assert.throws(
      () => runFixtureAudit(home, output, ['--usage-telemetry']),
      /symlink|ELOOP|nofollow/i,
    );
    assert.strictEqual(fs.readFileSync(externalTarget, 'utf8'), 'untouched');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

run('session-usage-telemetry');
