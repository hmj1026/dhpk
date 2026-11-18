'use strict';

// dhpk-stacks is the second plugin in the dhpk marketplace. It requires core,
// owns the `modules` setting, and ships the stack modules the core Directory
// Plugin no longer carries. The seam is the built package on disk and the
// hooks it registers.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');
const generator = require('../scripts/ci/gen-claude-marketplace-package');
const { checkDirectoryPlugin } = require('../scripts/lib/publication-conformance');
const { declaredOutputs, undeclaredManifests } = require('../scripts/lib/host-manifests');

const ROOT = path.join(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'));
const MARKETPLACE = readJson(ROOT, '.claude-plugin', 'marketplace.json');
const COMMITTED_CORE = path.join(ROOT, 'generated', 'claude-marketplace', 'package');
const COMMITTED_STACKS = path.join(ROOT, 'generated', 'claude-marketplace', 'stacks-package');

let builtStacks = null;
function stacksPackage() {
  if (!builtStacks) {
    builtStacks = path.join(makeTempDir('dhpk-stacks-pkg-'), 'package');
    generator.materialize({ out: builtStacks, kind: 'stacks' });
  }
  return builtStacks;
}

function readTree(directory) {
  const files = new Map();
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else files.set(rel, fs.readFileSync(path.join(current, entry.name)));
    }
  };
  walk(directory, '');
  return files;
}

test('the marketplace lists dhpk-stacks beside core and the stacks entry requires core', () => {
  const names = MARKETPLACE.plugins.map((plugin) => plugin.name);
  assert.deepStrictEqual(names, ['dhpk', 'dhpk-stacks']);
  const stacks = MARKETPLACE.plugins.find((plugin) => plugin.name === 'dhpk-stacks');
  assert.strictEqual(stacks.source, './generated/claude-marketplace/stacks-package');
  assert.deepStrictEqual(stacks.dependencies, ['dhpk']);
  assert.ok(fs.existsSync(path.join(ROOT, stacks.source, '.claude-plugin', 'plugin.json')));
});

test('the stacks manifest depends on core, owns modules, and tracks the package version', () => {
  const manifest = readJson(stacksPackage(), '.claude-plugin', 'plugin.json');
  assert.strictEqual(manifest.name, 'dhpk-stacks');
  assert.deepStrictEqual(manifest.dependencies, ['dhpk']);
  assert.strictEqual(manifest.version, VERSION);
  assert.ok(manifest.userConfig.modules, 'dhpk-stacks must declare the modules setting');
  assert.ok(manifest.userConfig.js_lint_script, 'module tool settings move with modules');
});

test('the core manifest no longer owns modules or module tool settings', () => {
  const core = readJson(ROOT, '.claude-plugin', 'plugin.json');
  const stacks = readJson(stacksPackage(), '.claude-plugin', 'plugin.json');
  for (const key of Object.keys(stacks.userConfig)) {
    assert.ok(!(key in core.userConfig), `core must not declare '${key}'`);
  }
  assert.ok(!(core.commands || []).some((entry) => entry.includes('modules/')));
  assert.ok(!(core.agents || []).some((entry) => entry.includes('modules/')));
});

const STACK_SKILLS = ['swift', 'php', 'laravel', 'yii1', 'js-static-checks', 'python', 'react', 'nextjs'];

test('the eight stack skills ship in dhpk-stacks as top-level skills and not in core', () => {
  const stacks = readTree(COMMITTED_STACKS);
  const core = readTree(COMMITTED_CORE);
  for (const id of STACK_SKILLS) {
    const entry = stacks.get(`skills/${id}/SKILL.md`);
    assert.ok(entry, `${id} must be a top-level skill in dhpk-stacks`);
    assert.ok(new RegExp(`^name: ${id}$`, 'm').test(entry.toString('utf8')), `${id} frontmatter name`);
    assert.ok(![...core.keys()].some((file) => file.startsWith(`skills/flow-drive/references/${id}/`)), `${id} must not ship in core`);
  }
  assert.ok(core.has('skills/flow-drive/SKILL.md'), 'flow-drive itself stays in core');
  assert.ok(core.has('skills/flow-drive/references/vue-2-notes/SKILL.md'), 'other flow-drive branches stay in core');
});

test('core skills never link a stack skill path, so core works without dhpk-stacks', () => {
  const core = readTree(COMMITTED_CORE);
  const linked = [...core].filter(([file, bytes]) => file.startsWith('skills/') && file.endsWith('.md')
    && STACK_SKILLS.some((id) => bytes.toString('utf8').includes(`flow-drive/references/${id}/`)));
  assert.deepStrictEqual(linked.map(([file]) => file), []);
});

test('the core Directory Plugin carries no stack modules and the stacks package carries them', () => {
  assert.ok(!fs.existsSync(path.join(COMMITTED_CORE, 'modules')), 'core package must not contain modules/');
  const files = readTree(stacksPackage());
  for (const module of ['js', 'python', 'php-7.4', 'xcode-tooling', 'library-author']) {
    assert.ok(files.has(`modules/${module}/module.yaml`), `stacks package must contain modules/${module}`);
  }
});

test('every path the stacks manifest registers exists in the package', () => {
  const root = stacksPackage();
  const manifest = readJson(root, '.claude-plugin', 'plugin.json');
  for (const entry of [...manifest.agents, ...manifest.commands]) {
    assert.ok(fs.existsSync(path.join(root, entry)), `missing ${entry}`);
  }
  const hooks = readJson(root, 'hooks', 'hooks.json');
  const commands = Object.values(hooks.hooks).flat().flatMap((group) => group.hooks);
  assert.ok(commands.length > 0);
  for (const hook of commands) {
    for (const arg of hook.args) {
      const resolved = arg.replace('${CLAUDE_PLUGIN_ROOT}', root);
      assert.ok(fs.existsSync(resolved), `hook script missing: ${arg}`);
    }
  }
});

test('the stacks package passes the Directory Plugin conformance rules', () => {
  const errors = checkDirectoryPlugin(readTree(stacksPackage()), { version: VERSION });
  assert.deepStrictEqual(errors, []);
});

test('the committed stacks package matches a fresh build and registers its manifests', () => {
  assert.deepStrictEqual(generator.check({ out: COMMITTED_STACKS, kind: 'stacks' }).ok, true);
  const declared = declaredOutputs().map((output) => output.path);
  assert.ok(declared.includes('generated/claude-marketplace/stacks-package/.claude-plugin/plugin.json'));
  assert.ok(declared.includes('distribution/stacks-plugin/plugin.json'));
  assert.deepStrictEqual(undeclaredManifests(ROOT), []);
});

test('harness-setup tells the operator to install dhpk-stacks from this marketplace when a stack is detected', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'skills', 'harness-setup', 'references', 'claude-setup.md'), 'utf8');
  assert.ok(guide.includes(`/plugin install dhpk-stacks@${MARKETPLACE.name}`), 'install hint must name the marketplace');
  assert.ok(guide.includes('pluginConfigs["dhpk-stacks@dhpk"]'), 'modules must be written under the dhpk-stacks namespace');
});

// ---- hooks: run the built package's dispatcher against a throwaway module ----

function installFakeModule(root, name, hookFile, body) {
  const dir = path.join(root, 'modules', name, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'modules', name, 'module.yaml'), `name: ${name}\ndisplay_name: "Fake ${name}"\nrequires: []\n`);
  fs.writeFileSync(path.join(dir, hookFile), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function runHook(script, { modules, command, project } = {}) {
  const root = stacksPackage();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project || makeTempDir('dhpk-stacks-proj-') };
  delete env.CLAUDE_PLUGIN_OPTION_MODULES;
  delete env.DHPK_ACTIVE_MODULES;
  if (modules !== undefined) env.CLAUDE_PLUGIN_OPTION_MODULES = modules;
  const input = command === undefined ? '' : JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  return spawnSync('bash', [path.join(root, 'scripts', 'hooks', script)], { input, encoding: 'utf8', env, timeout: 30000 });
}

test('testStacksBashDispatch_noModulesEnabled_allowsTheCommand', () => {
  installFakeModule(stacksPackage(), 'zz-gate', 'pre-commit-gate.sh', 'exit 1');
  const result = runHook('stacks-pre-bash-dispatch.sh', { command: 'git commit -m x' });
  assert.strictEqual(result.status, 0, result.stderr);
});

test('testStacksBashDispatch_enabledModuleGateFailsOnCommit_blocksWithExit2', () => {
  installFakeModule(stacksPackage(), 'zz-gate', 'pre-commit-gate.sh', 'echo gate-failed >&2; exit 1');
  const result = runHook('stacks-pre-bash-dispatch.sh', { modules: 'zz-gate', command: 'git commit -m x' });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /gate-failed/);
});

test('testStacksBashDispatch_commitGateSkippedForNonCommitCommands', () => {
  installFakeModule(stacksPackage(), 'zz-gate', 'pre-commit-gate.sh', 'exit 1');
  const result = runHook('stacks-pre-bash-dispatch.sh', { modules: 'zz-gate', command: 'ls -la' });
  assert.strictEqual(result.status, 0, result.stderr);
});

test('testStacksBashDispatch_modulesFromProjectDhpkStacksOptions_areHonored', () => {
  installFakeModule(stacksPackage(), 'zz-gate', 'pre-commit-gate.sh', 'exit 1');
  const project = makeTempDir('dhpk-stacks-proj-');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'),
    JSON.stringify({ pluginConfigs: { 'dhpk-stacks@dhpk': { options: { modules: 'zz-gate' } } } }));
  const result = runHook('stacks-pre-bash-dispatch.sh', { project, command: 'git commit -m x' });
  assert.strictEqual(result.status, 2, result.stderr);
});

test('testStacksSessionStart_listsEnabledModulesAndWarnsOnUnknownOnes', () => {
  const result = runHook('stacks-session-start.sh', { modules: 'js,not-a-module' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /module enabled: js/);
  assert.match(result.stderr, /module 'not-a-module' not found/);
});

test('testStacksSessionStart_noModules_isSilent', () => {
  const result = runHook('stacks-session-start.sh', {});
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

run('stacks-plugin-package');
