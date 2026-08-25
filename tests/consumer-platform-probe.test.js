'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { networkSandboxProbe, sandboxInvocation } = require('../scripts/lib/cursor-plugin-package');
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

function writeCursorAuthHome(root) {
  const home = path.join(root, 'cursor-home');
  fs.mkdirSync(path.join(home, '.config', 'cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'cursor', 'auth.json'), '{"token":"fixture"}\n', { mode: 0o600 });
  return home;
}

function writeSandboxUnavailable(bin) {
  for (const name of ['unshare', 'bwrap']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 125\n', { mode: 0o755 });
  }
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

test('release probe converts traversal-limit validation failures into structured BLOCKED evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-entry-limit-'));
  try {
    writeAgentManifest(root);
    for (let index = 0; index <= 40000; index += 1) fs.writeFileSync(path.join(root, `entry-${index}`), '');
    const result = runProbe('agent-plugin', root);
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'BLOCKED', JSON.stringify(payload));
    assert.match(payload.reason, /physical preflight|structural validation/i);
    assert.match(payload.diagnostics.join(' '), /entry count|fingerprint/i);
    assert.strictEqual(payload.surfaceResults[0].status, 'BLOCKED', JSON.stringify(payload));
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

test('Codex discovery reports UNAVAILABLE before NOT_RUN when the CLI is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-absent-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-absent-bin-'));
  try {
    writeAgentManifest(root);
    const result = runProbe('codex', root, [], { ...process.env, PATH: bin });
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'UNAVAILABLE', JSON.stringify(payload));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('agent-plugin runtime probe uses exactly one portable plugin directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-agent-plugin-'));
  const hostHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-agent-home-'));
  const bin = path.join(root, 'bin');
  try {
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(hostHome, '.config', 'cursor'), { recursive: true });
    fs.writeFileSync(path.join(hostHome, '.config', 'cursor', 'auth.json'), '{"token":"fixture"}\n');
    writeSandboxUnavailable(bin);
    writeAgentManifest(root);
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'cursor-agent'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cp = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "const roots = args.filter((arg, index) => args[index - 1] === '--plugin-dir');",
      "for (const candidate of roots) { try { const hooks = JSON.parse(fs.readFileSync(path.join(candidate, 'hooks', 'hooks.json'), 'utf8')); for (const hook of hooks.hooks.sessionStart || []) cp.execFileSync(path.resolve(candidate, hook.command), [], { cwd: candidate }); } catch (_) {} }",
      "const rootWithAttestation = roots.find((candidate) => fs.existsSync(path.join(candidate, 'hooks', '.dhpk-probe-attestation.json')));",
      "const attestation = JSON.parse(fs.readFileSync(path.join(rootWithAttestation, 'hooks', '.dhpk-probe-attestation.json'), 'utf8'));",
      "process.stdout.write(JSON.stringify({ response: 'dhpk skills commands agents rules were discovered.', dhpkProbe: { challenge: attestation.challenge, packageFingerprint: attestation.packageFingerprint, loaded: true, components: attestation.components } }));",
      '',
    ].join('\n'), { mode: 0o755 });
    const result = runProbe('agent-plugin', root, ['--execute', '--version', '1.0.0'], {
      ...process.env,
      HOME: hostHome,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    });
    assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.ok(['PASS', 'BLOCKED', 'UNAVAILABLE'].includes(payload.status), JSON.stringify(payload));
    assert.strictEqual(payload.surfaceResults[0].surface, 'agent-plugin', JSON.stringify(payload));
    assert.strictEqual(payload.surfaceResults[0].status, payload.status, JSON.stringify(payload));
    if (payload.status === 'PASS') assert.strictEqual(payload.network, 'shared', JSON.stringify(payload));
    assert.strictEqual(
      (payload.commands[0].cmd.match(/--plugin-dir/g) || []).length,
      1,
      JSON.stringify(payload),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(hostHome, { recursive: true, force: true });
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

test('Cursor probe converts sibling Agent Plugin validation exceptions into structured BLOCKED evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-sibling-limit-'));
  const cursor = path.join(root, 'dhpk-cursor');
  const agent = path.join(root, 'dhpk-agent');
  try {
    fs.mkdirSync(cursor, { recursive: true });
    fs.mkdirSync(agent, { recursive: true });
    writeCursorPackage(cursor);
    writeAgentManifest(agent);
    for (let index = 0; index <= 40000; index += 1) fs.writeFileSync(path.join(agent, `entry-${index}`), '');
    const result = runProbe('cursor', cursor, ['--execute'], { ...process.env, PATH: '' });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'BLOCKED', JSON.stringify(payload));
    assert.match(payload.reason, /sibling Agent Plugin package|validate/i);
    assert.strictEqual(payload.surfaceResults[0].status, 'BLOCKED', JSON.stringify(payload));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor --execute keeps an isolated profile and uses the verified shared network sandbox', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-execute-'));
  const agent = path.join(root, 'dhpk-agent');
  const cursor = path.join(root, 'dhpk-cursor');
  const bin = path.join(root, 'bin');
  try {
    fs.mkdirSync(agent, { recursive: true });
    fs.mkdirSync(cursor, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    const hostHome = writeCursorAuthHome(root);
    writeSandboxUnavailable(bin);
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
      HOME: hostHome,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    });
    assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.ok(['PASS', 'BLOCKED', 'UNAVAILABLE'].includes(payload.status), JSON.stringify(payload));
    assert.strictEqual(payload.surfaceResults[0].status, payload.status, JSON.stringify(payload));
    if (payload.status === 'PASS') assert.strictEqual(payload.network, 'shared', JSON.stringify(payload));
    assert.ok(payload.session_files.includes('.config/cursor/auth.json'), JSON.stringify(payload));
    assert.ok(payload.commands.some((command) => /cursor-agent/.test(command.cmd)), JSON.stringify(payload));
    assert.match(payload.surfaceResults[0].reasons.join(' '), /challenge|package|network/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor --execute uses a bwrap shared-network sandbox with an isolated filesystem', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'shared', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-bwrap-'));
  const agent = path.join(root, 'dhpk-agent');
  const cursor = path.join(root, 'dhpk-cursor');
  const bin = path.join(root, 'bin');
  try {
    fs.mkdirSync(agent, { recursive: true });
    fs.mkdirSync(cursor, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    const hostHome = writeCursorAuthHome(root);
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

    const env = { ...process.env, HOME: hostHome, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` };
    delete env.DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION;
    const result = runProbe('cursor', cursor, ['--execute', '--version', '1.0.0'], env);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'PASS', JSON.stringify(payload));
    assert.strictEqual(payload.network, 'shared', JSON.stringify(payload));

  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor bwrap probes retain timeout bounds and die-with-parent protection', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'disabled', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-cursor-bwrap-timeout-'));
  const packageRoot = path.join(root, 'package');
  const bin = path.join(root, 'bin');
  const previousPath = process.env.PATH;
  try {
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    const hostHome = writeCursorAuthHome(root);
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
    const probe = runCursorConsumerProbe({
      packageRoot,
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      timeoutMs: 50,
      requirePackageChallenge: true,
      networkMode: 'disabled',
      hostHome,
    });
    assert.strictEqual(probe.status, 'SKIP_INCOMPATIBLE', JSON.stringify(probe));
    assert.strictEqual(probe.timed_out, true, JSON.stringify(probe));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared sandbox argv keeps namespace, secret masks, and private binds ordered', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'shared', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-argv-'));
  try {
    const sandbox = networkSandboxProbe(process.env.PATH, 'shared', true);
    if (!sandbox) return;
    const invocation = sandboxInvocation(sandbox, process.execPath, ['-e', 'process.exit(0)'], [root], os.tmpdir());
    assert.ok(invocation, 'sandbox invocation should be available');
    const argv = invocation[1];
    assert.strictEqual(argv[0], '--ro-bind');
    assert.strictEqual(argv[1], '/');
    assert.ok(argv.includes('--tmpfs') && argv.includes('/home'), JSON.stringify(argv));
    assert.ok(argv.includes('--tmpfs') && argv.includes('/root'), JSON.stringify(argv));
    const unshareAll = argv.indexOf('--unshare-all');
    const shareNet = argv.indexOf('--share-net');
    const writable = argv.indexOf('--bind');
    assert.ok(unshareAll >= 0 && shareNet > unshareAll, JSON.stringify(argv));
    assert.strictEqual(argv.includes('--unshare-net'), false, JSON.stringify(argv));
    assert.ok(writable > shareNet, JSON.stringify(argv));
    assert.strictEqual(argv[argv.indexOf('--') + 1], fs.realpathSync(process.execPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sandbox invocation rejects a client executable directly under a user home', () => {
  if (process.platform === 'win32') return;
  const home = path.resolve(process.env.HOME || '');
  if (!/^\/(?:home|root)\/[^/]+$/.test(home)) return;
  const command = path.join(home, `.dhpk-direct-client-${process.pid}`);
  try {
    fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const sandbox = networkSandboxProbe(process.env.PATH, 'shared', true);
    if (!sandbox) return;
    assert.strictEqual(sandboxInvocation(sandbox, command, [], [], os.tmpdir()), null);
  } finally {
    fs.rmSync(command, { force: true });
  }
});

test('sandbox invocation rejects broken symlinks inside a home client runtime bind tree', () => {
  if (process.platform === 'win32') return;
  const home = path.resolve(process.env.HOME || '');
  if (!/^\/(?:home|root)\/[^/]+$/.test(home)) return;
  const runtimeRoot = fs.mkdtempSync(path.join(home, `dhpk-client-tree-${process.pid}-`));
  const command = path.join(runtimeRoot, 'bin', 'cursor-agent');
  try {
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.symlinkSync(path.join(runtimeRoot, 'missing-target'), path.join(path.dirname(command), 'broken-link'));
    const sandbox = networkSandboxProbe(process.env.PATH, 'shared', true);
    if (!sandbox) return;
    assert.strictEqual(sandboxInvocation(sandbox, command, [], [], os.tmpdir()), null);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
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
    const hostHome = writeCursorAuthHome(root);
    fs.writeFileSync(path.join(bin, 'unshare'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'bwrap'), [
      '#!/usr/bin/env node',
      "const cp = require('node:child_process');",
      'const args = process.argv.slice(2);',
      "const separator = args.indexOf('--');",
      'if (separator < 0 || !args[separator + 1]) process.exit(97);',
      "const result = cp.spawnSync(args[separator + 1], args.slice(separator + 2), { encoding: 'utf8', env: process.env });",
      'if (result.stdout) process.stdout.write(result.stdout);',
      'if (result.stderr) process.stderr.write(result.stderr);',
      'process.exit(result.status === null ? 98 : result.status);',
      '',
    ].join('\n'), { mode: 0o755 });
    writeAgentManifest(agent);
    writeCursorPackage(cursor);
    fs.writeFileSync(path.join(bin, 'cursor-agent'), [
      '#!/bin/sh',
      'printf \'%s\\n\' \'{"response":"dhpk skills commands agents rules were discovered."}\'',
      '',
    ].join('\n'), { mode: 0o755 });
    const result = runProbe('cursor', cursor, ['--execute', '--version', '1.0.0'], {
      ...process.env,
      HOME: hostHome,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    });
    assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).status, 'BLOCKED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex --execute uses a sandboxed CODEX_HOME and reports PASS only after the route exits zero', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'disabled', true)) return;
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

test('Codex route never executes a user-owned unshare shim or unsandboxed fallback', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'disabled', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-shim-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-shim-bin-'));
  const sentinel = path.join(bin, 'unshare-executed');
  try {
    writeAgentManifest(root);
    fs.writeFileSync(path.join(bin, 'unshare'), `#!/bin/sh\nprintf executed > ${JSON.stringify(sentinel)}\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "plugin" ] && [ -n "$CODEX_HOME" ]; then test -d "$CODEX_HOME"; exit $?; fi\nexit 1\n', { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      DHPK_CONSUMER_PROBE_EXECUTE: '',
      DHPK_CONSUMER_PROBE_ALLOW_UNSANDBOXED_EXECUTION: '1',
    };
    const result = runProbe('codex', root, ['--execute'], env);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(fs.existsSync(sentinel), false, result.stdout + result.stderr);
    assert.ok(['PASS', 'BLOCKED'].includes(payload.status), JSON.stringify(payload));
    if (payload.status === 'PASS') assert.strictEqual(payload.network, 'disabled', JSON.stringify(payload));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('Codex version check runs inside the trusted sandbox and cannot write the host', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'disabled', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-version-sandbox-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-version-bin-'));
  const sentinel = path.join(os.tmpdir(), `dhpk-codex-version-host-${process.pid}`);
  try {
    writeAgentManifest(root);
    fs.rmSync(sentinel, { force: true });
    fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\nif [ "$1" = "--version" ]; then printf host-version > ${JSON.stringify(sentinel)}; exit 0; fi\nif [ "$1" = "plugin" ] && [ -n "$CODEX_HOME" ]; then test -d "$CODEX_HOME"; exit $?; fi\nexit 1\n`, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      DHPK_CONSUMER_PROBE_EXECUTE: '',
    };
    const result = runProbe('codex', root, ['--execute'], env);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(fs.existsSync(sentinel), false, result.stdout + result.stderr);
    assert.ok(['PASS', 'BLOCKED'].includes(payload.status), JSON.stringify(payload));
  } finally {
    fs.rmSync(sentinel, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('Codex version probe applies timeout and output bounds before marketplace execution', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'disabled', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-version-timeout-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-version-timeout-bin-'));
  try {
    writeAgentManifest(root);
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      DHPK_CONSUMER_PROBE_EXECUTE: '',
      DHPK_CONSUMER_PROBE_TIMEOUT_MS: '100',
    };
    const started = Date.now();
    const result = runProbe('codex', root, ['--execute'], env);
    assert.ok(Date.now() - started < 2000, `Codex timeout bound exceeded: ${Date.now() - started}ms`);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'BLOCKED', JSON.stringify(payload));
    assert.match(payload.reason, /timed out|timeout/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('Codex version output cap blocks oversized diagnostics before marketplace execution', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'disabled', true)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-version-output-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-probe-codex-version-output-bin-'));
  try {
    writeAgentManifest(root);
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then dd if=/dev/zero bs=1024 count=2 2>/dev/null; exit 0; fi\nexit 1\n', { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      DHPK_CONSUMER_PROBE_EXECUTE: '',
      DHPK_CONSUMER_PROBE_MAX_OUTPUT_BYTES: '100',
    };
    const result = runProbe('codex', root, ['--execute'], env);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'BLOCKED', JSON.stringify(payload));
    assert.match(payload.reason, /output exceeded/i);
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
