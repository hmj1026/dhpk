'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'skills', 'dhpk-cli-transport', 'scripts', 'run-cli-transport.py');
const SUCCESS = `#!/bin/sh
out=""; previous=""
for value in "$@"; do [ "$previous" = "--output-last-message" ] && out="$value"; previous="$value"; done
cat >/dev/null
printf 'ok\\n' > "$out"
printf 'approved' > allowed.txt
`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v -- ${name}`], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`missing ${name}`);
  return fs.realpathSync(result.stdout.trim());
}

function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function roleContract(effectiveRole, authority, requestedRole = effectiveRole) {
  const fields = { requested_role: requestedRole, effective_role: effectiveRole, authority, source_id: 'test.role-map' };
  return { schema: 'dhpk.role-contract.v1', ...fields, evidence_sha256: crypto.createHash('sha256').update(JSON.stringify(fields, Object.keys(fields).sort())).digest('hex') };
}
function promptEvidence(file) {
  const info = fs.statSync(file);
  return { path: fs.realpathSync(file), dev: info.dev, ino: info.ino, sha256: digest(file) };
}

function withRequest(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cli-transport-'));
  try {
    const artifactRoot = path.join(root, '.dhpk', 'cli-receipts');
    fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); fs.chmodSync(artifactRoot, 0o700);
    const binDir = path.join(root, 'bin'); fs.mkdirSync(binDir);
    const provider = path.join(binDir, 'codex'); fs.writeFileSync(provider, SUCCESS, { mode: 0o755 });
    const promptFile = path.join(root, 'prompt.txt'); fs.writeFileSync(promptFile, 'safe prompt');
    const python = commandPath('python3');
    const bash = commandPath('bash');
    const runtimePath = [...new Set([binDir, path.dirname(python), path.dirname(bash)])].join(path.delimiter);
    const request = {
      schema: 'dhpk.cli.request.v1', provider: 'codex', transport: 'codex-exec',
      requested_role: 'codex-worker', effective_role: 'codex-worker', role_contract: roleContract('codex-worker', 'workspace-write'),
      mode: 'workspace-write', workdir: root, prompt_file: promptFile, prompt_evidence: promptEvidence(promptFile),
      artifact_root: artifactRoot, receipt_path: path.join(artifactRoot, 'receipt.json'), assigned_files: ['allowed.txt'],
      report_only: true, timeout_secs: 3, task_id: 'task-test', attempt_id: 'attempt-test', requested_model: null, requested_effort: null,
      stdin_mode: 'prompt', adapter_metadata: {}, runtime_path: runtimePath, runtime_source_path: runtimePath,
      runtime_executables: {
        codex: { path: provider, sha256: digest(provider) },
        python3: { path: python, sha256: digest(python) },
        bash: { path: bash, sha256: digest(bash) },
      },
      command: [provider, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', root, '--output-last-message', '{transport_output}', '-'],
    };
    fn({ root, artifactRoot, provider, request, writeProvider: (source) => { fs.writeFileSync(provider, source, { mode: 0o755 }); request.runtime_executables.codex.sha256 = digest(provider); } });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function writeRequest(root, request, { attested = true } = {}) {
  if (attested) {
    const fields = ['requested_role', 'effective_role', 'role_contract', 'mode', 'workdir', 'prompt_file', 'artifact_root', 'receipt_path', 'assigned_files', 'report_only', 'timeout_secs', 'task_id', 'attempt_id', 'transport', 'requested_model', 'requested_effort', 'prompt_evidence'];
    const context = { schema: 'dhpk.cli.context.v1', provider: request.provider };
    for (const field of fields) context[field] = request[field];
    context.runtime_path = request.runtime_source_path;
    const raw = JSON.stringify(context); const contextPath = path.join(root, 'dispatch.json');
    fs.writeFileSync(contextPath, raw, { mode: 0o600 });
    request.attestation = { context_path: contextPath, context_sha256: crypto.createHash('sha256').update(raw).digest('hex') };
  }
  const requestPath = path.join(root, `request-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
  return requestPath;
}

function invoke(root, request, options) {
  const requestPath = writeRequest(root, request, options);
  return spawnSync(commandPath('python3'), [RUNNER, '--request', requestPath], { cwd: root, encoding: 'utf8', timeout: 10000 });
}

function invokeWithRunnerPatch(root, request, patch) {
  const requestPath = writeRequest(root, request);
  const driver = path.join(root, 'patched-runner.py');
  fs.writeFileSync(driver, [
    'import importlib.util, sys',
    `runner = ${JSON.stringify(RUNNER)}`,
    `request_path = ${JSON.stringify(requestPath)}`,
    'spec = importlib.util.spec_from_file_location("cli_transport_test_runner", runner)',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    patch,
    'sys.argv = [runner, "--request", request_path]',
    'sys.exit(module.main())',
  ].join('\n'), { mode: 0o600 });
  return spawnSync(commandPath('python3'), [driver], { cwd: root, encoding: 'utf8', timeout: 10000 });
}

test('read-only role cannot be widened and blocks before provider launch', () => {
  withRequest(({ root, request }) => {
    request.requested_role = request.effective_role = 'codex-reasoner';
    request.role_contract = roleContract('codex-reasoner', 'read-only');
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('a Codex request labelled agy-worker blocks before provider launch', () => {
  withRequest(({ root, request }) => {
    request.requested_role = request.effective_role = 'agy-worker';
    request.role_contract = roleContract('agy-worker', 'workspace-write');
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('legacy aliases retain the requested role while carrying a canonical effective role and digest', () => {
  withRequest(({ root, request }) => {
    for (const [requestedRole, effectiveRole, mode] of [
      ['codex-fast-worker', 'codex-worker', 'workspace-write'],
      ['codex-deep-reasoner', 'codex-reasoner', 'read-only'],
      ['codex-bridge', 'codex-reviewer', 'read-only'],
      ['codex-bridge', 'codex-worker', 'workspace-write'],
    ]) {
      request.requested_role = requestedRole;
      request.effective_role = effectiveRole;
      request.role_contract = roleContract(effectiveRole, mode, requestedRole);
      request.mode = mode;
      request.command = request.command.map((value) => value === 'workspace-write' || value === 'read-only' ? mode : value);
      const result = invoke(root, request);
      assert.strictEqual(result.status, 0, `${requestedRole}: ${result.stderr}`);
      fs.rmSync(request.receipt_path, { force: true });
    }
  });
});

test('legacy aliases with a non-canonical or contradictory effective role remain BLOCKED', () => {
  withRequest(({ root, request }) => {
    request.requested_role = 'codex-fast-worker';
    request.effective_role = 'codex-fast-worker';
    request.role_contract = roleContract('codex-fast-worker', 'workspace-write');
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('effective role labels cannot widen an already-attested request', () => {
  withRequest(({ root, request }) => {
    request.requested_role = 'codex-reasoner';
    request.effective_role = 'codex-worker';
    request.role_contract = roleContract('codex-worker', 'read-only', 'codex-reasoner');
    request.mode = 'read-only';
    request.command = request.command.map((value) => value === 'workspace-write' ? 'read-only' : value);
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('a pre-existing immutable receipt blocks before provider launch', () => {
  withRequest(({ root, request }) => {
    const existing = '{"prior":"receipt"}\n';
    fs.writeFileSync(request.receipt_path, existing, { mode: 0o600 });
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.strictEqual(fs.readFileSync(request.receipt_path, 'utf8'), existing);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('a provider-created receipt collision is replaced by the terminal BLOCKED receipt', () => {
  withRequest(({ root, request, writeProvider }) => {
    writeProvider(SUCCESS.replace(
      "printf 'approved' > allowed.txt",
      "printf '{\"forged\":true}\\n' > .dhpk/cli-receipts/receipt.json; printf 'approved' > allowed.txt",
    ));
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(request.receipt_path, 'utf8'));
    assert.strictEqual(receipt.schema, 'dhpk.cli.receipt.v1');
    assert.strictEqual(receipt.status, 'BLOCKED');
    assert.strictEqual(receipt.exit_code, 65);
    assert.ok(!Object.hasOwn(receipt, 'forged'));
    assert.strictEqual(fs.statSync(request.receipt_path).mode & 0o777, 0o600);
  });
});

test('direct runner input without attested context is BLOCKED before launch', () => {
  withRequest(({ root, request }) => {
    const result = invoke(root, request, { attested: false });
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('validation pins physical workdir and artifact-root descriptors before path-derived use', () => {
  const source = fs.readFileSync(RUNNER, 'utf8');
  const validation = source.slice(source.indexOf('def validate(request):'), source.indexOf('\ndef receipt('));
  assert.ok(validation.includes('workdir, workdir_fd = pinned_workdir(request.get("workdir", ""))'));
  assert.ok(validation.includes('artifact_root, artifact_fd = pinned_artifact_root(request.get("artifact_root", ""), workdir, workdir_fd)'));
  assert.ok(!validation.includes('workdir = nofollow_real_directory(request.get("workdir", ""), "workdir")'));
  assert.ok(!validation.includes('artifact_root = nofollow_real_directory(request.get("artifact_root", ""), "artifact_root", private=True)'));
});

test('out-of-scope writes and all workspace links fail closed', () => {
  withRequest(({ root, request, writeProvider }) => {
    writeProvider(SUCCESS.replace("printf 'approved' > allowed.txt", "printf no > unapproved.txt"));
    const failed = invoke(root, request);
    assert.strictEqual(failed.status, 1, failed.stderr);
    const receipt = JSON.parse(fs.readFileSync(request.receipt_path, 'utf8'));
    assert.strictEqual(receipt.status, 'FAILED');
    assert.deepStrictEqual(receipt.out_of_scope_paths, ['unapproved.txt']);
  });
  withRequest(({ root, request }) => {
    fs.symlinkSync('/tmp', path.join(root, 'existing-link'));
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
  withRequest(({ root, request }) => {
    fs.writeFileSync(path.join(root, 'linked-source.txt'), 'immutable source');
    fs.linkSync(path.join(root, 'linked-source.txt'), path.join(root, 'linked-alias.txt'));
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(/hardlink/i.test(result.stderr), result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('the runner rejects adapter argv injection before provider execution', () => {
  withRequest(({ root, request }) => {
    request.command.splice(1, 0, '--ephemeral');
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(/argv|command/i.test(result.stderr), result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('a group-writable provider executable blocks before provider launch', () => {
  withRequest(({ root, provider, request }) => {
    fs.chmodSync(provider, 0o775);
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('a post-validation runtime drift writes a complete BLOCKED receipt', () => {
  withRequest(({ root, provider, request }) => {
    const replacement = '#!/bin/sh\nexit 0\n';
    const result = invokeWithRunnerPatch(root, request, [
      'original = module.private_temporary_directory',
      'def drift_runtime(parent_fd):',
      `    open(${JSON.stringify(provider)}, 'w').write(${JSON.stringify(replacement)})`,
      `    __import__('os').chmod(${JSON.stringify(provider)}, 0o755)`,
      '    return original(parent_fd)',
      'module.private_temporary_directory = drift_runtime',
    ].join('\n'));
    assert.strictEqual(result.status, 65, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(request.receipt_path, 'utf8'));
    assert.strictEqual(receipt.status, 'BLOCKED');
    assert.deepStrictEqual(receipt.role_contract, request.role_contract);
    assert.strictEqual(receipt.timeout_secs, request.timeout_secs);
    assert.strictEqual(receipt.enforced_timeout, false);
    assert.strictEqual(receipt.verified_timeout, false);
    assert.strictEqual(receipt.exit_code, 65);
  });
});

test('workdir remount after its check blocks publication through the pinned artifact descriptor', () => {
  withRequest(({ root, request }) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cli-transport-remount-'));
    try {
      const moved = path.join(outside, 'moved-workdir');
      const result = invokeWithRunnerPatch(root, request, [
        'import os',
        'original = module.assert_pinned_workdir',
        'def remount(path, descriptor):',
        '    original(path, descriptor)',
        `    os.rename(${JSON.stringify(root)}, ${JSON.stringify(moved)})`,
        `    os.mkdir(${JSON.stringify(root)})`,
        `    os.rename(${JSON.stringify(path.join(moved, '.dhpk'))}, ${JSON.stringify(path.join(root, '.dhpk'))})`,
        'module.assert_pinned_workdir = remount',
      ].join('\n'));
      assert.strictEqual(result.status, 65, result.stderr);
      assert.ok(!fs.existsSync(request.receipt_path));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('reserved transport placeholders are rejected in attested model values before launch', () => {
  withRequest(({ root, request }) => {
    request.requested_model = 'model-{prompt}';
    request.command.splice(request.command.indexOf('--output-last-message'), 0, '-m', request.requested_model);
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'allowed.txt')));
  });
});

test('artifact-root replacement blocks and never publishes to the replacement path', () => {
  withRequest(({ root, request, writeProvider }) => {
    writeProvider(SUCCESS.replace("printf 'approved' > allowed.txt", "mv .dhpk .dhpk-moved; mkdir -p .dhpk/cli-receipts; chmod 700 .dhpk .dhpk/cli-receipts; printf 'approved' > allowed.txt"));
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(request.receipt_path));
    const pinnedReceipt = path.join(root, '.dhpk-moved', 'cli-receipts', 'receipt.json');
    assert.ok(!fs.existsSync(pinnedReceipt));
  });
});

test('artifact-root ancestor symlink replacement blocks every receipt publication path', () => {
  withRequest(({ root, request, writeProvider }) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cli-transport-outside-'));
    try {
      const movedRoot = path.join(outside, 'moved-dhpk');
      writeProvider(SUCCESS.replace(
        "printf 'approved' > allowed.txt",
        `mv .dhpk ${JSON.stringify(movedRoot)}; ln -s ${JSON.stringify(movedRoot)} .dhpk; printf 'approved' > allowed.txt`,
      ));
      const result = invoke(root, request);
      assert.strictEqual(result.status, 65, result.stderr);
      assert.ok(!fs.existsSync(request.receipt_path));
      assert.ok(!fs.existsSync(path.join(movedRoot, 'cli-receipts', 'receipt.json')));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('a post-launch artifact-root permission downgrade blocks receipt publication', () => {
  withRequest(({ root, request, writeProvider }) => {
    writeProvider(SUCCESS.replace("printf 'approved' > allowed.txt", "chmod 777 .dhpk/cli-receipts; printf 'approved' > allowed.txt"));
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(/artifact_root.*private|artifact_root changed/i.test(result.stderr), result.stderr);
  });
});

test('structured credential metadata and role-contract extras never reach a receipt', () => {
  withRequest(({ root, request }) => {
    request.adapter_metadata = { authorization: 'Bearer structured-secret', client_secret: 'client-secret-value' };
    request.role_contract.credential = 'role-contract-secret';
    const result = invoke(root, request);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(request.receipt_path));
  });
  withRequest(({ root, request }) => {
    request.adapter_metadata = { authorization: 'Bearer structured-secret', client_secret: 'client-secret-value' };
    const result = invoke(root, request);
    assert.strictEqual(result.status, 0, result.stderr);
    const serialized = fs.readFileSync(request.receipt_path, 'utf8');
    assert.ok(!serialized.includes('structured-secret'), serialized);
    assert.ok(!serialized.includes('client-secret-value'), serialized);
  });
});

test('receipt is 0600, immutable, and embeds its follow-up record atomically', () => {
  withRequest(({ root, request }) => {
    const result = invoke(root, request);
    assert.strictEqual(result.status, 0, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(request.receipt_path, 'utf8'));
    assert.strictEqual(receipt.status, 'SUCCEEDED');
    assert.strictEqual(fs.statSync(request.receipt_path).mode & 0o777, 0o600);
    assert.ok(receipt.follow_up && receipt.follow_up.record && receipt.follow_up.sha256);
    const repeat = invoke(root, request);
    assert.strictEqual(repeat.status, 65, repeat.stderr);
  });
});

test('process-group liveness treats an unreaped zombie member as terminated', () => {
  const script = [
    'import importlib.util, os, signal, subprocess, sys, time',
    `spec = importlib.util.spec_from_file_location('cli_transport_zombie_test', ${JSON.stringify(RUNNER)})`,
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    "child = subprocess.Popen(['/bin/sleep', '10'], start_new_session=True)",
    'os.kill(child.pid, signal.SIGKILL)',
    'deadline = time.time() + 2',
    'while time.time() < deadline:',
    '    try:',
    "        if open('/proc/%d/stat' % child.pid, 'r').read().rsplit(')', 1)[1].split()[0] == 'Z': break",
    '    except OSError: pass',
    '    time.sleep(0.01)',
    "else: raise RuntimeError('child did not become zombie')",
    'print(module.process_group_has_live_members(child.pid))',
  ].join('\n');
  const result = spawnSync(commandPath('python3'), ['-c', script], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), 'False');
});

test('runner timeout is terminal and quoted JSON-like secrets are redacted', () => {
  withRequest(({ root, request, writeProvider }) => {
    request.timeout_secs = 1;
    writeProvider(SUCCESS.replace("printf 'approved' > allowed.txt", "printf 'token=\\\"secret-value\\\"' >&2; sleep 4"));
    const result = invoke(root, request);
    assert.strictEqual(result.status, 124, result.stderr);
    const text = fs.readFileSync(request.receipt_path, 'utf8');
    assert.ok(!text.includes('secret-value'), text);
    assert.strictEqual(JSON.parse(text).status, 'TIMEOUT');
  });
});

test('provider report uses a bounded stream before the receipt is built', () => {
  withRequest(({ root, request, writeProvider }) => {
    request.assigned_files.push('output-transport-kind.txt');
    writeProvider(`#!/bin/sh
out=""; previous=""
for value in "$@"; do [ "$previous" = "--output-last-message" ] && out="$value"; previous="$value"; done
if [ -p "$out" ]; then printf pipe > output-transport-kind.txt; else printf regular > output-transport-kind.txt; fi
head -c 65536 /dev/zero | tr '\\0' x > "$out" || true
printf approved > allowed.txt
`);
    const result = invoke(root, request);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, 'output-transport-kind.txt'), 'utf8'), 'pipe');
    assert.strictEqual(JSON.parse(fs.readFileSync(request.receipt_path, 'utf8')).status, 'SUCCEEDED');
  });
});

run('run-cli-transport');
