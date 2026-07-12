'use strict';

// Smoke coverage for scripts/install.sh — interactive installer.
// SMOKE (not full behavioral): the script always ends by either invoking the
// real `claude plugin install ...` command or aborting. The only host-safe
// invocation is `--dry-run`/`--print`, which prints the resolved command and
// exits 0 BEFORE ever reaching the exec line — so every non-trivial test
// below drives the interactive prompts with scripted stdin (all plain
// `read -r` prompts, no gum/TTY capture required) and asserts `--dry-run`
// stops short of executing anything. `--help` and an unknown flag are pure
// no-ops (no prompts, no filesystem writes) and are exercised too.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'install.sh');

// The prerequisite gate requires `claude` on PATH, which CI runners lack.
// A stub is safe because --dry-run/--print always exits before the real
// `claude plugin install` exec line — the stub exists only to pass the
// `command -v claude` check, never to be executed.
const STUB_BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-stub-'));
fs.writeFileSync(path.join(STUB_BIN, 'claude'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
process.on('exit', () => fs.rmSync(STUB_BIN, { recursive: true, force: true }));

function runScript(args, stdin) {
  return spawnSync('bash', [SCRIPT, ...(args || [])], {
    cwd: ROOT,
    input: stdin || '',
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, PATH: `${STUB_BIN}${path.delimiter}${process.env.PATH}` },
  });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('-h/--help prints the header comment and exits 0 without any prompts', () => {
  const res = runScript(['--help']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('install.sh'), res.stdout);
  assert.ok(res.stdout.includes('--dry-run'), res.stdout);
});

test('unknown flag exits 64 with a usage hint, no prompts reached', () => {
  const res = runScript(['--bogus']);
  assert.strictEqual(res.status, 64);
  assert.ok(res.stderr.includes('Unknown flag'), res.stderr);
});

test('--dry-run walks the full custom flow (scripted stdin) and stops before executing install', () => {
  // Scripted answers, one per line, matching the plain (no-gum) prompt flow:
  //   1. "Use a curated preset?"           -> blank (default n)      -> custom flow
  //   2. Stack multi-select                -> blank (none selected)
  //   3. "Enable docker container check?"  -> blank (default n)
  //   4. "Override default review agents?" -> blank (default n)
  //   5. Hook profile single-select        -> "1" (first listed profile)
  const stdin = ['', '', '', '', '1', ''].join('\n');
  const res = runScript(['--dry-run'], stdin);
  assert.strictEqual(res.status, 0, res.stderr + '\n---stdout---\n' + res.stdout);
  assert.ok(res.stdout.includes('Resolved configuration'), res.stdout);
  assert.ok(res.stdout.includes('Command to run:'), res.stdout);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk'), res.stdout);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
});

test('--print is accepted as an alias for --dry-run', () => {
  const stdin = ['', '', '', '', '1', ''].join('\n');
  const res = runScript(['--print'], stdin);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
});

run('install');
