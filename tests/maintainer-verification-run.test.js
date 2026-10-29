'use strict';

// Public CLI contract for the maintainer verification-run claim and record.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'maintainer', 'verification-run.js');
const RECORD_DIR = path.join('docs', 'evidence', 'verification-runs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-verification-run-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), `${RECORD_DIR}/\n`);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture');

  const child = path.join(tmp, 'fixture-child.js');
  fs.writeFileSync(child, `
'use strict';
const fs = require('node:fs');
const [counter, delay, exitCode, capture, ...received] = process.argv.slice(2);
fs.appendFileSync(counter, 'run\\n');
if (capture) fs.writeFileSync(capture, JSON.stringify(received));
console.log('fixture stdout');
console.error('fixture stderr');
setTimeout(() => process.exit(Number(exitCode)), Number(delay));
`);
  return { tmp, repo, child, counter: path.join(tmp, 'counter'), capture: path.join(tmp, 'args.json') };
}

function cleanup(fixture) {
  fs.rmSync(fixture.tmp, { recursive: true, force: true });
}

function commandArgs(fixture, { delay = 120, exitCode = 0, capture = '', extra = [] } = {}) {
  return [process.execPath, fixture.child, fixture.counter, String(delay), String(exitCode), capture, ...extra];
}

function runStart(fixture, {
  task = 'task-a', attempt = 'attempt-a', key = 'phpunit-fast', args = commandArgs(fixture),
  retry = false, env = {}, expectSuccess = true,
} = {}) {
  const cliArgs = [CLI, 'start', '--root', fixture.repo, '--task', task, '--attempt', attempt, '--key', key];
  if (retry) cliArgs.push('--retry');
  cliArgs.push('--', ...args);
  const result = spawnSync(process.execPath, cliArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...env },
  });
  if (expectSuccess) assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const lines = (result.stdout || '').trim().split('\n').filter(Boolean);
  let response;
  try { response = JSON.parse(lines[lines.length - 1]); } catch (_) { response = null; }
  return { ...result, response };
}

function status(recordPath) {
  return spawnSync(process.execPath, [CLI, 'status', '--record', recordPath], {
    cwd: ROOT, encoding: 'utf8', timeout: 5000,
  });
}

function readRecord(result) {
  assert.ok(result.response && result.response.recordPath, result.stdout);
  return JSON.parse(fs.readFileSync(result.response.recordPath, 'utf8'));
}

async function waitForStatus(fixture, recordPath, expected, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = status(recordPath);
    if (result.stdout.trim()) {
      const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
      if (parsed.status === expected) return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(`record did not reach ${expected} before timeout`);
}

function runStartAsync(fixture, options = {}) {
  const cliArgs = [CLI, 'start', '--root', fixture.repo, '--task', options.task || 'task-a',
    '--attempt', options.attempt || 'attempt-a', '--key', options.key || 'phpunit-fast'];
  cliArgs.push('--', ...(options.args || commandArgs(fixture)));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgs, {
      cwd: ROOT, env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('verification-run CLI timed out')); }, 5000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split('\n').filter(Boolean);
      let response;
      try { response = JSON.parse(lines[lines.length - 1]); } catch (_) { response = null; }
      resolve({ code, stdout, stderr, response });
    });
  });
}

function counterRuns(fixture) {
  return fs.existsSync(fixture.counter) ? fs.readFileSync(fixture.counter, 'utf8').trim().split('\n').length : 0;
}

test('start records the command and git snapshot and persists both child output streams', async () => {
  const fixture = makeFixture();
  try {
    const result = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    const record = readRecord(result);
    const final = await waitForStatus(fixture, record.recordPath || result.response.recordPath, 'passed');
    assert.strictEqual(record.schema, 'dhpk.verification-run.v1');
    assert.deepStrictEqual(record.command, commandArgs(fixture, { delay: 20 }));
    assert.strictEqual(record.task, 'task-a');
    assert.strictEqual(record.attempt, 'attempt-a');
    assert.ok(typeof record.ownerId === 'string' && record.ownerId.length > 0);
    assert.strictEqual(record.snapshot.branch, 'main');
    assert.strictEqual(record.snapshot.head, git(fixture.repo, 'rev-parse', 'HEAD'));
    assert.ok(typeof record.snapshot.dirtyFingerprint === 'string' && record.snapshot.dirtyFingerprint.length > 0);
    assert.ok(path.relative(fixture.repo, record.recordPath || result.response.recordPath).startsWith(`${RECORD_DIR}${path.sep}`));
    assert.ok(path.relative(fixture.repo, record.logPath).startsWith(`${RECORD_DIR}${path.sep}`));
    assert.ok(Number.isInteger(record.pid) && record.pid > 0);
    assert.ok(typeof record.processStartIdentity === 'string' && record.processStartIdentity.length > 0);
    assert.strictEqual(final.status, 'passed');
    assert.strictEqual(final.exitCode, 0);
    const log = fs.readFileSync(record.logPath, 'utf8');
    assert.match(log, /fixture stdout/);
    assert.match(log, /fixture stderr/);
    assert.match(result.stdout, /fixture stdout/);
    assert.match(result.stderr, /fixture stderr/);
  } finally { cleanup(fixture); }
});

test('simultaneous starts for one claim launch one child and return the same record', async () => {
  const fixture = makeFixture();
  try {
    const options = { args: commandArgs(fixture, { delay: 220 }) };
    const results = await Promise.all([runStartAsync(fixture, options), runStartAsync(fixture, options)]);
    assert.deepStrictEqual(results.map((item) => item.code), [0, 0]);
    assert.strictEqual(results[0].response.recordPath, results[1].response.recordPath);
    await waitForStatus(fixture, results[0].response.recordPath, 'passed');
    assert.strictEqual(counterRuns(fixture), 1);
  } finally { cleanup(fixture); }
});

test('a completed claim is reused without launching the command again', async () => {
  const fixture = makeFixture();
  try {
    const first = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    const record = readRecord(first);
    await waitForStatus(fixture, first.response.recordPath, 'passed');
    const reused = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    assert.strictEqual(reused.status, 0, reused.stderr);
    assert.strictEqual(reused.response.recordPath, first.response.recordPath);
    assert.strictEqual(reused.response.reused, true);
    assert.strictEqual(counterRuns(fixture), 1);
    assert.strictEqual(record.attempt, 'attempt-a');
  } finally { cleanup(fixture); }
});

test('arguments after the delimiter reach the child literally without shell evaluation', async () => {
  const fixture = makeFixture();
  try {
    const payload = 'literal; $(touch SHOULD_NOT_EXIST) `echo nope`';
    const args = commandArgs(fixture, { delay: 20, capture: fixture.capture, extra: [payload] });
    const result = runStart(fixture, { args });
    const record = readRecord(result);
    await waitForStatus(fixture, result.response.recordPath, 'passed');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fixture.capture, 'utf8')), [payload]);
    assert.strictEqual(fs.existsSync(path.join(fixture.repo, 'SHOULD_NOT_EXIST')), false);
    assert.deepStrictEqual(record.command, args);
  } finally { cleanup(fixture); }
});

test('a nonzero child exit is durable as failed with its exit code', async () => {
  const fixture = makeFixture();
  try {
    const result = runStart(fixture, { args: commandArgs(fixture, { delay: 20, exitCode: 7 }), expectSuccess: false });
    assert.strictEqual(result.status, 7);
    const failed = await waitForStatus(fixture, result.response.recordPath, 'failed');
    assert.strictEqual(failed.exitCode, 7);
    assert.strictEqual(JSON.parse(fs.readFileSync(result.response.recordPath, 'utf8')).status, 'failed');
  } finally { cleanup(fixture); }
});

test('a changed repository head creates a distinct claim for the same key', async () => {
  const fixture = makeFixture();
  try {
    const first = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    await waitForStatus(fixture, first.response.recordPath, 'passed');
    const oldHead = git(fixture.repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(fixture.repo, 'snapshot-change.txt'), 'new head\n');
    git(fixture.repo, 'add', 'snapshot-change.txt');
    git(fixture.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'new snapshot');
    const second = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    const record = readRecord(second);
    await waitForStatus(fixture, second.response.recordPath, 'passed');
    assert.notStrictEqual(record.snapshot.head, oldHead);
    assert.notStrictEqual(second.response.recordPath, first.response.recordPath);
    assert.strictEqual(counterRuns(fixture), 2);
  } finally { cleanup(fixture); }
});

test('a changed command creates a distinct claim for the same key and snapshot', async () => {
  const fixture = makeFixture();
  try {
    const first = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    await waitForStatus(fixture, first.response.recordPath, 'passed');
    const secondArgs = commandArgs(fixture, { delay: 20, extra: ['different-argv'] });
    const second = runStart(fixture, { args: secondArgs });
    const record = readRecord(second);
    await waitForStatus(fixture, second.response.recordPath, 'passed');
    assert.deepStrictEqual(record.command, secondArgs);
    assert.notStrictEqual(second.response.recordPath, first.response.recordPath);
    assert.strictEqual(counterRuns(fixture), 2);
  } finally { cleanup(fixture); }
});

test('relevant environment changes create an independent claim', async () => {
  const fixture = makeFixture();
  try {
    const args = commandArgs(fixture, { delay: 20 });
    const first = runStart(fixture, { args, env: { DHPK_TEST_JOBS: '1', NODE_ENV: 'test' } });
    await waitForStatus(fixture, first.response.recordPath, 'passed');
    const second = runStart(fixture, { args, env: { DHPK_TEST_JOBS: '2', NODE_ENV: 'test' } });
    assert.strictEqual(second.status, 0, second.stderr);
    assert.notStrictEqual(second.response.recordPath, first.response.recordPath);
    await waitForStatus(fixture, second.response.recordPath, 'passed');
    assert.strictEqual(counterRuns(fixture), 2);
  } finally { cleanup(fixture); }
});

test('failed runs need explicit retry with a new attempt; unknown runs cannot be retried', async () => {
  const fixture = makeFixture();
  try {
    const failed = runStart(fixture, { args: commandArgs(fixture, { delay: 20, exitCode: 5 }), expectSuccess: false });
    assert.strictEqual(failed.status, 5);
    await waitForStatus(fixture, failed.response.recordPath, 'failed');
    const noRetry = runStart(fixture, { args: commandArgs(fixture, { delay: 20, exitCode: 5 }), expectSuccess: false });
    assert.strictEqual(noRetry.status, 5);
    assert.strictEqual(noRetry.response.recordPath, failed.response.recordPath);
    assert.strictEqual(counterRuns(fixture), 1);
    const retried = runStart(fixture, {
      attempt: 'attempt-b', retry: true, args: commandArgs(fixture, { delay: 20 }),
    });
    assert.strictEqual(retried.status, 0, retried.stderr);
    assert.notStrictEqual(retried.response.recordPath, failed.response.recordPath);
    await waitForStatus(fixture, retried.response.recordPath, 'passed');
    assert.strictEqual(counterRuns(fixture), 2);
  } finally { cleanup(fixture); }
});

test('missing and corrupt status records fail safely without creating files', () => {
  const fixture = makeFixture();
  try {
    const missing = path.join(fixture.tmp, 'missing.json');
    const corrupt = path.join(fixture.tmp, 'corrupt.json');
    fs.writeFileSync(corrupt, '{not-json');
    for (const recordPath of [missing, corrupt]) {
      const result = status(recordPath);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /record|json|invalid|missing|not found/i);
      assert.strictEqual(fs.existsSync(missing), false);
      assert.strictEqual(fs.readFileSync(corrupt, 'utf8'), '{not-json');
    }
  } finally { cleanup(fixture); }
});

test('an unprovable running owner stays unknown and cannot be taken over', async () => {
  const fixture = makeFixture();
  try {
    const first = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    await waitForStatus(fixture, first.response.recordPath, 'passed');
    const record = JSON.parse(fs.readFileSync(first.response.recordPath, 'utf8'));
    record.status = 'running';
    record.pid = 2147483647;
    record.processStartIdentity = 'unprovable-fixture-owner';
    fs.writeFileSync(first.response.recordPath, `${JSON.stringify(record, null, 2)}\n`);
    const unknown = status(first.response.recordPath);
    assert.strictEqual(unknown.status, 2, unknown.stderr);
    assert.strictEqual(JSON.parse(unknown.stdout.trim().split('\n').pop()).status, 'unknown');
    const duplicate = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }), expectSuccess: false });
    assert.strictEqual(duplicate.status, 2, duplicate.stderr);
    assert.strictEqual(duplicate.response.status, 'unknown');
    const retry = runStart(fixture, {
      retry: true, attempt: 'attempt-b', expectSuccess: false,
      args: commandArgs(fixture, { delay: 20 }),
    });
    assert.notStrictEqual(retry.status, 0);
    assert.strictEqual(counterRuns(fixture), 1);
  } finally { cleanup(fixture); }
});

test('same-command retry needs a distinct attempt and preserves original evidence', async () => {
  const fixture = makeFixture();
  try {
    const args = commandArgs(fixture, { delay: 20, exitCode: 6 });
    const first = runStart(fixture, { args, expectSuccess: false });
    assert.strictEqual(first.status, 6);
    const firstRecord = readRecord(first);
    const originalBytes = fs.readFileSync(first.response.recordPath);
    const originalLog = fs.readFileSync(firstRecord.logPath);
    const sameAttempt = runStart(fixture, { args, retry: true, expectSuccess: false });
    assert.notStrictEqual(sameAttempt.status, 0);
    assert.strictEqual(counterRuns(fixture), 1);
    const retry = runStart(fixture, { args, retry: true, attempt: 'attempt-b', expectSuccess: false });
    assert.strictEqual(retry.status, 6);
    const retryRecord = readRecord(retry);
    assert.strictEqual(retryRecord.status, 'failed');
    assert.strictEqual(retryRecord.attempt, 'attempt-b');
    assert.notStrictEqual(retry.response.recordPath, first.response.recordPath);
    assert.notStrictEqual(retryRecord.logPath, firstRecord.logPath);
    assert.deepStrictEqual(fs.readFileSync(first.response.recordPath), originalBytes);
    assert.deepStrictEqual(fs.readFileSync(firstRecord.logPath), originalLog);
    assert.strictEqual(counterRuns(fixture), 2);
    const reused = runStart(fixture, { args, expectSuccess: false });
    assert.strictEqual(reused.status, 6);
    assert.strictEqual(reused.response.recordPath, retry.response.recordPath);
    assert.strictEqual(counterRuns(fixture), 2);
  } finally { cleanup(fixture); }
});

test('different bytes with unchanged dirty flags create a distinct claim', () => {
  const fixture = makeFixture();
  try {
    const file = path.join(fixture.repo, 'dirty.txt');
    fs.writeFileSync(file, 'one');
    const first = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    const firstRecord = readRecord(first);
    fs.writeFileSync(file, 'two');
    const second = runStart(fixture, { args: commandArgs(fixture, { delay: 20 }) });
    const secondRecord = readRecord(second);
    assert.notStrictEqual(secondRecord.snapshot.dirtyFingerprint, firstRecord.snapshot.dirtyFingerprint);
    assert.notStrictEqual(second.response.recordPath, first.response.recordPath);
    assert.strictEqual(counterRuns(fixture), 2);
  } finally { cleanup(fixture); }
});

test('a symlinked evidence directory is rejected without writing through it', () => {
  const fixture = makeFixture();
  try {
    const outside = path.join(fixture.tmp, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(fixture.repo, 'docs', 'evidence'), { recursive: true });
    fs.symlinkSync(outside, path.join(fixture.repo, RECORD_DIR));
    const result = runStart(fixture, { expectSuccess: false });
    assert.notStrictEqual(result.status, 0);
    assert.deepStrictEqual(fs.readdirSync(outside), []);
    assert.strictEqual(counterRuns(fixture), 0);
  } finally { cleanup(fixture); }
});

test('signal termination and spawn failure return a nonzero wrapper exit', () => {
  const fixture = makeFixture();
  try {
    const signaled = runStart(fixture, {
      args: [process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'], expectSuccess: false,
    });
    assert.strictEqual(signaled.status, 1);
    assert.strictEqual(readRecord(signaled).status, 'failed');
    const missing = runStart(fixture, {
      args: [path.join(fixture.tmp, 'does-not-exist')], expectSuccess: false,
    });
    assert.strictEqual(missing.status, 1);
    assert.strictEqual(readRecord(missing).status, 'failed');
  } finally { cleanup(fixture); }
});

test('arbitrary environment changes invalidate reuse without persisting raw environment values', () => {
  const fixture = makeFixture();
  try {
    const args = [process.execPath, '-e', 'process.exit(process.env.VERIFICATION_FIXTURE_SECRET === "private-first" ? 0 : 9)'];
    const first = runStart(fixture, { args, env: { VERIFICATION_FIXTURE_SECRET: 'private-first' } });
    const second = runStart(fixture, {
      args, env: { VERIFICATION_FIXTURE_SECRET: 'private-second' }, expectSuccess: false,
    });
    assert.strictEqual(second.status, 9);
    assert.notStrictEqual(second.response.recordPath, first.response.recordPath);
    const firstRecord = readRecord(first);
    const secondRecord = readRecord(second);
    assert.match(firstRecord.envDigest, /^[a-f0-9]{64}$/);
    assert.notStrictEqual(firstRecord.envDigest, secondRecord.envDigest);
    assert.deepStrictEqual(Object.keys(secondRecord.environment).sort(), ['DHPK_TEST_JOBS', 'NODE_ENV']);
    const persisted = fs.readFileSync(second.response.recordPath, 'utf8');
    assert.strictEqual(persisted.includes('private-second'), false);
    assert.strictEqual(persisted.includes('VERIFICATION_FIXTURE_SECRET"'), false);
  } finally { cleanup(fixture); }
});

test('source drift during a successful command becomes unknown and cannot be reused as passed', async () => {
  const fixture = makeFixture();
  try {
    const source = path.join(fixture.repo, 'source.txt');
    const ready = path.join(fixture.tmp, 'ready');
    fs.writeFileSync(source, 'BAD');
    git(fixture.repo, 'add', 'source.txt');
    git(fixture.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'source');
    const args = [process.execPath, '-e',
      'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], "ready"); setTimeout(() => process.exit(fs.readFileSync(process.argv[2], "utf8") === "GOOD" ? 0 : 8), 250);',
      ready, source];
    const pending = runStartAsync(fixture, { args });
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.strictEqual(fs.existsSync(ready), true, 'child did not start');
    fs.writeFileSync(source, 'GOOD');
    const result = await pending;
    assert.strictEqual(result.code, 2);
    assert.strictEqual(result.response.status, 'unknown');
    assert.strictEqual(result.response.exitCode, 0);
    assert.strictEqual(result.response.sourceChanged, true);
    fs.writeFileSync(source, 'BAD');
    const reused = runStart(fixture, { args, expectSuccess: false });
    assert.strictEqual(reused.status, 2);
    assert.strictEqual(reused.response.recordPath, result.response.recordPath);
    assert.strictEqual(reused.response.reused, true);
  } finally { cleanup(fixture); }
});

run('maintainer-verification-run');
