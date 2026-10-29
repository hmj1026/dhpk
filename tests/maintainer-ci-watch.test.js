'use strict';

// Exercise the exported watcher contract through a child process and a local
// fake gh executable, keeping every API and run-watch interaction offline.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'scripts', 'maintainer', 'ci-watch.js');
const HEAD = 'a'.repeat(40);
const REPO = 'acme/widget';
const PR_NUMBER = 42;
const PR_CREATED = '2026-10-28T09:00:00Z';

function makePr(overrides = {}) {
  return {
    number: PR_NUMBER,
    created_at: PR_CREATED,
    base: { ref: 'develop', repo: { full_name: REPO } },
    head: { sha: HEAD, ref: 'feature/ci-watch', repo: { id: 9001 } },
    ...overrides,
  };
}

function makeRun(id, overrides = {}) {
  return {
    id,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    head_sha: HEAD,
    head_branch: 'feature/ci-watch',
    pull_requests: [{ number: PR_NUMBER }],
    created_at: '2026-10-29T01:00:00Z',
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
    ...overrides,
  };
}

function fixture({
  prViews = [makePr()],
  runLookups = [[]],
  watchExitCode = 0,
  watchStdout = 'fixture watch stdout\n',
  watchStderr = 'fixture watch stderr\n',
  apiFailure = false,
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ci-watch-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const dataPath = path.join(tmp, 'fixture.json');
  const callPath = path.join(tmp, 'calls.jsonl');
  const logPath = path.join(tmp, 'watch.log');
  fs.writeFileSync(dataPath, JSON.stringify({
    prViews, runLookups, watchExitCode, watchStdout, watchStderr, apiFailure,
  }));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(process.env.GH_FIXTURE, 'utf8'));
const callPath = process.env.GH_CALLS;
fs.appendFileSync(callPath, JSON.stringify(args) + '\\n');
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
if (args[0] === 'api') {
  if (fixture.apiFailure) {
    process.stderr.write('fixture gh api failure\\n');
    process.exit(1);
  }
  const endpoint = args.find((arg) => arg.startsWith('repos/')) || '';
  if (/\\/pulls\\/${PR_NUMBER}(?:\\?|$)/.test(endpoint)) {
    const key = path.join(path.dirname(callPath), 'pr-count');
    const index = Number(fs.existsSync(key) ? fs.readFileSync(key, 'utf8') : '0');
    fs.writeFileSync(key, String(index + 1));
    emit(fixture.prViews[Math.min(index, fixture.prViews.length - 1)]);
    process.exit(0);
  }
  if (endpoint.includes('/actions/workflows/ci.yml/runs')) {
    const url = new URL(endpoint, 'https://api.github.com/');
    const page = Number(url.searchParams.get('page') || '1');
    const counter = path.join(path.dirname(callPath), 'lookup-count');
    let round = Number(fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : '0');
    if (page === 1) {
      fs.writeFileSync(counter, String(round + 1));
    } else {
      round = Math.max(0, round - 1);
    }
    const runs = fixture.runLookups[Math.min(round, fixture.runLookups.length - 1)] || [];
    const pageRuns = runs.slice((page - 1) * 100, page * 100);
    emit({ total_count: runs.length, workflow_runs: pageRuns });
    process.exit(0);
  }
  process.stderr.write('unexpected gh api endpoint: ' + endpoint + '\\n');
  process.exit(2);
}
if (args[0] === 'run' && args[1] === 'watch') {
  process.stdout.write(fixture.watchStdout);
  process.stderr.write(fixture.watchStderr);
  process.exit(fixture.watchExitCode);
}
process.stderr.write('unexpected gh argv: ' + JSON.stringify(args) + '\\n');
process.exit(2);
`, { mode: 0o755 });
  return { tmp, bin, dataPath, callPath, logPath };
}

function invoke(f, { waitSeconds = 0, intervalSeconds = 0, ...overrides } = {}) {
  const driver = `
'use strict';
const { runCiWatch } = require(${JSON.stringify(HELPER)});
(async () => {
  const result = await runCiWatch({
    repo: ${JSON.stringify(REPO)}, pr: ${PR_NUMBER}, head: ${JSON.stringify(HEAD)},
    log: process.env.GH_LOG,
    waitSeconds: ${waitSeconds}, intervalSeconds: ${intervalSeconds},
    ...${JSON.stringify(overrides)},
  });
  process.stdout.write(JSON.stringify({ __result: result }) + '\\n');
})().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + '\\n');
  process.exitCode = 1;
});
`;
  const result = spawnSync(process.execPath, ['-e', driver], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      PATH: `${f.bin}${path.delimiter}${process.env.PATH || ''}`,
      GH_FIXTURE: f.dataPath,
      GH_CALLS: f.callPath,
      GH_LOG: f.logPath,
    },
  });
  const outputLines = (result.stdout || '').trim().split('\n').filter(Boolean);
  let response;
  try { response = JSON.parse(outputLines[outputLines.length - 1]); } catch (_) { response = null; }
  return { ...result, outputLines, response: response && response.__result };
}

function calls(f) {
  if (!fs.existsSync(f.callPath)) return [];
  return fs.readFileSync(f.callPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function cleanup(f) {
  fs.rmSync(f.tmp, { recursive: true, force: true });
}

function assertTransitionLines(result) {
  const lines = result.outputLines.slice(0, -1);
  assert.ok(lines.length > 0, 'expected at least one transition line');
  for (const line of lines) {
    assert.ok(line.length < 500, 'transition line should be compact');
    assert.doesNotThrow(() => JSON.parse(line), `transition is not JSON: ${line}`);
  }
}

test('watches the newest run for the pinned PR and exact head', () => {
  const older = makeRun(410, { created_at: '2026-10-29T01:00:00Z' });
  const newest = makeRun(411, { created_at: '2026-10-29T02:00:00Z' });
  const f = fixture({ runLookups: [[older, newest], [older, newest]] });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(result.response, {
      status: 'passed', exitCode: 0, runId: 411,
      runUrl: 'https://github.com/acme/widget/actions/runs/411', conclusion: 'success',
    });
    assert.ok(calls(f).some((args) => args[0] === 'run' && args[1] === 'watch' && args[2] === '411'));
    assertTransitionLines(result);
  } finally { cleanup(f); }
});

test('returns BLOCKED after deadline when two fresh lookups find no run', () => {
  const f = fixture({ runLookups: [[], []] });
  try {
    const result = invoke(f, { waitSeconds: 0 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.status, 'blocked');
    assert.ok(result.response.exitCode !== 0);
    assert.strictEqual(calls(f).filter((args) => args[0] === 'run' && args[1] === 'watch').length, 0);
    assertTransitionLines(result);
  } finally { cleanup(f); }
});

test('attaches a queued run found by the deadline lookup', () => {
  const queued = makeRun(512, { status: 'queued', conclusion: null });
  const f = fixture({ runLookups: [[], [queued], [queued]] });
  try {
    const result = invoke(f, { waitSeconds: 0 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.runId, 512);
    assert.notStrictEqual(result.response.status, 'passed');
    assert.ok(calls(f).some((args) => args[0] === 'run' && args[1] === 'watch' && args[2] === '512'));
    assertTransitionLines(result);
  } finally { cleanup(f); }
});

test('does not pass an older success when a newer queued run appears after watch', () => {
  const oldSuccess = makeRun(601);
  const newerQueued = makeRun(602, {
    status: 'queued', conclusion: null, created_at: '2026-10-29T03:00:00Z',
  });
  const f = fixture({ runLookups: [[oldSuccess], [oldSuccess, newerQueued], [oldSuccess, newerQueued]] });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.status, 'blocked');
    assert.strictEqual(result.response.runId, 602);
    assert.ok(calls(f).some((args) => args[0] === 'run' && args[1] === 'watch' && args[2] === '601'));
    assert.ok(calls(f).some((args) => args[0] === 'run' && args[1] === 'watch' && args[2] === '602'));
  } finally { cleanup(f); }
});

test('keeps verbose watch output in the log and emits compact transition JSON', () => {
  const noisy = 'WATCH-DIAGNOSTIC-'.repeat(32000);
  const f = fixture({
    runLookups: [[makeRun(701)], [makeRun(701)]],
    watchStdout: `${noisy}stdout-end\n`, watchStderr: `${noisy}stderr-end\n`,
  });
  try {
    fs.writeFileSync(f.logPath, 'existing-log\n');
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(f.logPath, 'utf8'),
      `existing-log\n${noisy}stdout-end\n${noisy}stderr-end\n`);
    assert.ok(!result.stdout.includes('WATCH-DIAGNOSTIC-'));
    assert.ok(!result.stderr.includes('WATCH-DIAGNOSTIC-'));
    assertTransitionLines(result);
  } finally { cleanup(f); }
});

test('revalidates the pinned head after watch and refuses a late head drift', () => {
  const changedPr = makePr({ head: { sha: 'b'.repeat(40), ref: 'feature/ci-watch', repo: { id: 9001 } } });
  const f = fixture({
    prViews: [makePr(), makePr(), changedPr],
    runLookups: [[makeRun(801)], [makeRun(801)]],
  });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.notStrictEqual(result.response.status, 'passed');
    assert.ok(result.response.exitCode !== 0);
    assertTransitionLines(result);
  } finally { cleanup(f); }
});

test('revalidates the pinned head before watch and never attaches a stale run', () => {
  const changedPr = makePr({ head: { sha: 'b'.repeat(40), ref: 'feature/ci-watch', repo: { id: 9001 } } });
  const f = fixture({
    prViews: [makePr(), changedPr],
    runLookups: [[makeRun(802)]],
  });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.notStrictEqual(result.response.status, 'passed');
    assert.strictEqual(calls(f).filter((args) => args[0] === 'run' && args[1] === 'watch').length, 0);
  } finally { cleanup(f); }
});

test('treats gh lookup errors as non-passing outcomes', () => {
  const f = fixture({ runLookups: [[makeRun(901)]], apiFailure: true });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.notStrictEqual(result.response.status, 'passed');
    assert.ok(result.response.exitCode !== 0);
  } finally { cleanup(f); }
});

test('ignores runs for another head, workflow, or event', () => {
  const wrongHead = makeRun(1001, { head_sha: 'c'.repeat(40) });
  const wrongWorkflow = makeRun(1002, { path: '.github/workflows/nightly.yml' });
  const wrongEvent = makeRun(1003, { event: 'push' });
  const f = fixture({ runLookups: [[wrongHead, wrongWorkflow, wrongEvent], []] });
  try {
    const result = invoke(f, { waitSeconds: 0 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.status, 'blocked');
    assert.strictEqual(calls(f).filter((args) => args[0] === 'run' && args[1] === 'watch').length, 0);
  } finally { cleanup(f); }
});

test('uses only the bounded empty-association fallback with complete matching PR metadata', () => {
  const oldPr = makePr({ created_at: '2026-10-28T10:00:00Z' });
  const fallback = makeRun(1104, {
    pull_requests: [],
    head_repository: { id: 9001 },
    created_at: '2026-10-29T01:00:00Z',
  });
  const mismatches = [
    makeRun(1101, { pull_requests: [], head_repository: { id: 8000 } }),
    makeRun(1105, { pull_requests: [], head_repository: { id: '9001' } }),
    makeRun(1102, { pull_requests: [], head_branch: 'feature/other' }),
    makeRun(1103, { pull_requests: [], created_at: '2026-10-28T09:30:00Z' }),
  ];
  const f = fixture({ prViews: [oldPr], runLookups: [[...mismatches, fallback], [...mismatches, fallback]] });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.status, 'passed');
    assert.strictEqual(result.response.runId, 1104);
  } finally { cleanup(f); }
});

test('does not apply the empty-association fallback to nonempty or malformed associations', () => {
  const nonemptyWrongPr = makeRun(1201, {
    pull_requests: [{ number: 7 }], head_repository: { id: 9001 },
  });
  const malformed = makeRun(1202, {
    pull_requests: [{ title: 'association with no number' }], head_repository: { id: 9001 },
  });
  const missingAssociation = makeRun(1203, { pull_requests: undefined, head_repository: { id: 9001 } });
  const f = fixture({ runLookups: [[nonemptyWrongPr, malformed, missingAssociation], []] });
  try {
    const result = invoke(f, { waitSeconds: 0 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.status, 'blocked');
    assert.strictEqual(calls(f).filter((args) => args[0] === 'run' && args[1] === 'watch').length, 0);
  } finally { cleanup(f); }
});

test('selects the newest qualifying run across explicit REST pages', () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => makeRun(1300 + index, {
    created_at: `2026-10-29T${String(1 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`,
  }));
  const pageTwoNewest = makeRun(1499, { created_at: '2026-10-29T05:00:00Z' });
  const f = fixture({ runLookups: [[...firstPage, pageTwoNewest], [...firstPage, pageTwoNewest]] });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.runId, 1499);
    assert.ok(calls(f).some((args) => args.some((arg) => /[?&]page=2(?:&|$)/.test(arg))));
  } finally { cleanup(f); }
});

test('never invokes GitHub commands that close, reopen, rerun, or dispatch workflows', () => {
  const f = fixture({ runLookups: [[makeRun(1401)], [makeRun(1401)]] });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    const forbidden = calls(f).filter((args) =>
      args.some((arg) => ['close', 'reopen', 'rerun', 'dispatch', 'merge', '--slurp'].includes(arg))
      || (args[0] === 'api' && args[args.indexOf('--method') + 1] !== 'GET')
      || !['api', 'run'].includes(args[0])
      || (args[0] === 'run' && args[1] !== 'watch'));
    assert.deepStrictEqual(forbidden, []);
  } finally { cleanup(f); }
});

test('rejects invalid option bounds before API access or log mutation', () => {
  const invalidOptions = [
    { repo: 'bad/repo/extra' }, { pr: 0 }, { pr: '42' }, { head: 'short' },
    { log: 'relative.log' }, { waitSeconds: -1 }, { waitSeconds: 3601 },
    { intervalSeconds: -1 }, { intervalSeconds: 301 },
    { waitSeconds: 1, intervalSeconds: 0 },
    { waitSeconds: 0.5 }, { intervalSeconds: 0.5 },
  ];
  for (const invalid of invalidOptions) {
    const f = fixture({ runLookups: [[makeRun(1501)]] });
    try {
      fs.writeFileSync(f.logPath, 'existing log\n');
      const result = invoke(f, invalid);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.response.exitCode, 2, JSON.stringify(invalid));
      assert.deepStrictEqual(calls(f), [], JSON.stringify(invalid));
      assert.strictEqual(fs.readFileSync(f.logPath, 'utf8'), 'existing log\n');
    } finally { cleanup(f); }
  }
});

test('never promotes watch errors or unsuccessful current conclusions to PASS', () => {
  for (const watchExitCode of [0, 1]) {
    for (const conclusion of ['success', 'failure', 'cancelled', 'timed_out', null]) {
      if (watchExitCode === 0 && conclusion === 'success') continue;
      const current = makeRun(1601, { conclusion });
      const f = fixture({ runLookups: [[current], [current]], watchExitCode });
      try {
        const result = invoke(f);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.response.status, 'failed');
        assert.strictEqual(result.response.exitCode, 1);
      } finally { cleanup(f); }
    }
  }
});

test('requires all metadata guards for an empty PR association', () => {
  const cases = [
    { pr: makePr({ base: { ref: 'main', repo: { full_name: REPO } } }) },
    { pr: makePr({ base: { ref: 'develop', repo: { full_name: 'other/repo' } } }) },
    { pr: makePr({ created_at: undefined }) },
    { pr: makePr({ created_at: 'invalid' }) },
    { pr: makePr({ head: { sha: HEAD, ref: 'feature/ci-watch', repo: { id: '9001' } } }) },
    { pr: makePr({ head: { sha: HEAD, ref: 'feature/ci-watch', repo: { id: 0 } } }) },
    { run: { head_repository: undefined } },
    { run: { head_repository: { id: 0 } } },
    { run: { created_at: undefined } },
    { run: { created_at: 'invalid' } },
    { run: { pull_requests: null } },
    { run: { pull_requests: {} } },
  ];
  for (const entry of cases) {
    const candidate = makeRun(1701, {
      pull_requests: [], head_repository: { id: 9001 }, ...entry.run,
    });
    const f = fixture({ prViews: [entry.pr || makePr()], runLookups: [[candidate], [candidate]] });
    try {
      const result = invoke(f);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.response.status, 'blocked', JSON.stringify(entry));
      assert.strictEqual(result.response.exitCode, 2);
      assert.strictEqual(calls(f).filter((args) => args[0] === 'run').length, 0);
    } finally { cleanup(f); }
  }
});

test('continues watching a distinct newer run after an older watch exits unsuccessfully', () => {
  const older = makeRun(1801, { conclusion: 'failure' });
  const newer = makeRun(1802);
  const f = fixture({ runLookups: [[older], [older, newer], [older, newer]], watchExitCode: 1 });
  try {
    const result = invoke(f);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.response.status, 'failed');
    assert.strictEqual(result.response.runId, 1802);
    assert.ok(calls(f).some((args) => args[0] === 'run' && args[1] === 'watch' && args[2] === '1802'));
  } finally { cleanup(f); }
});

run('maintainer-ci-watch');
