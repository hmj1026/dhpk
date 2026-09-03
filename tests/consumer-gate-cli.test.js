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
  evaluateCodexSurfaceMatrix,
  fingerprintDir,
  fingerprintPath,
  fingerprintProjectSkill,
  redactEvidence,
  runCodexNamedRoleProbe,
  validateCodexAgentMaterialization,
} = require(CLI);
const { inspectCodexDiscovery } = require('../scripts/lib/codex-discovery-registry');

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
stat -c '%a' "$CODEX_HOME/config.toml" > ${JSON.stringify(configModeLog)}
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
  return spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
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
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${listVersion}"}]'; exit 0; fi
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
  assert.strictEqual(claudeStage.verdict, 'UNAVAILABLE', JSON.stringify(claudeStage));
  assert.strictEqual(claudeStage.surfaceResults[0].surface, 'claude');
  assert.strictEqual(claudeStage.surfaceResults[0].status, 'UNAVAILABLE');
  assert.ok(claudeStage.failureReasons.some((reason) => /claude/i.test(reason)));

  const nativeStage = JSON.parse(runCli(env, ['--surface', 'codex-native']).stdout);
  assert.strictEqual(nativeStage.verdict, 'UNAVAILABLE', JSON.stringify(nativeStage));
  assert.strictEqual(nativeStage.surfaceResults[0].surface, 'codex-native');
  assert.strictEqual(nativeStage.surfaceResults[0].status, 'UNAVAILABLE');
  assert.ok(nativeStage.failureReasons.some((reason) => /native.*codex|codex.*native/i.test(reason)));
});

test('reports overall PENDING when supported checks pass but Cursor runtime is not invoked', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}"}]'; exit 0; fi
exit 0
`);
    const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
    const stage = JSON.parse(res.stdout);
    assert.strictEqual(stage.verdict, 'PENDING', JSON.stringify(stage));
    assert.strictEqual(res.status, 0);
    assert.ok(stage.surfaceResults.every((result) => result.stage === 'CONSUMER'));
    assert.ok(stage.surfaceResults.some((result) => result.surface === 'agent-plugin'));
    assert.strictEqual(stage.surfaceResults.find((result) => result.surface === 'cursor-sync').status, 'NOT_RUN');
    assert.ok(stage.artifacts.some((a) => /claude.*official.*PASS|official.*PASS.*claude/i.test(a)), JSON.stringify(stage));
    assert.ok(stage.commands.some((c) => /claude plugin validate .* --strict/.test(c.cmd) && c.exitCode === 0), JSON.stringify(stage));
  });
});

test('routes the portable Agent Plugin package through its dedicated probe', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH, CI: 'true' });
  const stage = JSON.parse(res.stdout);
  const agent = stage.surfaceResults.find((result) => result.surface === 'agent-plugin');
  assert.ok(agent, JSON.stringify(stage));
  assert.notStrictEqual(agent.status, 'NOT_CONFIGURED', JSON.stringify(agent));
  assert.strictEqual(agent.status, 'UNAVAILABLE', JSON.stringify(agent));
  const agentCommands = agent.commands.map((command) => command.cmd).join('\n');
  assert.match(agentCommands, /cursor-agent --plugin-dir <agent-package> --mode ask --trust/);
  assert.strictEqual((agentCommands.match(/--plugin-dir/g) || []).length, 1, agentCommands);
  assert.match(agent.reasons.join('\n'), /Agent Plugin consumer runtime probe|opt-in|Cursor client tooling/i);
});

test('selected Agent Plugin evidence reports the portable runtime as unavailable when not executed', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT, '--surface', 'agent-plugin'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'UNAVAILABLE', JSON.stringify(stage));
  assert.strictEqual(stage.surfaceResults.length, 1, JSON.stringify(stage));
  assert.strictEqual(stage.surfaceResults[0].surface, 'agent-plugin');
  assert.strictEqual(stage.surfaceResults[0].status, 'UNAVAILABLE');
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
});

test('selected Cursor sync evidence keeps the gate pending without a Cursor client probe', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT, '--surface', 'cursor-sync'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PENDING', JSON.stringify(stage));
  assert.strictEqual(stage.surfaceResults.length, 1, JSON.stringify(stage));
  assert.strictEqual(stage.surfaceResults[0].surface, 'cursor-sync');
  assert.strictEqual(stage.surfaceResults[0].status, 'NOT_RUN');
  assert.ok(stage.commands.some((command) => /install-cursor-harness/.test(command.cmd)), JSON.stringify(stage.commands));
});

test('fails when the stubbed claude CLI reports a version mismatch after install', () => {
  withConsumerGateBin((bin) => {
    mkBinStub(bin, 'claude', `#!/bin/sh
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
  echo '[{"id":"dhpk@dhpk","version":"0.44.0","scope":"user"},{"id":"dhpk@dhpk","version":"${REAL_VERSION}","scope":"project","projectPath":"'"$PWD"'"}]'
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
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'UNAVAILABLE', JSON.stringify(stage));
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

run('consumer-gate-cli');
