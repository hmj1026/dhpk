'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'maintainer', 'delivery-gate.js');
const OWNER_REPO = 'hmj1026/dhpk';
const PR = 41;
const HEAD = 'a'.repeat(40);
const TITLE = 'Retro delivery guardrails';
const BODY = 'Delivery evidence is checked against this exact PR body.';
const GH_STUB = `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n');
const endpoint = args[args.indexOf('api') + 1] || '';
const scenario = process.env.GH_SCENARIO || 'valid';
const head = process.env.GH_HEAD || '${HEAD}';
const body = ${JSON.stringify(BODY)};
let pullCount = 0;
if (scenario === 'gh-error') { process.stderr.write('API unavailable'); process.exit(1); }
if (endpoint.includes('/pulls/${PR}')) {
  const all = fs.readFileSync(process.env.GH_CALLS, 'utf8').trim().split('\\n')
    .map((line) => JSON.parse(line)).filter((call) => call[0] === 'api' && call[1].includes('/pulls/${PR}'));
  pullCount = all.length;
  const changed = scenario === 'head-changes-before-merge' && pullCount > 1;
  const merged = scenario === 'merge-readback' && fs.existsSync(process.env.GH_MERGE_MARKER);
  process.stdout.write(JSON.stringify({
    number: ${PR}, state: merged ? 'closed' : 'open', merged,
    draft: scenario === 'draft', base: { ref: 'develop' },
    head: { sha: changed ? '${'b'.repeat(40)}' : head },
    title: ${JSON.stringify(TITLE)}, body,
    review_decision: 'APPROVED', mergeable: scenario === 'conflict' ? false : true,
    merge_commit_sha: merged ? head : null,
  }));
} else if (endpoint.includes('/branches/develop/protection')) {
  if (scenario === 'modern-rules' || scenario === 'protection-404') {
    process.stderr.write('gh: Not Found (HTTP 404)'); process.exit(1);
  }
  process.stdout.write(JSON.stringify(scenario === 'missing-rules' ? {} : {
    required_status_checks: { contexts: ['Validate harness assets'], checks: [{ context: 'Validate harness assets', app_id: 15368 }] },
    required_pull_request_reviews: scenario === 'classic-review-required' ? { required_approving_review_count: 1 } : null,
  }));
} else if (endpoint.includes('/rules/branches/develop')) {
  process.stdout.write(JSON.stringify(scenario === 'modern-rules' ? [{
    type: 'required_status_checks', parameters: {
      required_status_checks: [{ context: 'Validate harness assets', integration_id: 15368 }],
    },
  }] : scenario === 'modern-review-required' ? [{
    type: 'pull_request', parameters: { required_approving_review_count: 1 },
  }] : []));
} else if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ reviewDecision: scenario === 'review-needed' ? 'REVIEW_REQUIRED' : ['empty-review', 'classic-review-required', 'modern-review-required'].includes(scenario) ? '' : 'APPROVED' }));
} else if (endpoint.includes('/check-runs')) {
  let conclusion = 'success';
  let status = 'completed';
  let runHead = head;
  let appId = 15368;
  if (scenario === 'missing-check') process.stdout.write(JSON.stringify({ total_count: 0, check_runs: [] }));
  else {
    if (scenario === 'pending-check' || scenario === 'older-green-newer-pending') { status = 'in_progress'; conclusion = null; }
    if (scenario === 'failed-check') conclusion = 'failure';
    if (scenario === 'stale-check') runHead = '${'c'.repeat(40)}';
    if (scenario === 'wrong-app') appId = 99999;
    const currentRun = {
      id: 200, name: 'Validate harness assets', status, conclusion, head_sha: runHead,
      started_at: '2026-10-29T00:00:00Z',
      app: { id: appId }, completed_at: status === 'completed' ? '2026-10-29T00:00:00Z' : null,
    };
    const checkRuns = scenario === 'older-failed-newer-green' ? [
      { ...currentRun, id: 19, conclusion: 'failure' }, currentRun,
    ] : scenario === 'older-green-newer-pending' ? [
      { ...currentRun, id: 19, status: 'completed', conclusion: 'success', completed_at: '2026-10-28T00:00:00Z' },
      currentRun,
    ] : [currentRun];
    const paginated = scenario === 'paginated-checks';
    const secondPage = endpoint.includes('page=2');
    process.stdout.write(JSON.stringify(paginated ? {
      total_count: 101,
      check_runs: secondPage ? [currentRun] : Array.from({ length: 100 }, (_, id) => ({
        ...currentRun, id: id + 1, conclusion: 'failure',
      })),
    } : { total_count: checkRuns.length, check_runs: checkRuns }));
  }
} else if (endpoint.includes('/commits/') && endpoint.includes('/status?')) {
  const state = scenario === 'pending-status' ? 'pending' : scenario === 'failed-status' ? 'failure' : 'success';
  process.stdout.write(JSON.stringify({ state, statuses: state === 'success' ? [] : [{
    state, context: 'Validate harness assets',
  }] }));
} else if (args[0] === 'pr' && args[1] === 'merge') {
  fs.writeFileSync(process.env.GH_MERGE_MARKER, '1');
  process.env.GH_MERGE_CALLED = '1';
  process.stdout.write('merged\\n');
} else {
  process.stderr.write('unexpected gh invocation: ' + JSON.stringify(args) + '\\n');
  process.exitCode = 91;
}
`;

function makeFixture({ scenario = 'valid', evidenceOverrides = {}, prHead = HEAD } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-delivery-gate-'));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
  const localLog = path.join(directory, 'local.log');
  const reviewReport = path.join(directory, 'review.md');
  fs.writeFileSync(localLog, 'focused verification completed\n');
  fs.writeFileSync(reviewReport, 'APPROVE: no findings\n');
  const bodySha256 = crypto.createHash('sha256').update(BODY).digest('hex');
  const evidence = {
    schema: 'dhpk.delivery-evidence.v1',
    headSha: HEAD,
    local: { headSha: HEAD, status: 'PASS', command: 'npm test -- --filter delivery', logPath: localLog },
    review: { headSha: HEAD, status: 'APPROVE', reviewers: ['reviewer-one'], reportPath: reviewReport },
    metadata: { title: TITLE, bodySha256 },
    ...evidenceOverrides,
  };
  const evidencePath = path.join(directory, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  const callsPath = path.join(directory, 'gh-calls.jsonl');
  const mergeMarker = path.join(directory, 'merge-called');
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    GH_CALLS: callsPath,
    GH_MERGE_MARKER: mergeMarker,
    GH_SCENARIO: scenario,
    GH_HEAD: prHead,
  };
  const args = [CLI, '--repo', OWNER_REPO, '--pr', String(PR), '--head', HEAD, '--evidence', evidencePath];
  return { directory, evidencePath, callsPath, mergeMarker, env, args };
}

function runGate(fixture, extraArgs = [], env = {}) {
  return spawnSync(process.execPath, [...fixture.args, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...fixture.env, ...env },
    timeout: 15000,
  });
}

function calls(fixture) {
  if (!fs.existsSync(fixture.callsPath)) return [];
  return fs.readFileSync(fixture.callsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function withFixture(options, fn) {
  const fixture = makeFixture(options);
  try { return fn(fixture); } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
}

test('valid current evidence and required checks pass without merging by default', () => withFixture({}, (fixture) => {
  const result = runGate(fixture);
  assert.strictEqual(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /PASS/);
  assert.ok(!calls(fixture).some((args) => args[0] === 'pr' && args[1] === 'merge'));
  assert.ok(!fs.existsSync(fixture.mergeMarker), 'default check must not mutate the remote PR');
}));

test('missing, pending, failed, stale, and wrong-app required checks block without merging', () => {
  for (const scenario of [
    'missing-check', 'pending-check', 'failed-check', 'stale-check', 'wrong-app', 'older-green-newer-pending',
    'pending-status', 'failed-status',
  ]) {
    withFixture({ scenario }, (fixture) => {
      const result = runGate(fixture);
      assert.notStrictEqual(result.status, 0, `${scenario} should block`);
      assert.match(`${result.stdout}${result.stderr}`, /required|check|status/i, `${scenario}: ${result.stdout}${result.stderr}`);
      assert.ok(!calls(fixture).some((args) => args[0] === 'pr' && args[1] === 'merge'), `${scenario} must not merge`);
    });
  }
});

test('missing branch protection or required-check rules block closed', () => withFixture({ scenario: 'missing-rules' }, (fixture) => {
  const result = runGate(fixture);
  assert.notStrictEqual(result.status, 0);
      assert.match(`${result.stdout}${result.stderr}`, /rule|protection|required/i);
  assert.ok(!fs.existsSync(fixture.mergeMarker));
}));

test('local and review evidence need exact current heads and existing nonempty pointers', () => {
  const variants = [
    { local: { headSha: 'd'.repeat(40) } },
    { review: { headSha: 'e'.repeat(40) } },
    { local: null },
    { review: null },
    { local: { logPath: '/no/such/local-log' } },
    { review: { reportPath: '/no/such/review-report' } },
    { local: { status: 'FAIL' } },
    { review: { reviewers: [] } },
    { metadata: { bodySha256: null } },
  ];
  for (const override of variants) {
    const base = makeFixture();
    try {
      const evidence = JSON.parse(fs.readFileSync(base.evidencePath, 'utf8'));
      for (const [section, fields] of Object.entries(override)) {
        evidence[section] = fields === null ? null : { ...evidence[section], ...fields };
      }
      fs.writeFileSync(base.evidencePath, JSON.stringify(evidence));
      const result = runGate(base);
      assert.notStrictEqual(result.status, 0, JSON.stringify(override));
      assert.match(`${result.stdout}${result.stderr}`, /evidence|local|review|pointer/i);
      assert.ok(!fs.existsSync(base.mergeMarker));
    } finally { fs.rmSync(base.directory, { recursive: true, force: true }); }
  }
});

test('PR title and full body digest must match the delivery evidence', () => withFixture({
  evidenceOverrides: { metadata: { title: 'wrong', bodySha256: '0'.repeat(64) } },
}, (fixture) => {
  const result = runGate(fixture);
  assert.notStrictEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /title|body|digest|metadata/i);
  assert.ok(!fs.existsSync(fixture.mergeMarker));
}));

test('PR head must remain the requested commit', () => withFixture({ prHead: 'f'.repeat(40) }, (fixture) => {
  const result = runGate(fixture);
  assert.notStrictEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /head|sha|commit/i);
  assert.ok(!fs.existsSync(fixture.mergeMarker));
}));

test('execute rechecks gates, uses only the exact normal merge command, then verifies merged head', () => withFixture({ scenario: 'merge-readback' }, (fixture) => {
  const result = runGate(fixture, ['--execute']);
  assert.strictEqual(result.status, 0, result.stderr + result.stdout);
  const mergeCalls = calls(fixture).filter((args) => args[0] === 'pr' && args[1] === 'merge');
  assert.deepStrictEqual(mergeCalls, [[
    'pr', 'merge', String(PR), '--repo', OWNER_REPO, '--merge', '--match-head-commit', HEAD,
  ]]);
  assert.ok(fs.existsSync(fixture.mergeMarker));
  assert.ok(calls(fixture).filter((args) => args[0] === 'api' && args[1].includes(`/pulls/${PR}`)).length >= 2,
    'execution must refresh PR state and independently read it back');
}));

test('execute blocks if the PR head changes during its immediate pre-merge refresh', () => withFixture({
  scenario: 'head-changes-before-merge',
}, (fixture) => {
  const result = runGate(fixture, ['--execute']);
  assert.notStrictEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /head|sha|commit/i);
  assert.ok(!fs.existsSync(fixture.mergeMarker));
}));

test('production check-run reruns, pagination, and effective modern rules are accepted', () => {
  for (const scenario of ['older-failed-newer-green', 'paginated-checks', 'modern-rules', 'empty-review']) {
    withFixture({ scenario }, (fixture) => {
      const result = runGate(fixture);
      assert.strictEqual(result.status, 0, scenario + result.stderr);
    });
  }
});

test('draft, conflicting, unapproved, unavailable API, and unprotected PRs block', () => {
  for (const scenario of ['draft', 'conflict', 'review-needed', 'gh-error', 'protection-404', 'classic-review-required', 'modern-review-required']) {
    withFixture({ scenario }, (fixture) => {
      const result = runGate(fixture, ['--execute']);
      assert.notStrictEqual(result.status, 0, scenario);
      assert.ok(!fs.existsSync(fixture.mergeMarker), scenario);
    });
  }
});

test('merge command success without independently observed merged state stays blocked', () => withFixture({}, (fixture) => {
  const result = runGate(fixture, ['--execute']);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /readback pending/);
  assert.ok(fs.existsSync(fixture.mergeMarker));
}));

test('empty artifacts block and unsafe or duplicate CLI arguments never reach gh', () => withFixture({}, (fixture) => {
  for (const args of [['--admin'], ['--repo', 'other/repo'], ['--pr', '-1'], ['--execute', '--execute']]) {
    const result = runGate(fixture, args);
    assert.notStrictEqual(result.status, 0);
    assert.deepStrictEqual(calls(fixture), []);
  }
  const evidence = JSON.parse(fs.readFileSync(fixture.evidencePath, 'utf8'));
  fs.writeFileSync(evidence.review.reportPath, '  ');
  assert.notStrictEqual(runGate(fixture).status, 0);
  assert.deepStrictEqual(calls(fixture), []);
}));

run('maintainer-delivery-gate');
