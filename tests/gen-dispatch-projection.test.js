'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'gen-dispatch-projection.js');

test('dispatch projection generator emits the canonical contract and AGY 3.8 native model', () => {
  const result = spawnSync(process.execPath, [CLI, '--surface', 'agy-plugin'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const projection = JSON.parse(result.stdout);
  assert.strictEqual(projection.schema, 'dhpk.dispatch.projection.v1');
  assert.strictEqual(projection.contract.request, 'dhpk.dispatch.request.v2');
  assert.strictEqual(projection.hosts.find((entry) => entry.host === 'agy').native_model, 'gemini-3.8-flash-high');
});

test('dispatch projection generator writes a validated bounded artifact', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dispatch-projection-')));
  const output = path.join(directory, 'projection.json');
  try {
    const result = spawnSync(process.execPath, [CLI, '--surface', 'cursor-plugin', '--out', output], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const projection = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.strictEqual(projection.fingerprint.length, 64);
    assert.deepStrictEqual(projection.contract.roles.map((entry) => entry.role), ['planner', 'reasoner', 'worker', 'reviewer']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('dispatch projection generator can validate every configured surface together', () => {
  const result = spawnSync(process.execPath, [CLI, '--all'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.strictEqual(document.schema, 'dhpk.dispatch.projections.v1');
  assert.strictEqual(document.projections.length, 7);
  assert.strictEqual(document.projections.find((entry) => entry.surface === 'agy-plugin').hosts.find((entry) => entry.host === 'agy').native_model, 'gemini-3.8-flash-high');
});

run('gen-dispatch-projection');
