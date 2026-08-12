'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { AGENT_PLUGIN_SCHEMA } = require('../scripts/lib/agent-plugin-package');
const { redactSensitiveText } = require('../scripts/lib/redaction');

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
    assert.strictEqual(JSON.parse(result.stdout).status, 'UNAVAILABLE');
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
    assert.strictEqual(JSON.parse(result.stdout).status, 'PASS');
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
