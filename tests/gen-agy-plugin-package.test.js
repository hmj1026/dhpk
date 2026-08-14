'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'gen-agy-plugin-package.js');

test('CLI generates a validated AGY package in a disposable output root', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-generate-'));
  const output = path.join(temp, 'package');
  try {
    const result = spawnSync(process.execPath, [SCRIPT, output, '--version=0.39.0'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(output, 'plugin.json')));
    assert.ok(fs.existsSync(path.join(output, 'provenance.json')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('gen-agy-plugin-package');
