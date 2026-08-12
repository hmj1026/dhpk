'use strict';

// RED fixtures for openspec/changes/harden-session-audit-and-agent-orchestration
// tasks 1.1-1.4. These tests define the evidence contract before the collector
// implementation is changed. They intentionally fail against the v0.37.0
// collector when it promotes text to runtime failures, verifies generic
// commands, omits active Orca account homes, or conflates inventory rows with
// unique package-owned roles.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

process.env.DHPK_SESSION_USAGE_AUDIT_TEST_MODE = '1';

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'session-audit');
const SCRIPT = path.join(ROOT, 'skills', 'dhpk-session-usage-audit', 'scripts', 'session-usage-audit');
const audit = require(SCRIPT);

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function fixtureHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-session-audit-${prefix}-`));
}

function writeFixtureJsonl(home, relativePath, records) {
  const file = path.join(home, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = records.map((record) => typeof record === 'string' ? record : JSON.stringify(record));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function scanRecordCase(fixtureCase) {
  const home = fixtureHome(fixtureCase.id);
  try {
    const file = writeFixtureJsonl(home, `.claude/projects/${fixtureCase.id}/session.jsonl`, [fixtureCase.record]);
    const scan = audit.scanJsonlFile(file, {
      dateRange: readFixture('typed-runtime-records.json').dateRange,
      timeZone: 'UTC',
      home,
      sourceKind: 'claude-transcript',
      knownAgents: new Set(['auditor', 'code-reviewer', 'worker']),
    });
    return { scan, findings: audit.detectFindings(scan.records) };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function materializeSourceCoverageFixture(fixture, home) {
  writeFixtureJsonl(home, fixture.activeSession.relativePath, fixture.activeSession.records);
  writeFixtureJsonl(home, fixture.unselectedSession.relativePath, fixture.unselectedSession.records);
}

function materializeInventoryFixture(fixture, home) {
  const registry = {
    version: 2,
    plugins: {
      'dhpk@dhpk': [
        { version: '0.36.0', installPath: path.join(home, '.claude/plugins/cache/dhpk/dhpk/0.36.0') },
        { version: '0.37.0', installPath: path.join(home, '.claude/plugins/cache/dhpk/dhpk/0.37.0') },
      ],
    },
  };
  fs.mkdirSync(path.join(home, '.claude/plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify(registry));
  for (const row of fixture.rows) {
    const file = path.join(home, row.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, row.kind === 'INDEX' ? '# navigation\n' : '# role fixture\n');
  }
}

test('task 1.1 fixture records v0.37.0 roots, report schema, and package-owned role sets', () => {
  const fixture = readFixture('baseline-v0.37.0.json');
  assert.strictEqual(fixture.schema, 'dhpk.session-usage-audit.fixture.v1');
  assert.strictEqual(fixture.release, '0.37.0');
  assert.strictEqual(fixture.report.schema, 'dhpk.session-usage-audit.report.v1');
  assert.ok(fixture.sourceRoots.activeOrcaCodexSessions.includes('<account>'));
  assert.ok(!JSON.stringify(fixture).includes('/home/paul/'));
  assert.ok(!JSON.stringify(fixture).includes('paul'));

  const claudeRoles = fs.readdirSync(path.join(ROOT, 'agents'))
    .filter((name) => name.endsWith('.md') && name !== 'INDEX.md')
    .map((name) => name.slice(0, -3))
    .sort();
  const codexRoles = fs.readdirSync(path.join(ROOT, 'codex/agents'))
    .filter((name) => name.endsWith('.toml'))
    .map((name) => name.slice(0, -5))
    .sort();
  assert.deepStrictEqual(fixture.packageOwnedRoleSet.claude, claudeRoles);
  assert.deepStrictEqual(fixture.packageOwnedRoleSet.codex, codexRoles);
  assert.deepStrictEqual(fixture.packageOwnedRoleSet.excludedNavigationFiles, ['INDEX']);
});

test('task 1.1 (RED): audit report exposes the baseline contract and independent coverage fields', () => {
  const fixture = readFixture('baseline-v0.37.0.json');
  const home = fixtureHome('baseline');
  try {
    const report = audit.runAudit({
      argv: ['--date', '2026-08-06'],
      home,
      timeZone: 'UTC',
      testFixtureHome: true,
    });
    assert.deepStrictEqual(report.coverage.sourceRoots, fixture.sourceRoots);
    assert.deepStrictEqual(report.coverage.packageOwnedRoleSet, fixture.packageOwnedRoleSet);
    for (const field of fixture.report.requiredCoverageFields) {
      assert.ok(Object.prototype.hasOwnProperty.call(report.coverage, field), `coverage missing ${field}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('task 1.2 (RED): successful hook text with historical timeout wording is not a runtime finding', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'successful-hook-historical-timeout');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
});

test('task 1.2 (RED): prompt or inherited-memory sentinel text remains context, not a failure', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'prompt-memory-sentinel-text');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
});

test('task 1.2 (RED): historical projection prose is retained without becoming a failure', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'historical-projection-prose');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
});

test('task 1.2 (RED): structured non-zero hook failure keeps stable event provenance', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'structured-hook-failure');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
  assert.strictEqual(result.findings[0].status, fixtureCase.expected.state);
  assert.ok(result.findings[0].evidence.some((item) => item.eventId === fixtureCase.expected.eventId));
  assert.ok(result.findings[0].evidence.some((item) => item.sessionId === fixtureCase.expected.sessionId));
});

test('task 1.3 (RED): generic --help and date-scan commands cannot verify an arbitrary finding', () => {
  const fixture = readFixture('generic-verification.json');
  const result = audit.verifyFinding(fixture.finding, fixture.verification, { home: os.tmpdir() });
  assert.strictEqual(result.status, fixture.expected.status);
  assert.notStrictEqual(result.status, 'verified', fixture.expected.reason);
});

test('task 1.4 (RED): only explicitly selected active Orca account sessions are discovered', () => {
  const fixture = readFixture('source-coverage.json');
  const home = fixtureHome('orca-selected');
  try {
    materializeSourceCoverageFixture(fixture, home);
    const discovery = audit.discoverSources(home, { activeOrcaAccounts: fixture.activeAccounts });
    const active = discovery.sources.filter((source) => source.path.includes('/selected-account/'));
    const ignored = discovery.sources.filter((source) => source.path.includes('/ignored-account/'));
    assert.ok(active.length > 0, 'selected active Orca account must be included');
    assert.strictEqual(ignored.length, 0, 'unselected Orca account must not be wildcard-scanned');
    assert.ok(active.every((source) => source.kind === fixture.expected.activeSourceKind));
    assert.ok(active.every((source) => source.accountId.startsWith(fixture.expected.redactedAccountPrefix)));
    assert.ok(active.every((source) => !source.accountId.includes('selected-account')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('task 1.4 (RED): missing active Orca source is omitted explicitly and blocks completeness', () => {
  const fixture = readFixture('source-coverage.json');
  const home = fixtureHome('orca-missing');
  try {
    const discovery = audit.discoverSources(home, { activeOrcaAccounts: fixture.missingAccounts });
    assert.ok(discovery.omittedSources.some((source) => (
      source.kind === fixture.expected.activeSourceKind && source.status === 'UNAVAILABLE'
    )));
    assert.strictEqual(discovery.sourceCoverageComplete, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('task 1.4 (RED): malformed and unsupported records are counted independently in the report', () => {
  const fixture = readFixture('source-coverage.json');
  const home = fixtureHome('orca-record-stats');
  try {
    materializeSourceCoverageFixture(fixture, home);
    const report = audit.runAudit({
      argv: ['--date', '2026-08-06'],
      home,
      timeZone: 'UTC',
      testFixtureHome: true,
      activeOrcaAccounts: fixture.activeAccounts,
    });
    assert.strictEqual(report.stats.malformedCount, fixture.expected.malformedCount);
    assert.strictEqual(report.stats.unsupportedCount, fixture.expected.unsupportedCount);
    assert.strictEqual(report.stats.scanComplete, fixture.expected.scanComplete);
    assert.strictEqual(report.stats.sourceCoverageComplete, fixture.expected.sourceCoverageComplete);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('task 1.4 (RED): installation rows, unique roles, and INDEX rows use separate count scopes', () => {
  const fixture = readFixture('agent-inventory.json');
  const home = fixtureHome('agent-counts');
  try {
    materializeInventoryFixture(fixture, home);
    const report = audit.runAudit({
      argv: ['--date', '2026-08-06'],
      home,
      timeZone: 'UTC',
      testFixtureHome: true,
    });
    assert.strictEqual(report.coverage.agentCounts.installationRows, fixture.expected.installationRows);
    assert.strictEqual(report.coverage.agentCounts.uniqueCanonicalRoles, fixture.expected.uniqueCanonicalRoles);
    assert.strictEqual(report.coverage.agentCounts.excludedIndexRows, fixture.expected.excludedIndexRows);
    assert.strictEqual(report.coverage.agentCounts.displayedCount, fixture.expected.displayedCount);
    assert.strictEqual(report.coverage.agentCounts.displayedCountScope, fixture.expected.displayedCountScope);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

run('session-audit-integrity-fixtures');
