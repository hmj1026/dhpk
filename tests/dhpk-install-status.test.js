'use strict';

// Behavioral tests for `dhpk-install <surface> status` and `dhpk-install status --all` (#1586).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');
const { snapshotTree } = require('./_lib/install-codex-skills-fixtures');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'dhpk-install.js');
const SOURCE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSkill(parent, name) {
  const dir = path.join(parent, name);
  writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Demo ${name}\n---\n# ${name}\n`);
  return dir;
}

function writeStub(binDir, name, body) {
  writeFile(path.join(binDir, name), body, 0o755);
}

const CLAUDE_DUAL_STUB = `#!/bin/sh
if [ -n "\${DHPK_TEST_PROBE_MARKER:-}" ]; then
  printf '%s\\n' "$*" >> "$DHPK_TEST_PROBE_MARKER"
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ -n "\${DHPK_TEST_CLAUDE_JSON_STDERR:-}" ]; then
    printf '%s\\n' "$DHPK_TEST_CLAUDE_JSON_STDERR" >&2
  fi
  if [ -n "\${DHPK_TEST_CLAUDE_JSON_FILE:-}" ]; then
    /bin/cat "$DHPK_TEST_CLAUDE_JSON_FILE"
  else
    printf '[]\\n'
  fi
  exit "\${DHPK_TEST_CLAUDE_JSON_EXIT:-0}"
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ -z "$3" ]; then
  if [ -n "\${DHPK_TEST_CLAUDE_TEXT_STDERR:-}" ]; then
    printf '%s\\n' "$DHPK_TEST_CLAUDE_TEXT_STDERR" >&2
  fi
  if [ -n "\${DHPK_TEST_CLAUDE_TEXT_FILE:-}" ]; then
    /bin/cat "$DHPK_TEST_CLAUDE_TEXT_FILE"
  else
    printf 'Installed plugins:\\n'
  fi
  exit "\${DHPK_TEST_CLAUDE_TEXT_EXIT:-0}"
fi
exit 2
`;

const CODEX_DUAL_STUB = `#!/bin/sh
if [ -n "\${DHPK_TEST_PROBE_MARKER:-}" ]; then
  printf '%s\\n' "$*" >> "$DHPK_TEST_PROBE_MARKER"
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ -n "\${DHPK_TEST_CODEX_PLUGIN_FILE:-}" ]; then
    /bin/cat "$DHPK_TEST_CODEX_PLUGIN_FILE"
  else
    printf '{"installed":[],"available":[]}\\n'
  fi
  exit "\${DHPK_TEST_CODEX_PLUGIN_EXIT:-0}"
fi
if [ "$1" = "debug" ] && [ "$2" = "prompt-input" ]; then
  if [ -n "\${DHPK_TEST_CODEX_PROMPT_FILE:-}" ]; then
    /bin/cat "$DHPK_TEST_CODEX_PROMPT_FILE"
  else
    printf '[{"type":"message","content":[{"type":"input_text","text":"<skills_instructions>\\\\n### Skill roots\\\\n### Available skills\\\\n</skills_instructions>"}]}]\\n'
  fi
  exit "\${DHPK_TEST_CODEX_PROMPT_EXIT:-0}"
fi
exit 2
`;

function runInstallCli(args, { home, codexHome, binDir, env = {}, cwd = ROOT } = {}) {
  const pathEnv = binDir ? `${binDir}:/usr/bin:/bin` : '/usr/bin:/bin';
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...(home ? { HOME: home } : {}),
      ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      PATH: pathEnv,
      ...env,
    },
  });
}

function parseJson(result, label) {
  assert.strictEqual(result.error, undefined, `${label}: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`${label}: expected JSON stdout (${error.message})\nstatus=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return null;
}

function setupCleanEnv(label) {
  const root = makeTempDir(`dhpk-status-${label}-`);
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const codexHome = path.join(home, '.codex');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { root, project, home, codexHome, binDir };
}

test('rejects ambiguous codex surface alias with exit 64 and actionable guidance', () => {
  for (const args of [['codex', 'status'], ['codex', 'install'], ['codex', '--help']]) {
    const res = runInstallCli(args, {});
    assert.strictEqual(res.status, 64, `${args.join(' ')}: ${res.stderr}`);
    assert.strictEqual(res.stdout, '', `${args.join(' ')}: stdout must stay empty on usage error`);
    assert.match(res.stderr, /codex-sync/);
    assert.match(res.stderr, /codex-native/);
    assert.match(res.stderr, /dhpk-install status --all/);
  }
});

test('validates status CLI arguments and rejects invalid flag combinations with exit 64', () => {
  const invalidCases = [
    ['status'],
    ['status', '--bogus'],
    ['claude', 'status', '--all'],
    ['claude', 'plan', '--strict'],
    ['claude', 'plan', '--all'],
    ['status', '--all', '--project-root'],
  ];
  for (const args of invalidCases) {
    const res = runInstallCli(args, {});
    assert.strictEqual(res.status, 64, `${args.join(' ')}: ${res.stderr}`);
    assert.strictEqual(res.stdout, '', args.join(' '));
    assert.match(res.stderr, /^dhpk-install: /, args.join(' '));
  }
  const helpRes = runInstallCli(['status', '--help'], {});
  assert.strictEqual(helpRes.status, 0, helpRes.stderr);
  assert.match(helpRes.stdout, /status --all/);
  assert.match(helpRes.stdout, /--strict/);
});

test('status --all and single-surface status perform zero filesystem writes and exit 0 when hosts are absent', () => {
  const { root, project, home, codexHome } = setupCleanEnv('absent');
  const beforeRoot = snapshotTree(root);

  const allRes = runInstallCli([
    'status', '--all', '--project-root', project, '--offline', '--json',
  ], { home, codexHome });
  assert.strictEqual(allRes.status, 0, allRes.stderr);
  const allJson = parseJson(allRes, 'status --all absent');
  assert.strictEqual(allJson.schema, 'dhpk.install-status.v1');
  assert.strictEqual(allJson.mode, 'all');
  assert.strictEqual(allJson.offline, true);
  assert.strictEqual(allJson.mutation.performed, false);
  assert.notStrictEqual(allJson.lifecycle.verdict, 'NOT_RUN');
  assert.strictEqual(allJson.lifecycle.verdict, 'INSTALL_PASS');
  assert.strictEqual(allJson.source.version, SOURCE_VERSION);
  assert.deepStrictEqual(
    Object.keys(allJson.surfaces).sort(),
    ['agent-plugin', 'agy-plugin', 'claude', 'codex-native', 'codex-sync', 'cursor'],
  );
  for (const surface of Object.keys(allJson.surfaces)) {
    assert.strictEqual(allJson.surfaces[surface].state, 'ABSENT', `${surface} should be ABSENT`);
  }

  // Strict on clean absent environment should still exit 0 (no drift/duplicate/blocked/probe-fail).
  const strictRes = runInstallCli([
    'status', '--all', '--project-root', project, '--offline', '--strict', '--json',
  ], { home, codexHome });
  assert.strictEqual(strictRes.status, 0, strictRes.stderr);

  // Single-surface without explicit --scope must succeed for claude, codex-native, agent-plugin.
  for (const surface of ['claude', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor', 'agy-plugin']) {
    const single = runInstallCli([
      surface, 'status', '--project-root', project, '--offline', '--json',
    ], { home, codexHome });
    assert.strictEqual(single.status, 0, `${surface} status: ${single.stderr}`);
    const parsed = parseJson(single, `${surface} status`);
    assert.strictEqual(parsed.mode, 'single');
    assert.strictEqual(parsed.requestedSurface, surface);
    assert.notStrictEqual(parsed.lifecycle.verdict, 'NOT_RUN');
    assert.ok(parsed.surfaces[surface], `${surface} entry must exist`);
  }

  // Human-readable output check
  const human = runInstallCli(['status', '--all', '--project-root', project, '--offline'], { home, codexHome });
  assert.strictEqual(human.status, 0, human.stderr);
  assert.match(human.stdout, /claude/);
  assert.match(human.stdout, /codex-sync/);

  assert.strictEqual(snapshotTree(root), beforeRoot, 'status must perform zero filesystem writes');
});

test('claude status skips CLI probes cleanly under --offline and respects registry + settings', () => {
  const { project, home, codexHome, binDir } = setupCleanEnv('claude-offline');
  const marker = path.join(path.dirname(binDir), 'probe-marker');
  writeStub(binDir, 'claude', CLAUDE_DUAL_STUB);
  const cacheInstall = path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', SOURCE_VERSION);
  writeJson(path.join(cacheInstall, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: SOURCE_VERSION });
  writeJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'dhpk@dhpk': [{
        scope: 'user',
        installPath: cacheInstall,
        version: SOURCE_VERSION,
        gitCommitSha: 'a'.repeat(40),
      }],
    },
  });
  writeJson(path.join(home, '.claude', 'settings.json'), {
    enabledPlugins: { 'dhpk@dhpk': true },
  });

  const res = runInstallCli([
    'claude', 'status', '--project-root', project, '--offline', '--json',
  ], { home, codexHome, binDir, env: { DHPK_TEST_PROBE_MARKER: marker } });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(fs.existsSync(marker), false, '--offline must not invoke claude CLI');
  const report = parseJson(res, 'claude offline');
  const claude = report.surfaces.claude;
  assert.strictEqual(claude.installed, true);
  assert.strictEqual(claude.enabled, true);
  assert.strictEqual(claude.cli.text.status, 'NOT_RUN');
  assert.strictEqual(claude.cli.json.status, 'NOT_RUN');
  assert.strictEqual(claude.discovery.live.verdict, 'NOT_RUN');
  assert.strictEqual(claude.scopes.user.installedVersion, SOURCE_VERSION);
  assert.strictEqual(claude.scopes.user.sourceSha, 'a'.repeat(40));
  assert.strictEqual(claude.scopes.user.enabled, true);
});

test('claude status compares plain-text plugin list vs JSON vs registry and emits VERSION_DRIFT and SOURCE_MISMATCH with dual raw evidence', () => {
  const { root, project, home, codexHome, binDir } = setupCleanEnv('claude-dual-drift');
  writeStub(binDir, 'claude', CLAUDE_DUAL_STUB);
  const cachePath = path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', '0.0.1');
  const folderPath = path.join(root, 'folder-checkout', 'dist', 'claude-marketplace', 'package');
  const textOtherPath = path.join(root, 'other-folder', 'package');
  writeJson(path.join(cachePath, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: '0.0.1' });
  writeJson(path.join(folderPath, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: SOURCE_VERSION });
  writeJson(path.join(textOtherPath, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: SOURCE_VERSION });

  writeJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'dhpk@dhpk': [{
        scope: 'project',
        projectPath: project,
        installPath: cachePath,
        version: '0.0.1',
        gitCommitSha: 'b'.repeat(40),
      }],
    },
  });
  writeJson(path.join(project, '.claude', 'settings.json'), {
    enabledPlugins: { 'dhpk@dhpk': true },
  });

  const textFile = path.join(root, 'claude-text.txt');
  writeFile(textFile, [
    'Installed plugins:',
    '',
    '  \u276f dhpk@dhpk',
    `    Version: ${SOURCE_VERSION}`,
    `    Read from: ${textOtherPath}`,
    '    Scope: project',
    '    Status: \u2714 enabled',
    '',
  ].join('\n'));

  const jsonFile = path.join(root, 'claude-json.json');
  writeJson(jsonFile, [
    {
      id: 'dhpk@dhpk',
      version: '0.0.1',
      scope: 'project',
      enabled: true,
      installPath: cachePath,
      readFromFolder: folderPath,
      folderVersion: SOURCE_VERSION,
      projectPath: project,
    },
  ]);

  const defaultRes = runInstallCli([
    'claude', 'status', '--project-root', project, '--json',
  ], {
    home,
    codexHome,
    binDir,
    env: {
      DHPK_TEST_CLAUDE_TEXT_FILE: textFile,
      DHPK_TEST_CLAUDE_JSON_FILE: jsonFile,
    },
  });
  assert.strictEqual(defaultRes.status, 0, 'default mode exits 0 even on drift');
  const report = parseJson(defaultRes, 'claude dual drift');
  const claude = report.surfaces.claude;
  const versionDiag = claude.diagnostics.find((d) => d.code === 'VERSION_DRIFT');
  const sourceDiag = claude.diagnostics.find((d) => d.code === 'SOURCE_MISMATCH');
  assert.ok(versionDiag, `expected VERSION_DRIFT in ${JSON.stringify(claude.diagnostics)}`);
  assert.ok(sourceDiag, `expected SOURCE_MISMATCH in ${JSON.stringify(claude.diagnostics)}`);
  assert.ok(versionDiag.evidence && versionDiag.evidence.text && versionDiag.evidence.json, 'VERSION_DRIFT must include both raw evidence blocks');
  assert.match(versionDiag.evidence.text.raw, new RegExp(SOURCE_VERSION.replace(/\./g, '\\.')));
  assert.strictEqual(versionDiag.evidence.json.raw.version, '0.0.1');
  assert.ok(sourceDiag.evidence && sourceDiag.evidence.text && sourceDiag.evidence.json, 'SOURCE_MISMATCH must include both raw evidence blocks');
  assert.match(sourceDiag.evidence.text.raw, /other-folder/);
  assert.strictEqual(sourceDiag.evidence.json.raw.readFromFolder, folderPath);

  const strictRes = runInstallCli([
    'claude', 'status', '--project-root', project, '--strict', '--json',
  ], {
    home,
    codexHome,
    binDir,
    env: {
      DHPK_TEST_CLAUDE_TEXT_FILE: textFile,
      DHPK_TEST_CLAUDE_JSON_FILE: jsonFile,
    },
  });
  assert.strictEqual(strictRes.status, 1, 'strict exits 1 on VERSION_DRIFT / SOURCE_MISMATCH');

  // Human output must also show both raw blocks and the explicit diagnostics
  const humanRes = runInstallCli([
    'claude', 'status', '--project-root', project,
  ], {
    home,
    codexHome,
    binDir,
    env: {
      DHPK_TEST_CLAUDE_TEXT_FILE: textFile,
      DHPK_TEST_CLAUDE_JSON_FILE: jsonFile,
    },
  });
  assert.strictEqual(humanRes.status, 0);
  assert.match(humanRes.stdout, /VERSION_DRIFT/);
  assert.match(humanRes.stdout, /SOURCE_MISMATCH/);
  assert.match(humanRes.stdout, /other-folder/);
  assert.match(humanRes.stdout, /folder-checkout/);
});

test('claude status reports shared caches, version pins, Asset Receipt status, broken links, legacy migrated links, and duplicates', () => {
  const { root, project, home, codexHome } = setupCleanEnv('claude-checks');
  // 1. Stale shared cache
  writeJson(path.join(home, '.claude', 'plugins', 'cache', 'dhpk', 'dhpk', '0.0.1', '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: '0.0.1' });
  // 2. Incompatible version pin
  writeJson(path.join(project, '.claude', 'dhpk-versions.json'), {
    verified: [{ range: '0.0.1', note: 'pinned old' }],
    incompatible: [{ range: SOURCE_VERSION, note: 'blocked by pin' }],
  });
  // 3. Asset receipt (#1585) with a modified file (drift)
  const assetTarget = path.join(project, '.claude', 'dhpk');
  writeFile(path.join(assetTarget, 'hooks', 'hooks.json'), '{"modified":true}\n');
  writeJson(path.join(assetTarget, '.dhpk-asset-receipt.json'), {
    schema: 'dhpk.asset-receipt.v1',
    source_version: '0.0.1',
    entries: [
      { anchor: 'target', path: 'hooks/hooks.json', sha256: '0'.repeat(64), source_version: '0.0.1' },
    ],
  });
  // 4. Broken symlink and legacy migrated link (generated/ and plugins/)
  fs.mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(root, 'missing-target'), path.join(project, '.claude', 'skills', 'broken-skill'));
  const legacyTarget = path.join(root, 'generated', 'skills', 'flow-guide');
  writeSkill(path.join(root, 'generated', 'skills'), 'flow-guide');
  fs.symlinkSync(legacyTarget, path.join(project, '.claude', 'skills', 'flow-guide'));
  // Duplicate skill in .agents/skills as well
  writeSkill(path.join(project, '.agents', 'skills'), 'flow-guide');

  const res = runInstallCli([
    'claude', 'status', '--project-root', project, '--offline', '--strict', '--json',
  ], { home, codexHome });
  assert.strictEqual(res.status, 1, `strict should exit 1 on drift/links/pins/duplicates\n${res.stdout}\n${res.stderr}`);
  const report = parseJson(res, 'claude checks');
  const claude = report.surfaces.claude;
  const codes = new Set(claude.diagnostics.map((d) => d.code));
  assert.ok(codes.has('CACHE_DRIFT'), `expected CACHE_DRIFT in ${[...codes]}`);
  assert.ok(codes.has('VERSION_PIN_MISMATCH'), `expected VERSION_PIN_MISMATCH in ${[...codes]}`);
  assert.ok(codes.has('BROKEN_LINK'), `expected BROKEN_LINK in ${[...codes]}`);
  assert.ok(codes.has('LEGACY_MIGRATED_LINK'), `expected LEGACY_MIGRATED_LINK in ${[...codes]}`);
  assert.ok(codes.has('DUPLICATE_DISCOVERY'), `expected DUPLICATE_DISCOVERY in ${[...codes]}`);
  assert.strictEqual(report.assetReceipt.present, true);
  assert.strictEqual(report.assetReceipt.valid, true);
  assert.strictEqual(report.assetReceipt.state, 'STALE');
  assert.strictEqual(report.assetReceipt.sourceVersion, '0.0.1');
  assert.strictEqual(claude.discovery.baseline.verdict, 'DUPLICATE');
});

test('strict exits 2 on blocked receipts (boundary blockers, invalid asset receipt, AGY blocked) and probe failures', () => {
  // Case A: codex-sync boundary blocker (0.66.6 receipt missing fingerprint_algorithm)
  {
    const { project, home, codexHome } = setupCleanEnv('blocked-codex');
    writeJson(path.join(project, '.codex', '.dhpk-installed.json'), {
      schema_version: 3,
      plugin_version: '0.66.6', // dhpk:historical-version-fixture
      mode: 'copy',
      state: 'partial',
      entries: {},
    });
    const before = snapshotTree(project);

    const defRes = runInstallCli(['codex-sync', 'status', '--project-root', project, '--offline', '--json'], { home, codexHome });
    assert.strictEqual(defRes.status, 0, defRes.stderr);
    const defReport = parseJson(defRes, 'codex blocked default');
    assert.strictEqual(defReport.surfaces['codex-sync'].state, 'BLOCKED');
    assert.ok(defReport.surfaces['codex-sync'].boundaryBlockers.some((b) => b.reasonCode === 'MISSING_FINGERPRINT_ALGORITHM'));

    const strictRes = runInstallCli(['codex-sync', 'status', '--project-root', project, '--offline', '--strict', '--json'], { home, codexHome });
    assert.strictEqual(strictRes.status, 2, strictRes.stderr);
    assert.strictEqual(snapshotTree(project), before);
  }

  // Case B: invalid Asset Receipt blocks under --strict with exit 2
  {
    const { project, home, codexHome } = setupCleanEnv('blocked-asset');
    writeFile(path.join(project, '.claude', 'dhpk', '.dhpk-asset-receipt.json'), '{not-json');
    const strictRes = runInstallCli(['claude', 'status', '--project-root', project, '--offline', '--strict', '--json'], { home, codexHome });
    assert.strictEqual(strictRes.status, 2, strictRes.stderr);
    const report = parseJson(strictRes, 'invalid asset receipt');
    assert.strictEqual(report.assetReceipt.valid, false);
  }

  // Case C: AGY unowned/foreign checkout blocks under --strict with exit 2
  {
    const { project, home, codexHome } = setupCleanEnv('blocked-agy');
    writeFile(path.join(home, '.gemini', 'antigravity-cli', 'plugins', 'dhpk', 'agents', 'sample.md'), '# unowned\n');
    const strictRes = runInstallCli(['agy-plugin', 'status', '--project-root', project, '--offline', '--strict', '--json'], { home, codexHome });
    assert.strictEqual(strictRes.status, 2, strictRes.stderr);
    const report = parseJson(strictRes, 'agy blocked');
    assert.strictEqual(report.surfaces['agy-plugin'].state, 'BLOCKED');
  }

  // Case D: Claude probe failure exits 0 by default and 2 under --strict
  {
    const { project, home, codexHome, binDir } = setupCleanEnv('probe-fail');
    writeStub(binDir, 'claude', CLAUDE_DUAL_STUB);
    const defRes = runInstallCli(['claude', 'status', '--project-root', project, '--json'], {
      home, codexHome, binDir, env: { DHPK_TEST_CLAUDE_JSON_EXIT: '7' },
    });
    assert.strictEqual(defRes.status, 0, defRes.stderr);
    const strictRes = runInstallCli(['claude', 'status', '--project-root', project, '--strict', '--json'], {
      home, codexHome, binDir, env: { DHPK_TEST_CLAUDE_JSON_EXIT: '7' },
    });
    assert.strictEqual(strictRes.status, 2, strictRes.stderr);
    const report = parseJson(strictRes, 'probe failure');
    assert.ok(report.surfaces.claude.diagnostics.some((d) => d.severity === 'blocked'));
  }

  // Case E: Codex live prompt-input probe failure exits 0 by default and 2 under --strict
  {
    const { project, home, codexHome, binDir } = setupCleanEnv('codex-probe-fail');
    writeStub(binDir, 'codex', CODEX_DUAL_STUB);
    const defRes = runInstallCli(['codex-sync', 'status', '--project-root', project, '--json'], {
      home, codexHome, binDir, env: { DHPK_TEST_CODEX_PROMPT_EXIT: '7' },
    });
    assert.strictEqual(defRes.status, 0, defRes.stderr);
    const strictRes = runInstallCli(['codex-sync', 'status', '--project-root', project, '--strict', '--json'], {
      home, codexHome, binDir, env: { DHPK_TEST_CODEX_PROMPT_EXIT: '7' },
    });
    assert.strictEqual(strictRes.status, 2, strictRes.stderr);
    const report = parseJson(strictRes, 'codex probe failure');
    assert.ok(report.surfaces['codex-sync'].diagnostics.some((d) => d.code === 'CODEX_PROBE_FAILED' && d.severity === 'blocked'));
  }
});

test('cursor status reports hash-cache drift warnings and codex-native reports package + live CLI probe', () => {
  const { root, project, home, codexHome, binDir } = setupCleanEnv('cursor-codex-native');
  writeStub(binDir, 'codex', CODEX_DUAL_STUB);
  const codexPluginFile = path.join(root, 'codex-plugin.json');
  writeJson(codexPluginFile, {
    installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version: '0.0.1' }],
  });
  // Cursor stale hash cache + local symlink pointing to legacy plugins/
  writeJson(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'), { name: 'dhpk-agent', version: SOURCE_VERSION });
  writeJson(path.join(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', 'stalehash', '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: '0.0.1' });

  const res = runInstallCli([
    'status', '--all', '--project-root', project, '--strict', '--json',
  ], {
    home,
    codexHome,
    binDir,
    env: { DHPK_TEST_CODEX_PLUGIN_FILE: codexPluginFile },
  });
  assert.strictEqual(res.status, 1, `expected exit 1 for cache drift + codex-native version drift\n${res.stdout}\n${res.stderr}`);
  const report = parseJson(res, 'cursor and codex-native');
  assert.ok(report.surfaces.cursor.diagnostics.some((d) => d.code === 'CACHE_DRIFT'));
  assert.strictEqual(report.surfaces['codex-native'].cli.status, 'ENABLED');
  assert.ok(report.surfaces['codex-native'].diagnostics.some((d) => d.code === 'VERSION_DRIFT'));
});

test('codex-sync status reports unowned collisions from plan-boundary inspection', () => {
  const { project, home, codexHome } = setupCleanEnv('codex-collision');
  const install = runInstallCli(['codex-sync', 'install', '--project-root', project, '--mode', 'copy', '--json'], { home, codexHome });
  assert.strictEqual(install.status, 0, install.stderr);
  // Introduce a local modification to a receipt-owned agent to create an unowned/modified collision or stale diff
  const agentFile = path.join(project, '.codex', 'agents', 'explorer.toml');
  fs.appendFileSync(agentFile, '\n# local edit\n');
  const before = snapshotTree(project);

  const res = runInstallCli(['codex-sync', 'status', '--project-root', project, '--offline', '--strict', '--json'], { home, codexHome });
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  const report = parseJson(res, 'codex collision');
  assert.strictEqual(report.surfaces['codex-sync'].installed, true);
  assert.ok(['STALE', 'DRIFT'].includes(report.surfaces['codex-sync'].state));
  assert.ok(report.surfaces['codex-sync'].diagnostics.some((d) => d.severity === 'drift'));
  assert.strictEqual(snapshotTree(project), before);
});

test('status performs zero filesystem writes (including install-history) on installed codex-sync and cursor projects', () => {
  const { root, project, home, codexHome } = setupCleanEnv('installed-zero-writes');
  const xdgStateHome = path.join(root, 'xdg-state');
  const historyFile = path.join(xdgStateHome, 'dhpk', 'install-history.jsonl');
  const cliOptions = { home, codexHome, env: { XDG_STATE_HOME: xdgStateHome } };
  for (const host of ['codex-sync', 'cursor']) {
    const install = runInstallCli([host, 'install', '--project-root', project, '--mode', 'copy', '--json'], cliOptions);
    assert.strictEqual(install.status, 0, `${host} install: ${install.stderr}`);
  }

  const historyAfterInstall = fs.readFileSync(historyFile, 'utf8');
  const beforeRoot = snapshotTree(root);

  for (const args of [
    ['status', '--all', '--project-root', project, '--offline', '--json'],
    ['codex-sync', 'status', '--project-root', project, '--offline', '--json'],
    ['cursor', 'status', '--project-root', project, '--offline', '--json'],
  ]) {
    const res = runInstallCli(args, cliOptions);
    assert.strictEqual(res.status, 0, `${args.join(' ')}: ${res.stderr}`);
    assert.strictEqual(res.stderr, '', `${args.join(' ')} unexpected stderr: ${res.stderr}`);
  }

  assert.strictEqual(fs.readFileSync(historyFile, 'utf8'), historyAfterInstall, 'status must not append install-history');
  assert.strictEqual(snapshotTree(root), beforeRoot, 'status must perform zero filesystem writes across project, home, and XDG_STATE_HOME');
});

run('dhpk-install-status');
