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
  REQUIRED_SURFACES,
} = require('./harness-result');
const receipts = require('./harness-receipt');
const inventoryApi = require('./distribution-inventory');
const { normalizeConsumerEvidence } = require('./release-evidence');

const PHASES = Object.freeze(['preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release']);
const PHASE_INDEX = new Map(PHASES.map((phase, index) => [phase, index]));
const HANDOFF_OUTCOMES = new Set(['PASS', 'COMPLETE']);
const OPTIONS_WITH_VALUE = new Set([
  '--task-id', '--attempt-id', '--surface', '--test-file', '--diagnostic', '--receipt-root',
  '--operation-key', '--idempotency-key', '--previous-receipt', '--retry-of',
]);
const HELP = 'usage: bin/dhpk harness <preflight|plan|generate|validate|test|probe|verify|release> [options]\n'
  + 'options: --json --task-id <id> --attempt-id <id> --surface <surface> --test-file <file> --diagnostic <text>\n'
  + 'handoff: --operation-key <id> --idempotency-key <id> --previous-receipt <path> --retry-of <path>\n';

function isTrustedCiEnvironment(env = process.env) {
  return env.CI === '1' || env.CI === 'true';
}

function allowsRealConsumerProbe(env = process.env) {
  return isTrustedCiEnvironment(env) || env.DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE === '1';
}

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
      const optionName = {
        '--task-id': 'taskId',
        '--attempt-id': 'attemptId',
        '--test-file': 'testFile',
        '--receipt-root': 'receiptRoot',
        '--operation-key': 'operationKey',
        '--idempotency-key': 'idempotencyKey',
        '--previous-receipt': 'previousReceipt',
        '--retry-of': 'retryOf',
      }[arg] || arg.slice(2);
      parsed[optionName] = value;
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
  if (['generate', 'validate', 'verify', 'probe'].includes(parsed.phase) && !parsed.surface) {
    throw new Error(`--surface is required for '${parsed.phase}'`);
  }
  if (parsed.operationKey && parsed.idempotencyKey && parsed.operationKey !== parsed.idempotencyKey) {
    throw new Error('--operation-key and --idempotency-key must match when both are supplied');
  }
  if (parsed.phase === 'probe' && !REQUIRED_SURFACES.includes(parsed.surface)) {
    throw new Error(`unknown consumer surface '${parsed.surface}'`);
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
  return {
    sourceCommit,
    sourceTree,
    targetCommit: sourceCommit,
    targetTree: sourceTree,
    dirty: status.trim().length > 0,
  };
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

function lifecyclePhaseForOutcome(outcome) {
  if (outcome === 'COMPLETE') return 'COMPLETE';
  if (outcome === 'PASS') return 'VERIFIED';
  return 'RED';
}

function artifactReference(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const reference = {};
  for (const field of [
    'surface', 'operation', 'verdict', 'status', 'schema', 'planFingerprint',
    'artifactFingerprint', 'artifactPath', 'provenancePath', 'provenanceFingerprint',
    'sourceCommit', 'sourceTree', 'generatedFromCommit', 'generatedFromTree', 'targetCommit', 'targetTree',
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

function isAncestor(root, ancestor, target) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, target], { cwd: root, encoding: 'utf8' });
    return true;
  } catch (error) {
    if (error && error.status === 1) return false;
    throw error;
  }
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
  const generatedFromCommit = provenance.generatedFromCommit || provenance.sourceCommit;
  if (typeof generatedFromCommit !== 'string' || !/^[a-f0-9]{40}$/i.test(generatedFromCommit)) {
    errors.push('package provenance generated-input commit is missing or invalid');
  }
  let packageSourceTree = null;
  if (errors.length === 0) {
    try {
      packageSourceTree = receipts.resolveGitTree(root, generatedFromCommit);
    } catch (error) {
      errors.push(`package provenance generated-input commit cannot be resolved: ${error.message}`);
    }
  }
  if (provenance.generatedFromTree && packageSourceTree
    && provenance.generatedFromTree.toLowerCase() !== packageSourceTree.toLowerCase()) {
    errors.push('package provenance generated-input tree does not match generated-input commit');
  }
  if (binding && packageSourceTree && !isAncestor(root, generatedFromCommit, binding.targetCommit || binding.sourceCommit)) {
    errors.push('package provenance generated-input commit is not an ancestor of target checkout');
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
    sourceCommit: provenance.sourceCommit || generatedFromCommit || null,
    sourceTree: packageSourceTree,
    generatedFromCommit: generatedFromCommit || null,
    generatedFromTree: provenance.generatedFromTree || packageSourceTree,
    targetCommit: binding && (binding.targetCommit || binding.sourceCommit),
    targetTree: binding && (binding.targetTree || binding.sourceTree),
    currentSourceCommit: binding && binding.sourceCommit,
    currentSourceTree: binding && binding.sourceTree,
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
  if (parsed.handoffPlanFingerprint && identity.planFingerprint !== parsed.handoffPlanFingerprint) {
    identity.errors.push(`handoff plan fingerprint '${parsed.handoffPlanFingerprint}' does not match generated package plan '${identity.planFingerprint || '<missing>'}'`);
  }
  const diagnostics = sanitizeDiagnostics([
    child.stderr,
    payload && payload.errors && payload.errors.join('; '),
    ...identity.errors,
  ].filter(Boolean).join('\n'));
  const exactHeadMismatch = identity.errors.some((error) => /generated-input|target checkout/i.test(error));
  return {
    outcome: child.status === 0
      ? (identity.errors.length > 0 ? (exactHeadMismatch ? 'NO_SHIP' : 'BLOCKED') : 'PASS')
      : child.status === 64 ? 'NOT_RUN' : 'FAIL',
    diagnostics: diagnostics ? [diagnostics] : [],
    artifacts: payload ? [artifactReference({ ...payload, ...identity })] : [],
    byteReferences: identity.byteReferences,
    identity,
  };
}

const PROBE_ADAPTERS = Object.freeze({
  'agent-plugin': Object.freeze({
    platform: 'agent-plugin',
    consumerSurface: 'agent-plugin',
    packagePath: ['plugins', 'dhpk-agent'],
  }),
  'cursor-plugin': Object.freeze({
    platform: 'cursor',
    consumerSurface: 'cursor-plugin',
    packagePath: ['plugins', 'dhpk-cursor'],
  }),
});

const CONSUMER_GATE_ADAPTERS = Object.freeze({
  'claude-core': Object.freeze({ gateSurface: 'claude-core', producerSurface: 'claude', adapterId: 'claude-plugin-cli' }),
  'codex-sync': Object.freeze({ gateSurface: 'codex-sync', producerSurface: 'codex-sync', adapterId: 'codex-sync-installer' }),
  'codex-native': Object.freeze({ gateSurface: 'codex-native', producerSurface: 'codex-native', adapterId: 'codex-native-install-smoke' }),
  'cursor-sync': Object.freeze({ gateSurface: 'cursor-sync', producerSurface: 'cursor-sync', adapterId: 'cursor-sync-installer' }),
});

const PROBE_STATUSES = new Set([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'UNAVAILABLE',
]);

function probePackageVersion(packageRoot, platform) {
  const candidates = platform === 'codex' || platform === 'agent-plugin'
    ? ['plugin.json', '.codex-plugin/plugin.json']
    : ['.cursor-plugin/plugin.json', 'plugin.json'];
  for (const relative of candidates) {
    const manifestPath = path.join(packageRoot, relative);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return typeof manifest.version === 'string' ? manifest.version : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function normalizeProbeCommands(commands, packageRoot) {
  if (!Array.isArray(commands)) return [];
  return commands.slice(0, 50).map((command) => {
    if (typeof command === 'string') return command.split(packageRoot).join('<repo-package>');
    if (!command || typeof command !== 'object') return command;
    return {
      ...command,
      ...(typeof command.cmd === 'string' ? { cmd: command.cmd.split(packageRoot).join('<repo-package>') } : {}),
    };
  });
}

function failedProbeRow(
  surface,
  status,
  reason,
  packageRoot,
  commands = [],
  producer = 'consumer-platform-probe',
  adapterId = 'consumer-platform-probe',
) {
  return {
    surface,
    status: PROBE_STATUSES.has(status) && status !== 'PASS' ? status : 'FAIL',
    stage: 'CONSUMER',
    producer,
    adapter: { id: adapterId, version: '1.0.0' },
    commands: normalizeProbeCommands(commands, packageRoot),
    environment: { network: 'disabled', packageRoot: '<repo-package>' },
    artifacts: [],
    diagnostics: [],
    reasons: [sanitizeDiagnostics(reason)].filter(Boolean),
    checkedClaims: ['package-manifest', 'consumer-route'],
  };
}

function releaseVersion(root) {
  for (const relative of [
    path.join('plugins', 'dhpk-agent', 'plugin.json'),
    path.join('plugins', 'dhpk', '.codex-plugin', 'plugin.json'),
    path.join('.claude-plugin', 'plugin.json'),
  ]) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof manifest.version === 'string') return manifest.version;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function normalizedGateRow(surface, raw, root, childStatus, adapterId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failedProbeRow(surface, 'FAIL', 'consumer gate did not emit a matching surface result', root, [], 'consumer-gate', adapterId);
  }
  const candidate = {
    ...raw,
    surface,
    stage: 'CONSUMER',
    commands: normalizeProbeCommands(raw.commands, root),
  };
  try {
    const normalized = normalizeConsumerEvidence({
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: raw.adapter || { id: adapterId, version: '1.0.0' },
      surfaceResults: [candidate],
    }).surfaceResults[0];
    return {
      ...normalized,
      surface,
      stage: 'CONSUMER',
      producer: 'consumer-gate',
      adapter: normalized.adapter || { id: adapterId, version: '1.0.0' },
      ...(childStatus !== 0 && !['FAIL', 'BLOCKED'].includes(normalized.status)
        ? { reasons: [...(normalized.reasons || []), `consumer gate exited ${childStatus}; selected surface status remains ${normalized.status}`] }
        : {}),
    };
  } catch (error) {
    return failedProbeRow(surface, 'FAIL', `consumer gate evidence is invalid: ${error.message}`, root, raw.commands, 'consumer-gate', adapterId);
  }
}

function runAgyConsumerProbe(root) {
  const script = path.join(root, 'skills', 'dhpk-cross-agent-sync', 'scripts', 'multi_ai_sync.py');
  const command = `python3 -B skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py --root . validate --targets agy --agy-runtime-probe --format json`;
  if (!allowsRealConsumerProbe()) {
    const row = failedProbeRow(
      'agy-plugin',
      'NOT_CONFIGURED',
      'AGY runtime probe is opt-in outside CI; set DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE=1 on an isolated runner',
      root,
      [command],
      'multi-ai-sync',
      'agy-runtime-probe',
    );
    return { outcome: row.status, diagnostics: row.reasons, surfaceResults: [row], identity: { surface: 'agy-plugin', stage: row.stage, producer: row.producer, adapter: row.adapter } };
  }
  if (!fs.existsSync(script)) {
    const row = failedProbeRow('agy-plugin', 'NOT_CONFIGURED', 'AGY validator is unavailable', root, [command], 'multi-ai-sync', 'agy-runtime-probe');
    return { outcome: row.status, diagnostics: row.reasons, surfaceResults: [row], identity: { surface: 'agy-plugin', stage: row.stage, producer: row.producer, adapter: row.adapter } };
  }
  const child = spawnSync('python3', [
    '-B',
    script,
    '--root',
    root,
    'validate',
    '--targets',
    'agy',
    '--agy-runtime-probe',
    '--format',
    'json',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  let payload;
  try {
    payload = JSON.parse(child.stdout || '{}');
  } catch (_) {
    payload = null;
  }
  const platform = payload && Array.isArray(payload.results)
    ? payload.results.find((entry) => entry && entry.platform === 'agy')
    : null;
  const exitCode = child.status === null ? 127 : child.status;
  if (!platform) {
    const status = child.error && child.error.code === 'ETIMEDOUT' ? 'BLOCKED' : 'FAIL';
    const reason = child.error && child.error.code === 'ETIMEDOUT'
      ? 'AGY validator timed out'
      : `AGY validator emitted no platform result (exit ${exitCode})`;
    const row = failedProbeRow('agy-plugin', status, reason, root, [command], 'multi-ai-sync', 'agy-runtime-probe');
    return { outcome: row.status, diagnostics: row.reasons, surfaceResults: [row], identity: { surface: 'agy-plugin', stage: row.stage, producer: row.producer, adapter: row.adapter } };
  }
  const statusMap = { PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED', NOT_RUN: 'NOT_RUN', UNAVAILABLE: 'UNAVAILABLE', SKIP_INCOMPATIBLE: 'SKIP_INCOMPATIBLE' };
  const status = statusMap[platform.final_status] || 'FAIL';
  const reasons = [
    ...(Array.isArray(platform.notes) ? platform.notes : []),
    platform.hook_case_reason,
    platform.multi_agent_case_reason,
  ].filter(Boolean).map((reason) => sanitizeDiagnostics(reason));
  let row;
  try {
    const normalized = normalizeConsumerEvidence({
      stage: 'CONSUMER',
      producer: 'multi-ai-sync',
      adapter: { id: 'agy-runtime-probe', version: '1.0.0' },
      surfaceResults: [{
        surface: 'agy-plugin',
        status,
        commands: [{ cmd: command, exitCode }],
        environment: isTrustedCiEnvironment() ? 'ci' : 'local',
        artifacts: [{ platform: 'agy', finalStatus: platform.final_status, capabilities: platform.capabilities || [] }],
        diagnostics: [],
        reasons,
        checkedClaims: ['agy.package.structure', 'agy.runtime.subagent'],
      }],
    }).surfaceResults[0];
    row = {
      ...normalized,
      surface: 'agy-plugin',
      stage: 'CONSUMER',
      producer: 'multi-ai-sync',
      adapter: normalized.adapter || { id: 'agy-runtime-probe', version: '1.0.0' },
    };
  } catch (error) {
    row = failedProbeRow('agy-plugin', 'FAIL', `AGY evidence is invalid: ${error.message}`, root, [command], 'multi-ai-sync', 'agy-runtime-probe');
  }
  return {
    outcome: row.status,
    diagnostics: [...(row.reasons || []), ...(row.diagnostics || [])].slice(0, 20),
    surfaceResults: [row],
    identity: { surface: 'agy-plugin', stage: row.stage, producer: row.producer, adapter: row.adapter },
  };
}

function normalizedProbeRow(surface, packageRoot, payload, childStatus, consumerSurface) {
  const rawResults = payload && payload.surfaceResults;
  if (rawResults !== undefined && (!Array.isArray(rawResults) || rawResults.length !== 1)) {
    return failedProbeRow(
      surface,
      'FAIL',
      'consumer probe must emit exactly one surface result',
      packageRoot,
      payload && payload.commands,
    );
  }
  const raw = Array.isArray(rawResults)
    ? rawResults[0]
    : (payload && payload.surfaceEvidence);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const reportedStatus = payload && payload.status;
    const status = PROBE_STATUSES.has(reportedStatus) ? reportedStatus : 'FAIL';
    const reason = payload && payload.normalizationError
      ? `consumer probe normalization failed: ${payload.normalizationError}`
      : payload && payload.reason
        ? payload.reason
      : 'consumer probe did not emit a canonical surface result';
    const outcome = childStatus !== 0 && !['FAIL', 'BLOCKED'].includes(status) ? 'FAIL' : status;
    return failedProbeRow(surface, outcome, reason, packageRoot, payload && payload.commands);
  }

  if (raw.surface !== surface && raw.surface !== consumerSurface) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe emitted unexpected surface '${raw.surface || '<missing>'}'`,
      packageRoot,
      raw.commands,
    );
  }

  const payloadReason = payload && payload.reason;
  const rawReasons = Array.isArray(raw.reasons) ? raw.reasons : raw.reason ? [raw.reason] : [];
  const reasons = [...new Set([...rawReasons, ...(payloadReason ? [payloadReason] : [])])];
  const rawDiagnostics = Array.isArray(raw.diagnostics)
    ? raw.diagnostics
    : raw.diagnostic ? [raw.diagnostic] : [];
  const candidate = {
    ...raw,
    surface,
    ...(reasons.length > 0 ? { reasons } : {}),
    ...(rawDiagnostics.length > 0 ? { diagnostics: rawDiagnostics } : {}),
    commands: normalizeProbeCommands(raw.commands || (payload && payload.commands), packageRoot),
  };
  let normalized;
  try {
    normalized = normalizeConsumerEvidence({
      stage: 'CONSUMER',
      producer: 'consumer-platform-probe',
      adapter: raw.adapter || { id: 'consumer-platform-probe', version: '1.0.0' },
      surfaceResults: [candidate],
    }).surfaceResults[0];
  } catch (error) {
    return failedProbeRow(surface, 'FAIL', `consumer probe evidence is invalid: ${error.message}`, packageRoot, raw.commands);
  }
  if (childStatus !== 0 && !['FAIL', 'BLOCKED'].includes(normalized.status)) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe exited ${childStatus} with producer status ${normalized.status}`,
      packageRoot,
      normalized.commands,
    );
  }
  return {
    ...normalized,
    surface,
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: normalized.adapter || { id: 'consumer-platform-probe', version: '1.0.0' },
  };
}

function runConsumerProbe(root, parsed) {
  const surface = parsed.surface;
  if (surface === 'agy-plugin') return runAgyConsumerProbe(root);
  const adapter = PROBE_ADAPTERS[surface];
  const gateAdapter = CONSUMER_GATE_ADAPTERS[surface];
  if (gateAdapter) {
    if (surface === 'claude-core' && !allowsRealConsumerProbe()) {
      const row = failedProbeRow(
        surface,
        'NOT_CONFIGURED',
        'Claude consumer gate is opt-in outside CI because the CLI may write a shared global cache; set DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE=1 on an isolated runner',
        root,
        [],
        'consumer-gate',
        gateAdapter.adapterId,
      );
      return { outcome: row.status, diagnostics: row.reasons, surfaceResults: [row], identity: { surface, stage: row.stage, producer: row.producer, adapter: row.adapter } };
    }
    const version = releaseVersion(root);
    const gateScript = path.join(root, 'scripts', 'release', 'consumer-gate.js');
    const args = [gateScript, '--repo-root', root, '--surface', gateAdapter.gateSurface];
    if (version) args.push('--version', version);
    const child = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
    let payload;
    try {
      payload = JSON.parse(child.stdout || '{}');
    } catch (_) {
      payload = { status: 'FAIL', reason: `consumer gate emitted invalid JSON (exit ${child.status === null ? 127 : child.status})` };
    }
    const producerSurface = gateAdapter.producerSurface;
    const matches = Array.isArray(payload.surfaceResults)
      ? payload.surfaceResults.filter((entry) => entry && entry.surface === producerSurface)
      : [];
    const row = matches.length === 1
      ? normalizedGateRow(surface, matches[0], root, child.status === null ? 127 : child.status, gateAdapter.adapterId)
      : failedProbeRow(surface, 'FAIL', matches.length === 0
        ? `consumer gate did not emit surface '${producerSurface}'`
        : `consumer gate emitted duplicate surface '${producerSurface}'`, root, payload.commands, 'consumer-gate', gateAdapter.adapterId);
    return {
      outcome: row.status,
      diagnostics: [...(row.reasons || []), ...(row.diagnostics || [])].slice(0, 20),
      surfaceResults: [row],
      identity: {
        surface,
        stage: row.stage,
        producer: row.producer,
        adapter: row.adapter,
      },
    };
  }
  if (!adapter) {
    const reason = surface === 'agent-plugin'
      ? 'standard Agent Plugin has no verified consumer loader; Codex marketplace proof is reserved for codex-native'
      : `consumer probe adapter is not configured for ${surface}`;
    const row = {
      surface,
      status: 'NOT_CONFIGURED',
      stage: 'CONSUMER',
      producer: 'harness-facade',
      adapter: { id: 'not-configured', version: '1.0.0' },
      commands: [],
      environment: isTrustedCiEnvironment() ? 'ci' : 'local',
      artifacts: [],
      diagnostics: [],
      reasons: [reason],
      checkedClaims: ['consumer-route'],
    };
    return {
      outcome: row.status,
      diagnostics: [reason],
      surfaceResults: [row],
      identity: {
        surface,
        stage: row.stage,
        producer: row.producer,
        adapter: row.adapter,
      },
    };
  }

  const packageRoot = path.resolve(root, ...adapter.packagePath);
  const probeScript = path.join(root, 'scripts', 'release', 'consumer-platform-probe.js');
  const version = probePackageVersion(packageRoot, adapter.platform);
  const args = [probeScript, '--platform', adapter.platform, '--package-root', packageRoot];
  if (version) args.push('--version', version);
  if (['agent-plugin', 'cursor-plugin'].includes(surface) && allowsRealConsumerProbe()) args.push('--execute');
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  let payload;
  try {
    payload = JSON.parse(child.stdout || '{}');
  } catch (_) {
    payload = {
      status: 'FAIL',
      reason: `consumer probe emitted invalid JSON (exit ${child.status === null ? 127 : child.status})`,
      diagnostics: [child.stderr || child.stdout || 'no probe output'],
    };
  }
  if (child.error && child.error.code === 'ETIMEDOUT') {
    payload = { ...payload, status: 'BLOCKED', reason: 'consumer probe timed out' };
  }
  const row = normalizedProbeRow(
    surface,
    packageRoot,
    payload,
    child.status === null ? 127 : child.status,
    adapter.consumerSurface,
  );
  const diagnostics = [...row.reasons, ...row.diagnostics].slice(0, 20);
  return {
    outcome: row.status,
    diagnostics,
    surfaceResults: [row],
    identity: {
      surface,
      stage: row.stage,
      producer: row.producer,
      adapter: row.adapter,
    },
  };
}

function normalizeReleaseProbeResult(root, surface, execution) {
  const rows = execution && Array.isArray(execution.surfaceResults)
    ? execution.surfaceResults
    : [];
  if (rows.length !== 1) {
    return failedProbeRow(
      surface,
      'FAIL',
      rows.length === 0
        ? `consumer probe did not emit a result for '${surface}'`
        : `consumer probe emitted ${rows.length} surface results; expected exactly one for '${surface}'`,
      root,
    );
  }
  const row = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe emitted an invalid result for '${surface}'`,
      root,
    );
  }
  if (row.surface !== surface) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe emitted unexpected surface '${row.surface || '<missing>'}' for '${surface}'`,
      root,
      row.commands,
    );
  }
  if (row.stage !== 'CONSUMER') {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe result for '${surface}' is not CONSUMER evidence`,
      root,
      row.commands,
    );
  }
  if (!PROBE_STATUSES.has(row.status)) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe result for '${surface}' has invalid status '${row.status || '<missing>'}'`,
      root,
      row.commands,
    );
  }
  if (typeof row.producer !== 'string' || row.producer.length === 0) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe result for '${surface}' is missing a producer identity`,
      root,
      row.commands,
    );
  }
  if (!execution || !PROBE_STATUSES.has(execution.outcome)) {
    return failedProbeRow(
      surface,
      'FAIL',
      execution && execution.outcome === undefined
        ? `consumer probe omitted a canonical outcome for '${surface}'`
        : `consumer probe emitted invalid outcome '${execution && execution.outcome}' for '${surface}'`,
      root,
      row.commands,
    );
  }
  if (execution.outcome !== row.status) {
    return failedProbeRow(
      surface,
      'FAIL',
      `consumer probe outcome '${execution.outcome}' disagrees with surface status '${row.status}'`,
      root,
      row.commands,
    );
  }
  return row;
}

function runReleaseProbes(root, requiredSurfaces, requiredRuntimeSurfacesOrExecutor, probeExecutor = runConsumerProbe) {
  const legacyExecutorCall = typeof requiredRuntimeSurfacesOrExecutor === 'function';
  const requiredRuntimeSurfaces = legacyExecutorCall ? undefined : requiredRuntimeSurfacesOrExecutor;
  if (legacyExecutorCall) probeExecutor = requiredRuntimeSurfacesOrExecutor;
  const surfaceResults = requiredSurfaces.map((surface) => {
    let execution;
    try {
      execution = probeExecutor(root, { surface });
    } catch (error) {
      return failedProbeRow(surface, 'FAIL', `consumer probe failed before emitting evidence: ${error.message}`, root);
    }
    return normalizeReleaseProbeResult(root, surface, execution);
  });
  const aggregate = aggregateRequiredSurfaces({
    requiredSurfaces,
    requiredRuntimeSurfaces,
    surfaceResults,
    fullRelease: true,
  });
  const diagnostics = surfaceResults.flatMap((entry) => [
    ...(Array.isArray(entry.reasons) ? entry.reasons : []),
    ...(Array.isArray(entry.diagnostics) ? entry.diagnostics : []),
  ]).filter(Boolean).slice(0, 50);
  return {
    ...aggregate,
    diagnostics,
  };
}

function phaseExecution(root, parsed, inventory, binding) {
  if (parsed.phase === 'test') return runBoundedTest(root, parsed.testFile);
  if (parsed.phase === 'generate' || parsed.phase === 'validate' || parsed.phase === 'verify') return runDistribution(root, parsed, binding);
  if (parsed.phase === 'probe') return runConsumerProbe(root, parsed);
  if (parsed.phase === 'release') {
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    if (required.errors.length > 0) return { outcome: 'BLOCKED', diagnostics: required.errors.slice(0, 20) };
    return runReleaseProbes(root, required.requiredSurfaces, required.requiredRuntimeSurfaces);
  }
  if (parsed.phase === 'preflight') {
    const errors = [];
    if (binding && binding.dirty) errors.push('working tree is dirty; exact release checkout cannot be proven');
    const v2 = inventoryApi.validateDistributionInventoryV2({ inventory });
    errors.push(...v2.errors);
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    errors.push(...required.errors);
    const identity = {
      ...(Array.isArray(required.requiredSurfaces) ? { requiredSurfaces: required.requiredSurfaces } : {}),
      ...(Array.isArray(required.requiredRuntimeSurfaces) ? { requiredRuntimeSurfaces: required.requiredRuntimeSurfaces } : {}),
    };
    return errors.length > 0
      ? { outcome: 'BLOCKED', diagnostics: errors.slice(0, 20), ...identity }
      : { outcome: 'PASS', diagnostics: [], ...identity };
  }
  if (parsed.phase === 'plan') {
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    return required.errors.length > 0
      ? { outcome: 'BLOCKED', diagnostics: required.errors.slice(0, 20) }
      : {
        outcome: 'PASS',
        requiredSurfaces: required.requiredSurfaces,
        requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
        planFingerprint: `sha256:${receipts.sha256(JSON.stringify({
          requiredSurfaces: required.requiredSurfaces,
          requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
        }))}`,
      };
  }
  return { outcome: 'NOT_RUN', diagnostics: [`phase '${parsed.phase}' has no configured adapter`] };
}

function attemptPathFromReference(reference) {
  if (typeof reference !== 'string' || !reference.trim()) throw new Error('receipt handoff reference is required');
  const resolved = path.resolve(reference);
  try {
    if (fs.statSync(resolved).isFile() && path.basename(resolved) === 'attempt.json') return path.dirname(resolved);
  } catch (_) {
    // The validator below reports a bounded unreadable-receipt diagnostic.
  }
  return resolved;
}

function blockedHandoffError(message) {
  const error = new Error(message);
  error.code = 'HARNESS_BLOCKED';
  return error;
}

function operationIntent(parsed) {
  return {
    phase: parsed.phase,
    surface: parsed.surface || null,
    testFile: parsed.testFile || null,
  };
}

function assertReplayIntent(parsed, envelope) {
  const requested = operationIntent(parsed);
  if (envelope.operationIntent !== undefined) {
    if (receipts.canonicalJson(envelope.operationIntent) !== receipts.canonicalJson(requested)) {
      throw blockedHandoffError('operation key replay does not match the original phase/surface/operation intent');
    }
    return;
  }
  // Receipts written before operationIntent was introduced still receive the
  // strict surface guard. Any other mutating option is unsafe to infer.
  if (requested.surface !== null && envelope.surface !== requested.surface) {
    throw blockedHandoffError(`operation key belongs to surface '${envelope.surface || '<missing>'}', not '${requested.surface}'`);
  }
  if (requested.testFile !== null) {
    throw blockedHandoffError('operation key replay cannot prove the original operation intent from a legacy receipt');
  }
}

function receiptReferenceIdentity(receiptRoot, reference, root, binding, taskId, phase, mode, surface = null) {
  let attemptPath;
  try {
    attemptPath = attemptPathFromReference(reference);
  } catch (error) {
    throw blockedHandoffError(error.message);
  }
  const resolvedRoot = path.resolve(receiptRoot);
  if (!(attemptPath === resolvedRoot || attemptPath.startsWith(`${resolvedRoot}${path.sep}`))) {
    throw blockedHandoffError('previous receipt must be under the current runtime receipt root');
  }
  const checked = receipts.validateReceipt(attemptPath, {
    root,
    expectedSourceCommit: binding.sourceCommit,
    expectedSourceTree: binding.sourceTree,
  });
  if (!checked.ok) throw blockedHandoffError(`previous receipt is invalid: ${checked.errors.slice(0, 8).join('; ')}`);
  const envelope = checked.envelope;
  if (envelope.taskId !== taskId) {
    throw blockedHandoffError(`previous receipt belongs to task '${envelope.taskId}', expected '${taskId}'`);
  }
  if (binding.dirty || envelope.worktree === 'DIRTY') {
    throw blockedHandoffError('previous receipt handoff requires a clean exact checkout; dirty evidence cannot be replayed');
  }
  if (!PHASE_INDEX.has(envelope.phase)) {
    throw blockedHandoffError('previous receipt does not identify a supported predecessor phase');
  }
  if (mode === 'retry' && envelope.phase !== phase) {
    throw blockedHandoffError(`retry receipt belongs to phase '${envelope.phase}', expected '${phase}'`);
  }
  if (mode === 'handoff') {
    if (PHASE_INDEX.get(envelope.phase) >= PHASE_INDEX.get(phase)) {
      throw blockedHandoffError(`previous receipt phase '${envelope.phase}' must precede '${phase}'`);
    }
    if (!HANDOFF_OUTCOMES.has(envelope.outcome)) {
      throw blockedHandoffError(`previous receipt outcome '${envelope.outcome}' is not eligible for phase handoff`);
    }
  }
  if (surface && envelope.surface && envelope.surface !== surface) {
    throw blockedHandoffError(`previous receipt surface '${envelope.surface}' does not match requested surface '${surface}'`);
  }
  if (phase === 'generate' && !envelope.planFingerprint) {
    throw blockedHandoffError('generate handoff requires a predecessor plan fingerprint');
  }
  return {
    path: attemptPath,
    identity: {
      taskId: envelope.taskId,
      attemptId: envelope.attemptId,
      phase: envelope.phase,
      outcome: envelope.outcome,
      ...(envelope.surface ? { surface: envelope.surface } : {}),
      ...(envelope.planFingerprint ? { planFingerprint: envelope.planFingerprint } : {}),
      ...(envelope.artifactFingerprint ? { artifactFingerprint: envelope.artifactFingerprint } : {}),
    },
    envelope,
  };
}

function replayAttempt(phase, attempt, parsed) {
  const envelope = attempt.envelope;
  if (envelope.phase && envelope.phase !== phase) {
    throw blockedHandoffError(`operation key belongs to phase '${envelope.phase}', not '${phase}'`);
  }
  assertReplayIntent(parsed, envelope);
  const result = createResult({
    phase,
    lifecyclePhase: envelope.lifecyclePhase,
    outcome: envelope.outcome,
    diagnostics: envelope.diagnostics || [],
    artifacts: envelope.artifacts || [],
    sourceCommit: envelope.sourceCommit,
    sourceTree: envelope.sourceTree,
    targetCommit: envelope.targetCommit,
    targetTree: envelope.targetTree,
    worktree: envelope.worktree,
    receiptReference: attempt.path,
    resumeCommand: envelope.resumeCommand,
    ...(Array.isArray(envelope.requiredSurfaces) ? { requiredSurfaces: envelope.requiredSurfaces } : {}),
    ...(Array.isArray(envelope.requiredRuntimeSurfaces) ? { requiredRuntimeSurfaces: envelope.requiredRuntimeSurfaces } : {}),
    ...(Array.isArray(envelope.surfaceResults) ? { surfaceResults: envelope.surfaceResults } : {}),
    ...(envelope.surface ? { surface: envelope.surface } : {}),
    ...(envelope.stage ? { stage: envelope.stage } : {}),
    ...(envelope.producer ? { producer: envelope.producer } : {}),
  });
  result.exitCode = exitCodeForOutcome(result.outcome);
  return { status: result.exitCode, result, replayed: true };
}

function execute(argv = [], {
  root = path.resolve(__dirname, '..'),
  env = process.env,
  phaseExecutor = phaseExecution,
} = {}) {
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
    const operationKey = parsed.operationKey || parsed.idempotencyKey || null;
    if (operationKey) {
      const existing = receipts.findAttemptByOperationKey(resolvedReceiptRoot, operationKey);
      if (existing) {
        if (existing.taskId !== taskId) throw blockedHandoffError(`operation key already belongs to task '${existing.taskId}'`);
        const checked = receipts.validateReceipt(existing.path, {
          root,
          expectedSourceCommit: binding.sourceCommit,
          expectedSourceTree: binding.sourceTree,
        });
        if (!checked.ok) throw blockedHandoffError(`idempotent receipt is stale or invalid: ${checked.errors.slice(0, 8).join('; ')}`);
        if (binding.dirty || checked.envelope.worktree === 'DIRTY') {
          throw blockedHandoffError('idempotent replay requires a clean exact checkout; dirty evidence cannot be replayed');
        }
        if (!checked.eventCount || !checked.lastEvent) {
          throw blockedHandoffError('idempotent replay requires a finalized receipt event');
        }
        if (checked.lastEvent.outcome !== checked.envelope.outcome
          || checked.lastEvent.lifecyclePhase !== checked.envelope.lifecyclePhase) {
          throw blockedHandoffError('idempotent replay requires a terminal event matching the receipt envelope');
        }
        return replayAttempt(parsed.phase, { ...existing, envelope: checked.envelope }, parsed);
      }
    }
    let previousReceipt = null;
    const previousReference = parsed.previousReceipt || parsed.retryOf || null;
    if (previousReference) {
      previousReceipt = receiptReferenceIdentity(
        resolvedReceiptRoot,
        previousReference,
        root,
        binding,
        taskId,
        parsed.phase,
        parsed.retryOf ? 'retry' : 'handoff',
        parsed.surface || null,
      );
      parsed.handoff = previousReceipt.envelope;
      if (previousReceipt.envelope.planFingerprint) parsed.handoffPlanFingerprint = previousReceipt.envelope.planFingerprint;
    }
    const operationReservation = operationKey
      ? receipts.reserveOperationKey(resolvedReceiptRoot, operationKey, { taskId, attemptId })
      : null;
    let execution = phaseExecutor(root, parsed, inventory, binding);
    const postExecutionBinding = resolveSourceBinding(root);
    const worktreeDirty = binding.dirty || postExecutionBinding.dirty;
    if (execution && execution.outcome === 'COMPLETE' && worktreeDirty) {
      execution = {
        ...execution,
        outcome: 'NO_SHIP',
        diagnostics: [
          ...(Array.isArray(execution.diagnostics) ? execution.diagnostics : []),
          'COMPLETE promotion requires a clean target checkout; current worktree is DIRTY',
        ],
      };
    }
    if (parsed.diagnostic) execution.diagnostics = [...(execution.diagnostics || []), parsed.diagnostic];
    const identity = execution.identity && typeof execution.identity === 'object' ? execution.identity : {};
    const receiptIdentitySource = {
      ...identity,
      targetCommit: postExecutionBinding.targetCommit,
      targetTree: postExecutionBinding.targetTree,
      worktree: worktreeDirty ? 'DIRTY' : 'CLEAN',
    };
    const receiptIdentity = Object.fromEntries(
      ['planFingerprint', 'artifactFingerprint', 'surface', 'adapter', 'stage', 'producer',
        'generatedFromCommit', 'generatedFromTree', 'targetCommit', 'targetTree', 'worktree']
        .filter((field) => receiptIdentitySource[field] !== undefined && receiptIdentitySource[field] !== null)
        .map((field) => [field, receiptIdentitySource[field]])
    );
    const evidenceArtifacts = Array.isArray(execution.surfaceResults)
      ? execution.surfaceResults
      : (execution.artifacts || []);
    const lifecyclePhase = lifecyclePhaseForOutcome(execution.outcome);
    const attempt = receipts.createAttempt({
      root: resolvedReceiptRoot,
      command: `harness ${argv.join(' ')}`,
      phase: parsed.phase,
      taskId,
      attemptId,
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      sessionId: env.DHPK_SESSION_ID || null,
      dispatch: env.DHPK_DISPATCH_ID ? { dispatchId: env.DHPK_DISPATCH_ID } : null,
      diagnostics: execution.diagnostics || [],
      artifacts: evidenceArtifacts,
      requiredSurfaces: execution.requiredSurfaces || null,
      requiredRuntimeSurfaces: execution.requiredRuntimeSurfaces || null,
      surfaceResults: execution.surfaceResults || null,
      byteReferences: execution.byteReferences || [],
      lifecyclePhase,
      outcome: execution.outcome,
      operationKey: parsed.operationKey || null,
      idempotencyKey: parsed.idempotencyKey || null,
      operationReservation,
      identity: {
        ...receiptIdentity,
        operationIntent: operationIntent(parsed),
      },
      retryOf: parsed.retryOf && previousReceipt ? previousReceipt.identity : null,
      previousReceipt: parsed.previousReceipt && previousReceipt ? previousReceipt.identity : null,
      resumeCommand: resumeCommand(argv),
    });
    const result = createResult({
      phase: parsed.phase,
      lifecyclePhase,
      outcome: execution.outcome,
      diagnostics: (execution.diagnostics || []).map(sanitizeDiagnostics),
      artifacts: evidenceArtifacts,
      sourceCommit: binding.sourceCommit,
      sourceTree: binding.sourceTree,
      targetCommit: postExecutionBinding.targetCommit,
      targetTree: postExecutionBinding.targetTree,
      worktree: worktreeDirty ? 'DIRTY' : 'CLEAN',
      receiptReference: attempt.path,
      resumeCommand: resumeCommand(argv),
      ...(Array.isArray(execution.requiredSurfaces) ? { requiredSurfaces: execution.requiredSurfaces } : {}),
      ...(Array.isArray(execution.requiredRuntimeSurfaces) ? { requiredRuntimeSurfaces: execution.requiredRuntimeSurfaces } : {}),
      ...(Array.isArray(execution.surfaceResults) ? { surfaceResults: execution.surfaceResults } : {}),
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
    const blocked = error && error.code === 'HARNESS_BLOCKED';
    const result = createResult({
      phase: parsed.phase,
      lifecyclePhase: 'RED',
      outcome: blocked ? 'BLOCKED' : 'FAIL',
      ...(blocked ? {} : { internalError: true }),
      diagnostics: [sanitizeDiagnostics(error.message)],
      resumeCommand: resumeCommand(argv),
    });
    result.exitCode = exitCodeForOutcome(result.outcome);
    return { status: result.exitCode, result };
  }
}

module.exports = {
  PHASES,
  parseArgs,
  helpFor,
  execute,
  lifecyclePhaseForOutcome,
  exitCodeForOutcome,
  runReleaseProbes,
};
