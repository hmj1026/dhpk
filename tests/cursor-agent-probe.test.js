'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { networkSandboxProbe } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release', 'cursor-agent-probe.js');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fixtureHome(args) {
  const packageIndex = args.indexOf('--agent-package');
  const packageRoot = packageIndex >= 0 ? path.resolve(args[packageIndex + 1]) : null;
  const home = path.join(packageRoot ? path.dirname(packageRoot) : os.tmpdir(), 'cursor-home');
  fs.mkdirSync(path.join(home, '.config', 'cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'cursor', 'auth.json'), '{"token":"fixture"}\n', { mode: 0o600 });
  return home;
}

function invoke(args, env = process.env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...env, HOME: fixtureHome(args) },
  });
}

const HAS_SHARED_SANDBOX = process.platform === 'linux' && Boolean(networkSandboxProbe(process.env.PATH, 'shared', true));

test('Cursor CLI wrapper emits bounded launch-scoped PASS evidence', () => {
  if (!HAS_SHARED_SANDBOX) return;
  const root = temp('dhpk-cursor-cli-probe-');
  const agent = path.join(root, 'agent');
  const cursor = path.join(root, 'cursor');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(agent);
  fs.mkdirSync(cursor);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cursor-agent'), '#!/bin/sh\nprintf \'%s\\n\' \'{"response":"dhpk skills commands agents rules were discovered. No additional skills are available."}\'\n', { mode: 0o755 });
  try {
    const result = invoke([
      '--agent-package', agent,
      '--cursor-package', cursor,
      '--timeout-ms', '1000',
      '--max-output-bytes', '1024',
    ], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.surface, 'cursor-cli');
    assert.strictEqual(report.action, 'launch-scoped-probe');
    assert.strictEqual(report.status, 'PASS');
    assert.strictEqual(report.timeout_ms, 1000);
    assert.strictEqual(report.output_limit_bytes, 1024);
    assert.match(report.diagnostic, /response.*<redacted>/i);
    assert.doesNotMatch(report.diagnostic, /dhpk skills commands agents rules/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor CLI wrapper maps a silent hang to SKIP_INCOMPATIBLE', () => {
  if (!HAS_SHARED_SANDBOX) return;
  const root = temp('dhpk-cursor-cli-probe-hang-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(root, 'agent'));
  fs.mkdirSync(path.join(root, 'cursor'));
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cursor-agent'), '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
  try {
    const result = invoke([
      '--agent-package', path.join(root, 'agent'),
      '--cursor-package', path.join(root, 'cursor'),
      '--timeout-ms', '200',
    ], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.status, 'SKIP_INCOMPATIBLE');
    assert.strictEqual(report.timed_out, true);
    assert.strictEqual(report.no_stdout, true);
    assert.match(report.reason, /no stdout\/stderr before timeout|no non-LLM plugin list/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor CLI wrapper rejects malformed bounds before invoking the client', () => {
  const root = temp('dhpk-cursor-cli-probe-invalid-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(root, 'agent'));
  fs.mkdirSync(path.join(root, 'cursor'));
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cursor-agent'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    const result = invoke([
      '--agent-package', path.join(root, 'agent'),
      '--cursor-package', path.join(root, 'cursor'),
      '--timeout-ms', '0',
    ], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.strictEqual(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.status, 'BLOCKED');
    assert.match(report.reason, /positive safe integer|timeout/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor CLI wrapper blocks a successful client with no JSON response', () => {
  if (!HAS_SHARED_SANDBOX) return;
  const root = temp('dhpk-cursor-cli-probe-empty-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(root, 'agent'));
  fs.mkdirSync(path.join(root, 'cursor'));
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cursor-agent'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    const result = invoke([
      '--agent-package', path.join(root, 'agent'),
      '--cursor-package', path.join(root, 'cursor'),
      '--timeout-ms', '1000',
    ], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.strictEqual(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(report.output_missing, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor CLI wrapper passes --trust so launch-scoped probes do not wait for workspace confirmation', () => {
  if (!HAS_SHARED_SANDBOX) return;
  const root = temp('dhpk-cursor-cli-probe-trust-');
  const agent = path.join(root, 'agent');
  const cursor = path.join(root, 'cursor');
  const bin = path.join(root, 'bin');
  const argvFile = path.join(agent, 'argv.txt');
  fs.mkdirSync(agent);
  fs.mkdirSync(cursor);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cursor-agent'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" > ${JSON.stringify(argvFile)}`,
    'printf \'%s\\n\' \'{"response":"dhpk skills commands agents rules were discovered."}\'',
    '',
  ].join('\n'), { mode: 0o755 });
  try {
    const result = invoke([
      '--agent-package', agent,
      '--cursor-package', cursor,
      '--timeout-ms', '1000',
      '--max-output-bytes', '1024',
    ], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const argv = fs.readFileSync(argvFile, 'utf8');
    assert.match(argv, /(^|\s)--trust(\s|$)/);
    assert.match(argv, /--plugin-dir/);
    assert.match(argv, /--mode ask/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor CLI wrapper blocks valid JSON without requested capability evidence', () => {
  if (!HAS_SHARED_SANDBOX) return;
  const root = temp('dhpk-cursor-cli-probe-negative-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(root, 'agent'));
  fs.mkdirSync(path.join(root, 'cursor'));
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cursor-agent'), '#!/bin/sh\nprintf \'%s\\n\' \'{"response":"dhpk skills, commands, agents, and rules could not be loaded."}\'\n', { mode: 0o755 });
  try {
    const result = invoke([
      '--agent-package', path.join(root, 'agent'),
      '--cursor-package', path.join(root, 'cursor'),
      '--timeout-ms', '1000',
    ], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.strictEqual(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(report.discovery_negative, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor CLI wrapper rejects symlinked package content before staging', () => {
  const root = fs.mkdtempSync(path.join('/var/tmp', 'dhpk-cursor-cli-symlink-'));
  const agent = path.join(root, 'agent');
  const cursor = path.join(root, 'cursor');
  fs.mkdirSync(agent);
  fs.mkdirSync(cursor);
  fs.symlinkSync('/etc/hostname', path.join(agent, 'host-secret-link'));
  try {
    const result = invoke([
      '--agent-package', agent,
      '--cursor-package', cursor,
      '--timeout-ms', '1000',
    ], { ...process.env, PATH: process.env.PATH || '' });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.status, 'BLOCKED');
    assert.match(report.reason, /symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('cursor-agent-probe');
