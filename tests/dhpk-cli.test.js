'use strict';

// Process-boundary contract for the dhpk entrypoint: help, version, unknown
// commands, and delegation to the existing install, harness, and distribution
// executables.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk');
const USAGE = 'usage: dhpk <distribution|harness|install> [args...]\n'
  + '       dhpk <--version|--help>\n';

function invoke(args, cwd = ROOT) {
  return spawnSync('bash', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('testDhpkCli_helpForms_exitZeroAndListSubcommands', () => {
  for (const args of [[], ['--help'], ['-h'], ['help']]) {
    const label = args.length === 0 ? '(no args)' : args[0];
    const result = invoke(args);
    assert.strictEqual(result.status, 0, label);
    assert.strictEqual(result.stdout, USAGE, label);
    assert.strictEqual(result.stderr, '', label);
  }
});

test('testDhpkCli_versionFlags_printPackageJsonVersion', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  for (const flag of ['--version', '-v']) {
    for (const cwd of [ROOT, os.tmpdir()]) {
      const result = invoke([flag], cwd);
      const label = `${flag} cwd=${cwd}`;
      assert.strictEqual(result.status, 0, label);
      assert.strictEqual(result.stdout, `${version}\n`, label);
      assert.strictEqual(result.stderr, '', label);
    }
  }
});

test('testDhpkCli_unknownSubcommand_exits64AndNamesSubcommands', () => {
  for (const args of [['not-a-command'], ['--bogus']]) {
    const result = invoke(args);
    assert.strictEqual(result.status, 64, args[0]);
    assert.strictEqual(result.stdout, '', args[0]);
    assert.strictEqual(result.stderr, USAGE, args[0]);
  }
});

test('testDhpkCli_install_execsInstallerWithRemainingArgs', () => {
  const result = invoke(['install', 'cursor', 'status', '--sentinel-option']);
  assert.strictEqual(result.status, 64);
  assert.strictEqual(result.stderr, "dhpk-install: unknown option '--sentinel-option'\n");
});

test('testDhpkCli_harness_keepsForwardingToHarnessExecutable', () => {
  const result = invoke(['harness', 'not-a-phase']);
  assert.strictEqual(result.status, 64);
  assert.strictEqual(result.stderr, "unknown phase 'not-a-phase'\n");
});

test('testDhpkCli_distribution_keepsForwardingToDistributionExecutable', () => {
  const result = invoke(['distribution', 'not-a-surface', 'generate']);
  assert.strictEqual(result.status, 64);
  assert.strictEqual(result.stderr, "dhpk distribution: unknown surface 'not-a-surface'\n");
});

run('dhpk-cli');
