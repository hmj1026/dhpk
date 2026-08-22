'use strict';

// Public harness process boundary. This module owns argument normalization,
// receipt emission, and result/exit normalization; existing distribution and
// test adapters remain the implementation owners for their domains.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  createResult,
  exitCodeForOutcome,
  aggregateRequiredSurfaces,
} = require('./harness-result');
const receipts = require('./harness-receipt');
const inventoryApi = require('./distribution-inventory');

const PHASES = Object.freeze(['preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release']);
const OPTIONS_WITH_VALUE = new Set(['--task-id', '--attempt-id', '--surface', '--test-file', '--diagnostic', '--receipt-root']);
const HELP = 'usage: bin/dhpk harness <preflight|plan|generate|validate|test|probe|verify|release> [options]\n'
  + 'options: --json --task-id <id> --attempt-id <id> --surface <surface> --test-file <file> --diagnostic <text>\n';

function parseArgs(argv = []) {
  if (!Array.isArray(argv)) throw new Error('usage: arguments must be an array');
  const [phase, ...rest] = argv;
  if (!phase || phase === '--help' || phase === '-h') return { help: true };
  if (!PHASES.includes(phase)) throw new Error(`unknown phase '${phase}'`);
  const parsed = { phase };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (OPTIONS_WITH_VALUE.has(arg)) {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error(`option value is required for '${arg}'`);
      parsed[arg.slice(2).replaceAll('-', '') === 'taskid' ? 'taskId'
        : arg.slice(2).replaceAll('-', '') === 'attemptid' ? 'attemptId'
          : arg.slice(2).replaceAll('-', '') === 'testfile' ? 'testFile'
            : arg.slice(2).replaceAll('-', '') === 'receiptroot' ? 'receiptRoot'
              : arg.slice(2)] = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option '${arg}'`);
    } else {
      throw new Error(`unexpected argument '${arg}'`);
    }
  }
  if (parsed.help) return parsed;
  if (parsed.phase === 'test' && parsed.testFile && !parsed.testFile.endsWith('.js')) {
    throw new Error('--test-file must name a JavaScript test file');
  }
  if (['generate', 'validate', 'verify'].includes(parsed.phase) && !parsed.surface) {
    throw new Error(`--surface is required for '${parsed.phase}'`);
  }
  return parsed;
}

function helpFor(phase = null) {
  if (!phase) return HELP;
  return `usage: bin/dhpk harness ${phase} [options]\n${HELP.split('\n')[1]}\n`;
}

function resolveSourceBinding(root) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceTree = receipts.resolveGitTree(root, sourceCommit);
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  return { sourceCommit, sourceTree, dirty: status.trim().length > 0 };
}

function readInventory(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
}

function defaultTaskId(phase) {
  return `harness-${phase}-${process.pid}`;
}

function sanitizeDiagnostics(value) {
  return receipts.redact(String(value || '')).slice(0, 4096);
}

function resumeCommand(argv) {
  const quote = (value) => /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${String(value).replaceAll("'", "'\\''")}'`;
  const safe = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') continue;
    safe.push(quote(arg));
    if (arg === '--diagnostic' && index + 1 < argv.length) {
      safe.push('<redacted>');
      index += 1;
    }
  }
  return `bin/dhpk harness ${safe.join(' ')}`.trim();
}

function artifactReference(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const reference = {};
  for (const field of [
    'surface', 'operation', 'verdict', 'status', 'schema', 'planFingerprint',
    'artifactFingerprint', 'artifactPath', 'provenancePath', 'provenanceFingerprint',
    'sourceCommit', 'sourceTree',
  ]) {
    if (typeof payload[field] === 'string') reference[field] = payload[field];
  }
  if (Array.isArray(payload.artifacts)) {
    reference.artifactCount = payload.artifacts.length;
    reference.artifactDigest = receipts.sha256(JSON.stringify(receipts.redact(payload.artifacts)));
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    reference.errorDigest = receipts.sha256(JSON.stringify(receipts.redact(payload.errors)));
  }
  return reference;
}

function packageIdentity(root, payload, binding) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || typeof payload.output !== 'string') {
    return { errors: ['distribution adapter did not return a package output path'], byteReferences: [] };
  }
  const output = path.resolve(payload.output);
  if (!output.startsWith(`${path.resolve(root)}${path.sep}`)) {
    return { errors: ['distribution adapter returned an output path outside the repository root'], byteReferences: [] };
  }
  const provenancePath = path.join(output, 'provenance.json');
  let provenance;
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  } catch (error) {
    return { errors: [`package provenance is unreadable: ${error.message}`], byteReferences: [] };
  }
  const rawPlanFingerprint = provenance.planFingerprint || provenance.inventoryDigest;
  const planFingerprint = typeof rawPlanFingerprint === 'string' && rawPlanFingerprint.length > 0
    ? (rawPlanFingerprint.startsWith('sha256:') ? rawPlanFingerprint : `sha256:${rawPlanFingerprint}`)
    : null;
  if (!planFingerprint) errors.push('package provenance is missing plan/inventory fingerprint');
  if (typeof provenance.sourceCommit !== 'string') errors.push('package provenance is missing source commit');
  else if (binding && provenance.sourceCommit.toLowerCase() !== binding.sourceCommit.toLowerCase()) {
    errors.push('package provenance source commit does not match current checkout');
  }
  let artifactFingerprint = null;
  try {
    artifactFingerprint = receipts.fingerprintDirectory(output);
  } catch (error) {
    errors.push(`package artifact fingerprint failed: ${error.message}`);
  }
  const provenanceFingerprint = receipts.fingerprintForBytes(provenancePath);
  return {
    errors,
    surface: payload.surface || null,
    stage: 'structural',
    producer: 'distribution-adapter',
    planFingerprint,
    artifactFingerprint,
    artifactPath: path.relative(root, output).split(path.sep).join('/'),
    provenancePath: path.relative(root, provenancePath).split(path.sep).join('/'),
    provenanceFingerprint,
    sourceCommit: provenance.sourceCommit || null,
    sourceTree: binding && binding.sourceTree,
    byteReferences: [
      ...(artifactFingerprint ? [{ path: output, kind: 'directory', fingerprint: artifactFingerprint }] : []),
      { path: provenancePath, kind: 'file', fingerprint: provenanceFingerprint },
    ],
  };
}

function runBoundedTest(root, testFile) {
  const resolved = path.resolve(root, testFile || 'tests/run-all.js');
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
    return { outcome: 'NOT_RUN', diagnostics: [`test file is unavailable: ${testFile || 'tests/run-all.js'}`] };
  }
  const child = spawnSync(process.execPath, [resolved], {
    cwd: root,
    encoding: 'utf8',
    timeout: Number(process.env.DHPK_HARNESS_TEST_TIMEOUT_MS || 60000),
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined },
  });
  if (child.error && child.error.code === 'ETIMEDOUT') return { outcome: 'BLOCKED', diagnostics: ['bounded test runner timed out'] };
  const diagnostics = child.status === 0 ? '' : sanitizeDiagnostics(child.stderr || child.stdout);
  return child.status === 0
    ? { outcome: 'PASS', diagnostics: diagnostics ? [diagnostics] : [] }
    : { outcome: 'FAIL', diagnostics: [diagnostics || `test runner exited ${child.status === null ? 127 : child.status}`] };
}

function runDistribution(root, parsed, binding) {
  if (!parsed.surface) return { outcome: 'NOT_RUN', diagnostics: ['a surface is required for this adapter phase'] };
  const operation = parsed.phase === 'generate' ? 'generate' : parsed.phase === 'verify' ? 'verify' : 'validate';
  const child = spawnSync('bash', [path.join(root, 'bin', 'dhpk'), 'distribution', parsed.surface, operation, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  let payload = null;
  try { payload = JSON.parse(child.stdout || '{}'); } catch (_) { /* normalized below */ }
  const identity = packageIdentity(root, payload, binding);
  const diagnostics = sanitizeDiagnostics([
    child.stderr,
    payload && payload.errors && payload.errors.join('; '),
    ...identity.errors,
  ].filter(Boolean).join('\n'));
  return {
    outcome: child.status === 0
      ? (identity.errors.length > 0 ? 'BLOCKED' : 'PASS')
      : child.status === 64 ? 'NOT_RUN' : 'FAIL',
    diagnostics: diagnostics ? [diagnostics] : [],
    artifacts: payload ? [artifactReference({ ...payload, ...identity })] : [],
    byteReferences: identity.byteReferences,
    identity,
  };
}

function phaseExecution(root, parsed, inventory, binding) {
  if (parsed.phase === 'test') return runBoundedTest(root, parsed.testFile);
  if (parsed.phase === 'generate' || parsed.phase === 'validate' || parsed.phase === 'verify') return runDistribution(root, parsed, binding);
  if (parsed.phase === 'probe') return { outcome: 'UNAVAILABLE', diagnostics: ['consumer runtime probe is not configured in this environment'] };
  if (parsed.phase === 'release') {
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    if (required.errors.length > 0) return { outcome: 'BLOCKED', diagnostics: required.errors.slice(0, 20) };
    const surfaceResults = required.requiredSurfaces.map((surface) => ({ surface, status: 'NOT_RUN' }));
    return aggregateRequiredSurfaces({ requiredSurfaces: required.requiredSurfaces, surfaceResults, fullRelease: true });
  }
  if (parsed.phase === 'preflight') {
    const errors = [];
    if (binding && binding.dirty) errors.push('working tree is dirty; exact release checkout cannot be proven');
    const v2 = inventoryApi.validateDistributionInventoryV2({ inventory });
    errors.push(...v2.errors);
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    errors.push(...required.errors);
    return errors.length > 0
      ? { outcome: 'BLOCKED', diagnostics: errors.slice(0, 20) }
      : { outcome: 'PASS', diagnostics: [], requiredSurfaces: required.requiredSurfaces };
  }
  if (parsed.phase === 'plan') {
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    return required.errors.length > 0
      ? { outcome: 'BLOCKED', diagnostics: required.errors.slice(0, 20) }
      : { outcome: 'PASS', requiredSurfaces: required.requiredSurfaces, planFingerprint: `sha256:${receipts.sha256(JSON.stringify(required.requiredSurfaces))}` };
  }
  return { outcome: 'NOT_RUN', diagnostics: [`phase '${parsed.phase}' has no configured adapter`] };
}

function execute(argv = [], { root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (error) {
    return { status: 64, result: { phase: null, outcome: 'USAGE', diagnostics: [sanitizeDiagnostics(error.message)] } };
  }
  if (parsed.help) return { status: 0, help: helpFor(parsed.phase) };
  if (parsed.json === undefined) parsed.json = false;
  const taskId = parsed.taskId || defaultTaskId(parsed.phase);
  const attemptId = parsed.attemptId || `attempt-${Date.now()}-${process.pid}`;
  const receiptRoot = parsed.receiptRoot || env.DHPK_HARNESS_RECEIPT_ROOT || path.join(os.tmpdir(), 'dhpk-harness-receipts');
  try {
    const resolvedReceiptRoot = path.resolve(receiptRoot);
    const allowedReceiptRoots = [
      path.resolve(os.tmpdir()),
      path.resolve(path.join(root, '.dhpk', 'artifacts', 'receipts')),
    ];
    if (!allowedReceiptRoots.some((allowed) => resolvedReceiptRoot === allowed || resolvedReceiptRoot.startsWith(`${allowed}${path.sep}`))) {
      throw new Error('receipt root must be runtime-scoped under the system temporary directory or .dhpk/artifacts/receipts');
    }
    const inventory = readInventory(root);
    const binding = resolveSourceBinding(root);
    const execution = phaseExecution(root, parsed, inventory, binding);
    if (parsed.diagnostic) execution.diagnostics = [...(execution.diagnostics || []), parsed.diagnostic];
    const identity = execution.identity && typeof execution.identity === 'object' ? execution.identity : {};
    const receiptIdentity = Object.fromEntries(
      ['planFingerprint', 'artifactFingerprint', 'surface', 'adapter', 'stage', 'producer']
        .filter((field) => identity[field] !== undefined && identity[field] !== null)
        .map((field) => [field, identity[field]])
    );
    const attempt = receipts.createAttempt({
      root: resolvedReceiptRoot,
      command: `harness ${argv.join(' ')}`,
      taskId,
      attemptId,
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      sessionId: env.DHPK_SESSION_ID || null,
      dispatch: env.DHPK_DISPATCH_ID ? { dispatchId: env.DHPK_DISPATCH_ID } : null,
      identity: receiptIdentity,
      diagnostics: execution.diagnostics || [],
      artifacts: execution.artifacts || [],
      byteReferences: execution.byteReferences || [],
      resumeCommand: resumeCommand(argv),
    });
    const result = createResult({
      phase: parsed.phase,
      lifecyclePhase: execution.outcome === 'PASS' ? 'VERIFIED' : 'RED',
      outcome: execution.outcome,
      diagnostics: (execution.diagnostics || []).map(sanitizeDiagnostics),
      artifacts: execution.artifacts || [],
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      worktree: binding.dirty ? 'DIRTY' : 'CLEAN',
      receiptReference: attempt.path,
      resumeCommand: resumeCommand(argv),
    });
    receipts.appendEvent(attempt, {
      command: result.resumeCommand,
      lifecyclePhase: result.lifecyclePhase,
      outcome: result.outcome,
      diagnostics: result.diagnostics,
      artifacts: result.artifacts,
      byteReferences: execution.byteReferences || [],
      resumeCommand: result.resumeCommand,
    });
    result.exitCode = exitCodeForOutcome(result.outcome);
    return { status: result.exitCode, result };
  } catch (error) {
    const result = createResult({
      phase: parsed.phase,
      lifecyclePhase: 'RED',
      outcome: 'FAIL',
      internalError: true,
      diagnostics: [sanitizeDiagnostics(error.message)],
      resumeCommand: resumeCommand(argv),
    });
    result.exitCode = 70;
    return { status: 70, result };
  }
}

module.exports = { PHASES, parseArgs, helpFor, execute, exitCodeForOutcome };
