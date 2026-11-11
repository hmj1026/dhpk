'use strict';

// js-projection-journal stage 4: the JS adapter must leave the same exit
// status, output, project tree, and receipt as the Python installer when it
// runs as the Cursor harness installer (scripts/hooks/install-cursor-harness.sh).
// Mirrors tests/install-codex-parity.test.js with `.cursor` paths. Every
// scenario first runs Python twice to prove the harness normalizes away
// run-specific values; scenarios marked `js` then compare Python against JS.
// Each run gets an isolated HOME because the Cursor `--plan --json` report
// reads ~/.cursor/plugins for marketplace hash-cache drift.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compareEngines, runEngine } = require('./_lib/installer-parity');
const { projectRoot } = require('./_lib/install-codex-skills-fixtures');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-cursor-harness.sh');
const SKILLS = ['code-trace', 'tdd-workflow', 'flow-guide'];
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A small plugin checkout: three Cursor skills, one agent, one rule, one
// command, an inventory, and the files the installer reads besides them.
function fakePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-parity-plugin-')));
  for (const name of SKILLS) {
    write(path.join(plugin, 'cursor', 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Parity fixture ${name}.\n---\n\nFixture skill.\n`);
  }
  write(path.join(plugin, 'cursor', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Parity fixture agent.\nmodel: inherit\nreadonly: true\n---\n# Reviewer\n');
  write(path.join(plugin, 'cursor', 'rules', 'prefer-const.mdc'), '---\ndescription: Parity fixture rule.\nalwaysApply: false\n---\n# Prefer const\n');
  write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: Parity fixture command.\n---\n# Review\n');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'), path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'));
  write(path.join(plugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
    skills: SKILLS.map((name) => ({
      id: name === 'tdd-workflow' ? 'tdd' : name,
      name,
      path: `skills/${name}`,
      legacy_names: [],
      lifecycle: 'promoted',
      invokable: true,
      profiles: [],
      surfaces: ['cursor-sync'],
    })),
    supporting_assets: [],
  }, null, 2));
  return plugin;
}

function runCursor(project, args, pluginRoot, envOverrides = {}) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...envOverrides },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

// `setupEngine` pins the setup steps to one engine, so a step can be compared
// under JS before the steps that prepare it are ported. `home` seeds the
// isolated HOME directory.
function fixture(setup = () => {}, { setupEngine = null } = {}) {
  return (engine) => {
    const project = projectRoot();
    const pluginRoot = fakePlugin();
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-parity-home-')));
    const step = (args) => {
      const result = runCursor(project, args, pluginRoot, { HOME: home, DHPK_INSTALLER_ENGINE: setupEngine || engine });
      assert.ok([0, 1].includes(result.status), `setup ${args.join(' ')} failed under ${engine}: ${result.stdout}\n${result.stderr}`);
      return result;
    };
    setup({ project, pluginRoot, home, step });
    return {
      project,
      pluginRoot,
      home,
      run: (dir, args, plugin, env) => runCursor(dir, args, plugin, { ...env, HOME: home }),
      cleanup: () => {
        for (const dir of [project, pluginRoot, home]) fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  };
}

function seedCache(home, version) {
  write(path.join(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', 'hash1', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version }));
}

const SCENARIOS = [
  { name: 'copy install', prepare: fixture(), args: ['--copy', '--force'], js: true },
  { name: 'symlink install', prepare: fixture(), args: ['--force'], js: true },
  { name: 'rerun is up to date', prepare: fixture(({ step }) => step(['--copy', '--force'])), args: ['--copy', '--force'], js: true },
  {
    name: 'update after a source change',
    prepare: fixture(({ pluginRoot, step }) => {
      step(['--copy', '--force']);
      fs.appendFileSync(path.join(pluginRoot, 'cursor', 'skills', 'flow-guide', 'SKILL.md'), '\nChanged.\n');
    }),
    args: ['--copy', '--update', '--force'],
    js: true,
  },
  { name: 'uninstall', prepare: fixture(({ step }) => step(['--copy', '--force'])), args: ['--uninstall', '--force'], js: true },
  {
    name: 'plan json with drift',
    prepare: fixture(({ pluginRoot, step }) => {
      step(['--copy', '--force']);
      fs.appendFileSync(path.join(pluginRoot, 'cursor', 'skills', 'code-trace', 'SKILL.md'), '\nDrift.\n');
    }, { setupEngine: 'python' }),
    args: ['--plan', '--json', '--copy', '--force'],
    js: true,
  },
  { name: 'plan json on an empty project', prepare: fixture(), args: ['--plan', '--json', '--force'], js: true },
  {
    name: 'plan text with a collision',
    prepare: fixture(({ project }) => {
      write(path.join(project, '.cursor', 'skills', 'code-trace', 'user-owned.txt'), 'keep me\n');
    }),
    args: ['--plan', '--force'],
    js: true,
  },
  {
    name: 'plan json reports a marketplace hash cache that drifted from the plugin version',
    prepare: fixture(({ home }) => seedCache(home, '0.0.1-stale')),
    args: ['--plan', '--json', '--force'],
    js: true,
  },
  {
    name: 'plan json stays silent when the marketplace hash cache matches the plugin version',
    prepare: fixture(({ home }) => seedCache(home, PLUGIN_VERSION)),
    args: ['--plan', '--json', '--force'],
    js: true,
  },
  {
    name: 'plan json for the full repository',
    prepare: (engine) => {
      const project = projectRoot();
      const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-parity-home-')));
      return {
        project,
        pluginRoot: ROOT,
        home,
        engine,
        run: (dir, args, plugin, env) => runCursor(dir, args, plugin, { ...env, HOME: home }),
        cleanup: () => {
          fs.rmSync(project, { recursive: true, force: true });
          fs.rmSync(home, { recursive: true, force: true });
        },
      };
    },
    args: ['--plan', '--json', '--force'],
    js: true,
  },
  {
    name: 'version boundary blocks a receipt without the tree marker',
    prepare: fixture(({ project, step }) => {
      step(['--copy', '--force']);
      const receiptPath = path.join(project, '.cursor', '.dhpk-installed.json');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      delete receipt.fingerprint_algorithm;
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }, { setupEngine: 'python' }),
    args: ['--copy', '--update', '--force'],
    js: true,
  },
  {
    name: 'version boundary blocks an unknown algorithm before uninstall',
    prepare: fixture(({ project, step }) => {
      step(['--copy', '--force']);
      const receiptPath = path.join(project, '.cursor', '.dhpk-installed.json');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.fingerprint_algorithm = 'sha1-tree';
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }, { setupEngine: 'python' }),
    args: ['--uninstall', '--force'],
    js: true,
  },
  {
    name: 'unowned collision on update',
    prepare: fixture(({ project }) => {
      write(path.join(project, '.cursor', 'skills', 'code-trace', 'user-owned.txt'), 'keep me\n');
    }),
    args: ['--copy', '--update', '--force'],
    js: true,
  },
  {
    name: 'adopting an unmanaged rule',
    prepare: fixture(({ project }) => {
      write(path.join(project, '.cursor', 'rules', 'prefer-const.mdc'), '---\ndescription: Parity fixture rule.\nalwaysApply: false\n---\n# Prefer const\n');
    }),
    args: ['--copy', '--migrate', '--force'],
    js: true,
  },
  {
    name: 'full repository install',
    prepare: (engine) => {
      const project = projectRoot();
      const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-parity-home-')));
      return {
        project,
        pluginRoot: ROOT,
        home,
        engine,
        run: (dir, args, plugin, env) => runCursor(dir, args, plugin, { ...env, HOME: home }),
        cleanup: () => {
          fs.rmSync(project, { recursive: true, force: true });
          fs.rmSync(home, { recursive: true, force: true });
        },
      };
    },
    args: ['--copy', '--force'],
    js: true,
  },
];

for (const scenario of SCENARIOS) {
  test(`testCursorParityHarness_${scenario.name}_pythonTwiceIsIdentical`, () => {
    const outcome = compareEngines(scenario.prepare, scenario.args, { engines: ['python', 'python'] });
    assert.strictEqual(outcome.difference, null, outcome.difference);
  });
  if (scenario.js) {
    test(`testCursorParity_${scenario.name}_jsMatchesPython`, () => {
      const outcome = compareEngines(scenario.prepare, scenario.args);
      assert.strictEqual(outcome.difference, null, outcome.difference);
    });
  }
}

// Guards the two cache scenarios: the drift one must really carry the warning
// and the matching one must not, so parity compares something.
test('testCursorParity_cacheScenariosExerciseTheWarning', () => {
  const drift = SCENARIOS.find((scenario) => /drifted/.test(scenario.name));
  const silent = SCENARIOS.find((scenario) => /silent/.test(scenario.name));
  const warnings = (scenario) => JSON.parse(runEngine('python', scenario.prepare, scenario.args).stdout).warnings;
  assert.deepStrictEqual(warnings(drift).map((item) => item.code), ['cursor_marketplace_hash_cache_drift']);
  assert.deepStrictEqual(warnings(silent), []);
});

run('install-cursor-parity');
