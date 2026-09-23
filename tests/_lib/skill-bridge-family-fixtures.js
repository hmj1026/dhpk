'use strict';

// Bridge-family authoring fixtures.  The fixture registry records the public
// entry, literal expected status/output, and the behavior oracle.  Execution
// is owned by skill-bridge-family-isolation.test.js and always happens from a
// relocated physical Skill tree.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
const { outputText, assertExpected } = require('./fixture-assertions');

const SYSTEM_PYTHON = '/usr/bin/python3';
const SYSTEM_BASH = '/bin/bash';
const RESERVED_ROOT_ENVIRONMENT = Object.freeze([
  'CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT', 'DHPK_SOURCE_ROOT',
  'DHPK_PLUGIN_ROOT', 'CURSOR_PLUGIN_ROOT', 'DHPK_CURSOR_PLUGIN_ROOT',
  'NODE_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME',
]);

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function digestFile(filePath) {
  return digestBytes(fs.readFileSync(filePath));
}

function roleContract(requestedRole, effectiveRole, authority) {
  const fields = {
    requested_role: requestedRole,
    effective_role: effectiveRole,
    authority,
    source_id: 'fixture.bridge-family',
  };
  return {
    schema: 'dhpk.role-contract.v1',
    ...fields,
    evidence_sha256: digestBytes(Buffer.from(JSON.stringify(fields, Object.keys(fields).sort()))),
  };
}

function promptEvidence(promptFile) {
  const info = fs.statSync(promptFile);
  return {
    path: fs.realpathSync(promptFile),
    dev: info.dev,
    ino: info.ino,
    sha256: digestFile(promptFile),
  };
}

function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  fs.writeFileSync(filePath, payload, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function writeJson(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), { mode });
  fs.chmodSync(filePath, mode);
}

function physicalRuntimePath(directories) {
  const seen = new Set();
  const resolved = [];
  for (const directory of directories) {
    const physical = fs.realpathSync(directory);
    if (seen.has(physical)) continue;
    seen.add(physical);
    resolved.push(physical);
  }
  return resolved.join(path.delimiter);
}

function makeTrustedRuntime(context, provider, includeProvider = true) {
  const runtimeDir = path.join(context.projectDir, '.fixture-runtime');
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o755 });
  fs.chmodSync(runtimeDir, 0o755);
  const providerPath = path.join(runtimeDir, provider);
  if (includeProvider) {
    const source = path.join(context.binDir, provider);
    if (!fs.statSync(source).isFile()) throw new Error(`fixture provider is unavailable: ${provider}`);
    fs.copyFileSync(source, providerPath);
    fs.chmodSync(providerPath, 0o755);
  }
  const runtimePath = physicalRuntimePath([runtimeDir, path.dirname(SYSTEM_PYTHON), path.dirname(SYSTEM_BASH)]);
  return { runtimeDir, runtimePath, providerPath: includeProvider ? providerPath : undefined };
}

function prepareProject(context, provider, options = {}) {
  const workdir = context.projectDir;
  const artifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
  const promptFile = path.join(workdir, 'prompt.txt');
  const assignedFiles = ['provider-marker.txt', 'provider-argv.json', 'provider-stdin.txt'];
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(artifactRoot, 0o700);
  fs.writeFileSync(promptFile, options.prompt || `fixture ${provider} prompt\n`, { mode: 0o600 });
  fs.chmodSync(promptFile, 0o600);
  const runtime = makeTrustedRuntime(context, provider, options.includeProvider !== false);
  return {
    workdir,
    artifactRoot,
    promptFile,
    assignedFiles,
    runtimeDir: runtime.runtimeDir,
    runtimePath: runtime.runtimePath,
    providerPath: runtime.providerPath,
    contextPath: path.join(artifactRoot, 'context.json'),
    receiptPath: path.join(artifactRoot, 'receipt.json'),
  };
}

function makeContext(state, options = {}) {
  const provider = options.provider || 'codex';
  const requestedRole = options.requestedRole || (provider === 'agy' ? 'agy-fast-worker' : 'codex-fast-worker');
  const effectiveRole = options.effectiveRole || (provider === 'agy' ? 'agy-worker' : 'codex-worker');
  const mode = options.mode || 'workspace-write';
  const authority = options.authority || mode;
  const context = {
    schema: 'dhpk.cli.context.v1',
    dispatching_agent: options.dispatchingAgent || 'fixture-dispatcher',
    execution_provider: provider,
    provider,
    requested_role: requestedRole,
    effective_role: effectiveRole,
    role_contract: roleContract(requestedRole, effectiveRole, authority),
    mode,
    workdir: state.workdir,
    prompt_file: state.promptFile,
    prompt_evidence: promptEvidence(state.promptFile),
    artifact_root: state.artifactRoot,
    receipt_path: state.receiptPath,
    assigned_files: [...state.assignedFiles],
    report_only: true,
    timeout_secs: options.timeoutSecs === undefined ? 3 : options.timeoutSecs,
    task_id: options.taskId || `bridge-${provider}-fixture`,
    attempt_id: options.attemptId || 'attempt-1',
    transport: options.transport || (provider === 'agy' ? 'agy-print' : 'codex-exec'),
    stdin_mode: options.stdinMode || (provider === 'agy' ? 'agy-confirmation' : 'prompt'),
    requested_model: options.model === undefined ? (provider === 'agy' ? 'fixture-agy-model' : 'fixture-codex-model') : options.model,
    requested_effort: options.effort === undefined ? (provider === 'agy' ? null : 'high') : options.effort,
    failure_class: options.failureClass === undefined ? null : options.failureClass,
    runtime_path: state.runtimePath,
  };
  writePrivate(state.contextPath, JSON.stringify(context));
  return { context, raw: fs.readFileSync(state.contextPath), contextPath: state.contextPath };
}

function attestation(contextPath) {
  return {
    context_path: contextPath,
    context_sha256: digestFile(contextPath),
  };
}

function runtimeEvidence(state, provider, includeProvider = true) {
  const names = includeProvider ? [provider, 'python3', 'bash'] : ['python3', 'bash'];
  const result = {};
  for (const name of names) {
    const filePath = name === provider
      ? path.join(state.runtimeDir, name)
      : path.join(name === 'python3' ? path.dirname(SYSTEM_PYTHON) : path.dirname(SYSTEM_BASH), name);
    result[name] = { path: fs.realpathSync(filePath), sha256: digestFile(filePath) };
  }
  return result;
}

function requestFromContext(state, contextRecord, options = {}) {
  const context = contextRecord.context;
  const provider = options.provider || context.provider;
  const providerPath = options.providerPath || state.providerPath;
  const command = provider === 'codex'
    ? [providerPath, 'exec', '--skip-git-repo-check', '--sandbox', context.mode,
      '-c', 'approval_policy=never', '--cd', context.workdir,
      ...(context.requested_model ? ['-m', context.requested_model] : []),
      ...(context.requested_effort && context.requested_effort !== 'ultra'
        ? ['-c', `model_reasoning_effort=${context.requested_effort}`] : []),
      '--output-last-message', '{transport_output}', '-']
    : [providerPath, '--dangerously-skip-permissions', '--mode', 'accept-edits',
      '--add-dir', context.workdir, '--model', context.requested_model,
      '--print-timeout', '300s', '-p', '{prompt}'];
  return {
    schema: 'dhpk.cli.request.v1',
    provider,
    transport: provider === 'agy' ? 'agy-print' : 'codex-exec',
    requested_role: context.requested_role,
    effective_role: context.effective_role,
    role_contract: context.role_contract,
    mode: context.mode,
    workdir: context.workdir,
    prompt_file: context.prompt_file,
    prompt_evidence: context.prompt_evidence,
    artifact_root: context.artifact_root,
    receipt_path: context.receipt_path,
    assigned_files: context.assigned_files,
    report_only: context.report_only,
    timeout_secs: context.timeout_secs,
    task_id: context.task_id,
    attempt_id: context.attempt_id,
    requested_model: context.requested_model,
    requested_effort: context.requested_effort,
    failure_class: context.failure_class,
    stdin_mode: provider === 'agy' ? 'agy-confirmation' : 'prompt',
    adapter_metadata: {},
    runtime_path: state.runtimePath,
    runtime_source_path: context.runtime_path,
    runtime_executables: runtimeEvidence(state, provider),
    command,
    attestation: attestation(contextRecord.contextPath),
  };
}

function runApiDriver(context, source, args = []) {
  const driver = path.join(context.projectDir, '.bridge-family-driver.js');
  fs.writeFileSync(driver, source, { mode: 0o600 });
  try {
    return {
      ...spawnSync(process.execPath, [driver, context.skillDir, ...args], {
        cwd: context.projectDir,
        env: context.env,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
      }),
      evidenceKind: 'fixture',
      hostStatus: 'NOT_RUN',
    };
  } finally {
    fs.rmSync(driver, { force: true });
  }
}

function dispatchDriver(context, entryArgs) {
  return runApiDriver(context, String.raw`
'use strict';
const path = require('node:path');
const skillDir = process.argv[2];
const args = JSON.parse(process.argv[3]);
const launcher = path.join(skillDir, 'scripts', 'launch-cli-dispatch.js');
const result = require(launcher).main(args);
process.exitCode = result;
`, [JSON.stringify(entryArgs)]);
}

function fixture(definition) {
  return {
    ...definition,
    assert(result, context, state) {
      assertExpected(result, definition.expected, definition.id);
      if (definition.verify) definition.verify(result, context, state);
    },
  };
}

function assertReceipt(state, expectedStatus = 'SUCCEEDED') {
  if (!fs.existsSync(state.receiptPath)) throw new Error(`missing fixture receipt: ${state.receiptPath}`);
  const info = fs.lstatSync(state.receiptPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('fixture receipt must be a regular file');
  if ((info.mode & 0o777) !== 0o600) throw new Error('fixture receipt must be mode 0600');
  const receipt = JSON.parse(fs.readFileSync(state.receiptPath, 'utf8'));
  if (receipt.status !== expectedStatus) throw new Error(`expected ${expectedStatus} receipt, got ${receipt.status}`);
  return receipt;
}

function assertProviderEvidence(state, provider, { stdin, model, effort } = {}) {
  if (fs.readFileSync(path.join(state.workdir, 'provider-marker.txt'), 'utf8') !== `${provider}-fixture-provider\n`) {
    throw new Error(`unexpected ${provider} provider marker`);
  }
  const argv = JSON.parse(fs.readFileSync(path.join(state.workdir, 'provider-argv.json'), 'utf8'));
  const capturedStdin = fs.readFileSync(path.join(state.workdir, 'provider-stdin.txt'), 'utf8');
  if (stdin !== undefined && capturedStdin !== stdin) throw new Error(`unexpected ${provider} stdin: ${JSON.stringify(capturedStdin)}`);
  if (model !== undefined && !argv.includes(model)) throw new Error(`provider argv omitted model ${model}: ${JSON.stringify(argv)}`);
  if (effort !== undefined && !argv.includes(`model_reasoning_effort=${effort}`)) throw new Error(`provider argv omitted effort ${effort}: ${JSON.stringify(argv)}`);
  return argv;
}

function dispatchInputs(state, provider, overrides = {}) {
  const scopePath = path.join(state.workdir, 'scope.json');
  const configPath = path.join(state.workdir, 'config.json');
  writeJson(scopePath, {
    artifact_root: state.artifactRoot,
    receipt_path: state.receiptPath,
    context_path: state.contextPath,
    assigned_files: state.assignedFiles,
    report_only: true,
    runtime_path: state.runtimePath,
  });
  const isAgy = provider === 'agy';
  writeJson(configPath, isAgy
    ? { agy_worker_model: overrides.model || 'fixture-agy-model', agy_worker_timeout_secs: 3 }
    : { codex_worker_model: overrides.model || 'fixture-codex-model', codex_worker_effort: 'high', codex_worker_timeout_secs: 3 });
  const args = [
    '--dispatching-agent', overrides.dispatchingAgent || (isAgy ? 'codex' : 'claude'),
    '--execution-provider', provider,
    '--requested-role', overrides.requestedRole || (isAgy ? 'agy-worker' : 'codex-fast-worker'),
    '--mode', overrides.mode || 'workspace-write',
    '--task-id', overrides.taskId || `bridge-dispatch-${provider}`,
    '--attempt-id', overrides.attemptId || 'attempt-1',
    '--workdir', state.workdir,
    '--prompt', state.promptFile,
    '--scope', scopePath,
    '--config-layer', configPath,
  ];
  return { args, scopePath, configPath };
}

const CODEX_PROVIDER = {
  body: [
    "const fs=require('node:fs');",
    "const args=process.argv.slice(1);",
    "let output=''; let previous='';",
    "for(const value of args){if(previous==='--output-last-message')output=value; previous=value;}",
    "fs.writeFileSync('provider-marker.txt','codex-fixture-provider\\n');",
    "fs.writeFileSync('provider-argv.json',JSON.stringify(args));",
    "let input=''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',chunk=>input+=chunk);",
    "process.stdin.on('end',()=>{fs.writeFileSync('provider-stdin.txt',input); fs.writeFileSync(output,'fixture-codex-report token=\\\"fixture-secret\\\"\\n');});",
  ].join(''),
};

const AGY_PROVIDER = {
  body: [
    "const fs=require('node:fs');",
    "const args=process.argv.slice(1);",
    "fs.writeFileSync('provider-marker.txt','agy-fixture-provider\\n');",
    "fs.writeFileSync('provider-argv.json',JSON.stringify(args));",
    "let input=''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',chunk=>input+=chunk);",
    "process.stdin.on('end',()=>{fs.writeFileSync('provider-stdin.txt',input); process.stdout.write('fixture-agy-report\\n');});",
  ].join(''),
};

const DEFINITIONS = [
  fixture({
    id: 'bridge-codex-contained-success',
    source: 'codex-bridge',
    entry: 'scripts/run-codex.sh',
    expected: { status: 0, output: ['fixture-codex-report token=[REDACTED]'] },
    stubs: { codex: CODEX_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'codex');
      const record = makeContext(state, { model: 'fixture-codex-model', effort: 'high' });
      return { state, record };
    },
    run(context, prepared) {
      return context.run(this.entry, ['workspace-write', prepared.state.workdir, prepared.state.promptFile, 'fixture-codex-model', 'high'], {
        env: { DHPK_CLI_TRANSPORT_CONTEXT: prepared.record.contextPath },
      });
    },
    verify(result, context, prepared) {
      const receipt = assertReceipt(prepared.state);
      const argv = assertProviderEvidence(prepared.state, 'codex', {
        stdin: 'fixture codex prompt\n', model: 'fixture-codex-model', effort: 'high',
      });
      for (const expected of ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', 'approval_policy=never', '--cd', prepared.state.workdir, '-m', 'fixture-codex-model', 'model_reasoning_effort=high', '--output-last-message', '-']) {
        if (!argv.includes(expected)) throw new Error(`Codex argv omitted ${expected}: ${JSON.stringify(argv)}`);
      }
      if (receipt.out_of_scope_paths.length !== 0) throw new Error('Codex success wrote outside assigned files');
      if (JSON.stringify(receipt).includes('fixture-secret')) throw new Error('Codex receipt leaked fixture secret');
      if (receipt.report_present !== true || receipt.follow_up.record.immutable !== true) throw new Error('Codex receipt is not terminal/immutable');
    },
  }),
  fixture({
    id: 'bridge-codex-attestation-required',
    source: 'codex-bridge',
    entry: 'scripts/run-codex.sh',
    expected: { status: 65, output: ['run-codex.sh: BLOCKED: attested DHPK_CLI_TRANSPORT_CONTEXT is required; legacy authority is never inferred.'], absent: ['codex-fixture-provider'] },
    stubs: { codex: CODEX_PROVIDER },
    prepare(context) {
      return { state: prepareProject(context, 'codex') };
    },
    run(context, prepared) {
      return context.run(this.entry, ['workspace-write', prepared.state.workdir, prepared.state.promptFile, 'fixture-codex-model', 'high']);
    },
    verify(result, context, prepared) {
      if (fs.readdirSync(prepared.state.artifactRoot).length !== 0) throw new Error('missing-attestation path created a request or receipt');
      if (fs.existsSync(path.join(prepared.state.workdir, 'provider-marker.txt'))) throw new Error('provider ran without attestation');
    },
  }),
  fixture({
    id: 'bridge-codex-tool-unavailable',
    source: 'codex-bridge',
    entry: 'scripts/run-codex.sh',
    expected: { status: 65, output: ['attested restricted runtime is missing named executable codex'], absent: ['codex-fixture-provider'] },
    stubs: {},
    prepare(context) {
      const state = prepareProject(context, 'codex', { includeProvider: false });
      const record = makeContext(state, { model: 'fixture-codex-model', effort: 'high' });
      return { state, record };
    },
    run(context, prepared) {
      return context.run(this.entry, ['workspace-write', prepared.state.workdir, prepared.state.promptFile, 'fixture-codex-model', 'high'], {
        env: { DHPK_CLI_TRANSPORT_CONTEXT: prepared.record.contextPath },
      });
    },
    verify(result, context, prepared) {
      if (fs.existsSync(path.join(prepared.state.workdir, 'provider-marker.txt'))) throw new Error('unavailable Codex provider ran');
      if (fs.existsSync(prepared.state.receiptPath)) {
        const receipt = JSON.parse(fs.readFileSync(prepared.state.receiptPath, 'utf8'));
        if (receipt.status === 'SUCCEEDED') throw new Error('unavailable Codex provider produced success');
      }
    },
  }),
  fixture({
    id: 'bridge-agy-contained-success',
    source: 'agy-fast-worker',
    entry: 'scripts/run-agy.sh',
    expected: { status: 0, output: ['fixture-agy-report'] },
    stubs: { agy: AGY_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'agy', { prompt: 'fixture agy prompt\n' });
      const record = makeContext(state, { provider: 'agy', requestedRole: 'agy-fast-worker', effectiveRole: 'agy-worker', model: 'fixture-agy-model', effort: null });
      return { state, record };
    },
    run(context, prepared) {
      return context.run(this.entry, [prepared.state.workdir, prepared.state.promptFile, 'fixture-agy-model'], {
        env: { DHPK_CLI_TRANSPORT_CONTEXT: prepared.record.contextPath },
      });
    },
    verify(result, context, prepared) {
      const receipt = assertReceipt(prepared.state);
      const argv = assertProviderEvidence(prepared.state, 'agy', { stdin: 'Y\n', model: 'fixture-agy-model' });
      for (const expected of ['--dangerously-skip-permissions', '--mode', 'accept-edits', '--add-dir', prepared.state.workdir, '--model', 'fixture-agy-model', '--print-timeout', '300s', '-p', 'fixture agy prompt\n']) {
        if (!argv.includes(expected)) throw new Error(`AGY argv omitted ${expected}: ${JSON.stringify(argv)}`);
      }
      if (receipt.out_of_scope_paths.length !== 0 || receipt.follow_up.record.immutable !== true) throw new Error('AGY receipt is not contained/immutable');
    },
  }),
  fixture({
    id: 'bridge-agy-attestation-required',
    source: 'agy-fast-worker',
    entry: 'scripts/run-agy.sh',
    expected: { status: 65, output: ['run-agy.sh: BLOCKED: attested DHPK_CLI_TRANSPORT_CONTEXT is required; legacy authority is never inferred.'], absent: ['agy-fixture-provider'] },
    stubs: { agy: AGY_PROVIDER },
    prepare(context) {
      return { state: prepareProject(context, 'agy', { prompt: 'fixture agy prompt\n' }) };
    },
    run(context, prepared) {
      return context.run(this.entry, [prepared.state.workdir, prepared.state.promptFile, 'fixture-agy-model']);
    },
    verify(result, context, prepared) {
      if (fs.readdirSync(prepared.state.artifactRoot).length !== 0) throw new Error('missing AGY attestation created a request or receipt');
      if (fs.existsSync(path.join(prepared.state.workdir, 'provider-marker.txt'))) throw new Error('AGY provider ran without attestation');
    },
  }),
  fixture({
    id: 'bridge-agy-tool-unavailable',
    source: 'agy-fast-worker',
    entry: 'scripts/run-agy.sh',
    expected: { status: 65, output: ['attested restricted runtime is missing named executable agy'], absent: ['agy-fixture-provider'] },
    stubs: {},
    prepare(context) {
      const state = prepareProject(context, 'agy', { includeProvider: false, prompt: 'fixture agy prompt\n' });
      const record = makeContext(state, { provider: 'agy', requestedRole: 'agy-fast-worker', effectiveRole: 'agy-worker', model: 'fixture-agy-model', effort: null });
      return { state, record };
    },
    run(context, prepared) {
      return context.run(this.entry, [prepared.state.workdir, prepared.state.promptFile, 'fixture-agy-model'], {
        env: { DHPK_CLI_TRANSPORT_CONTEXT: prepared.record.contextPath },
      });
    },
    verify(result, context, prepared) {
      if (fs.existsSync(path.join(prepared.state.workdir, 'provider-marker.txt'))) throw new Error('unavailable AGY provider ran');
      if (fs.existsSync(prepared.state.receiptPath)) {
        const receipt = JSON.parse(fs.readFileSync(prepared.state.receiptPath, 'utf8'));
        if (receipt.status === 'SUCCEEDED') throw new Error('unavailable AGY provider produced success');
      }
    },
  }),
  fixture({
    id: 'bridge-dispatch-codex-local-closure',
    source: 'cli-dispatch-context',
    entry: 'scripts/launch-cli-dispatch.js',
    expected: { status: 0, output: ['fixture-codex-report token=[REDACTED]'] },
    stubs: { codex: CODEX_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'codex');
      return { state, dispatch: dispatchInputs(state, 'codex', { requestedRole: 'codex-fast-worker' }) };
    },
    run(context, prepared) {
      return dispatchDriver(context, prepared.dispatch.args);
    },
    verify(result, context, prepared) {
      const state = prepared.state;
      const contextInfo = fs.lstatSync(state.contextPath);
      if (!contextInfo.isFile() || contextInfo.isSymbolicLink() || (contextInfo.mode & 0o777) !== 0o600) throw new Error('dispatcher context must be private physical 0600');
      const dispatchContext = JSON.parse(fs.readFileSync(state.contextPath, 'utf8'));
      if (dispatchContext.requested_role !== 'codex-fast-worker' || dispatchContext.effective_role !== 'codex-worker') throw new Error('Codex alias identity was not preserved/canonicalized');
      if (dispatchContext.role_contract.authority !== 'workspace-write' || dispatchContext.provider !== 'codex' || dispatchContext.transport !== 'codex-exec' || dispatchContext.mode !== 'workspace-write') throw new Error('Codex dispatch authority/transport contract changed');
      const fields = { requested_role: dispatchContext.role_contract.requested_role, effective_role: dispatchContext.role_contract.effective_role, authority: dispatchContext.role_contract.authority, source_id: dispatchContext.role_contract.source_id };
      if (dispatchContext.role_contract.evidence_sha256 !== digestBytes(Buffer.from(JSON.stringify(fields, Object.keys(fields).sort())))) throw new Error('Codex role contract digest is invalid');
      const receipt = assertReceipt(state);
      assertProviderEvidence(state, 'codex', { stdin: 'fixture codex prompt\n', model: 'fixture-codex-model', effort: 'high' });
      if (receipt.requested_transport !== 'codex-exec' || receipt.mode !== 'workspace-write') throw new Error('Codex receipt transport/mode mismatch');
    },
  }),
  fixture({
    id: 'bridge-dispatch-agy-local-closure',
    source: 'cli-dispatch-context',
    entry: 'scripts/launch-cli-dispatch.js',
    expected: { status: 0, output: ['fixture-agy-report'] },
    stubs: { agy: AGY_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'agy', { prompt: 'fixture agy prompt\n' });
      return { state, dispatch: dispatchInputs(state, 'agy', { dispatchingAgent: 'codex', requestedRole: 'agy-worker', model: 'fixture-agy-model' }) };
    },
    run(context, prepared) {
      return dispatchDriver(context, prepared.dispatch.args);
    },
    verify(result, context, prepared) {
      const dispatchContext = JSON.parse(fs.readFileSync(prepared.state.contextPath, 'utf8'));
      if (dispatchContext.dispatching_agent !== 'codex' || dispatchContext.execution_provider !== 'agy' || dispatchContext.provider !== 'agy') throw new Error('AGY dispatching identity/provider binding changed');
      if (dispatchContext.effective_role !== 'agy-worker' || dispatchContext.mode !== 'workspace-write' || dispatchContext.role_contract.authority !== 'workspace-write') throw new Error('AGY role authority changed');
      if (dispatchContext.requested_model !== 'fixture-agy-model' || dispatchContext.transport !== 'agy-print') throw new Error('AGY model/transport binding changed');
      const receipt = assertReceipt(prepared.state);
      assertProviderEvidence(prepared.state, 'agy', { stdin: 'Y\n', model: 'fixture-agy-model' });
      if (receipt.requested_transport !== 'agy-print' || receipt.mode !== 'workspace-write') throw new Error('AGY receipt transport/mode mismatch');
    },
  }),
  fixture({
    id: 'bridge-dispatch-rejected-authority',
    source: 'cli-dispatch-context',
    entry: 'scripts/launch-cli-dispatch.js',
    expected: { status: 65, output: ['launch-cli-dispatch: BLOCKED: role agy-worker contradicts mode read-only'], absent: ['agy-fixture-provider'] },
    stubs: { agy: AGY_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'agy', { prompt: 'rejected authority prompt\n' });
      return { state, dispatch: dispatchInputs(state, 'agy', { dispatchingAgent: 'codex', requestedRole: 'agy-worker', mode: 'read-only', model: 'fixture-agy-model' }) };
    },
    run(context, prepared) {
      return dispatchDriver(context, prepared.dispatch.args);
    },
    verify(result, context, prepared) {
      if (fs.existsSync(prepared.state.contextPath)) throw new Error('rejected authority wrote a context');
      if (fs.existsSync(prepared.state.receiptPath)) throw new Error('rejected authority wrote a receipt');
      if (fs.existsSync(path.join(prepared.state.workdir, 'provider-marker.txt'))) throw new Error('rejected authority ran AGY');
    },
  }),
  fixture({
    id: 'bridge-transport-prepare-attested',
    source: 'cli-transport',
    entry: 'scripts/prepare-cli-request.py',
    expected: { status: 0, output: ['"schema":"dhpk.cli.request.v1"', '"stdin_mode":"prompt"', '"transport":"codex-exec"'] },
    stubs: { codex: CODEX_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'codex');
      return { state, record: makeContext(state, { model: 'fixture-codex-model', effort: 'high' }) };
    },
    run(context, prepared) {
      const state = prepared.state;
      return context.run(this.entry, [
        '--context', prepared.record.contextPath,
        '--provider', 'codex', '--mode', 'workspace-write',
        '--workdir', state.workdir, '--prompt-file', state.promptFile,
        '--model', 'fixture-codex-model', '--effort', 'high',
        '--bootstrap-python', SYSTEM_PYTHON,
      ]);
    },
    verify(result, context, prepared) {
      const request = JSON.parse(result.stdout);
      const state = prepared.state;
      if (request.attestation.context_sha256 !== digestFile(prepared.record.contextPath)) throw new Error('prepare attestation digest is not bound to context bytes');
      if (request.role_contract.evidence_sha256 !== prepared.record.context.role_contract.evidence_sha256) throw new Error('prepare role contract digest changed');
      if (request.provider !== 'codex' || request.transport !== 'codex-exec' || request.stdin_mode !== 'prompt') throw new Error('prepare provider transport contract changed');
      if (request.workdir !== state.workdir || request.prompt_file !== state.promptFile || request.artifact_root !== state.artifactRoot || request.receipt_path !== state.receiptPath || request.timeout_secs !== 3) throw new Error('prepare scope/timeout changed');
      if (request.task_id !== prepared.record.context.task_id || request.attempt_id !== prepared.record.context.attempt_id || request.failure_class !== null) throw new Error('prepare identity/failure class changed');
      if (request.runtime_executables.codex.sha256 !== digestFile(state.providerPath)) throw new Error('prepare runtime evidence omitted fixture provider digest');
      if (fs.existsSync(path.join(state.workdir, 'provider-marker.txt'))) throw new Error('prepare started provider process');
    },
  }),
  fixture({
    id: 'bridge-transport-contained-success',
    source: 'cli-transport',
    entry: 'scripts/run-cli-transport.py',
    expected: { status: 0, output: ['fixture-codex-report token=[REDACTED]'] },
    stubs: { codex: CODEX_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'codex');
      const record = makeContext(state, { model: 'fixture-codex-model', effort: 'high' });
      const requestPath = path.join(state.workdir, 'request.json');
      writePrivate(requestPath, requestFromContext(state, record));
      return { state, record, requestPath };
    },
    run(context, prepared) {
      return context.run(this.entry, ['--request', prepared.requestPath]);
    },
    verify(result, context, prepared) {
      const receipt = assertReceipt(prepared.state);
      const argv = assertProviderEvidence(prepared.state, 'codex', { stdin: 'fixture codex prompt\n', model: 'fixture-codex-model', effort: 'high' });
      if (receipt.out_of_scope_paths.length !== 0 || receipt.report_present !== true || receipt.status !== 'SUCCEEDED') throw new Error('transport success was not contained');
      if (JSON.stringify(receipt).includes('fixture-secret')) throw new Error('transport receipt leaked fixture secret');
      if (!argv.includes('--output-last-message') || !argv.includes('workspace-write')) throw new Error('transport provider argv contract changed');
    },
  }),
  fixture({
    id: 'bridge-transport-rejected-authority',
    source: 'cli-transport',
    entry: 'scripts/run-cli-transport.py',
    expected: { status: 65, output: ['dhpk-cli-transport: BLOCKED: effective role is not bound to provider'], absent: ['codex-fixture-provider'] },
    stubs: { codex: CODEX_PROVIDER },
    prepare(context) {
      const state = prepareProject(context, 'codex');
      const record = makeContext(state, {
        requestedRole: 'agy-worker', effectiveRole: 'agy-worker', authority: 'workspace-write',
        model: 'fixture-codex-model', effort: 'high', taskId: 'bridge-transport-rejected-authority',
      });
      const requestPath = path.join(state.workdir, 'request.json');
      writePrivate(requestPath, requestFromContext(state, record));
      return { state, record, requestPath };
    },
    run(context, prepared) {
      return context.run(this.entry, ['--request', prepared.requestPath]);
    },
    verify(result, context, prepared) {
      if (fs.existsSync(path.join(prepared.state.workdir, 'provider-marker.txt'))) throw new Error('rejected transport authority ran provider');
      if (fs.existsSync(prepared.state.receiptPath)) {
        const receipt = JSON.parse(fs.readFileSync(prepared.state.receiptPath, 'utf8'));
        if (receipt.status === 'SUCCEEDED') throw new Error('rejected transport authority produced success');
      }
    },
  }),
];

let registered = false;

function registerBridgeFamilyFixtures() {
  if (!registered) {
    for (const definition of DEFINITIONS) registerFixture(definition);
    registered = true;
  }
  return getFixtures();
}

function runBridgeFamilyFixture(fixtureDefinition, context) {
  const prepared = fixtureDefinition.prepare ? fixtureDefinition.prepare(context) : undefined;
  const result = fixtureDefinition.run(context, prepared);
  fixtureDefinition.assert(result, context, prepared);
  return { result, evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
}

module.exports = {
  registerBridgeFamilyFixtures,
  runBridgeFamilyFixture,
  outputText,
  bridgeFamilyFixtureIds: Object.freeze(DEFINITIONS.map(({ id }) => id)),
  bridgeFamilySources: Object.freeze({
    'codex-bridge': 'dhpk-codex-bridge',
    'agy-fast-worker': 'dhpk-agy-fast-worker',
    'cli-dispatch-context': 'dhpk-cli-dispatch-context',
    'cli-transport': 'dhpk-cli-transport',
  }),
  RESERVED_ROOT_ENVIRONMENT,
};
