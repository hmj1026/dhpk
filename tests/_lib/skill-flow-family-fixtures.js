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
const FLOW_DRIVE_INVOCATION = 'scripts/invocation.js';

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

const DISPATCH_REQUEST = {
  schema: 'dhpk.dispatch.request.v2',
  host_profile: {
    schema: 'dhpk.host.profile.v1',
    version: 'fixture-host-v1',
    host: 'cursor',
    native_target_agent: 'cursor',
    native_provider: 'cursor',
    native_model: 'fixture-native',
    native_transport: 'native-runtime',
    allowed_providers: ['cursor', 'openai'],
    access: {
      cursor: { status: 'AVAILABLE', evidence: 'isolated host fixture' },
      openai: { status: 'AVAILABLE', evidence: 'isolated host fixture' },
    },
    quota_pools: { cursor: 'native', openai: 'fixture' },
    concurrency_limits: { native: 1, fixture: 1 },
    observed_at: '2026-09-22T00:00:00.000Z',
  },
  task_id: 'flow-family-task',
  attempt_id: 'flow-family-attempt',
  role: 'worker',
  authority: 'workspace-write',
  task: { description_digest: 'a'.repeat(64) },
  scope: {
    workdir: '/fixture/project',
    assigned_files: ['src/example.js'],
    prompt_evidence: {
      path: '/fixture/project/.dhpk/prompt.txt',
      dev: 1,
      ino: 2,
      sha256: 'b'.repeat(64),
    },
  },
  target: {
    target_agent: 'cursor',
    provider: 'openai',
    model_id: 'fixture-model',
    transport: 'local-cli',
  },
  effort: 'high',
  fallback: { allow: false, retry_budget: 0 },
  parallelism: { dependencies: [], max_concurrency: 1 },
};

const DISPATCH_CATALOG = {
  schema: 'dhpk.model.catalog.v2',
  version: 'fixture-catalog-v1',
  observed_at: '2026-09-22T00:00:00.000Z',
  models: {
    'openai/fixture-model': {
      provider: 'openai',
      model_id: 'fixture-model',
      display_name: 'Isolated Fixture Model',
    },
  },
  routes: [{
    host: 'cursor',
    target_agent: 'cursor',
    provider: 'openai',
    model_id: 'fixture-model',
    route: 'headless-cli',
    transport: 'local-cli',
    roles: ['worker'],
    efforts: ['high'],
    authorities: ['workspace-write'],
    effort_binding: 'parameter',
    source: 'isolated fixture catalog',
    observed_at: '2026-09-22T00:00:00.000Z',
  }],
};

function dispatchDriver(request, invalid = false) {
  const candidate = invalid
    ? { ...request, role: 'planner', authority: 'workspace-write' }
    : request;
  return String.raw`
'use strict';
const path = require('node:path');
const skillDir = process.argv[2];
const api = require(path.join(skillDir, 'scripts', 'dispatch.js'));
const request = ${JSON.stringify(candidate)};
const catalog = ${JSON.stringify(DISPATCH_CATALOG)};
try {
  const result = api.prepareDispatch({
    change: { confirmed: true, change_id: 'flow-family-confirmed-change' },
    request,
    catalog,
  });
  process.stdout.write(JSON.stringify({
    resolution: result.resolution,
    handoff: result.handoff,
    authority: result.request.authority,
  }) + '\\n');
} catch (error) {
  process.stderr.write((error && error.message) || String(error));
  process.stderr.write('\\n');
  process.exitCode = 2;
}
`;
}

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
    args: ['help', 'dhpk-module-design'],
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
      output: ['references/handoff-and-verification.md', 'references/review-gate-mechanics.md'],
      absent: ['skills/flow-guide/references/'],
    },
  }),
  definition({
    id: 'flow-drive-confirmed-input',
    entry: FLOW_DRIVE_INVOCATION,
    args: ['confirmed-change-123'],
    expected: { status: 0, output: ['"status":"ready"', 'confirmed-change-123'] },
  }),
  definition({
    id: 'flow-drive-retired-codex-block',
    entry: FLOW_DRIVE_INVOCATION,
    args: ['confirmed-change-123', '--codex'],
    expected: { status: 2, output: ['"status":"blocked"', '--codex', 'retired'] },
  }),
  definition({
    id: 'flow-drive-dispatch-valid',
    entry: 'scripts/dispatch.js',
    expected: { status: 0, output: ['RESOLVED', 'ready', 'workspace-write', 'fixture-model'] },
    testdriver: (context) => runApiDriver(context, dispatchDriver(DISPATCH_REQUEST)),
  }),
  definition({
    id: 'flow-drive-dispatch-invalid-authority',
    entry: 'scripts/dispatch.js',
    expected: { status: 2, output: ['planner', 'workspace-write', 'authority'] },
    testdriver: (context) => runApiDriver(context, dispatchDriver(DISPATCH_REQUEST, true)),
  }),
];

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
  flowDriveFixtureIds: Object.freeze(DEFINITIONS.filter((fixture) => fixture.id.startsWith('flow-drive-')).map((fixture) => fixture.id)),
};
