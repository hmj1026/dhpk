'use strict';

// CLI boundary for dual-layer Duplicate Discovery (#1583). Host CLIs are
// PATH stubs; project and home roots are disposable directories.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');

const CLI = path.join(__dirname, '..', 'scripts', 'ci', 'check-duplicate-discovery.js');

// The 13 Codex pairs left after #1558 retired only change-verdict.
const CODEX_PAIRS = Object.freeze([
  'code-trace',
  'create-pr',
  'doc-maintain',
  'flow-drive',
  'flow-guide',
  'git-smart-commit',
  'git-worktree',
  'precommit',
  'proposal-analyze',
  'release-creator',
  'repo-verify',
  'tdd-workflow',
  'ui-ux-verify',
]);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSkill(parent, name) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
  return dir;
}

function writeStub(bin, name, body) {
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
}

const CODEX_STUB = `#!/bin/sh
if [ -n "\${DHPK_TEST_HOST_MARKER:-}" ]; then
  : > "$DHPK_TEST_HOST_MARKER"
fi
printf '%s\\n' 'stub-stderr' >&2
if [ "$1" = "debug" ] && [ "$2" = "prompt-input" ]; then
  if [ -n "\${DHPK_TEST_CODEX_SKILLS_FILE:-}" ]; then
    /bin/cat "$DHPK_TEST_CODEX_SKILLS_FILE"
  fi
  exit "\${DHPK_TEST_CODEX_EXIT:-0}"
fi
exit 2
`;

const CLAUDE_STUB = `#!/bin/sh
if [ -n "\${DHPK_TEST_HOST_MARKER:-}" ]; then
  : > "$DHPK_TEST_HOST_MARKER"
fi
printf '%s\\n' 'stub-stderr' >&2
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ -n "\${DHPK_TEST_CLAUDE_PLUGINS_FILE:-}" ]; then
    /bin/cat "$DHPK_TEST_CLAUDE_PLUGINS_FILE"
  fi
  exit "\${DHPK_TEST_CLAUDE_EXIT:-0}"
fi
exit 2
`;

function runCli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20000,
  });
}

function parseReport(result) {
  assert.strictEqual(result.error, undefined, result.stderr);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`stdout is not JSON (${error.message}): ${result.stdout}\n${result.stderr}`);
  }
  return report;
}

function codexPrompt(skills) {
  const roots = [];
  const rootIds = new Map();
  const lines = ['<skills_instructions>', '### Skill roots'];
  for (const skill of skills) {
    if (!rootIds.has(skill.root)) {
      const id = `r${rootIds.size}`;
      rootIds.set(skill.root, id);
      roots.push(`- \`${id}\` = \`${skill.root}\``);
    }
  }
  lines.push(...roots, '### Available skills');
  for (const skill of skills) {
    lines.push(`- ${skill.name}: demo (file: ${rootIds.get(skill.root)}/${skill.name}/SKILL.md)`);
  }
  lines.push('</skills_instructions>');
  return JSON.stringify([{
    type: 'message',
    content: [{ type: 'input_text', text: lines.join('\n') }],
  }]);
}

test('codex baseline reports 13 receipt-owned pairs, plugin overlap, and preserved third-party skills', () => {
  const root = makeTempDir('dhpk-dup-codex-');
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const codexHome = path.join(home, '.codex');
  const pluginRoot = path.join(root, 'codex-plugin');
  const disabledRoot = path.join(root, 'codex-plugin-disabled');
  const marker = path.join(root, 'spawned');
  for (const name of CODEX_PAIRS) {
    writeSkill(path.join(project, '.agents', 'skills'), name);
    writeSkill(path.join(project, '.codex', 'skills'), name);
  }
  writeSkill(path.join(project, '.codex', 'skills'), 'code-review');
  writeSkill(path.join(codexHome, 'skills'), 'code-simplify');
  writeSkill(path.join(codexHome, 'skills'), 'library-author');
  writeSkill(path.join(pluginRoot, 'skills'), 'code-simplify');
  writeSkill(path.join(disabledRoot, 'skills'), 'library-author');
  writeJson(path.join(project, '.agents', '.dhpk-installed.json'), {
    entries: CODEX_PAIRS.map((name) => ({ name, stableId: name })),
  });
  writeJson(path.join(project, '.codex', '.dhpk-installed.json'), {
    managed_entries: {
      skills: Object.fromEntries(CODEX_PAIRS.map((name) => [name, { destination: `skills/${name}` }])),
    },
  });
  writeJson(path.join(codexHome, 'plugins', 'installed_plugins.json'), {
    installed: [
      { pluginId: 'dhpk@dhpk', enabled: true, installPath: pluginRoot },
      { pluginId: 'dhpk@dhpk', enabled: false, installPath: disabledRoot },
    ],
  });

  const result = runCli([
    '--project-root', project,
    '--home', home,
    '--codex-home', codexHome,
    '--host', 'codex',
    '--offline',
  ], { HOME: home, CODEX_HOME: codexHome, DHPK_TEST_HOST_MARKER: marker, PATH: path.join(root, 'empty-path') });
  assert.strictEqual(result.status, 1, result.stderr);
  const report = parseReport(result);
  assert.strictEqual(report.schema, 'dhpk.duplicate-discovery.v1');
  assert.strictEqual(report.offline, true);
  const baseline = report.hosts.codex.baseline;
  const pairs = baseline.duplicates.filter((duplicate) => CODEX_PAIRS.includes(duplicate.skillIdentity));
  assert.strictEqual(pairs.length, 13, JSON.stringify(baseline.duplicates.map((duplicate) => duplicate.skillIdentity)));
  for (const pair of pairs) {
    assert.strictEqual(pair.entries.length, 2, pair.skillIdentity);
    assert.deepStrictEqual(pair.entries.map((entry) => entry.discoverySource).sort(), ['codex-project-skills', 'shared-projection']);
    assert.ok(pair.entries.every((entry) => entry.ownershipClass === 'receipt-owned' && entry.scope === 'project' && entry.pluginId === null));
    assert.deepStrictEqual(pair.entries.map((entry) => entry.path).sort(), [
      path.join(project, '.agents', 'skills', pair.skillIdentity),
      path.join(project, '.codex', 'skills', pair.skillIdentity),
    ].sort());
  }
  const simplify = baseline.duplicates.find((duplicate) => duplicate.skillIdentity === 'code-simplify');
  assert.ok(simplify, 'enabled plugin root must participate in the baseline');
  assert.deepStrictEqual(simplify.entries.map((entry) => entry.ownershipClass).sort(), ['plugin', 'unmanaged']);
  assert.strictEqual(simplify.entries.find((entry) => entry.ownershipClass === 'plugin').pluginId, 'dhpk@dhpk');
  assert.strictEqual(simplify.entries.find((entry) => entry.ownershipClass === 'plugin').path, path.join(pluginRoot, 'skills', 'code-simplify'));
  assert.ok(!baseline.duplicates.some((duplicate) => duplicate.skillIdentity === 'library-author'), 'disabled plugin root is not a discovery source');
  assert.ok(!baseline.duplicates.some((duplicate) => duplicate.skillIdentity === 'code-review'));
  const preserved = baseline.preserved.find((entry) => entry.skillIdentity === 'code-review');
  assert.ok(preserved);
  assert.strictEqual(preserved.ownershipClass, 'third-party');
  assert.strictEqual(preserved.path, path.join(project, '.codex', 'skills', 'code-review'));
  assert.strictEqual(baseline.verdict, 'DUPLICATE');
  assert.strictEqual(report.hosts.codex.live.verdict, 'NOT_RUN');
  assert.notStrictEqual(report.hosts.codex.live.verdict, 'PASS');
  assert.strictEqual(report.hosts.codex.live.probe, null);
  assert.strictEqual(fs.existsSync(marker), false, 'offline must not spawn a Host CLI');
});

test('claude baseline names bare-name and enabled plugin overlaps offline, including user scope', () => {
  const root = makeTempDir('dhpk-dup-claude-');
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const fullPlugin = path.join(root, 'full-plugin');
  const litePlugin = path.join(root, 'lite-plugin');
  const disabledPlugin = path.join(root, 'disabled-plugin');
  const marker = path.join(root, 'spawned');
  const bin = path.join(root, 'bin');
  writeStub(bin, 'claude', CLAUDE_STUB);
  writeStub(bin, 'codex', CODEX_STUB);
  writeSkill(path.join(project, '.claude', 'skills'), 'flow-guide');
  writeSkill(path.join(home, '.claude', 'skills'), 'tdd-workflow');
  writeSkill(path.join(home, '.claude', 'skills'), 'vendor-skill');
  writeSkill(path.join(project, '.claude', 'skills'), 'library-author');
  writeSkill(path.join(fullPlugin, 'skills'), 'flow-guide');
  writeSkill(path.join(litePlugin, 'skills'), 'tdd-workflow');
  writeSkill(path.join(disabledPlugin, 'skills'), 'library-author');
  writeJson(path.join(project, '.agents', '.dhpk-installed.json'), {
    entries: [{ name: 'flow-guide', stableId: 'flow-guide' }],
  });
  writeJson(path.join(home, '.claude', 'settings.json'), {
    enabledPlugins: {
      'dhpk@dhpk': true,
      'dhpk-lite@claude-plugins-official': true,
      'dhpk-lite@disabled': false,
    },
  });
  writeJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'dhpk@dhpk': [{ scope: 'user', installPath: fullPlugin, version: '1.2.3' }],
      'dhpk-lite@claude-plugins-official': [{ scope: 'user', installPath: litePlugin, version: '1.2.3' }],
      'dhpk-lite@disabled': [{ scope: 'user', installPath: disabledPlugin, version: '1.2.3' }],
    },
  });

  const result = runCli([
    '--project-root', project,
    '--home', home,
    '--host', 'claude',
    '--offline',
  ], { HOME: home, PATH: bin, DHPK_TEST_HOST_MARKER: marker });
  assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const report = parseReport(result);
  const baseline = report.hosts.claude.baseline;
  const flow = baseline.duplicates.find((duplicate) => duplicate.skillIdentity === 'flow-guide');
  const workflow = baseline.duplicates.find((duplicate) => duplicate.skillIdentity === 'tdd-workflow');
  assert.ok(flow && workflow);
  assert.strictEqual(flow.entries.find((entry) => entry.ownershipClass === 'receipt-owned').path, path.join(project, '.claude', 'skills', 'flow-guide'));
  assert.strictEqual(flow.entries.find((entry) => entry.ownershipClass === 'receipt-owned').scope, 'project');
  assert.strictEqual(flow.entries.find((entry) => entry.ownershipClass === 'plugin').path, path.join(fullPlugin, 'skills', 'flow-guide'));
  assert.strictEqual(flow.entries.find((entry) => entry.ownershipClass === 'plugin').pluginId, 'dhpk@dhpk');
  assert.strictEqual(workflow.entries.find((entry) => entry.ownershipClass === 'unmanaged').path, path.join(home, '.claude', 'skills', 'tdd-workflow'));
  assert.strictEqual(workflow.entries.find((entry) => entry.ownershipClass === 'unmanaged').scope, 'user');
  assert.strictEqual(workflow.entries.find((entry) => entry.ownershipClass === 'plugin').pluginId, 'dhpk-lite@claude-plugins-official');
  assert.ok(!baseline.duplicates.some((duplicate) => duplicate.skillIdentity === 'library-author'));
  const preserved = baseline.preserved.find((entry) => entry.skillIdentity === 'vendor-skill');
  assert.ok(preserved);
  assert.strictEqual(preserved.ownershipClass, 'third-party');
  assert.strictEqual(report.hosts.claude.live.verdict, 'NOT_RUN');
  assert.notStrictEqual(report.hosts.claude.live.verdict, 'PASS');
  assert.strictEqual(report.hosts.claude.live.probe, null);
  assert.strictEqual(fs.existsSync(marker), false);
});

test('live Host readback stays separate from the baseline and preserves probe status', () => {
  const root = makeTempDir('dhpk-dup-live-');
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const codexHome = path.join(home, '.codex');
  const bin = path.join(root, 'bin');
  const baseArgs = ['--project-root', project, '--home', home, '--codex-home', codexHome];
  fs.mkdirSync(project, { recursive: true });
  writeStub(bin, 'codex', CODEX_STUB);
  writeStub(bin, 'claude', CLAUDE_STUB);
  const skillsFile = path.join(root, 'skills.json');
  const left = path.join(root, 'live-a');
  const right = path.join(root, 'live-b');
  fs.writeFileSync(skillsFile, codexPrompt([
    { name: 'flow-guide', root: left },
    { name: 'flow-guide', root: right },
    { name: 'imagegen', root: left },
  ]));
  const listed = runCli([
    ...baseArgs,
    '--host', 'codex',
  ], {
    HOME: home,
    CODEX_HOME: codexHome,
    PATH: bin,
    DHPK_TEST_CODEX_SKILLS_FILE: skillsFile,
    DHPK_TEST_CODEX_EXIT: '0',
  });
  assert.strictEqual(listed.status, 1, `${listed.stdout}\n${listed.stderr}`);
  const listedReport = parseReport(listed);
  assert.strictEqual(listedReport.hosts.codex.baseline.verdict, 'PASS');
  assert.strictEqual(listedReport.hosts.codex.live.verdict, 'DUPLICATE');
  assert.notStrictEqual(listedReport.hosts.codex.live.verdict, listedReport.hosts.codex.baseline.verdict);
  const livePair = listedReport.hosts.codex.live.duplicates.find((duplicate) => duplicate.skillIdentity === 'flow-guide');
  assert.ok(livePair);
  assert.deepStrictEqual(livePair.entries.map((entry) => entry.path).sort(), [
    path.join(left, 'flow-guide'),
    path.join(right, 'flow-guide'),
  ].sort());
  assert.ok(!listedReport.hosts.codex.live.duplicates.some((duplicate) => duplicate.skillIdentity === 'imagegen'));
  assert.strictEqual(listedReport.hosts.codex.live.probe.command, 'codex');
  assert.deepStrictEqual(listedReport.hosts.codex.live.probe.args, ['debug', 'prompt-input']);
  assert.strictEqual(listedReport.hosts.codex.live.probe.exitCode, 0);
  assert.strictEqual(listedReport.hosts.codex.live.probe.timedOut, false);
  assert.strictEqual(typeof listedReport.hosts.codex.live.probe.durationMs, 'number');
  assert.match(listedReport.hosts.codex.live.probe.stdoutTail, /flow-guide/);
  assert.match(listedReport.hosts.codex.live.probe.stderrTail, /stub-stderr/);

  const timedOut = runCli([
    ...baseArgs,
    '--host', 'codex',
  ], { HOME: home, CODEX_HOME: codexHome, PATH: bin, DHPK_TEST_CODEX_EXIT: '124', DHPK_TEST_CODEX_SKILLS_FILE: skillsFile });
  assert.strictEqual(timedOut.status, 0, timedOut.stderr);
  const timedReport = parseReport(timedOut);
  assert.strictEqual(timedReport.hosts.codex.baseline.verdict, 'PASS');
  assert.strictEqual(timedReport.hosts.codex.live.verdict, 'UNAVAILABLE');
  assert.notStrictEqual(timedReport.hosts.codex.live.verdict, 'PASS');
  assert.strictEqual(timedReport.hosts.codex.live.probe.exitCode, 124);
  assert.strictEqual(timedReport.hosts.codex.live.probe.timedOut, true);
  assert.match(timedReport.hosts.codex.live.probe.stderrTail, /stub-stderr/);

  const failed = runCli([
    ...baseArgs,
    '--host', 'claude',
  ], { HOME: home, CODEX_HOME: codexHome, PATH: bin, DHPK_TEST_CLAUDE_EXIT: '7' });
  assert.strictEqual(failed.status, 0, failed.stderr);
  const failedReport = parseReport(failed);
  assert.strictEqual(failedReport.hosts.claude.baseline.verdict, 'PASS');
  assert.strictEqual(failedReport.hosts.claude.live.verdict, 'UNAVAILABLE');
  assert.strictEqual(failedReport.hosts.claude.live.probe.exitCode, 7);
  assert.strictEqual(failedReport.hosts.claude.live.probe.timedOut, false);
  assert.deepStrictEqual(failedReport.hosts.claude.live.probe.args, ['plugin', 'list', '--json']);

  const pluginsFile = path.join(root, 'plugins.json');
  fs.writeFileSync(pluginsFile, JSON.stringify({
    plugins: [
      { id: 'dhpk@dhpk', enabled: true, scope: 'user', installPath: path.join(root, 'full') },
      { id: 'dhpk-lite@claude-plugins-official', enabled: true, scope: 'user', installPath: path.join(root, 'lite') },
      { id: 'other@example', enabled: true, scope: 'user' },
    ],
  }));
  const both = runCli([
    ...baseArgs,
    '--host', 'claude',
  ], { HOME: home, CODEX_HOME: codexHome, PATH: bin, DHPK_TEST_CLAUDE_PLUGINS_FILE: pluginsFile, DHPK_TEST_CLAUDE_EXIT: '0' });
  assert.strictEqual(both.status, 1, `${both.stdout}\n${both.stderr}`);
  const bothReport = parseReport(both);
  assert.strictEqual(bothReport.hosts.claude.baseline.verdict, 'PASS');
  assert.strictEqual(bothReport.hosts.claude.live.verdict, 'DUPLICATE');
  const pluginIds = bothReport.hosts.claude.live.duplicates.flatMap((duplicate) => duplicate.entries.map((entry) => entry.pluginId)).sort();
  assert.deepStrictEqual(pluginIds, ['dhpk-lite@claude-plugins-official', 'dhpk@dhpk']);

  const missing = runCli([
    ...baseArgs,
    '--host', 'all',
  ], { HOME: home, CODEX_HOME: codexHome, PATH: path.join(root, 'missing-bin') });
  assert.strictEqual(missing.status, 0, missing.stderr);
  const missingReport = parseReport(missing);
  assert.strictEqual(missingReport.hosts.codex.baseline.verdict, 'PASS');
  assert.strictEqual(missingReport.hosts.claude.baseline.verdict, 'PASS');
  assert.strictEqual(missingReport.hosts.codex.live.verdict, 'UNAVAILABLE');
  assert.strictEqual(missingReport.hosts.claude.live.verdict, 'UNAVAILABLE');
  assert.notStrictEqual(missingReport.hosts.codex.live.verdict, 'PASS');
  assert.strictEqual(missingReport.hosts.codex.live.probe.exitCode, null);
  assert.strictEqual(missingReport.hosts.codex.live.probe.timedOut, false);
});

test('invalid arguments exit 2 without a JSON body', () => {
  const result = runCli(['--host', 'cursor'], {});
  assert.strictEqual(result.status, 2, result.stderr);
  assert.strictEqual(result.stdout, '');
  assert.match(result.stderr, /check-duplicate-discovery/);
});

run('duplicate-discovery');
