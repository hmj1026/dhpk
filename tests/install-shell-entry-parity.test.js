'use strict';

// js-projection-journal stage 5 (task 5.1): the two shell entry points are
// reduced to option parsing plus an exec of the JS installer. This table pins
// what a caller observes -- exit status, the first stderr line, and whether
// stdout is the JSON plan report -- for every option and every refusal of the
// checkout contract of dhpk 0.73.0, where the shells already ran the JS
// installer, so the reduction cannot change it. A packaged harness-setup copy
// ran the embedded Python before this stage; the `codex-packaged` rows pin the
// contract it has since, which is the same JS installer through the generated
// bundle. Regenerate the file only on purpose:
//   UPDATE_GOLDEN=1 node tests/install-shell-entry-parity.test.js

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fakePlugin, write } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN } = require('./_lib/install-codex-skills-fixtures');
const { buildInstallerBundle } = require('../scripts/lib/installer-bundle');

const REPO = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'install-shell-entry-golden.json');
const HOOKS = {
  codex: path.join(REPO, 'scripts', 'hooks', 'install-codex-skills.sh'),
  cursor: path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh'),
};
const USER_FILE = {
  codex: ['.codex', 'agents', 'explorer.toml'],
  cursor: ['.cursor', 'rules', 'prefer-const.mdc'],
};

// One row: a name, the argv, and how the world around the script is set up.
//   project   a project root (.git) and a complete plugin
//   bare      a directory that does not look like a project root
//   nosrc     a project root and a plugin without the Host source tree
//   nonode    a project root and a PATH holding only bash, dirname and sed
//   collision a project root where an unowned file sits on a managed path
//   edited-managed  an installed project whose managed file was edited while its source changed
const CASES = [
  ['install-copy', ['--copy'], 'project'],
  ['install-symlink-force', ['--force'], 'project'],
  ['update-without-receipt', ['--copy', '--update'], 'project'],
  ['migrate', ['--migrate'], 'project'],
  ['uninstall-nothing-installed', ['--uninstall'], 'project'],
  ['recover-clean', ['--recover'], 'project'],
  ['plan-json', ['--plan', '--json'], 'project'],
  ['plan-without-json', ['--plan'], 'project'],
  ['skill-flag-valid', ['--copy', '--skill', 'codex-only'], 'project'],
  ['skill-equals-valid', ['--copy', '--skill=codex-only'], 'project'],
  ['skill-unknown-id', ['--copy', '--skill', 'no-such-skill'], 'project'],
  ['help-long', ['--help'], 'project'],
  ['help-short', ['-h'], 'project'],
  ['profile-retired', ['--profile', 'x'], 'project'],
  ['profile-equals-retired', ['--profile=x'], 'project'],
  ['unknown-flag', ['--bogus'], 'project'],
  ['unknown-positional', ['extra'], 'project'],
  ['skill-missing-value', ['--skill'], 'project'],
  ['skill-value-is-a-flag', ['--skill', '--copy'], 'project'],
  ['skill-equals-empty', ['--skill='], 'project'],
  ['adopt-missing-value', ['--adopt'], 'project'],
  ['adopt-with-malformed-token', ['--copy', '--adopt', 'nonsense'], 'project'],
  ['plan-with-adopt', ['--plan', '--adopt', 'a@b@c'], 'project'],
  ['plan-with-adopt-equals', ['--plan', '--adopt=a@b@c'], 'project'],
  ['not-a-project-root', ['--copy'], 'bare'],
  ['not-a-project-root-forced', ['--copy', '--force'], 'bare'],
  ['not-a-project-root-uninstall', ['--uninstall'], 'bare'],
  ['source-tree-missing', ['--copy'], 'nosrc'],
  ['source-tree-missing-help', ['--help'], 'nosrc'],
  ['node-missing-install', ['--copy'], 'nonode'],
  ['node-missing-plan', ['--plan', '--json'], 'nonode'],
  ['node-missing-uninstall', ['--uninstall'], 'nonode'],
  ['node-missing-help', ['--help'], 'nonode'],
  ['collision-preserved', ['--copy'], 'collision'],
  // An unowned edit to a managed file plus a changed source leaves the update incomplete: exit 1.
  ['update-reconciliation-incomplete', ['--copy', '--update'], 'edited-managed'],
];

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function pathWithTools(names) {
  const bin = tempDir('dhpk-shell-parity-bin-');
  for (const name of names) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    assert.ok(found, `${name} must exist on the test host`);
    fs.symlinkSync(found, path.join(bin, name));
  }
  return bin;
}

// Rows run against the checkout shells of both Hosts and against the packaged
// Codex layout (shell and generated bundle side by side in scripts/lib/).
const PACKAGED_CASES = [
  ['install-copy', ['--copy'], 'project'],
  ['help-long', ['--help'], 'project'],
  ['unknown-flag', ['--bogus'], 'project'],
  ['profile-retired', ['--profile', 'x'], 'project'],
  ['plan-json', ['--plan', '--json'], 'project'],
  ['update-reconciliation-incomplete', ['--copy', '--update'], 'edited-managed'],
  ['node-missing-install', ['--copy'], 'nonode'],
];
const TARGETS = [
  { key: 'codex', host: 'codex', layout: 'checkout', cases: CASES },
  { key: 'cursor', host: 'cursor', layout: 'checkout', cases: CASES },
  { key: 'codex-packaged', host: 'codex', layout: 'packaged', cases: PACKAGED_CASES },
];

function packagedShell() {
  const root = tempDir('dhpk-shell-parity-packaged-');
  const lib = path.join(root, 'scripts', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(HOOKS.codex, path.join(lib, 'install-codex-skills.sh'));
  fs.writeFileSync(path.join(lib, 'dhpk-installer.cjs'), buildInstallerBundle());
  return { root, script: path.join(lib, 'install-codex-skills.sh') };
}

function shellEnv(bin, home, plugin) {
  return { PATH: bin ? `${CODEX_STUB_BIN}:${bin}` : `${CODEX_STUB_BIN}:${process.env.PATH || ''}`, HOME: home, CLAUDE_PLUGIN_ROOT: plugin };
}

function observe(host, argv, setup, layout = 'checkout') {
  const plugin = setup === 'nosrc' ? tempDir('dhpk-shell-parity-empty-') : fakePlugin();
  const project = tempDir('dhpk-shell-parity-project-');
  const home = tempDir('dhpk-shell-parity-home-');
  const bin = setup === 'nonode' ? pathWithTools(['bash', 'dirname', 'sed']) : null;
  const packaged = layout === 'packaged' ? packagedShell() : null;
  const script = packaged ? packaged.script : HOOKS[host];
  try {
    if (setup !== 'bare') fs.mkdirSync(path.join(project, '.git'));
    if (setup === 'collision') write(path.join(project, ...USER_FILE[host]), host === 'codex' ? 'name = "explorer"\ndescription = "user edit"\n' : '---\nname: prefer-const\ndescription: user edit\nalwaysApply: false\n---\n# User rule\n');
    if (setup === 'edited-managed') {
      const first = spawnSync('bash', [script, '--copy'], { cwd: project, env: shellEnv(null, home, plugin), encoding: 'utf8', timeout: 90_000 });
      assert.strictEqual(first.status, 0, first.stderr);
      const edited = host === 'codex' ? path.join(project, '.codex', 'agents', 'explorer.toml') : path.join(project, '.cursor', 'rules', 'prefer-const.mdc');
      fs.appendFileSync(edited, '\n# user edit\n');
      write(path.join(plugin, host === 'codex' ? 'codex/agents/explorer.toml' : 'cursor/rules/prefer-const.mdc'), host === 'codex' ? 'name = "explorer"\ndescription = "v2"\n' : '---\nname: prefer-const\ndescription: v2\nalwaysApply: false\n---\n# v2\n');
    }
    const result = spawnSync('bash', [script, ...argv], { cwd: project, env: shellEnv(bin, home, plugin), encoding: 'utf8', timeout: 90_000 });
    const normalize = (text) => text.split(project).join('<PROJECT>').split(plugin).join('<PLUGIN>');
    const firstStderr = normalize(result.stderr || '').split('\n').find((line) => line.length > 0) || '';
    let stdoutJson = false;
    try {
      JSON.parse(result.stdout);
      stdoutJson = true;
    } catch (_) {
      stdoutJson = false;
    }
    return { status: result.status, firstStderr, stdoutJson };
  } finally {
    for (const directory of [plugin, project, home, bin, packaged && packaged.root]) if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

function recordTable() {
  const table = {};
  for (const { key, host, layout, cases } of TARGETS) {
    for (const [name, argv, setup] of cases) table[`${key}:${name}`] = { argv, setup, ...observe(host, argv, setup, layout) };
  }
  return table;
}

if (process.env.UPDATE_GOLDEN === '1') {
  fs.writeFileSync(GOLDEN, `${JSON.stringify(recordTable(), null, 2)}\n`);
  process.stdout.write(`recorded ${GOLDEN}\n`);
  process.exit(0);
}

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

test('testGoldenTable_coversEveryCaseOfEveryTarget', () => {
  const expected = TARGETS.flatMap(({ key, cases }) => cases.map(([name]) => `${key}:${name}`));
  assert.deepStrictEqual(Object.keys(golden).sort(), expected.sort());
});

test('testGoldenTable_pinsTheDocumentedExitStatuses', () => {
  for (const { key } of TARGETS) {
    assert.strictEqual(golden[`${key}:profile-retired`].status, 64);
    assert.strictEqual(golden[`${key}:unknown-flag`].status, 2);
    assert.strictEqual(golden[`${key}:help-long`].status, 0);
    assert.strictEqual(golden[`${key}:plan-json`].stdoutJson, true);
    assert.strictEqual(golden[`${key}:update-reconciliation-incomplete`].status, 1, 'an update left incomplete exits 1');
    assert.strictEqual(golden[`${key}:node-missing-install`].status, 2);
  }
  for (const host of ['codex', 'cursor']) {
    assert.strictEqual(golden[`${host}:plan-with-adopt`].status, 2);
    assert.strictEqual(golden[`${host}:not-a-project-root`].status, 2);
    assert.strictEqual(golden[`${host}:source-tree-missing`].status, 2);
    assert.strictEqual(golden[`${host}:collision-preserved`].status, 0, 'a preserved unowned file does not fail the install');
  }
});

for (const { key, host, layout, cases } of TARGETS) {
  for (const [name, argv, setup] of cases) {
    test(`testShellEntry_${key}_${name}_matchesTheRecordedContract`, () => {
      const { status, firstStderr, stdoutJson } = observe(host, argv, setup, layout);
      const { argv: recordedArgv, setup: recordedSetup, ...recorded } = golden[`${key}:${name}`];
      assert.deepStrictEqual([recordedArgv, recordedSetup], [argv, setup]);
      assert.deepStrictEqual({ status, firstStderr, stdoutJson }, recorded);
    });
  }
}

run('install-shell-entry-parity');
