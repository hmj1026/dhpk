'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { runClaudeUserConfigProbe } = require('../scripts/release/claude-user-config-probe');

test('configured consumer probe stays non-pass without an exact details binding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-probe-'));
  const manifestPath = path.join(dir, 'plugin.json');
  try {
    fs.writeFileSync(manifestPath, '{}\n');
    const result = runClaudeUserConfigProbe({
      manifestPath,
      manifestFingerprint: 'a'.repeat(64),
      version: '2.1.238',
      execute: true,
      runner: (command, args) => args[0] === '--version'
        ? { status: 0, stdout: 'claude 2.1.238' }
        : { status: 0, stdout: JSON.stringify({ name: 'dhpk' }) },
    });
    assert.strictEqual(result.status, 'FAIL');
    assert.ok(result.resumeCommand);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe rejects a stale local manifest even when the consumer reports a forged expected fingerprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-stale-'));
  const manifestPath = path.join(dir, 'plugin.json');
  try {
    fs.writeFileSync(manifestPath, '{"name":"legacy"}\n');
    const result = runClaudeUserConfigProbe({
      manifestPath,
      manifestFingerprint: 'b'.repeat(64),
      version: '2.1.238',
      execute: true,
      runner: (command, args) => args[0] === '--version'
        ? { status: 0, stdout: 'claude 2.1.238' }
        : { status: 0, stdout: JSON.stringify({ manifestFingerprint: 'b'.repeat(64) }) },
    });
    assert.strictEqual(result.status, 'FAIL');
    assert.match(result.reason, /fingerprint/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe rejects a prefix-only Claude version and unrelated plugin details', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-version-'));
  const manifestPath = path.join(dir, 'plugin.json');
  try {
    const manifest = { name: 'dhpk' };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    const crypto = require('node:crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const result = runClaudeUserConfigProbe({
      manifestPath,
      manifestFingerprint: fingerprint,
      version: '2.1.23',
      execute: true,
      runner: (command, args) => args[0] === '--version'
        ? { status: 0, stdout: 'claude 2.1.238' }
        : { status: 0, stdout: JSON.stringify({ name: 'other-plugin', manifestFingerprint: fingerprint }) },
    });
    assert.strictEqual(result.status, 'BLOCKED');
    assert.match(result.reason, /version/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe requires dhpk identity before accepting fingerprint details', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-identity-'));
  const manifestPath = path.join(dir, 'plugin.json');
  try {
    const manifest = { name: 'dhpk' };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    const crypto = require('node:crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const result = runClaudeUserConfigProbe({
      manifestPath,
      manifestFingerprint: fingerprint,
      version: '2.1.238',
      execute: true,
      runner: (command, args) => args[0] === '--version'
        ? { status: 0, stdout: 'claude 2.1.238' }
        : { status: 0, stdout: JSON.stringify({ name: 'other-plugin', manifestFingerprint: fingerprint }) },
    });
    assert.strictEqual(result.status, 'BLOCKED');
    assert.match(result.reason, /identity/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe treats a prerelease suffix as a version mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-prerelease-'));
  const manifestPath = path.join(dir, 'plugin.json');
  try {
    const manifest = { name: 'dhpk' };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    const crypto = require('node:crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const result = runClaudeUserConfigProbe({
      manifestPath,
      manifestFingerprint: fingerprint,
      version: '2.1.2',
      runner: () => ({ status: 0, stdout: 'claude 2.1.2-beta' }),
    });
    assert.strictEqual(result.status, 'BLOCKED');
    assert.match(result.reason, /version/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe rejects conflicting consumer fingerprints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-user-config-conflict-'));
  const manifestPath = path.join(dir, 'plugin.json');
  try {
    const manifest = { name: 'dhpk' };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    const crypto = require('node:crypto');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const other = 'c'.repeat(64);
    const result = runClaudeUserConfigProbe({
      manifestPath,
      manifestFingerprint: fingerprint,
      version: '2.1.238',
      execute: true,
      runner: (command, args) => args[0] === '--version'
        ? { status: 0, stdout: 'claude 2.1.238' }
        : { status: 0, stdout: JSON.stringify({ name: 'dhpk', manifestFingerprint: fingerprint, userConfigFingerprint: other }) },
    });
    assert.strictEqual(result.status, 'FAIL');
    assert.match(result.reason, /conflicting/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('claude-user-config-probe');
