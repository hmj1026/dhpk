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

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'codex-bridge', 'scripts', 'run-codex.sh');

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

function runWrapper({ binDir, argvOut, dir }, args) {
  return spawnSync('bash', [WRAPPER, ...args], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ARGV_OUT: argvOut },
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

run('run-codex');
