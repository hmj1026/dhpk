'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');
const VALIDATOR = path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js');

test('validate-agents-skills CLI reports structural PASS and runtime boundary', () => {
  const outDir = fs.mkdtempSync(path.join(ROOT, '.agents-skills-validate-'));
  try {
    const generated = spawnSync(process.execPath, [GENERATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(generated.status, 0, generated.stderr);
    const result = spawnSync(process.execPath, [VALIDATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \[agents-skills\]: 37 selected skills; runtime=NOT_RUN/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

run('validate-agents-skills');
