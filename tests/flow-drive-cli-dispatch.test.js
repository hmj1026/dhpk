'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { parseInvocation } = require('../skills/flow-drive/scripts/invocation');
const { prepareInvocationDispatch } = require('../skills/flow-drive/scripts/dispatch');
const { launchPacket } = require('../skills/flow-drive/scripts/launch-dispatch');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'skills', 'flow-drive', 'scripts', 'launch-dispatch.js');
const HOST_PROFILES = require('../manifests/host-profiles.json');
const CLAUDE_PROFILE = HOST_PROFILES.profiles.find((profile) => profile.host === 'claude-code');
const AGY_PROFILE = HOST_PROFILES.profiles.find((profile) => profile.host === 'agy');
const CLAUDE_AGY_DIAGNOSTIC = 'AGY dispatch is unavailable on the Claude Code host; the parent-session CLI integration is unsupported.';
const DEFAULT_CONFIG = Object.freeze({
  codex_worker_model: 'gpt-6-luna',
  codex_worker_effort: 'xhigh',
  codex_worker_timeout_secs: 3,
  codex_reasoner_model: 'gpt-6.1-sol',
  codex_reasoner_effort: 'high',
  codex_reasoner_timeout_secs: 3,
});

const CODEX_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$(pwd)/provider-argv.txt"
cat > "$(pwd)/provider-stdin.txt"
output=""; previous=""
for value in "$@"; do [ "$previous" = "--output-last-message" ] && output="$value"; previous="$value"; done
[ -n "$output" ] && printf 'fake codex completed\\n' > "$output"
`;

const CODEX_FAILURE_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$(pwd)/provider-argv.txt"
cat > "$(pwd)/provider-stdin.txt"
exit 17
`;

const CODEX_TIMEOUT_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$(pwd)/provider-argv.txt"
cat > "$(pwd)/provider-stdin.txt"
sleep 4
`;

function createHarness({
  args,
  role = 'worker',
  config = DEFAULT_CONFIG,
  reasonerResult,
  openaiStatus = 'AVAILABLE',
  confirmed = true,
  codexStub = CODEX_STUB,
  existingContext = null,
  providerGrant = true,
  profile = CLAUDE_PROFILE,
  invocationHost = 'claude-code',
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-cli-dispatch-'));
  const workdir = path.join(root, 'work');
  const artifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(binDir, { mode: 0o700 });
  fs.mkdirSync(path.join(workdir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workdir, 'src', 'worker.js'), 'fixture workspace file\n');
  fs.writeFileSync(path.join(workdir, 'prompt.txt'), 'Run the bounded fixture task.\n');
  fs.writeFileSync(path.join(binDir, 'codex'), codexStub, { mode: 0o755 });

  const prompt = path.join(workdir, 'prompt.txt');
  const scope = {
    artifact_root: artifactRoot,
    receipt_path: path.join(artifactRoot, 'provider-receipt.json'),
    context_path: path.join(artifactRoot, 'dispatch-context.json'),
    assigned_files: ['provider-argv.txt', 'provider-stdin.txt', 'src/worker.js'],
    report_only: true,
    runtime_path: [binDir, '/usr/bin', '/bin'].join(path.delimiter),
  };
  const hostProfile = {
    ...profile,
    access: {
      ...profile.access,
      openai: { status: openaiStatus, evidence: 'fixture Codex executable is present on the bounded test PATH' },
    },
  };
  const invocation = parseInvocation(['confirmed-cli-provider-change', ...args], { host: invocationHost });
  const packet = {
    change: { confirmed, change_id: 'confirmed-cli-provider-change' },
    invocation,
    role,
    host_profile: hostProfile,
    task_id: 'flow-drive-cli-dispatch-task',
    attempt_id: 'flow-drive-cli-dispatch-attempt',
    workdir,
    prompt,
    scope,
    config: { ...config },
  };
  const selection = role === 'reasoner' ? invocation.options.reasoner : invocation.options.workerTarget;
  packet.provider_grant = providerGrant === true ? {
    status: 'GRANTED', answer_id: 'fixture-provider-consent', task_id: packet.task_id, attempt_id: packet.attempt_id,
    role, authority: role === 'worker' ? 'workspace-write' : 'read-only', provider: 'openai', target_agent: 'codex-cli',
    model_id: selection && selection.model || config[role === 'worker' ? 'codex_worker_model' : 'codex_reasoner_model'],
    effort: selection && selection.effort || config[role === 'worker' ? 'codex_worker_effort' : 'codex_reasoner_effort'],
  } : providerGrant;
  if (reasonerResult) {
    const evidence = path.join(artifactRoot, 'reasoner-conclusion.json');
    fs.writeFileSync(evidence, JSON.stringify({ conclusion: 'the selected task is ready for the worker phase' }));
    packet.reasoner_result = { status: 'READY_FOR_DISPATCH', evidence };
  }
  if (existingContext !== null) fs.writeFileSync(scope.context_path, existingContext, { mode: 0o600 });
  const packetPath = path.join(root, 'dispatch-packet.json');
  fs.writeFileSync(packetPath, JSON.stringify(packet));

  return {
    root,
    workdir,
    packetPath,
    packet,
    scope,
    run() {
      return spawnSync(process.execPath, [ENTRY, '--packet', packetPath], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 20000,
      });
    },
    readContext() {
      return JSON.parse(fs.readFileSync(scope.context_path, 'utf8'));
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function hasNoProviderStart(harness) {
  return !fs.existsSync(path.join(harness.workdir, 'provider-argv.txt'));
}

function promptEvidence(prompt) {
  const stat = fs.statSync(prompt);
  return {
    path: prompt,
    dev: stat.dev,
    ino: stat.ino,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(prompt)).digest('hex'),
  };
}

test('an explicit external dispatcher target without a current exact Host grant never launches', () => {
  for (const providerGrant of [null, { status: 'GRANTED', answer_id: 'partial' },
    { status: 'REFUSED', answer_id: 'refusal' }]) {
    const harness = createHarness({ args: ['--worker=codex'], providerGrant });
    try {
      const result = harness.run();
      assert.strictEqual(result.status, 65, result.stderr);
      assert.match(result.stderr, /grant/);
      assert.strictEqual(hasNoProviderStart(harness), true);
      assert.strictEqual(fs.existsSync(harness.scope.context_path), false);
    } finally { harness.cleanup(); }
  }
});

test('Claude Code launches the selected Codex worker with dispatcher-attested role, authority, model, and effort', () => {
  const harness = createHarness({
    args: [
      '--plan=bounded', '--worker=codex', '--cross',
      '--reasoner=codex/gpt-6.1-sol:high', '--architect',
    ],
    role: 'worker',
    reasonerResult: true,
  });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 0, result.stderr);
    const context = harness.readContext();
    assert.strictEqual(context.schema, 'dhpk.cli.context.v1');
    assert.strictEqual(context.dispatching_agent, 'claude-code');
    assert.strictEqual(context.execution_provider, 'codex');
    assert.strictEqual(context.effective_role, 'codex-worker');
    assert.strictEqual(context.mode, 'workspace-write');
    assert.strictEqual(context.role_contract.authority, 'workspace-write');
    assert.strictEqual(context.requested_model, 'gpt-6-luna');
    assert.strictEqual(context.requested_effort, 'xhigh');
    assert.strictEqual(context.timeout_secs, 3);
    assert.strictEqual(context.task_id, 'flow-drive-cli-dispatch-task');
    assert.strictEqual(context.attempt_id, 'flow-drive-cli-dispatch-attempt');

    const argv = fs.readFileSync(path.join(harness.workdir, 'provider-argv.txt'), 'utf8').trimEnd().split('\n');
    assert.ok(argv.includes('-m'));
    assert.ok(argv.includes('gpt-6-luna'));
    assert.ok(argv.includes('model_reasoning_effort=xhigh'));
    assert.strictEqual(fs.readFileSync(path.join(harness.workdir, 'provider-stdin.txt'), 'utf8'), 'Run the bounded fixture task.\n');
    assert.strictEqual(JSON.parse(fs.readFileSync(harness.scope.receipt_path, 'utf8')).status, 'SUCCEEDED');
  } finally {
    harness.cleanup();
  }
});

test('a unified exact Codex worker selection reaches the literal target', () => {
  const harness = createHarness({
    args: ['--worker=codex/gpt-6-luna:xhigh'],
    role: 'worker',
  });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 0, result.stderr);
    const context = harness.readContext();
    assert.strictEqual(context.execution_provider, 'codex');
    assert.strictEqual(context.effective_role, 'codex-worker');
    assert.strictEqual(context.requested_model, 'gpt-6-luna');
    assert.strictEqual(context.requested_effort, 'xhigh');
  } finally {
    harness.cleanup();
  }
});

test('a native Claude Code reasoner selection resolves through the common dispatch engine', () => {
  const harness = createHarness({ args: ['--reasoner=claude'], role: 'reasoner', config: {} });
  try {
    const prepared = prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt));
    assert.strictEqual(prepared.resolution.status, 'RESOLVED');
    assert.strictEqual(prepared.resolution.target.provider, 'anthropic');
    assert.strictEqual(prepared.resolution.target.target_agent, 'claude-code');
    assert.strictEqual(prepared.request.effort, 'high');
  } finally {
    harness.cleanup();
  }
});

test('a supported exact native worker effort is preserved instead of substituting its default', () => {
  const model = CLAUDE_PROFILE.role_defaults.worker.model_id;
  const harness = createHarness({
    args: [`--worker=claude/${model}:high`],
    config: {},
  });
  try {
    const prepared = prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt));
    assert.strictEqual(prepared.resolution.status, 'RESOLVED');
    assert.strictEqual(prepared.request.effort, 'high');
    assert.strictEqual(prepared.resolution.target.effort, 'high');
    assert.deepStrictEqual(harness.packet.invocation.notices, []);
  } finally {
    harness.cleanup();
  }
});

test('an available native worker resolves before unused Codex fallback config is needed', () => {
  const harness = createHarness({
    args: ['--cross'],
    config: {},
    openaiStatus: 'NOT_RUN',
  });
  try {
    const prepared = prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt));
    assert.strictEqual(prepared.resolution.status, 'RESOLVED');
    assert.strictEqual(prepared.resolution.target.provider, 'anthropic');
    assert.strictEqual(prepared.resolution.target.target_agent, 'claude-code');
  } finally {
    harness.cleanup();
  }
});

test('the Codex reasoner shorthand uses configured model and effort with read-only authority', () => {
  const harness = createHarness({ args: ['--reasoner=codex'], role: 'reasoner' });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 0, result.stderr);
    const context = harness.readContext();
    assert.strictEqual(context.execution_provider, 'codex');
    assert.strictEqual(context.effective_role, 'codex-reasoner');
    assert.strictEqual(context.mode, 'read-only');
    assert.strictEqual(context.role_contract.authority, 'read-only');
    assert.strictEqual(context.requested_model, 'gpt-6.1-sol');
    assert.strictEqual(context.requested_effort, 'high');
  } finally {
    harness.cleanup();
  }
});

test('a worker is blocked before provider launch when its requested reasoner has no conclusion evidence', () => {
  const harness = createHarness({
    args: ['--worker=codex', '--reasoner=codex/gpt-6.1-sol:high'],
    role: 'worker',
  });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /reasoner_result|reasoner.*(?:READY_FOR_DISPATCH|evidence|conclusion)|(?:READY_FOR_DISPATCH|evidence|conclusion).*reasoner/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('a Codex launch is blocked before provider start when its role timeout is missing', () => {
  const config = { ...DEFAULT_CONFIG };
  delete config.codex_worker_timeout_secs;
  const harness = createHarness({ args: ['--worker=codex'], role: 'worker', config });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /timeout/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('an unsupported AGY selection on Claude Code is blocked before any provider launch', () => {
  const harness = createHarness({ args: ['--worker=agy'], role: 'worker' });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /agy|claude-code/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('Claude dispatch planning rejects a parser-ready bare AGY worker selection', () => {
  const harness = createHarness({
    args: ['--worker=agy'],
    invocationHost: null,
  });
  try {
    assert.strictEqual(harness.packet.invocation.status, 'ready');
    assert.strictEqual(harness.packet.host_profile.host, 'claude-code');
    assert.throws(
      () => prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt)),
      (error) => error.message === CLAUDE_AGY_DIAGNOSTIC,
    );
  } finally {
    harness.cleanup();
  }
});

test('Claude dispatch planning rejects a parser-ready bare AGY reasoner selection', () => {
  const harness = createHarness({
    args: ['--reasoner=agy'],
    role: 'reasoner',
    invocationHost: null,
  });
  try {
    assert.strictEqual(harness.packet.invocation.status, 'ready');
    assert.strictEqual(harness.packet.host_profile.host, 'claude-code');
    assert.throws(
      () => prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt)),
      (error) => error.message === CLAUDE_AGY_DIAGNOSTIC,
    );
  } finally {
    harness.cleanup();
  }
});

test('an AGY host continues to resolve its bare AGY worker selection', () => {
  const harness = createHarness({
    args: ['--worker=agy'],
    profile: AGY_PROFILE,
    invocationHost: 'agy',
  });
  try {
    const prepared = prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt));
    assert.strictEqual(prepared.resolution.status, 'RESOLVED');
    assert.strictEqual(prepared.resolution.target.provider, 'google');
    assert.strictEqual(prepared.resolution.target.target_agent, 'agy');
  } finally {
    harness.cleanup();
  }
});

test('an explicit Codex reasoner target overrides configured model and effort', () => {
  const config = {
    ...DEFAULT_CONFIG,
    codex_reasoner_model: 'gpt-6-luna',
    codex_reasoner_effort: 'medium',
  };
  const harness = createHarness({
    args: ['--reasoner=codex/gpt-6.1-sol:high'],
    role: 'reasoner',
    config,
  });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 0, result.stderr);
    const context = harness.readContext();
    assert.strictEqual(context.requested_model, 'gpt-6.1-sol');
    assert.strictEqual(context.requested_effort, 'high');
    assert.strictEqual(context.timeout_secs, 3);
  } finally {
    harness.cleanup();
  }
});

test('Codex dispatch is blocked when the Host profile records open access as NOT_RUN', () => {
  const harness = createHarness({ args: ['--worker=codex'], openaiStatus: 'NOT_RUN' });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /NOT_RUN|not run|not available|resolution/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('unconfirmed changes are blocked before Codex starts', () => {
  const harness = createHarness({ args: ['--worker=codex'], confirmed: false });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /confirm/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('an unsupported Codex model effort is blocked before provider execution', () => {
  const harness = createHarness({ args: ['--worker=codex/gpt-6-luna:ultra'] });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(result.stderr.includes('gpt-6-luna') && result.stderr.includes('ultra'), result.stderr);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('a reasoner dispatch without a reasoner selector is blocked before Codex starts', () => {
  const harness = createHarness({ args: ['--worker=codex'], role: 'reasoner' });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /reasoner/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('an existing context file is never overwritten or used to start Codex', () => {
  const sentinel = 'pre-existing context must remain untouched';
  const harness = createHarness({ args: ['--worker=codex'], existingContext: sentinel });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /context/i);
    assert.strictEqual(fs.readFileSync(harness.scope.context_path, 'utf8'), sentinel);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('malformed dispatch packets are blocked before provider execution', () => {
  const harness = createHarness({ args: ['--worker=codex'] });
  try {
    fs.writeFileSync(harness.packetPath, '{not valid JSON');
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /JSON|packet|parse|blocked/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

test('a Codex nonzero exit is reported with a failed receipt', () => {
  const harness = createHarness({ args: ['--worker=codex'], codexStub: CODEX_FAILURE_STUB });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 17, result.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(harness.scope.receipt_path, 'utf8')).status, 'FAILED');
  } finally {
    harness.cleanup();
  }
});

test('a Codex timeout is reported with a timeout receipt', () => {
  const config = { ...DEFAULT_CONFIG, codex_worker_timeout_secs: 1 };
  const harness = createHarness({ args: ['--worker=codex'], config, codexStub: CODEX_TIMEOUT_STUB });
  try {
    const result = harness.run();
    assert.strictEqual(result.status, 124, result.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(harness.scope.receipt_path, 'utf8')).status, 'TIMEOUT');
  } finally {
    harness.cleanup();
  }
});

test('prompt replacement after dispatch preparation is blocked before provider launch', () => {
  const harness = createHarness({ args: ['--worker=codex'] });
  const packet = JSON.parse(fs.readFileSync(harness.packetPath, 'utf8'));
  const { launchPacket } = require('../skills/flow-drive/scripts/launch-dispatch');
  const originalRead = fs.readFileSync;
  const promptStat = fs.statSync(packet.prompt);
  let swapped = false;
  fs.readFileSync = function readWithPromptSwap(file, ...args) {
    const result = originalRead.call(fs, file, ...args);
    if (!swapped && typeof file === 'number') {
      const stat = fs.fstatSync(file);
      if (stat.dev === promptStat.dev && stat.ino === promptStat.ino) {
        swapped = true;
        fs.writeFileSync(packet.prompt, 'Replacement task after initial fingerprint.\n');
      }
    }
    return result;
  };
  try {
    assert.throws(() => launchPacket(packet), /prompt.*changed|prompt.*fingerprint/i);
    assert.strictEqual(swapped, true);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    fs.readFileSync = originalRead;
    harness.cleanup();
  }
});

test('Codex dispatch creates a private context when the launcher inherits a restrictive umask', () => {
  const harness = createHarness({ args: ['--worker=codex'] });
  const parentUmask = process.umask();
  const child = [
    'process.umask(0o777);',
    `const { main } = require(${JSON.stringify(ENTRY)});`,
    `process.exitCode = main(['--packet', ${JSON.stringify(harness.packetPath)}]);`,
  ].join('\n');
  try {
    const result = spawnSync(process.execPath, ['-e', child], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.strictEqual(process.umask(), parentUmask);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.statSync(harness.scope.context_path).mode & 0o777, 0o600);
    assert.strictEqual(JSON.parse(fs.readFileSync(harness.scope.receipt_path, 'utf8')).status, 'SUCCEEDED');
    assert.deepStrictEqual(fs.readdirSync(harness.scope.artifact_root).sort(), [
      'dispatch-context.json',
      'provider-receipt.json',
    ]);
  } finally {
    harness.cleanup();
  }
});

test('Codex dispatch rejects an artifact directory accessible to group or other users', () => {
  const harness = createHarness({ args: ['--worker=codex'] });
  try {
    fs.chmodSync(harness.scope.artifact_root, 0o755);
    const result = harness.run();
    assert.strictEqual(result.status, 65, result.stderr);
    assert.match(result.stderr, /artifact.*private|artifact_root/i);
    assert.strictEqual(hasNoProviderStart(harness), true);
  } finally {
    harness.cleanup();
  }
});

for (const suffix of ['model', 'effort']) {
  test(`retired reasoner ${suffix} configuration reports migration guidance before public dispatch`, () => {
    const harness = createHarness({ args: ['--worker=codex'],
      config: { ...DEFAULT_CONFIG, [`codex_deep_reasoner_${suffix}`]: suffix === 'model' ? 'gpt-6.1-sol' : 'high' } });
    try {
      assert.throws(() => prepareInvocationDispatch(harness.packet, promptEvidence(harness.packet.prompt)),
        new RegExp(`codex_reasoner_${suffix}.*0\\.66\\.1`));
      const result = harness.run();
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`codex_reasoner_${suffix}`));
      assert.match(result.stderr, /0\.66\.1/);
      assert.strictEqual(hasNoProviderStart(harness), true);
    } finally { harness.cleanup(); }
  });
}

run('flow-drive-cli-dispatch');
