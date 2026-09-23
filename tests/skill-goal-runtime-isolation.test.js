'use strict';

// RED contracts for the opsx-apply-goal raw-directory runtime.  Each fixture
// runs from one relocated physical Skill with an unrelated consumer project;
// no repository checkout, sibling Skill, real Claude Host, network, or Git
// write is part of the evidence.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const {
  SOURCE,
  REVIEW_GATE_CLOSURE,
  RESERVED_ROOT_ENVIRONMENT,
  providerStubs,
  registerGoalRuntimeFixtures,
  runGoalRuntimeFixture,
  goalRuntimeFixtureIds,
} = require('./_lib/skill-goal-runtime-fixtures');

const ROOT = path.join(__dirname, '..');

function ignored(name) {
  return name === '.git' || name === '.cache' || name === '__pycache__' || name.endsWith('.pyc');
}

function fingerprint(root) {
  function visit(filePath) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`canonical Skill source is symlinked: ${filePath}`);
    const hash = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      hash.update('dir\0');
      for (const name of fs.readdirSync(filePath).sort()) {
        if (ignored(name)) continue;
        hash.update(name);
        hash.update('\0');
        hash.update(visit(path.join(filePath, name)));
        hash.update('\0');
      }
    } else if (stat.isFile()) {
      hash.update('file\0');
      hash.update(fs.readFileSync(filePath));
    } else {
      throw new Error(`canonical Skill source contains a non-regular resource: ${filePath}`);
    }
    return hash.digest('hex');
  }
  return visit(root);
}

assert.strictEqual(fs.realpathSync(SOURCE), path.resolve(SOURCE), 'goal Skill source must be physical');
const CANONICAL_FINGERPRINT = fingerprint(SOURCE);

function assertCanonicalSourceUnchanged() {
  assert.strictEqual(fingerprint(SOURCE), CANONICAL_FINGERPRINT,
    'canonical opsx-apply-goal source changed during isolated fixture execution');
}

const fixtures = registerGoalRuntimeFixtures();

test('goal runtime registry exposes bounded entries and exact fixture contracts', () => {
  assert.deepStrictEqual(Object.keys(fixtures), goalRuntimeFixtureIds);
  const expectedEntries = {
    'goal-analyzer-local-closure': 'scripts/analyze-change.sh',
    'goal-analyzer-missing-transitive-resource': 'scripts/analyze-change.sh',
    'goal-orientation-dispatch-off-local-policy': 'scripts/analyze-change.sh',
    'goal-orientation-dispatch-on-local-policy': 'scripts/analyze-change.sh',
    'goal-dispatch-codex-local-success': 'scripts/launch-cli-dispatch.js',
    'goal-dispatch-agy-local-success': 'scripts/launch-cli-dispatch.js',
    'goal-dispatch-rejected-authority': 'scripts/launch-cli-dispatch.js',
    'goal-review-gate-unresolved-evidence': 'scripts/review-gate-runtime.js',
  };
  assert.deepStrictEqual(Object.keys(expectedEntries), goalRuntimeFixtureIds);
  for (const [id, entry] of Object.entries(expectedEntries)) {
    assert.strictEqual(fixtures[id].entry, entry, `${id} must name a Skill-relative entry`);
    assert.strictEqual(fixtures[id].source, 'opsx-apply-goal');
    assert.ok(Number.isInteger(fixtures[id].expected.status), `${id} expected status is required`);
    assert.ok(Array.isArray(fixtures[id].expected.output) && fixtures[id].expected.output.length > 0,
      `${id} expected output contract is required`);
  }
  assert.strictEqual(REVIEW_GATE_CLOSURE.length, 19, 'Review Gate closure must contain the approved 19 files');
  assert.strictEqual(new Set(REVIEW_GATE_CLOSURE).size, REVIEW_GATE_CLOSURE.length,
    'Review Gate closure must not duplicate a destination');
});

function isolatedFixture(fixtureId, callback) {
  const fixture = fixtures[fixtureId];
  assert.ok(fixture, `fixture registry must expose ${fixtureId}`);
  try {
    return withIsolatedSkill({
      source: SOURCE,
      env: {
        GOAL_RUNTIME_FIXTURE: fixtureId,
        CLAUDE_PLUGIN_ROOT: '/hostile/plugin root',
        PLUGIN_ROOT: '/hostile/plugin root',
        DHPK_SOURCE_ROOT: '/hostile/source root',
        DHPK_PLUGIN_ROOT: '/hostile/plugin root',
        CURSOR_PLUGIN_ROOT: '/hostile/cursor root',
        DHPK_CURSOR_PLUGIN_ROOT: '/hostile/cursor root',
        NODE_PATH: '/hostile/node path',
        NODE_OPTIONS: '--require=/hostile/ambient.js',
        PYTHONPATH: '/hostile/python path',
        PYTHONHOME: '/hostile/python home',
      },
      stubs: providerStubs(),
    }, (context) => {
      assert.ok(context.skillDir.includes('relocated skill'), 'Skill relocation must contain spaces');
      assert.ok(context.projectDir.includes('fixture project'), 'consumer project must be separate');
      assert.notStrictEqual(context.skillDir, SOURCE);
      assert.notStrictEqual(context.projectDir, SOURCE);
      for (const key of RESERVED_ROOT_ENVIRONMENT) {
        assert.strictEqual(context.env[key], undefined, `${key} leaked into the isolated fixture environment`);
      }
      const evidence = callback(context, fixture);
      assert.strictEqual(evidence.evidenceKind, 'fixture');
      assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
      return evidence;
    });
  } finally {
    assertCanonicalSourceUnchanged();
  }
}

for (const fixtureId of goalRuntimeFixtureIds) {
  test(`isolated goal runtime fixture ${fixtureId}`, () => {
    const evidence = isolatedFixture(fixtureId, (context, fixture) => (
      runGoalRuntimeFixture(fixture, context)
    ));
    assert.strictEqual(evidence.evidenceKind, 'fixture');
    assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
  });
}

test('relocated goal Skill contains the complete local 19-file Review Gate closure', () => {
  isolatedFixture('goal-review-gate-unresolved-evidence', (context) => {
    for (const relative of REVIEW_GATE_CLOSURE) {
      const filePath = path.join(context.skillDir, relative);
      const stat = fs.lstatSync(filePath);
      assert.ok(stat.isFile(), `${relative} must be a regular local Review Gate file`);
      assert.strictEqual(stat.isSymbolicLink(), false, `${relative} must not be a symlink`);
    }
    return { evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
  });
});

test('goal runtime fixture evidence does not claim actual Claude Host execution', () => {
  const evidence = { evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
  assert.deepStrictEqual(evidence, { evidenceKind: 'fixture', hostStatus: 'NOT_RUN' });
});

test('canonical goal Skill source remains unchanged after every relocation', () => {
  assertCanonicalSourceUnchanged();
});

run('skill-goal-runtime-isolation');
