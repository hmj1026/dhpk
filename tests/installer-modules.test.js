'use strict';

// scripts/lib/installer-modules.js names the JS Codex/Cursor installer and its
// module closure, which a packaged harness-setup Skill ships as readable source
// files (no generated bundle) so it runs without a scripts/lib/ tree beside it.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectClosure, installerModuleIds, ENTRY, MAX_MODULE_BYTES, REPO_ROOT } = require('../scripts/lib/installer-modules');
const { fakePlugin } = require('./_lib/shared-projection-plugin');
const { installerEnv } = require('../scripts/lib/install-adapters/codex-cli');

const CHECK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'ci', 'check-installer-modules.js');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A tiny source tree whose modules the test controls.
function miniRoot(files) {
  const root = tempDir('dhpk-modules-root-');
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

test('testClosure_holdsTheInstallerEntryAndItsModulesAndNothingOutsideScripts', () => {
  const ids = installerModuleIds();
  assert.ok(ids.includes('scripts/lib/install-adapters/codex-cli.js'));
  assert.ok(ids.includes('scripts/lib/install-adapters/codex.js'));
  assert.ok(ids.includes('scripts/lib/project-agent-projection-publisher.js'), 'the Shared Project Projection publisher is part of the installer');
  assert.ok(ids.includes('scripts/lib/portable-skill-metadata.js'));
  assert.deepStrictEqual([...ids].sort(), ids, 'modules must be listed in path order');
  assert.ok(ids.every((id) => id.startsWith('scripts/')), ids.filter((id) => !id.startsWith('scripts/')).join(','));
});

test('testClosure_everyModuleIsReadableSizedSource', () => {
  for (const id of installerModuleIds()) {
    const size = fs.statSync(path.join(REPO_ROOT, id)).size;
    assert.ok(size <= MAX_MODULE_BYTES, `${id} is ${size} bytes, over the ${MAX_MODULE_BYTES}-byte module limit`);
  }
  assert.strictEqual(MAX_MODULE_BYTES, 256 * 1024);
});

test('testClosure_requiresOnlyRelativeModulesAndNodeBuiltins', () => {
  const specs = new Set();
  for (const record of collectClosure(REPO_ROOT, ENTRY)) {
    for (const match of record.source.matchAll(/\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g)) specs.add(match[2]);
  }
  assert.ok(specs.size > 0);
  for (const spec of specs) assert.ok(spec.startsWith('.') || spec.startsWith('node:'), `${spec} must be relative or a node: built-in`);
});

for (const [name, source, message] of [
  ['an external package', "require('left-pad');\n", /left-pad.*only relative modules and node: built-ins/],
  ['a computed require', "const name = './x';\nrequire(name);\n", /not a string literal/],
  ['require.resolve', "require.resolve('./x');\n", /not a string literal|does not resolve/],
  ['a dynamic import', "import('./x.js');\n", /dynamic import/],
  ['a missing relative module', "require('./missing');\n", /missing.*does not resolve/],
]) {
  test(`testClosure_${name.replace(/\W+/g, '')}_failsLoudly`, () => {
    const root = miniRoot({ 'scripts/entry.js': `'use strict';\n${source}` });
    try {
      assert.throws(() => installerModuleIds({ root, entry: 'scripts/entry.js' }), message);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('testClosure_resolvesRelativeSpecifiersDirectoriesJsonAndCycles', () => {
  const root = miniRoot({
    'scripts/entry.js': "'use strict';\nrequire('./lib/a');\nrequire('./lib/data.json');\nrequire('./lib');\n",
    'scripts/lib/a.js': "'use strict';\nrequire('./b');\n",
    'scripts/lib/b.js': "'use strict';\nrequire('./a');\n",
    'scripts/lib/data.json': '{"value": 42}\n',
    'scripts/lib/index.js': "'use strict';\n",
  });
  try {
    assert.deepStrictEqual(installerModuleIds({ root, entry: 'scripts/entry.js' }),
      ['scripts/entry.js', 'scripts/lib/a.js', 'scripts/lib/b.js', 'scripts/lib/data.json', 'scripts/lib/index.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testClosure_ignoresRequireTextInCommentsAndStrings', () => {
  const root = miniRoot({
    'scripts/entry.js': "'use strict';\n// require('left-pad') in a comment\n/* require(name) */\nconst text = \"require('left-pad')\";\nvoid text;\n",
  });
  try {
    assert.deepStrictEqual(installerModuleIds({ root, entry: 'scripts/entry.js' }), ['scripts/entry.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testClosure_leavesOutThePackagingPipeline', () => {
  const ids = installerModuleIds();
  for (const packaging of ['agent-plugin-package', 'marketplace-skill-content', 'installer-modules', 'platform-provenance', 'distribution-inventory']) {
    assert.ok(!ids.includes(`scripts/lib/${packaging}.js`), `${packaging} must not be part of the installer`);
  }
});

// The installer runs one program of its own at most: the Codex provider probe
// (codex.js) and the Python-compatible helpers it uses (python-compat.js).
test('testClosure_onlyTheProviderProbeModulesImportChildProcess', () => {
  const importers = collectClosure(REPO_ROOT, ENTRY)
    .filter((record) => /require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(record.source))
    .map((record) => record.id);
  assert.deepStrictEqual(importers, ['scripts/lib/install-adapters/codex.js', 'scripts/lib/install-adapters/python-compat.js']);
});

// The packaged layout: the closure copied as plain files at their scripts/lib/
// paths, alone on disk, installs a project through the real entry module.
test('testPackagedModules_installAProjectFromAnEmptyDirectory', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-modules-project-');
  const alone = tempDir('dhpk-modules-alone-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    for (const id of installerModuleIds()) {
      fs.mkdirSync(path.dirname(path.join(alone, id)), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, id), path.join(alone, id));
    }
    const env = installerEnv({ host: 'codex', pluginRoot: plugin, projectRoot: project, mode: 'copy', modeExplicit: true, baseEnv: { PATH: process.env.PATH } });
    const result = spawnSync(process.execPath, [path.join(alone, ENTRY)], { cwd: project, env, encoding: 'utf8', timeout: 60_000 });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')), 'the Shared Project Projection is published by the shipped publisher');
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-install.lock')), false, 'the project lock is released');
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-projection-journal.json')), false, 'the Projection Journal is gone after the commit');
  } finally {
    for (const directory of [plugin, project, alone]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('testCheck_passesOnTheRepository', () => {
  const result = spawnSync(process.execPath, [CHECK_SCRIPT, '--check'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /check-installer-modules: ok/);
});

test('testCheck_rejectsBadUsage', () => {
  const result = spawnSync(process.execPath, [CHECK_SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(result.status, 2, result.stderr);
});

run('installer-modules');
