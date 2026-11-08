'use strict';

// Conformance of the Package Receipt owner (#1241): every generated Host
// package's provenance.json/fingerprints.json is read, verified, and
// re-serialized through scripts/lib/platform-provenance.js without changing a
// byte, and each surface keeps its own inventory-digest ordering.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const receipts = require('../scripts/lib/platform-provenance');
const { inventoryDigestInsertionOrder, inventoryDigestKeySorted } = require('../scripts/lib/content-fingerprint');

const ROOT = path.join(__dirname, '..');
const PACKAGES = [
  { surface: 'agent-plugin', root: 'plugins/dhpk-agent', order: 'key-sorted' },
  { surface: 'cursor-plugin', root: 'plugins/dhpk-cursor', order: 'insertion' },
  { surface: 'codex-native', root: 'plugins/dhpk', order: 'insertion' },
  { surface: 'agy-plugin', root: 'plugins/dhpk-agy', order: 'key-sorted' },
];

function copyReceipt(pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-package-receipt-'));
  for (const name of ['provenance.json', 'fingerprints.json']) {
    fs.copyFileSync(path.join(ROOT, pkg.root, name), path.join(dir, name));
  }
  return dir;
}

function rewrite(dir, name, mutate) {
  const file = path.join(dir, name);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(value);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

for (const pkg of PACKAGES) {
  test(`${pkg.surface}: the tracked receipt reads, verifies, and re-serializes byte-for-byte`, () => {
    const receipt = receipts.readPackageReceipt(path.join(ROOT, pkg.root), { surface: pkg.surface });
    assert.deepStrictEqual(receipt.errors, []);
    assert.strictEqual(receipt.ok, true);
    assert.deepStrictEqual(receipts.verifyPackageReceipt(receipt, receipt.fingerprints), []);
    const text = receipts.serializePackageReceipt(pkg.surface, { provenance: receipt.provenance, fingerprints: receipt.fingerprints });
    assert.strictEqual(text.provenance, fs.readFileSync(path.join(ROOT, pkg.root, 'provenance.json'), 'utf8'));
    assert.strictEqual(text.fingerprints, fs.readFileSync(path.join(ROOT, pkg.root, 'fingerprints.json'), 'utf8'));
  });

  test(`${pkg.surface}: the inventory digest uses the ${pkg.order} ordering`, () => {
    const inventory = { b: 1, a: { d: 2, c: 3 }, profiles: { ignored: true } };
    const expected = pkg.order === 'key-sorted' ? inventoryDigestKeySorted(inventory) : inventoryDigestInsertionOrder(inventory);
    assert.strictEqual(receipts.packageInventoryDigest(pkg.surface, inventory), expected);
    assert.notStrictEqual(inventoryDigestKeySorted(inventory), inventoryDigestInsertionOrder(inventory));
  });

  test(`${pkg.surface}: a changed, missing, or extra fingerprint is reported`, () => {
    const receipt = receipts.readPackageReceipt(path.join(ROOT, pkg.root), { surface: pkg.surface });
    const [first, second] = Object.keys(receipt.fingerprints);
    const observed = { ...receipt.fingerprints, [first]: 'f'.repeat(64), extra: 'e'.repeat(64) };
    delete observed[second];
    const errors = receipts.verifyPackageReceipt(receipt, observed).join('\n');
    assert.match(errors, new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(errors, new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(errors, /extra/);
  });

  test(`${pkg.surface}: missing files, unparseable JSON, and diverging copies fail closed; unknown fields are ignored`, () => {
    const dir = copyReceipt(pkg);
    try {
      rewrite(dir, 'provenance.json', (value) => { value.unknownFutureField = { kept: true }; });
      assert.strictEqual(receipts.readPackageReceipt(dir, { surface: pkg.surface }).ok, true);

      rewrite(dir, 'provenance.json', (value) => { const [key] = Object.keys(value.fingerprints); value.fingerprints[key] = '0'.repeat(64); });
      const diverged = receipts.readPackageReceipt(dir, { surface: pkg.surface });
      assert.strictEqual(diverged.ok, false);
      assert.match(diverged.errors.join('\n'), /fingerprints/);

      fs.writeFileSync(path.join(dir, 'fingerprints.json'), '{not json');
      assert.match(receipts.readPackageReceipt(dir, { surface: pkg.surface }).errors.join('\n'), /fingerprints\.json/);

      fs.rmSync(path.join(dir, 'provenance.json'));
      assert.match(receipts.readPackageReceipt(dir, { surface: pkg.surface }).errors.join('\n'), /provenance\.json/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${pkg.surface}: a receipt for another surface is rejected`, () => {
    const other = PACKAGES.find((candidate) => candidate.surface !== pkg.surface);
    const receipt = receipts.readPackageReceipt(path.join(ROOT, pkg.root), { surface: other.surface });
    assert.strictEqual(receipt.ok, false);
  });
}

for (const pkg of PACKAGES.filter((candidate) => candidate.surface !== 'agy-plugin')) {
  test(`${pkg.surface}: a missing fingerprint recipe marker fails with the version-boundary diagnostic`, () => {
    const dir = copyReceipt(pkg);
    try {
      rewrite(dir, 'provenance.json', (value) => { delete value.fingerprintAlgorithm; });
      const receipt = receipts.readPackageReceipt(dir, { surface: pkg.surface });
      assert.strictEqual(receipt.ok, false);
      assert.match(receipt.errors.join('\n'), /fingerprintAlgorithm/);
      assert.match(receipts.packageFingerprintAlgorithm(dir).error, /fingerprintAlgorithm/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

run('package-receipt');
