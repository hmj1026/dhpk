'use strict';

// Raw flow-family behavior is exercised from a relocated physical Skill tree.
// The consumer project, child drivers, environment, and tool stubs all belong
// to the isolation fixture; no canonical Skill is used as a runtime fallback.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const {
  registerFlowFamilyFixtures,
  runFlowFamilyFixture,
  flowGuideFixtureIds,
  flowDriveFixtureIds,
} = require('./_lib/skill-flow-family-fixtures');

const ROOT = path.join(__dirname, '..');
const SOURCES = Object.freeze({
  'flow-guide': path.join(ROOT, 'skills', 'flow-guide'),
  'flow-drive': path.join(ROOT, 'skills', 'flow-drive'),
});
const RESERVED_ENV = [
  'CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT', 'DHPK_SOURCE_ROOT',
  'NODE_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME',
];

function fingerprint(root) {
  const hashNode = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`canonical fixture source is symlinked: ${current}`);
    const digest = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      digest.update('dir\0');
      for (const name of fs.readdirSync(current).sort()) {
        digest.update(name);
        digest.update('\0');
        digest.update(hashNode(path.join(current, name)));
        digest.update('\0');
      }
    } else {
      digest.update('file\0');
      digest.update(fs.readFileSync(current));
    }
    return digest.digest('hex');
  };
  return hashNode(root);
}

const CANONICAL_FINGERPRINTS = new Map(
  Object.entries(SOURCES).map(([id, source]) => [id, fingerprint(source)]),
);

function assertCanonicalSourcesUnchanged() {
  for (const [id, before] of CANONICAL_FINGERPRINTS) {
    assert.strictEqual(fingerprint(SOURCES[id]), before, `canonical ${id} source changed during fixture execution`);
  }
}

function isolatedFixture(fixtureId, callback) {
  const skill = fixtureId.startsWith('flow-guide-') ? 'flow-guide' : 'flow-drive';
  const source = SOURCES[skill];
  assert.strictEqual(fs.realpathSync(source), path.resolve(source), `${skill} must have a physical source boundary`);
  try {
    return withIsolatedSkill({
      source,
      env: {
        FLOW_FAMILY_FIXTURE: fixtureId,
        CLAUDE_PLUGIN_ROOT: '/hostile/plugin-root',
        PLUGIN_ROOT: '/hostile/plugin-root',
        DHPK_SOURCE_ROOT: '/hostile/source-root',
        NODE_PATH: '/hostile/node-path',
        NODE_OPTIONS: '--require=/hostile/ambient.js',
        PYTHONPATH: '/hostile/python-path',
        PYTHONHOME: '/hostile/python-home',
      },
      stubs: {
        git: { status: 127, stderr: 'HOST_NOT_RUN: git fixture unavailable\n' },
        npm: { status: 127, stderr: 'HOST_NOT_RUN: npm fixture unavailable\n' },
      },
    }, (context) => {
      assert.notStrictEqual(context.skillDir, source);
      assert.ok(context.skillDir.includes('relocated skill'));
      assert.ok(context.projectDir.includes('fixture project'));
      for (const key of RESERVED_ENV) assert.strictEqual(context.env[key], undefined, `${key} leaked into fixture env`);
      const evidence = callback(context);
      assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
      assert.strictEqual(evidence.evidenceKind, 'fixture');
      return evidence;
    });
  } finally {
    assertCanonicalSourcesUnchanged();
  }
}

const fixtures = registerFlowFamilyFixtures();
const fixtureIds = [...flowGuideFixtureIds, ...flowDriveFixtureIds];

for (const fixtureId of fixtureIds) {
  test(`isolated flow-family fixture ${fixtureId}`, () => {
    const fixture = fixtures[fixtureId];
    assert.ok(fixture, `fixture registry must expose ${fixtureId}`);
    isolatedFixture(fixtureId, (context) => runFlowFamilyFixture(fixture, context));
  });
}

test('flow-family fixture sources remain canonical after all relocations', () => {
  assertCanonicalSourcesUnchanged();
});

run('skill-flow-family-isolation');
