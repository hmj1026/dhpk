'use strict';

// Raw bridge-family behavior runs from one relocated physical Skill at a time.
// The consumer project, child drivers, runtime entries, and provider stubs are
// fixture-owned; no canonical source or Host/provider capability is exercised.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const {
  registerBridgeFamilyFixtures,
  runBridgeFamilyFixture,
  bridgeFamilyFixtureIds,
  bridgeFamilySources,
  RESERVED_ROOT_ENVIRONMENT,
} = require('./_lib/skill-bridge-family-fixtures');

const ROOT = path.join(__dirname, '..');
const SOURCES = Object.freeze(Object.fromEntries(
  Object.entries(bridgeFamilySources).map(([id, skillName]) => [
    id,
    path.join(ROOT, 'skills', skillName),
  ]),
));

function ignored(name) {
  return name === '.git' || name === '.cache' || name === '__pycache__' || name.endsWith('.pyc');
}

function fingerprint(root) {
  const visit = (filePath) => {
    const info = fs.lstatSync(filePath);
    if (info.isSymbolicLink()) throw new Error(`canonical fixture source is symlinked: ${filePath}`);
    const hash = crypto.createHash('sha256');
    if (info.isDirectory()) {
      hash.update('dir\0');
      for (const name of fs.readdirSync(filePath).sort()) {
        if (ignored(name)) continue;
        hash.update(name);
        hash.update('\0');
        hash.update(visit(path.join(filePath, name)));
        hash.update('\0');
      }
    } else if (info.isFile()) {
      hash.update('file\0');
      hash.update(fs.readFileSync(filePath));
    } else {
      throw new Error(`canonical fixture source contains non-regular resource: ${filePath}`);
    }
    return hash.digest('hex');
  };
  return visit(root);
}

const CANONICAL_FINGERPRINTS = new Map(
  Object.entries(SOURCES).map(([id, source]) => {
    assert.strictEqual(fs.realpathSync(source), path.resolve(source), `${id} source must be physical`);
    return [id, fingerprint(source)];
  }),
);

function assertCanonicalSourcesUnchanged() {
  for (const [id, expected] of CANONICAL_FINGERPRINTS) {
    assert.strictEqual(fingerprint(SOURCES[id]), expected, `canonical ${id} source changed during fixture execution`);
  }
}

const fixtures = registerBridgeFamilyFixtures();

test('bridge-family registry exposes the exact raw-directory entry matrix', () => {
  assert.deepStrictEqual(Object.keys(fixtures), bridgeFamilyFixtureIds);
  const expectedEntries = {
    'bridge-codex-contained-success': 'scripts/run-codex.sh',
    'bridge-codex-attestation-required': 'scripts/run-codex.sh',
    'bridge-codex-tool-unavailable': 'scripts/run-codex.sh',
    'bridge-agy-contained-success': 'scripts/run-agy.sh',
    'bridge-agy-attestation-required': 'scripts/run-agy.sh',
    'bridge-agy-tool-unavailable': 'scripts/run-agy.sh',
    'bridge-dispatch-codex-local-closure': 'scripts/launch-cli-dispatch.js',
    'bridge-dispatch-agy-local-closure': 'scripts/launch-cli-dispatch.js',
    'bridge-dispatch-rejected-authority': 'scripts/launch-cli-dispatch.js',
    'bridge-transport-prepare-attested': 'scripts/prepare-cli-request.py',
    'bridge-transport-contained-success': 'scripts/run-cli-transport.py',
    'bridge-transport-rejected-authority': 'scripts/run-cli-transport.py',
  };
  for (const [id, entry] of Object.entries(expectedEntries)) {
    assert.strictEqual(fixtures[id].entry, entry, `${id} entry must remain Skill-relative`);
    assert.ok(Number.isInteger(fixtures[id].expected.status), `${id} expected status is required`);
    assert.ok(fixtures[id].expected.output.length > 0, `${id} expected output strings are required`);
  }
  assert.deepStrictEqual(Object.keys(expectedEntries), bridgeFamilyFixtureIds);
});

function isolatedFixture(fixtureId, callback) {
  const fixture = fixtures[fixtureId];
  assert.ok(fixture, `fixture registry must expose ${fixtureId}`);
  const source = SOURCES[fixture.source];
  assert.ok(source, `${fixtureId} must name a canonical bridge Skill`);
  assert.strictEqual(fs.realpathSync(source), path.resolve(source), `${fixture.source} source must be physical`);
  try {
    return withIsolatedSkill({
      source,
      env: {
        BRIDGE_FAMILY_FIXTURE: fixtureId,
        CLAUDE_PLUGIN_ROOT: '/hostile/plugin-root',
        PLUGIN_ROOT: '/hostile/plugin-root',
        DHPK_SOURCE_ROOT: '/hostile/source-root',
        DHPK_PLUGIN_ROOT: '/hostile/plugin-root',
        CURSOR_PLUGIN_ROOT: '/hostile/cursor-root',
        DHPK_CURSOR_PLUGIN_ROOT: '/hostile/cursor-root',
        NODE_PATH: '/hostile/node-path',
        NODE_OPTIONS: '--require=/hostile/ambient.js',
        PYTHONPATH: '/hostile/python-path',
        PYTHONHOME: '/hostile/python-home',
      },
      stubs: fixture.stubs || {},
    }, (context) => {
      assert.ok(context.skillDir.includes('relocated skill'), 'Skill relocation must contain spaces');
      assert.ok(context.projectDir.includes('fixture project'), 'fixture must use a separate project');
      assert.notStrictEqual(context.skillDir, source);
      assert.notStrictEqual(context.projectDir, source);
      for (const key of RESERVED_ROOT_ENVIRONMENT) {
        assert.strictEqual(context.env[key], undefined, `${key} must not leak into fixture environment`);
      }
      const evidence = callback(context, fixture);
      assert.strictEqual(evidence.evidenceKind, 'fixture');
      assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
      return evidence;
    });
  } finally {
    assertCanonicalSourcesUnchanged();
  }
}

for (const fixtureId of bridgeFamilyFixtureIds) {
  test(`isolated bridge-family fixture ${fixtureId}`, () => {
    const evidence = isolatedFixture(fixtureId, (context, fixture) => (
      runBridgeFamilyFixture(fixture, context)
    ));
    assert.strictEqual(evidence.evidenceKind, 'fixture');
    assert.strictEqual(evidence.hostStatus, 'NOT_RUN');
  });
}

test('bridge-family canonical Skill sources remain unchanged after all relocations', () => {
  assertCanonicalSourcesUnchanged();
});

run('skill-bridge-family-isolation');
