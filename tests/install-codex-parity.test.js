'use strict';

// js-projection-journal stage 3 (task 3.1): the JS Codex adapter must leave
// the same exit status, output, project tree, and receipt as the Python
// installer on the same fixture. Every scenario first runs Python twice to
// prove the harness normalizes away run-specific values; scenarios marked
// `js` then compare Python against the JS adapter.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareEngines } = require('./_lib/installer-parity');
const { projectRoot, runInstaller } = require('./_lib/install-codex-skills-fixtures');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = ['code-trace', 'tdd-workflow', 'flow-guide'];

// A small plugin checkout: three Codex skills, one agent, an inventory, and
// the files the installer reads besides them.
function fakePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parity-plugin-')));
  for (const name of SKILLS) {
    const skill = path.join(plugin, 'codex', 'skills', name);
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: ${name}\ndescription: Parity fixture ${name}.\n---\n\nFixture skill.\n`);
  }
  const agents = path.join(plugin, 'codex', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'reviewer.toml'), 'name = "reviewer"\ndescription = "Parity fixture agent."\n');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'), path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'));
  fs.mkdirSync(path.join(plugin, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
    skills: SKILLS.map((name) => ({
      id: name === 'tdd-workflow' ? 'tdd' : name,
      name,
      path: `skills/${name}`,
      legacy_names: [],
      lifecycle: 'promoted',
      invokable: true,
      profiles: [],
      surfaces: ['codex-native', 'codex-sync'],
    })),
    supporting_assets: [],
  }, null, 2));
  return plugin;
}

// `setupEngine` pins the setup steps to one engine, so a step can be
// compared under JS before the steps that prepare it are ported.
function fixture(setup = () => {}, { setupEngine = null } = {}) {
  return (engine) => {
    const project = projectRoot();
    const pluginRoot = fakePlugin();
    const step = (args) => {
      const result = runInstaller(project, args, pluginRoot, { DHPK_INSTALLER_ENGINE: setupEngine || engine });
      assert.ok([0, 1].includes(result.status), `setup ${args.join(' ')} failed under ${engine}: ${result.stdout}\n${result.stderr}`);
      return result;
    };
    setup({ project, pluginRoot, step });
    return {
      project,
      pluginRoot,
      cleanup: () => {
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(pluginRoot, { recursive: true, force: true });
      },
    };
  };
}

const SCENARIOS = [
  { name: 'copy install', prepare: fixture(), args: ['--copy', '--force'], js: true },
  { name: 'symlink install', prepare: fixture(), args: ['--force'], js: true },
  { name: 'rerun is up to date', prepare: fixture(({ step }) => step(['--copy', '--force'])), args: ['--copy', '--force'], js: true },
  {
    name: 'update after a source change',
    prepare: fixture(({ pluginRoot, step }) => {
      step(['--copy', '--force']);
      fs.appendFileSync(path.join(pluginRoot, 'codex', 'skills', 'flow-guide', 'SKILL.md'), '\nChanged.\n');
    }),
    args: ['--copy', '--update', '--force'],
    js: true,
  },
  { name: 'uninstall', prepare: fixture(({ step }) => step(['--copy', '--force'])), args: ['--uninstall', '--force'], js: true },
  {
    name: 'plan json with drift',
    prepare: fixture(({ pluginRoot, step }) => {
      step(['--copy', '--force']);
      fs.appendFileSync(path.join(pluginRoot, 'codex', 'skills', 'code-trace', 'SKILL.md'), '\nDrift.\n');
    }, { setupEngine: 'python' }),
    args: ['--plan', '--json', '--copy', '--force'],
    js: true,
  },
  { name: 'plan json on an empty project', prepare: fixture(), args: ['--plan', '--json', '--force'], js: true },
  {
    name: 'plan text with a collision',
    prepare: fixture(({ project }) => {
      const target = path.join(project, '.codex', 'skills', 'code-trace');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');
    }),
    args: ['--plan', '--force'],
    js: true,
  },
  {
    name: 'plan json for the full repository',
    prepare: (engine) => {
      const project = projectRoot();
      return { project, pluginRoot: ROOT, engine, cleanup: () => fs.rmSync(project, { recursive: true, force: true }) };
    },
    args: ['--plan', '--json', '--force'],
    js: true,
  },
  {
    name: 'version boundary blocks a receipt without the tree marker',
    prepare: fixture(({ project, step }) => {
      step(['--copy', '--force']);
      const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
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
      const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
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
      const target = path.join(project, '.codex', 'skills', 'code-trace');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');
    }),
    args: ['--copy', '--update', '--force'],
    js: true,
  },
  {
    name: 'full repository install',
    prepare: (engine) => {
      const project = projectRoot();
      return { project, pluginRoot: ROOT, engine, cleanup: () => fs.rmSync(project, { recursive: true, force: true }) };
    },
    args: ['--copy', '--force'],
    js: true,
  },
];

for (const scenario of SCENARIOS) {
  test(`testParityHarness_${scenario.name}_pythonTwiceIsIdentical`, () => {
    const outcome = compareEngines(scenario.prepare, scenario.args, { engines: ['python', 'python'] });
    assert.strictEqual(outcome.difference, null, outcome.difference);
  });
  if (scenario.js) {
    test(`testParity_${scenario.name}_jsMatchesPython`, () => {
      const outcome = compareEngines(scenario.prepare, scenario.args);
      assert.strictEqual(outcome.difference, null, outcome.difference);
    });
  }
}

test('testEngineSwitch_rejectsUnknownEngine', () => {
  const project = projectRoot();
  try {
    const result = runInstaller(project, ['--copy', '--force'], ROOT, { DHPK_INSTALLER_ENGINE: 'ruby' });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /unknown DHPK_INSTALLER_ENGINE: ruby/);
    assert.strictEqual(fs.existsSync(path.join(project, '.codex')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

run('install-codex-parity');
