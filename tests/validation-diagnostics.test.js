'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const diagnostics = require('../scripts/hooks/validation-diagnostics');

function fixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validation-diagnostics-'));
}

function payload(overrides = {}) {
  return {
    hook_event_name: 'PostToolUseFailure',
    session_id: 'session-a',
    cwd: process.cwd(),
    agent_id: 'agent-a',
    tool_name: 'Bash',
    tool_input: { command: 'npm test -- --runInBand case-a' },
    error: 'Exit code 1\nfailed case',
    ...overrides,
  };
}

test('same session, project, subagent and target advises only on the second failure', () => {
  const stateDir = fixtureDir();
  const first = diagnostics.processEvent(payload(), { stateDir });
  const second = diagnostics.processEvent(payload({
    tool_input: { command: 'npm test -- --runInBand case-b' },
  }), { stateDir });

  assert.strictEqual(first.message, null);
  assert.ok(second.message && second.message.systemMessage.includes('read-only'));
  assert.match(second.message.hookSpecificOutput.additionalContext, /read-only/);
  assert.strictEqual(second.message.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.strictEqual(second.record.failures, 2);
});

test('concurrent failures for one identity are all recorded atomically', async () => {
  const stateDir = fixtureDir();
  const cwd = fixtureDir();
  const script = path.join(__dirname, '..', 'scripts/hooks/validation-diagnostics.js');
  const child = `
    const diagnostics = require(process.argv[1]);
    diagnostics.processEvent(JSON.parse(process.argv[2]), { stateDir: process.argv[3] });
  `;
  const event = payload({ cwd });
  const children = Array.from({ length: 16 }, () => new Promise((resolve, reject) => {
    const childProcess = spawn(process.execPath, ['-e', child, script, JSON.stringify(event), stateDir], { cwd });
    let stderr = '';
    childProcess.stderr.on('data', (chunk) => { stderr += chunk; });
    childProcess.on('error', reject);
    childProcess.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}: ${stderr}`));
    });
  }));
  try {
    await Promise.all(children);
    const records = fs.readdirSync(stateDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8')));
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].failures, 16);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('success resets failures and target changes start at one', () => {
  const stateDir = fixtureDir();
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload(), { stateDir });
  const success = diagnostics.processEvent(payload({
    hook_event_name: 'PostToolUse',
    error: undefined,
    tool_response: { exit_code: 0 },
  }), { stateDir });
  const changed = diagnostics.processEvent(payload({
    tool_input: { command: 'npx eslint src/app.js' },
  }), { stateDir });

  assert.strictEqual(success.record.failures, 0);
  assert.strictEqual(changed.record.failures, 1);
  assert.strictEqual(changed.message, null);
});

test('session, project and subagent state are isolated', () => {
  const stateDir = fixtureDir();
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload(), { stateDir });
  const other = diagnostics.processEvent(payload({
    session_id: 'session-b', agent_id: 'agent-b', cwd: fixtureDir(),
  }), { stateDir });
  assert.strictEqual(other.record.failures, 1);
  assert.strictEqual(other.message, null);
});

test('subagent stop removes only that subagent state', () => {
  const stateDir = fixtureDir();
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload(), { stateDir });
  diagnostics.processEvent(payload({ agent_id: 'agent-b' }), { stateDir });
  const stopped = diagnostics.processEvent(payload({
    hook_event_name: 'SubagentStop',
    agent_id: 'agent-a',
    tool_input: undefined,
  }), { stateDir });
  const surviving = diagnostics.processEvent(payload({ agent_id: 'agent-b' }), { stateDir });

  assert.strictEqual(stopped.record.cleaned, true);
  assert.strictEqual(surviving.record.failures, 2);
  assert.ok(surviving.message);
});

test('non-validation commands are ignored', () => {
  const result = diagnostics.processEvent(payload({
    tool_input: { command: 'git status --short' },
  }), { stateDir: fixtureDir() });
  assert.strictEqual(result.record.ignored, true);
  assert.strictEqual(result.message, null);
});

test('classifier rejects shell composition and quoted false positives', () => {
  for (const command of [
    'echo "npm test"',
    'npm test && echo done',
    'printf npm test > report.txt',
    'git log --oneline',
  ]) {
    assert.strictEqual(diagnostics.deriveValidationTarget({ tool_input: { command } }), null, command);
  }
});

test('script names remain distinct while case selectors do not split the target', () => {
  assert.strictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'npm run test:api -- case-a' } }), 'npm:test:api');
  assert.strictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'npm run test:api -- case-b' } }), 'npm:test:api');
  assert.notStrictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'npm run test:web' } }), 'npm:test:api');
  assert.notStrictEqual(diagnostics.deriveValidationTarget({ tool_input: { command: 'cargo test' } }),
    diagnostics.deriveValidationTarget({ tool_input: { command: 'cargo clippy' } }));
});

test('interrupted or missing-session failures are ignored', () => {
  const stateDir = fixtureDir();
  assert.strictEqual(diagnostics.processEvent(payload({ is_interrupt: true }), { stateDir }).record.ignored, true);
  assert.strictEqual(diagnostics.processEvent(payload({ session_id: undefined }), { stateDir }).record.ignored, true);
  diagnostics.processEvent(payload(), { stateDir });
  assert.strictEqual(diagnostics.processEvent(payload({ error: 'Could not start process' }), { stateDir }).record.ignored, true);
  assert.strictEqual(diagnostics.processEvent(payload(), { stateDir }).record.failures, 2);
});

function edit(cwd) {
  return payload({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd });
}

test('project block mode pauses editing while default advisory does not', () => {
  const stateDir = fixtureDir();
  const cwd = fixtureDir();
  try {
    const fixture = payload({ cwd });
    diagnostics.processEvent(fixture, { stateDir });
    diagnostics.processEvent(fixture, { stateDir });
    assert.strictEqual(diagnostics.processEvent(edit(cwd), { stateDir }).message, null);

    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(path.join(cwd, '.claude/settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { validation_failure_mode: 'block' } } },
    }));
    diagnostics.processEvent(fixture, { stateDir });
    const read = diagnostics.processEvent(payload({
      hook_event_name: 'PreToolUse', tool_name: 'Read', cwd,
    }), { stateDir });
    assert.strictEqual(read.message, null);
    assert.strictEqual(diagnostics.processEvent(edit(cwd), { stateDir })
      .message.hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('an actual owned recovery command checks the observation and clears the matching latch', () => {
  const stateDir = fixtureDir();
  const cwd = fixtureDir();
  try {
    const base = { stateDir, mode: 'block' };
    const failed = payload({ cwd });
    diagnostics.processEvent(failed, base);
    diagnostics.processEvent(payload({ cwd, error: 'Exit code 1\nsecond case' }), base);
    diagnostics.processEvent(payload({
      cwd, hook_event_name: 'PostToolUse', tool_input: { command: 'git status --short' },
    }), base);
    diagnostics.processEvent(payload({
      cwd, tool_input: { command: 'npm run lint' },
    }), base);
    diagnostics.processEvent(payload({ cwd, hook_event_name: 'PostToolUse' }), base);
    assert.strictEqual(diagnostics.processEvent(edit(cwd), base).record.latch.target, 'npm:test');

    const script = path.join(__dirname, '..', 'scripts/hooks/validation-diagnostics.js');
    const args = {
      target: 'npm:test', premise: 'The runner selects the wrong config', file: 'package.json',
      observation: 'jest --config jest.old.config.js', proposed_change: 'Use the current config',
      rerun_plan: 'npm test',
    };
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: args.observation } }));
    const bad = spawnSync(process.execPath, [script, 'recover', JSON.stringify({ ...args, observation: 'unobserved' })], { cwd });
    assert.notStrictEqual(bad.status, 0);
    const raw = JSON.stringify(args);
    const recovered = spawnSync(process.execPath, [script, 'recover', raw], { cwd, encoding: 'utf8' });
    assert.strictEqual(recovered.status, 0, recovered.stderr);
    const event = payload({
      cwd, hook_event_name: 'PostToolUse',
      tool_input: { command: "node '" + script + "' recover '" + raw + "'" },
      tool_response: { stdout: recovered.stdout, exit_code: 0 },
    });
    diagnostics.processEvent({ ...event, tool_response: { stdout: '{}' } }, base);
    assert.ok(diagnostics.processEvent(edit(cwd), base).message);
    const result = diagnostics.processEvent(event, base);
    assert.strictEqual(result.record.recoveryEvidence.target, 'npm:test');
    assert.strictEqual(diagnostics.processEvent(edit(cwd), base).message, null);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('three identical failures require escalation, including after a target switch', () => {
  const stateDir = fixtureDir();
  try {
    const base = { stateDir, mode: 'block' };
    diagnostics.processEvent(payload(), base);
    diagnostics.processEvent(payload(), base);
    const stopped = diagnostics.processEvent(payload(), base);
    assert.strictEqual(stopped.record.latch.stopped, true);
    diagnostics.processEvent(payload({ tool_input: { command: 'npm run lint' } }), base);
    assert.strictEqual(diagnostics.processEvent(edit(process.cwd()), base).record.latch.stopped, true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('subagent stop cleans up every accepted identity field and never the main session', () => {
  for (const key of ['agent_id', 'agentId', 'subagent_id', 'subagentId']) {
    const stateDir = fixtureDir();
    try {
      const own = { agent_id: undefined, [key]: 'agent-a' };
      diagnostics.processEvent(payload(own), { stateDir });
      diagnostics.processEvent(payload({ agent_id: undefined }), { stateDir });
      const stopped = diagnostics.processEvent(payload({
        ...own, hook_event_name: 'SubagentStop', tool_input: undefined,
      }), { stateDir });
      assert.strictEqual(stopped.record.cleaned, true, key);
      assert.strictEqual(diagnostics.processEvent(payload(own), { stateDir }).record.failures, 1, key);
      const anonymous = diagnostics.processEvent(payload({
        agent_id: undefined, hook_event_name: 'SubagentStop', tool_input: undefined,
      }), { stateDir });
      assert.strictEqual(anonymous.record.ignored, true, key);
      assert.strictEqual(diagnostics.processEvent(payload({ agent_id: undefined }), { stateDir }).record.failures, 2, key);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
});

test('block mode gates the native edit tools only and says Bash writes do not resume work', () => {
  const stateDir = fixtureDir();
  try {
    const base = { stateDir, mode: 'block' };
    diagnostics.processEvent(payload(), base);
    diagnostics.processEvent(payload(), base);
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      const denied = diagnostics.processEvent(payload({ hook_event_name: 'PreToolUse', tool_name: tool }), base);
      assert.strictEqual(denied.message.hookSpecificOutput.permissionDecision, 'deny', tool);
      assert.match(denied.message.hookSpecificOutput.permissionDecisionReason, /Do not edit through Bash/);
    }
    const bash = diagnostics.processEvent(payload({
      hook_event_name: 'PreToolUse', tool_input: { command: 'grep -n jest package.json' },
    }), base);
    assert.strictEqual(bash.message, null);
    diagnostics.processEvent(payload({
      hook_event_name: 'PostToolUse', tool_input: { command: "sed -i s/a/b/ package.json" }, tool_response: { exit_code: 0 },
    }), base);
    assert.ok(diagnostics.processEvent(edit(process.cwd()), base).message);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('recovery rejects a symlinked, special, or oversized config', () => {
  const cwd = fs.realpathSync(fixtureDir());
  const outside = fs.realpathSync(fixtureDir());
  const script = path.join(__dirname, '..', 'scripts/hooks/validation-diagnostics.js');
  const recover = (file) => spawnSync(process.execPath, [script, 'recover', JSON.stringify({
    target: 'npm:test', premise: 'p', file, observation: 'observed', proposed_change: 'c', rerun_plan: 'npm test',
  })], { cwd, encoding: 'utf8', timeout: 10000 });
  try {
    const config = path.join(cwd, 'package.json');
    fs.writeFileSync(path.join(outside, 'package.json'), 'observed');
    fs.symlinkSync(path.join(outside, 'package.json'), config);
    assert.strictEqual(recover('package.json').status, 1);
    fs.symlinkSync(outside, path.join(cwd, 'linked'));
    assert.strictEqual(recover('linked/package.json').status, 1);
    fs.unlinkSync(config);
    assert.strictEqual(spawnSync('mkfifo', [config]).status, 0);
    assert.strictEqual(recover('package.json').status, 1);
    fs.unlinkSync(config);
    fs.writeFileSync(config, `observed${' '.repeat(262144)}`);
    assert.strictEqual(recover('package.json').status, 1);
    fs.writeFileSync(config, 'observed');
    assert.strictEqual(recover('package.json').status, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('recovery rejects a config swapped between path validation and read', () => {
  const cwd = fs.realpathSync(fixtureDir());
  const outside = path.join(fs.realpathSync(fixtureDir()), 'pytest.ini');
  const config = path.join(cwd, 'pytest.ini');
  const script = path.join(__dirname, '..', 'scripts/hooks/validation-diagnostics.js');
  const raw = JSON.stringify({
    target: 'direct:pytest', premise: 'p', file: 'pytest.ini', observation: 'observed', proposed_change: 'c', rerun_plan: 'pytest',
  });
  // Swap the validated file for a link to outside data right after the realpath check.
  const child = `
    const fs = require('node:fs');
    const [script, config, outside, raw] = process.argv.slice(1);
    const real = fs.realpathSync;
    fs.realpathSync = (target, ...rest) => {
      const resolved = real(target, ...rest);
      if (target === config) { fs.unlinkSync(config); fs.symlinkSync(outside, config); }
      return resolved;
    };
    const diagnostics = require(script);
    try {
      process.exitCode = diagnostics.verifyRecovery(raw, ${JSON.stringify(cwd)}) ? 0 : 3;
    } catch (error) {
      process.exitCode = error.code === 'ELOOP' ? 3 : 4;
    }
  `;
  try {
    fs.writeFileSync(config, 'harmless');
    fs.writeFileSync(outside, 'observed');
    const result = spawnSync(process.execPath, ['-e', child, script, config, outside, raw], { cwd, encoding: 'utf8' });
    assert.strictEqual(result.status, 3, `swapped config must not produce recovery evidence: ${result.stderr}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(path.dirname(outside), { recursive: true, force: true });
  }
});

test('a lock orphaned by a dead or ownerless hook is reclaimed while a live one is kept', () => {
  const stateDir = fixtureDir();
  const lockDirectory = () => {
    const name = fs.readdirSync(stateDir).find((entry) => entry.endsWith('.json'));
    return path.join(stateDir, `${name}.lock`);
  };
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  try {
    diagnostics.processEvent(payload(), { stateDir });
    const lock = lockDirectory();
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: dead, token: 'gone' }));
    const started = Date.now();
    assert.strictEqual(diagnostics.processEvent(payload(), { stateDir }).record.failures, 2);
    assert.ok(Date.now() - started < 2000, 'a dead owner must not stall the hook');

    fs.mkdirSync(lock);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lock, old, old);
    assert.strictEqual(diagnostics.processEvent(payload(), { stateDir }).record.failures, 3);
    assert.ok(!fs.existsSync(lock));

    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'live' }));
    assert.throws(() => diagnostics.processEvent(payload(), { stateDir, lockTimeoutMs: 100 }), /timed out/);
    assert.ok(fs.existsSync(lock), 'a live owner keeps its lock');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

run('validation-diagnostics');
