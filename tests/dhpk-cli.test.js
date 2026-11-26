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

function invokeEntrypoint(executable, prefix, args, cwd = ROOT) {
  return spawnSync('bash', [path.join(ROOT, 'bin', executable), ...prefix, ...args], {
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

for (const linkKind of ['absolute', 'relative', 'chain']) {
  test(`testDhpkCli_PATH_${linkKind}Symlinks_resolvePhysicalEntrypoints`, () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk cli links '));
    const linkDirectory = path.join(temporaryRoot, 'path bin');
    const hopDirectory = path.join(temporaryRoot, 'link hops');
    fs.mkdirSync(linkDirectory);
    fs.mkdirSync(hopDirectory);
    try {
      for (const name of ['dhpk', 'dhpk-install', 'dhpk-distribution']) {
        const target = path.join(ROOT, 'bin', name);
        const link = path.join(linkDirectory, name);
        if (linkKind === 'chain') {
          const hop = path.join(hopDirectory, name);
          fs.symlinkSync(path.relative(hopDirectory, target), hop);
          fs.symlinkSync(path.relative(linkDirectory, hop), link);
        } else {
          fs.symlinkSync(linkKind === 'absolute' ? target : path.relative(linkDirectory, target), link);
        }
      }
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
      const cases = [
        ['dhpk', ['--version'], 0, `${version}\n`, ''],
        ['dhpk', ['--help'], 0, USAGE, ''],
        ['dhpk', ['unknown command'], 64, '', USAGE],
        ['dhpk', ['harness', 'unknown phase'], 64, '', "unknown phase 'unknown phase'\n"],
        ['dhpk', ['install', 'cursor', 'status', '--sentinel option'], 64, '', "dhpk-install: unknown option '--sentinel option'\n"],
        ['dhpk', ['distribution', 'unknown surface', 'generate'], 64, '', "dhpk distribution: unknown surface 'unknown surface'\n"],
        ['dhpk-install', ['cursor', 'status', '--sentinel option'], 64, '', "dhpk-install: unknown option '--sentinel option'\n"],
        ['dhpk-distribution', ['unknown surface', 'generate'], 64, '', "dhpk distribution: unknown surface 'unknown surface'\n"],
      ];
      for (const [command, args, status, stdout, stderr] of cases) {
        const result = spawnSync(command, args, {
          cwd: temporaryRoot,
          env: { ...process.env, PATH: `${linkDirectory}${path.delimiter}${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 30000,
        });
        const label = `${linkKind}: ${command} ${args.join(' ')}: ${result.stderr}`;
        assert.ifError(result.error);
        assert.strictEqual(result.status, status, label);
        assert.strictEqual(result.stdout, stdout, label);
        assert.strictEqual(result.stderr, stderr, label);
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
}

test('testDhpkCli_subcommandHelp_handlesZeroArgsFlagsPrefixesAndErrorsAcrossAllEntrypoints', () => {
  const specs = [
    {
      name: 'install',
      entrypoints: [['dhpk', ['install']], ['dhpk-install', []]],
      canonical: 'usage: dhpk install ',
      topLevelTokens: ['--recover', 'claude', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor', 'agy-plugin', 'plan', '--scope'],
      validPrefixCases: [
        ['--recover', '--help'],
        ['codex-sync', '--help'],
        ['cursor', 'plan', '--help'],
        ['cursor', 'plan', '--scope', 'project', '-h'],
      ],
      invalidCases: [
        ['help'],
        ['--bogus', '--help'],
        ['bogus', '--help'],
        ['--recover', '--bogus', '--help'],
        ['--scope', '--help'],
        ['cursor', 'bogus', '--help'],
      ],
    },
    {
      name: 'distribution',
      entrypoints: [['dhpk', ['distribution']], ['dhpk-distribution', []]],
      canonical: 'usage: dhpk distribution ',
      topLevelTokens: ['build <surface>', 'openai-submission', 'agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin', 'generate', 'preview', 'validate', 'verify'],
      validPrefixCases: [
        ['build', '--help'],
        ['build', 'agent-plugin', '--help'],
        ['codex-native', '--help'],
        ['codex-native', 'validate', '--help'],
        ['agent-plugin', 'validate', '--json', '-h'],
      ],
      invalidCases: [
        ['help'],
        ['--bogus', '--help'],
        ['bogus', '--help'],
        ['--output', '--help'],
        ['build', 'codex-native', '--help'],
        ['codex-native', 'bogus', '--help'],
      ],
    },
  ];
  for (const spec of specs) {
    const baselineByEntrypoint = [];
    for (const [executable, prefix] of spec.entrypoints) {
      for (const args of [[], ['--help'], ['-h']]) {
        const result = invokeEntrypoint(executable, prefix, args);
        const label = `${executable} ${prefix.join(' ')} ${args.join(' ') || '(no args)'}`;
        assert.strictEqual(result.status, 0, `${label}: ${result.stderr}`);
        assert.strictEqual(result.stderr, '', label);
        assert.ok(result.stdout.includes(spec.canonical), label);
        for (const token of spec.topLevelTokens) {
          assert.ok(result.stdout.includes(token), `${label} missing ${token}`);
        }
        if (args.length === 0) baselineByEntrypoint.push(result.stdout);
        else assert.strictEqual(result.stdout, baselineByEntrypoint[baselineByEntrypoint.length - 1], label);
      }
      for (const args of spec.validPrefixCases) {
        const result = invokeEntrypoint(executable, prefix, args);
        const label = `${executable} ${prefix.join(' ')} ${args.join(' ')}`;
        assert.strictEqual(result.status, 0, `${label}: ${result.stderr}`);
        assert.strictEqual(result.stderr, '', label);
        assert.ok(result.stdout.includes(spec.canonical), label);
      }
      for (const args of spec.invalidCases) {
        const result = invokeEntrypoint(executable, prefix, args);
        const label = `${executable} ${prefix.join(' ')} ${args.join(' ')}`;
        assert.strictEqual(result.status, 64, label);
        assert.strictEqual(result.stdout, '', label);
        assert.ok(result.stderr.trim().length > 0, label);
      }
    }
    assert.strictEqual(baselineByEntrypoint[0], baselineByEntrypoint[1], `${spec.name} wrapper parity`);
  }
});

run('dhpk-cli');
