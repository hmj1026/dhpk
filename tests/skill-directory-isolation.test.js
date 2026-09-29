'use strict';

// The helper modules are loaded lazily so a missing module is attributed to
// the behavioral contracts below instead of becoming a suite setup error.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

let isolation;
let isolationLoadError;
try {
  isolation = require('./_lib/skill-directory-isolation');
} catch (error) {
  isolationLoadError = error;
}

let fixtureRegistry;
let fixtureRegistryLoadError;
try {
  fixtureRegistry = require('./_lib/skill-directory-fixtures');
} catch (error) {
  fixtureRegistryLoadError = error;
}

let registeredFixtures;

const RESERVED_ROOT_ENVIRONMENT = [
  'CLAUDE_PLUGIN_ROOT',
  'PLUGIN_ROOT',
  'DHPK_ROOT',
  'DHPK_PLUGIN_ROOT',
  'DHPK_SOURCE_ROOT',
  'CURSOR_PLUGIN_ROOT',
  'DHPK_CURSOR_PLUGIN_ROOT',
  'NODE_PATH',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONHOME',
];

function physicalTemp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function remove(...paths) {
  for (const target of paths) {
    if (target) fs.rmSync(target, { recursive: true, force: true });
  }
}

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function makeSkillSource({ escapeTarget = null } = {}) {
  const source = physicalTemp('skill source with spaces-');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(source, 'references'), { recursive: true });
  fs.mkdirSync(path.join(source, '.cache'), { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), [
    '---',
    'name: isolation-fixture',
    'description: isolated raw-directory fixture',
    '---',
    '',
    'The fixture reads only its local references directory.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(source, 'references', 'payload.txt'), 'payload-v1\n');
  fs.writeFileSync(path.join(source, '.cache', 'ignored.txt'), 'ambient cache must not copy\n');
  writeExecutable(path.join(source, 'scripts', 'local-fixture.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const resource = path.join(__dirname, '..', 'references', 'payload.txt');",
    'let payload;',
    'try { payload = fs.readFileSync(resource, \'utf8\').trim(); }',
    "catch (error) { console.error(`missing-local-resource:${error.code || error.message}`); process.exit(23); }",
    "const argument = process.argv.slice(2).join('|');",
    "const output = `fixture:${argument}:${payload}:${process.env.DHPK_FIXTURE_MARKER || ''}`;",
    "fs.writeFileSync(path.join(process.cwd(), 'fixture-result.txt'), `${output}\\n`);",
    'console.log(output);',
  ].join('\n') + '\n');
  writeExecutable(path.join(source, 'scripts', 'tool-fixture.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { spawnSync } = require('node:child_process');",
    "const git = spawnSync('git', ['--fixture'], { encoding: 'utf8' });",
    "const npm = spawnSync('npm', ['--fixture'], { encoding: 'utf8' });",
    'if (git.error || npm.error) {',
    "  console.error(`external-tool-error:${git.error || npm.error}`);",
    '  process.exit(37);',
    '}',
    "const output = `tools:${git.status}:${npm.status}:${git.stdout.trim()}:${npm.stdout.trim()}`;",
    "fs.writeFileSync(path.join(process.cwd(), 'tool-result.txt'), `${output}\\n`);",
    'console.log(output);',
  ].join('\n') + '\n');
  if (escapeTarget) {
    fs.symlinkSync(escapeTarget, path.join(source, 'references', 'escape.txt'));
  }
  return source;
}

function registerFixtures() {
  if (registeredFixtures) return registeredFixtures;
  if (fixtureRegistryLoadError) throw fixtureRegistryLoadError;
  registeredFixtures = {
    local: fixtureRegistry.registerFixture({
      id: 'isolation-local-resource',
      entry: 'scripts/local-fixture.js',
      args: ['unicode ✅ argument with spaces'],
      expected: { status: 0, stdout: 'fixture:unicode ✅ argument with spaces:payload-v1:fixture-ok\n' },
      assert(result, context) {
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stdout, this.expected.stdout);
        assert.strictEqual(
          fs.readFileSync(path.join(context.projectDir, 'fixture-result.txt'), 'utf8'),
          this.expected.stdout,
        );
      },
    }),
    tools: fixtureRegistry.registerFixture({
      id: 'isolation-external-tools',
      entry: 'scripts/tool-fixture.js',
      args: [],
      expected: { status: 0, stdout: 'tools:17:18:git-stub:npm-stub\n' },
      assert(result, context) {
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stdout, this.expected.stdout);
        assert.strictEqual(
          fs.readFileSync(path.join(context.projectDir, 'tool-result.txt'), 'utf8'),
          this.expected.stdout,
        );
      },
    }),
  };
  return registeredFixtures;
}

test('a Skill relocates into paths with spaces and keeps observable behavior isolated', () => {
  assert.ifError(isolationLoadError);
  const source = makeSkillSource();
  const fixtures = registerFixtures();
  try {
    isolation.withIsolatedSkill({
      source,
      env: {
        CLAUDE_PLUGIN_ROOT: source,
        PLUGIN_ROOT: source,
        DHPK_ROOT: source,
        DHPK_PLUGIN_ROOT: source,
        DHPK_SOURCE_ROOT: source,
        CURSOR_PLUGIN_ROOT: source,
        DHPK_CURSOR_PLUGIN_ROOT: source,
        NODE_PATH: source,
        NODE_OPTIONS: `--require=${path.join(source, 'scripts', 'local-fixture.js')}`,
        PYTHONPATH: source,
        PYTHONHOME: source,
        DHPK_FIXTURE_MARKER: 'fixture-ok',
      },
      stubs: {
        git: { status: 17, stdout: 'git-stub\n', stderr: '' },
        npm: { status: 18, stdout: 'npm-stub\n', stderr: '' },
      },
    }, (context) => {
      assert.match(context.skillDir, / /, 'destination must contain spaces');
      assert.notStrictEqual(fs.realpathSync(context.skillDir), source);
      assert.notStrictEqual(fs.realpathSync(context.projectDir), source);
      assert.notStrictEqual(context.env.HOME, process.env.HOME);
      assert.notStrictEqual(context.env.TMPDIR, process.env.TMPDIR);
      for (const name of RESERVED_ROOT_ENVIRONMENT) {
        assert.strictEqual(context.env[name], undefined, `${name} must be scrubbed`);
      }
      assert.strictEqual(context.env.DHPK_FIXTURE_MARKER, 'fixture-ok');

      const local = context.run(fixtures.local.entry, fixtures.local.args);
      fixtures.local.assert(local, context);
      const tools = context.run(fixtures.tools.entry, fixtures.tools.args);
      fixtures.tools.assert(tools, context);
      assert.ok(!fs.existsSync(path.join(source, 'fixture-result.txt')));
      assert.ok(!fs.existsSync(path.join(source, 'tool-result.txt')));
      return { local: local.status, tools: tools.status };
    });
  } finally {
    remove(source);
  }
});

test('missing transitive resources fail despite hostile parent and sibling lookalikes', () => {
  assert.ifError(isolationLoadError);
  const source = makeSkillSource();
  const fixtures = registerFixtures();
  try {
    fs.rmSync(path.join(source, 'references', 'payload.txt'));
    isolation.withIsolatedSkill({
      source,
      env: { DHPK_FIXTURE_MARKER: 'fixture-ok' },
    }, (context) => {
      const parentLookalike = path.join(path.dirname(context.skillDir), 'references', 'payload.txt');
      const siblingLookalike = path.join(context.projectDir, 'references', 'payload.txt');
      fs.mkdirSync(path.dirname(parentLookalike), { recursive: true });
      fs.mkdirSync(path.dirname(siblingLookalike), { recursive: true });
      fs.writeFileSync(parentLookalike, 'hostile-parent\n');
      fs.writeFileSync(siblingLookalike, 'hostile-sibling\n');

      const result = context.run(fixtures.local.entry, fixtures.local.args);
      assert.notStrictEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /missing-local-resource/i);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /hostile-(?:parent|sibling)/i);
      assert.strictEqual(fs.existsSync(path.join(context.skillDir, 'references', 'payload.txt')), false);
    });
  } finally {
    remove(source);
  }
});

test('the copy boundary skips ordinary caches and rejects symlink or escaping resources', () => {
  assert.ifError(isolationLoadError);
  const source = makeSkillSource();
  const outside = physicalTemp('skill isolation outside-');
  const escaped = path.join(outside, 'secret.txt');
  fs.writeFileSync(escaped, 'outside\n');
  const symlinkSource = makeSkillSource({ escapeTarget: escaped });
  try {
    isolation.withIsolatedSkill({ source }, (context) => {
      assert.ok(fs.existsSync(path.join(context.skillDir, 'SKILL.md')));
      assert.strictEqual(fs.existsSync(path.join(context.skillDir, '.cache', 'ignored.txt')), false);
    });
    assert.throws(
      () => isolation.withIsolatedSkill({
        source: symlinkSource,
      }, () => {}),
      /symlink|escape|boundary|outside/i,
    );
    assert.throws(
      () => isolation.withIsolatedSkill({
        source,
        files: ['../secret.txt'],
      }, () => {}),
      /escape|boundary|contained|outside/i,
    );
  } finally {
    remove(source, symlinkSource, outside);
  }
});

test('unstubbed Git and package tools remain unavailable inside the fixture', () => {
  assert.ifError(isolationLoadError);
  const source = makeSkillSource();
  try {
    isolation.withIsolatedSkill({ source }, (context) => {
      const result = context.run('scripts/tool-fixture.js');
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, 'tools:127:127::\n');
      assert.strictEqual(result.evidenceKind, 'fixture');
      assert.strictEqual(result.hostStatus, 'NOT_RUN');
    });
  } finally { remove(source); }
});


// --- skill-bridge-family-isolation ---
{
// Raw bridge-family behavior runs from one relocated physical Skill at a time.
// The consumer project, child drivers, runtime entries, and provider stubs are
// fixture-owned; no canonical source or Host/provider capability is exercised.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
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

const registeredFixtures = registerBridgeFamilyFixtures();
const fixtures = Object.fromEntries(
  Object.entries(registeredFixtures).filter(([id]) => id.startsWith('bridge-')),
);

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
}


// --- skill-flow-entry-isolation ---
{
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerFlowEntryFixtures, flowEntryFixtureIds } = require('./_lib/skill-flow-entry-fixtures');
const fixtures = registerFlowEntryFixtures();

const EXPECTED_ENTRIES = [
  ['flow-guide-usage-local-card', 'flow-guide', 'scripts/usage-card.js'],
  ['flow-guide-analyze-consumer', 'flow-guide', 'scripts/analyze.js'],
  ['flow-guide-prepare-consumer-profile', 'flow-guide', 'scripts/prepare_workflow_profile.py'],
  ['flow-guide-prepare-consumer-scope', 'flow-guide', 'scripts/prepare_dev_scope.py'],
  ['flow-guide-workflow-missing-evidence', 'flow-guide', 'scripts/workflow_gate_check.py'],
  ['flow-guide-openspec-ready-fixture', 'flow-guide', 'scripts/openspec_gate_check.py'],
  ['flow-guide-bundled-selector-native', 'flow-guide', 'references/execution-bundle/scripts/fast-worker-selector.js'],
  ['flow-drive-bundled-selector-native', 'flow-drive', 'references/execution-bundle/scripts/fast-worker-selector.js'],
];

test('flow entry registry pins every expected Skill-local entry before execution', () => {
  assert.deepStrictEqual(flowEntryFixtureIds, EXPECTED_ENTRIES.map(([id]) => id));
  for (const [id, skill, entry] of EXPECTED_ENTRIES) {
    assert.strictEqual(fixtures[id].skill, skill, `${id} must run from ${skill}`);
    assert.strictEqual(fixtures[id].entry, entry, `${id} must use its declared local entry`);
  }
});

for (const id of flowEntryFixtureIds) {
  test(`isolated public entry ${id}`, () => {
    const fixture = fixtures[id];
    withIsolatedSkill({ source: path.join(__dirname, '../skills', fixture.skill), stubs: fixture.stubs }, context => {
      const result = context.run(fixture.entry, fixture.args || []);
      fixture.assert(result, context);
    });
  });
}
}


// --- skill-flow-family-isolation ---
{
// Raw flow-family behavior is exercised from a relocated physical Skill tree.
// The consumer project, child drivers, environment, and tool stubs all belong
// to the isolation fixture; no canonical Skill is used as a runtime fallback.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
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
const EXPECTED_FLOW_GUIDE = [
  ['flow-guide-help-unknown', 'scripts/action-runner.js'],
  ['flow-guide-help-known-non-codex', 'scripts/action-runner.js'],
  ['flow-guide-help-retired-name', 'scripts/action-runner.js'],
  ['flow-guide-route-explicit-authority', 'scripts/route-result.js'],
  ['flow-guide-rules-local-policy', 'scripts/action-runner.js'],
  ['flow-guide-close-local-resources', 'scripts/action-runner.js'],
];
const EXPECTED_FLOW_DRIVE = [
  ['flow-drive-confirmed-input', 'scripts/invocation.js'],
  ['flow-drive-retired-codex-block', 'scripts/invocation.js'],
  ['flow-drive-dispatch-valid', 'scripts/dispatch.js'],
  ['flow-drive-dispatch-invalid-authority', 'scripts/dispatch.js'],
];

test('flow-family registry pins every expected fixture ID and Skill-local entry', () => {
  assert.deepStrictEqual(flowGuideFixtureIds, EXPECTED_FLOW_GUIDE.map(([id]) => id));
  assert.deepStrictEqual(flowDriveFixtureIds, EXPECTED_FLOW_DRIVE.map(([id]) => id));
  for (const [id, entry] of EXPECTED_FLOW_GUIDE) {
    assert.strictEqual(fixtures[id].entry, entry, `${id} must use its flow-guide-local entry`);
  }
  for (const [id, entry] of EXPECTED_FLOW_DRIVE) {
    assert.strictEqual(fixtures[id].entry, entry, `${id} must use its flow-drive-local entry`);
  }
});

for (const fixtureId of fixtureIds) {
  test(`isolated flow-family fixture ${fixtureId}`, () => {
    const fixture = fixtures[fixtureId];
    assert.ok(fixture, `fixture registry must expose ${fixtureId}`);
    isolatedFixture(fixtureId, (context) => runFlowFamilyFixture(fixture, context));
  });
}
}


// --- skill-local-tool-isolation ---
{
const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerLocalToolFixtures } = require('./_lib/skill-local-tool-fixtures');
const fixtures = registerLocalToolFixtures();

for (const id of [
  'laravel-local-version-guidance', 'laravel-missing-version-blocked',
  'phpunit-local-version-guidance', 'phpunit-missing-version-blocked',
  'js-status-local-classification', 'js-status-missing-directory',
]) {
  test(id, () => {
    const fixture = fixtures[id];
    withIsolatedSkill({ source: path.join(__dirname, '../skills', fixture.skill) }, (context) => {
      if (id === 'js-status-local-classification') {
        fs.mkdirSync(path.join(context.projectDir, 'js/nested'), { recursive: true });
        for (const [name, contents] of Object.entries({
          'strict.js': '// @ts-check\nconst x=1;\n',
          'transition.js': '// @ts-check\n// @ts-nocheck transitional\nconst x=2;\n',
          'plain.js': 'const x=3;\n', 'nested/nested.js': '// @ts-check\n',
        })) fs.writeFileSync(path.join(context.projectDir, 'js', name), contents);
      } else if (id.endsWith('-local-version-guidance')) {
        fs.writeFileSync(path.join(context.projectDir, 'composer.json'), JSON.stringify({
          require: { 'laravel/framework': '^9.0' }, 'require-dev': { 'phpunit/phpunit': '^9.0' },
        }));
      }
      fixture.assert(context.run(fixture.entry, fixture.args), context);
      assert.strictEqual(context.hostStatus, 'NOT_RUN');
    });
  });
}
}


// --- skill-release-isolation ---
{
// All Git/GitHub effects are trusted fixture stubs; no commit, network, PR,
// tag, or publication occurs. The test author explicitly selects each phase.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerReleaseFixtures } = require('./_lib/skill-release-fixtures');
const fixtures = registerReleaseFixtures();

for (const id of ['release-unmerged-blocked', 'release-unrelated-change-blocked', 'release-prepare-explicit-files']) {
  test(id, () => {
    const fixture = fixtures[id];
    const logger = "const fs=require('fs'); const args=process.argv.slice(1); fs.appendFileSync('tool-log.jsonl',JSON.stringify({tool,args})+'\\n');";
    withIsolatedSkill({
      source: path.join(__dirname, '../skills/release-creator'),
      stubs: {
        git: { body: "const tool='git';" + logger
          + "if(args[0]==='status')process.stdout.write("
          + JSON.stringify(id === 'release-unrelated-change-blocked' ? ' M unrelated.txt\n' : ' M package.json\n')
          + "); if(args[0]==='diff'&&args.includes('--name-only'))process.stdout.write('package.json\\n');" },
        gh: { body: "const tool='gh';" + logger },
      },
    }, (context) => {
      fs.writeFileSync(path.join(context.projectDir, 'package.json'), '{"version":"1.2.3"}\n');
      fixture.assert(context.run(fixture.entry, fixture.args), context);
    });
  });
}
}


// --- skill-resume-family-isolation ---
{
// Raw-directory behavior tests for the resume helper migration. Canonical
// owner Skills and the synchronized resume copies are relocated into a fresh
// fixture project; no root helper path or peer Skill fallback is allowed.

const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerResumeFamilyFixtures } = require('./_lib/skill-resume-family-fixtures');

const ROOT = path.join(__dirname, '..');
const REGISTERED_FIXTURES = registerResumeFamilyFixtures();
const FIXTURES = Object.fromEntries(
  Object.entries(REGISTERED_FIXTURES).filter(([id]) => id.startsWith('resume-')),
);

function runResumeFixture(id) {
  const fixture = FIXTURES[id];
  assert.ok(fixture, `unknown resume-family fixture: ${id}`);
  const source = path.join(ROOT, 'skills', fixture.skill);
  return withIsolatedSkill({ source, stubs: fixture.stubs }, (context) => {
    fixture.prepare(context);
    try {
      const result = context.run(fixture.entry, fixture.args, { input: fixture.input });
      fixture.assert(result, context);
      return result;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        assert.fail(`skill-local resume entry is missing: ${fixture.skill}/${fixture.entry}`);
      }
      throw error;
    }
  });
}

test('resume-family registry exposes canonical owners and synchronized local entries', () => {
  const ids = Object.keys(FIXTURES).sort();
  assert.deepStrictEqual(ids, [
    'resume-detect-missing-handoff-save',
    'resume-detect-saved-old-resume',
    'resume-extract-compact-copy',
    'resume-extract-compact-owner',
    'resume-post-observation-copy-unavailable',
    'resume-post-observation-owner-unavailable',
    'resume-set-state-consuming',
    'resume-write-create-explicit',
    'resume-write-missing-leaf-claude-symlink',
    'resume-write-missing-leaf-dhpk-symlink',
    'resume-write-missing-leaf-explicit-symlink',
  ]);
  const expectedEntries = {
    'resume-detect-missing-handoff-save': ['opsx-apply-resume', 'scripts/detect-phase.sh'],
    'resume-detect-saved-old-resume': ['opsx-apply-resume', 'scripts/detect-phase.sh'],
    'resume-set-state-consuming': ['opsx-apply-resume', 'scripts/set-handoff-state.sh'],
    'resume-write-create-explicit': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-write-missing-leaf-claude-symlink': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-write-missing-leaf-dhpk-symlink': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-write-missing-leaf-explicit-symlink': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-extract-compact-owner': ['dhpk-opsx-load-context', 'scripts/extract-compact.sh'],
    'resume-extract-compact-copy': ['opsx-apply-resume', 'scripts/extract-compact.sh'],
    'resume-post-observation-owner-unavailable': ['dhpk-opsx-post-observation', 'scripts/post-obs.sh'],
    'resume-post-observation-copy-unavailable': ['opsx-apply-resume', 'scripts/post-obs.sh'],
  };
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    assert.deepStrictEqual([fixture.skill, fixture.entry], expectedEntries[id], id);
  }
});

test('local detect-phase reports Save for a missing handoff', () => {
  runResumeFixture('resume-detect-missing-handoff-save');
});

test('local detect-phase reports Resume for an old saved handoff', () => {
  runResumeFixture('resume-detect-saved-old-resume');
});

test('local set-handoff-state updates the explicit state field', () => {
  runResumeFixture('resume-set-state-consuming');
});

test('local write-handoff preserves the complete explicit payload', () => {
  runResumeFixture('resume-write-create-explicit');
});

test('local write-handoff rejects a missing leaf below a symlinked .dhpk parent', () => {
  runResumeFixture('resume-write-missing-leaf-dhpk-symlink');
});

test('local write-handoff rejects a missing leaf below a symlinked .claude parent', () => {
  runResumeFixture('resume-write-missing-leaf-claude-symlink');
});

test('local write-handoff rejects a missing leaf below an explicit symlinked parent', () => {
  runResumeFixture('resume-write-missing-leaf-explicit-symlink');
});

test('canonical load-context extractor emits compact JSON fields', () => {
  runResumeFixture('resume-extract-compact-owner');
});

test('resume Skill receives the synchronized compact extractor copy', () => {
  runResumeFixture('resume-extract-compact-copy');
});

test('canonical post-observation helper handles denied memory service safely', () => {
  runResumeFixture('resume-post-observation-owner-unavailable');
});

test('resume Skill receives the synchronized post-observation copy', () => {
  runResumeFixture('resume-post-observation-copy-unavailable');
});
}

run('skill-directory-isolation');
