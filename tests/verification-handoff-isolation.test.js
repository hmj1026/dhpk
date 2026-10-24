'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerFlowFamilyFixtures, runFlowFamilyFixture } = require('./_lib/skill-flow-family-fixtures');

const fixtures = registerFlowFamilyFixtures();
for (const [skill, entry, fixtureId] of [
  ['flow-guide', 'references/execution-bundle/scripts/cli-dispatch/verify-handoff.js', 'shared-verification-handoff-missing-input'],
]) {
  test(`${skill}/${entry} runs without a sibling skill or checkout`, () => {
    withIsolatedSkill({ source: path.join(__dirname, '..', 'skills', skill) }, (context) => {
      runFlowFamilyFixture(fixtures[fixtureId], context);
      fs.writeFileSync(path.join(context.projectDir, 'result.txt'), 'completed');
      const digest = createHash('sha256').update('completed').digest('hex');
      const receipt = path.join(context.projectDir, 'handoff.json');
      fs.writeFileSync(receipt, JSON.stringify({ status: 'DONE', files: { 'result.txt': digest } }));
      const result = context.run(entry, [
        '--root', context.projectDir, '--handoff', receipt, '--assigned-file', 'result.txt',
        '--', process.execPath, '-e', "require('node:fs').writeFileSync('verified.txt', 'yes')",
      ]);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(fs.readFileSync(path.join(context.projectDir, 'verified.txt'), 'utf8'), 'yes');
    });
  });
}
run('verification-handoff-isolation');
