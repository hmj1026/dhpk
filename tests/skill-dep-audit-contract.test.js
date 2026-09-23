'use strict';

// Static instruction evidence; independent Host review has not been executed.
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

test('relocated dependency audit keeps a local independent review contract without a peer', () => {
  withIsolatedSkill({ source: path.join(__dirname, '../skills/dep-audit') }, ({ skillDir, projectDir }) => {
    const entry = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const procedure = fs.readFileSync(path.join(skillDir, 'references/workflow.md'), 'utf8').replace(/\s+/g, ' ');
    assert.match(entry, /installation is not required/);
    assert.match(procedure, /otherwise use the Host's independent reviewer capability with this local contract/);
    assert.match(procedure, /return `BLOCKED` with `INDEPENDENT_REVIEW_UNAVAILABLE`/);
    assert.match(procedure, /must not self-approve/);
    assert.match(procedure, /consumer input, not a bundled Skill resource/);
    assert.match(procedure, /failure is terminal and must not silently fall back/);
    assert.match(procedure, /Do not run a fix unless `--fix` was explicit/);
    assert.match(procedure, /successful fix alone never changes this gate/);
    assert.deepStrictEqual(fs.readdirSync(projectDir), []);
  });
});

run('skill-dep-audit-contract');
