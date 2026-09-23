'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');

test('gen-agents-skills CLI materializes a project-local compatibility tree', () => {
  const outDir = fs.mkdtempSync(path.join(ROOT, '.agents-skills-cli-'));
  try {
    const result = spawnSync(process.execPath, [GENERATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote 55 selected skills/);
    assert.ok(fs.existsSync(path.join(outDir, '.dhpk-projection.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'flow-guide', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'flow-guide.md')));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('gen-agents-skills CLI can materialize outside the canonical source checkout', () => {
  const projectRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-agents-skills-cli-project-'));
  try {
    const result = spawnSync(process.execPath, [
      GENERATOR,
      '--source-root', ROOT,
      '--project-root', projectRoot,
      '--profile', 'portable-core',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'flow-guide', 'SKILL.md')));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('gen-agents-skills');
