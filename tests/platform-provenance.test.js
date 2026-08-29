'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  RECEIPT_SCHEMA,
  SURFACE_OWNERS,
  createSurfaceReceipt,
  assertCleanSourceCheckout,
  resolveGeneratedFromTree,
  validateSurfaceReceipt,
  assertRollbackOwnership,
} = require('../scripts/lib/platform-provenance');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-provenance-ancestry-')));
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'provenance-test@example.invalid']);
  git(root, ['config', 'user.name', 'Provenance Test']);
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-qm', 'base']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', '-b', 'generated']);
  fs.writeFileSync(path.join(root, 'generated.txt'), 'generated package input\n');
  git(root, ['add', 'generated.txt']);
  git(root, ['commit', '-qm', 'generate package']);
  const siblingCommit = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', '-b', 'target', baseCommit]);
  fs.writeFileSync(path.join(root, 'target.txt'), 'release target\n');
  git(root, ['add', 'target.txt']);
  git(root, ['commit', '-qm', 'release target']);
  const targetCommit = git(root, ['rev-parse', 'HEAD']);

  return {
    root,
    baseCommit,
    siblingCommit,
    targetCommit,
    targetTree: resolveGeneratedFromTree(root, targetCommit),
  };
}

function receiptFor(root, generatedFromCommit) {
  return createSurfaceReceipt({
    surface: 'agent-plugin',
    sourceVersion: '1.2.3',
    sourceCommit: generatedFromCommit,
    generatedFromCommit,
    generatedFromTree: resolveGeneratedFromTree(root, generatedFromCommit),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: { 'dhpk-example': 'c'.repeat(64) },
  });
}

test('surface receipts carry an owner that is independent per publication surface', () => {
  const receipt = createSurfaceReceipt({
    surface: 'agent-plugin',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: { 'dhpk-example': 'c'.repeat(64) },
    route: 'local-agent-plugin',
  });
  assert.strictEqual(receipt.schema, RECEIPT_SCHEMA);
  assert.strictEqual(receipt.surface, 'agent-plugin');
  assert.strictEqual(receipt.owner, SURFACE_OWNERS['agent-plugin']);
  assert.strictEqual(validateSurfaceReceipt(receipt, 'agent-plugin').ok, true);
  assert.strictEqual(validateSurfaceReceipt(receipt, 'cursor-plugin').ok, false);
});

test('surface receipts expose generated-input identity separately from the release target', () => {
  const receipt = createSurfaceReceipt({
    surface: 'agent-plugin',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    generatedFromCommit: 'a'.repeat(40),
    generatedFromTree: 'd'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: { 'dhpk-example': 'c'.repeat(64) },
  });
  assert.strictEqual(receipt.generatedFromCommit, 'a'.repeat(40));
  assert.strictEqual(receipt.generatedFromTree, 'd'.repeat(40));
  assert.strictEqual(validateSurfaceReceipt(receipt, 'agent-plugin').ok, true);
});

test('receipt validation rejects generated input from a sibling commit at the target checkout', () => {
  const fixture = gitFixture();
  try {
    const result = validateSurfaceReceipt(receiptFor(fixture.root, fixture.siblingCommit), 'agent-plugin', {
      root: fixture.root,
      targetCommit: fixture.targetCommit,
      targetTree: fixture.targetTree,
    });
    assert.strictEqual(result.ok, false, 'sibling generated input must not pass exact-head validation');
    assert.match(result.errors.join('\n'), /not an ancestor|ancestor/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('receipt validation accepts generated input from an ancestor commit at the target checkout', () => {
  const fixture = gitFixture();
  try {
    const result = validateSurfaceReceipt(receiptFor(fixture.root, fixture.baseCommit), 'agent-plugin', {
      root: fixture.root,
      targetCommit: fixture.targetCommit,
      targetTree: fixture.targetTree,
    });
    assert.strictEqual(result.ok, true, result.errors.join('; '));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('receipt validation rejects a target tree that does not match the target commit', () => {
  const fixture = gitFixture();
  try {
    const result = validateSurfaceReceipt(receiptFor(fixture.root, fixture.baseCommit), 'agent-plugin', {
      root: fixture.root,
      targetCommit: fixture.targetCommit,
      targetTree: '0'.repeat(40),
    });
    assert.strictEqual(result.ok, false, 'target tree must describe the target commit');
    assert.match(result.errors.join('\n'), /target tree does not match/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('provenance-bound generation rejects a dirty source checkout', () => {
  const fixture = gitFixture();
  try {
    assert.strictEqual(assertCleanSourceCheckout(fixture.root), true);
    fs.writeFileSync(path.join(fixture.root, 'dirty.txt'), 'uncommitted source input\n');
    assert.throws(
      () => assertCleanSourceCheckout(fixture.root),
      /source checkout must be clean/i,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('receipt validation rejects an owner or surface swap', () => {
  const receipt = createSurfaceReceipt({
    surface: 'cursor-plugin',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: {},
  });
  const swapped = { ...receipt, owner: SURFACE_OWNERS['agent-plugin'] };
  const result = validateSurfaceReceipt(swapped, 'cursor-plugin');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /owner/i.test(error)));
});

test('rollback guard refuses to mutate a different surface owner', () => {
  const receipt = createSurfaceReceipt({
    surface: 'codex-native',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: {},
  });
  assert.doesNotThrow(() => assertRollbackOwnership(receipt, 'codex-native'));
  assert.throws(() => assertRollbackOwnership(receipt, 'agent-plugin'), /ownership|surface/i);
});

run('platform-provenance');
