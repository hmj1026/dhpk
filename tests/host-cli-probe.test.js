'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');
const {
  runHostCliProbe,
  hostCliProbeEvidence,
  refusedHostCliProbe,
} = require('../scripts/lib/host-cli-probe');

const SH = '/bin/sh';

function groupGone(pid, waitMs = 3000) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    if (Date.now() > deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

test('exit 0 reports exact exit code, no signal, no timeout, duration, and both tails', () => {
  const result = runHostCliProbe(SH, ['-c', 'printf out-ok; printf err-ok >&2'], { timeoutMs: 10000 });
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.outputLimited, false);
  assert.strictEqual(result.error, null);
  assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0, String(result.durationMs));
  assert.strictEqual(result.stdout, 'out-ok');
  assert.strictEqual(result.stderr, 'err-ok');
  assert.strictEqual(result.stdoutTail, 'out-ok');
  assert.strictEqual(result.stderrTail, 'err-ok');
});

test('a non-zero exit keeps the exact inner exit code and stderr diagnostics', () => {
  const result = runHostCliProbe(SH, ['-c', 'echo "bad flag" >&2; exit 3'], { timeoutMs: 10000 });
  assert.strictEqual(result.exitCode, 3);
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.stderrTail, 'bad flag\n');
});

test('an inner timeout exit 124 is preserved and flagged as timed out', () => {
  const result = runHostCliProbe(SH, ['-c', 'echo "inner deadline" >&2; exit 124'], { timeoutMs: 10000 });
  assert.strictEqual(result.exitCode, 124);
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.stderrTail, 'inner deadline\n');
});

test('a shell wrapper around an inner exit 124 does not turn it into exit 0', () => {
  const result = runHostCliProbe(SH, ['-c', `${SH} -c 'exit 124'; status=$?; echo "wrapped $status" >&2; exit $status`], { timeoutMs: 10000 });
  assert.strictEqual(result.exitCode, 124);
  assert.strictEqual(result.timedOut, true);
  assert.match(result.stderrTail, /wrapped 124/);
});

test('elapsed duration reflects real child run time', () => {
  const result = runHostCliProbe(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { timeoutMs: 10000 });
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.durationMs >= 250, `durationMs ${result.durationMs} must cover the 300 ms child`);
  assert.ok(result.durationMs < 5000, `durationMs ${result.durationMs} is implausibly large`);
});

test('a runner timeout kills the process group and keeps bounded partial output', () => {
  const result = runHostCliProbe(SH, ['-c', 'echo PARTIAL_OUT; echo PARTIAL_ERR >&2; sleep 30'], { timeoutMs: 300 });
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.exitCode, null);
  assert.strictEqual(result.signal, 'SIGKILL');
  assert.ok(result.durationMs >= 250 && result.durationMs < 10000, String(result.durationMs));
  assert.strictEqual(result.stdoutTail, 'PARTIAL_OUT\n');
  assert.strictEqual(result.stderrTail, 'PARTIAL_ERR\n');
  assert.ok(Number.isInteger(result.pid) && result.pid > 0);
  assert.ok(groupGone(result.pid), 'the timed-out sleep grandchild must be reaped with its process group');
});

test('stdout and stderr tails are byte-bounded, keep the newest bytes, and never split UTF-8', () => {
  const script = 'process.stdout.write("A".repeat(5000) + "OUT_END"); process.stderr.write("中".repeat(400) + "ERR_END");';
  const result = runHostCliProbe(process.execPath, ['-e', script], { timeoutMs: 10000, tailBytes: 64 });
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.stdout.length, 5007);
  assert.ok(Buffer.byteLength(result.stdoutTail) <= 64);
  assert.ok(result.stdoutTail.endsWith('OUT_END'), result.stdoutTail);
  assert.ok(Buffer.byteLength(result.stderrTail) <= 64);
  assert.ok(result.stderrTail.endsWith('ERR_END'), result.stderrTail);
  assert.ok(!result.stderrTail.includes('\uFFFD'), result.stderrTail);
  assert.ok(/^中+ERR_END$/.test(result.stderrTail), result.stderrTail);
});

test('output beyond maxBuffer is reported as outputLimited with partial tails and a reaped group', () => {
  const result = runHostCliProbe(SH, ['-c', 'echo FIRST_LINE; yes overflow; sleep 30'], { timeoutMs: 10000, maxBuffer: 4096, tailBytes: 32 });
  assert.strictEqual(result.outputLimited, true);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.exitCode, null);
  assert.ok(Buffer.byteLength(result.stdoutTail) <= 32);
  assert.match(result.stdoutTail, /overflow/);
  assert.ok(groupGone(result.pid), 'an output-limited process group must be reaped');
});

test('a missing executable reports ENOENT without claiming a timeout', () => {
  const dir = makeTempDir('dhpk-host-cli-probe-');
  const result = runHostCliProbe(path.join(dir, 'missing-host-cli'), ['--version'], { timeoutMs: 1000 });
  assert.strictEqual(result.error && result.error.code, 'ENOENT');
  assert.strictEqual(result.exitCode, null);
  assert.strictEqual(result.timedOut, false);
});

test('buffer encoding returns raw stdout bytes while tails stay text', () => {
  const result = runHostCliProbe(SH, ['-c', 'printf raw'], { timeoutMs: 10000, encoding: 'buffer' });
  assert.ok(Buffer.isBuffer(result.stdout));
  assert.strictEqual(result.stdout.toString('utf8'), 'raw');
  assert.strictEqual(result.stdoutTail, 'raw');
});

test('a non-positive timeout is rejected before spawning', () => {
  assert.throws(() => runHostCliProbe(SH, ['-c', 'true'], { timeoutMs: 0 }), /timeoutMs/);
});

test('evidence exposes the structured probe fields with redacted tails', () => {
  const result = runHostCliProbe(SH, ['-c', 'echo "token=secret-value" >&2; exit 124'], { timeoutMs: 10000 });
  const evidence = hostCliProbeEvidence(result, (text) => text.replace(/secret-value/g, '<redacted>'));
  assert.deepStrictEqual(Object.keys(evidence), ['exitCode', 'signal', 'timedOut', 'durationMs', 'stdoutTail', 'stderrTail']);
  assert.strictEqual(evidence.exitCode, 124);
  assert.strictEqual(evidence.timedOut, true);
  assert.strictEqual(evidence.stderrTail, 'token=<redacted>\n');
});

test('a refused probe has the same structured shape without a child process', () => {
  const error = Object.assign(new Error('sandbox unavailable'), { code: 'DHPK_NETWORK_SANDBOX_UNAVAILABLE' });
  const refused = refusedHostCliProbe(error);
  assert.strictEqual(refused.exitCode, 125);
  assert.strictEqual(refused.timedOut, false);
  assert.strictEqual(refused.durationMs, 0);
  assert.strictEqual(refused.error, error);
  assert.strictEqual(refused.pid, null);
  assert.strictEqual(refused.stdoutTail, '');
  assert.strictEqual(refused.stderrTail, '');
});

run('host-cli-probe');
