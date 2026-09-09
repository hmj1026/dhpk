'use strict';

// RED security coverage for the explicit host-trust enrollment boundary. The
// public-key path and existing runtime configuration are both hostile inputs;
// init must not silently widen or redirect the trust anchor.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtime = require('../scripts/lib/review-gate-runtime');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'review-gate-runtime.js');

function runCli(repoRoot, args = []) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function temporaryDirectory(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writePublicKey(file, mode = 0o600) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, der, { mode });
  fs.chmodSync(file, mode);
  return der;
}

function keyId(der) {
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
}

function assertGenericFailure(result) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
}

test('keyless init refuses to accept a pre-enrolled host trust silently', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-host-trust-keyless-');
  const publicKeyPath = path.join(repoRoot, 'host.pub');
  const der = writePublicKey(publicKeyPath);
  try {
    const enrolled = runCli(repoRoot, [
      'init', '--host-public-key', 'host.pub', '--host-key-id', keyId(der),
    ]);
    assert.strictEqual(enrolled.status, 0, `${enrolled.stdout}\n${enrolled.stderr}`);

    const configPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'config.json');
    const before = fs.readFileSync(configPath);
    const keyless = runCli(repoRoot, ['init']);

    assertGenericFailure(keyless);
    assert.deepStrictEqual(fs.readFileSync(configPath), before);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('direct integrity-key setup requires host trust before creating state', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-host-trust-direct-required-');
  try {
    assert.throws(
      () => runtime.createIntegrityKey(repoRoot),
      (error) => error && error.code === 'HOST_TRUST_REQUIRED',
    );
    assert.strictEqual(fs.existsSync(path.join(repoRoot, '.dhpk')), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('init rejects a different enrolled host trust without changing config', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-host-trust-mismatch-');
  const firstPath = path.join(repoRoot, 'host-first.pub');
  const secondPath = path.join(repoRoot, 'host-second.pub');
  const firstDer = writePublicKey(firstPath);
  const secondDer = writePublicKey(secondPath);
  try {
    const first = runCli(repoRoot, [
      'init', '--host-public-key', 'host-first.pub', '--host-key-id', keyId(firstDer),
    ]);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const configPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'config.json');
    const before = fs.readFileSync(configPath);

    const second = runCli(repoRoot, [
      'init', '--host-public-key', 'host-second.pub', '--host-key-id', keyId(secondDer),
    ]);
    assertGenericFailure(second);
    assert.deepStrictEqual(fs.readFileSync(configPath), before);
    const diagnosticsPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'diagnostics');
    const diagnostics = fs.readdirSync(diagnosticsPath).map((name) => (
      JSON.parse(fs.readFileSync(path.join(diagnosticsPath, name), 'utf8'))
    ));
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].code, 'HOST_TRUST_MISMATCH');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('direct integrity-key setup rejects malformed supplied host trust before state creation', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-host-trust-direct-malformed-');
  try {
    assert.throws(
      () => runtime.createIntegrityKey(repoRoot, {}),
      (error) => error && error.code === 'MALFORMED_HOST_TRUST',
    );
    assert.strictEqual(fs.existsSync(path.join(repoRoot, '.dhpk')), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('init rejects a host public key reached through a symlinked ancestor', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-host-trust-ancestor-repo-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-host-trust-ancestor-outside-');
  const linkedDirectory = path.join(repoRoot, 'keys');
  fs.symlinkSync(outsideRoot, linkedDirectory, 'dir');
  const der = writePublicKey(path.join(outsideRoot, 'host.pub'));
  try {
    const result = runCli(repoRoot, [
      'init',
      '--host-public-key', path.join('keys', 'host.pub'),
      '--host-key-id', keyId(der),
    ]);

    assertGenericFailure(result);
    assert.strictEqual(fs.existsSync(path.join(repoRoot, '.dhpk')), false);
    assert.deepStrictEqual(fs.readdirSync(outsideRoot).sort(), ['host.pub']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('init rejects a host public key with unsafe permissions', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-host-trust-mode-');
  const publicKeyPath = path.join(repoRoot, 'host.pub');
  const der = writePublicKey(publicKeyPath, 0o666);
  try {
    const result = runCli(repoRoot, [
      'init', '--host-public-key', 'host.pub', '--host-key-id', keyId(der),
    ]);

    assertGenericFailure(result);
    assert.strictEqual(fs.statSync(publicKeyPath).mode & 0o777, 0o666);
    assert.strictEqual(fs.existsSync(path.join(repoRoot, '.dhpk')), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-host-trust-security');
