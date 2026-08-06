'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

// External fixture homes are enabled only for this isolated test process.
process.env.DHPK_SESSION_USAGE_AUDIT_TEST_MODE = '1';
const slackToken = ['x', 'o', 'x', 'b', '-', '1234567890', '-', 'abcdefghijklmnop'].join('');

const SCRIPT = path.join(
  __dirname,
  '..',
  'skills',
  'dhpk-session-usage-audit',
  'scripts',
  'session-usage-audit',
);

let audit;
try {
  audit = require(SCRIPT);
} catch (error) {
  audit = { __loadError: error };
}

test('parseArgs defaults to the local audit day and all agents', () => {
  assert.ifError(audit.__loadError);
  const parsed = audit.parseArgs([], {
    now: new Date('2026-08-06T10:00:00+08:00'),
    timeZone: 'Asia/Taipei',
  });

  assert.deepStrictEqual(parsed.dateRange, {
    from: '2026-08-06',
    to: '2026-08-06',
  });
  assert.deepStrictEqual(parsed.agents, []);
  assert.strictEqual(parsed.format, 'text');
  assert.strictEqual(parsed.createIssues, false);
});

test('parseArgs accepts an inclusive range and repeated unique agent filters', () => {
  const parsed = audit.parseArgs([
    '--from', '2026-08-01', '--to', '2026-08-03',
    '--agent', 'code-reviewer', '--agent', 'code-reviewer', '--agent', 'security-reviewer',
    '--format', 'json', '--source', 'claude', '--plugin-root', '/tmp/dhpk-plugin',
  ], { timeZone: 'Asia/Taipei' });

  assert.deepStrictEqual(parsed.dateRange, { from: '2026-08-01', to: '2026-08-03' });
  assert.deepStrictEqual(parsed.agents, ['code-reviewer', 'security-reviewer']);
  assert.strictEqual(parsed.format, 'json');
  assert.strictEqual(parsed.source, 'claude');
  assert.strictEqual(parsed.pluginRoot, '/tmp/dhpk-plugin');
});

test('parseArgs rejects ambiguous date flags and unsafe issue confirmation', () => {
  assert.throws(
    () => audit.parseArgs(['--date', '2026-08-01', '--from', '2026-08-01', '--to', '2026-08-02']),
    /cannot be combined/,
  );
  assert.throws(() => audit.parseArgs(['--confirm']), /requires --create-issues/);
  assert.throws(() => audit.parseArgs(['--from', '2026-08-03', '--to', '2026-08-01']), /must not be after/);
  assert.throws(() => audit.parseArgs(['--create-issues', '--confirm-digest', 'not-a-digest']), /digest/);
});

test('redactText removes credentials and absolute home paths while preserving useful errors', () => {
  assert.ifError(audit.__loadError);
  const redacted = audit.redactText(
    'Authorization: Bearer ghp_1234567890abcdef\n' +
    'token=sk-live-1234567890\n' +
    'at /home/paul/projects/app/src/index.js:42\n' +
    'Error: hook timed out after 30s',
    { home: '/home/paul' },
  );

  assert.ok(!redacted.includes('ghp_1234567890abcdef'));
  assert.ok(!redacted.includes('sk-live-1234567890'));
  assert.ok(redacted.includes('<HOME>/projects/app/src/index.js:42'));
  assert.ok(redacted.includes('hook timed out after 30s'));
});

test('redactText removes cloud, URL, PEM, and escaped credential forms', () => {
  const redacted = audit.redactText([
    'AWS_SECRET_ACCESS_KEY=aws-secret-value',
    'DATABASE_URL=postgres://dbuser:db-password@example.test:5432/app',
    '-----BEGIN PRIVATE KEY-----',
    'escaped=\\"client_secret\\":\\"escaped-secret\\"',
    'X_API_TOKEN=another-secret',
  ].join('\n'));
  for (const secret of ['aws-secret-value', 'db-password', 'escaped-secret', 'another-secret']) assert.ok(!redacted.includes(secret));
  assert.ok(!redacted.includes('BEGIN PRIVATE KEY'));
});

test('fingerprintFinding is stable for the same normalized package failure', () => {
  const first = audit.fingerprintFinding({
    category: 'hook-failure',
    component: 'stop-advisory-dispatch.sh',
    message: 'Hook timed out after 30 seconds',
    version: '0.35.1',
  });
  const second = audit.fingerprintFinding({
    category: 'hook-failure',
    component: 'stop-advisory-dispatch.sh',
    message: 'hook TIMED OUT after 30 seconds',
    version: '0.35.1',
  });

  assert.strictEqual(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
});

test('discoverSources only returns known agent roots and transcript files', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'orca', 'logs'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'orca'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', '0.1.0', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(home, 'private'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'demo', 's.jsonl'), '{}\n');
  fs.writeFileSync(path.join(home, '.codex', 'sessions', 's.jsonl'), '{}\n');
  fs.writeFileSync(path.join(home, '.config', 'orca', 'logs', 'trace.ndjson'), '{}\n');
  fs.writeFileSync(path.join(home, '.config', 'orca', 'orchestration.db'), 'private\n');
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', '0.1.0', 'agents', 'plugin-agent.md'), '# agent\n');
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', '0.1.0', 'agents', `${slackToken}.md`), '# agent\n');
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'dhpk@dhpk': [{ installPath: path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', '0.1.0') }],
    },
  }));
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'code-reviewer.md'), '# agent\n');
  fs.writeFileSync(path.join(home, '.codex', 'agents', 'planner.md'), '# agent\n');
  fs.writeFileSync(path.join(home, 'private', 'should-not-scan.jsonl'), '{}\n');

  const result = audit.discoverSources(home);
  assert.ok(result.sources.some((source) => source.path.endsWith('/.claude/projects/demo/s.jsonl')));
  assert.ok(result.sources.some((source) => source.kind === 'codex-transcript' && source.path.endsWith('/.codex/sessions/s.jsonl')));
  assert.ok(result.sources.some((source) => source.kind === 'orca-trace' && source.path.endsWith('/.config/orca/logs/trace.ndjson')));
  assert.ok(result.installedAgents.some((agent) => agent.name === 'code-reviewer'));
  assert.ok(result.installedAgents.some((agent) => agent.name === 'planner'));
  assert.ok(result.installedAgents.some((agent) => agent.name === 'plugin-agent' && agent.platform.startsWith('claude-plugin:')));
  assert.ok(result.installedAgents.some((agent) => agent.name === slackToken));
  const report = audit.runAudit({ argv: ['--date', '2026-08-06'], home, timeZone: 'UTC', testFixtureHome: true });
  assert.ok(!JSON.stringify(report.coverage.installedAgents).includes(slackToken));
  assert.ok(result.omittedSources.some((source) => source.status === 'UNSUPPORTED' && source.path.endsWith('/.config/orca/orchestration.db')));
  assert.ok(!result.sources.some((source) => source.path.includes('/private/')));
});

test('discoverSources records unavailable adapter roots instead of silently claiming full coverage', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-empty-'));
  const result = audit.discoverSources(home);
  assert.ok(result.omittedSources.some((source) => source.kind === 'orca-trace' && source.status === 'UNAVAILABLE'));
  assert.ok(result.omittedSources.some((source) => source.kind === 'codex-transcript' && source.status === 'UNAVAILABLE'));
});

test('scanJsonlFile filters by local date and extracts dhpk evidence without raw secrets', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-log-'));
  const file = path.join(home, 'session.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({
      type: 'assistant', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1', cwd: `${home}/project`,
      message: { content: [{ type: 'text', text: 'Use /dhpk:dhpk-issue-analyze; Authorization: Bearer ghp_123456789; token="json-secret" customer@example.com SECRET_PROMPT customer order details' }] },
    }),
    JSON.stringify({
      type: 'assistant', timestamp: '2026-08-05T01:00:00Z', sessionId: 'old',
      message: { content: [{ type: 'text', text: 'old session' }] },
    }),
    JSON.stringify({
      type: 'assistant', timestamp: '2026-08-06T02:00:00Z', sessionId: 'path-only', cwd: `${home}/dhpk`,
      message: { content: [{ type: 'text', text: 'generic command completed' }] },
    }),
    'not-json',
  ].join('\n'));

  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' },
    timeZone: 'Asia/Taipei',
    home,
  });
  assert.strictEqual(result.records.length, 1);
  assert.strictEqual(result.records[0].sessionId, 's1');
  assert.strictEqual(result.records[0].dhpkEvidenceLevel, 'strong');
  assert.ok(!result.records[0].text.includes('ghp_123456789'));
  assert.ok(!result.records[0].text.includes('json-secret'));
  assert.ok(!result.records[0].text.includes('customer@example.com'));
  assert.ok(!result.records[0].text.includes('SECRET_PROMPT'));
  assert.strictEqual(result.stats.nonDhpk, 1);
  assert.strictEqual(result.stats.malformed, 1);
});

test('scanJsonlFile hashes unsafe agent and type metadata', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-metadata-'));
  const file = path.join(home, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({
    type: 'ghp_customer_name', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1',
    agent: 'ghp_1234567890abcdef',
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze hook timed out' }] },
  }) + '\n');
  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' }, timeZone: 'UTC', home,
  });
  assert.strictEqual(result.records.length, 1);
  assert.ok(!JSON.stringify(result.records[0]).includes('ghp_1234567890abcdef'));
  assert.ok(!JSON.stringify(result.records[0]).includes('ghp_customer_name'));
});

test('scanJsonlFile rejects token-shaped agent and package-version metadata', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-metadata-token-'));
  const file = path.join(home, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({
    type: 'assistant', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1',
    agent: slackToken, packageVersion: `1.2.3-${slackToken}`,
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze hook timed out' }] },
  }) + '\n');
  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' }, timeZone: 'UTC', home,
  });
  assert.strictEqual(result.records.length, 1);
  assert.ok(!JSON.stringify(result.records[0]).includes(slackToken));
  assert.ok(!JSON.stringify(result.records[0]).includes(`1.2.3-${slackToken}`));
  assert.strictEqual(result.records[0].packageVersion, '');
  assert.strictEqual(result.records[0].packageVersionSource, 'unknown');
});

test('scanJsonlFile normalizes Orca nanosecond timestamps and nested attributes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-orca-'));
  const file = path.join(home, 'trace.ndjson');
  fs.writeFileSync(file, JSON.stringify({
    type: 'effect-span',
    startTimeUnixNano: '1785978000000000000',
    traceId: 'trace-1',
    attributes: { agent: 'code-reviewer', cwd: `${home}/project` },
    events: [{ name: 'dhpk hook timed out' }],
  }) + '\n');

  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' },
    timeZone: 'UTC',
    home,
    sourceKind: 'orca-trace',
    agents: ['code-reviewer'],
  });
  assert.strictEqual(result.records.length, 1);
  assert.strictEqual(result.records[0].agent, 'code-reviewer');
  assert.strictEqual(result.records[0].sessionId, 'trace-1');
  assert.strictEqual(result.records[0].localDate, '2026-08-06');
  assert.ok(result.records[0].text.includes('dhpk hook timed out'));
});

test('detectFindings groups repeated dhpk hook failures and ignores unrelated records', () => {
  const findings = audit.detectFindings([
    {
      source: 'claude-transcript', file: '/tmp/a.jsonl', line: 4, sessionId: 's1',
      timestamp: '2026-08-06T01:00:00Z', agent: 'code-reviewer', dhpkEvidenceLevel: 'strong',
      text: 'stop-advisory-dispatch.sh: hook timed out after 30 seconds',
    },
    {
      source: 'claude-transcript', file: '/tmp/b.jsonl', line: 8, sessionId: 's2',
      timestamp: '2026-08-06T02:00:00Z', agent: 'code-reviewer', dhpkEvidenceLevel: 'strong',
      text: 'stop-advisory-dispatch.sh: HOOK TIMED OUT after 30 seconds',
    },
    {
      source: 'claude-transcript', file: '/tmp/c.jsonl', line: 2, sessionId: 's3',
      timestamp: '2026-08-06T03:00:00Z', agent: 'code-reviewer', dhpkEvidenceLevel: 'none',
      text: 'application request timed out',
    },
  ]);

  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].category, 'hook-failure');
  assert.strictEqual(findings[0].occurrences, 2);
  assert.strictEqual(findings[0].status, 'candidate');
  assert.ok(findings[0].evidence.length >= 2);
});

test('detectFindings keeps package versions and independent sessions distinct', () => {
  const base = {
    source: 'claude-transcript', file: '/tmp/a.jsonl', line: 1,
    timestamp: '2026-08-06T01:00:00Z', agent: 'reviewer', dhpkEvidenceLevel: 'strong',
    text: 'stop-advisory-dispatch.sh: hook timed out after 30 seconds',
  };
  const differentVersions = audit.detectFindings([
    { ...base, sessionId: 's1', packageVersion: '0.35.0' },
    { ...base, sessionId: 's2', packageVersion: '0.35.1' },
  ]);
  assert.strictEqual(differentVersions.length, 2);

  const sameSession = audit.detectFindings([
    { ...base, sessionId: 's1', packageVersion: '0.35.1', line: 1 },
    { ...base, sessionId: 's1', packageVersion: '0.35.1', line: 2 },
    { ...base, sessionId: 's1', packageVersion: '0.35.1', line: 3 },
  ]);
  assert.strictEqual(sameSession.length, 1);
  assert.strictEqual(sameSession[0].confidence, 0.72);

  const repeatedIndependent = audit.detectFindings([
    { ...base, sessionId: 's1', packageVersion: '0.35.1' },
    { ...base, sessionId: 's2', packageVersion: '0.35.1' },
    { ...base, sessionId: 's2', packageVersion: '0.35.1' },
  ]);
  assert.strictEqual(repeatedIndependent[0].confidence, 0.82);

  const mixedInferred = audit.detectFindings([
    { ...base, source: 'claude-transcript', sessionId: 's1', packageVersion: '0.35.0', packageVersionSource: 'current-install-inferred' },
    { ...base, source: 'codex-transcript', sessionId: 's2', packageVersion: '0.34.1', packageVersionSource: 'current-install-inferred' },
  ]);
  assert.strictEqual(mixedInferred[0].version, '');
  assert.strictEqual(mixedInferred[0].versionSource, 'mixed-current-install-inferred');
  assert.deepStrictEqual(mixedInferred[0].inferredVersions, ['0.34.1', '0.35.0']);
});

test('scanJsonlFile stops collecting at maxRecords and marks a bounded partial scan', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-limit-'));
  const file = path.join(home, 'session.jsonl');
  fs.writeFileSync(file, [1, 2, 3].map((line) => JSON.stringify({
    type: 'assistant', timestamp: `2026-08-06T0${line}:00:00Z`, sessionId: `s${line}`,
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze hook timed out' }] },
  })).join('\n') + '\n');
  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' }, timeZone: 'UTC', home, maxRecords: 1,
  });
  assert.strictEqual(result.records.length, 1);
  assert.strictEqual(result.stats.limitReached, true);
  assert.strictEqual(result.stats.lines, 1);
});

test('scanJsonlFile does not mark an exact final-record limit partial', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-limit-final-'));
  const file = path.join(home, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({
    type: 'assistant', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1',
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze hook timed out' }] },
  }) + '\n');
  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' }, timeZone: 'UTC', home, maxRecords: 1,
  });
  assert.strictEqual(result.records.length, 1);
  assert.strictEqual(result.stats.limitReached, false);
  assert.strictEqual(result.stats.partial, false);
});

test('diagnostic extraction keeps structured symptoms but drops customer context', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-diagnostic-'));
  const file = path.join(home, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({
    type: 'assistant', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1',
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze stop-advisory-dispatch.sh hook for customer Alice medical-condition failed' }] },
  }) + '\n');
  const result = audit.scanJsonlFile(file, {
    dateRange: { from: '2026-08-06', to: '2026-08-06' }, timeZone: 'UTC', home,
  });
  assert.strictEqual(result.records.length, 1);
  assert.ok(result.records[0].text.includes('stop-advisory-dispatch.sh'));
  assert.ok(result.records[0].text.includes('hook failed'));
  assert.ok(!result.records[0].text.includes('customer'));
  assert.ok(!result.records[0].text.includes('Alice'));
  assert.ok(!result.records[0].text.includes('medical-condition'));
});

test('buildIssueDraft is sanitized and issueGate requires verification, dedupe, auth, and confirmation', () => {
  const home = os.homedir();
  const finding = {
    fingerprint: 'sha256:' + 'a'.repeat(64),
    category: 'hook-failure', component: 'stop-advisory-dispatch.sh',
    title: 'dhpk hook timeout', status: 'verified', confidence: 0.91,
    occurrences: 2, message: 'hook timed out after 30 seconds',
    evidence: [{ file: path.join(home, 'projects', 'app', 'session.jsonl'), line: 4, sessionId: 's1' }],
    verification: {
      reproduction: { status: 'pass', command: 'node reproduce.js' },
      consumerGate: { status: 'pass', command: 'node scripts/ci/validate-plugin.js' },
    },
  };
  const draft = audit.buildIssueDraft(finding, { version: '0.35.1', repository: 'hmj1026/dhpk', home });
  assert.ok(draft.title.includes('[session-audit]'));
  assert.ok(draft.body.includes(finding.fingerprint));
  assert.ok(draft.body.includes('node reproduce.js'));
  assert.ok(draft.body.includes('validate-plugin.js'));
  assert.match(draft.confirmationDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(!draft.body.includes(home));

  assert.strictEqual(audit.evaluateIssueGate({ finding, duplicate: false, ghAuth: true, confirmed: false }).allowed, false);
  assert.strictEqual(audit.evaluateIssueGate({ finding, duplicate: true, ghAuth: true, confirmed: true }).allowed, false);
  assert.strictEqual(audit.evaluateIssueGate({ finding, duplicate: false, ghAuth: true, confirmed: true }).allowed, true);
});

test('collectInstallEvidence separates Claude registry and project Codex receipt versions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-install-'));
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(home, 'projects', 'demo', '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'dhpk@dhpk': [{ version: '0.35.1', scope: 'user', installPath: `${home}/.claude/plugins/cache/dhpk/dhpk/0.35.1` }],
    },
  }));
  fs.writeFileSync(path.join(home, 'projects', 'demo', '.codex', '.dhpk-installed.json'), JSON.stringify({
    schema: 2, version: '0.34.1', mode: 'copy', entries: 55,
  }));

  const result = audit.collectInstallEvidence(home);
  assert.ok(result.some((entry) => entry.surface === 'claude' && entry.version === '0.35.1'));
  assert.strictEqual(result.find((entry) => entry.surface === 'claude').scope, 'user');
  assert.ok(result.some((entry) => entry.surface === 'codex-project' && entry.version === '0.34.1'));
});

test('runAudit returns a bounded report and writes only under the requested output directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-run-'));
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-plugin-'));
  const output = path.join(home, 'out');
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '0.35.1' }));
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'demo', 's.jsonl'), JSON.stringify({
    type: 'assistant', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1',
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze hook timed out' }] },
  }) + '\n');

  const result = audit.runAudit({
    argv: ['--date', '2026-08-06', '--format', 'json', '--plugin-root', pluginRoot],
    home,
    testFixtureHome: true,
    output,
    now: new Date('2026-08-06T04:00:00Z'),
    timeZone: 'UTC',
    write: true,
  });
  assert.strictEqual(result.schema, 'dhpk.session-usage-audit.report.v1');
  assert.ok(result.stats.sources >= 1);
  assert.ok(fs.existsSync(path.join(output, 'report.json')));
  assert.ok(fs.existsSync(path.join(output, 'findings.json')));
  assert.ok(fs.existsSync(path.join(output, 'issue-drafts.json')));
  const sourceInstallation = result.installations.find((entry) => entry.surface === 'source');
  assert.strictEqual(sourceInstallation.path, '<PLUGIN_ROOT>/.claude-plugin/plugin.json');
  assert.strictEqual(result.findings[0].version, '0.35.1');
  assert.strictEqual(result.findings[0].versionSource, 'current-install-inferred');
  assert.ok(result.issueDrafts[0].body.includes('- dhpk version: 0.35.1 (current-install-inferred)'));
  assert.ok(!JSON.stringify(result).includes(pluginRoot));
  assert.ok(!fs.existsSync(path.join(home, 'raw-transcript.jsonl')));
});

test('writeReport refuses symlink output targets and uses private report permissions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-write-'));
  const output = path.join(home, 'audit');
  const report = {
    args: { dateRange: { from: '2026-08-06', to: '2026-08-06' } },
    stats: { scannedSources: 0, sources: 0, records: 0, partial: false },
    installations: [], findings: [], issueDrafts: [], issueResults: [],
    coverage: { installedAgents: [], omittedSources: [] }, records: [],
  };
  audit.writeReport(report, output);
  assert.strictEqual(fs.statSync(output).mode & 0o777, 0o700);
  for (const name of ['report.json', 'findings.json', 'issue-drafts.json', 'issue-results.json', 'sessions.jsonl', 'report.md']) {
    assert.strictEqual(fs.statSync(path.join(output, name)).mode & 0o777, 0o600);
  }

  const external = path.join(home, 'external.md');
  fs.writeFileSync(external, 'untouched');
  fs.unlinkSync(path.join(output, 'report.md'));
  fs.symlinkSync(external, path.join(output, 'report.md'));
  assert.throws(() => audit.writeReport(report, output), /symlink|ELOOP|nofollow/i);
  assert.strictEqual(fs.readFileSync(external, 'utf8'), 'untouched');
});

test('createIssue is a no-op until human confirmation and does not create duplicates', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-gh-'));
  const bin = path.join(home, 'bin');
  const calls = path.join(home, 'calls');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$DHPK_GH_CALLS"',
    'case "$*" in',
    '  *"auth status"*) exit 0 ;;',
    '  *"issue list"*) printf "[{\\"number\\":123,\\"title\\":\\"existing\\",\\"state\\":\\"OPEN\\",\\"url\\":\\"https://github.com/hmj1026/dhpk/issues/123\\"}]"; exit 0 ;;',
    '  *"issue create"*) printf "https://github.com/hmj1026/dhpk/issues/999\\n"; exit 0 ;;',
    'esac',
  ].join('\n'), { mode: 0o755 });
  const finding = {
    fingerprint: 'sha256:' + 'b'.repeat(64), category: 'hook-failure', component: 'hook.sh',
    message: 'hook timed out', status: 'verified', confidence: 0.95, occurrences: 2, evidence: [],
    verification: {
      trusted: true,
      reproduction: { status: 'pass', command: 'fixture reproduction' },
      consumerGate: { status: 'pass', command: 'fixture consumer gate' },
    },
  };
  const draft = audit.buildIssueDraft(finding, { repository: 'hmj1026/dhpk', home });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DHPK_GH_CALLS: calls };
  const notConfirmed = audit.createIssue({ draft, finding, repository: 'hmj1026/dhpk', confirmed: false, env });
  assert.strictEqual(notConfirmed.created, false);
  assert.match(notConfirmed.reason, /confirmation/);
  assert.ok(!fs.existsSync(calls));

  const unverified = audit.createIssue({
    draft,
    finding: { ...finding, status: 'candidate' },
    repository: 'hmj1026/dhpk',
    confirmed: true,
    confirmationDigest: draft.confirmationDigest,
    env,
  });
  assert.strictEqual(unverified.created, false);
  assert.match(unverified.reason, /not-verified/);
  assert.ok(!fs.existsSync(calls));

  const duplicate = audit.createIssue({ draft, finding, repository: 'hmj1026/dhpk', confirmed: true, confirmationDigest: draft.confirmationDigest, env });
  assert.strictEqual(duplicate.created, false);
  assert.match(duplicate.reason, /duplicate/);
  const issueListCalls = fs.readFileSync(calls, 'utf8').split('\n').filter((line) => line.includes('issue list'));
  assert.ok(issueListCalls.length >= 3);
  assert.ok(!fs.readFileSync(calls, 'utf8').includes('issue create'));
  const wrongRepo = audit.createIssue({ draft, finding, repository: 'someone/another-repo', confirmed: true, env });
  assert.strictEqual(wrongRepo.reason, 'repository-not-allowed');
});

test('createIssue does not block on broad duplicate candidates without an exact fingerprint', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-gh-candidate-'));
  const bin = path.join(home, 'bin');
  const calls = path.join(home, 'calls');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$DHPK_GH_CALLS"',
    'case "$*" in',
    '  *"auth status"*) exit 0 ;;',
    '  *"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"*) printf "[]"; exit 0 ;;',
    '  *"issue list"*) printf "[{\\"number\\":321,\\"title\\":\\"generic\\",\\"state\\":\\"OPEN\\",\\"url\\":\\"https://github.com/hmj1026/dhpk/issues/321\\"}]"; exit 0 ;;',
    '  *"issue create"*) printf "https://github.com/hmj1026/dhpk/issues/1000\\n"; exit 0 ;;',
    'esac',
  ].join('\n'), { mode: 0o755 });
  const finding = {
    fingerprint: 'sha256:' + 'd'.repeat(64), category: 'hook-failure', component: 'hook.sh',
    message: 'hook timed out', status: 'verified', confidence: 0.95, occurrences: 2, evidence: [],
    verification: { trusted: true, reproduction: { status: 'pass', command: 'node reproduce.js' }, consumerGate: { status: 'pass', command: 'node gate.js' } },
  };
  const draft = audit.buildIssueDraft(finding, { repository: 'hmj1026/dhpk', home });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DHPK_GH_CALLS: calls };
  const result = audit.createIssue({ draft, finding, repository: 'hmj1026/dhpk', confirmed: true, confirmationDigest: draft.confirmationDigest, env });
  assert.strictEqual(result.created, true);
  assert.ok(result.duplicateCandidates.length >= 1);
});

test('verifyFinding promotes only independently reproduced findings', () => {
  const candidate = {
    fingerprint: 'sha256:' + 'c'.repeat(64), category: 'hook-failure', component: 'hook.sh',
    status: 'candidate', confidence: 0.85, occurrences: 2, evidence: [],
  };
  const notReady = audit.verifyFinding(candidate, {
    reproduction: { status: 'pass', command: 'fixture reproduction' },
    consumerGate: { status: 'fail', command: 'node scripts/ci/validate-plugin.js' },
  });
  assert.strictEqual(notReady.status, 'needs-verification');

  const sameCheck = audit.verifyFinding(candidate, {
    reproduction: { status: 'pass', command: 'same check' },
    consumerGate: { status: 'pass', command: 'same check' },
  });
  assert.strictEqual(sameCheck.status, 'needs-verification');

  const verified = audit.verifyFinding(candidate, {
    reproduction: { status: 'pass', command: 'fixture reproduction', execution: { trusted: true, argv: ['node', 'reproduce.js'] } },
    consumerGate: { status: 'pass', command: 'node scripts/ci/validate-plugin.js', execution: { trusted: true, argv: ['node', 'scripts/ci/validate-plugin.js'] } },
  }, { trusted: true });
  assert.strictEqual(verified.status, 'verified');
  assert.strictEqual(verified.verification.trusted, true);
  assert.strictEqual(verified.verification.reproduction.status, 'pass');
});

test('verifyFinding rejects identical executed argv even when labels differ', () => {
  const candidate = { status: 'candidate', confidence: 0.9, evidence: [] };
  const result = audit.verifyFinding(candidate, {
    reproduction: { status: 'pass', command: 'repro label', execution: { trusted: true, argv: ['node', 'same.js'] } },
    consumerGate: { status: 'pass', command: 'gate label', execution: { trusted: true, argv: ['node', 'same.js'] } },
  }, { trusted: true });
  assert.strictEqual(result.status, 'needs-verification');
});

test('CLI emits a JSON report and honors explicit home/output boundaries', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-cli-'));
  const output = path.join(home, 'audit-output');
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'demo', 's.jsonl'), '{}\n');
  const result = spawnSync('node', [SCRIPT + '.js', '--home', home, '--output', output, '--date', '2026-08-06', '--format', 'json'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: home, DHPK_SESSION_USAGE_AUDIT_TEST_MODE: '1' },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.schema, 'dhpk.session-usage-audit.report.v1');
  assert.ok(fs.existsSync(path.join(output, 'report.md')));

  const blocked = spawnSync('node', [SCRIPT + '.js', '--home', home, '--date', '2026-08-06', '--format', 'json'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, DHPK_SESSION_USAGE_AUDIT_TEST_MODE: '0' },
  });
  assert.strictEqual(blocked.status, 2);
  assert.match(blocked.stderr, /current user home/);
});

test('runAudit applies only matching external verification records before issue gating', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-verify-'));
  const verificationFile = path.join(home, 'verification.json');
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'demo', 's.jsonl'), JSON.stringify({
    type: 'assistant', timestamp: '2026-08-06T01:00:00Z', sessionId: 's1',
    message: { content: [{ type: 'text', text: '/dhpk:dhpk-issue-analyze stop-advisory-dispatch.sh hook timed out' }] },
  }) + '\n');
  fs.writeFileSync(path.join(home, 'reproduce.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(home, 'gate.js'), 'process.exit(0);\n');
  const first = audit.runAudit({ argv: ['--date', '2026-08-06'], home, timeZone: 'UTC', testFixtureHome: true });
  assert.strictEqual(first.findings.length, 1);
  const verificationEntries = [{ fingerprint: first.findings[0].fingerprint,
    reproduction: { command: 'fixture reproduction', argv: ['node', path.join(home, 'reproduce.js')] },
    consumerGate: { command: 'fixture consumer gate', argv: ['node', path.join(home, 'gate.js')] } }];
  fs.writeFileSync(verificationFile, JSON.stringify(verificationEntries));
  const verificationDigest = audit.verificationDigest(verificationEntries);
  const second = audit.runAudit({ argv: ['--date', '2026-08-06', '--verification-file', verificationFile, '--execute-verification', '--verification-digest', verificationDigest, '--create-issues'], home, timeZone: 'UTC', testFixtureHome: true });
  assert.strictEqual(second.findings[0].status, 'verified');
  assert.ok(!JSON.stringify(second.findings[0].verification).includes(home));
  assert.ok(!JSON.stringify(second.findings[0].verification).includes('secret-value'));
  assert.strictEqual(second.issueResults[0].reason, 'human-confirmation-required');
});

test('executeVerification rejects shell/interpreter payloads before spawning', () => {
  const marker = path.join(os.tmpdir(), `dhpk-session-audit-marker-${process.pid}`);
  try { fs.unlinkSync(marker); } catch (_error) { /* absent */ }
  const entries = [{ fingerprint: 'sha256:' + 'e'.repeat(64),
    reproduction: { argv: ['sh', '-c', `touch ${marker}`] },
    consumerGate: { argv: ['node', 'gate.js'] } }];
  const result = audit.executeVerificationEntries(entries, { home: os.tmpdir(), cwd: process.cwd() });
  assert.strictEqual(result[0].reproduction.status, 'fail');
  assert.ok(!fs.existsSync(marker));
});

test('executeVerification rejects inline evaluation and mutating subcommands', () => {
  const payloads = [
    ['node', '--eval=process.exit(0)'],
    ['node', '-eprocess.exit(0)'],
    ['php', '-r', 'exit(0);'],
    ['gh', 'issue', 'create'],
    ['git', 'push'],
    ['git', 'show', '--textconv', 'HEAD:sample.foo'],
    ['npm', 'exec', 'evil-package'],
  ];
  for (const argv of payloads) {
    const result = audit.executeVerificationEntries([{ fingerprint: 'sha256:' + 'f'.repeat(64), reproduction: { argv }, consumerGate: { argv: ['node', 'gate.js'] } }], { home: os.tmpdir(), cwd: process.cwd() });
    assert.strictEqual(result[0].reproduction.status, 'fail', argv.join(' '));
    assert.strictEqual(result[0].reproduction.execution.trusted, false, argv.join(' '));
  }
});

test('executeVerification keeps stdout and command arguments diagnostic-only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-verification-output-'));
  const script = path.join(home, 'check.js');
  fs.writeFileSync(script, 'process.stdout.write("customer Alice medical-condition hook failed\\n");\n');
  const entries = [{ fingerprint: 'sha256:' + '1'.repeat(64),
    reproduction: { argv: ['node', script, '--customer', 'Alice'] },
    consumerGate: { argv: ['node', script] } }];
  const executed = audit.executeVerificationEntries(entries, { home, cwd: home, digestVerified: true });
  assert.ok(!executed[0].reproduction.execution.stdout.includes('Alice'));
  const finding = audit.verifyFinding({ status: 'candidate', confidence: 0.9, evidence: [] }, executed[0], { home });
  assert.ok(!JSON.stringify(finding.verification).includes('Alice'));
});

test('executeVerification strips runtime injection variables before spawning', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-verification-env-'));
  const marker = path.join(home, 'injected-marker');
  const preload = path.join(home, 'preload.js');
  const reproduction = path.join(home, 'reproduction.js');
  const consumerGate = path.join(home, 'consumer-gate.js');
  fs.writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'injected');\n`);
  fs.writeFileSync(reproduction, 'process.stdout.write(process.env.NODE_OPTIONS ? "unsafe" : "safe");\n');
  fs.writeFileSync(consumerGate, 'process.stdout.write(process.env.PHPRC ? "unsafe" : "safe");\n');
  const entries = [{ fingerprint: 'sha256:' + '2'.repeat(64),
    reproduction: { argv: ['node', reproduction] },
    consumerGate: { argv: ['node', consumerGate] } }];
  const env = {
    ...process.env,
    HOME: home,
    NODE_OPTIONS: `--require=${preload}`,
    NODE_PATH: home,
    PHPRC: path.join(home, 'php.ini'),
    PHP_INI_SCAN_DIR: home,
  };
  const cleanEnv = { ...env };
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.NODE_PATH;
  delete cleanEnv.PHPRC;
  delete cleanEnv.PHP_INI_SCAN_DIR;
  assert.strictEqual(audit.verificationDigest(entries, { env }), audit.verificationDigest(entries, { env: cleanEnv }));
  const executed = audit.executeVerificationEntries(entries, { home, cwd: home, env, digestVerified: true });
  assert.strictEqual(executed[0].reproduction.status, 'pass');
  assert.strictEqual(executed[0].consumerGate.status, 'pass');
  assert.ok(!fs.existsSync(marker));
  assert.ok(!executed[0].reproduction.execution.stdout.includes('unsafe'));
  assert.ok(!executed[0].consumerGate.execution.stdout.includes('unsafe'));
});

test('verification digest binds cwd and relative script realpaths', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-verification-cwd-'));
  const firstCwd = path.join(home, 'first');
  const secondCwd = path.join(home, 'second');
  fs.mkdirSync(firstCwd, { recursive: true });
  fs.mkdirSync(secondCwd, { recursive: true });
  fs.writeFileSync(path.join(firstCwd, 'check.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(firstCwd, 'gate.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(secondCwd, 'check.js'), 'process.exit(1);\n');
  fs.writeFileSync(path.join(secondCwd, 'gate.js'), 'process.exit(1);\n');
  const entries = [{ fingerprint: 'sha256:' + '3'.repeat(64),
    reproduction: { argv: ['node', 'check.js'] },
    consumerGate: { argv: ['node', 'gate.js'] } }];
  const firstDigest = audit.verificationDigest(entries, { cwd: firstCwd });
  const secondDigest = audit.verificationDigest(entries, { cwd: secondCwd });
  assert.notStrictEqual(firstDigest, secondDigest);
  const firstExecution = audit.executeVerificationEntries(entries, { home, cwd: firstCwd, digestVerified: true });
  assert.strictEqual(firstExecution[0].reproduction.status, 'pass');
  assert.strictEqual(firstExecution[0].consumerGate.status, 'pass');
});

test('executeVerification rechecks script digests between reproduction and consumer gate', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-session-audit-verification-race-'));
  const reproduction = path.join(home, 'reproduction.js');
  const consumerGate = path.join(home, 'consumer-gate.js');
  fs.writeFileSync(consumerGate, 'process.exit(1);\n');
  fs.writeFileSync(reproduction, `require('node:fs').writeFileSync(${JSON.stringify(consumerGate)}, 'process.exit(0);\\n');\n`);
  const entries = [{ fingerprint: 'sha256:' + '4'.repeat(64),
    reproduction: { argv: ['node', reproduction] },
    consumerGate: { argv: ['node', consumerGate] } }];
  const expectedVerificationDigest = audit.verificationDigest(entries, { cwd: home });
  const executed = audit.executeVerificationEntries(entries, {
    home,
    cwd: home,
    expectedVerificationDigest,
    digestVerified: true,
  });
  assert.strictEqual(executed[0].reproduction.status, 'pass');
  assert.strictEqual(executed[0].consumerGate.status, 'fail');
  assert.strictEqual(executed[0].consumerGate.execution.trusted, false);
  assert.strictEqual(executed[0].consumerGate.execution.reason, 'verification-digest-mismatch');
});

run('session-usage-audit');
