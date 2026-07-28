'use strict';

// run-codex.sh — the codex-bridge / codex-fast-worker CLI wrapper. Verifies the
// optional model/effort args (4th/5th) produce `-m <model>` / `-c
// model_reasoning_effort="<effort>"`, and that the original 3-arg shape stays
// byte-identical (no model/effort flags — inherit-from-config for codex-bridge).
// A PATH-stubbed `codex` captures argv and honors --output-last-message so no
// real API call happens.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { buildToolsOnlyDir } = require('./_lib/restricted-path');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'codex-bridge', 'scripts', 'run-codex.sh');

// The wrapper's own runtime dependencies (excluding `timeout`/`gtimeout`, which the
// restricted-PATH tests below deliberately omit or fake).
const REQUIRED_TOOLS = ['mktemp', 'grep', 'tail', 'cat', 'rm', 'date', 'bash'];

// A fake `timeout` that ignores its wrapped command entirely, sleeps ~its duration
// argument, then exits 124 — simulating a genuine GNU timeout kill (elapsed time close
// to the configured budget). Tests using this stub always override the wrapper's
// CODEX_WRAP_TIMEOUT_SECS to a small value so the sleep stays short.
const TIMEOUT_STUB_FIRES = `#!/usr/bin/env bash
dur="$1"
sleep "$dur"
exit 124
`;

// A fake `timeout` that genuinely passes through to the wrapped command (shifts off the
// duration argument and execs the rest) — proves a quick backend-native 124 is not
// misclassified as a wrapper timeout merely because a timeout binary was used.
const TIMEOUT_STUB_PASSTHROUGH = `#!/usr/bin/env bash
shift
exec "$@"
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
[ -n "$out" ] && printf 'stub-ok\\n' > "$out"
exit "\${STUB_EXIT:-0}"
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
  return spawnSync('bash', [WRAPPER, ...args], {
    env: { ...process.env, PATH, ARGV_OUT: argvOut, STUB_EXIT: String(opts.stubExit ?? 0), ...extraEnv },
    cwd: dir,
    encoding: 'utf8',
    timeout: 10000,
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
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!/(^|\n)-m(\n|$)/.test(argv), `unexpected -m flag in legacy shape:\n${argv}`);
    assert.ok(!argv.includes('model_reasoning_effort'),
      `unexpected model_reasoning_effort in legacy shape:\n${argv}`);
    // Core flags still present.
    assert.ok(argv.includes('--sandbox') && argv.includes('read-only'), `missing sandbox flag:\n${argv}`);
    assert.ok(argv.includes('approval_policy=never'), `missing approval policy:\n${argv}`);
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

test('wrapper timeout fires: guarded exit 124 with backstop evidence message', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_FIRES, { mode: 0o755 });
    const res = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { CODEX_WRAP_TIMEOUT_SECS: '2' });
    assert.strictEqual(res.status, 124, `expected wrapper-timeout exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('timed out after') && res.stderr.includes('wrapper backstop'),
      `missing wrapper-timeout evidence message:\n${res.stderr}`);
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

run('run-codex');
