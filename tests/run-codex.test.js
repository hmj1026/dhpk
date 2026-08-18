'use strict';

// run-codex.sh — the codex-bridge / codex-fast-worker CLI wrapper. Verifies the
// optional model/effort args (4th/5th) produce `-m <model>` / `-c
// model_reasoning_effort="<effort>"`, and that the original 3-arg shape stays
// byte-identical (no model/effort flags — inherit-from-config for codex-bridge).
// Worker-style calls (DHPK_CODEX_ROLE=codex-fast-worker) also pass additive
// `--output-schema` (report-schema.json next to the wrapper) while keeping
// `--output-last-message`; other roles omit the schema. Isolation flags
// `--ephemeral` / `--ignore-user-config` are opt-in via env; `ultra` effort is
// never passed through. A PATH-stubbed `codex` captures argv and honors
// --output-last-message so no real API call happens.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { buildToolsOnlyDir } = require('./_lib/restricted-path');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'scripts', 'run-codex.sh');
const REPORT_SCHEMA = path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'scripts', 'report-schema.json');
const TIMEOUT_ENVELOPE_HELPER = path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'scripts', 'codex-timeout-envelope.js');

// The wrapper's own runtime dependencies (excluding `timeout`/`gtimeout`, which the
// restricted-PATH tests below deliberately omit or fake).
const REQUIRED_TOOLS = ['mktemp', 'grep', 'tail', 'cat', 'rm', 'date', 'tr', 'bash', 'node', 'setsid'];

// A fake `timeout` that ignores its wrapped command entirely, sleeps ~its duration
// argument, then exits 124 — simulating a genuine GNU timeout kill (elapsed time close
// to the configured budget). Tests using this stub always override the wrapper's
// CODEX_WRAP_TIMEOUT_SECS to a small value so the sleep stays short.
const TIMEOUT_STUB_FIRES = `#!/usr/bin/env bash
dur="$1"
sleep "$dur"
# Keep the elapsed-time corroboration comfortably above the wrapper's half-
# budget threshold even when the wall clock truncates a boundary-second sleep.
sleep 1
exit 124
`;

// A fake `timeout` that genuinely passes through to the wrapped command (shifts off the
// duration argument and execs the rest) — proves a quick backend-native 124 is not
// misclassified as a wrapper timeout merely because a timeout binary was used.
const TIMEOUT_STUB_PASSTHROUGH = `#!/usr/bin/env bash
shift
exec "$@"
`;

// A fake timeout that lets the wrapped codex process write its final report and
// diagnostics, then kills it at the configured budget and returns 124.
const TIMEOUT_STUB_KILLS = `#!/usr/bin/env bash
dur="$1"
shift
setsid "$@" &
child="$!"
sleep "$dur"
kill -KILL -- "-$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
wait "$child" 2>/dev/null || true
# Leave a full extra second so the wrapper's elapsed-time corroboration cannot
# mistake a boundary-second kill for a backend-native 124 under load.
sleep 1
exit 124
`;

// A fake `codex` that records its argv to $ARGV_OUT and, when it sees
// --output-last-message <file>, writes a non-empty message there so the wrapper
// treats the run as successful.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$ARGV_OUT"
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi
  prev="$a"
done
[ "\${STUB_EMPTY:-0}" = "1" ] || { [ -n "$out" ] && printf 'stub-ok\\n' > "$out"; }
printf '%s' "\${STUB_STDERR:-}" >&2
exit "\${STUB_EXIT:-0}"
`;

// A fake codex that exercises the operational helper parser mode through the
// same wrapper shell used by production callers.
const PARSER_STUB = `#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi
  prev="$a"
done
if [ -n "\${PARSE_INPUT_FILE:-}" ]; then
  parsed="$(cat "\${PARSE_INPUT_FILE}" | node "\${PARSE_HELPER}" --parse 2>"\${out}.parse.err")"
else
  parsed="$(printf '%s' "\${PARSE_INPUT:-}" | node "\${PARSE_HELPER}" --parse 2>"\${out}.parse.err")"
fi
code=$?
if [ "$code" -ne 0 ]; then
  cat "\${out}.parse.err" >&2
  exit "$code"
fi
[ -n "$out" ] && printf '%s' "$parsed" > "$out"
exit 0
`;

// A fake codex that writes the final report and bounded diagnostics before it
// waits to be killed by TIMEOUT_STUB_KILLS.
const SLOW_REPORT_STUB = `#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi
  prev="$a"
done
[ -n "$out" ] && printf '%s' "\${STUB_REPORT:-slow report}" > "$out"
if [ "\${STUB_INCLUDE_TEMP_PATH:-0}" = "1" ]; then
  out_dir="\${out%/*}"
  printf '\npath=%s\n' "$out_dir" >> "$out"
fi
printf '%s' "\${STUB_STDOUT:-stdout diagnostic}"
printf '%s' "\${STUB_STDERR:-stderr diagnostic}" >&2
# Keep the fixture's helper process below the parent spawnSync guard even if a
# platform's setsid implementation forks before the timeout stub can reap it.
sleep "\${STUB_SLEEP:-3}"
exit 0
`;

function withStub(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-codex-'));
  try {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'codex'), STUB, { mode: 0o755 });
    const promptFile = path.join(dir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'do the thing');
    const argvOut = path.join(dir, 'argv.txt');
    fn({ dir, binDir, promptFile, argvOut });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// `opts.toolsDir`, when set, replaces the inherited process.env.PATH entirely with
// `<binDir>:<toolsDir>` — used by the restricted-PATH tests to prove behavior when
// `timeout`/`gtimeout` are genuinely absent (prepending to the inherited PATH would
// still leave the real binary reachable later in it). `opts.stubExit` sets the fake
// codex's exit code (default 0).
function runWrapper({ binDir, argvOut, dir }, args, extraEnv = {}, opts = {}) {
  const PATH = opts.toolsDir ? `${binDir}:${opts.toolsDir}` : `${binDir}:${process.env.PATH}`;
  const env = { ...process.env, PATH, ARGV_OUT: argvOut, STUB_EXIT: String(opts.stubExit ?? 0) };
  // Wrapper timeout/role env from the parent process (e.g. a live-smoke in the
  // same shell) must not leak into cases that resolve config themselves.
  for (const key of Object.keys(env)) {
    if (key.startsWith('DHPK_CODEX_') || key === 'DHPK_OUTER_BUDGET_SECS') delete env[key];
  }
  Object.assign(env, extraEnv);
  return spawnSync('bash', [WRAPPER, ...args], {
    env,
    cwd: dir,
    encoding: 'utf8',
    // The wrapper budget is intentionally short, but process-group teardown
    // can take a few seconds on a loaded CI worker. Keep this outer fixture
    // bound finite without turning teardown races into empty-result flakes.
    timeout: 20000,
  });
}

test('model + effort args produce -m and model_reasoning_effort flags', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'gpt-5.6-luna', 'xhigh']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(/(^|\n)-m(\n|$)/.test(argv) && argv.includes('gpt-5.6-luna'),
      `expected -m gpt-5.6-luna in argv:\n${argv}`);
    assert.ok(argv.includes('model_reasoning_effort=xhigh'),
      `expected model_reasoning_effort=xhigh in argv:\n${argv}`);
  });
});

test('three-arg shape omits model/effort flags (byte-identical legacy behavior)', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile]);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    assert.strictEqual(res.stdout, 'stub-ok\n', 'successful output must remain raw final-message bytes');
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!/(^|\n)-m(\n|$)/.test(argv), `unexpected -m flag in legacy shape:\n${argv}`);
    assert.ok(!argv.includes('model_reasoning_effort'),
      `unexpected model_reasoning_effort in legacy shape:\n${argv}`);
    // Core flags still present.
    assert.ok(argv.includes('--sandbox') && argv.includes('read-only'), `missing sandbox flag:\n${argv}`);
    assert.ok(argv.includes('approval_policy=never'), `missing approval policy:\n${argv}`);
  });
});

test('role-aware project timeout is resolved without changing the wrapper argv shape', () => {
  withStub((ctx) => {
    fs.mkdirSync(path.join(ctx.dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(ctx.dir, '.claude', 'settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { codex_fast_worker_timeout_secs: '7' } } },
    }));
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      DHPK_CODEX_ROLE: 'codex-fast-worker',
      DHPK_OUTER_BUDGET_SECS: '5',
    });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    assert.strictEqual(res.stdout, 'stub-ok\n');
    assert.ok(res.stderr.includes('role=codex-fast-worker'), `missing role diagnostic: ${res.stderr}`);
    assert.ok(res.stderr.includes('timeout=7'), `missing effective timeout diagnostic: ${res.stderr}`);
    assert.ok(res.stderr.includes('source=project:codex_fast_worker_timeout_secs'),
      `missing timeout source diagnostic: ${res.stderr}`);
    assert.ok(res.stderr.includes('outer_budget=5') && res.stderr.includes('outer_budget_not_longer_than_inner'),
      `missing outer-budget warning: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!/(^|\n)-m(\n|$)/.test(argv), `legacy three-arg call unexpectedly gained model flags:\n${argv}`);
  });
});

test('wrapper consumes a caller-provided validated role and budget tuple', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      DHPK_CODEX_ROLE: 'codex-fast-worker',
      DHPK_CODEX_TIMEOUT_SECS: '7',
      DHPK_CODEX_TIMEOUT_SOURCE: 'caller:codex-fast-worker',
      DHPK_CODEX_TIMEOUT_DISABLED: 'false',
      DHPK_CODEX_TIMEOUT_RESOLVED: 'true',
    });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    assert.ok(res.stderr.includes('timeout=7') && res.stderr.includes('source=caller:codex-fast-worker'),
      `wrapper must preserve the propagated tuple: ${res.stderr}`);
  });
});

test('incomplete propagated timeout tuple fails closed before backend invocation', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      DHPK_CODEX_ROLE: 'codex-fast-worker',
      DHPK_CODEX_TIMEOUT_SECS: '',
      DHPK_CODEX_TIMEOUT_SOURCE: 'caller:codex-fast-worker',
      DHPK_CODEX_TIMEOUT_RESOLVED: 'true',
    });
    assert.notStrictEqual(res.status, 0, `incomplete propagated timeout must fail closed: ${res.stdout}`);
    assert.ok(res.stderr.includes('invalid propagated Codex timeout'),
      `missing propagated-timeout validation error: ${res.stderr}`);
    assert.ok(!fs.existsSync(ctx.argvOut), 'Codex backend must not be invoked for an incomplete propagated tuple');
  });
});

test('very large valid integer budgets do not overflow wrapper arithmetic', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_PASSTHROUGH, { mode: 0o755 });
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      CODEX_WRAP_TIMEOUT_SECS: '999999999999999999999999999999999999999',
    });
    assert.strictEqual(res.status, 0, `large integer should not trigger bash arithmetic failure: ${res.stderr}`);
    assert.strictEqual(res.stdout, 'stub-ok\n');
    assert.ok(!res.stderr.includes('integer expression expected'), `unexpected arithmetic diagnostic: ${res.stderr}`);
  });
});

test('invalid timeout configuration blocks Codex before the backend is invoked', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      CODEX_WRAP_TIMEOUT_SECS: 'not-an-integer',
    });
    assert.notStrictEqual(res.status, 0, `invalid timeout must fail closed: ${res.stdout}`);
    assert.ok(res.stderr.includes('invalid Codex timeout'), `missing invalid timeout error: ${res.stderr}`);
    assert.ok(!fs.existsSync(ctx.argvOut), 'Codex backend must not be invoked for invalid timeout');
  });
});

test('empty model/effort args are treated as absent (no flags)', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, '', '']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!/(^|\n)-m(\n|$)/.test(argv), `empty model arg must omit -m:\n${argv}`);
    assert.ok(!argv.includes('model_reasoning_effort'), `empty effort arg must omit flag:\n${argv}`);
  });
});

test('model only (no effort) adds -m but not effort', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'gpt-5.6-luna']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('gpt-5.6-luna'), `expected model in argv:\n${argv}`);
    assert.ok(!argv.includes('model_reasoning_effort'), `no effort supplied — flag must be absent:\n${argv}`);
  });
});

test('bad arg count exits 2', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir]);
    assert.strictEqual(res.status, 2, `expected usage exit 2, got ${res.status}`);
    const tooMany = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'm', 'e', 'extra']);
    assert.strictEqual(tooMany.status, 2, `expected usage exit 2 for 6 args, got ${tooMany.status}`);
  });
});

test('operational parser mode validates forwarded envelopes before callers classify them', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'codex'), PARSER_STUB, { mode: 0o755 });
    const validEnvelope = JSON.stringify({
      schema: 'dhpk.codex.timeout.v1',
      status: 'TIMEOUT',
      verified_wrapper_timeout: true,
      exit_code: 124,
      budget_secs: 2,
      elapsed_secs: 2,
      report_present: false,
      report_encoding: 'base64',
      report_b64: '',
      stderr_tail_encoding: 'base64',
      stderr_tail_b64: '',
      stdout_tail_encoding: 'base64',
      stdout_tail_b64: '',
      redaction: 'applied',
    });
    const valid = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {
      PARSE_HELPER: TIMEOUT_ENVELOPE_HELPER,
      PARSE_INPUT: validEnvelope,
    });
    assert.strictEqual(valid.status, 0, `valid envelope parse failed: ${valid.stderr}`);
    assert.strictEqual(JSON.parse(valid.stdout).schema, 'dhpk.codex.timeout.v1');
    const invalid = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {
      PARSE_HELPER: TIMEOUT_ENVELOPE_HELPER,
      PARSE_INPUT: '{"status":"TIMEOUT"}',
    });
    assert.strictEqual(invalid.status, 1, `invalid envelope must fail closed: ${invalid.stderr}`);
    assert.ok(invalid.stderr.includes('invalid envelope'), `missing parser validation error: ${invalid.stderr}`);
    const oversizedInput = path.join(ctx.dir, 'oversized-envelope.json');
    fs.writeFileSync(oversizedInput, JSON.stringify({ ...JSON.parse(validEnvelope), report_b64: 'A'.repeat(400000) }));
    const oversized = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {
      PARSE_HELPER: TIMEOUT_ENVELOPE_HELPER,
      PARSE_INPUT_FILE: oversizedInput,
    });
    assert.strictEqual(oversized.status, 1, `oversized envelope must fail closed: ${oversized.stderr}`);
    assert.ok(!oversized.stderr.includes('RangeError'), `oversized envelope must not expose parser stack traces: ${oversized.stderr}`);
  });
});

test('wrapper timeout fires: guarded exit 124 with backstop evidence message', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_FIRES, { mode: 0o755 });
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { CODEX_WRAP_TIMEOUT_SECS: '2' });
    assert.strictEqual(res.status, 124, `expected wrapper-timeout exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('timed out after') && res.stderr.includes('wrapper backstop'),
      `missing wrapper-timeout evidence message:\n${res.stderr}`);
  });
});

test('verified timeout emits a redacted, parseable report envelope and keeps exit 124', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_KILLS, { mode: 0o755 });
    fs.writeFileSync(path.join(ctx.binDir, 'codex'), SLOW_REPORT_STUB, { mode: 0o755 });
    const customTmp = path.join(ctx.dir, 'custom-tmp');
    fs.mkdirSync(customTmp);
    const secretReport = '## Done\napi_key=sk-test-123456\npassword: hunter2\n```md\n多行報告\n```\n';
    const res = runWrapper(
      ctx,
      ['workspace-write', ctx.dir, ctx.promptFile],
      {
        CODEX_WRAP_TIMEOUT_SECS: '2',
        TMPDIR: customTmp,
        STUB_REPORT: secretReport,
        STUB_INCLUDE_TEMP_PATH: '1',
        STUB_STDOUT: 'stdout token=stdout-secret-456',
        STUB_STDERR: 'stderr Bearer stderr-secret-789',
      },
    );
    assert.strictEqual(res.status, 124, `expected verified timeout exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stdout, `verified timeout envelope was empty (status=${res.status}, error=${res.error && res.error.code}, stderr=${res.stderr})`);
    const envelope = JSON.parse(res.stdout);
    assert.deepStrictEqual(Object.keys(envelope).sort(), [
      'budget_secs', 'elapsed_secs', 'exit_code', 'redaction', 'report_b64',
      'report_encoding', 'report_present', 'schema', 'status',
      'stderr_tail_b64', 'stderr_tail_encoding', 'stdout_tail_b64',
      'stdout_tail_encoding', 'verified_wrapper_timeout',
    ].sort());
    assert.strictEqual(envelope.schema, 'dhpk.codex.timeout.v1');
    assert.strictEqual(envelope.status, 'TIMEOUT');
    assert.strictEqual(envelope.verified_wrapper_timeout, true);
    assert.strictEqual(envelope.exit_code, 124);
    assert.strictEqual(envelope.budget_secs, 2);
    assert.strictEqual(envelope.report_present, true);
    assert.strictEqual(envelope.report_encoding, 'base64');
    assert.strictEqual(envelope.stderr_tail_encoding, 'base64');
    assert.strictEqual(envelope.stdout_tail_encoding, 'base64');
    assert.strictEqual(envelope.redaction, 'applied');
    const decodedReport = Buffer.from(envelope.report_b64, 'base64').toString('utf8');
    const decodedStderr = Buffer.from(envelope.stderr_tail_b64, 'base64').toString('utf8');
    const decodedStdout = Buffer.from(envelope.stdout_tail_b64, 'base64').toString('utf8');
    assert.ok(decodedReport.includes('多行報告'), `multiline report must survive framing: ${decodedReport}`);
    assert.ok(decodedReport.includes('[TEMP_PATH]'), `temporary paths must be redacted: ${decodedReport}`);
    assert.ok(!decodedReport.includes(customTmp), `custom temporary root leaked: ${decodedReport}`);
    for (const secret of ['sk-test-123456', 'hunter2', 'stdout-secret-456', 'stderr-secret-789']) {
      assert.ok(!res.stdout.includes(secret), `secret leaked in envelope stdout: ${secret}`);
      assert.ok(!res.stderr.includes(secret), `secret leaked in wrapper stderr: ${secret}`);
      assert.ok(!decodedReport.includes(secret), `secret leaked in decoded report: ${secret}`);
      assert.ok(!decodedStderr.includes(secret), `secret leaked in decoded stderr tail: ${secret}`);
      assert.ok(!decodedStdout.includes(secret), `secret leaked in decoded stdout tail: ${secret}`);
    }
    assert.ok(decodedReport.includes('[REDACTED]'), `report should carry a redaction marker: ${decodedReport}`);
    assert.ok(decodedStderr.includes('[REDACTED]'), `stderr tail should carry a redaction marker: ${decodedStderr}`);
    assert.ok(decodedStdout.includes('[REDACTED]'), `stdout tail should carry a redaction marker: ${decodedStdout}`);
    assert.ok(res.stderr.includes('wrapper backstop'), `missing timeout evidence: ${res.stderr}`);
  });
});

test('verified timeout without a final report emits an empty report field', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_FIRES, { mode: 0o755 });
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { CODEX_WRAP_TIMEOUT_SECS: '2' });
    assert.strictEqual(res.status, 124, `expected timeout exit 124, got ${res.status}: ${res.stderr}`);
    const envelope = JSON.parse(res.stdout);
    assert.strictEqual(envelope.schema, 'dhpk.codex.timeout.v1');
    assert.strictEqual(envelope.report_present, false);
    assert.strictEqual(envelope.report_b64, '');
    assert.strictEqual(envelope.verified_wrapper_timeout, true);
  });
});

test('verified timeout fails closed when the sanitizer helper is unavailable', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_KILLS, { mode: 0o755 });
    fs.writeFileSync(path.join(ctx.binDir, 'codex'), SLOW_REPORT_STUB, { mode: 0o755 });
    const toolsDir = buildToolsOnlyDir([...REQUIRED_TOOLS.filter((name) => name !== 'node'), 'sleep']);
    try {
      const res = runWrapper(
        ctx,
        ['workspace-write', ctx.dir, ctx.promptFile],
        {
          CODEX_WRAP_TIMEOUT_SECS: '2',
          STUB_REPORT: 'password=timeout-report-secret',
          STUB_STDOUT: 'token=timeout-stdout-secret',
          STUB_STDERR: 'password=timeout-stderr-secret',
        },
        { toolsDir },
      );
      assert.strictEqual(res.status, 124, `expected timeout exit 124, got ${res.status}: ${res.stderr}`);
      assert.ok(res.stdout, `timeout fallback envelope was empty (status=${res.status}, error=${res.error && res.error.code}, stderr=${res.stderr})`);
      const envelope = JSON.parse(res.stdout);
      assert.strictEqual(envelope.schema, 'dhpk.codex.timeout.v1');
      assert.strictEqual(envelope.report_present, false);
      assert.strictEqual(envelope.redaction, 'unavailable');
      assert.strictEqual(envelope.report_b64, '');
      assert.ok(res.stderr.includes('report salvage is BLOCKED'), `missing fail-closed notice: ${res.stderr}`);
      for (const secret of ['timeout-report-secret', 'timeout-stdout-secret', 'timeout-stderr-secret']) {
        assert.ok(!res.stdout.includes(secret), `secret leaked in helper-unavailable stdout: ${secret}`);
        assert.ok(!res.stderr.includes(secret), `secret leaked in helper-unavailable stderr: ${secret}`);
      }
    } finally {
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
  });
});

test('wrapper timeout duration is configurable via CODEX_WRAP_TIMEOUT_SECS', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_FIRES, { mode: 0o755 });
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { CODEX_WRAP_TIMEOUT_SECS: '2' });
    assert.strictEqual(res.status, 124, `expected wrapper-timeout exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('2s'), `expected the configured duration in the evidence message:\n${res.stderr}`);
  });
});

test('a quick backend-native 124 is not reclassified even when a timeout binary is present and used', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_PASSTHROUGH, { mode: 0o755 });
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {}, { stubExit: 124 });
    assert.strictEqual(res.status, 124, `expected passthrough exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(!res.stderr.includes('wrapper backstop'),
      `a quick native 124 under a real timeout wrapper must NOT carry the wrapper-timeout evidence message:\n${res.stderr}`);
    assert.ok(res.stderr.includes('codex exited with code 124'),
      `expected the generic passthrough failure message:\n${res.stderr}`);
  });
});

test('non-timeout failure diagnostics are redacted before reaching stderr', () => {
  withStub((ctx) => {
    const secret = '{"password":"failure-secret"}';
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { STUB_STDERR: secret }, { stubExit: 7 });
    assert.strictEqual(res.status, 7, `expected backend failure exit 7, got ${res.status}: ${res.stderr}`);
    assert.ok(!res.stderr.includes('failure-secret'), `raw failure secret leaked: ${res.stderr}`);
    assert.ok(res.stderr.includes('[REDACTED]'), `sanitized failure diagnostic missing marker: ${res.stderr}`);
  });
});

test('empty-success diagnostics are also redacted before reaching stderr', () => {
  withStub((ctx) => {
    const secret = 'Bearer empty-secret';
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { STUB_EMPTY: '1', STUB_STDERR: secret });
    assert.strictEqual(res.status, 1, `expected empty-output exit 1, got ${res.status}: ${res.stderr}`);
    assert.ok(!res.stderr.includes('empty-secret'), `raw empty-output secret leaked: ${res.stderr}`);
    assert.ok(res.stderr.includes('[REDACTED]'), `sanitized empty-output diagnostic missing marker: ${res.stderr}`);
  });
});

test('backend-native 124 without a timeout binary is not reclassified as a wrapper timeout', () => {
  withStub((ctx) => {
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS);
    try {
      const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {}, { toolsDir, stubExit: 124 });
      assert.strictEqual(res.status, 124, `expected passthrough exit 124, got ${res.status}: ${res.stderr}`);
      assert.ok(!res.stderr.includes('wrapper backstop'),
        `native 124 must NOT carry the wrapper-timeout evidence message:\n${res.stderr}`);
      assert.ok(res.stderr.includes('codex exited with code 124'),
        `expected the generic passthrough failure message:\n${res.stderr}`);
    } finally {
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
  });
});

test('timeout tool unavailable degrades audibly without failing the run', () => {
  withStub((ctx) => {
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS);
    try {
      const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {}, { toolsDir });
      assert.strictEqual(res.status, 0, `expected success without a timeout binary, got ${res.status}: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("neither 'timeout' nor 'gtimeout' found on PATH"),
        `missing timeout-unavailable notice:\n${res.stderr}`,
      );
    } finally {
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
  });
});

test('CODEX_WRAP_TIMEOUT_SECS=0 disables the backstop; a slow backend-native 124 is not reclassified', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_PASSTHROUGH, { mode: 0o755 });
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { CODEX_WRAP_TIMEOUT_SECS: '0' }, { stubExit: 124 });
    assert.strictEqual(res.status, 124, `expected passthrough exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('disables the wrapper-level timeout backstop'),
      `missing the budget-0 disables-backstop notice:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('wrapper backstop'),
      `a budget of 0 must never itself be reported as a wrapper timeout:\n${res.stderr}`);
    assert.ok(res.stderr.includes('codex exited with code 124'),
      `expected the generic passthrough failure message:\n${res.stderr}`);
  });
});

test('worker-style invocation adds --output-schema and keeps --output-last-message', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'gpt-5.6-luna', 'xhigh'], {
      DHPK_CODEX_ROLE: 'codex-fast-worker',
    });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    const lines = argv.split('\n').filter((line) => line !== '');
    const schemaIdx = lines.indexOf('--output-schema');
    assert.ok(schemaIdx >= 0, `missing --output-schema in worker-style argv:\n${argv}`);
    assert.strictEqual(
      lines[schemaIdx + 1],
      REPORT_SCHEMA,
      `--output-schema must point at ${REPORT_SCHEMA}, got ${lines[schemaIdx + 1]}\n${argv}`,
    );
    assert.ok(
      lines.includes('--output-last-message'),
      `worker-style must still include --output-last-message:\n${argv}`,
    );
  });
});

test('three-arg with DHPK_CODEX_ROLE=codex-fast-worker still adds --output-schema', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      DHPK_CODEX_ROLE: 'codex-fast-worker',
    });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    const lines = argv.split('\n').filter((line) => line !== '');
    const schemaIdx = lines.indexOf('--output-schema');
    assert.ok(schemaIdx >= 0, `missing --output-schema on 3-arg fast-worker path:\n${argv}`);
    assert.strictEqual(
      lines[schemaIdx + 1],
      REPORT_SCHEMA,
      `--output-schema must point at ${REPORT_SCHEMA}, got ${lines[schemaIdx + 1]}\n${argv}`,
    );
    assert.ok(
      lines.includes('--output-last-message'),
      `3-arg fast-worker must still include --output-last-message:\n${argv}`,
    );
  });
});

test('three-arg inherit-from-config omits model flags and default isolation flags', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], {
      DHPK_CODEX_EPHEMERAL: '',
      DHPK_CODEX_IGNORE_USER_CONFIG: '',
    });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!/(^|\n)-m(\n|$)/.test(argv), `unexpected -m flag in inherit-from-config shape:\n${argv}`);
    assert.ok(!argv.includes('model_reasoning_effort'),
      `unexpected model_reasoning_effort in inherit-from-config shape:\n${argv}`);
    assert.ok(!/(^|\n)--ephemeral(\n|$)/.test(argv),
      `default three-arg must not pass --ephemeral:\n${argv}`);
    assert.ok(!/(^|\n)--ignore-user-config(\n|$)/.test(argv),
      `default three-arg must not pass --ignore-user-config:\n${argv}`);
    assert.ok(!/(^|\n)--output-schema(\n|$)/.test(argv),
      `default three-arg (codex-bridge) must not pass --output-schema:\n${argv}`);
    assert.ok(/(^|\n)--output-last-message(\n|$)/.test(argv),
      `default three-arg must still include --output-last-message:\n${argv}`);
  });
});

test('DHPK_CODEX_ROLE=codex-deep-reasoner omits --output-schema and keeps --output-last-message', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'gpt-5.6-luna', 'xhigh'], {
      DHPK_CODEX_ROLE: 'codex-deep-reasoner',
    });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!/(^|\n)--output-schema(\n|$)/.test(argv),
      `codex-deep-reasoner must not pass --output-schema:\n${argv}`);
    assert.ok(/(^|\n)--output-last-message(\n|$)/.test(argv),
      `codex-deep-reasoner must still include --output-last-message:\n${argv}`);
  });
});

test('ultra effort is not adopted (omit or reject; never pass through)', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'gpt-5.6-luna', 'ultra']);
    if (!fs.existsSync(ctx.argvOut)) {
      assert.notStrictEqual(res.status, 0, 'rejecting ultra must fail closed before invoking Codex');
      return;
    }
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(
      !/model_reasoning_effort=["']?ultra["']?/.test(argv),
      `wrapper must not pass model_reasoning_effort=ultra:\n${argv}`,
    );
  });
});

test('optional --ephemeral and --ignore-user-config stay explicit via env', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], { DHPK_CODEX_EPHEMERAL: '1' });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(/(^|\n)--ephemeral(\n|$)/.test(argv),
      `expected --ephemeral when DHPK_CODEX_EPHEMERAL=1:\n${argv}`);
    assert.ok(!/(^|\n)--ignore-user-config(\n|$)/.test(argv),
      `--ignore-user-config must stay off unless explicitly requested:\n${argv}`);
  });
  withStub((ctx) => {
    const res = runWrapper(ctx, ['read-only', ctx.dir, ctx.promptFile], { DHPK_CODEX_IGNORE_USER_CONFIG: '1' });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(/(^|\n)--ignore-user-config(\n|$)/.test(argv),
      `expected --ignore-user-config when DHPK_CODEX_IGNORE_USER_CONFIG=1:\n${argv}`);
    assert.ok(!/(^|\n)--ephemeral(\n|$)/.test(argv),
      `--ephemeral must stay off unless explicitly requested:\n${argv}`);
  });
});

test('report-schema.json is OpenAI-strict for Codex --output-schema', () => {
  const schema = JSON.parse(fs.readFileSync(REPORT_SCHEMA, 'utf8'));
  const objectNodes = [];
  function collectObjectNodes(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.type === 'object') objectNodes.push({ node, path });
    if (node.properties && typeof node.properties === 'object') {
      for (const [key, child] of Object.entries(node.properties)) {
        collectObjectNodes(child, `${path}.properties.${key}`);
      }
    }
    if (node.items) collectObjectNodes(node.items, `${path}.items`);
  }
  collectObjectNodes(schema, '$');
  assert.ok(objectNodes.length > 0, 'schema must contain at least one object node');
  for (const { node, path } of objectNodes) {
    assert.strictEqual(
      node.additionalProperties,
      false,
      `${path}: additionalProperties must be false (OpenAI strict / Codex --output-schema)`,
    );
    const propertyKeys = Object.keys(node.properties || {});
    assert.ok(
      Array.isArray(node.required),
      `${path}: required must be an array listing every property key`,
    );
    assert.deepStrictEqual(
      [...node.required].sort(),
      [...propertyKeys].sort(),
      `${path}: required must list exactly Object.keys(properties) (got required=${JSON.stringify(node.required)} properties=${JSON.stringify(propertyKeys)})`,
    );
  }
});

run('run-codex');
