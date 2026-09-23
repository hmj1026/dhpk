'use strict';

// RED contracts for the raw-directory Skill harness.  The helper modules are
// deliberately loaded lazily so the first run reports the missing public
// seams instead of turning the whole file into a module-loader/setup error.

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
  assert.strictEqual(typeof fixtureRegistry.registerFixture, 'function',
    'fixture registry must expose registerFixture(definition)');
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

test('isolation and fixture helper modules expose the agreed public seams', () => {
  assert.ifError(isolationLoadError);
  assert.ifError(fixtureRegistryLoadError);
  assert.strictEqual(typeof isolation.withIsolatedSkill, 'function');
  assert.strictEqual(typeof fixtureRegistry.registerFixture, 'function');
  const fixtures = registerFixtures();
  assert.strictEqual(fixtures.local.id, 'isolation-local-resource');
  assert.strictEqual(fixtures.tools.id, 'isolation-external-tools');
});

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

run('skill-directory-isolation');
