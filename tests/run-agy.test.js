'use strict';

// run-agy.sh — the agy-fast-worker CLI wrapper. Verifies the non-interactive
// invocation shape (--dangerously-skip-permissions, --add-dir <workdir>, --model
// <model>, -p, --print-timeout; stdin fed `Y`; NO --cwd), arg validation, and the
// loud-failure contract. A PATH-stubbed `agy` captures argv + stdin so no real
// API call happens.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'agy-fast-worker', 'scripts', 'run-agy.sh');

// A fake `agy` that records its argv to $ARGV_OUT and stdin to $STDIN_OUT, then
// prints a non-empty response (so the wrapper's empty-output guard passes) and
// exits with $STUB_EXIT (default 0).
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$ARGV_OUT"
cat > "$STDIN_OUT"
printf 'agy-stub-response\\n'
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

function runWrapper({ binDir, argvOut, stdinOut, dir, stubExit }, args) {
  return spawnSync('bash', [WRAPPER, ...args], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      ARGV_OUT: argvOut,
      STDIN_OUT: stdinOut,
      STUB_EXIT: String(stubExit),
    },
    cwd: dir,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('non-interactive invocation carries the verified flag surface', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.5 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('--dangerously-skip-permissions'), `missing --dangerously-skip-permissions:\n${argv}`);
    assert.ok(argv.includes('--add-dir'), `missing --add-dir:\n${argv}`);
    assert.ok(argv.includes('--model'), `missing --model:\n${argv}`);
    assert.ok(argv.includes('Gemini 3.5 Flash (High)'), `missing model display string:\n${argv}`);
    assert.ok(/(^|\n)-p(\n|$)/.test(argv), `missing -p flag:\n${argv}`);
    assert.ok(argv.includes('--print-timeout'), `missing --print-timeout bound:\n${argv}`);
    // Ground-truth binary has NO --cwd flag — the wrapper must never emit it.
    assert.ok(!argv.includes('--cwd'), `wrapper must not use --cwd (absent from installed binary):\n${argv}`);
  });
});

test('plan-confirmation Y is piped on stdin', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.5 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const stdin = fs.readFileSync(ctx.stdinOut, 'utf8');
    assert.strictEqual(stdin, 'Y\n', `expected 'Y\\n' on stdin, got: ${JSON.stringify(stdin)}`);
  });
});

test('prompt file content becomes the -p argument', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.5 Flash (High)']);
    assert.strictEqual(res.status, 0, `wrapper failed: ${res.stderr}`);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('apply the fix spec'), `prompt content not passed to agy:\n${argv}`);
  });
});

test('agy non-zero exit is passed through loudly', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.5 Flash (High)']);
    assert.strictEqual(res.status, 3, `expected passthrough exit 3, got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('agy exited with code 3'), `missing loud failure message:\n${res.stderr}`);
  }, { stubExit: 3 });
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
    const res = runWrapper(ctx, ['/definitely/not/a/dir', ctx.promptFile, 'Gemini 3.5 Flash (High)']);
    assert.strictEqual(res.status, 2, `expected exit 2 for bad workdir, got ${res.status}`);
  });
});

test('empty model argument exits 2', () => {
  withStub((ctx) => {
    const res = runWrapper(ctx, [ctx.dir, ctx.promptFile, '']);
    assert.strictEqual(res.status, 2, `expected exit 2 for empty model, got ${res.status}`);
  });
});

run('run-agy');
