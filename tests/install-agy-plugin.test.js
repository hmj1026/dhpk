'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'install-agy-plugin.js');
const SOURCE = path.join(ROOT, 'plugins', 'dhpk-agy');

function invoke(action, target) {
  return spawnSync(process.execPath, [SCRIPT, action, '--source', SOURCE, '--target', target, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function invokeReport(action, target) {
  const result = invoke(action, target);
  return { result, report: JSON.parse(result.stdout) };
}

test('CLI installs and rolls back the receipt-owned AGY package', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-install-'));
  const target = path.join(temp, 'target');
  try {
    const installed = invoke('install', target);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    assert.ok(fs.existsSync(path.join(target, 'provenance.json')));

    const rolledBack = invoke('rollback', target);
    assert.strictEqual(rolledBack.status, 0, `${rolledBack.stdout}\n${rolledBack.stderr}`);
    assert.ok(!fs.existsSync(path.join(target, 'provenance.json')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CLI plan and status report a foreign checkout without mutation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-plan-'));
  const target = path.join(temp, 'target');
  try {
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugin.json'), '{"name":"dhpk","version":"0.38.0"}\n');
    for (const action of ['plan', 'status']) {
      const { result, report } = invokeReport(action, target);
      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.classification, 'FOREIGN_CHECKOUT');
      assert.strictEqual(report.mutation.performed, false);
    }
    assert.ok(!fs.existsSync(path.join(target, 'provenance.json')));
    assert.deepStrictEqual(fs.readdirSync(target).sort(), ['.git', 'plugin.json']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('install-agy-plugin');
