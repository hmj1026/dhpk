'use strict';

// Raw-directory fixtures for the opsx-apply-goal runtime boundary.  These
// definitions describe observable contracts only; execution belongs to
// skill-goal-runtime-isolation.test.js and always happens from a relocated
// physical Skill tree.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
const { outputText, assertExpected } = require('./fixture-assertions');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal');
const ANALYZER = 'scripts/analyze-change.sh';
const LAUNCHER = 'scripts/launch-cli-dispatch.js';
const REVIEW_GATE = 'scripts/review-gate-runtime.js';

const RESERVED_ROOT_ENVIRONMENT = Object.freeze([
  'CLAUDE_PLUGIN_ROOT',
  'PLUGIN_ROOT',
  'DHPK_SOURCE_ROOT',
  'DHPK_PLUGIN_ROOT',
  'CURSOR_PLUGIN_ROOT',
  'DHPK_CURSOR_PLUGIN_ROOT',
  'NODE_PATH',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONHOME',
]);

// This is the complete 19-file Review Gate closure from the approved setup
// resource design.  The entry and its 18 relative libraries stay local to the
// opsx Skill; the repository-level Review Gate is never a runtime fallback.
const REVIEW_GATE_CLOSURE = Object.freeze([
  'scripts/review-gate-runtime.js',
  'scripts/lib/claude-review-gate-adapter.js',
  'scripts/lib/physical-file.js',
  'scripts/lib/receipt-json-primitives.js',
  'scripts/lib/receipt-primitives.js',
  'scripts/lib/redaction.js',
  'scripts/lib/review-gate-evidence.js',
  'scripts/lib/review-gate-receipt-store.js',
  'scripts/lib/review-gate-runtime-attestation.js',
  'scripts/lib/review-gate-runtime-checkpoint.js',
  'scripts/lib/review-gate-runtime-composition.js',
  'scripts/lib/review-gate-runtime-errors.js',
  'scripts/lib/review-gate-runtime-evidence.js',
  'scripts/lib/review-gate-runtime-storage.js',
  'scripts/lib/review-gate-runtime.js',
  'scripts/lib/review-gate-store-budget.js',
  'scripts/lib/review-gate.js',
  'scripts/lib/reviewer-contract.js',
  'scripts/lib/risk-router.js',
]);

const POLICY_KERNEL = 'references/execution-bundle/rules/execution-policy-kernel.md';
const POLICY_ROUTE = 'references/execution-bundle/skills/flow-guide/references/implementation-dispatch.md';


function definition(definition) {
  return {
    ...definition,
    source: 'opsx-apply-goal',
    assert(result, context, prepared) {
      assertExpected(result, definition.expected, definition.id);
      if (definition.verify) definition.verify(result, context, prepared);
    },
  };
}

function writeFile(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

function writeJson(filePath, value, mode = 0o600) {
  writeFile(filePath, `${JSON.stringify(value)}\n`, mode);
}

function parseFields(output) {
  return Object.fromEntries(String(output || '').split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

function bashQuote(value) {
  const result = spawnSync('/bin/bash', ['-c', 'printf "%q" "$1"', 'quote', value], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'bash printf %q failed');
  return result.stdout;
}

function makeAnalyzerChange(context, { id = 'goal-runtime-change', longTask = false } = {}) {
  const changeDir = path.join(context.projectDir, 'openspec', 'changes', id);
  const taskTitles = longTask
    ? [`${'long task '.repeat(30)}one`, 'local selector task']
    : ['local selector task', 'review gate task'];
  const tasks = [
    `- [ ] 1.1 ${taskTitles[0]}`,
    '  - **Mechanical:** yes; **Files:** src/worker.js, src/reviewer.js, README.md',
    `- [ ] 1.2 ${taskTitles[1]}`,
    '  - **Mechanical:** no; **Files:** none',
    '',
  ].join('\n');
  const proposal = '# Isolated consumer change\n\nUse the local goal runtime.\n';
  writeFile(path.join(changeDir, 'tasks.md'), tasks, 0o644);
  writeFile(path.join(changeDir, 'proposal.md'), proposal, 0o644);
  return Object.freeze({
    id,
    changeDir,
    tasksPath: path.join(changeDir, 'tasks.md'),
    proposalPath: path.join(changeDir, 'proposal.md'),
    expectedDigest: '1.1 local selector task; 1.2 review gate task',
  });
}

function analyzerArgs(state, extra = []) {
  return [state.id, '--turns', '24', '--worker=codex', ...extra];
}

function runAnalyzer(context, state, extra = []) {
  return context.run(ANALYZER, analyzerArgs(state, extra), {
    env: { CLAUDE_PROJECT_DIR: context.projectDir },
  });
}

function analyzerContract(result, context, state) {
  const fields = parseFields(result.stdout);
  if (fields.STATUS !== 'active') throw new Error(`analyzer did not report active: ${outputText(result)}`);
  if (fields.CHANGE_ID !== state.id) throw new Error(`analyzer change id changed: ${fields.CHANGE_ID}`);
  if (fields.FAST_WORKER_SELECTED !== 'codex') throw new Error(`selector chose ${fields.FAST_WORKER_SELECTED}`);
  if (fields.FAST_WORKER_AGENT !== 'dhpk:codex-worker') throw new Error(`selector agent changed: ${fields.FAST_WORKER_AGENT}`);
  if (fields.TASK_DIGEST !== state.expectedDigest) throw new Error(`task digest changed: ${fields.TASK_DIGEST}`);
  const expectedRoot = bashQuote(context.skillDir);
  if (fields.SKILL_ROOT_Q !== expectedRoot) {
    throw new Error(`SKILL_ROOT_Q is not the physical relocated Skill root: ${fields.SKILL_ROOT_Q}`);
  }
  if (!fields.SKILL_ROOT_Q.includes('\\ ')) throw new Error('SKILL_ROOT_Q lost Bash quoting for spaces');
  if (outputText(result).includes('hostile-')) throw new Error('analyzer used a hostile parent/sibling resource');
}

function installHostileLookalikes(context) {
  const parent = path.dirname(context.skillDir);
  const lookalikes = [
    path.join(parent, 'scripts', 'fast-worker-selector.js'),
    path.join(parent, 'references', 'execution-bundle', 'scripts', 'fast-worker-selector.js'),
    path.join(context.projectDir, 'scripts', 'fast-worker-selector.js'),
    path.join(context.projectDir, 'references', 'execution-bundle', 'scripts', 'fast-worker-selector.js'),
  ];
  for (const file of lookalikes) writeFile(file, 'console.error("hostile-selector"); process.exit(91);\n', 0o644);
  return lookalikes;
}

function extractOrientationFence(template, marker) {
  const start = template.indexOf(marker);
  if (start < 0) throw new Error(`orientation marker missing: ${marker}`);
  const match = template.slice(start).match(/```\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`orientation fence missing after: ${marker}`);
  return match[1];
}

function orientationCommand(context, dispatchOn) {
  const template = fs.readFileSync(path.join(context.skillDir, 'references', 'goal-templates.md'), 'utf8');
  const marker = dispatchOn ? '**`DISPATCH_ON=true`' : '**`DISPATCH_ON=false`';
  const fence = extractOrientationFence(template, marker);
  const first = fence.indexOf('`');
  const last = fence.indexOf('`', first + 1);
  if (first < 0 || last <= first) throw new Error('orientation command fence missing');
  return fence.slice(first + 1, last)
    .replaceAll('<SKILL_ROOT_Q>', bashQuote(context.skillDir));
}

function prepareOrientation(context, dispatchOn) {
  const projectPolicy = path.join(context.projectDir, 'rules', 'execution-policy.md');
  const projectKernel = path.join(context.projectDir, 'rules', 'execution-policy-kernel.md');
  const projectRoute = path.join(context.projectDir, 'skills', 'flow-guide', 'references', 'implementation-dispatch.md');
  writeFile(projectPolicy, 'HOSTILE_FULL_POLICY\n', 0o644);
  writeFile(projectKernel, 'HOSTILE_PROJECT_KERNEL\n', 0o644);
  writeFile(projectRoute, 'HOSTILE_PROJECT_ROUTE\n', 0o644);
  const parentKernel = path.join(path.dirname(context.skillDir), 'rules', 'execution-policy-kernel.md');
  const parentRoute = path.join(path.dirname(context.skillDir), 'skills', 'flow-guide', 'references', 'implementation-dispatch.md');
  writeFile(parentKernel, 'HOSTILE_PARENT_KERNEL\n', 0o644);
  writeFile(parentRoute, 'HOSTILE_PARENT_ROUTE\n', 0o644);
  fs.mkdirSync(path.join(context.projectDir, '.claude-plugin'), { recursive: true });
  writeFile(path.join(context.projectDir, '.claude-plugin', 'plugin.json'), '{}\n', 0o644);
  return Object.freeze({
    dispatchOn,
    command: orientationCommand(context, dispatchOn),
    kernelPath: path.join(context.skillDir, POLICY_KERNEL),
    routePath: path.join(context.skillDir, POLICY_ROUTE),
  });
}

function runOrientation(context, state) {
  const result = spawnSync('/bin/bash', ['-c', state.command], {
    cwd: context.projectDir,
    env: context.env,
    encoding: 'utf8',
    timeout: 10000,
  });
  return { ...result, evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
}

function assertOrientation(result, state) {
  const kernel = fs.readFileSync(state.kernelPath, 'utf8');
  const route = fs.readFileSync(state.routePath, 'utf8');
  const expected = state.dispatchOn ? `${kernel}${route}` : kernel;
  if (result.status !== 0) throw new Error(`orientation failed: ${outputText(result)}`);
  if (result.stdout !== expected) {
    throw new Error(`orientation resolved the wrong resources; expected local kernel/route, got:\n${result.stdout}`);
  }
  if (/HOSTILE_/.test(result.stdout)) throw new Error('orientation used a hostile parent/project resource');
  if (result.stdout.includes('execution-policy.md') && !result.stdout.includes(kernel)) {
    throw new Error('orientation loaded the full policy instead of the compact kernel');
  }
}

function prepareDispatch(context, provider, { rejected = false } = {}) {
  const workdir = path.join(context.projectDir, `${provider} goal workspace`);
  const artifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
  const prompt = path.join(workdir, 'prompt.txt');
  const scopePath = path.join(context.projectDir, `${provider}-scope.json`);
  const configPath = path.join(context.projectDir, `${provider}-config.json`);
  const contextPath = path.join(artifactRoot, 'context.json');
  const receiptPath = path.join(artifactRoot, 'receipt.json');
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(artifactRoot, 0o700);
  writeFile(prompt, `fixture ${provider} goal prompt\n`);
  const mode = rejected ? 'read-only' : 'workspace-write';
  const role = provider === 'agy' ? 'agy-worker' : 'codex-fast-worker';
  // The fixture providers intentionally leave a marker and argv capture in
  // their bounded workdir so the isolated test can prove the selected local
  // adapter ran.  Declare those two files in the request scope; otherwise the
  // transport correctly classifies the diagnostic files as out-of-scope and
  // returns FAILED before the fixture can assert provider success.
  const assignedFiles = [
    'src/worker.js',
    `goal-${provider}-provider-marker.txt`,
    `goal-${provider}-provider-argv.json`,
  ];
  writeJson(scopePath, {
    artifact_root: artifactRoot,
    receipt_path: receiptPath,
    context_path: contextPath,
    assigned_files: assignedFiles,
    report_only: true,
    runtime_path: `${context.binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
  });
  writeJson(configPath, provider === 'agy'
    ? { agy_worker_model: 'fixture-agy-model', agy_worker_timeout_secs: 3 }
    : { codex_worker_model: 'fixture-codex-model', codex_worker_effort: 'high', codex_worker_timeout_secs: 3 });
  const args = [
    '--dispatching-agent', 'claude',
    '--execution-provider', provider,
    '--requested-role', role,
    '--mode', mode,
    '--task-id', `goal-runtime-${provider}`,
    '--attempt-id', 'attempt-1',
    '--workdir', workdir,
    '--prompt', prompt,
    '--scope', scopePath,
    '--config-layer', configPath,
  ];
  return Object.freeze({ provider, workdir, artifactRoot, prompt, scopePath, configPath, contextPath, receiptPath, args });
}

function providerStubs() {
  return {
    codex: {
      body: [
        "const fs=require('node:fs');",
        "const args=process.argv.slice(1);",
        "let output=''; let previous='';",
        "for(const value of args){if(previous==='--output-last-message')output=value; previous=value;}",
        "fs.writeFileSync('goal-codex-provider-marker.txt','codex-provider-ran\\n');",
        "fs.writeFileSync('goal-codex-provider-argv.json',JSON.stringify(args));",
        "let input=''; process.stdin.setEncoding('utf8');",
        "process.stdin.on('data',chunk=>input+=chunk);",
        "process.stdin.on('end',()=>{if(output)fs.writeFileSync(output,'fixture-codex-report token=\\\"fixture-secret\\\"\\n');});",
      ].join(''),
    },
    agy: {
      body: [
        "const fs=require('node:fs');",
        "fs.writeFileSync('goal-agy-provider-marker.txt','agy-provider-ran\\n');",
        "fs.writeFileSync('goal-agy-provider-argv.json',JSON.stringify(process.argv.slice(1)));",
        "let input=''; process.stdin.setEncoding('utf8');",
        "process.stdin.on('data',chunk=>input+=chunk);",
        "process.stdin.on('end',()=>process.stdout.write('fixture-agy-report\\n'));",
      ].join(''),
    },
  };
}

function hostTrustFixture(context) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyPath = path.join(context.projectDir, '.goal-host.pub');
  writeFile(publicKeyPath, publicKey);
  return {
    publicKeyPath,
    publicKeyRelative: path.relative(context.projectDir, publicKeyPath),
    keyId: `sha256:${crypto.createHash('sha256').update(publicKey).digest('hex')}`,
  };
}

function reviewWorkRequest() {
  return {
    schemaVersion: 'dhpk.work-request.v1',
    requestId: 'fixture:goal-runtime',
    decisionKey: 'goal-runtime-review',
    scope: {
      paths: ['scripts/review-gate-runtime.js'],
      kinds: ['SOURCE'],
      baseIdentity: { commit: '1'.repeat(40), tree: '2'.repeat(40) },
      headIdentity: { commit: '3'.repeat(40), tree: '4'.repeat(40) },
      diff: { digest: `sha256:${'5'.repeat(64)}`, reference: 'fixture:goal-runtime' },
    },
    ownership: { judgmentOwner: 'architect', implementationOwner: 'worker:goal-runtime' },
    materialRisks: [],
    governingInputs: [{ reference: 'fixture:policy', digest: `sha256:${'6'.repeat(64)}` }],
    outcomeReferences: [{ kind: 'FIXTURE', reference: 'fixture:goal-runtime' }],
    observations: { fileCount: 1, lineCount: 1, taskCount: 1, availableAgentCount: 1 },
    extensions: {},
  };
}

function prepareReviewGate(context) {
  const host = hostTrustFixture(context);
  const requestPath = path.join(context.projectDir, 'goal-work-request.json');
  writeJson(requestPath, reviewWorkRequest());
  const init = [
    'init',
    '--host-public-key', host.publicKeyRelative,
    '--host-key-id', host.keyId,
    '--repo-root', context.projectDir,
  ];
  const prepare = ['prepare', '--repo-root', context.projectDir];
  return Object.freeze({ host, requestPath, init, prepare });
}

const DEFINITIONS = [
  definition({
    id: 'goal-analyzer-local-closure',
    entry: ANALYZER,
    expected: { status: 0, output: ['STATUS=active', 'FAST_WORKER_SELECTED=codex', 'FAST_WORKER_AGENT=dhpk:codex-worker', 'SKILL_ROOT_Q='] },
    prepare(context) { return makeAnalyzerChange(context); },
    run(context, state) { return runAnalyzer(context, state); },
    verify(result, context, state) { analyzerContract(result, context, state); },
  }),
  definition({
    id: 'goal-analyzer-missing-transitive-resource',
    entry: ANALYZER,
    expected: { status: 1, output: ['BLOCKED_RESOURCE_MISSING'], absent: ['hostile-selector'] },
    prepare(context) {
      const state = makeAnalyzerChange(context, { id: 'goal-runtime-missing-resource' });
      installHostileLookalikes(context);
      const missing = path.join(context.skillDir, 'references', 'execution-bundle', 'scripts', 'fast-worker-selector.js');
      fs.rmSync(missing, { force: true });
      return state;
    },
    run(context, state) { return runAnalyzer(context, state); },
  }),
  definition({
    id: 'goal-orientation-dispatch-off-local-policy',
    entry: ANALYZER,
    expected: { status: 0, output: ['execution-policy.md'] },
    prepare(context) { return prepareOrientation(context, false); },
    run(context, state) { return runOrientation(context, state); },
    verify(result, context, state) { assertOrientation(result, state); },
  }),
  definition({
    id: 'goal-orientation-dispatch-on-local-policy',
    entry: ANALYZER,
    expected: { status: 0, output: ['execution-policy.md', 'implementation-dispatch.md'] },
    prepare(context) { return prepareOrientation(context, true); },
    run(context, state) { return runOrientation(context, state); },
    verify(result, context, state) { assertOrientation(result, state); },
  }),
  definition({
    id: 'goal-dispatch-codex-local-success',
    entry: LAUNCHER,
    expected: { status: 0, output: ['fixture-codex-report token=[REDACTED]'] },
    prepare(context) { return prepareDispatch(context, 'codex'); },
    run(context, state) { return context.run(this.entry, state.args); },
    verify(result, context, state) {
      assert.ok(fs.existsSync(path.join(state.workdir, 'goal-codex-provider-marker.txt')), 'local Codex provider did not run');
      const contextStat = fs.lstatSync(state.contextPath);
      assert.ok(contextStat.isFile() && !contextStat.isSymbolicLink(), 'dispatch context must be physical');
      assert.strictEqual(contextStat.mode & 0o777, 0o600, 'dispatch context must be private');
      const dispatchContext = JSON.parse(fs.readFileSync(state.contextPath, 'utf8'));
      assert.strictEqual(dispatchContext.dispatching_agent, 'claude');
      assert.strictEqual(dispatchContext.execution_provider, 'codex');
      assert.strictEqual(dispatchContext.effective_role, 'codex-worker');
      const receipt = JSON.parse(fs.readFileSync(state.receiptPath, 'utf8'));
      assert.strictEqual(receipt.status, 'SUCCEEDED');
    },
  }),
  definition({
    id: 'goal-dispatch-agy-local-success',
    entry: LAUNCHER,
    expected: { status: 0, output: ['fixture-agy-report'] },
    prepare(context) { return prepareDispatch(context, 'agy'); },
    run(context, state) { return context.run(this.entry, state.args); },
    verify(result, context, state) {
      assert.ok(fs.existsSync(path.join(state.workdir, 'goal-agy-provider-marker.txt')), 'local AGY provider did not run');
      const dispatchContext = JSON.parse(fs.readFileSync(state.contextPath, 'utf8'));
      assert.strictEqual(dispatchContext.dispatching_agent, 'claude');
      assert.strictEqual(dispatchContext.execution_provider, 'agy');
      assert.strictEqual(dispatchContext.effective_role, 'agy-worker');
      const receipt = JSON.parse(fs.readFileSync(state.receiptPath, 'utf8'));
      assert.strictEqual(receipt.status, 'SUCCEEDED');
    },
  }),
  definition({
    id: 'goal-dispatch-rejected-authority',
    entry: LAUNCHER,
    expected: { status: 65, output: ['BLOCKED'], absent: ['goal-agy-provider-marker.txt'] },
    prepare(context) { return prepareDispatch(context, 'agy', { rejected: true }); },
    run(context, state) { return context.run(this.entry, state.args); },
    verify(result, context, state) {
      assert.strictEqual(fs.existsSync(state.contextPath), false, 'rejected authority wrote a context');
      assert.strictEqual(fs.existsSync(state.receiptPath), false, 'rejected authority wrote a receipt');
      assert.strictEqual(fs.existsSync(path.join(state.workdir, 'goal-agy-provider-marker.txt')), false, 'rejected authority ran AGY');
    },
  }),
  definition({
    id: 'goal-review-gate-unresolved-evidence',
    entry: REVIEW_GATE,
    expected: { status: 0, output: ['"status":"PENDING"'] },
    prepare(context) { return prepareReviewGate(context); },
    run(context, state) {
      const initialized = context.run(this.entry, state.init);
      if (initialized.status !== 0) return initialized;
      const prepared = context.run(this.entry, state.prepare, { input: fs.readFileSync(state.requestPath, 'utf8') });
      if (prepared.status !== 0) return prepared;
      const preparedOutput = JSON.parse(prepared.stdout);
      const status = context.run(this.entry, [
        'status', '--work-id', preparedOutput.workId, '--repo-root', context.projectDir,
      ]);
      return { ...status, goalGate: { initialized, prepared, preparedOutput } };
    },
    verify(result, context, state) {
      assert.strictEqual(result.goalGate.initialized.status, 0, result.goalGate.initialized.stderr);
      assert.strictEqual(result.goalGate.prepared.status, 0, result.goalGate.prepared.stderr);
      const status = JSON.parse(result.stdout);
      assert.strictEqual(status.status, 'PENDING');
      assert.deepStrictEqual(status.receiptSummary, { total: 0, byKind: {} });
      assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
    },
  }),
];

let registered = false;

function registerGoalRuntimeFixtures() {
  if (!registered) {
    for (const fixture of DEFINITIONS) registerFixture(fixture);
    registered = true;
  }
  return getFixtures();
}

function runGoalRuntimeFixture(fixture, context) {
  const prepared = fixture.prepare ? fixture.prepare(context) : undefined;
  const result = fixture.run
    ? fixture.run(context, prepared)
    : context.run(fixture.entry, fixture.args || []);
  fixture.assert(result, context, prepared);
  return { result, evidenceKind: 'fixture', hostStatus: 'NOT_RUN' };
}

module.exports = {
  ANALYZER,
  LAUNCHER,
  REVIEW_GATE,
  SOURCE,
  REVIEW_GATE_CLOSURE,
  POLICY_KERNEL,
  POLICY_ROUTE,
  RESERVED_ROOT_ENVIRONMENT,
  registerGoalRuntimeFixtures,
  runGoalRuntimeFixture,
  outputText,
  parseFields,
  bashQuote,
  providerStubs,
  goalRuntimeFixtureIds: Object.freeze(DEFINITIONS.map(({ id }) => id)),
};
