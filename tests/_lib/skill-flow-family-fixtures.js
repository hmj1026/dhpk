'use strict';

// Flow-family authoring fixtures.  The registry records expected behavior;
// execution happens only through withIsolatedSkill in the owning test.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
const { outputText, assertExpected } = require('./fixture-assertions');

const FLOW_GUIDE_ACTION = 'scripts/action-runner.js';

const outputOf = outputText;

function definition(definition) {
  return {
    ...definition,
    assert(result) {
      assertExpected(result, definition.expected, definition.id);
      if (definition.expected.references) {
        assert.deepStrictEqual(JSON.parse(result.stdout).references, definition.expected.references);
      }
    },
  };
}

const ROUTE_DRIVER = String.raw`
'use strict';
const path = require('node:path');
const skillDir = process.argv[2];
const api = require(path.join(skillDir, 'scripts', 'route-result.js'));
const result = api.createRouteResult({
  host: 'cursor',
  argv: ['--go', 'implement', 'the', 'confirmed', 'change'],
  observed: {
    host: 'cursor',
    invocationClasses: { 'flow-drive': 'explicit-only' },
    published: ['flow-drive'],
    discovered: ['flow-drive'],
    availability: { 'flow-drive': 'available' },
  },
});
process.stdout.write(JSON.stringify(result) + '\n');
`;

function runApiDriver(context, source) {
  const driver = path.join(context.projectDir, '.flow-family-driver.js');
  fs.writeFileSync(driver, source, { mode: 0o600 });
  try {
    return {
      ...spawnSync(process.execPath, [driver, context.skillDir], {
        cwd: context.projectDir,
        env: context.env,
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      }),
      evidenceKind: 'fixture',
      hostStatus: 'NOT_RUN',
    };
  } finally {
    fs.rmSync(driver, { force: true });
  }
}

const DEFINITIONS = [
  definition({
    id: 'flow-guide-help-unknown',
    entry: FLOW_GUIDE_ACTION,
    args: ['help', 'does-not-exist'],
    expected: { status: 1, output: ['unknown-skill'] },
  }),
  definition({
    id: 'flow-guide-help-known-non-codex',
    entry: FLOW_GUIDE_ACTION,
    args: ['help', 'module-design'],
    expected: { status: 1, output: ['not-codex-invokable'] },
  }),
  definition({
    id: 'flow-guide-help-retired-name',
    entry: FLOW_GUIDE_ACTION,
    args: ['help', 'dhpk-post-dev-test'],
    expected: { status: 1, output: ['retired'] },
  }),
  definition({
    id: 'flow-guide-route-explicit-authority',
    entry: 'scripts/route-result.js',
    expected: {
      status: 0,
      output: ['flow-drive', 'explicit-only', 'explicit-required', 'available'],
    },
    testdriver: (context) => runApiDriver(context, ROUTE_DRIVER),
  }),
  definition({
    id: 'flow-guide-rules-local-policy',
    entry: FLOW_GUIDE_ACTION,
    args: ['rules'],
    expected: {
      status: 0,
      output: ['references/execution-bundle/rules/execution-policy.md'],
      references: [
        'references/execution-bundle/rules/execution-policy.md',
        'references/execution-bundle/skills/flow-guide/references/invocation-precedence.md',
      ],
    },
  }),
  definition({
    id: 'flow-guide-close-local-resources',
    entry: FLOW_GUIDE_ACTION,
    args: ['close'],
    expected: {
      status: 0,
      output: ['references/handoff-and-verification.md'],
      absent: ['skills/flow-guide/references/'],
    },
  }),
];

for (const [id, entry] of [
  ['shared-verification-handoff-missing-input', 'references/execution-bundle/scripts/cli-dispatch/verify-handoff.js'],
]) {
  DEFINITIONS.push(definition({
    id,
    entry,
    args: [],
    expected: { status: 1, output: ['usage:'] },
  }));
}

let registered = false;

function registerFlowFamilyFixtures() {
  if (!registered) {
    for (const fixture of DEFINITIONS) registerFixture(fixture);
    registered = true;
  }
  return getFixtures();
}

function runFlowFamilyFixture(fixture, context) {
  const result = fixture.testdriver
    ? fixture.testdriver(context, fixture)
    : context.run(fixture.entry, fixture.args);
  fixture.assert(result, context);
  return { result, evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
}

module.exports = {
  registerFlowFamilyFixtures,
  runFlowFamilyFixture,
  runApiDriver,
  outputOf,
  flowGuideFixtureIds: Object.freeze(DEFINITIONS.filter((fixture) => fixture.id.startsWith('flow-guide-')).map((fixture) => fixture.id)),
};
