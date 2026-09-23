'use strict';

// Instruction-contract evidence only: this does not execute a Host agent or
// claim that a model generated accurate architecture documents.
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

test('relocated codemap Skill retains its five literal output files and write boundary', () => {
  withIsolatedSkill({ source: path.join(__dirname, '../skills/update-codemaps') }, ({ skillDir, projectDir }) => {
    const instructions = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const outputs = [...instructions.matchAll(/^\s*\| `([^`]+\.md)` \|/gm)].map((match) => match[1]);
    assert.deepStrictEqual(outputs, [
      'architecture.md', 'backend.md', 'frontend.md', 'data.md', 'dependencies.md',
    ]);
    assert.ok(instructions.includes('$PROJECT_DIR/docs/CODEMAPS/'));
    assert.ok(instructions.includes('$PROJECT_DIR/.reports/codemap-diff.txt'));
    assert.match(instructions, /above 30% requires the user[’']s confirmation before overwrite/);
    assert.match(instructions.replace(/\s+/g, ' '), /generation date, scanned-file count, and estimated token count/);
    assert.doesNotMatch(instructions, /scripts\/codemaps\/generate\.ts/);
    assert.deepStrictEqual(fs.readdirSync(projectDir), [], 'reading the procedure must not generate project files');
  });
});

run('skill-codemap-contract');
