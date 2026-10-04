'use strict';

// CLI-level coverage for scripts/release/consumer-gate.js. Stubs the `claude`
// and `codex` binaries (same pattern as tests/release-runner.test.js) so
// this suite NEVER touches the real global Claude plugin cache or a real
// Codex install — consumer-gate.js is only ever run for real inside the
// tag-triggered release.yml job, on an ephemeral, clean CI runner.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'consumer-gate.js');
const {
  discoverCodexSurface,
  discoverCodexSurfaces,
  evaluateCodexSurfaceMatrix,
  fingerprintDir,
  fingerprintPath,
  fingerprintProjectSkill,
  redactEvidence,
  runCodexNamedRoleProbe,
  validateCodexAgentMaterialization,
} = require(CLI);
const { inspectCodexDiscovery } = require('../scripts/lib/codex-discovery-registry');
const { normalizeConsumerEvidence } = require('../scripts/lib/release-evidence');

function mkBinStub(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

function withConsumerGateBin(fn) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-bin-'));
  try {
    return fn(bin);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

// PATH containing real node/bash but deliberately excluding wherever the
// real `claude` CLI lives, so "claude absent" is genuinely absent rather
// than relying on ordering against the host's real PATH.
const NODE_BASH_ONLY_PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);

// The codex-sync check verifies the installed manifest version against the
// target; use the real repo's own current version so these tests don't
// depend on a fixture package tree.
const REAL_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function projectRootForCodexProbe() {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-role-probe-')));
  const agents = path.join(project, '.codex', 'agents');
  fs.mkdirSync(path.join(project, '.git'));
  fs.mkdirSync(agents, { recursive: true });
  for (const role of ['explorer', 'deep-reasoner', 'code-reviewer', 'doc-reviewer']) {
    fs.writeFileSync(path.join(agents, `${role}.toml`), [
      `name = "${role}"`,
      `description = "Fixture ${role} role"`,
      'developer_instructions = "Complete the standalone probe task and report the result."',
      '',
    ].join('\n'));
  }
  return project;
}

test('Codex consumer validation rejects linked agent roles and mismatched receipt modes', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-agent-shape-')));
  try {
    const agents = path.join(project, '.codex', 'agents');
    fs.mkdirSync(agents, { recursive: true });
    const source = path.join(project, 'source.toml');
    fs.writeFileSync(source, 'name = "demo"\n');
    fs.copyFileSync(source, path.join(agents, 'physical.toml'));
    fs.symlinkSync(source, path.join(agents, 'linked.toml'));
    const manifest = {
      managed_entries: {
        agents: {
          'physical.toml': { destination: 'agents/physical.toml', mode: 'symlink' },
          'linked.toml': { destination: 'agents/linked.toml', mode: 'symlink' },
        },
      },
    };

    const errors = validateCodexAgentMaterialization(project, manifest);
    assert.ok(errors.some((error) => /physical\.toml.*mode.*copy/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /linked\.toml.*physical|linked\.toml.*symlink/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Codex named-role probe relies on physical project-role auto-discovery and rejects ELOOP', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'codex-argv.log');
    const homeLog = path.join(bin, 'codex-home.log');
    const configLog = path.join(bin, 'codex-config.log');
    const configModeLog = path.join(bin, 'codex-config-mode.log');
    const authTargetLog = path.join(bin, 'codex-auth-target.log');
    const sourceCodexHome = path.join(bin, 'source-codex-home');
    const sourceAuth = path.join(sourceCodexHome, 'auth.json');
    fs.mkdirSync(sourceCodexHome);
    fs.writeFileSync(sourceAuth, '{"fixture":"unchanged"}\n', { mode: 0o600 });
    mkBinStub(bin, 'codex', `#!/bin/sh
printf '%s\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
printf '%s\n' "$CODEX_HOME" > ${JSON.stringify(homeLog)}
cat "$CODEX_HOME/config.toml" > ${JSON.stringify(configLog)}
mode=$(stat -c '%a' "$CODEX_HOME/config.toml" 2>/dev/null || stat -f '%Lp' "$CODEX_HOME/config.toml")
printf '%s\n' "$mode" > ${JSON.stringify(configModeLog)}
readlink "$CODEX_HOME/auth.json" > ${JSON.stringify(authTargetLog)}
SESS="$CODEX_HOME/sessions/2026/01/01"
mkdir -p "$SESS"
printf '%s\n' '{"type":"session_meta","payload":{"id":"parent-1","thread_source":"root"}}' > "$SESS/rollout-parent.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-explorer","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"explorer","agent_path":"/root/dhpk_probe_explorer"}}' > "$SESS/rollout-explorer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-explorer.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-deep","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"deep-reasoner","agent_path":"/root/dhpk_probe_deep_reasoner"}}' > "$SESS/rollout-deep-reasoner.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-deep-reasoner.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-code","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"code-reviewer","agent_path":"/root/dhpk_probe_code_reviewer"}}' > "$SESS/rollout-code-reviewer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-code-reviewer.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-doc","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"doc-reviewer","agent_path":"/root/dhpk_probe_doc_reviewer"}}' > "$SESS/rollout-doc-reviewer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-doc-reviewer.jsonl"
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_DHPK_NAMED_ROLES=PASS"}}'
exit 0
`);
    const project = projectRootForCodexProbe();
    try {
      const result = runCodexNamedRoleProbe(project, {
        env: { ...process.env, CODEX_HOME: sourceCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(result.status, 'PASS', JSON.stringify(result));
      assert.deepStrictEqual(result.runtimeEvidence, {
        registryPreconditions: {
          disposableCodexHome: true,
          authReference: 'symlink',
          projectTrust: 'trusted',
          userConfigIgnored: false,
        },
        roles: [
          { id: 'explorer', agentTypeAccepted: true, threadId: 'thread-explorer', childCompleted: true },
          { id: 'deep-reasoner', agentTypeAccepted: true, threadId: 'thread-deep', childCompleted: true },
          { id: 'code-reviewer', agentTypeAccepted: true, threadId: 'thread-code', childCompleted: true },
          { id: 'doc-reviewer', agentTypeAccepted: true, threadId: 'thread-doc', childCompleted: true },
        ],
      });
      const argv = fs.readFileSync(log, 'utf8');
      for (const role of ['explorer', 'deep-reasoner', 'code-reviewer', 'doc-reviewer']) {
        assert.doesNotMatch(argv, new RegExp(`agents\\.\\"${role}\\"\\.config_file`), argv);
        assert.match(argv, new RegExp(`task_name=\\"dhpk_probe_${role.replace(/-/g, '_')}\\"`), argv);
      }
      assert.doesNotMatch(argv, /-c agents\./, argv);
      assert.doesNotMatch(argv, /--ignore-user-config/, argv);
      assert.doesNotMatch(argv, /--ephemeral/, argv);
      const disposableCodexHome = fs.readFileSync(homeLog, 'utf8').trim();
      assert.notStrictEqual(disposableCodexHome, sourceCodexHome);
      assert.strictEqual(fs.existsSync(disposableCodexHome), false);
      assert.strictEqual(fs.readFileSync(authTargetLog, 'utf8').trim(), sourceAuth);
      assert.strictEqual(fs.readFileSync(configModeLog, 'utf8').trim(), '600');
      assert.strictEqual(fs.readFileSync(configLog, 'utf8'), [
        `[projects.${JSON.stringify(project)}]`,
        'trust_level = "trusted"',
        '',
      ].join('\n'));
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }

    mkBinStub(bin, 'codex', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"spawn_agent does not support an agent_type parameter, so the requested role cannot be typed"}}'
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_DHPK_NAMED_ROLES=PASS"}}'
exit 0
`);
    const falsePositiveProject = projectRootForCodexProbe();
    try {
      const falsePositive = runCodexNamedRoleProbe(falsePositiveProject, {
        env: { ...process.env, CODEX_HOME: sourceCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(falsePositive.status, 'FAIL', JSON.stringify(falsePositive));
      assert.strictEqual(falsePositive.reasonCode, 'CUSTOM_AGENT_REGISTRY_UNAVAILABLE');
      assert.match(falsePositive.diagnostic, /spawn|dispatch evidence|receiver/i);
    } finally {
      fs.rmSync(falsePositiveProject, { recursive: true, force: true });
    }

    mkBinStub(bin, 'codex', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
SESS="$CODEX_HOME/sessions/2026/01/01"
mkdir -p "$SESS"
printf '%s\n' '{"type":"session_meta","payload":{"id":"parent-1","thread_source":"root"}}' > "$SESS/rollout-parent.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-shared","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"explorer","agent_path":"/root/dhpk_probe_explorer"}}' > "$SESS/rollout-explorer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-explorer.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-shared","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"deep-reasoner","agent_path":"/root/dhpk_probe_deep_reasoner"}}' > "$SESS/rollout-deep-reasoner.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-deep-reasoner.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-shared","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"code-reviewer","agent_path":"/root/dhpk_probe_code_reviewer"}}' > "$SESS/rollout-code-reviewer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-code-reviewer.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-shared","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"doc-reviewer","agent_path":"/root/dhpk_probe_doc_reviewer"}}' > "$SESS/rollout-doc-reviewer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-doc-reviewer.jsonl"
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_DHPK_NAMED_ROLES=PASS"}}'
exit 0
`);
    const aliasedProject = projectRootForCodexProbe();
    try {
      const aliased = runCodexNamedRoleProbe(aliasedProject, {
        env: { ...process.env, CODEX_HOME: sourceCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(aliased.status, 'FAIL', JSON.stringify(aliased));
      assert.match(aliased.diagnostic, /distinct|spawn evidence|receiver/i);
    } finally {
      fs.rmSync(aliasedProject, { recursive: true, force: true });
    }

    mkBinStub(bin, 'codex', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
SESS="$CODEX_HOME/sessions/2026/01/01"
mkdir -p "$SESS"
printf '%s\n' '{"type":"session_meta","payload":{"id":"parent-1","thread_source":"root"}}' > "$SESS/rollout-parent.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-explorer","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"explorer","agent_path":"/root/dhpk_probe_explorer"}}' > "$SESS/rollout-explorer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-explorer.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-deep","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"deep-reasoner","agent_path":"/root/dhpk_probe_deep_reasoner"}}' > "$SESS/rollout-deep-reasoner.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-deep-reasoner.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-code","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"code-reviewer","agent_path":"/root/dhpk_probe_code_reviewer"}}' > "$SESS/rollout-code-reviewer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-code-reviewer.jsonl"
printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-doc","thread_source":"subagent","parent_thread_id":"parent-1","agent_role":"doc-reviewer","agent_path":"/root/dhpk_probe_doc_reviewer"}}' > "$SESS/rollout-doc-reviewer.jsonl"
printf '%s\n' '{"type":"event_msg","payload":{"type":"task_complete"}}' >> "$SESS/rollout-doc-reviewer.jsonl"
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_DHPK_NAMED_ROLES=PASS"}}' >&2
echo 'CODEX_DHPK_NAMED_ROLES=PASS marker only present on stderr, not stdout' >&2
exit 0
`);
    const stderrProject = projectRootForCodexProbe();
    try {
      const stderrOnly = runCodexNamedRoleProbe(stderrProject, {
        env: { ...process.env, CODEX_HOME: sourceCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(stderrOnly.status, 'FAIL', JSON.stringify(stderrOnly));
      assert.match(stderrOnly.diagnostic, /stdout|spawn evidence|receiver/i);
    } finally {
      fs.rmSync(stderrProject, { recursive: true, force: true });
    }

    mkBinStub(bin, 'codex', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
echo 'failed to apply role to config: Symbolic link loop (os error 40)' >&2
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_DHPK_NAMED_ROLES=FAIL"}}'
exit 0
`);
    const failedProject = projectRootForCodexProbe();
    try {
      const failed = runCodexNamedRoleProbe(failedProject, {
        env: { ...process.env, CODEX_HOME: sourceCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(failed.status, 'FAIL', JSON.stringify(failed));
      assert.strictEqual(failed.reasonCode, undefined);
      assert.match(failed.diagnostic, /Symbolic link loop|os error 40/i);
    } finally {
      fs.rmSync(failedProject, { recursive: true, force: true });
    }

    mkBinStub(bin, 'codex', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
echo 'remote worker service unavailable' >&2
exit 1
`);
    const genericFailureProject = projectRootForCodexProbe();
    try {
      const genericFailure = runCodexNamedRoleProbe(genericFailureProject, {
        env: { ...process.env, CODEX_HOME: sourceCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(genericFailure.status, 'FAIL', JSON.stringify(genericFailure));
      assert.strictEqual(genericFailure.reasonCode, undefined);
      assert.match(genericFailure.diagnostic, /remote worker service unavailable/i);
    } finally {
      fs.rmSync(genericFailureProject, { recursive: true, force: true });
    }
  });
});

test('Codex named-role probe blocks when the source auth file is unavailable', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'codex', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; exit 0; fi
exit 99
`);
    const project = projectRootForCodexProbe();
    const emptyCodexHome = path.join(bin, 'empty-codex-home');
    fs.mkdirSync(emptyCodexHome);
    try {
      const result = runCodexNamedRoleProbe(project, {
        env: { ...process.env, CODEX_HOME: emptyCodexHome, PATH: `${bin}:${NODE_BASH_ONLY_PATH}` },
      });
      assert.strictEqual(result.status, 'BLOCKED', JSON.stringify(result));
      assert.strictEqual(result.reasonCode, undefined);
      assert.match(result.diagnostic, /auth\.json/i);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

test('Codex named-role probe reports NOT_RUN when the CLI is absent', () => {
  const project = projectRootForCodexProbe();
  try {
    const result = runCodexNamedRoleProbe(project, {
      env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
    });
    assert.strictEqual(result.status, 'NOT_RUN', JSON.stringify(result));
    assert.match(result.diagnostic, /codex CLI not found/i);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

function runCli(env, extraArgs = []) {
  return runCliAtRoot(ROOT, env, extraArgs);
}

function runCliAtRoot(root, env = {}, extraArgs = []) {
  return spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', root, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runRequirements(requirements, env = {}, extraArgs = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-requirements-'));
  const file = path.join(directory, 'requirements.json');
  try {
    fs.writeFileSync(file, JSON.stringify(requirements));
    return runCli(env, ['--requirements', file, ...extraArgs]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function makeConfiguredScopeRoot(markerPaths = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-scope-'));
  for (const relative of markerPaths) {
    const source = path.join(ROOT, relative);
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  return root;
}

function makeProjectedPackageRoot({ includeAgent = true, includeCursor = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-projected-consumer-root-'));
  const probeDirectory = path.join(root, 'scripts', 'release');
  const pluginsDirectory = path.join(root, 'plugins');
  const manifestsDirectory = path.join(root, 'manifests');
  fs.mkdirSync(probeDirectory, { recursive: true });
  fs.mkdirSync(pluginsDirectory, { recursive: true });
  fs.mkdirSync(manifestsDirectory, { recursive: true });
  const realProbe = path.join(ROOT, 'scripts', 'release', 'consumer-platform-probe.js');
  fs.writeFileSync(path.join(probeDirectory, 'consumer-platform-probe.js'), [
    "'use strict';",
    "const { spawnSync } = require('node:child_process');",
    `const result = spawnSync(process.execPath, [${JSON.stringify(realProbe)}, ...process.argv.slice(2)], { encoding: 'utf8' });`,
    'process.stdout.write(result.stdout || "");',
    'process.stderr.write(result.stderr || "");',
    'process.exitCode = result.status === null ? 1 : result.status;',
  ].join('\n'));
  const packageNames = [
    ...(includeAgent ? ['dhpk-agent'] : []),
    ...(includeCursor ? ['dhpk-cursor'] : []),
  ];
  for (const packageName of packageNames) {
    fs.cpSync(path.join(ROOT, 'plugins', packageName), path.join(pluginsDirectory, packageName), { recursive: true });
  }
  fs.copyFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    path.join(manifestsDirectory, 'distribution-inventory.json'),
  );
  return root;
}

function recordingClaudeScript(logFile, {
  listVersion = REAL_VERSION,
  installExit = 0,
  uninstallExit = 0,
  marketplaceRemoveExit = 0,
} = {}) {
  return `#!/bin/sh
LOG=${JSON.stringify(logFile)}
printf '%s\\n' "$*" >> "$LOG"
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace add" ]; then exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace remove" ] || [ "$1 $2 $3" = "plugin marketplace rm" ]; then
  if [ ! -d "$PWD" ]; then echo 'MARKETPLACE_REMOVE_CWD_MISSING' >> "$LOG"; exit 1; fi
  printf 'MARKETPLACE_REMOVE_CWD=%s\\n' "$PWD" >> "$LOG"
  exit ${marketplaceRemoveExit}
fi
if [ "$1 $2" = "plugin install" ]; then exit ${installExit}; fi
if [ "$1 $2" = "plugin uninstall" ] || [ "$1 $2" = "plugin remove" ]; then
  if [ ! -d "$PWD" ]; then echo 'UNINSTALL_CWD_MISSING' >> "$LOG"; exit 1; fi
  printf 'UNINSTALL_CWD=%s\\n' "$PWD" >> "$LOG"
  exit ${uninstallExit}
fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${listVersion}","scope":"project","installPath":"'"$PWD"'"}]'; exit 0; fi
exit 0
`;
}

function assertClaudeProjectTeardown(logText, stage) {
  assert.match(logText, /plugin uninstall dhpk@dhpk/, logText);
  assert.match(logText, /plugin marketplace remove dhpk/, logText);
  assert.match(logText, /--scope project/, logText);
  assert.ok(stage.commands.some((c) => /plugin uninstall/.test(c.cmd)), JSON.stringify(stage.commands));
  assert.ok(stage.commands.some((c) => /marketplace remove/.test(c.cmd)), JSON.stringify(stage.commands));
  const uninstallCwd = /UNINSTALL_CWD=(.+)/.exec(logText);
  assert.ok(uninstallCwd, logText);
  assert.ok(!fs.existsSync(uninstallCwd[1].trim()), `temp project still exists: ${uninstallCwd[1]}`);
  assert.doesNotMatch(logText, /UNINSTALL_CWD_MISSING|MARKETPLACE_REMOVE_CWD_MISSING/);
}

test('keeps Claude and native Codex UNAVAILABLE when their CLIs are absent', () => {
  const env = { PATH: NODE_BASH_ONLY_PATH };
  const claudeStage = JSON.parse(runCli(env, ['--surface', 'claude-core']).stdout);
  assert.strictEqual(claudeStage.verdict, 'BLOCKED', JSON.stringify(claudeStage));
  assert.strictEqual(claudeStage.acceptance.verdict, 'BLOCKED');
  assert.strictEqual(claudeStage.surfaceResults[0].surface, 'claude');
  assert.strictEqual(claudeStage.surfaceResults[0].status, 'UNAVAILABLE');
  assert.ok(claudeStage.failureReasons.some((reason) => /claude/i.test(reason)));

  const nativeStage = JSON.parse(runCli(env, ['--surface', 'codex-native']).stdout);
  assert.strictEqual(nativeStage.verdict, 'BLOCKED', JSON.stringify(nativeStage));
  assert.strictEqual(nativeStage.acceptance.verdict, 'BLOCKED');
  assert.strictEqual(nativeStage.surfaceResults[0].surface, 'codex-native');
  assert.strictEqual(nativeStage.surfaceResults[0].status, 'UNAVAILABLE');
  assert.ok(nativeStage.failureReasons.some((reason) => /native.*codex|codex.*native/i.test(reason)));
});

test('default installation acceptance passes configured contracts while runtime remains excluded', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project","installPath":"'"$PWD"'"}]'; exit 0; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
    assert.strictEqual(stage.acceptance.verdict, 'PASS');
    assert.strictEqual(res.status, 0);
    assert.ok(stage.surfaceResults.every((result) => result.stage === 'CONSUMER'));
    assert.ok(stage.surfaceResults.some((result) => result.surface === 'agent-plugin'));
    assert.strictEqual(stage.surfaceResults.find((result) => result.surface === 'cursor-sync').status, 'NOT_RUN');
    assert.ok(stage.commands.some((c) => /claude plugin validate .* --strict/.test(c.cmd) && c.exitCode === 0), JSON.stringify(stage));
    assert.ok(stage.acceptance.excludedChecks.some((check) => (
      check.surface === 'cursor-sync' && check.kind === 'native' && check.status === 'NOT_RUN'
    )), JSON.stringify(stage.acceptance));
    assert.ok(stage.acceptance.excludedChecks.some((check) => (
      check.surface === 'codex-native' && check.status === 'NOT_CONFIGURED'
    )), JSON.stringify(stage.acceptance));
  });
});

test('routes the portable Agent Plugin package through its dedicated probe', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH, CI: 'true', DHPK_CONSUMER_PROBE_EXECUTE: '1' });
  const stage = JSON.parse(res.stdout);
  const agent = stage.surfaceResults.find((result) => result.surface === 'agent-plugin');
  assert.ok(agent, JSON.stringify(stage));
  assert.strictEqual(agent.status, 'UNAVAILABLE', JSON.stringify(agent));
  const agentCommands = agent.commands.map((command) => command.cmd).join('\n');
  assert.strictEqual(agentCommands, '');
  assert.doesNotMatch(agentCommands, /--execute/);
  assert.strictEqual(agent.installationEvidence.status, 'PASS', JSON.stringify(agent));
  assert.strictEqual(agent.runtimeEvidence.status, 'UNAVAILABLE', JSON.stringify(agent));
});

test('selected Agent Plugin evidence reports the portable runtime as unavailable when not executed', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT, '--surface', 'agent-plugin'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
  assert.strictEqual(stage.acceptance.verdict, 'PASS');
  assert.strictEqual(stage.surfaceResults.length, 1, JSON.stringify(stage));
  assert.strictEqual(stage.surfaceResults[0].surface, 'agent-plugin');
  assert.strictEqual(stage.surfaceResults[0].status, 'UNAVAILABLE');
});

test('Cursor plugin installation acceptance requires its sibling Agent package closure', () => {
  const validRoot = makeProjectedPackageRoot();
  const missingRoot = makeProjectedPackageRoot({ includeAgent: false });
  try {
    const valid = runCliAtRoot(validRoot, { PATH: NODE_BASH_ONLY_PATH }, ['--surface', 'cursor-plugin']);
    assert.strictEqual(valid.status, 0, valid.stdout + valid.stderr);
    const validStage = JSON.parse(valid.stdout);
    const validCursor = validStage.surfaceResults.find((result) => result.surface === 'cursor-plugin');
    assert.strictEqual(validStage.acceptance.verdict, 'PASS', JSON.stringify(validStage.acceptance));
    assert.strictEqual(validCursor.installationEvidence.status, 'PASS', JSON.stringify(validCursor));
    assert.strictEqual(validCursor.installationEvidence.companion.status, 'PASS', JSON.stringify(validCursor));
    assert.strictEqual(validCursor.runtimeEvidence.status, 'UNAVAILABLE', JSON.stringify(validCursor));

    const missing = runCliAtRoot(missingRoot, { PATH: NODE_BASH_ONLY_PATH }, ['--surface', 'cursor-plugin']);
    assert.strictEqual(missing.status, 1, missing.stdout + missing.stderr);
    const missingStage = JSON.parse(missing.stdout);
    const missingCursor = missingStage.surfaceResults.find((result) => result.surface === 'cursor-plugin');
    assert.strictEqual(missingStage.acceptance.verdict, 'FAIL', JSON.stringify(missingStage.acceptance));
    assert.strictEqual(missingCursor.status, 'UNAVAILABLE', JSON.stringify(missingCursor));
    assert.strictEqual(missingCursor.installationEvidence.status, 'FAIL', JSON.stringify(missingCursor));
    assert.strictEqual(missingCursor.installationEvidence.companion.status, 'FAIL', JSON.stringify(missingCursor));
    assert.notStrictEqual(missingStage.runtimeVerified, true);
  } finally {
    fs.rmSync(validRoot, { recursive: true, force: true });
    fs.rmSync(missingRoot, { recursive: true, force: true });
  }
});

test('verifies the Cursor project-local sync route in an isolated project', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH });
  const stage = JSON.parse(res.stdout);
  const cursorSync = stage.surfaceResults.find((result) => result.surface === 'cursor-sync');
  assert.ok(cursorSync, JSON.stringify(stage));
  assert.strictEqual(cursorSync.status, 'NOT_RUN', JSON.stringify(cursorSync));
  assert.strictEqual(cursorSync.stage, 'CONSUMER');
  assert.strictEqual(cursorSync.adapter.id, 'cursor-sync-installer');
  assert.ok(cursorSync.artifacts.some((artifact) => artifact.receipt === '<sandbox>/.cursor/.dhpk-installed.json'), JSON.stringify(cursorSync));
  assert.ok(cursorSync.artifacts.some((artifact) => artifact.receipt === '<sandbox>/.agents/.dhpk-installed.json' && artifact.bindingShape === 'native-link'), JSON.stringify(cursorSync));
});

test('selected Cursor sync evidence keeps the gate pending without a Cursor client probe', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT, '--surface', 'cursor-sync'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
  assert.strictEqual(stage.acceptance.verdict, 'PASS');
  assert.strictEqual(stage.surfaceResults.length, 1, JSON.stringify(stage));
  assert.strictEqual(stage.surfaceResults[0].surface, 'cursor-sync');
  assert.strictEqual(stage.surfaceResults[0].status, 'NOT_RUN');
  assert.strictEqual(stage.surfaceResults[0].installationEvidence.status, 'PASS');
  assert.ok(stage.commands.some((command) => /install-cursor-harness/.test(command.cmd)), JSON.stringify(stage.commands));
});

test('selected Cursor sync accepts the installation contract while retaining native NOT_RUN evidence', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH, CI: 'true' }, ['--surface', 'cursor-sync']);
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  const cursorSync = stage.surfaceResults.find((result) => result.surface === 'cursor-sync');

  assert.strictEqual(stage.schemaVersion, 2, JSON.stringify(stage));
  assert.strictEqual(stage.stage, 'CONSUMER');
  assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
  assert.strictEqual(stage.acceptance.verdict, 'PASS', JSON.stringify(stage.acceptance));
  assert.ok(stage.acceptance.requiredChecks.some((check) => (
    check.kind === 'installation'
      && check.surface === 'cursor-sync'
      && check.status === 'PASS'
      && check.evidenceRef === 'surfaceResults.cursor-sync.installationEvidence'
  )), JSON.stringify(stage.acceptance));
  assert.ok(stage.acceptance.excludedChecks.some((check) => (
    check.kind === 'native'
      && check.surface === 'cursor-sync'
      && check.status === 'NOT_RUN'
      && check.evidenceRef === 'surfaceResults.cursor-sync.runtimeEvidence'
  )), JSON.stringify(stage.acceptance));
  assert.strictEqual(cursorSync.status, 'NOT_RUN', JSON.stringify(cursorSync));
  assert.strictEqual(cursorSync.installationEvidence.status, 'PASS', JSON.stringify(cursorSync));
  assert.notStrictEqual(stage.runtimeVerified, true);
});

test('selected Codex sync accepts installation without running the named-role probe from CI or execute flags', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'codex-argv.log');
    const codexHome = path.join(bin, 'empty-codex-home');
    fs.mkdirSync(codexHome);
    mkBinStub(bin, 'codex', `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = "--version" ]; then echo 'codex-cli fixture'; fi
exit 0
`);

    const res = runCli({
      PATH: `${bin}:${NODE_BASH_ONLY_PATH}`,
      CODEX_HOME: codexHome,
      CI: 'true',
      DHPK_CONSUMER_PROBE_EXECUTE: '1',
    }, ['--surface', 'codex-sync']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const stage = JSON.parse(res.stdout);
    const codexSync = stage.surfaceResults.find((result) => result.surface === 'codex-sync');

    assert.strictEqual(stage.schemaVersion, 2, JSON.stringify(stage));
    assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
    assert.strictEqual(stage.acceptance.verdict, 'PASS', JSON.stringify(stage.acceptance));
    assert.strictEqual(codexSync.installationEvidence.status, 'PASS', JSON.stringify(codexSync));
    assert.strictEqual(codexSync.runtimeEvidence.status, 'NOT_RUN', JSON.stringify(codexSync));
    assert.ok(stage.acceptance.excludedChecks.some((check) => (
      check.kind === 'native' && check.surface === 'codex-sync' && check.status === 'NOT_RUN'
    )), JSON.stringify(stage.acceptance));
    const codexArguments = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.doesNotMatch(codexArguments, /(?:^|\n)exec(?:\s|$)/m, 'ordinary acceptance ran a Codex prompt');
    assert.notStrictEqual(stage.runtimeVerified, true);
  });
});

test('requirements select a deterministic surface and accept a passing installation contract', () => {
  const res = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['cursor-sync'],
    checks: [{
      id: 'cursor-receipt',
      surface: 'cursor-sync',
      host: 'cursor',
      capability: 'installation-contract',
      trigger: 'loader-change',
      reason: 'Confirm the installed project receipt.',
      question: 'Did the sync contract pass?',
      evidenceKind: 'contract',
      authorization: { authorized: false },
    }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.acceptance.verdict, 'PASS', JSON.stringify(stage));
  assert.deepStrictEqual(stage.surfaceResults.map((result) => result.surface), ['cursor-sync']);
  assert.ok(stage.acceptance.requiredChecks.some((check) => (
    check.id === 'requirement.cursor-receipt'
      && check.status === 'PASS'
      && check.evidenceRef === 'surfaceResults.cursor-sync.requirementEvidence.check1'
  )), JSON.stringify(stage.acceptance));
  const normalized = normalizeConsumerEvidence(stage);
  assert.deepStrictEqual(normalized.acceptance, stage.acceptance);
});

test('requirements bind Agent Plugin and Cursor Plugin surfaces to the canonical Cursor Host', () => {
  const res = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['agent-plugin'],
    checks: [{
      id: 'agent-package',
      surface: 'agent-plugin',
      host: 'cursor',
      capability: 'installation-contract',
      trigger: 'loader-change',
      reason: 'Confirm the portable package contract.',
      question: 'Does the Agent Plugin package satisfy the contract?',
      evidenceKind: 'contract',
      authorization: { authorized: false },
    }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.acceptance.verdict, 'PASS', JSON.stringify(stage.acceptance));
  assert.strictEqual(stage.acceptance.requiredChecks.find((check) => check.id === 'requirement.agent-package').status, 'PASS');
  assert.strictEqual(stage.surfaceResults.find((result) => result.surface === 'agent-plugin').runtimeEvidence.status, 'UNAVAILABLE');
});

test('authorized native requirements stay PENDING without invoking native adapters', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'codex-argv.log');
    const codexHome = path.join(bin, 'empty-codex-home');
    fs.mkdirSync(codexHome);
    mkBinStub(bin, 'codex', `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`);
    const res = runRequirements({
      schema: 'dhpk.consumer-requirements.v1',
      selectedSurfaces: ['codex-sync'],
      checks: [{
        id: 'named-role-runtime',
        surface: 'codex-sync',
        host: 'codex',
        capability: 'named-agent-dispatch',
        trigger: 'role-registration-change',
        reason: 'Verify native named-role dispatch.',
        question: 'Can the host discover the registered role?',
        evidenceKind: 'native',
        authorization: { authorized: true },
      }],
    }, {
      PATH: `${bin}:${NODE_BASH_ONLY_PATH}`,
      CODEX_HOME: codexHome,
      CI: 'true',
      DHPK_CONSUMER_PROBE_EXECUTE: '1',
    });
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.acceptance.verdict, 'BLOCKED', JSON.stringify(stage.acceptance));
    assert.ok(stage.acceptance.requiredChecks.some((check) => (
      check.id === 'requirement.named-role-runtime' && check.status === 'PENDING'
    )), JSON.stringify(stage.acceptance));
    const codexArguments = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.doesNotMatch(codexArguments, /(?:^|\n)exec(?:\s|$)/m, 'native requirement ran a Codex prompt');
  });
});

test('requirements reject malformed schemas and conflicting CLI surface scope before adapters', () => {
  const malformed = runRequirements({ schema: 'unknown', checks: [] }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(malformed.status, 2, malformed.stdout + malformed.stderr);
  assert.match(malformed.stderr, /requirements.*schema/i);

  const validCheck = {
    id: 'codex-native', surface: 'codex-sync', host: 'codex', capability: 'named-role-registration',
    trigger: 'explicit-native', reason: 'Check native dispatch.', question: 'Can it dispatch?',
    evidenceKind: 'native', authorization: { authorized: true },
  };
  const mismatched = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['codex-sync'],
    checks: [validCheck],
  }, { PATH: NODE_BASH_ONLY_PATH }, ['--surface', 'cursor-sync']);
  assert.strictEqual(mismatched.status, 2, mismatched.stdout + mismatched.stderr);
  assert.match(mismatched.stderr, /surface.*conflict/i);

  const wrongHost = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['codex-sync'],
    checks: [{ ...validCheck, host: 'cursor' }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(wrongHost.status, 2, wrongHost.stdout + wrongHost.stderr);
  assert.match(wrongHost.stderr, /host.*surface/i);

  const dottedId = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['codex-sync'],
    checks: [{ ...validCheck, id: 'codex.roles.native' }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(dottedId.status, 2, dottedId.stdout + dottedId.stderr);
  assert.match(dottedId.stderr, /id.*invalid/i);

  const oversized = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['codex-sync'],
    checks: [validCheck],
    ignored: 'x'.repeat(65 * 1024),
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(oversized.status, 2, oversized.stdout + oversized.stderr);
  assert.match(oversized.stderr, /bound/i);
});

test('out-of-scope explicit native requirements remain required without invoking their adapter', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'codex-argv.log');
    const codexHome = path.join(bin, 'empty-codex-home');
    fs.mkdirSync(codexHome);
    mkBinStub(bin, 'codex', `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`);
    const res = runRequirements({
      schema: 'dhpk.consumer-requirements.v1',
      selectedSurfaces: ['cursor-sync'],
      checks: [{
        id: 'cursor-contract', surface: 'cursor-sync', host: 'cursor', capability: 'sync',
        trigger: 'new-host', reason: 'Check cursor sync.', question: 'Did sync pass?',
        evidenceKind: 'contract', authorization: { authorized: false },
      }, {
        id: 'codex-native', surface: 'codex-sync', host: 'codex', capability: 'runtime',
        trigger: 'explicit-native', reason: 'Check native dispatch.', question: 'Can it dispatch?',
        evidenceKind: 'native', authorization: { authorized: true },
      }],
    }, { PATH: `${bin}:${NODE_BASH_ONLY_PATH}`, CODEX_HOME: codexHome });
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.acceptance.verdict, 'BLOCKED', JSON.stringify(stage.acceptance));
    assert.ok(stage.acceptance.requiredChecks.some((check) => (
      check.id === 'requirement.codex-native' && check.status === 'BLOCKED'
    )), JSON.stringify(stage.acceptance));
    assert.ok(stage.acceptance.excludedChecks.every((check) => check.id !== 'requirement.codex-native'));
    assert.deepStrictEqual(stage.surfaceResults.map((result) => result.surface), ['cursor-sync', 'codex-sync']);
    assert.strictEqual(fs.existsSync(log), false, 'unselected Codex adapter ran');
  });
});

test('activation-defect requirements cannot pass from installation evidence alone', () => {
  const res = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['cursor-sync'],
    checks: [{
      id: 'cursor-activation-defect',
      surface: 'cursor-sync',
      host: 'cursor',
      capability: 'installation-contract',
      trigger: 'activation-defect',
      reason: 'A known activation defect is under investigation.',
      question: 'Does the native loader activate the package?',
      evidenceKind: 'contract',
      authorization: { authorized: false },
    }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.acceptance.verdict, 'BLOCKED', JSON.stringify(stage.acceptance));
  assert.ok(stage.acceptance.requiredChecks.some((check) => (
    check.id === 'requirement.cursor-activation-defect' && check.status === 'BLOCKED'
  )), JSON.stringify(stage.acceptance));
  assert.strictEqual(stage.surfaceResults[0].installationEvidence.status, 'PASS');
});

test('unsupported contract capabilities stay required and BLOCKED', () => {
  const res = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['cursor-sync'],
    checks: [{
      id: 'cursor-custom-loader',
      surface: 'cursor-sync',
      host: 'cursor',
      capability: 'custom-loader-activation',
      trigger: 'loader-change',
      reason: 'Verify custom loader activation.',
      question: 'Does this loader activate?',
      evidenceKind: 'contract',
      authorization: { authorized: false },
    }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.ok(stage.acceptance.requiredChecks.some((check) => (
    check.id === 'requirement.cursor-custom-loader' && check.status === 'BLOCKED'
  )), JSON.stringify(stage.acceptance));
});

test('default scope runs configured targets and excludes unconfigured Hosts without probing them', () => {
  const configuredRoot = makeConfiguredScopeRoot([
    '.claude-plugin',
    'skills',
    'agents',
    'commands',
    'modules',
  ]);
  try {
    withConsumerGateBin((bin) => {
      const codexLog = path.join(bin, 'codex-argv.log');
      mkBinStub(bin, 'claude', recordingClaudeScript(path.join(bin, 'claude-argv.log')));
      mkBinStub(bin, 'codex', `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(codexLog)}\nexit 0\n`);

      const result = runCliAtRoot(configuredRoot, { PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      const stage = JSON.parse(result.stdout);
      assert.strictEqual(stage.acceptance.verdict, 'PASS', JSON.stringify(stage.acceptance));
      assert.deepStrictEqual(stage.surfaceResults.map((entry) => entry.surface), ['claude']);
      assert.deepStrictEqual(stage.acceptance.requiredChecks.map((check) => check.surface), ['claude']);
      assert.ok(['codex-sync', 'codex-native', 'cursor-sync', 'agent-plugin', 'cursor-plugin']
        .every((surface) => stage.acceptance.excludedChecks.some((check) => (
          check.surface === surface && check.status === 'NOT_CONFIGURED'
        ))), JSON.stringify(stage.acceptance.excludedChecks));
      assert.strictEqual(fs.existsSync(codexLog), false, 'unconfigured Codex adapters were invoked');
    });
  } finally {
    fs.rmSync(configuredRoot, { recursive: true, force: true });
  }
});

test('default scope with no configured target blocks without invoking adapters', () => {
  const emptyRoot = makeConfiguredScopeRoot();
  try {
    const result = runCliAtRoot(emptyRoot, { PATH: NODE_BASH_ONLY_PATH });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const stage = JSON.parse(result.stdout);
    assert.strictEqual(stage.acceptance.verdict, 'BLOCKED', JSON.stringify(stage.acceptance));
    assert.deepStrictEqual(stage.surfaceResults, []);
    assert.deepStrictEqual(stage.commands, []);
    assert.ok(stage.acceptance.requiredChecks.some((check) => (
      check.id === 'scope.configuration'
        && check.surface === 'consumer-scope'
        && check.status === 'BLOCKED'
        && check.evidenceRef === null
    )), JSON.stringify(stage.acceptance));
    assert.strictEqual(stage.acceptance.excludedChecks.length, 6, JSON.stringify(stage.acceptance));
    assert.ok(stage.acceptance.excludedChecks.every((check) => check.status === 'NOT_CONFIGURED'));
    assert.doesNotThrow(() => normalizeConsumerEvidence(stage));
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('an explicit surface runs its adapter even when no default configuration marker exists', () => {
  const emptyRoot = makeConfiguredScopeRoot();
  try {
    const result = runCliAtRoot(emptyRoot, { PATH: NODE_BASH_ONLY_PATH }, ['--surface', 'codex-native']);
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    const stage = JSON.parse(result.stdout);
    assert.deepStrictEqual(stage.surfaceResults.map((entry) => entry.surface), ['codex-native']);
    assert.strictEqual(stage.surfaceResults[0].status, 'UNAVAILABLE');
    assert.ok(stage.acceptance.requiredChecks.some((check) => check.surface === 'codex-native'));
    assert.ok(!stage.acceptance.excludedChecks.some((check) => check.surface === 'codex-native'));
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('authorized activation and explicit-native contract checks remain PENDING', () => {
  const res = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['cursor-sync'],
    checks: ['activation-defect', 'explicit-native'].map((trigger) => ({
      id: trigger === 'activation-defect' ? 'activation-check' : 'native-trigger-check',
      surface: 'cursor-sync',
      host: 'cursor',
      capability: 'installation-contract',
      trigger,
      reason: `Verify the ${trigger} behavior.`,
      question: `Was ${trigger} behavior observed?`,
      evidenceKind: 'contract',
      authorization: { authorized: true },
    })),
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.acceptance.verdict, 'BLOCKED', JSON.stringify(stage.acceptance));
  assert.deepStrictEqual(
    stage.acceptance.requiredChecks.filter((check) => check.id.startsWith('requirement.'))
      .map((check) => check.status),
    ['PENDING', 'PENDING'],
  );
});

test('valid hyphenated requirement IDs normalize without dangling evidence references', () => {
  const res = runRequirements({
    schema: 'dhpk.consumer-requirements.v1',
    selectedSurfaces: ['cursor-sync'],
    checks: [{
      id: 'token-mapping',
      surface: 'cursor-sync',
      host: 'cursor',
      capability: 'installation-contract',
      trigger: 'loader-change',
      reason: 'Confirm the loader mapping contract.',
      question: 'Does the installed contract include the mapping?',
      evidenceKind: 'contract',
      authorization: { authorized: false },
    }],
  }, { PATH: NODE_BASH_ONLY_PATH });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.doesNotThrow(() => normalizeConsumerEvidence(stage));
  assert.strictEqual(
    stage.acceptance.requiredChecks.find((check) => check.id === 'requirement.token-mapping').status,
    'PASS',
  );
});

test('requirements FIFO inputs are rejected promptly without blocking the gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-fifo-'));
  const fifo = path.join(directory, 'requirements.json');
  try {
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.strictEqual(created.status, 0, created.stdout + created.stderr);
    const result = spawnSync(process.execPath, [
      CLI,
      '--version',
      REAL_VERSION,
      '--repo-root',
      ROOT,
      '--requirements',
      fifo,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
      timeout: 1500,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /requirements file could not be read/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Claude strict validation uses a consumer-shaped staged package without the development root instructions', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'claude-validation.log');
    const installedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-installed-cache-'));
    try {
      mkBinStub(bin, 'claude', `#!/bin/sh
LOG=${JSON.stringify(log)}
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then
  printf 'VALIDATE_CWD=%s\\n' "$PWD" >> "$LOG"
  printf 'VALIDATE_MANIFEST=%s\\n' "$3" >> "$LOG"
  printf 'VALIDATE_FLAG=%s\\n' "$4" >> "$LOG"
  case "$PWD" in
    *dhpk-claude-validation-*)
  for path in .claude-plugin/plugin.json skills agents commands modules; do
    if [ ! -e "$PWD/$path" ]; then printf 'MISSING=%s\\n' "$path" >> "$LOG"; exit 2; fi
  done
  if [ -e "$PWD/CLAUDE.md" ]; then printf 'ROOT_CLAUDE_PRESENT=1\\n' >> "$LOG"; exit 3; fi
      ;;
  esac
  exit 0
fi
if [ "$1 $2 $3" = "plugin marketplace add" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project","installPath":${JSON.stringify(installedRoot)}}]'; exit 0; fi
if [ "$1 $2" = "plugin uninstall" ] || [ "$1 $2" = "plugin remove" ]; then exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace remove" ] || [ "$1 $2 $3" = "plugin marketplace rm" ]; then exit 0; fi
exit 0
`);
      const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));

      const logText = fs.readFileSync(log, 'utf8');
      const validationCwd = /^VALIDATE_CWD=(.+)$/m.exec(logText);
      const validationManifest = /^VALIDATE_MANIFEST=(.+)$/m.exec(logText);
      const validationFlag = /^VALIDATE_FLAG=(.+)$/m.exec(logText);
      assert.ok(validationCwd, logText);
      assert.ok(validationManifest, logText);
      assert.ok(validationFlag, logText);
      assert.strictEqual(validationFlag[1], '--strict');
      // macOS may render /var/folders as /private/var/folders in $PWD while
      // Node retains the lexical temp path in the argv; compare the unique
      // stage directory rather than the symlinked prefix.
      assert.strictEqual(
        path.basename(path.dirname(path.dirname(validationManifest[1]))),
        path.basename(validationCwd[1]),
      );
      assert.match(validationManifest[1], /[\\/]\.claude-plugin[\\/]plugin\.json$/);
      assert.notStrictEqual(validationCwd[1], ROOT);
      assert.match(validationCwd[1], /[\\/]dhpk-claude-validation-/);
      assert.doesNotMatch(logText, /MISSING=|ROOT_CLAUDE_PRESENT/);
    } finally {
      fs.rmSync(installedRoot, { recursive: true, force: true });
    }
  });
});

test('fails closed when Claude omits the installed cache path', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace add" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project"}]'; exit 0; fi
if [ "$1 $2" = "plugin uninstall" ] || [ "$1 $2" = "plugin remove" ]; then exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace remove" ] || [ "$1 $2 $3" = "plugin marketplace rm" ]; then exit 0; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
    const stage = JSON.parse(res.stdout);
    const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
    assert.strictEqual(claude.status, 'FAIL', JSON.stringify(stage));
    assert.match(claude.reasons.join('\n'), /installPath|installed-cache.*NOT RUN/i);
    assert.ok(claude.commands.some((command) => command.status === 'NOT RUN' && /<installed>/.test(command.cmd)), JSON.stringify(stage));
  });
});

test('Claude consumer gate validates the installed cache manifest after marketplace install', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'claude-installed-validation.log');
    const installedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-installed-cache-'));
    try {
      mkBinStub(bin, 'claude', `#!/bin/sh
LOG=${JSON.stringify(log)}
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then
  printf 'VALIDATE_CWD=%s\\n' "$PWD" >> "$LOG"
  printf 'VALIDATE_MANIFEST=%s\\n' "$3" >> "$LOG"
  exit 0
fi
if [ "$1 $2 $3" = "plugin marketplace add" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then
  echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project","installPath":${JSON.stringify(installedRoot)}}]'
  exit 0
fi
if [ "$1 $2" = "plugin uninstall" ] || [ "$1 $2" = "plugin remove" ]; then exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace remove" ] || [ "$1 $2 $3" = "plugin marketplace rm" ]; then exit 0; fi
exit 0
`);
      const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
      assert.strictEqual(res.status, 0, res.stdout + res.stderr);
      const stage = JSON.parse(res.stdout);
      assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
      assert.ok(stage.commands.some((command) => command.cmd === 'claude plugin validate <installed>/.claude-plugin/plugin.json --strict' && command.exitCode === 0), JSON.stringify(stage));
      const logText = fs.readFileSync(log, 'utf8');
      assert.strictEqual((logText.match(/^VALIDATE_MANIFEST=/gm) || []).length, 2, logText);
      assert.match(logText, new RegExp(`VALIDATE_CWD=.*${path.basename(installedRoot)}`));
    } finally {
      fs.rmSync(installedRoot, { recursive: true, force: true });
    }
  });
});

test('fails when the stubbed claude CLI reports a version mismatch after install', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"0.0.1"}]'; exit 0; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'FAIL');
    assert.ok(stage.failureReasons.some((r) => /0\.0\.1/.test(r)));
  });
});

test('selects the project-scoped Claude installation when a stale user installation is listed first', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then
  echo '[{"id":"dhpk@dhpk","version":"0.44.0","scope":"user"},{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project","projectPath":"'"$PWD"'","installPath":"'"$PWD"'"}]'
  exit 0
fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
    const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
    assert.ok(claude, JSON.stringify(stage));
    assert.strictEqual(claude.status, 'PASS', JSON.stringify(claude));
  });
});

test('rejects an explicitly user-scoped Claude installation when project scope is absent', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then
  echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"user"}]'
  exit 0
fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0, res.stdout + res.stderr);
    const stage = JSON.parse(res.stdout);
    const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
    assert.ok(claude, JSON.stringify(stage));
    assert.strictEqual(claude.status, 'FAIL', JSON.stringify(stage));
    assert.match(claude.reasons.join('\n'), /not present|scope|project/i);
  });
});

test('blocks the consumer gate when official Claude strict validation fails', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then echo 'skills/dhpk-ios-platform/SKILL.md: YAML frontmatter failed to parse' >&2; exit 1; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}"}]'; exit 0; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'FAIL', JSON.stringify(stage));
    assert.ok(stage.failureReasons.some((r) => /official.*strict|claude.*validate|ios-platform/i.test(r)), JSON.stringify(stage));
    assert.ok(stage.commands.some((c) => /claude plugin validate .* --strict/.test(c.cmd) && c.exitCode !== 0), JSON.stringify(stage));
  });
});

test('duplicate Codex surfaces use the deterministic PASS/WARN/BLOCKED matrix', () => {
  const base = { id: 'dhpk:demo', version: '1.0.0', owned: true, current: true };
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'same' },
    native: { ...base, fingerprint: 'same' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'PASS');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'project' },
    native: { ...base, fingerprint: 'native' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'WARN');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, owned: false, fingerprint: 'same' },
    native: { ...base, fingerprint: 'same' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'BLOCKED');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'same' },
    native: { ...base, fingerprint: 'same' },
    precedence: null,
    nativeExperimental: true,
  }).verdict, 'BLOCKED');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'same' },
    native: { ...base, current: false, fingerprint: 'same' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'BLOCKED');
});

test('consumer gate resolves a relative repository root before entering its sandbox', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', '.', '--surface', 'claude-core'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'BLOCKED', JSON.stringify(stage));
});

test('consumer gate rejects a missing --surface value instead of running every probe', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--surface'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 2, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /surface|value|required/i);
});

test('Codex surface discovery includes both skill and agent inventories', () => {
  const surfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-surface-'));
  try {
    fs.mkdirSync(path.join(surfaceRoot, 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(surfaceRoot, 'skills', 'demo-skill', 'SKILL.md'), 'skill\n');
    fs.mkdirSync(path.join(surfaceRoot, 'agents', 'demo-agent'), { recursive: true });
    fs.writeFileSync(path.join(surfaceRoot, 'agents', 'demo-agent', 'AGENT.md'), 'agent\n');
    const entries = discoverCodexSurface({
      root: surfaceRoot,
      surfaceRoot,
      label: 'project-local',
      version: '1.0.0',
      manifest: {
        schema_version: 2,
        plugin_version: '1.0.0',
        managed_entries: {
          skills: { 'demo-skill': { destination_fingerprint: require(CLI).fingerprintPath(path.join(surfaceRoot, 'skills', 'demo-skill')) } },
          agents: { 'demo-agent': { destination_fingerprint: require(CLI).fingerprintPath(path.join(surfaceRoot, 'agents', 'demo-agent')) } },
        },
      },
    });
    assert.deepStrictEqual(entries.map((entry) => `${entry.kind}:${entry.id}`), ['agents:demo-agent', 'skills:demo-skill']);
    assert.ok(entries.every((entry) => entry.owned && entry.current));
  } finally {
    fs.rmSync(surfaceRoot, { recursive: true, force: true });
  }
});

test('Codex native-link Host Bindings count as owned project-local skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-link-owned-'));
  try {
    const project = path.join(root, 'project');
    const shared = path.join(project, '.agents', 'skills', 'demo-skill');
    const dest = path.join(project, '.codex', 'skills', 'demo-skill');
    const nativeRoot = path.join(root, 'plugins', 'dhpk');
    const nativeSkill = path.join(nativeRoot, 'skills', 'demo-skill');
    fs.mkdirSync(shared, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.mkdirSync(nativeSkill, { recursive: true });
    fs.writeFileSync(path.join(shared, 'SKILL.md'), '# demo\n');
    fs.writeFileSync(path.join(nativeSkill, 'SKILL.md'), '# demo\n');
    fs.symlinkSync('../../.agents/skills/demo-skill', dest);
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: '1.0.0',
      managed_entries: { skills: {}, agents: {}, supporting_assets: { x: {} } },
    })}\n`);
    fs.writeFileSync(path.join(project, '.agents', '.dhpk-installed.json'), `${JSON.stringify({
      hostBindings: {
        codex: {
          bindingShape: 'native-link',
          bindings: [{
            shape: 'native-link',
            path: '.codex/skills/demo-skill',
            target: '../../.agents/skills/demo-skill',
          }],
        },
      },
    })}\n`);

    const surfaces = discoverCodexSurfaces({
      root,
      project,
      version: '1.0.0',
      nativeRoot,
    });
    const skill = surfaces.project.find((entry) => entry.kind === 'skills' && entry.id === 'demo-skill');
    assert.ok(skill, JSON.stringify(surfaces.project));
    assert.strictEqual(skill.owned, true);
    assert.strictEqual(skill.current, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('project-local skill fingerprints use the native canonical contract while retaining receipt ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-canonical-skill-'));
  try {
    const sourceSkill = path.join(root, 'source', 'skills', 'demo-skill');
    const project = path.join(root, 'project');
    const projectSkill = path.join(project, '.codex', 'skills', 'demo-skill');
    const native = path.join(root, 'native');
    const nativeSkill = path.join(native, 'skills', 'demo-skill');
    fs.mkdirSync(path.join(sourceSkill, '__pycache__'), { recursive: true });
    fs.mkdirSync(nativeSkill, { recursive: true });
    fs.mkdirSync(path.dirname(projectSkill), { recursive: true });
    fs.writeFileSync(path.join(sourceSkill, 'SKILL.md'), '# demo\n');
    fs.writeFileSync(path.join(nativeSkill, 'SKILL.md'), '# demo\n');
    fs.writeFileSync(path.join(sourceSkill, '__pycache__', 'fixture.pyc'), Buffer.from('generated bytecode'));
    fs.symlinkSync(sourceSkill, projectSkill, 'dir');

    const projectEntries = discoverCodexSurface({
      root,
      surfaceRoot: path.join(project, '.codex'),
      label: 'project-local',
      version: '1.0.0',
      allowedRoots: [root],
      fingerprintFnByKind: { skills: fingerprintProjectSkill },
      ownershipFingerprintFn: fingerprintPath,
      manifest: {
        schema_version: 3,
        plugin_version: '1.0.0',
        managed_entries: {
          skills: {
            'demo-skill': {
              destination_fingerprint: fingerprintPath(projectSkill, { allowedRoots: [root] }),
            },
          },
        },
      },
    });
    const nativeEntries = discoverCodexSurface({
      root,
      surfaceRoot: native,
      label: 'native-experimental',
      version: '1.0.0',
      provenance: { valid: true, current: true },
      expectedFingerprints: { 'demo-skill': fingerprintDir(nativeSkill) },
      fingerprintFn: fingerprintDir,
      expectedFingerprintFn: fingerprintDir,
    });
    const report = inspectCodexDiscovery({
      project: projectEntries,
      native: nativeEntries,
      precedence: ['project-local'],
    });

    assert.strictEqual(projectEntries[0].owned, true);
    assert.strictEqual(projectEntries[0].fingerprint, fingerprintDir(nativeSkill));
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.duplicates.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('consumer Codex fingerprints include destination Python bytecode integrity', () => {
  const surfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-bytecode-'));
  try {
    const target = path.join(surfaceRoot, 'skills', 'demo-skill');
    const cache = path.join(target, '__pycache__');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'skill\n');
    const bytecode = path.join(cache, 'fixture.pyc');
    fs.writeFileSync(bytecode, Buffer.from('bytecode-v1'));
    const before = fingerprintPath(target);
    fs.writeFileSync(bytecode, Buffer.from('bytecode-v2'));
    assert.notStrictEqual(fingerprintPath(target), before,
      'consumer ownership must detect a changed destination bytecode file');
    assert.notStrictEqual(before, '');
  } finally {
    fs.rmSync(surfaceRoot, { recursive: true, force: true });
  }
});

test('project-local fingerprinting rejects symlinks that resolve outside approved roots', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-project-link-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-outside-link-'));
  try {
    const target = path.join(projectRoot, '.codex', 'skills', 'demo-skill');
    const outside = path.join(outsideRoot, 'demo-skill');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'SKILL.md'), 'outside\n');
    fs.symlinkSync(outside, target, 'dir');
    const entries = discoverCodexSurface({
      root: projectRoot,
      surfaceRoot: path.join(projectRoot, '.codex'),
      label: 'project-local',
      version: '1.0.0',
      allowedRoots: [projectRoot],
      fingerprintFnByKind: { skills: fingerprintProjectSkill },
      ownershipFingerprintFn: fingerprintPath,
    });
    assert.strictEqual(entries.length, 1);
    assert.match(entries[0].fingerprintError, /approved root|outside|symlink/i);
    assert.strictEqual(entries[0].owned, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('project-local fingerprinting rejects a symlinked surface ancestor', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-project-ancestor-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-outside-ancestor-'));
  try {
    const outsideSkills = path.join(outsideRoot, 'skills');
    fs.mkdirSync(path.join(outsideSkills, 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(outsideSkills, 'demo-skill', 'SKILL.md'), 'outside\n');
    fs.mkdirSync(path.join(projectRoot, '.codex'), { recursive: true });
    fs.symlinkSync(outsideSkills, path.join(projectRoot, '.codex', 'skills'), 'dir');
    assert.throws(() => discoverCodexSurface({
      root: projectRoot,
      surfaceRoot: path.join(projectRoot, '.codex'),
      label: 'project-local',
      version: '1.0.0',
      allowedRoots: [projectRoot],
      fingerprintFnByKind: { skills: fingerprintProjectSkill },
      ownershipFingerprintFn: fingerprintPath,
    }), /approved root|outside|symlink/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('native surface fingerprinting rejects a symlinked skill root', () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-link-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-outside-'));
  try {
    const target = path.join(nativeRoot, 'skills', 'demo-native');
    const outside = path.join(outsideRoot, 'demo-native');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'SKILL.md'), 'outside\n');
    fs.symlinkSync(outside, target, 'dir');
    const entries = discoverCodexSurface({
      root: nativeRoot,
      surfaceRoot: nativeRoot,
      label: 'native-experimental',
      version: '1.0.0',
      fingerprintFn: fingerprintDir,
      expectedFingerprintFn: fingerprintDir,
    });
    assert.strictEqual(entries.length, 1);
    assert.match(entries[0].fingerprintError, /symlink/i);
    assert.strictEqual(entries[0].owned, false);
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('native surface fingerprinting rejects a symlinked ancestor', () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-ancestor-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-outside-ancestor-'));
  try {
    const outsideSkills = path.join(outsideRoot, 'skills');
    fs.mkdirSync(path.join(outsideSkills, 'demo-native'), { recursive: true });
    fs.writeFileSync(path.join(outsideSkills, 'demo-native', 'SKILL.md'), 'outside\n');
    fs.symlinkSync(outsideSkills, path.join(nativeRoot, 'skills'), 'dir');
    assert.throws(() => discoverCodexSurface({
      root: nativeRoot,
      surfaceRoot: nativeRoot,
      label: 'native-experimental',
      version: '1.0.0',
      fingerprintFn: fingerprintDir,
      expectedFingerprintFn: fingerprintDir,
    }), /symlink/i);
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('consumer fingerprint traversal rejects excessive directory depth before unbounded recursion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-fingerprint-depth-'));
  try {
    let current = root;
    for (let depth = 0; depth < 4; depth += 1) {
      current = path.join(current, `level-${depth}`);
      fs.mkdirSync(current);
    }
    fs.writeFileSync(path.join(current, 'SKILL.md'), 'bounded\n');
    assert.throws(
      () => fingerprintPath(root, { maxDepth: 2 }),
      /maximum directory depth/i,
    );
    assert.throws(
      () => fingerprintPath(root, { maxBytes: 1 }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native surface ownership requires a tracked content fingerprint, not provenance shape alone', () => {
  const surfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-surface-'));
  try {
    const target = path.join(surfaceRoot, 'skills', 'demo-native');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'native\n');
    const actual = fingerprintDir(target);
    const valid = discoverCodexSurface({
      root: surfaceRoot,
      surfaceRoot,
      label: 'native-experimental',
      version: '1.0.0',
      provenance: { valid: true, current: true },
      expectedFingerprints: { 'demo-native': actual },
      fingerprintFn: fingerprintPath,
      expectedFingerprintFn: fingerprintDir,
    });
    assert.strictEqual(valid[0].owned, true);
    const tampered = discoverCodexSurface({
      root: surfaceRoot,
      surfaceRoot,
      label: 'native-experimental',
      version: '1.0.0',
      provenance: { valid: true, current: true },
      expectedFingerprints: { 'demo-native': '0'.repeat(64) },
      fingerprintFn: fingerprintPath,
      expectedFingerprintFn: fingerprintDir,
    });
    assert.strictEqual(tampered[0].owned, false);
  } finally {
    fs.rmSync(surfaceRoot, { recursive: true, force: true });
  }
});

test('consumer failure evidence redacts sandbox and repository paths', () => {
  const privateText = `installer failed at ${path.join(os.tmpdir(), 'private-project')} from ${ROOT}/plugins/dhpk Authorization: Bearer AUTH_MARKER_SHOULD_NOT_LEAK postgres://u:DB_MARKER@db.example`;
  const redacted = redactEvidence(privateText, ROOT);
  assert.doesNotMatch(redacted, new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(redacted, new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(redacted, /<sandbox>/);
  assert.match(redacted, /<repo>/);
  assert.doesNotMatch(redacted, /AUTH_MARKER_SHOULD_NOT_LEAK|DB_MARKER/);
});

test('consumer failure evidence keeps repository identity when the checkout is under the sandbox', () => {
  const sandboxRoot = path.join(os.tmpdir(), `dhpk-redaction-repo-${process.pid}`);
  const privateText = `installer failed at ${path.join(os.tmpdir(), 'private-project')} from ${sandboxRoot}/plugins/dhpk`;
  const redacted = redactEvidence(privateText, sandboxRoot);
  assert.match(redacted, /<sandbox>/);
  assert.match(redacted, /<repo>\/plugins\/dhpk/);
});

test('Claude consumer-gate uninstalls the project-scope plugin before deleting the temp project', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'claude-argv.log');
    mkBinStub(bin, 'claude', recordingClaudeScript(log));
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
    assertClaudeProjectTeardown(fs.readFileSync(log, 'utf8'), stage);
  });
});

test('Claude consumer-gate still tears down after a project-scope install failure', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'claude-argv.log');
    mkBinStub(bin, 'claude', recordingClaudeScript(log, { installExit: 1 }));
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'FAIL', JSON.stringify(stage));
    assert.ok(stage.failureReasons.some((r) => /plugin install exited/i.test(r)), JSON.stringify(stage));
    assertClaudeProjectTeardown(fs.readFileSync(log, 'utf8'), stage);
  });
});

test('Claude registry teardown failure records WARN without failing the selected surface', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'claude-argv.log');
    mkBinStub(bin, 'claude', recordingClaudeScript(log, { uninstallExit: 1 }));
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
    assert.strictEqual(res.status, 0);
    assertClaudeProjectTeardown(fs.readFileSync(log, 'utf8'), stage);
    assert.ok(stage.commands.some((c) => /plugin uninstall/.test(c.cmd) && c.exitCode !== 0), JSON.stringify(stage.commands));
    assert.ok(
      (stage.surfaceResults[0].warnings || []).some((warning) => /uninstall|teardown/i.test(warning)),
      JSON.stringify(stage.surfaceResults[0]),
    );
    assert.ok(
      !(stage.failureReasons || []).some((r) => /uninstall|marketplace remove|teardown/i.test(r)),
      JSON.stringify(stage.failureReasons),
    );
  });
});

test('withConsumerGateBin removes the stub PATH dir after success', () => {
  let captured;
  const result = withConsumerGateBin((bin) => {
    captured = bin;
    assert.ok(fs.existsSync(bin));
    fs.writeFileSync(path.join(bin, 'marker'), 'x');
    return 'ok';
  });
  assert.strictEqual(result, 'ok');
  assert.ok(captured);
  assert.ok(!fs.existsSync(captured), `leftover stub dir: ${captured}`);
});

test('withConsumerGateBin removes the stub PATH dir after a thrown error', () => {
  let captured;
  assert.throws(() => {
    withConsumerGateBin((bin) => {
      captured = bin;
      throw new Error('boom');
    });
  }, /boom/);
  assert.ok(captured);
  assert.ok(!fs.existsSync(captured), `leftover stub dir after throw: ${captured}`);
});

test('records the resolved Claude CLI version in consumer evidence', () => {
  withConsumerGateBin((bin) => {
    const version = '2.1.274 (Claude Code)';
    const installedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-installed-cache-'));
    try {
      mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace add" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project","installPath":"${installedRoot}"}]'; exit 0; fi
if [ "$1 $2" = "plugin uninstall" ] || [ "$1 $2 $3" = "plugin marketplace remove" ]; then exit 0; fi
exit 0
`);
      const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
      assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      const stage = JSON.parse(res.stdout);
      const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
      assert.strictEqual(claude.status, 'PASS', JSON.stringify(stage));
      assert.strictEqual(claude.adapter.version, version, JSON.stringify(claude));
      assert.deepStrictEqual(claude.versionDiscovery, {
        cmd: 'claude --version',
        status: 'PASS',
        exitCode: 0,
        version,
      });
      assert.ok(stage.commands.some((command) => command.claudeVersion === version), JSON.stringify(stage.commands));
    } finally {
      fs.rmSync(installedRoot, { recursive: true, force: true });
    }
  });
});

test('records unavailable Claude CLI discovery without inventing a version', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH }, ['--surface', 'claude-core']);
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
  const stage = JSON.parse(res.stdout);
  const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
  assert.strictEqual(stage.verdict, 'BLOCKED');
  assert.strictEqual(stage.acceptance.verdict, 'BLOCKED');
  assert.strictEqual(claude.status, 'UNAVAILABLE', JSON.stringify(stage));
  assert.strictEqual(claude.adapter.version, null, JSON.stringify(claude));
  assert.strictEqual(claude.versionDiscovery.status, 'UNAVAILABLE', JSON.stringify(claude));
  assert.strictEqual(claude.versionDiscovery.version, null, JSON.stringify(claude));
  assert.ok(claude.versionDiscovery.diagnostic, JSON.stringify(claude));
});

test('fails closed on malformed Claude CLI version output', () => {
  withConsumerGateBin((bin) => {
    const log = path.join(bin, 'claude-argv.log');
    mkBinStub(bin, 'claude', `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = "--version" ]; then echo 'version unavailable'; exit 0; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const stage = JSON.parse(res.stdout);
    const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
    assert.strictEqual(claude.status, 'FAIL', JSON.stringify(stage));
    assert.strictEqual(claude.adapter.version, null, JSON.stringify(claude));
    assert.strictEqual(claude.versionDiscovery.status, 'FAIL', JSON.stringify(claude));
    assert.strictEqual(claude.versionDiscovery.version, null, JSON.stringify(claude));
    assert.match(claude.versionDiscovery.diagnostic, /version|format|malformed/i);
    assert.strictEqual(fs.readFileSync(log, 'utf8').trim(), '--version');
  });
});

test('records a failed Claude CLI version command explicitly', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'version probe failed' >&2; exit 7; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const stage = JSON.parse(res.stdout);
    const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
    assert.strictEqual(claude.status, 'FAIL', JSON.stringify(stage));
    assert.strictEqual(claude.adapter.version, null, JSON.stringify(claude));
    assert.strictEqual(claude.versionDiscovery.status, 'FAIL', JSON.stringify(claude));
    assert.strictEqual(claude.versionDiscovery.exitCode, 7, JSON.stringify(claude));
    assert.strictEqual(claude.versionDiscovery.version, null, JSON.stringify(claude));
  });
});

test('retains Claude CLI version evidence when a consumer probe fails', () => {
  withConsumerGateBin((bin) => {
    const version = '2.1.274 (Claude Code)';
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi
if [ "$1 $2 $3" = "plugin marketplace add" ]; then exit 1; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` }, ['--surface', 'claude-core']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const stage = JSON.parse(res.stdout);
    const claude = stage.surfaceResults.find((result) => result.surface === 'claude');
    assert.strictEqual(claude.status, 'FAIL', JSON.stringify(stage));
    assert.strictEqual(claude.adapter.version, version, JSON.stringify(claude));
    assert.strictEqual(claude.versionDiscovery.status, 'PASS', JSON.stringify(claude));
    assert.ok(claude.reasons.some((reason) => /marketplace add/i.test(reason)), JSON.stringify(claude));
  });
});

run('consumer-gate-cli');
