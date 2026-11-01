'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SELECTOR = path.join(ROOT, 'scripts', 'fast-worker-selector.js');
const SESSION_START = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');
const selector = require(SELECTOR);
const catalog = require('../manifests/provider-model-catalog.json');
const hostProfiles = require('../manifests/host-profiles.json');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeCli(dir, name) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return bin;
}

function runCli(args, env = {}) {
  // Explicit env only: the child sees no inherited Host signal.
  const res = spawnSync(process.execPath, [SELECTOR, ...args], {
    env: { PATH: '/usr/bin:/bin', ...env },
    encoding: 'utf8',
  });
  let value = null;
  try { value = JSON.parse(res.stdout); } catch (error) { value = null; }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, value };
}

const HOST_SIGNALS = Object.freeze({
  'claude-code': { CLAUDECODE: '1' },
  'codex-cli': { CODEX_THREAD_ID: 'thread-1' },
  cursor: { CURSOR_AGENT: '1' },
  agy: { ANTIGRAVITY_CONVERSATION_ID: 'conv-1' },
});
const profileOf = (host) => hostProfiles.profiles.find((profile) => profile.host === host);

function sessionStart(repo, env = {}, payload = { source: 'startup', session_id: 'selection-test' }) {
  const childEnv = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: repo, ...env };
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_PAYLOAD" | bash "$DHPK_SESSION_START"'], {
    cwd: repo,
    env: { ...childEnv, DHPK_SESSION_START: SESSION_START, DHPK_PAYLOAD: JSON.stringify(payload) },
    encoding: 'utf8',
  });
}

test('detectHost resolves exactly one Host from a single signal', () => {
  for (const [host, signals] of Object.entries(HOST_SIGNALS)) {
    const detected = selector.detectHost(signals);
    assert.strictEqual(detected.status, 'DETECTED', host);
    assert.strictEqual(detected.host, host);
  }
});

test('detectHost honors the explicit DHPK_HOST override over signals', () => {
  const detected = selector.detectHost({ DHPK_HOST: 'codex-cli', CLAUDECODE: '1' });
  assert.strictEqual(detected.status, 'DETECTED');
  assert.strictEqual(detected.host, 'codex-cli');
  assert.strictEqual(selector.detectHost({ DHPK_HOST: 'not-a-host' }).status, 'BLOCKED');
});

test('detectHost is BLOCKED when no signal matches and names the signals checked', () => {
  const detected = selector.detectHost({});
  assert.strictEqual(detected.status, 'BLOCKED');
  assert.strictEqual(detected.host, undefined);
  for (const name of ['DHPK_HOST', 'CLAUDECODE', 'CODEX_THREAD_ID', 'CURSOR_AGENT', 'ANTIGRAVITY_CONVERSATION_ID']) {
    assert.ok(detected.reason.includes(name), `reason must name ${name}: ${detected.reason}`);
  }
});

test('detectHost is BLOCKED when two Hosts match at once', () => {
  const detected = selector.detectHost({ CLAUDECODE: '1', CODEX_THREAD_ID: 'thread-1' });
  assert.strictEqual(detected.status, 'BLOCKED');
  assert.ok(detected.reason.includes('claude-code') && detected.reason.includes('codex-cli'), detected.reason);
});

test('selector CLI resolves each Host profile worker default through the dispatch engine', () => {
  for (const host of Object.keys(HOST_SIGNALS)) {
    const res = runCli([], { DHPK_HOST: host });
    assert.strictEqual(res.status, 0, `${host}: ${res.stdout}${res.stderr}`);
    const expected = profileOf(host).role_defaults.worker;
    assert.strictEqual(res.value.status, 'RESOLVED');
    assert.strictEqual(res.value.resolution_source, 'dispatch-engine');
    assert.strictEqual(res.value.selected_target.target_agent, expected.target_agent, host);
    assert.strictEqual(res.value.selected_target.provider, expected.provider, host);
    assert.strictEqual(res.value.selected_target.model_id, expected.model_id, host);
  }
});

test('selector CLI detects the Host from its native signal without an override', () => {
  const res = runCli([], HOST_SIGNALS['codex-cli']);
  assert.strictEqual(res.status, 0, res.stdout);
  assert.strictEqual(res.value.selected_target.identity, `codex-cli/${profileOf('codex-cli').role_defaults.worker.model_id}`);
});

test('selector CLI keeps the mixed cursor and agy Role Defaults visible', () => {
  assert.strictEqual(runCli([], { DHPK_HOST: 'cursor' }).value.selected_target.target_agent, 'cursor');
  const agy = runCli([], { DHPK_HOST: 'agy' }).value.selected_target;
  assert.strictEqual(agy.target_agent, 'agy');
  assert.strictEqual(agy.provider, 'google');
});

test('undetectable Host exits non-zero with BLOCKED and selects no target', () => {
  const res = runCli([], {});
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.value.status, 'BLOCKED');
  assert.ok(res.value.reason.includes('host not detected'), res.value.reason);
  assert.ok(!res.value.selected_target, 'must not default to a target');
});

test('ambiguous Host signals exit non-zero with BLOCKED', () => {
  const res = runCli([], { CLAUDECODE: '1', CURSOR_AGENT: '1' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.value.status, 'BLOCKED');
  assert.ok(!res.value.selected_target);
});

test('executable on PATH is capability evidence for an explicit codex-cli target', () => {
  const dir = tempDir('dhpk-selector-codex-');
  try {
    const bin = fakeCli(dir, 'codex');
    const res = runCli(['--target', 'codex-cli/gpt-6-luna:high'], { DHPK_HOST: 'claude-code', PATH: `${bin}:/usr/bin:/bin` });
    assert.strictEqual(res.status, 0, res.stdout);
    assert.strictEqual(res.value.status, 'RESOLVED');
    assert.strictEqual(res.value.selected_target.target_agent, 'codex-cli');
    assert.strictEqual(res.value.selected_target.model_id, 'gpt-6-luna');
    assert.strictEqual(res.value.selected_target.effort, 'high');
    assert.strictEqual(res.value.selected_agent, 'dhpk:codex-worker');
    assert.strictEqual(res.value.resolution_source, 'dispatch-engine');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing codex executable makes the explicit target UNAVAILABLE and selects nothing else', () => {
  const res = runCli(['--target', 'codex-cli/gpt-6-luna:high'], { DHPK_HOST: 'claude-code', PATH: '/usr/bin:/bin' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.value.status, 'UNAVAILABLE');
  assert.ok(!res.value.selected_target, 'no other target may be selected');
  assert.ok(res.value.reason.includes('codex'), res.value.reason);
});

test('claude-code Host default maps to the dhpk:fast-worker subagent as presentation only', () => {
  const res = runCli([], { DHPK_HOST: 'claude-code' });
  assert.strictEqual(res.value.selected_agent, 'dhpk:fast-worker');
  assert.strictEqual(res.value.selected_target.target_agent, 'claude-code');
});

test('removed arguments exit BLOCKED naming the argument and its replacement', () => {
  for (const arg of ['--backend', '--order', '--fallback', '--failure', '--cross-provider']) {
    const res = runCli([arg, 'codex'], { DHPK_HOST: 'claude-code' });
    assert.notStrictEqual(res.status, 0, arg);
    assert.strictEqual(res.value.status, 'BLOCKED', arg);
    assert.ok(res.value.reason.includes(arg), `${arg}: ${res.value.reason}`);
    assert.ok(res.value.reason.includes('--target'), `${arg} must name the replacement: ${res.value.reason}`);
    assert.ok(!res.value.selected_target, arg);
  }
});

test('removed backend environment variables are not read', () => {
  const res = runCli([], {
    DHPK_HOST: 'codex-cli',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'agy',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'agy,claude',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'claude',
  });
  assert.strictEqual(res.status, 0, res.stdout);
  assert.strictEqual(res.value.selected_target.target_agent, 'codex-cli');
});

test('selector source holds no legacy backend selection path', () => {
  const source = fs.readFileSync(SELECTOR, 'utf8');
  for (const needle of ['native-dispatch-policy', 'DEFAULT_ORDER', 'BACKENDS', 'CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND', 'selected_backend']) {
    assert.ok(!source.includes(needle), `legacy identifier still present: ${needle}`);
  }
  for (const name of ['BACKENDS', 'DEFAULT_ORDER', 'parseArgs']) {
    assert.strictEqual(selector[name], undefined, `${name} must not be exported`);
  }
});

test('canonical worker selection builds a neutral request and returns resolved target evidence', () => {
  const cursor = hostProfiles.profiles.find((profile) => profile.host === 'cursor');
  const hostProfile = {
    ...cursor,
    access: {
      ...cursor.access,
      openai: { status: 'AVAILABLE', evidence: 'bounded local-cli probe' },
    },
  };
  const result = selector.select({
    host_profile: hostProfile,
    catalog,
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna-high', transport: 'native-runtime' },
    effort: 'high',
    task_id: 'selector-task-1',
    attempt_id: 'selector-attempt-1',
    description_digest: 'a'.repeat(64),
    workdir: '/workspace/project',
    assigned_files: ['src/example.js'],
    prompt_evidence: {
      path: '/workspace/project/.dhpk/prompt.txt',
      dev: 1,
      ino: 2,
      sha256: 'b'.repeat(64),
    },
  });

  assert.strictEqual(result.status, 'RESOLVED');
  assert.strictEqual(result.request.role, 'worker');
  assert.strictEqual(result.request.authority, 'workspace-write');
  assert.strictEqual(result.request.host_profile.host, 'cursor');
  assert.deepStrictEqual(result.selected_target, {
    target_agent: 'codex-cli',
    provider: 'openai',
    model_id: 'gpt-5.6-luna-high',
    model: 'gpt-5.6-luna-high',
    effort: 'high',
    route: 'native',
    transport: 'native-runtime',
    native: false,
    identity: 'codex-cli/gpt-5.6-luna-high',
  });
  assert.strictEqual(result.capability.status, 'AVAILABLE');
  assert.strictEqual(result.resolution_source, 'dispatch-engine');
});

test('session start remains activation-only when selector configuration is overridden or invalid', () => {
  const repo = tempDir('dhpk-session-selector-');
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const defaults = sessionStart(repo);
    assert.ok(!defaults.stdout.includes('fast_worker_backend='), defaults.stdout);
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { fast_worker_backend: 'agy', fast_worker_fallback: 'none' } } },
    }));
    const override = sessionStart(repo, {}, { source: 'startup', session_id: 'override' });
    assert.ok(!override.stdout.includes('fast_worker_backend='), override.stdout);
    assert.ok(!override.stderr.includes('invalid fast-worker selector'), override.stderr);
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { fast_worker_backend: 'wat' } } },
    }));
    const invalid1 = sessionStart(repo, {}, { source: 'startup', session_id: 'invalid' });
    const invalid2 = sessionStart(repo, {}, { source: 'startup', session_id: 'invalid' });
    assert.ok(!invalid1.stdout.includes('fast_worker_backend='), invalid1.stdout);
    assert.ok(!invalid2.stdout.includes('fast_worker_backend='), invalid2.stdout);
    assert.ok(!invalid1.stderr.includes('invalid fast-worker selector'), invalid1.stderr);
    assert.ok(!invalid2.stderr.includes('invalid fast-worker selector'), invalid2.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('all fast-worker report schemas expose the auditable selector contract', () => {
  for (const file of ['fast-worker.md', 'codex-worker.md', 'agy-worker.md']) {
    const prompt = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
    for (const field of ['Requested backend:', 'Selected backend:', 'Availability:', 'Fallback reason:', 'Model/effort:', 'Verify:', 'Edited files']) {
      assert.ok(prompt.includes(field), `${file} missing report field: ${field}`);
    }
  }
});

test('all fast-worker report schemas expose the parallel-mode assigned-scope contract', () => {
  for (const file of ['fast-worker.md', 'codex-worker.md']) {
    const prompt = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
    for (const field of ['Parallel: yes', 'Out-of-scope observations:', 'Out-of-scope writes:', 'Verification scope:']) {
      assert.ok(prompt.includes(field), `${file} missing parallel-mode report field: ${field}`);
    }
  }
});

run('fast-worker-selection');
