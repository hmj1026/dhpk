'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { verifyCursorPackage } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

test('Cursor consumer-runtime verification keeps NOT_CONFIGURED distinct from structural PASS', () => {
  const result = verifyCursorPackage({
    packageRoot: path.join(ROOT, 'plugins/dhpk-cursor'),
    inventory: INVENTORY,
    stage: 'consumer-runtime',
    observedAt: '2026-08-13T00:00:00.000Z',
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.structural.ok, true);
  assert.strictEqual(result.evidence.stage, 'consumer-runtime');
  assert.strictEqual(result.evidence.verdict, 'NOT_CONFIGURED');
  assert.strictEqual(result.evidence.planFingerprint, JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'plugins/dhpk-cursor', 'provenance.json'), 'utf8')).planFingerprint);
  assert.notStrictEqual(result.evidence.planFingerprint, JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'plugins/dhpk-cursor', 'provenance.json'), 'utf8')).inventoryDigest);
  assert.strictEqual(result.evidence.observedAt, '2026-08-13T00:00:00.000Z');
  assert.ok(result.evidence.claims.includes('Cursor consumer configuration'));
});

test('Cursor consumer adapter can report UNAVAILABLE without upgrading to PASS', () => {
  const result = verifyCursorPackage({
    packageRoot: path.join(ROOT, 'plugins/dhpk-cursor'),
    inventory: INVENTORY,
    stage: 'consumer-runtime',
    observedAt: '2026-08-13T00:00:00.000Z',
    consumerAdapter: {
      identity: { id: 'cursor-cli', version: 'missing' },
      verify: () => ({ verdict: 'UNAVAILABLE', diagnostics: ['Cursor client tooling is unavailable'] }),
    },
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.strictEqual(result.evidence.verdict, 'UNAVAILABLE');
  assert.deepStrictEqual(result.evidence.diagnostics, ['Cursor client tooling is unavailable']);
});

test('Cursor package validator reports structural PASS and consumer NOT_RUN separately', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'validate-cursor-plugin-package.js'),
    path.join(ROOT, 'plugins', 'dhpk-cursor'),
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.structural, 'PASS');
  assert.strictEqual(report.consumer.status, 'NOT_RUN');
});

run('validate-cursor-plugin-package');
