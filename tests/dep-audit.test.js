'use strict';

// Deterministic coverage for scripts/dep-audit.sh. Package managers and the
// timeout command are PATH stubs so these tests never contact a registry.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'dep-audit.sh');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dep-audit-'));
}

function npmReport(severity, name = 'fixture-package') {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const vulnerabilities = {};
  if (severity) {
    counts[severity] = 1;
    counts.total = 1;
    vulnerabilities[name] = {
      name,
      severity,
      via: [{ title: `${name} advisory`, severity, url: 'https://example.invalid/advisory' }],
      effects: [],
      range: '*',
      nodes: [`node_modules/${name}`],
      fixAvailable: false,
    };
  }
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: counts,
      dependencies: { prod: 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 },
    },
  });
}

function yarnReport(severity, name = 'fixture-yarn-package') {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const records = [];
  if (severity) {
    counts[severity] = 1;
    counts.total = 1;
    records.push({
      type: 'auditAdvisory',
      data: {
        advisory: {
          title: `${name} advisory`,
          severity,
          module_name: name,
          url: 'https://example.invalid/advisory',
        },
      },
    });
  }
  records.push({ type: 'auditSummary', data: { vulnerabilities: counts } });
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function createFixture(options = {}) {
  const ecosystem = options.ecosystem || 'npm';
  const cwd = mkTmp();
  const bin = mkTmp();
  const minimalBin = options.perlWatchdog ? mkTmp() : null;
  const outputFile = path.join(cwd, 'audit-output.fixture');
  const callLog = path.join(cwd, 'package-manager-calls.log');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  if (ecosystem === 'yarn' || ecosystem === 'pnpm-over-yarn') {
    fs.writeFileSync(path.join(cwd, 'yarn.lock'), '');
  }
  if (ecosystem === 'pnpm' || ecosystem === 'pnpm-over-yarn') {
    fs.writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), '');
  }

  const defaultOutput = ecosystem === 'yarn' ? yarnReport() : npmReport();
  fs.writeFileSync(outputFile, options.auditOutput === undefined ? defaultOutput : options.auditOutput);
  fs.writeFileSync(callLog, '');

  const managerStub = [
    '#!/bin/sh',
    'printf "%s %s\\n" "$(basename "$0")" "$*" >> "$DEP_AUDIT_CALL_LOG"',
    'if [ "${1:-}" = "audit" ] && [ "${2:-}" = "--json" ]; then',
    '  if [ "${DEP_AUDIT_STUB_DELAY:-0}" != "0" ]; then sleep "$DEP_AUDIT_STUB_DELAY"; fi',
    '  cat "$DEP_AUDIT_STUB_OUTPUT"',
    '  exit "$DEP_AUDIT_STUB_AUDIT_EXIT"',
    'fi',
    'exit 0',
    '',
  ].join('\n');
  for (const manager of ['npm', 'pnpm', 'yarn']) {
    fs.writeFileSync(path.join(bin, manager), managerStub, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'npx'), [
    '#!/bin/sh',
    'printf "npx %s\\n" "$*" >> "$DEP_AUDIT_CALL_LOG"',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });

  if (!options.perlWatchdog) {
    const timeoutStub = options.timeout
      ? ['#!/bin/sh', 'printf "timeout %s\\n" "$*" >> "$DEP_AUDIT_CALL_LOG"', 'exit 124', ''].join('\n')
      : ['#!/bin/sh', 'shift', 'exec "$@"', ''].join('\n');
    fs.writeFileSync(path.join(bin, 'timeout'), timeoutStub, { mode: 0o755 });
  }

  if (minimalBin) {
    for (const executable of ['bash', 'basename', 'cat', 'jq', 'mktemp', 'perl', 'rm', 'sleep']) {
      const resolved = (process.env.PATH || '').split(path.delimiter)
        .map((directory) => path.join(directory, executable))
        .find((candidate) => fs.existsSync(candidate));
      assert.ok(resolved, `required executable not found: ${executable}`);
      fs.symlinkSync(resolved, path.join(minimalBin, executable));
    }
  }

  const env = {
    ...process.env,
    PATH: minimalBin
      ? `${bin}${path.delimiter}${minimalBin}`
      : `${bin}${path.delimiter}${process.env.PATH || ''}`,
    DEP_AUDIT_CALL_LOG: callLog,
    DEP_AUDIT_STUB_OUTPUT: outputFile,
    DEP_AUDIT_STUB_AUDIT_EXIT: String(options.auditExit === undefined ? 0 : options.auditExit),
    DEP_AUDIT_STUB_DELAY: String(options.auditDelay || 0),
    DEP_AUDIT_TIMEOUT: options.perlWatchdog ? '1' : '5',
  };

  return {
    cwd,
    env,
    run(args = []) {
      return spawnSync('bash', [SCRIPT, ...args], { cwd, env, encoding: 'utf8', timeout: 15000 });
    },
    calls() {
      const contents = fs.readFileSync(callLog, 'utf8').trim();
      return contents ? contents.split(/\r?\n/) : [];
    },
    managerCalls() {
      return this.calls().filter((call) => /^(npm|pnpm|yarn|npx) /.test(call));
    },
    fixCalls() {
      return this.managerCalls().filter((call) => !/ audit --json(?:\s|$)/.test(call));
    },
    cleanup() {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(bin, { recursive: true, force: true });
      if (minimalBin) fs.rmSync(minimalBin, { recursive: true, force: true });
    },
  };
}

function withFixture(options, fn) {
  const fixture = createFixture(options);
  try {
    fn(fixture);
  } finally {
    fixture.cleanup();
  }
}

function assertAuditFailed(res, fixture) {
  const problems = [];
  if (res.status === 0 || res.stdout.includes('PASS')) {
    problems.push(`audit unexpectedly passed (status ${res.status})\n${res.stdout}`);
  }
  if (fixture.fixCalls().length > 0) {
    problems.push(`fixer ran without a valid completed report: ${fixture.fixCalls().join('; ')}`);
  }
  assert.strictEqual(problems.length, 0, problems.join('\n'));
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('-h/--help prints usage without invoking a package manager', () => {
  withFixture({}, (fixture) => {
    const res = fixture.run(['--help']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Usage:'), res.stdout);
    assert.ok(!res.stdout.includes('DEPENDENCY AUDIT'), res.stdout);
    assert.deepStrictEqual(fixture.managerCalls(), []);
  });
});

test('unknown flags are rejected before an audit runs', () => {
  withFixture({}, (fixture) => {
    const res = fixture.run(['--bogus']);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes('Unknown arg'), res.stderr);
    assert.deepStrictEqual(fixture.managerCalls(), []);
  });
});

test('a failed audit command cannot pass or trigger an explicit fix', () => {
  withFixture({ auditOutput: npmReport(), auditExit: 42 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('a timed out audit cannot pass or trigger an explicit fix', () => {
  withFixture({ timeout: true, auditOutput: npmReport() }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
    assert.ok(fixture.calls().some((call) => call === 'timeout 5 npm audit --json'), fixture.calls().join('\n'));
  });
});

test('the Perl watchdog times out when timeout utilities are unavailable', () => {
  withFixture({ perlWatchdog: true, auditDelay: 3 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
    assert.ok(res.stderr.includes('exit 124'), res.stderr);
    assert.deepStrictEqual(fixture.fixCalls(), []);
  });
});

test('empty audit output cannot pass or trigger an explicit fix', () => {
  withFixture({ auditOutput: '', auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('malformed audit JSON cannot pass or trigger an explicit fix', () => {
  withFixture({ auditOutput: '{"auditReportVersion":2,', auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('JSON without the audit report schema cannot pass or trigger an explicit fix', () => {
  withFixture({ auditOutput: JSON.stringify({ auditReportVersion: 2 }), auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('non-numeric vulnerability counts cannot pass or trigger an explicit fix', () => {
  const report = JSON.parse(npmReport());
  report.metadata.vulnerabilities.high = '0';
  withFixture({ auditOutput: JSON.stringify(report), auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('counts outside the supported integer range cannot pass or trigger an explicit fix', () => {
  const report = JSON.parse(npmReport());
  report.metadata.vulnerabilities.high = 2147483648;
  report.metadata.vulnerabilities.total = 2147483648;
  withFixture({ auditOutput: JSON.stringify(report), auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('npm findings that disagree with summary counts cannot pass or trigger an explicit fix', () => {
  const report = JSON.parse(npmReport('high', 'unreported-npm-high'));
  report.metadata.vulnerabilities.high = 0;
  report.metadata.vulnerabilities.total = 0;
  withFixture({ auditOutput: JSON.stringify(report), auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--level', 'high', '--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('concatenated npm JSON reports cannot pass or trigger an explicit fix', () => {
  const output = `${npmReport()}\n${npmReport('high', 'second-report-high')}`;
  withFixture({ auditOutput: output, auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--level', 'high', '--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('informational npm findings are valid below the low severity gate', () => {
  withFixture({ auditOutput: npmReport('info'), auditExit: 1 }, (fixture) => {
    const res = fixture.run(['--level', 'low']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
  });
});

test('malformed Yarn summary cannot pass or trigger an explicit fix', () => {
  const report = `${JSON.stringify({ type: 'auditSummary', data: { vulnerabilities: { total: 0 } } })}\n`;
  withFixture({ ecosystem: 'yarn', auditOutput: report, auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('Yarn advisories that disagree with summary counts cannot pass or trigger an explicit fix', () => {
  const report = `${JSON.stringify({
    type: 'auditAdvisory',
    data: { advisory: { title: 'Unreported high', severity: 'high', module_name: 'hidden-high' } },
  })}\n${JSON.stringify({
    type: 'auditSummary',
    data: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  })}\n`;
  withFixture({ ecosystem: 'yarn', auditOutput: report, auditExit: 0 }, (fixture) => {
    const res = fixture.run(['--level', 'high', '--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('a command error with partial vulnerability output still fails closed', () => {
  withFixture({ auditOutput: npmReport('high'), auditExit: 42 }, (fixture) => {
    const res = fixture.run(['--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('npm vulnerability JSON gates a high finding even when audit exits nonzero', () => {
  withFixture({ auditOutput: npmReport('high', 'fixture-npm-high'), auditExit: 1 }, (fixture) => {
    const res = fixture.run(['--level', 'high']);
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: npm'), res.stdout);
    assert.ok(res.stdout.includes('| High | 1 |'), res.stdout);
    assert.ok(res.stdout.includes('fixture-npm-high'), res.stdout);
    assert.ok(res.stdout.includes('FAIL'), res.stdout);
  });
});

test('pnpm JSON retains moderate findings below a high gate on nonzero audit exit', () => {
  withFixture({ ecosystem: 'pnpm', auditOutput: npmReport('moderate', 'fixture-pnpm-moderate'), auditExit: 1 }, (fixture) => {
    const res = fixture.run(['--level', 'high']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: pnpm'), res.stdout);
    assert.ok(res.stdout.includes('| Moderate | 1 |'), res.stdout);
    assert.ok(res.stdout.includes('fixture-pnpm-moderate'), res.stdout);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
  });
});

test('Yarn NDJSON gates a critical finding with Yarn Classic severity exit code', () => {
  withFixture({ ecosystem: 'yarn', auditOutput: yarnReport('critical'), auditExit: 16 }, (fixture) => {
    const res = fixture.run(['--level', 'high']);
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: yarn'), res.stdout);
    assert.ok(res.stdout.includes('| Critical | 1 |'), res.stdout);
    assert.ok(res.stdout.includes('fixture-yarn-package advisory'), res.stdout);
    assert.ok(res.stdout.includes('FAIL'), res.stdout);
  });
});

test('Yarn moderate findings pass a high gate on nonzero audit exit', () => {
  withFixture({ ecosystem: 'yarn', auditOutput: yarnReport('moderate'), auditExit: 4 }, (fixture) => {
    const res = fixture.run(['--level', 'high']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('| Moderate | 1 |'), res.stdout);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
  });
});

test('an unexplained Yarn command error cannot pass or trigger an explicit fix', () => {
  withFixture({ ecosystem: 'yarn', auditOutput: yarnReport('moderate'), auditExit: 42 }, (fixture) => {
    const res = fixture.run(['--level', 'high', '--fix']);
    assertAuditFailed(res, fixture);
  });
});

test('Yarn moderate findings remain severity-gated with its severity bitmask exit code', () => {
  withFixture({ ecosystem: 'yarn', auditOutput: yarnReport('moderate'), auditExit: 4 }, (fixture) => {
    const res = fixture.run(['--level', 'high']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('| Moderate | 1 |'), res.stdout);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
  });
});

test('an explicit fix runs after a valid vulnerability report with nonzero audit exit', () => {
  withFixture({ auditOutput: npmReport('high'), auditExit: 1 }, (fixture) => {
    const res = fixture.run(['--level', 'high', '--fix']);
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    const calls = fixture.managerCalls();
    assert.strictEqual(calls.length, 2, calls.join('\n'));
    assert.strictEqual(calls[0], 'npm audit --json');
    assert.ok(!/ audit --json(?:\s|$)/.test(calls[1]), calls[1]);
  });
});

test('a valid audit without --fix does not invoke a fixer', () => {
  withFixture({ auditOutput: npmReport(), auditExit: 0 }, (fixture) => {
    const res = fixture.run();
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.deepStrictEqual(fixture.managerCalls(), ['npm audit --json']);
  });
});

test('--level accepts the supported critical threshold', () => {
  withFixture({ auditOutput: npmReport('high'), auditExit: 1 }, (fixture) => {
    const res = fixture.run(['--level', 'critical']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Minimum Level: critical'), res.stdout);
    assert.ok(res.stdout.includes('| High | 1 |'), res.stdout);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
  });
});

test('each requested severity gates matching findings and permits lower ones', () => {
  const cases = [
    { severity: 'critical', level: 'critical', status: 1 },
    { severity: 'moderate', level: 'moderate', status: 1 },
    { severity: 'low', level: 'low', status: 1 },
    { severity: 'low', level: 'moderate', status: 0 },
    { severity: null, level: 'low', status: 0 },
  ];
  for (const { severity, level, status } of cases) {
    withFixture({ auditOutput: npmReport(severity), auditExit: severity ? 1 : 0 }, (fixture) => {
      const res = fixture.run(['--level', level]);
      assert.strictEqual(res.status, status, `${severity || 'clear'} at ${level}: ${res.stdout}${res.stderr}`);
    });
  }
});

test('--level rejects values outside the supported severities before auditing', () => {
  withFixture({}, (fixture) => {
    const res = fixture.run(['--level', 'urgent']);
    assert.strictEqual(res.status, 2, res.stdout + res.stderr);
    assert.deepStrictEqual(fixture.managerCalls(), []);
  });
});

test('--level requires a severity value before auditing', () => {
  withFixture({}, (fixture) => {
    const res = fixture.run(['--level']);
    assert.strictEqual(res.status, 2, res.stdout + res.stderr);
    assert.deepStrictEqual(fixture.managerCalls(), []);
  });
});

test('pnpm lockfile selection takes precedence over yarn.lock', () => {
  withFixture({ ecosystem: 'pnpm-over-yarn' }, (fixture) => {
    const res = fixture.run();
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: pnpm'), res.stdout);
    assert.deepStrictEqual(fixture.managerCalls(), ['pnpm audit --json']);
  });
});

run('dep-audit');
