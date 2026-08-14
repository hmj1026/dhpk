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

run('install-agy-plugin');
