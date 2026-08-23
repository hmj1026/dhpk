'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { AGENT_PLUGIN_SCHEMA } = require('../scripts/lib/agent-plugin-package');
const { redactSensitiveText } = require('../scripts/lib/redaction');
const { runCursorConsumerProbe } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/release/consumer-platform-probe.js');

function runProbe(platform, packageRoot, extra = [], env = process.env) {
  return spawnSync(process.execPath, [SCRIPT, '--platform', platform, '--package-root', packageRoot, ...extra], { encoding: 'utf8', env });
}

function writeAgentManifest(root) {
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_SCHEMA,
    name: 'dhpk',
    version: '1.0.0',
    description: 'test package',
  }));
}

function writeCursorPackage(root) {
  fs.mkdirSync(path.join(root, '.cursor-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({
    name: 'dhpk-cursor',
    version: '1.0.0',
    description: 'test package',
    variables: { type: 'object', properties: {} },
  }));
  fs.writeFileSync(path.join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({
    name: 'test', owner: { name: 'test' }, plugins: [{ name: 'dhpk-cursor', source: '.' }],
  }));
  for (const component of ['skills', 'commands', 'agents', 'rules']) fs.mkdirSync(path.join(root, component), { recursive: true });
}

test('missing package is BLOCKED without probing a client', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-missing-'));
  try {
    const result = runProbe('codex', root);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(JSON.parse(result.stdout).status, 'BLOCKED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('present package reports UNAVAILABLE or NOT_RUN, never static PASS, when consumer evidence is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-present-'));
  try {
    writeAgentManifest(root);
    const result = runProbe('codex', root);
    const payload = JSON.parse(result.stdout);
    assert.ok(['UNAVAILABLE', 'NOT_RUN', 'BLOCKED'].includes(payload.status));
    assert.notStrictEqual(payload.status, 'PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor probe is explicit UNAVAILABLE in a non-Cursor environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-'));
  try {
    writeCursorPackage(root);
    const result = runProbe('cursor', root);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'UNAVAILABLE');
    assert.strictEqual(payload.surfaceResults.length, 1);
    assert.strictEqual(payload.surfaceResults[0].surface, 'cursor-plugin');
    assert.strictEqual(payload.surfaceResults[0].status, 'UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor --execute uses an isolated profile and package-specific challenge evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-execute-'));
  const agent = path.join(root, 'dhpk-agent');
  const cursor = path.join(root, 'dhpk-cursor');
  const bin = path.join(root, 'bin');
  try {
    fs.mkdirSync(agent, { recursive: true });
    fs.mkdirSync(cursor, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    writeAgentManifest(agent);
    writeCursorPackage(cursor);
    fs.writeFileSync(path.join(bin, 'cursor-agent'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cp = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "for (let i = 0; i < args.length; i += 1) if (args[i] === '--plugin-dir' && args[i + 1]) { const root = args[++i]; try { const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')); for (const hook of hooks.hooks.sessionStart || []) cp.execFileSync(path.resolve(root, hook.command), [], { cwd: root }); } catch (_) {} }",
      "const roots = args.filter((arg, index) => args[index - 1] === '--plugin-dir');",
      "const root = roots.find((candidate) => fs.existsSync(path.join(candidate, 'hooks', '.dhpk-probe-attestation.json')));",
      "const attestation = JSON.parse(fs.readFileSync(path.join(root, 'hooks', '.dhpk-probe-attestation.json'), 'utf8'));",
      "process.stdout.write(JSON.stringify({ response: 'dhpk skills commands agents rules were discovered.', dhpkProbe: { challenge: attestation.challenge, packageFingerprint: attestation.packageFingerprint, loaded: true, components: attestation.components } }));",
      '',
    ].join('\n'), { mode: 0o755 });
    const result = runProbe('cursor', cursor, ['--execute', '--version', '1.0.0'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION: '1',
    });
    assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    if (payload.status === 'PASS') {
      assert.strictEqual(payload.network, 'disabled', JSON.stringify(payload));
      assert.strictEqual(payload.surfaceResults[0].status, 'PASS', JSON.stringify(payload));
    } else {
      assert.strictEqual(payload.status, 'BLOCKED', JSON.stringify(payload));
      assert.strictEqual(payload.network, 'unknown', JSON.stringify(payload));
      assert.strictEqual(payload.surfaceResults[0].status, 'BLOCKED', JSON.stringify(payload));
    }
    assert.ok(payload.commands.some((command) => /cursor-agent/.test(command.cmd)), JSON.stringify(payload));
    assert.match(payload.surfaceResults[0].reasons.join(' '), /challenge|package|network/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor --execute falls back to a bwrap network sandbox when unshare is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-bwrap-'));
  const agent = path.join(root, 'dhpk-agent');
  const cursor = path.join(root, 'dhpk-cursor');
  const bin = path.join(root, 'bin');
  try {
    fs.mkdirSync(agent, { recursive: true });
    fs.mkdirSync(cursor, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    writeAgentManifest(agent);
    writeCursorPackage(cursor);
    fs.writeFileSync(path.join(bin, 'unshare'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'bwrap'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cp = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "fs.writeFileSync(path.join(__dirname, 'bwrap-args.json'), JSON.stringify(args));",
      "const separator = args.indexOf('--');",
      "if (separator < 0 || !args[separator + 1]) process.exit(97);",
      "const result = cp.spawnSync(args[separator + 1], args.slice(separator + 2), { encoding: 'utf8', env: process.env });",
      "if (result.stdout) process.stdout.write(result.stdout);",
      "if (result.stderr) process.stderr.write(result.stderr);",
      "process.exit(result.status === null ? 98 : result.status);",
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'cursor-agent'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cp = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "for (let i = 0; i < args.length; i += 1) if (args[i] === '--plugin-dir' && args[i + 1]) { const root = args[++i]; try { const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')); for (const hook of hooks.hooks.sessionStart || []) cp.execFileSync(path.resolve(root, hook.command), [], { cwd: root }); } catch (_) {} }",
      "const roots = args.filter((arg, index) => args[index - 1] === '--plugin-dir');",
      "const root = roots.find((candidate) => fs.existsSync(path.join(candidate, 'hooks', '.dhpk-probe-attestation.json')));",
      "const attestation = JSON.parse(fs.readFileSync(path.join(root, 'hooks', '.dhpk-probe-attestation.json'), 'utf8'));",
      "process.stdout.write(JSON.stringify({ response: 'dhpk skills commands agents rules were discovered.', dhpkProbe: { challenge: attestation.challenge, packageFingerprint: attestation.packageFingerprint, loaded: true, components: attestation.components } }));",
      '',
    ].join('\n'), { mode: 0o755 });

    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` };
    delete env.DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION;
    const result = runProbe('cursor', cursor, ['--execute', '--version', '1.0.0'], env);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'PASS', JSON.stringify(payload));
    assert.strictEqual(payload.network, 'disabled', JSON.stringify(payload));
    const bwrapArgs = JSON.parse(fs.readFileSync(path.join(bin, 'bwrap-args.json'), 'utf8'));
    assert.deepStrictEqual(
      bwrapArgs.slice(0, 9),
      ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--die-with-parent'],
      JSON.stringify(bwrapArgs),
    );
    const separator = bwrapArgs.indexOf('--');
    assert.ok(separator > 9, JSON.stringify(bwrapArgs));
    const writablePaths = [];
    for (let index = 9; index < separator; index += 1) {
      assert.strictEqual(bwrapArgs[index], '--bind', JSON.stringify(bwrapArgs));
      assert.strictEqual(bwrapArgs[index + 1], bwrapArgs[index + 2], JSON.stringify(bwrapArgs));
      writablePaths.push(bwrapArgs[index + 1]);
      index += 2;
    }
    assert.ok(writablePaths.length >= 3, JSON.stringify(bwrapArgs));
    assert.ok(writablePaths.every((value) => value.startsWith(`${os.tmpdir()}${path.sep}`)), JSON.stringify(writablePaths));
    assert.match(bwrapArgs[separator + 1], /cursor-agent$/, JSON.stringify(bwrapArgs));

    fs.writeFileSync(path.join(bin, 'unshare'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cp = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "fs.writeFileSync(path.join(__dirname, 'unshare-args.json'), JSON.stringify(args));",
      "const index = args.indexOf('--');",
      "const child = cp.spawnSync(args[index + 1], args.slice(index + 2), { encoding: 'utf8', env: process.env });",
      "if (child.stdout) process.stdout.write(child.stdout);",
      "if (child.stderr) process.stderr.write(child.stderr);",
      "process.exit(child.status === null ? 98 : child.status);",
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'bwrap'), [
      '#!/bin/sh',
      `printf '%s' called > '${path.join(bin, 'bwrap-second-called')}'`,
      'exit 99',
      '',
    ].join('\n'), { mode: 0o755 });
    const unshareResult = runProbe('cursor', cursor, ['--execute', '--version', '1.0.0'], env);
    assert.strictEqual(unshareResult.status, 0, unshareResult.stdout + unshareResult.stderr);
    assert.strictEqual(JSON.parse(unshareResult.stdout).status, 'PASS', unshareResult.stdout);
    assert.ok(fs.existsSync(path.join(bin, 'unshare-args.json')));
    assert.strictEqual(fs.existsSync(path.join(bin, 'bwrap-second-called')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor bwrap probes retain timeout bounds and die-with-parent protection', () => {
  if (process.platform !== 'linux') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-bwrap-timeout-'));
  const packageRoot = path.join(root, 'package');
  const bin = path.join(root, 'bin');
  const previousPath = process.env.PATH;
  try {
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'unshare'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'bwrap'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cp = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "const log = path.join(__dirname, 'bwrap-timeout-args.json');",
      "const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];",
      'calls.push(args);',
      "fs.writeFileSync(log, JSON.stringify(calls));",
      "const separator = args.indexOf('--');",
      'if (separator < 0 || !args[separator + 1]) process.exit(97);',
      "const child = cp.spawnSync(args[separator + 1], args.slice(separator + 2), { encoding: 'utf8', env: process.env });",
      "if (child.stdout) process.stdout.write(child.stdout);",
      "if (child.stderr) process.stderr.write(child.stderr);",
      'process.exit(child.status === null ? 98 : child.status);',
      '',
    ].join('\n'), { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
    const probe = runCursorConsumerProbe({
      packageRoot,
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      timeoutMs: 50,
      requirePackageChallenge: true,
      networkMode: 'disabled',
    });
    assert.strictEqual(probe.status, 'SKIP_INCOMPATIBLE', JSON.stringify(probe));
    assert.strictEqual(probe.timed_out, true, JSON.stringify(probe));
    const calls = JSON.parse(fs.readFileSync(path.join(bin, 'bwrap-timeout-args.json'), 'utf8'));
    assert.ok(calls.some((args) => args.includes('--die-with-parent')), JSON.stringify(calls));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor --execute rejects output that only echoes the smoke prompt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-echo-'));
  const agent = path.join(root, 'dhpk-agent');
  const cursor = path.join(root, 'dhpk-cursor');
  const bin = path.join(root, 'bin');
  try {
    fs.mkdirSync(agent, { recursive: true });
    fs.mkdirSync(cursor, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    writeAgentManifest(agent);
    writeCursorPackage(cursor);
    fs.writeFileSync(path.join(bin, 'cursor-agent'), [
      '#!/bin/sh',
      'printf \'%s\\n\' \'{"response":"dhpk skills commands agents rules were discovered."}\'',
      '',
    ].join('\n'), { mode: 0o755 });
    const result = runProbe('cursor', cursor, ['--execute', '--version', '1.0.0'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    });
    assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).status, 'BLOCKED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex --execute uses a sandboxed CODEX_HOME and reports PASS only after the route exits zero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-execute-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-bin-'));
  try {
    writeAgentManifest(root);
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo codex-test; exit 0; fi\nif [ "$1" = "plugin" ] && [ -n "$CODEX_HOME" ]; then test -d "$CODEX_HOME"; exit $?; fi\nexit 1\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`, DHPK_CONSUMER_PROBE_EXECUTE: '', DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION: '1' };
    const result = runProbe('codex', root, ['--execute'], env);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'PASS');
    assert.strictEqual(payload.surfaceEvidence.status, 'PASS');
    assert.strictEqual(payload.surfaceEvidence.surface, 'codex-marketplace');
    assert.ok(payload.surfaceEvidence.commands.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('diagnostic redaction removes complete authorization and connection credentials before truncation', () => {
  const marker = 'AUTH_MARKER_SHOULD_NOT_LEAK_123456789';
  const text = `Authorization: Bearer ${marker}\nproxy-authorization: Basic ${marker}\npostgres://user:${marker}@db.example.test/x\ntoken="${marker}"`;
  const redacted = redactSensitiveText(text);
  assert.doesNotMatch(redacted, new RegExp(marker));
  assert.match(redacted, /Authorization:\s*<redacted>/i);
  assert.match(redacted, /<redacted>@/);
});

run('consumer-platform-probe');
