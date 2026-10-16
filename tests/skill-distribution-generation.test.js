'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { run: generate } = require('../scripts/ci/gen-skill-directory-coverage');

test('coverage check rejects aggregate-only data and writes only directory-authored rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-coverage-source-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'fixture'), { recursive: true });
    fs.mkdirSync(path.join(root, 'manifests'));
    fs.writeFileSync(path.join(root, 'skills/fixture/SKILL.md'), '---\nname: fixture\n---\n');
    fs.writeFileSync(path.join(root, 'skills/fixture/distribution.yaml'), JSON.stringify({ schema: 'dhpk.skill-distribution.v1', coverage: { entry: 'SKILL.md', references: ['references/a.md'], executable_entries: [], host_capabilities: [] } }));
    const file = path.join(root, 'manifests/skill-directory-coverage.json');
    fs.writeFileSync(file, JSON.stringify({ schema: 'dhpk.skill-directory-coverage.v1', skills: { fixture: { entry: 'SKILL.md' }, orphan: { entry: 'SKILL.md' } } }));
    const before = fs.readFileSync(file, 'utf8');
    const output = [];
    const io = { write: text => output.push(text) };
    assert.strictEqual(generate({ root, argv: ['--check'], stdout: io, stderr: io }).status, 1);
    assert.match(output.join(''), /fixture|orphan/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(generate({ root, argv: ['--write'], stdout: io, stderr: io }).status, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file)).skills, { fixture: { entry: 'SKILL.md', references: ['references/a.md'], executable_entries: [], host_capabilities: [] } });
    assert.strictEqual(generate({ root, argv: ['--check'], stdout: io, stderr: io }).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('skill-distribution-generation');
