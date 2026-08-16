'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release', 'cursor-agent-probe.js');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function invoke(args, env = process.env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
}

test('Cursor CLI wrapper emits bounded launch-scoped PASS evidence', () => {
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
    assert.match(report.diagnostic, /dhpk skills commands agents rules/);
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
  const root = temp('dhpk-cursor-cli-probe-trust-');
  const agent = path.join(root, 'agent');
  const cursor = path.join(root, 'cursor');
  const bin = path.join(root, 'bin');
  const argvFile = path.join(root, 'argv.txt');
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

run('cursor-agent-probe');
