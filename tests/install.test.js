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
const TEMP_FIXTURES = [STUB_BIN];
process.on('exit', () => {
  for (const fixture of TEMP_FIXTURES) fs.rmSync(fixture, { recursive: true, force: true });
});

function makeNoJqBin(claudeLog) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-no-jq-bin-'));
  TEMP_FIXTURES.push(bin);
  // Keep only the commands the installer needs in PATH. In particular, do not
  // include /usr/bin, where jq is available on the development host.
  const tools = ['bash', 'git', 'dirname', 'sed', 'cat', 'head', 'tail', 'tr', 'seq', 'awk', 'grep', 'cut'];
  for (const name of tools) fs.symlinkSync(`/usr/bin/${name}`, path.join(bin, name));
  fs.symlinkSync('/usr/bin/python3', path.join(bin, 'python3'));
  const claudeBody = claudeLog
    ? `#!/bin/bash\nprintf 'called\\n' > "$DHPK_TEST_CLAUDE_LOG"\nexit 99\n`
    : '#!/bin/bash\nexit 0\n';
  fs.writeFileSync(path.join(bin, 'claude'), claudeBody, { mode: 0o755 });
  return bin;
}

function makeInstallerFixture(profiles) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-fixture-'));
  TEMP_FIXTURES.push(parent);
  // The apostrophe is intentionally part of the plugin root, not merely a
  // profile value: this reproduces the original Python-source interpolation.
  const pluginRoot = path.join(parent, "dhpk'installer");
  for (const relative of ['scripts/lib', 'manifests', 'docs']) {
    fs.mkdirSync(path.join(pluginRoot, relative), { recursive: true });
  }
  for (const relative of [
    'scripts/install.sh',
    'scripts/lib/install-prompts.sh',
    'manifests/module-catalog.json',
    'docs/docker-setup.md',
  ]) {
    fs.copyFileSync(path.join(ROOT, relative), path.join(pluginRoot, relative));
  }
  fs.writeFileSync(
    path.join(pluginRoot, 'manifests/install-profiles.json'),
    typeof profiles === 'string' ? profiles : JSON.stringify({ profiles }),
  );
  return pluginRoot;
}

function runScript(args, stdin, options = {}) {
  const script = options.script || SCRIPT;
  const noJqBin = options.noJq ? makeNoJqBin(options.claudeLog) : null;
  const env = {
    ...process.env,
    PATH: noJqBin
      ? noJqBin
      : `${STUB_BIN}${path.delimiter}${process.env.PATH}`,
    ...(options.env || {}),
  };
  if (options.claudeLog) env.DHPK_TEST_CLAUDE_LOG = options.claudeLog;
  return spawnSync('bash', [script, ...(args || [])], {
    cwd: options.cwd || ROOT,
    input: stdin || '',
    encoding: 'utf8',
    timeout: options.timeout || 20000,
    env,
  });
}

function assertNoInstallerSideEffects(pluginRoot, claudeLog) {
  for (const relative of ['.claude', '.codex', 'installed']) {
    assert.strictEqual(fs.existsSync(path.join(pluginRoot, relative)), false, relative);
  }
  if (claudeLog) assert.strictEqual(fs.existsSync(claudeLog), false, 'claude was invoked');
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
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk-profile-minimal'), res.stdout);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
});

test('--print is accepted as an alias for --dry-run', () => {
  const stdin = ['', '', '', '', '1', ''].join('\n');
  const res = runScript(['--print'], stdin);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
});

test('default custom flow materializes the minimal Claude profile before install', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-profile-'));
  TEMP_FIXTURES.push(outputRoot);
  const stdin = ['', '', '', '', '1', 'y'].join('\n');
  const res = runScript([], stdin, {
    env: { DHPK_CLAUDE_PROFILE_OUT: outputRoot },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(res.stdout.includes('claude plugin marketplace add'), res.stdout);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk-profile-minimal'), res.stdout);
  assert.ok(fs.existsSync(path.join(outputRoot, 'package', 'bundle-receipt.json')));
  assert.ok(fs.existsSync(path.join(outputRoot, '.claude-plugin', 'marketplace.json')));
});

test('default custom flow fails closed when Node.js cannot materialize minimal', () => {
  const claudeLog = path.join(os.tmpdir(), `dhpk-install-node-required-${process.pid}.log`);
  const res = runScript(['--dry-run'], ['', '', '', '', '1', ''].join('\n'), {
    noJq: true,
    claudeLog,
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk-profile-minimal'), res.stdout);
  assert.ok(!fs.existsSync(claudeLog), 'claude was invoked during dry-run');

  const installRes = runScript([], ['', '', '', '', '1', 'y'].join('\n'), {
    noJq: true,
    claudeLog,
  });
  assert.strictEqual(installRes.status, 1, `${installRes.stdout}\n${installRes.stderr}`);
  assert.match(installRes.stderr, /Node\.js.*required.*default minimal profile/);
  assert.ok(!fs.existsSync(claudeLog), 'claude was invoked after materialization was blocked');
});

test('truncated custom flow fails closed at hook-profile selection', () => {
  const res = runScript(['--dry-run'], '\n');
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /ERROR hook-selection/);
  assert.ok(!res.stdout.includes('Command to run:'), res.stdout);
});

test('truncated version selection fails closed before resolving modules', () => {
  const res = runScript(['--dry-run'], '\n14\n');
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /ERROR version-selection/);
  assert.ok(!res.stdout.includes('Command to run:'), res.stdout);
});

test('no-jq dry-run handles an apostrophe plugin path without side effects', () => {
  const pluginRoot = makeInstallerFixture({ safe: { modules: ['php-5.6'] } });
  const claudeLog = path.join(pluginRoot, 'claude-called.log');
  const res = runScript(
    ['--dry-run'],
    'y\n',
    {
      script: path.join(pluginRoot, 'scripts', 'install.sh'),
      noJq: true,
      claudeLog,
    },
  );
  assert.strictEqual(res.status, 0, res.stderr + '\n---stdout---\n' + res.stdout);
  assert.ok(res.stdout.includes(`Plugin root: ${pluginRoot}`), res.stdout);
  assert.ok(res.stdout.includes("Preset 'safe' selected"), res.stdout);
  assert.ok(res.stdout.includes('modules           : php-5.6'), res.stdout);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
  assertNoInstallerSideEffects(pluginRoot, claudeLog);
});

test('no-jq malformed profile fails closed before prompts or destinations', () => {
  const pluginRoot = makeInstallerFixture('{"profiles":');
  const res = runScript(
    ['--dry-run'],
    '',
    { script: path.join(pluginRoot, 'scripts', 'install.sh'), noJq: true, timeout: 3000 },
  );
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /ERROR profile-extraction/);
  assert.ok(!res.stderr.includes(pluginRoot), res.stderr);
  assert.ok(!res.stderr.includes('Use a curated preset'), res.stderr);
  assertNoInstallerSideEffects(pluginRoot);
});

test('no-jq invalid preset selection exits instead of looping', () => {
  const pluginRoot = makeInstallerFixture({ one: { modules: [] }, two: { modules: [] } });
  const res = runScript(
    ['--dry-run'],
    'y\n9\n',
    { script: path.join(pluginRoot, 'scripts', 'install.sh'), noJq: true, timeout: 3000 },
  );
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /ERROR preset-selection/);
  assertNoInstallerSideEffects(pluginRoot);
});

test('no-jq missing module fails closed before preset prompts', () => {
  const pluginRoot = makeInstallerFixture({ broken: { modules: ['not-shipped'] } });
  const res = runScript(
    ['--dry-run'],
    '',
    { script: path.join(pluginRoot, 'scripts', 'install.sh'), noJq: true, timeout: 3000 },
  );
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /ERROR module-extraction/);
  assert.ok(!res.stderr.includes('Use a curated preset'), res.stderr);
  assertNoInstallerSideEffects(pluginRoot);
});

run('install');
