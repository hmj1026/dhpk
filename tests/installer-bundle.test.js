'use strict';

// scripts/lib/installer-bundle.js embeds the JS Codex/Cursor installer and its
// module closure in one generated file, so a packaged harness-setup Skill runs
// the installer without a scripts/lib/ tree beside it.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildInstallerBundle, collectClosure, ENTRY, REPO_ROOT } = require('../scripts/lib/installer-bundle');
const { fakePlugin } = require('./_lib/shared-projection-plugin');
const { installerEnv } = require('../scripts/lib/install-adapters/codex-cli');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A tiny source tree whose modules the test controls.
function miniRoot(files) {
  const root = tempDir('dhpk-bundle-root-');
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

function runBundle(root, entry) {
  const dir = tempDir('dhpk-bundle-run-');
  try {
    const file = path.join(dir, 'bundle.cjs');
    fs.writeFileSync(file, buildInstallerBundle({ root, entry }));
    return spawnSync(process.execPath, [file], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('testBuild_isByteIdenticalAcrossRuns', () => {
  assert.strictEqual(buildInstallerBundle(), buildInstallerBundle());
});

test('testBuild_holdsTheInstallerEntryAndItsClosureAndNothingOutsideScripts', () => {
  const ids = collectClosure(REPO_ROOT, ENTRY).map((record) => record.id);
  assert.ok(ids.includes('scripts/lib/install-adapters/codex-cli.js'));
  assert.ok(ids.includes('scripts/lib/install-adapters/codex.js'));
  assert.ok(ids.includes('scripts/lib/project-agent-projection-publisher.js'), 'the Shared Project Projection publisher is part of the installer');
  assert.ok(ids.includes('scripts/lib/portable-skill-metadata.js'));
  assert.deepStrictEqual([...ids].sort(), ids, 'modules must be emitted in path order');
  assert.ok(ids.every((id) => id.startsWith('scripts/')), ids.filter((id) => !id.startsWith('scripts/')).join(','));
});

test('testBuild_requiresOnlyNodeBuiltinsAtRunTime', () => {
  const bundle = buildInstallerBundle();
  const specs = new Set([...bundle.matchAll(/\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g)].map((match) => match[2]).filter((spec) => !spec.startsWith('.')));
  assert.ok(specs.size > 0);
  for (const spec of specs) assert.match(spec, /^node:/, `${spec} must be a node: built-in`);
});

test('testBundle_installsAProjectFromAnEmptyDirectory', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-bundle-project-');
  const alone = tempDir('dhpk-bundle-alone-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    fs.writeFileSync(path.join(alone, 'dhpk-installer.cjs'), buildInstallerBundle());
    const env = installerEnv({ host: 'codex', pluginRoot: plugin, projectRoot: project, mode: 'copy', modeExplicit: true, baseEnv: { PATH: process.env.PATH } });
    const result = spawnSync(process.execPath, [path.join(alone, 'dhpk-installer.cjs')], { cwd: project, env, encoding: 'utf8', timeout: 60_000 });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')), 'the Shared Project Projection is published by the bundled publisher');
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-install.lock')), false, 'the project lock is released');
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-projection-journal.json')), false, 'the Projection Journal is gone after the commit');
  } finally {
    for (const directory of [plugin, project, alone]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('testBundle_runsTheEntryAsTheMainModuleAndOthersAsLibraries', () => {
  const root = miniRoot({
    'scripts/entry.js': "'use strict';\nconst helper = require('./helper');\nprocess.stdout.write(`main=${require.main === module} helper=${helper.isMain}\\n`);\n",
    'scripts/helper.js': "'use strict';\nmodule.exports = { isMain: require.main === module };\nif (require.main === module) process.stdout.write('helper ran as main\\n');\n",
  });
  try {
    const result = runBundle(root, 'scripts/entry.js');
    assert.strictEqual(result.stdout, 'main=true helper=false\n', result.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testBundle_resolvesRelativeSpecifiersDirectoriesJsonAndCycles', () => {
  const root = miniRoot({
    'scripts/entry.js': "'use strict';\nconst a = require('./lib/a');\nconst data = require('./lib/data.json');\nconst pkg = require('./lib');\nprocess.stdout.write(`${a.name} ${a.peerName()} ${data.value} ${pkg.index}\\n`);\n",
    'scripts/lib/a.js': "'use strict';\nconst b = require('./b');\nmodule.exports = { name: 'a', peerName: () => b.name };\n",
    'scripts/lib/b.js': "'use strict';\nconst a = require('./a');\nmodule.exports = { name: 'b', ownerSeen: typeof a };\n",
    'scripts/lib/data.json': '{"value": 42}\n',
    'scripts/lib/index.js': "'use strict';\nmodule.exports = { index: 'idx' };\n",
  });
  try {
    const result = runBundle(root, 'scripts/entry.js');
    assert.strictEqual(result.stdout, 'a b 42 idx\n', result.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testBundle_stripsAShebangAndKeepsNodeBuiltinsReal', () => {
  const root = miniRoot({
    'scripts/entry.js': "#!/usr/bin/env node\n'use strict';\nconst os = require('node:os');\nconst path = require('path');\nprocess.stdout.write(`${typeof os.tmpdir()} ${path.sep}\\n`);\n",
  });
  try {
    assert.strictEqual(runBundle(root, 'scripts/entry.js').stdout, `string ${path.sep}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testBundle_givesModulesAVirtualDirnameThatNeverTouchesDisk', () => {
  const root = miniRoot({
    'scripts/entry.js': "'use strict';\nprocess.stdout.write(`${__dirname}|${require('fs').existsSync(__dirname)}\\n`);\n",
  });
  try {
    assert.strictEqual(runBundle(root, 'scripts/entry.js').stdout, '/dhpk-installer-bundle/scripts|false\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, source, message] of [
  ['an external package', "require('left-pad');\n", /left-pad.*only relative modules and node: built-ins/],
  ['a computed require', "const name = './x';\nrequire(name);\n", /not a string literal/],
  ['require.resolve', "require.resolve('./x');\n", /not a string literal|does not resolve/],
  ['a dynamic import', "import('./x.js');\n", /dynamic import/],
  ['a missing relative module', "require('./missing');\n", /missing.*does not resolve/],
]) {
  test(`testBuild_${name.replace(/\W+/g, '')}_failsLoudly`, () => {
    const root = miniRoot({ 'scripts/entry.js': `'use strict';\n${source}` });
    try {
      assert.throws(() => buildInstallerBundle({ root, entry: 'scripts/entry.js' }), message);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('testBuild_ignoresRequireTextInCommentsAndStrings', () => {
  const root = miniRoot({
    'scripts/entry.js': "'use strict';\n// require('left-pad') in a comment\n/* require(name) */\nconst text = \"require('left-pad')\";\nprocess.stdout.write(text.length > 0 ? 'ok\\n' : '');\n",
  });
  try {
    assert.strictEqual(runBundle(root, 'scripts/entry.js').stdout, 'ok\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testBuild_closureLeavesOutThePackagingPipeline', () => {
  const ids = collectClosure(REPO_ROOT, ENTRY).map((record) => record.id);
  for (const packaging of ["agent-plugin-package", "marketplace-skill-content", "installer-bundle", "platform-provenance", "distribution-inventory"]) {
    assert.ok(!ids.includes(`scripts/lib/${packaging}.js`), `${packaging} must not be part of the installer`);
  }
});

// The installer runs one program of its own at most: the Codex provider probe
// (codex.js) and the Python-compatible helpers it uses (python-compat.js).
test('testBuild_onlyTheProviderProbeModulesImportChildProcess', () => {
  const importers = collectClosure(REPO_ROOT, ENTRY)
    .filter((record) => /require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(record.source))
    .map((record) => record.id);
  assert.deepStrictEqual(importers, ['scripts/lib/install-adapters/codex.js', 'scripts/lib/install-adapters/python-compat.js']);
});

for (const [name, spec] of [['a sibling file', './sneaky'], ['a package', 'left-pad'], ['an absolute path', '/etc/hosts']]) {
  test(`testBundle_runtimeFallback_refuses${name.replace(/\W+/g, '')}`, () => {
    const root = miniRoot({ 'scripts/entry.js': "'use strict';\nrequire('node:fs');\nprocess.stdout.write('reached\\n');\n" });
    const dir = tempDir('dhpk-bundle-fallback-');
    try {
      // Edit the built bundle after the fact: the build itself would refuse this.
      const bundle = buildInstallerBundle({ root, entry: 'scripts/entry.js' }).replace("require('node:fs')", `require(${JSON.stringify(spec)})`);
      fs.writeFileSync(path.join(dir, 'bundle.cjs'), bundle);
      fs.writeFileSync(path.join(dir, 'sneaky.js'), "process.stdout.write('sneaky ran\\n');\n");
      const result = spawnSync(process.execPath, [path.join(dir, 'bundle.cjs')], { cwd: dir, encoding: 'utf8' });
      assert.notStrictEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /sneaky ran|reached/);
      assert.match(result.stderr, /neither bundled nor a Node built-in/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('testGenerator_check_passesOnTheRepository', () => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'ci', 'gen-installer-bundle.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /gen-installer-bundle: ok/);
});

test('testGenerator_out_writesTheBundleAndRejectsBadUsage', () => {
  const dir = tempDir('dhpk-bundle-out-');
  try {
    const out = path.join(dir, 'installer.cjs');
    const written = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'ci', 'gen-installer-bundle.js'), '--out', out], { encoding: 'utf8' });
    assert.strictEqual(written.status, 0, written.stderr);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), buildInstallerBundle());
    for (const args of [[], ['--check', '--out', out], ['--bogus']]) {
      const bad = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'ci', 'gen-installer-bundle.js'), ...args], { encoding: 'utf8' });
      assert.strictEqual(bad.status, 2, `${args.join(' ')}: ${bad.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('installer-bundle');
