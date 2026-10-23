'use strict';

// Smoke coverage for scripts/install.sh — interactive installer.
// `--dry-run`/`--print` prints the resolved install command and exits before
// exec. Confirmed installs use a local `claude` stub that records argv.
// When that stub reports dhpk@dhpk is already installed, the script must run
// `claude plugin update` and may print the Installed success text only if
// that update exits 0. Interactive prompts below are scripted stdin.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'install.sh');

// The prerequisite gate requires `claude` on PATH, which CI runners lack.
// The stub records argv when a test supplies DHPK_TEST_CLAUDE_LOG.
// DHPK_TEST_CLAUDE_MODE=already-installed makes `plugin list --json` report
// dhpk@dhpk. DHPK_TEST_CLAUDE_MODE=already-installed-message makes list empty
// and `plugin install` exit 0 with Claude's already-installed notice.
// DHPK_TEST_CLAUDE_UPDATE_RC is the exit status of a real plugin update.
const STUB_BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-stub-'));
fs.writeFileSync(path.join(STUB_BIN, 'claude'), [
  '#!/usr/bin/env bash',
  'if [[ -n "${DHPK_TEST_CLAUDE_LOG:-}" ]]; then',
  '  printf "%s\\n" "$*" >> "$DHPK_TEST_CLAUDE_LOG"',
  'fi',
  'if [[ "${1:-}" == plugin && "${2:-}" == install && "$*" == *"--help"* ]]; then',
  '  printf "%s\\n" "${DHPK_TEST_CLAUDE_INSTALL_HELP:-}"',
  '  exit 0',
  'fi',
  'if [[ "${1:-}" == plugin && "${2:-}" == update && "$*" == *"--help"* ]]; then',
  '  printf "%s\\n" "${DHPK_TEST_CLAUDE_UPDATE_HELP:-}"',
  '  exit 0',
  'fi',
  'case "${DHPK_TEST_CLAUDE_MODE:-}" in',
  '  already-installed)',
  '    if [[ "${1:-}" == plugin && "${2:-}" == list ]]; then',
  '      if [[ -n "${DHPK_TEST_CLAUDE_LIST_JSON:-}" ]]; then',
  '        printf "%s\\n" "$DHPK_TEST_CLAUDE_LIST_JSON"',
  '      else',
  '        printf "%s\\n" \'[{"id":"dhpk@dhpk","scope":"user"}]\'',
  '      fi',
  '      exit 0',
  '    fi',
  '    ;;',
  '  already-installed-message)',
  '    if [[ "${1:-}" == plugin && "${2:-}" == list ]]; then',
  '      printf "%s\\n" "[]"',
  '      exit 0',
  '    fi',
  '    if [[ "${1:-}" == plugin && "${2:-}" == install ]]; then',
  '      printf "%s\\n" "Plugin \\"dhpk@dhpk\\" is already installed (scope: user) — run claude plugin update dhpk@dhpk to get it"',
  '      exit 0',
  '    fi',
  '    ;;',
  'esac',
  'if [[ "${1:-}" == plugin && "${2:-}" == update ]]; then',
  '  exit "${DHPK_TEST_CLAUDE_UPDATE_RC:-0}"',
  'fi',
  'exit 0',
  '',
].join('\n'), { mode: 0o755 });
const TEMP_FIXTURES = [STUB_BIN];
process.on('exit', () => {
  for (const fixture of TEMP_FIXTURES) fs.rmSync(fixture, { recursive: true, force: true });
});

function makeNoJqBin(claudeLog) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-no-jq-bin-'));
  TEMP_FIXTURES.push(bin);
  // Keep only the commands the installer needs in PATH. In particular, do not
  // include /usr/bin, where jq is available on the development host.
  const tools = ['bash', 'git', 'dirname', 'sed', 'cat', 'head', 'tail', 'tr', 'seq', 'awk', 'grep', 'cut'];
  const systemTool = (name) => ['/usr/bin', '/bin']
    .map((directory) => path.join(directory, name))
    .find((candidate) => fs.existsSync(candidate));
  for (const name of tools) fs.symlinkSync(systemTool(name), path.join(bin, name));
  fs.symlinkSync(systemTool('python3'), path.join(bin, 'python3'));
  const claudeBody = claudeLog
    ? `#!/bin/bash\nprintf 'called\\n' > "$DHPK_TEST_CLAUDE_LOG"\nexit 99\n`
    : '#!/bin/bash\nexit 0\n';
  fs.writeFileSync(path.join(bin, 'claude'), claudeBody, { mode: 0o755 });
  return bin;
}

function makeInstallerFixture(profiles) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-fixture-'));
  TEMP_FIXTURES.push(parent);
  // The apostrophe is intentionally part of the plugin root, not merely a
  // profile value: this reproduces the original Python-source interpolation.
  const pluginRoot = path.join(parent, "dhpk'installer");
  for (const relative of ['scripts/lib', 'manifests', 'docs']) {
    fs.mkdirSync(path.join(pluginRoot, relative), { recursive: true });
  }
  for (const relative of [
    'scripts/install.sh',
    'scripts/lib/install-prompts.sh',
    'manifests/module-catalog.json',
    'docs/docker-setup.md',
  ]) {
    fs.copyFileSync(path.join(ROOT, relative), path.join(pluginRoot, relative));
  }
  fs.writeFileSync(
    path.join(pluginRoot, 'manifests/install-profiles.json'),
    typeof profiles === 'string' ? profiles : JSON.stringify({ profiles }),
  );
  return pluginRoot;
}

function runScript(args, stdin, options = {}) {
  const script = options.script || SCRIPT;
  const noJqBin = options.noJq ? makeNoJqBin(options.claudeLog) : null;
  const env = {
    ...process.env,
    PATH: noJqBin
      ? noJqBin
      : `${STUB_BIN}${path.delimiter}${process.env.PATH}`,
    ...(options.env || {}),
  };
  if (options.claudeLog) env.DHPK_TEST_CLAUDE_LOG = options.claudeLog;
  return spawnSync('bash', [script, ...(args || [])], {
    cwd: options.cwd || ROOT,
    input: stdin || '',
    encoding: 'utf8',
    timeout: options.timeout || 20000,
    env,
  });
}

const INSTALL_HELP_USER = [
  'Usage: claude plugin install [options] <plugin>',
  '  -s, --scope <scope>  Installation scope: user, project, or local',
  '                       (default: "user")',
  '  --config <key=value> Set a userConfig option. Repeatable.',
].join('\n');

const INSTALL_HELP_PROJECT = [
  'Usage: claude plugin install [options] <plugin>',
  '  -s, --scope <scope>  Installation scope: user, project, or local',
  '                       (default: "project")',
  '  --config <key=value> Set a userConfig option. Repeatable.',
].join('\n');

const UPDATE_HELP_SCOPE_YES = [
  'Usage: claude plugin update [options] <plugin>',
  '  -s, --scope <scope>  Installation scope (default: auto-detect)',
  '  -y, --yes            Accept without a confirmation prompt',
].join('\n');

const UPDATE_HELP_SCOPE_CONFIG_YES = [
  'Usage: claude plugin update [options] <plugin>',
  '  -s, --scope <scope>  Installation scope (default: auto-detect)',
  '  --config <key=value> Set a userConfig option. Repeatable.',
  '  -y, --yes            Accept without a confirmation prompt',
].join('\n');

const UPDATE_HELP_SCOPE_ONLY = [
  'Usage: claude plugin update [options] <plugin>',
  '  -s, --scope <scope>  Installation scope (default: auto-detect)',
].join('\n');

function claudeCommands(logPath) {
  return fs.readFileSync(logPath, 'utf8').split('\n').filter((line) => line.length > 0);
}

function claudeInstallLine(lines) {
  return lines.find((line) => /^plugin install dhpk@dhpk(\s|$)/.test(line));
}

function claudeUpdateLine(lines) {
  return lines.find((line) => /^plugin update dhpk@dhpk(\s|$)/.test(line));
}

function assertNoInstallerSideEffects(pluginRoot, claudeLog) {
  for (const relative of ['.claude', '.codex', 'installed']) {
    assert.strictEqual(fs.existsSync(path.join(pluginRoot, relative)), false, relative);
  }
  if (claudeLog) assert.strictEqual(fs.existsSync(claudeLog), false, 'claude was invoked');
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('-h/--help prints the header comment and exits 0 without any prompts', () => {
  const res = runScript(['--help']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('install.sh'), res.stdout);
  assert.ok(res.stdout.includes('--dry-run'), res.stdout);
});

test('unknown flag exits 64 with a usage hint, no prompts reached', () => {
  const res = runScript(['--bogus']);
  assert.strictEqual(res.status, 64);
  assert.ok(res.stderr.includes('Unknown flag'), res.stderr);
});

test('retired public profile flags exit 64 before prompts or installation side effects', () => {
  for (const args of [['--profile'], ['--profile', 'minimal'], ['--profile=common']]) {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-retired-profile-'));
    TEMP_FIXTURES.push(probeRoot);
    const claudeLog = path.join(probeRoot, 'claude-called.log');
    const res = runScript(args, '', { cwd: probeRoot, claudeLog });
    assert.strictEqual(res.status, 64, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /--profile.*retired/i);
    assertNoInstallerSideEffects(probeRoot, claudeLog);
  }
});

test('--dry-run walks the full custom flow (scripted stdin) and stops before executing install', () => {
  // Scripted answers, one per line, matching the plain (no-gum) prompt flow:
  //   1. "Use a curated preset?"           -> blank (default n)      -> custom flow
  //   2. Stack multi-select                -> blank (none selected)
  //   3. "Enable docker container check?"  -> blank (default n)
  //   4. "Override default review agents?" -> blank (default n)
  //   5. Hook profile single-select        -> "1" (first listed profile)
  const stdin = ['', '', '', '', '1', ''].join('\n');
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-dry-run-'));
  TEMP_FIXTURES.push(probeRoot);
  const claudeLog = path.join(probeRoot, 'claude-called.log');
  const res = runScript(['--dry-run'], stdin, { claudeLog });
  assert.strictEqual(res.status, 0, res.stderr + '\n---stdout---\n' + res.stdout);
  assert.ok(res.stdout.includes('Resolved configuration'), res.stdout);
  assert.ok(res.stdout.includes('Command to run:'), res.stdout);
  assert.ok(res.stdout.includes('claude_plugin     : dhpk@dhpk (main marketplace)'), res.stdout);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk'), res.stdout);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
  assert.ok(!res.stdout.includes('✓ Installed.'), res.stdout);
  assert.strictEqual(fs.existsSync(claudeLog), false, 'claude stub was invoked during dry-run');
});

test('--print is accepted as an alias for --dry-run', () => {
  const stdin = ['', '', '', '', '1', ''].join('\n');
  const res = runScript(['--print'], stdin);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
});

test('default custom flow installs the existing main Claude marketplace', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-profile-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude-called.log');
  const stdin = ['', '', '', '', '1', 'y'].join('\n');
  const res = runScript([], stdin, {
    env: { DHPK_CLAUDE_PROFILE_OUT: outputRoot },
    claudeLog,
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk'), res.stdout);
  assert.ok(!res.stdout.includes('claude plugin marketplace add'), res.stdout);
  assert.ok(fs.existsSync(claudeLog), 'main marketplace install was not invoked');
  assert.ok(!fs.existsSync(path.join(outputRoot, 'package')),
    'default install generated an unapproved profile package');
  assert.ok(!fs.existsSync(path.join(outputRoot, '.claude-plugin')),
    'default install generated an unapproved profile marketplace');
});

test('default custom flow needs neither Node nor jq before invoking the main marketplace', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-no-node-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude-called.log');
  const res = runScript([], ['', '', '', '', '1', 'y'].join('\n'), {
    noJq: true,
    claudeLog,
    env: { DHPK_CLAUDE_PROFILE_OUT: outputRoot },
  });
  assert.strictEqual(res.status, 99, `${res.stdout}\n${res.stderr}`);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk'), res.stdout);
  assert.ok(fs.existsSync(claudeLog), 'main marketplace install was not invoked');
  assert.ok(!fs.existsSync(path.join(outputRoot, 'package')),
    'default install generated a profile package');
});

test('truncated custom flow fails closed at hook-profile selection', () => {
  const res = runScript(['--dry-run'], '\n');
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /ERROR hook-selection/);
  assert.ok(!res.stdout.includes('Command to run:'), res.stdout);
});

test('truncated version selection fails closed before resolving modules', () => {
  const res = runScript(['--dry-run'], '\n14\n');
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /ERROR version-selection/);
  assert.ok(!res.stdout.includes('Command to run:'), res.stdout);
});

test('no-jq dry-run handles an apostrophe plugin path without side effects', () => {
  const pluginRoot = makeInstallerFixture({ safe: { modules: ['php-5.6'] } });
  const claudeLog = path.join(pluginRoot, 'claude-called.log');
  const res = runScript(
    ['--dry-run'],
    'y\n',
    {
      script: path.join(pluginRoot, 'scripts', 'install.sh'),
      noJq: true,
      claudeLog,
    },
  );
  assert.strictEqual(res.status, 0, res.stderr + '\n---stdout---\n' + res.stdout);
  assert.ok(res.stdout.includes(`Plugin root: ${pluginRoot}`), res.stdout);
  assert.ok(res.stdout.includes("Preset 'safe' selected"), res.stdout);
  assert.ok(res.stdout.includes('modules           : php-5.6'), res.stdout);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
  assertNoInstallerSideEffects(pluginRoot, claudeLog);
});

test('no-jq malformed profile fails closed before prompts or destinations', () => {
  const pluginRoot = makeInstallerFixture('{"profiles":');
  const res = runScript(
    ['--dry-run'],
    '',
    { script: path.join(pluginRoot, 'scripts', 'install.sh'), noJq: true, timeout: 3000 },
  );
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /ERROR profile-extraction/);
  assert.ok(!res.stderr.includes(pluginRoot), res.stderr);
  assert.ok(!res.stderr.includes('Use a curated preset'), res.stderr);
  assertNoInstallerSideEffects(pluginRoot);
});

test('no-jq invalid preset selection exits instead of looping', () => {
  const pluginRoot = makeInstallerFixture({ one: { modules: [] }, two: { modules: [] } });
  const res = runScript(
    ['--dry-run'],
    'y\n9\n',
    { script: path.join(pluginRoot, 'scripts', 'install.sh'), noJq: true, timeout: 3000 },
  );
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /ERROR preset-selection/);
  assertNoInstallerSideEffects(pluginRoot);
});

test('no-jq missing module fails closed before preset prompts', () => {
  const pluginRoot = makeInstallerFixture({ broken: { modules: ['not-shipped'] } });
  const res = runScript(
    ['--dry-run'],
    '',
    { script: path.join(pluginRoot, 'scripts', 'install.sh'), noJq: true, timeout: 3000 },
  );
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /ERROR module-extraction/);
  assert.ok(!res.stderr.includes('Use a curated preset'), res.stderr);
  assertNoInstallerSideEffects(pluginRoot);
});

test('--dry-run --non-interactive succeeds with closed stdin and the default hook profile', () => {
  const claudeLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-ni-')), 'claude.log');
  const res = runScript(['--dry-run', '--non-interactive'], '', { claudeLog });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /hook_profile\s+: standard/);
  assert.match(res.stdout, /claude_plugin\s+: dhpk@dhpk \(main marketplace\)/);
  assert.ok(res.stdout.includes('Command to run:'), res.stdout);
  assert.ok(res.stdout.includes('(--dry-run set — not executing.)'), res.stdout);
  assert.ok(!res.stdout.includes('Pick a number'), res.stdout);
  assert.ok(!fs.existsSync(claudeLog), 'claude was invoked during dry-run');
});

test('--hook-profile selects a profile in both separate and equals forms', () => {
  const separate = runScript(['--dry-run', '--non-interactive', '--hook-profile', 'strict'], '');
  assert.strictEqual(separate.status, 0, `${separate.stdout}\n${separate.stderr}`);
  assert.match(separate.stdout, /hook_profile\s+: strict/);

  const equals = runScript(['--non-interactive', '--dry-run', '--hook-profile=minimal'], '');
  assert.strictEqual(equals.status, 0, `${equals.stdout}\n${equals.stderr}`);
  assert.match(equals.stdout, /hook_profile\s+: minimal/);
});

test('--hook-profile with a missing, flag-like, or unknown value exits 64 before any prompt', () => {
  for (const args of [
    ['--dry-run', '--non-interactive', '--hook-profile'],
    ['--dry-run', '--non-interactive', '--hook-profile', '--yes'],
    ['--dry-run', '--non-interactive', '--hook-profile', 'bogus'],
    ['--dry-run', '--non-interactive', '--hook-profile='],
    ['--dry-run', '--non-interactive', '--hook-profile', 'minimal\nbogus'],
  ]) {
    const res = runScript(args, '');
    assert.strictEqual(res.status, 64, `${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /hook-profile/);
    assert.ok(!res.stdout.includes('Command to run:'), res.stdout);
  }
});

test('--non-interactive without --dry-run or --yes refuses to install and never calls claude', () => {
  const claudeLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-ni-')), 'claude.log');
  const res = runScript(['--non-interactive'], '', { claudeLog });
  assert.strictEqual(res.status, 64, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /--yes/);
  assert.ok(!fs.existsSync(claudeLog), 'claude was invoked without confirmation');
});

test('--non-interactive --yes auto-confirms and installs the main marketplace', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-ni-profile-'));
  TEMP_FIXTURES.push(outputRoot);
  const res = runScript(['--non-interactive', '--yes'], '', {
    env: { DHPK_CLAUDE_PROFILE_OUT: outputRoot },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(res.stdout.includes('claude plugin install dhpk@dhpk'), res.stdout);
  assert.ok(!fs.existsSync(path.join(outputRoot, 'package')),
    'default install generated an unapproved profile package');
});

test('--hook-profile in the interactive flow skips the hook-profile prompt and keeps the flag value', () => {
  const res = runScript(['--dry-run', '--hook-profile', 'strict'], ['', '', '', ''].join('\n'));
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /hook_profile\s+: strict/);
  assert.ok(!res.stdout.includes('Hook profile:'), res.stdout);
});

test('a fresh install runs plugin install and does not run plugin update', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-fresh-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude.log');
  const res = runScript(['--non-interactive', '--yes'], '', {
    claudeLog,
    env: {
      DHPK_CLAUDE_PROFILE_OUT: outputRoot,
      DHPK_TEST_CLAUDE_INSTALL_HELP: INSTALL_HELP_USER,
      DHPK_TEST_CLAUDE_UPDATE_HELP: UPDATE_HELP_SCOPE_YES,
    },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const lines = claudeCommands(claudeLog);
  assert.ok(claudeInstallLine(lines), `install was not invoked:\n${lines.join('\n')}`);
  assert.strictEqual(claudeUpdateLine(lines), undefined, `update ran on a fresh install:\n${lines.join('\n')}`);
  assert.ok(res.stdout.includes('✓ Installed.'), res.stdout);
});

test('an already installed plugin is updated in the scope the install command would use', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-update-scope-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude.log');
  const res = runScript(['--non-interactive', '--yes', '--hook-profile', 'strict'], '', {
    claudeLog,
    env: {
      DHPK_CLAUDE_PROFILE_OUT: outputRoot,
      DHPK_TEST_CLAUDE_MODE: 'already-installed',
      DHPK_TEST_CLAUDE_LIST_JSON: '[{"id":"dhpk@dhpk","scope":"user","version":"0.66.5"},{"id":"dhpk@dhpk","scope":"project","version":"0.66.5"}]',
      DHPK_TEST_CLAUDE_INSTALL_HELP: INSTALL_HELP_PROJECT,
      DHPK_TEST_CLAUDE_UPDATE_HELP: UPDATE_HELP_SCOPE_YES,
      DHPK_TEST_CLAUDE_UPDATE_RC: '0',
    },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const lines = claudeCommands(claudeLog);
  const updateLine = claudeUpdateLine(lines);
  assert.ok(updateLine, `update was not invoked:\n${lines.join('\n')}`);
  assert.ok(updateLine.includes('--scope project'), updateLine);
  assert.ok(!updateLine.includes('--scope user'), updateLine);
  assert.ok(!updateLine.includes('--config'), updateLine);
  assert.ok(/(^|\s)-y(\s|$)/.test(updateLine), updateLine);
  assert.strictEqual(claudeInstallLine(lines), undefined, `install ran after the plugin was already installed:\n${lines.join('\n')}`);
  assert.ok(res.stdout.includes('✓ Installed.'), res.stdout);
});

test('plugin update receives install config only when update accepts --config', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-update-config-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude.log');
  const res = runScript(['--non-interactive', '--yes', '--hook-profile', 'strict'], '', {
    claudeLog,
    env: {
      DHPK_CLAUDE_PROFILE_OUT: outputRoot,
      DHPK_TEST_CLAUDE_MODE: 'already-installed',
      DHPK_TEST_CLAUDE_LIST_JSON: '[{"id":"dhpk@dhpk","scope":"user"}]',
      DHPK_TEST_CLAUDE_INSTALL_HELP: INSTALL_HELP_USER,
      DHPK_TEST_CLAUDE_UPDATE_HELP: UPDATE_HELP_SCOPE_CONFIG_YES,
      DHPK_TEST_CLAUDE_UPDATE_RC: '0',
    },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const updateLine = claudeUpdateLine(claudeCommands(claudeLog));
  assert.ok(updateLine, claudeLog);
  assert.ok(updateLine.includes('--config hook_profile=strict'), updateLine);
  assert.ok(updateLine.includes('--scope user'), updateLine);
});

test('plugin update omits scope and -y when its help does not accept them', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-update-flags-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude.log');
  const res = runScript(['--non-interactive', '--yes'], '', {
    claudeLog,
    env: {
      DHPK_CLAUDE_PROFILE_OUT: outputRoot,
      DHPK_TEST_CLAUDE_MODE: 'already-installed',
      DHPK_TEST_CLAUDE_LIST_JSON: '[{"id":"dhpk@dhpk","scope":"user"}]',
      DHPK_TEST_CLAUDE_INSTALL_HELP: INSTALL_HELP_USER,
      DHPK_TEST_CLAUDE_UPDATE_HELP: [
        'Usage: claude plugin update [options] <plugin>',
        '  --json  Print a machine-readable result',
      ].join('\n'),
      DHPK_TEST_CLAUDE_UPDATE_RC: '0',
    },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const lines = claudeCommands(claudeLog);
  const updateLine = claudeUpdateLine(lines);
  assert.ok(updateLine, `update was not invoked:\n${lines.join('\n')}`);
  assert.strictEqual(updateLine, 'plugin update dhpk@dhpk', updateLine);
});

test('an already-installed notice does not claim Installed when plugin update fails', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-update-fail-'));
  TEMP_FIXTURES.push(outputRoot);
  const claudeLog = path.join(outputRoot, 'claude.log');
  const res = runScript(['--non-interactive', '--yes'], '', {
    claudeLog,
    env: {
      DHPK_CLAUDE_PROFILE_OUT: outputRoot,
      DHPK_TEST_CLAUDE_MODE: 'already-installed-message',
      DHPK_TEST_CLAUDE_INSTALL_HELP: INSTALL_HELP_USER,
      DHPK_TEST_CLAUDE_UPDATE_HELP: UPDATE_HELP_SCOPE_ONLY,
      DHPK_TEST_CLAUDE_UPDATE_RC: '1',
    },
  });
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  const lines = claudeCommands(claudeLog);
  assert.ok(claudeInstallLine(lines), `install probe was not invoked:\n${lines.join('\n')}`);
  const updateLine = claudeUpdateLine(lines);
  assert.ok(updateLine, `update was not invoked:\n${lines.join('\n')}`);
  assert.ok(updateLine.includes('--scope user'), updateLine);
  assert.ok(!/(^|\s)-y(\s|$)/.test(updateLine), updateLine);
  assert.ok(!res.stdout.includes('✓ Installed.'), res.stdout);
});

test('--yes alone keeps the interactive prompts', () => {
  const res = runScript(['--dry-run', '--yes'], '\n');
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /ERROR hook-selection/);
});

run('install');
