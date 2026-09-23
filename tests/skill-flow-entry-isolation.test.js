'use strict';

const path = require('node:path');
const { test, run } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerFlowEntryFixtures, flowEntryFixtureIds } = require('./_lib/skill-flow-entry-fixtures');
const fixtures = registerFlowEntryFixtures();

for (const id of flowEntryFixtureIds) {
  test(`isolated public entry ${id}`, () => {
    const fixture = fixtures[id];
    withIsolatedSkill({ source: path.join(__dirname, '../skills', fixture.skill), stubs: fixture.stubs }, context => {
      const result = context.run(fixture.entry, fixture.args || []);
      fixture.assert(result, context);
    });
  });
}

run('skill-flow-entry-isolation');
