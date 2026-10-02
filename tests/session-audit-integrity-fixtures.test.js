'use strict';

// Historical fixtures for openspec/changes/harden-session-audit-and-agent-orchestration.
// These tests preserve the report, source-selection, verification, and inventory
// contracts that distinguish runtime evidence from historical or untrusted text.

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

test('fixture records v0.37.0 roots, report schema, and package-owned role sets', () => {
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

test('audit report exposes the baseline contract and independent coverage fields', () => {
  const fixture = readFixture('baseline-v0.37.0.json');
  const home = fixtureHome('baseline');
  try {
    // A self-contained Skill never infers an ambient plugin root; the package
    // role set is read only from an explicitly supplied package root.
    const report = audit.runAudit({
      argv: ['--date', '2026-08-06'],
      home,
      timeZone: 'UTC',
      testFixtureHome: true,
      packageRoot: ROOT,
    });
    assert.deepStrictEqual(report.coverage.sourceRoots, fixture.sourceRoots);
    assert.deepStrictEqual(report.coverage.packageOwnedRoleSet, fixture.packageOwnedRoleSet);
    const ambient = audit.runAudit({
      argv: ['--date', '2026-08-06'],
      home,
      timeZone: 'UTC',
      testFixtureHome: true,
    });
    assert.deepStrictEqual(ambient.coverage.packageOwnedRoleSet, { claude: [], codex: [], excludedNavigationFiles: ['INDEX'] });
    for (const field of fixture.report.requiredCoverageFields) {
      assert.ok(Object.prototype.hasOwnProperty.call(report.coverage, field), `coverage missing ${field}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('successful hook text with historical timeout wording is not a runtime finding', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'successful-hook-historical-timeout');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
});

test('prompt or inherited-memory sentinel text remains context, not a failure', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'prompt-memory-sentinel-text');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
});

test('historical projection prose is retained without becoming a failure', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'historical-projection-prose');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
});

test('structured non-zero hook failure keeps stable event provenance', () => {
  const fixture = readFixture('typed-runtime-records.json');
  const fixtureCase = fixture.cases.find((item) => item.id === 'structured-hook-failure');
  const result = scanRecordCase(fixtureCase);
  assert.strictEqual(result.findings.length, fixtureCase.expected.findingCount);
  assert.strictEqual(result.findings[0].status, fixtureCase.expected.state);
  assert.ok(result.findings[0].evidence.some((item) => item.eventId === fixtureCase.expected.eventId));
  assert.ok(result.findings[0].evidence.some((item) => item.sessionId === fixtureCase.expected.sessionId));
});

test('generic --help and date-scan commands cannot verify an arbitrary finding', () => {
  const fixture = readFixture('generic-verification.json');
  const result = audit.verifyFinding(fixture.finding, fixture.verification, { home: os.tmpdir() });
  assert.strictEqual(result.status, fixture.expected.status);
  assert.notStrictEqual(result.status, 'verified', fixture.expected.reason);
});

test('only explicitly selected active Orca account sessions are discovered', () => {
  const fixture = readFixture('source-coverage.json');
  const home = fixtureHome('orca-selected');
  try {
    materializeSourceCoverageFixture(fixture, home);
    const discovery = audit.discoverSources(home, { activeOrcaAccounts: fixture.activeAccounts });
    assert.deepStrictEqual(discovery.sources.map((source) => ({
      kind: source.kind,
      path: path.relative(home, source.path).split(path.sep).join('/'),
    })), [{
      kind: fixture.expected.activeSourceKind,
      path: fixture.activeSession.relativePath,
    }], 'only the explicitly selected Orca session is scanned');
    assert.ok(discovery.sources[0].accountId.startsWith(fixture.expected.redactedAccountPrefix));
    assert.ok(!discovery.sources[0].accountId.includes('selected-account'));
    assert.deepStrictEqual(discovery.activeOrcaAccounts.length, 1);
    assert.ok(discovery.activeOrcaAccounts[0].startsWith(fixture.expected.redactedAccountPrefix));
    assert.ok(!discovery.activeOrcaAccounts[0].includes('selected-account'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('missing active Orca sources report their exact redacted identities and block completeness', () => {
  const fixture = readFixture('source-coverage.json');
  const home = fixtureHome('orca-missing');
  try {
    const discovery = audit.discoverSources(home, { activeOrcaAccounts: fixture.missingAccounts });
    const missingAccounts = discovery.omittedSources
      .filter((source) => source.reason === 'configured-active-account-missing')
      .map((source) => ({
        kind: source.kind,
        path: path.relative(home, source.path).split(path.sep).join('/'),
        status: source.status,
        reason: source.reason,
        accountRedacted: source.account.startsWith(fixture.expected.redactedAccountPrefix)
          && !source.account.includes('missing-account'),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    assert.deepStrictEqual(missingAccounts, [
      {
        kind: fixture.expected.activeSourceKind,
        path: '.config/orca/codex-accounts/missing-account/home/sessions',
        status: 'UNAVAILABLE',
        reason: 'configured-active-account-missing',
        accountRedacted: true,
      },
      {
        kind: fixture.expected.activeSourceKind,
        path: '.orca/codex-accounts/missing-account/home/sessions',
        status: 'UNAVAILABLE',
        reason: 'configured-active-account-missing',
        accountRedacted: true,
      },
    ]);
    assert.strictEqual(discovery.sourceCoverageComplete, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('malformed and unsupported records are counted independently in the report', () => {
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

test('installation rows, unique roles, and INDEX rows use separate count scopes', () => {
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
