'use strict';

// js-projection-journal stage 5 (task 5.1): install-codex-skills.sh and
// install-cursor-harness.sh only parse options and exec the JS installer. The
// golden table in tests/install-shell-entry-parity.test.js pins what they do;
// this pins what they are.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fakePlugin } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN } = require('./_lib/install-codex-skills-fixtures');
const { buildInstallerBundle } = require('../scripts/lib/installer-bundle');

const HOOKS = path.join(__dirname, '..', 'scripts', 'hooks');
const SCRIPTS = { codex: path.join(HOOKS, 'install-codex-skills.sh'), cursor: path.join(HOOKS, 'install-cursor-harness.sh') };
const FLAGS = ['--copy', '--update', '--migrate', '--plan', '--json', '--adopt', '--skill', '--uninstall', '--recover', '--force'];

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

for (const [host, script] of Object.entries(SCRIPTS)) {
  test(`testShell_${host}_isUnder150LinesAndMentionsNoPython`, () => {
    const text = fs.readFileSync(script, 'utf8');
    assert.ok(text.split('\n').length <= 150, `${path.basename(script)} has ${text.split('\n').length} lines`);
    assert.doesNotMatch(text, /python/i);
  });

  test(`testShell_${host}_helpPrintsTheWholeUsageBlock`, () => {
    const result = spawnSync('bash', [script, '--help'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const lines = result.stdout.split('\n').filter((line) => line.length > 0);
    // Every printed line is a header comment line, in order, from the file's second line.
    const header = fs.readFileSync(script, 'utf8').split('\n').slice(1);
    const comment = header.slice(0, header.indexOf(''));
    assert.deepStrictEqual(lines, comment, 'help must print the complete header comment block');
    for (const flag of FLAGS) assert.ok(result.stdout.includes(flag), `help must name ${flag}`);
    assert.match(lines[0], new RegExp(`^# ${path.basename(script)} — `));
  });
}

// A checkout runs scripts/lib/install-adapters/codex-cli.js; a packaged copy
// runs dhpk-installer.cjs beside the script. Either way, node is all it needs.
test('testShell_codex_prefersTheBundleBesideItAndNeedsOnlyNode', () => {
  const root = tempDir('dhpk-thin-packaged-');
  const plugin = fakePlugin();
  const project = tempDir('dhpk-thin-project-');
  const bin = tempDir('dhpk-thin-bin-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const lib = path.join(root, 'scripts', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.copyFileSync(SCRIPTS.codex, path.join(lib, 'install-codex-skills.sh'));
    // A bundle that proves it was the one executed.
    fs.writeFileSync(path.join(lib, 'dhpk-installer.cjs'), 'process.stdout.write("bundle beside the script ran\\n");\n');
    for (const tool of ['bash', 'dirname', 'sed', 'node']) {
      const found = tool === 'node' ? process.execPath : spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      fs.symlinkSync(found, path.join(bin, tool));
    }
    const result = spawnSync('bash', [path.join(lib, 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: project,
      env: { PATH: `${CODEX_STUB_BIN}:${bin}`, CLAUDE_PLUGIN_ROOT: plugin },
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, 'bundle beside the script ran\n');
  } finally {
    for (const directory of [root, plugin, project, bin]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('testShell_codex_withoutAnyInstallerEntry_failsWithExit2', () => {
  const root = tempDir('dhpk-thin-noentry-');
  const plugin = fakePlugin();
  const project = tempDir('dhpk-thin-noentry-project-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const lib = path.join(root, 'scripts', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.copyFileSync(SCRIPTS.codex, path.join(lib, 'install-codex-skills.sh'));
    const result = spawnSync('bash', [path.join(lib, 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: project,
      env: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH}`, CLAUDE_PLUGIN_ROOT: plugin },
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /the JS installer is neither beside this script nor under scripts\/lib\/install-adapters/);
    assert.strictEqual(fs.existsSync(path.join(project, '.codex')), false);
  } finally {
    for (const directory of [root, plugin, project]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('testShell_codex_runsTheGeneratedBundleAsTheInstaller', () => {
  const root = tempDir('dhpk-thin-real-bundle-');
  const plugin = fakePlugin();
  const project = tempDir('dhpk-thin-real-project-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const lib = path.join(root, 'scripts', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.copyFileSync(SCRIPTS.codex, path.join(lib, 'install-codex-skills.sh'));
    fs.writeFileSync(path.join(lib, 'dhpk-installer.cjs'), buildInstallerBundle());
    const result = spawnSync('bash', [path.join(lib, 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: project,
      env: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH}`, CLAUDE_PLUGIN_ROOT: plugin },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')));
  } finally {
    for (const directory of [root, plugin, project]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

run('install-shell-entry-thin');
