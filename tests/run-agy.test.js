'use strict';

// run-agy.sh — the agy-fast-worker CLI wrapper. Verifies the non-interactive
// invocation shape (--dangerously-skip-permissions, --mode accept-edits, --add-dir
// <workdir>, --model <model>, -p, --print-timeout; stdin fed `Y`; NO --cwd, NO
// --effort), the structured-output flag surface (--output-format json +
// --json-schema on/above the floor, degrading audibly below it), the floor-vs-
// baseline separation, arg validation, and the loud-failure contract. A
// PATH-stubbed `agy` captures argv + stdin so no real API call happens, and answers
// `agy --version` with a configurable fake version without disturbing the argv/
// stdin capture of the wrapper's real invocation.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { buildToolsOnlyDir } = require('./_lib/restricted-path');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh');

// The wrapper's own runtime dependencies (excluding `timeout`/`gtimeout`, which the
// restricted-PATH tests below deliberately omit or fake).
const REQUIRED_TOOLS = ['mktemp', 'tail', 'cat', 'rm', 'dirname', 'date', 'bash'];

// A fake `timeout` that ignores its wrapped command entirely, sleeps ~its duration
// argument, then exits 124 — simulating a genuine GNU timeout kill (elapsed time close
// to the configured budget). Tests using this stub always override the wrapper's
// AGY_WRAP_TIMEOUT_SECS to a small value so the sleep stays short.
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

// A fake `agy`. `agy --version` (exactly one arg) answers with $AGY_STUB_VERSION
// (default 1.1.8) and exits 0 without touching ARGV_OUT/STDIN_OUT — the wrapper's
// own version-detection probe must never corrupt the capture of its real, later
// invocation. Any other invocation records its argv to $ARGV_OUT and stdin to
// $STDIN_OUT, then prints a non-empty response (so the wrapper's empty-output guard
// passes), writes optional $STUB_STDERR to stderr (failure-classification fixtures),
// and exits with $STUB_EXIT (default 0).
const STUB = `#!/usr/bin/env bash
if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
  printf '%s\\n' "\${AGY_STUB_VERSION:-1.1.8}"
  exit 0
fi
printf '%s\\n' "$@" > "$ARGV_OUT"
cat > "$STDIN_OUT"
printf 'agy-stub-response\\n'
printf '%s' "\${STUB_STDERR:-}" >&2
exit "\${STUB_EXIT:-0}"
`;

function withStub(fn, { stubExit = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-agy-'));
  try {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'agy'), STUB, { mode: 0o755 });
    const promptFile = path.join(dir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'apply the fix spec');
    const argvOut = path.join(dir, 'argv.txt');
    const stdinOut = path.join(dir, 'stdin.txt');
    fn({ dir, binDir, promptFile, argvOut, stdinOut, stubExit });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// `opts.toolsDir`, when set, replaces the inherited process.env.PATH entirely with
// `<binDir>:<toolsDir>` — used by the restricted-PATH tests to prove behavior when
// `timeout`/`gtimeout` are genuinely absent (prepending to the inherited PATH would
// still leave the real binary reachable later in it).
function runWrapper({ binDir, argvOut, stdinOut, dir, stubExit }, args, extraEnv = {}, opts = {}) {
  const PATH = opts.toolsDir ? `${binDir}:${opts.toolsDir}` : `${binDir}:${process.env.PATH}`;
  return spawnSync('bash', [WRAPPER, ...args], {
    env: {
      ...process.env,
      PATH,
      ARGV_OUT: argvOut,
      STDIN_OUT: stdinOut,
      STUB_EXIT: String(stubExit),
      ...extraEnv,
    },
    cwd: dir,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function wrapperDiagnosticLines(stderr) {
  return String(stderr)
    .split(/\r?\n/)
    .filter((line) => line.includes('run-agy.sh:'));
}

test('non-interactive invocation carries the verified flag surface', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('--dangerously-skip-permissions'), `missing --dangerously-skip-permissions:\n${argv}`);
    assert.ok(argv.includes('--add-dir'), `missing --add-dir:\n${argv}`);
    assert.ok(argv.includes('--model'), `missing --model:\n${argv}`);
    assert.ok(argv.includes('Gemini 3.6 Flash (High)'), `missing model display string:\n${argv}`);
    assert.ok(/(^|\n)-p(\n|$)/.test(argv), `missing -p flag:\n${argv}`);
    assert.ok(argv.includes('--print-timeout'), `missing --print-timeout bound:\n${argv}`);
    // Ground-truth binary has NO --cwd flag — the wrapper must never emit it.
    assert.ok(!argv.includes('--cwd'), `wrapper must not use --cwd (absent from installed binary):\n${argv}`);
  });
});

test('plan-confirmation Y is piped on stdin', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const stdin = fs.readFileSync(ctx.stdinOut, 'utf8');
    assert.strictEqual(stdin, 'Y\n', `expected 'Y\\n' on stdin, got: ${JSON.stringify(stdin)}`);
  });
});

test('prompt file content becomes the -p argument', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('apply the fix spec'), `prompt content not passed to agy:\n${argv}`);
  });
});

test('agy non-zero exit is passed through loudly', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 3, `expected passthrough exit 3, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('agy exited with code 3'), `missing loud failure message:\n${res.stderr}`);
  }, { stubExit: 3 });
});

test('allow-rule stderr hint is named in the wrapper diagnostic', () => {
  withStub((ctx) => {
    const hint = 'soft-deny: add an allow rule in settings.json for this tool\n';
    const res = runWrapper(
      ctx,
      [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'],
      { AGY_STUB_VERSION: '1.1.13', STUB_STDERR: hint },
    );
    assert.strictEqual(res.status, 4, `expected passthrough exit 4, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('allow rule'), `wrapper must still tail the allow-rule stderr:\n${res.stderr}`);
    const diag = wrapperDiagnosticLines(res.stderr);
    assert.ok(
      diag.some((line) => /allow[- ]rule/i.test(line) && /settings\.json/i.test(line)),
      `missing wrapper diagnostic naming the allow-rule / settings.json permissions hint (not only 'agy exited with code N'):\n${res.stderr}`,
    );
  }, { stubExit: 4 });
});

test('print-mode slash-command error is surfaced and not retried as permissions', () => {
  withStub((ctx) => {
    const hint = 'interactive slash commands are not supported in print mode\n';
    const res = runWrapper(
      ctx,
      [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'],
      { AGY_STUB_VERSION: '1.1.13', STUB_STDERR: hint },
    );
    assert.strictEqual(res.status, 1, `expected passthrough exit 1, got ${res.status}: ${res.stderr}`);
    assert.ok(
      res.stderr.includes('interactive slash commands are not supported in print mode'),
      `wrapper must still tail the print-mode slash-command stderr:\n${res.stderr}`,
    );
    const diag = wrapperDiagnosticLines(res.stderr);
    assert.ok(
      diag.some((line) => /slash[- ]command/i.test(line) && /print[- ]mode/i.test(line)),
      `missing wrapper diagnostic that this is a print-mode slash-command error:\n${res.stderr}`,
    );
    assert.ok(
      !/retry(?:ing)? with --dangerously-skip-permissions/i.test(res.stderr),
      `must not suggest retrying with --dangerously-skip-permissions:\n${res.stderr}`,
    );
    assert.ok(
      !diag.some((line) => {
        if (!/permission/i.test(line)) return false;
        if (/\bnot\b|\bnever\b|must not|do not|don't/i.test(line)) return false;
        return true;
      }),
      `print-mode slash-command error must not be described as a permissions failure:\n${res.stderr}`,
    );
  }, { stubExit: 1 });
});

test('missing arguments exit 2 with usage', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile]);
    assert.strictEqual(res.status, 2, `expected usage exit 2, got ${res.status}`);
    assert.ok(res.stderr.includes('expected 3 arguments'), `missing usage message:\n${res.stderr}`);
  });
});

test('nonexistent workdir exits 2', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, ['/definitely/not/a/dir', ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 2, `expected exit 2 for bad workdir, got ${res.status}`);
  });
});

test('empty model argument exits 2', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, '']);
    assert.strictEqual(res.status, 2, `expected exit 2 for empty model, got ${res.status}`);
  });
});

test('structured-output flags are assembled; --effort and --cwd are not', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('--mode'), `missing --mode:\n${argv}`);
    assert.ok(argv.includes('accept-edits'), `missing accept-edits mode value:\n${argv}`);
    assert.ok(argv.includes('--output-format'), `missing --output-format:\n${argv}`);
    assert.ok(/(^|\n)json(\n|$)/.test(argv), `missing json output-format value:\n${argv}`);
    assert.ok(argv.includes('--json-schema'), `missing --json-schema:\n${argv}`);
    assert.ok(argv.includes('report-schema.json'), `--json-schema should point at the shipped schema file:\n${argv}`);
    assert.ok(!argv.includes('--effort'), `wrapper must not pass --effort (model string encodes it):\n${argv}`);
    assert.ok(!argv.includes('--cwd'), `wrapper must not use --cwd (absent from installed binary):\n${argv}`);
  });
});

test('agy below the structured-output floor degrades audibly, no silent flag drop', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { AGY_STUB_VERSION: '1.1.2' });
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(!argv.includes('--output-format'), `structured flags must not appear below the floor:\n${argv}`);
    assert.ok(!argv.includes('--json-schema'), `structured flags must not appear below the floor:\n${argv}`);
    assert.ok(
      res.stderr.includes('predates the structured-output floor') && res.stderr.includes('NOT enabled'),
      `missing explicit degrade notice:\n${res.stderr}`,
    );
  });
});

test('feature floor and verified baseline are separate constants: a stale baseline does not lower the floor', () => {
  withStub((ctx) => {
    // Installed (stubbed) version is 1.1.8 — at the default floor — but the recorded
    // baseline is overridden to 1.1.9, simulating a baseline refresh that has not yet
    // happened for this installed version. If floor and baseline were the same
    // variable, refreshing one would silently move the other and this would fail.
    const res = runWrapper(
      ctx,
      [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'],
      { AGY_STUB_VERSION: '1.1.8', AGY_VERIFIED_BASELINE: '1.1.9' },
    );
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('--json-schema'), `--json-schema must still be passed at the floor even with a newer recorded baseline:\n${argv}`);
    assert.ok(
      res.stderr.includes('version drift') && res.stderr.includes('installed=1.1.8') && res.stderr.includes('verified-baseline=1.1.9'),
      `missing version-drift notice naming both versions:\n${res.stderr}`,
    );
  });
});

test('wrapper timeout fires: guarded exit 124 with backstop evidence message', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_FIRES, { mode: 0o755 });
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { AGY_WRAP_TIMEOUT_SECS: '2' });
    assert.strictEqual(res.status, 124, `expected wrapper-timeout exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('timed out after') && res.stderr.includes('wrapper backstop'),
      `missing wrapper-timeout evidence message:\n${res.stderr}`);
  });
});

test('wrapper timeout duration is configurable via AGY_WRAP_TIMEOUT_SECS', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_FIRES, { mode: 0o755 });
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { AGY_WRAP_TIMEOUT_SECS: '2' });
    assert.strictEqual(res.status, 124, `expected wrapper-timeout exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('2s'), `expected the configured duration in the evidence message:\n${res.stderr}`);
  });
});

test('a quick backend-native 124 is not reclassified even when a timeout binary is present and used', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_PASSTHROUGH, { mode: 0o755 });
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(res.status, 124, `expected passthrough exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(!res.stderr.includes('wrapper backstop'),
      `a quick native 124 under a real timeout wrapper must NOT carry the wrapper-timeout evidence message:\n${res.stderr}`);
    assert.ok(res.stderr.includes('agy exited with code 124'),
      `expected the generic passthrough failure message:\n${res.stderr}`);
  }, { stubExit: 124 });
});

test('backend-native 124 without a timeout binary is not reclassified as a wrapper timeout', () => {
  withStub((ctx) => {
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS);
    try {
      const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], {}, { toolsDir });
      assert.strictEqual(res.status, 124, `expected passthrough exit 124, got ${res.status}: ${res.stderr}`);
      assert.ok(!res.stderr.includes('wrapper backstop'),
        `native 124 must NOT carry the wrapper-timeout evidence message:\n${res.stderr}`);
      assert.ok(res.stderr.includes('agy exited with code 124'),
        `expected the generic passthrough failure message:\n${res.stderr}`);
    } finally {
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
  }, { stubExit: 124 });
});

test('AGY_WRAP_TIMEOUT_SECS=0 disables the backstop; a slow backend-native 124 is not reclassified', () => {
  withStub((ctx) => {
    fs.writeFileSync(path.join(ctx.binDir, 'timeout'), TIMEOUT_STUB_PASSTHROUGH, { mode: 0o755 });
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { AGY_WRAP_TIMEOUT_SECS: '0' });
    assert.strictEqual(res.status, 124, `expected passthrough exit 124, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('disables the wrapper-level timeout backstop'),
      `missing the budget-0 disables-backstop notice:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('wrapper backstop'),
      `a budget of 0 must never itself be reported as a wrapper timeout:\n${res.stderr}`);
    assert.ok(res.stderr.includes('agy exited with code 124'),
      `expected the generic passthrough failure message:\n${res.stderr}`);
  }, { stubExit: 124 });
});

test('timeout tool unavailable degrades audibly without failing the run', () => {
  withStub((ctx) => {
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS);
    try {
      const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], {}, { toolsDir });
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

run('run-agy');
