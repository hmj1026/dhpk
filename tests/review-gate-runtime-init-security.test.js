'use strict';

// Black-box security contract for the explicit Review Gate runtime setup
// boundary.  These tests intentionally exercise hostile filesystem entries
// and unconfigured commands through the public CLI, not private helpers.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtime = require('../scripts/lib/review-gate-runtime');
const { test, run, assert } = require('./_lib/tinytest');
const {
  createHostKey,
  getOrCreateHostKey,
  hostInitArgs,
} = require('./_lib/review-gate-host-attestation-fixture');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'review-gate-runtime.js');
const WORK_REQUEST_PATH = path.join(
  ROOT,
  'tests',
  'fixtures',
  'review-gate',
  'runtime-work-request-v1.json',
);
const KEY_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1', 'integrity.key');
const CONFIG_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1', 'config.json');
const STORE_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1');
const DIAGNOSTICS_RELATIVE_PATH = path.join(STORE_RELATIVE_PATH, 'diagnostics');
const SECRET = 'setup-secret-must-not-leak';

function runCli(repoRoot, args = [], input = undefined, cwd = repoRoot, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input,
  });
}

function temporaryDirectory(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function repoPath(repoRoot, relativePath) {
  return path.join(repoRoot, relativePath);
}

function escapedRegExp(value) {
  return new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function assertGenericFailure(result, forbidden = []) {
  assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, '', 'failure output must not expose a JSON result');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
  for (const value of forbidden) {
    assert.doesNotMatch(result.stdout, escapedRegExp(value));
    assert.doesNotMatch(result.stderr, escapedRegExp(value));
  }
}

function assertRedactedDiagnostics(repoRoot, forbidden = []) {
  const diagnostics = repoPath(repoRoot, DIAGNOSTICS_RELATIVE_PATH);
  if (!fs.existsSync(diagnostics)) return;
  for (const name of fs.readdirSync(diagnostics)) {
    const file = path.join(diagnostics, name);
    const content = fs.readFileSync(file, 'utf8');
    for (const value of forbidden) assert.doesNotMatch(content, escapedRegExp(value));
    assert.doesNotMatch(content, /(?:\/home\/|[A-Z]:\\)/);
  }
}

function init(repoRoot) {
  const result = runCli(repoRoot, hostInitArgs(getOrCreateHostKey(repoRoot, 'init-security')));
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function initArgs(repoRoot) {
  return hostInitArgs(getOrCreateHostKey(repoRoot, 'init-security'));
}

function cleanupPath(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || stat.isFile()) fs.unlinkSync(file);
  else fs.rmSync(file, { recursive: true, force: true });
}

function writePrivateJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function createStateDirectory(repoRoot) {
  const stateRoot = repoPath(repoRoot, STORE_RELATIVE_PATH);
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  return stateRoot;
}

function assertInitRejectsDirectoryAncestorSwap({
  repoRoot,
  outsideRoot,
  ancestorRelativePath,
  outsideStateRelativePath,
}) {
  const stateRoot = repoPath(repoRoot, STORE_RELATIVE_PATH);
  const keyPath = repoPath(repoRoot, KEY_RELATIVE_PATH);
  const ancestor = repoPath(repoRoot, ancestorRelativePath);
  const backup = `${ancestor}.security-test-backup`;
  const outsideStateRoot = path.join(outsideRoot, outsideStateRelativePath || '');
  fs.mkdirSync(outsideStateRoot, { recursive: true, mode: 0o700 });

  const originalOpenSync = fs.openSync;
  let swapped = false;
  let thrown = null;
  fs.openSync = (file, ...args) => {
    if (!swapped && typeof file === 'string' && path.resolve(file) === path.resolve(keyPath)) {
      fs.renameSync(ancestor, backup);
      fs.symlinkSync(outsideRoot, ancestor, 'dir');
      swapped = true;
    }
    return originalOpenSync(file, ...args);
  };

  try {
    runtime.createIntegrityKey(
      repoRoot,
      getOrCreateHostKey(repoRoot, 'init-security').trust,
    );
  } catch (error) {
    thrown = error;
  } finally {
    fs.openSync = originalOpenSync;
    if (swapped) {
      cleanupPath(ancestor);
      fs.renameSync(backup, ancestor);
    }
  }

  assert.ok(swapped, 'ancestor swap seam was not exercised before key creation');
  assert.ok(thrown, 'init accepted a swapped state ancestor');
  assert.strictEqual(thrown.code, 'SETUP_FAILED');
  assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
  assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
  for (const relativePath of [
    'integrity.key',
    'config.json',
    'plans',
    'works',
    'objects',
    'payload.json',
  ]) {
    assert.strictEqual(
      fs.existsSync(path.join(outsideStateRoot, relativePath)),
      false,
      `init must not create external ${relativePath}`,
    );
  }
  assert.deepStrictEqual(
    fs.readdirSync(outsideStateRoot).sort(),
    [],
    'init must not leave any external state artifacts',
  );
  assert.strictEqual(fs.lstatSync(stateRoot).isDirectory(), true);
}

test('createIntegrityKey rejects a state-root ancestor swap before external state creation', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-key-ancestor-repo-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-init-key-ancestor-outside-');
  try {
    assertInitRejectsDirectoryAncestorSwap({
      repoRoot,
      outsideRoot,
      ancestorRelativePath: STORE_RELATIVE_PATH,
      outsideStateRelativePath: '',
    });
  } finally {
    cleanupPath(repoRoot);
    cleanupPath(outsideRoot);
  }
});

test('createIntegrityKey rejects a review-gate ancestor swap before external state creation', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-review-gate-ancestor-repo-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-init-review-gate-ancestor-outside-');
  try {
    assertInitRejectsDirectoryAncestorSwap({
      repoRoot,
      outsideRoot,
      ancestorRelativePath: path.join('.dhpk', 'review-gate'),
      outsideStateRelativePath: 'v1',
    });
  } finally {
    cleanupPath(repoRoot);
    cleanupPath(outsideRoot);
  }
});

test('init rejects a repository-root symlink without writing through it', () => {
  const target = temporaryDirectory('dhpk-runtime-init-root-target-');
  const linkParent = temporaryDirectory('dhpk-runtime-init-root-link-parent-');
  const repoRoot = path.join(linkParent, 'checkout-link');
  fs.symlinkSync(target, repoRoot, 'dir');
  const host = createHostKey(linkParent, 'init-root-link');
  try {
    const result = runCli(repoRoot, [
      'init',
      '--host-public-key', path.join(linkParent, host.publicKeyPath),
      '--host-key-id', host.keyId,
    ], undefined, target);
    assertGenericFailure(result, [repoRoot, target]);
    assert.deepStrictEqual(fs.readdirSync(target), []);
    assert.strictEqual(fs.existsSync(path.join(target, '.dhpk')), false);
    assertRedactedDiagnostics(target, [repoRoot, target]);
  } finally {
    cleanupPath(repoRoot);
    cleanupPath(linkParent);
    cleanupPath(target);
  }
});

test('init rejects a non-directory repository root without creating state', () => {
  const parent = temporaryDirectory('dhpk-runtime-init-root-file-parent-');
  const repoRoot = path.join(parent, 'checkout-file');
  fs.writeFileSync(repoRoot, SECRET, { mode: 0o600 });
  const host = createHostKey(parent, 'init-root-file');
  try {
    const result = runCli(repoRoot, [
      'init',
      '--host-public-key', path.join(parent, host.publicKeyPath),
      '--host-key-id', host.keyId,
    ], undefined, ROOT);
    assertGenericFailure(result, [repoRoot, SECRET]);
    assert.strictEqual(fs.readFileSync(repoRoot, 'utf8'), SECRET);
    assert.strictEqual(fs.lstatSync(repoRoot).isFile(), true);
    assertRedactedDiagnostics(parent, [repoRoot, SECRET]);
  } finally {
    cleanupPath(parent);
  }
});

test('init rejects an existing integrity-key symlink without writing outside the checkout', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-key-link-repo-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-init-key-link-outside-');
  const keyPath = repoPath(repoRoot, KEY_RELATIVE_PATH);
  const outsideKey = path.join(outsideRoot, 'integrity.key');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outsideKey, SECRET, { mode: 0o600 });
  fs.symlinkSync(outsideKey, keyPath);
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, outsideRoot, SECRET]);
    assert.strictEqual(fs.readFileSync(outsideKey, 'utf8'), SECRET);
    assert.strictEqual(fs.lstatSync(keyPath).isSymbolicLink(), true);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
    assertRedactedDiagnostics(repoRoot, [repoRoot, outsideRoot, SECRET]);
  } finally {
    cleanupPath(repoRoot);
    cleanupPath(outsideRoot);
  }
});

test('init rejects a non-regular integrity key without replacing it or creating config', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-key-directory-');
  const keyPath = repoPath(repoRoot, KEY_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(keyPath, { mode: 0o700 });
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot]);
    assert.strictEqual(fs.lstatSync(keyPath).isDirectory(), true);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
    assertRedactedDiagnostics(repoRoot, [repoRoot]);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('init rejects an existing integrity key with unsafe permissions', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-key-mode-');
  const keyPath = repoPath(repoRoot, KEY_RELATIVE_PATH);
  const key = Buffer.alloc(32, 0x5a);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, key, { mode: 0o640 });
  fs.chmodSync(keyPath, 0o640);
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot]);
    assert.deepStrictEqual(fs.readFileSync(keyPath), key);
    assert.strictEqual(fs.statSync(keyPath).mode & 0o777, 0o640);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
    assertRedactedDiagnostics(repoRoot, [repoRoot]);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('init rejects a config symlink without following or modifying its outside target', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-config-link-repo-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-init-config-link-outside-');
  init(repoRoot);
  const configPath = repoPath(repoRoot, CONFIG_RELATIVE_PATH);
  const outsideConfig = path.join(outsideRoot, 'config.json');
  const configBytes = fs.readFileSync(configPath);
  fs.writeFileSync(outsideConfig, configBytes, { mode: 0o600 });
  fs.unlinkSync(configPath);
  fs.symlinkSync(outsideConfig, configPath);
  const outsideBefore = fs.readdirSync(outsideRoot).sort();
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, outsideRoot]);
    assert.deepStrictEqual(fs.readdirSync(outsideRoot).sort(), outsideBefore);
    assert.deepStrictEqual(fs.readFileSync(outsideConfig), configBytes);
    assert.strictEqual(fs.lstatSync(configPath).isSymbolicLink(), true);
    assertRedactedDiagnostics(repoRoot, [repoRoot, outsideRoot]);
  } finally {
    cleanupPath(repoRoot);
    cleanupPath(outsideRoot);
  }
});

test('init rejects a config symlink before creating a missing integrity key', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-config-link-no-key-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-init-config-link-no-key-outside-');
  const stateRoot = createStateDirectory(repoRoot);
  const configPath = path.join(stateRoot, 'config.json');
  const outsideConfig = path.join(outsideRoot, 'config.json');
  fs.writeFileSync(outsideConfig, SECRET, { mode: 0o600 });
  fs.symlinkSync(outsideConfig, configPath);
  const outsideBefore = fs.readdirSync(outsideRoot).sort();
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, outsideRoot, SECRET]);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
    assert.deepStrictEqual(fs.readdirSync(outsideRoot).sort(), outsideBefore);
    assert.strictEqual(fs.readFileSync(outsideConfig, 'utf8'), SECRET);
    assert.strictEqual(fs.lstatSync(configPath).isSymbolicLink(), true);
    assertRedactedDiagnostics(repoRoot, [repoRoot, outsideRoot, SECRET]);
  } finally {
    cleanupPath(repoRoot);
    cleanupPath(outsideRoot);
  }
});

test('init rejects a structurally tampered config without overwriting it', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-config-tamper-');
  init(repoRoot);
  const configPath = repoPath(repoRoot, CONFIG_RELATIVE_PATH);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.producer = 'attacker-controlled-producer';
  writePrivateJson(configPath, config);
  const tamperedBytes = fs.readFileSync(configPath);
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, 'attacker-controlled-producer']);
    assert.deepStrictEqual(fs.readFileSync(configPath), tamperedBytes);
    assertRedactedDiagnostics(repoRoot, [repoRoot, 'attacker-controlled-producer']);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('init rejects a structurally tampered config before creating a missing integrity key', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-config-tamper-no-key-');
  const stateRoot = createStateDirectory(repoRoot);
  const configPath = path.join(stateRoot, 'config.json');
  const tamperedConfig = {
    schema: 'dhpk.review-gate.runtime-config.v1',
    configVersion: 'v1',
    phaseVersion: 'dhpk.review-gate.phase.v1',
    phase: 'OBSERVE',
    trustPolicyVersion: 'dhpk.review-gate.trust-policy.v1',
    trustPolicy: { producers: [] },
    producer: 'attacker-controlled-producer',
    adapter: 'dhpk-review-gate-runtime',
  };
  writePrivateJson(configPath, tamperedConfig);
  const tamperedBytes = fs.readFileSync(configPath);
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, 'attacker-controlled-producer']);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
    assert.deepStrictEqual(fs.readFileSync(configPath), tamperedBytes);
    assertRedactedDiagnostics(repoRoot, [repoRoot, 'attacker-controlled-producer']);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('init rejects a config with an unsupported phase and leaves the phase unchanged', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-config-phase-');
  init(repoRoot);
  const configPath = repoPath(repoRoot, CONFIG_RELATIVE_PATH);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.phase = 'CUTOVER';
  writePrivateJson(configPath, config);
  const phaseBytes = fs.readFileSync(configPath);
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, 'CUTOVER']);
    assert.deepStrictEqual(fs.readFileSync(configPath), phaseBytes);
    assertRedactedDiagnostics(repoRoot, [repoRoot, 'CUTOVER']);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('init rejects an unsupported phase before creating a missing integrity key', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-config-phase-no-key-');
  const stateRoot = createStateDirectory(repoRoot);
  const configPath = path.join(stateRoot, 'config.json');
  const invalidConfig = {
    schema: 'dhpk.review-gate.runtime-config.v1',
    configVersion: 'v1',
    phaseVersion: 'dhpk.review-gate.phase.v1',
    phase: 'CUTOVER',
    trustPolicyVersion: 'dhpk.review-gate.trust-policy.v1',
    trustPolicy: { producers: [] },
    producer: 'dhpk-review-gate-runtime',
    adapter: 'dhpk-review-gate-runtime',
  };
  writePrivateJson(configPath, invalidConfig);
  const invalidBytes = fs.readFileSync(configPath);
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assertGenericFailure(result, [repoRoot, 'CUTOVER']);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
    assert.deepStrictEqual(fs.readFileSync(configPath), invalidBytes);
    assertRedactedDiagnostics(repoRoot, [repoRoot, 'CUTOVER']);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('runtime commands reject caller phase overrides instead of entering an enforcing phase', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-init-phase-override-');
  init(repoRoot);
  const workRequest = fs.readFileSync(WORK_REQUEST_PATH, 'utf8');
  const commands = [
    { args: ['prepare', '--phase', 'CUTOVER'], input: workRequest },
    { args: ['status', '--work-id', 'work-390', '--phase', 'CUTOVER'] },
    {
      args: [
        'observe',
        '--work-id', 'work-390',
        '--wave-id', 'wave-390',
        '--artifact', 'artifact.md',
        '--companion', 'artifact.result.json',
        '--lifecycle-events', 'lifecycle.jsonl',
        '--readiness-events', 'readiness.jsonl',
        '--phase', 'CUTOVER',
      ],
    },
  ];
  try {
    for (const command of commands) {
      const result = runCli(repoRoot, command.args, command.input);
      assertGenericFailure(result, [repoRoot, 'CUTOVER']);
    }
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, path.join(STORE_RELATIVE_PATH, 'plans'))), true);
    assert.deepStrictEqual(
      fs.readdirSync(repoPath(repoRoot, path.join(STORE_RELATIVE_PATH, 'plans'))),
      [],
    );
    assertRedactedDiagnostics(repoRoot, [repoRoot, 'CUTOVER']);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('prepare refuses to create integrity key or config before explicit init', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-prepare-no-lazy-init-');
  try {
    const result = runCli(repoRoot, ['prepare'], fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
    assertGenericFailure(result, [repoRoot]);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, '.dhpk')), false);
    assertRedactedDiagnostics(repoRoot, [repoRoot]);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('observe refuses to create integrity key or config before explicit init', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-observe-no-lazy-init-');
  try {
    const result = runCli(repoRoot, [
      'observe',
      '--work-id', 'work-390',
      '--wave-id', 'wave-390',
      '--artifact', 'artifact.md',
      '--companion', 'artifact.result.json',
      '--lifecycle-events', 'lifecycle.jsonl',
      '--readiness-events', 'readiness.jsonl',
      '--sentinel-outcome', 'sentinel.json',
    ]);
    assertGenericFailure(result, [repoRoot]);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, '.dhpk')), false);
    assertRedactedDiagnostics(repoRoot, [repoRoot]);
  } finally {
    cleanupPath(repoRoot);
  }
});

test('status refuses to create integrity key or config before explicit init', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-status-no-lazy-init-');
  try {
    const result = runCli(repoRoot, ['status', '--work-id', 'work-390']);
    assertGenericFailure(result, [repoRoot]);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, KEY_RELATIVE_PATH)), false);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, CONFIG_RELATIVE_PATH)), false);
    assert.strictEqual(fs.existsSync(repoPath(repoRoot, '.dhpk')), false);
    assertRedactedDiagnostics(repoRoot, [repoRoot]);
  } finally {
    cleanupPath(repoRoot);
  }
});

run('review-gate-runtime-init-security');
