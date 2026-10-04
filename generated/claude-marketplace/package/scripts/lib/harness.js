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
const { normalizeConsumerEvidence, combineConsumerEvidence } = require('./release-evidence');
const runtimePreflight = require('./consumer-runtime-preflight');
const releaseArtifactManifest = require('./release-artifact-manifest');

const PHASES = Object.freeze(['preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release']);
const PHASE_INDEX = new Map(PHASES.map((phase, index) => [phase, index]));
const HANDOFF_OUTCOMES = new Set(['PASS', 'COMPLETE']);
const MAX_CONSUMER_REQUIREMENTS_BYTES = 1024 * 1024;
const OPTIONS_WITH_VALUE = new Set([
  '--task-id', '--attempt-id', '--surface', '--test-file', '--diagnostic', '--receipt-root',
  '--operation-key', '--idempotency-key', '--previous-receipt', '--retry-of',
  '--source-commit', '--source-tree', '--target-commit', '--target-tree', '--surfaces', '--requirements',
]);
const HELP = 'usage: bin/dhpk harness <preflight|plan|generate|validate|test|probe|verify|release> [options]\n'
  + 'options: --json --task-id <id> --attempt-id <id> --surface <surface> --test-file <file> --diagnostic <text>\n'
  + 'identity: --source-commit <sha> --source-tree <sha> --target-commit <sha> --target-tree <sha> --surfaces <id,id,...>\n'
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
        '--source-commit': 'sourceCommit',
        '--source-tree': 'sourceTree',
        '--target-commit': 'targetCommit',
        '--target-tree': 'targetTree',
        '--surfaces': 'surfaces',
        '--requirements': 'requirementsFile',
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
  if (parsed.surfaces !== undefined) {
    parsed.surfaces = parsed.surfaces.split(',').map((surface) => surface.trim()).filter(Boolean);
    if (parsed.surfaces.length === 0) throw new Error('--surfaces must contain at least one surface');
  }
  if (parsed.requirementsFile && parsed.phase !== 'release') {
    throw new Error("--requirements is only supported for 'release'");
  }
  if (parsed.requirementsFile && (parsed.surface || parsed.surfaces)) {
    throw new Error('--requirements cannot be combined with an explicit surface scope');
  }
  return parsed;
}

function hasCurrentConsumerEnvelope(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.prototype.hasOwnProperty.call(value, 'schemaVersion')
      || Object.prototype.hasOwnProperty.call(value, 'acceptance')
      || Object.prototype.hasOwnProperty.call(value, 'transportStatus'));
}

function canonicalizeClaudeConsumerEnvelope(input, selectedSurfaces = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !selectedSurfaces.includes('claude-core')) return input;

  const canonicalSurface = (surface) => surface === 'claude' ? 'claude-core' : surface;
  const canonicalizeRow = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.surface !== 'claude') return row;
    const requirementEvidence = row.requirementEvidence && typeof row.requirementEvidence === 'object'
      && !Array.isArray(row.requirementEvidence)
      ? Object.fromEntries(Object.entries(row.requirementEvidence).map(([slot, evidence]) => [
        slot,
        evidence && typeof evidence === 'object' && !Array.isArray(evidence)
          ? {
            ...evidence,
            ...(typeof evidence.checkKey === 'string'
              ? { checkKey: evidence.checkKey.replace(/^claude:/, 'claude-core:') }
              : {}),
            ...(evidence.contractEvidence && typeof evidence.contractEvidence === 'object'
              && !Array.isArray(evidence.contractEvidence)
              ? {
                contractEvidence: {
                  ...evidence.contractEvidence,
                  ...(typeof evidence.contractEvidence.evidenceRef === 'string'
                    ? { evidenceRef: evidence.contractEvidence.evidenceRef.replace(/^surfaceResults\.claude\./, 'surfaceResults.claude-core.') }
                    : {}),
                },
              }
              : {}),
          }
          : evidence,
      ]))
      : row.requirementEvidence;
    return {
      ...row,
      surface: 'claude-core',
      producerSurface: row.producerSurface || 'claude',
      ...(requirementEvidence ? { requirementEvidence } : {}),
    };
  };
  const canonicalizeCheck = (check) => {
    if (!check || typeof check !== 'object' || Array.isArray(check) || check.surface !== 'claude') return check;
    let id = check.id;
    if (id === 'install.claude') id = 'install.claude-core';
    else if (id === 'runtime.claude') id = 'runtime.claude-core';
    else if (id === 'scope.claude') id = 'scope.claude-core';
    return {
      ...check,
      id,
      surface: 'claude-core',
      ...(typeof check.evidenceRef === 'string'
        ? { evidenceRef: check.evidenceRef.replace(/^surfaceResults\.claude\./, 'surfaceResults.claude-core.') }
        : {}),
    };
  };
  const acceptance = input.acceptance && typeof input.acceptance === 'object' && !Array.isArray(input.acceptance)
    ? {
      ...input.acceptance,
      ...(Array.isArray(input.acceptance.requiredChecks)
        ? { requiredChecks: input.acceptance.requiredChecks.map(canonicalizeCheck) }
        : {}),
      ...(Array.isArray(input.acceptance.excludedChecks)
        ? { excludedChecks: input.acceptance.excludedChecks.map(canonicalizeCheck) }
        : {}),
    }
    : input.acceptance;
  return {
    ...input,
    ...(input.surface === 'claude' ? { surface: 'claude-core' } : {}),
    ...(Array.isArray(input.surfaceResults) ? { surfaceResults: input.surfaceResults.map(canonicalizeRow) } : {}),
    ...(acceptance ? { acceptance } : {}),
  };
}

function normalizeCurrentConsumerEnvelope(input, selectedSurfaces = []) {
  if (!hasCurrentConsumerEnvelope(input)) {
    throw new Error('consumer gate omitted schema-v2 acceptance evidence');
  }
  const normalized = normalizeConsumerEvidence(canonicalizeClaudeConsumerEnvelope(input, selectedSurfaces));
  if (normalized.schemaVersion !== 2 || normalized.stage !== 'CONSUMER' || !normalized.acceptance) {
    throw new Error('consumer gate emitted an invalid schema-v2 CONSUMER envelope');
  }
  if (input.outcome !== undefined && input.outcome !== normalized.acceptance.verdict
    && input.transportStatus !== 'FAIL') {
    throw new Error('consumer gate execution outcome disagrees with acceptance verdict');
  }
  return normalized;
}

function currentAcceptanceExitCode(verdict) {
  return verdict === 'PASS' ? 0 : 1;
}

function diagnosticList(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string' && entry);
  return typeof value === 'string' && value ? [value] : [];
}

function consumerEvidenceForExecution(execution) {
  if (!execution || typeof execution !== 'object' || !execution.acceptance
    || !Array.isArray(execution.surfaceResults)) return null;
  return normalizeConsumerEvidence({
    schemaVersion: 2,
    stage: 'CONSUMER',
    verdict: execution.acceptance.verdict,
    acceptance: execution.acceptance,
    surfaceResults: execution.surfaceResults,
    ...(execution.producer ? { producer: execution.producer } : {}),
    ...(execution.adapter ? { adapter: execution.adapter } : {}),
    ...(execution.environment !== undefined ? { environment: execution.environment } : {}),
    ...(execution.planFingerprint ? { planFingerprint: execution.planFingerprint } : {}),
    ...(execution.artifactFingerprint ? { artifactFingerprint: execution.artifactFingerprint } : {}),
    ...(execution.transportStatus ? { transportStatus: execution.transportStatus } : {}),
    ...(Array.isArray(execution.diagnostics) ? { diagnostics: execution.diagnostics } : {}),
  });
}

function restoreConsumerEvidenceReplay(replayed, envelope) {
  if (!envelope || !envelope.consumerEvidence) return replayed;
  const evidence = normalizeConsumerEvidence(envelope.consumerEvidence);
  if (!evidence.acceptance) return replayed;
  const result = {
    ...replayed.result,
    schema: 'dhpk.harness.result.v2',
    acceptance: evidence.acceptance,
    surfaceResults: evidence.surfaceResults,
    ...(evidence.transportStatus ? { transportStatus: evidence.transportStatus } : {}),
  };
  const outcome = result.outcome;
  const passEffective = evidence.acceptance.verdict === 'PASS'
    && ['PASS', 'COMPLETE'].includes(outcome)
    && evidence.transportStatus !== 'FAIL';
  const failedTransport = evidence.acceptance.verdict === 'PASS'
    && evidence.transportStatus === 'FAIL'
    && outcome === 'PUBLISHED_UNHEALTHY';
  result.exitCode = passEffective ? 0 : 1;
  return { ...replayed, status: result.exitCode, result };
}

function readConsumerRequirementsBytes(file) {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (!Number.isInteger(O_NOFOLLOW) || !Number.isInteger(O_NONBLOCK)) {
    throw new Error('safe release requirements file opening is unavailable');
  }

  let descriptor;
  try {
    descriptor = fs.openSync(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (error) {
    if (error && ['ELOOP', 'EMLINK'].includes(error.code)) {
      throw new Error('release requirements must not be a symbolic link');
    }
    throw new Error('release requirements could not be opened safely');
  }

  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) throw new Error('release requirements must be a regular file');
    if (!Number.isSafeInteger(stats.size) || stats.size > MAX_CONSUMER_REQUIREMENTS_BYTES) {
      throw new Error('release requirements exceed the bounded file size');
    }
    const chunks = [];
    let total = 0;
    const chunk = Buffer.alloc(64 * 1024);
    while (true) {
      const remaining = MAX_CONSUMER_REQUIREMENTS_BYTES + 1 - total;
      const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, remaining), null);
      if (count === 0) break;
      total += count;
      if (total > MAX_CONSUMER_REQUIREMENTS_BYTES) {
        throw new Error('release requirements exceed the bounded file size');
      }
      chunks.push(Buffer.from(chunk.subarray(0, count)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    fs.closeSync(descriptor);
  }
}

function consumerRequirementsScope(root, requirementsFile) {
  const file = path.isAbsolute(requirementsFile)
    ? requirementsFile
    : path.resolve(root, requirementsFile);
  const bytes = readConsumerRequirementsBytes(file);
  let requirements;
  try {
    requirements = JSON.parse(bytes.toString('utf8'));
  } catch (_) {
    throw new Error('release requirements JSON is invalid');
  }
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)
    || requirements.schema !== 'dhpk.consumer-requirements.v1') {
    throw new Error('release requirements must declare a non-empty selectedSurfaces list');
  }
  const selectedSurfaces = requirements.selectedSurfaces === undefined
    ? (Array.isArray(requirements.checks)
      ? [...new Set(requirements.checks.map((check) => (
        check && typeof check === 'object' && !Array.isArray(check) ? check.surface : undefined
      )))]
      : [])
    : requirements.selectedSurfaces;
  if (!Array.isArray(selectedSurfaces) || selectedSurfaces.length === 0) {
    throw new Error('release requirements must declare a non-empty selectedSurfaces list');
  }
  const seen = new Set();
  for (const surface of selectedSurfaces) {
    if (!REQUIRED_SURFACES.includes(surface)) throw new Error(`release requirements contain unknown surface '${surface}'`);
    if (seen.has(surface)) throw new Error(`release requirements contain duplicate surface '${surface}'`);
    seen.add(surface);
  }
  return {
    file,
    bytes,
    digest: `sha256:${receipts.sha256(bytes)}`,
    requirements,
    selectedSurfaces: [...selectedSurfaces],
  };
}

function spawnConsumerGate(root, args, { timeout = 120000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const restrictedArgs = allowsRealConsumerProbe()
    ? args
    : [...args, '--skip-claude-reinstall'];
  return spawnSync(process.execPath, restrictedArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer,
  });
}

function prepareConsumerGateEvidence(payload, selectedSurfaces, root) {
  if (!hasCurrentConsumerEnvelope(payload)) {
    throw new Error('consumer gate omitted schema-v2 acceptance evidence');
  }
  const canonicalized = canonicalizeClaudeConsumerEnvelope(payload, selectedSurfaces);
  const prepared = Array.isArray(canonicalized.surfaceResults)
    ? {
      ...canonicalized,
      surfaceResults: canonicalized.surfaceResults.map((entry) => entry && typeof entry === 'object'
        ? {
          ...entry,
          producer: entry.producer || 'consumer-gate',
          commands: normalizeProbeCommands(entry.commands, root),
        }
        : entry),
    }
    : canonicalized;
  return normalizeCurrentConsumerEnvelope(prepared, selectedSurfaces);
}

function consumerGateTransportDiagnostics(child, acceptance) {
  const expectedExitCode = currentAcceptanceExitCode(acceptance.verdict);
  if (child.error) return [`consumer gate process failed: ${child.error.message}`];
  if (child.status === expectedExitCode) return [];
  return [
    `consumer gate acceptance '${acceptance.verdict}' requires exit ${expectedExitCode}, received ${child.status === null ? 'no exit code' : child.status}`,
  ];
}

function bindConsumerArtifacts(surfaceResults, artifactManifest) {
  const artifactBySurface = new Map((artifactManifest && Array.isArray(artifactManifest.packages)
    ? artifactManifest.packages
    : []).map((entry) => [entry.surface, entry]));
  return surfaceResults.map((row) => ({
    ...row,
    ...(artifactBySurface.has(row.surface) ? { artifactBinding: artifactBySurface.get(row.surface) } : {}),
  }));
}

function runRequirementsConsumerGate(root, requirementsScope, selectedSurfaces, artifactManifest = null) {
  const gateScript = path.join(root, 'scripts', 'release', 'consumer-gate.js');
  const version = releaseVersion(root);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-requirements-'));
  let child;
  try {
    const snapshotFile = path.join(temporaryDirectory, 'requirements.json');
    fs.writeFileSync(snapshotFile, requirementsScope.bytes, { flag: 'wx', mode: 0o600 });
    const args = [gateScript, '--repo-root', root, '--requirements', snapshotFile];
    if (version) args.push('--version', version);
    child = spawnConsumerGate(root, args, { maxBuffer: 8 * 1024 * 1024 });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  let payload = null;
  try { payload = JSON.parse(child.stdout || ''); } catch (_) { /* handled as current protocol failure below */ }

  try {
    const normalized = prepareConsumerGateEvidence(payload, selectedSurfaces, root);
    const combined = combineConsumerEvidence([normalized], selectedSurfaces);
    const transportDiagnostics = consumerGateTransportDiagnostics(child, combined.acceptance);
    const transportStatus = transportDiagnostics.length > 0 ? 'FAIL' : 'PASS';
    const surfaceResults = bindConsumerArtifacts(combined.surfaceResults, artifactManifest);
    return {
      ...combined,
      surfaceResults,
      outcome: transportStatus === 'FAIL' && combined.acceptance.verdict === 'PASS'
        ? 'FAIL'
        : combined.acceptance.verdict,
      transportStatus,
      diagnostics: [
        ...diagnosticList(combined.diagnostics),
        ...surfaceResults.flatMap((row) => [...diagnosticList(row.reasons), ...diagnosticList(row.diagnostics)]),
        ...transportDiagnostics,
      ].slice(0, 50),
      ...(artifactManifest ? { artifactManifestFingerprint: artifactManifest.manifestFingerprint } : {}),
    };
  } catch (error) {
    const reason = `consumer gate current evidence failed closed: ${error.message}`;
    const rows = selectedSurfaces.map((surface) => failedProbeRow(
      surface,
      'FAIL',
      reason,
      root,
      [],
      'consumer-gate',
      'current-consumer-evidence',
    ));
    return {
      schemaVersion: 2,
      stage: 'CONSUMER',
      outcome: 'FAIL',
      transportStatus: 'FAIL',
      surfaceResults: rows,
      diagnostics: [reason],
      ...(artifactManifest ? { artifactManifestFingerprint: artifactManifest.manifestFingerprint } : {}),
    };
  }
}

function runConfiguredConsumerGate(root, requiredRuntimeSurfaces, artifactManifest = null) {
  const gateScript = path.join(root, 'scripts', 'release', 'consumer-gate.js');
  const args = [gateScript, '--repo-root', root];
  const version = releaseVersion(root);
  if (version) args.push('--version', version);
  const child = spawnConsumerGate(root, args, { maxBuffer: 8 * 1024 * 1024 });
  let payload = null;
  try { payload = JSON.parse(child.stdout || ''); } catch (_) { /* handled as current protocol failure below */ }

  const rawSurfaces = Array.isArray(payload && payload.surfaceResults)
    ? payload.surfaceResults.map((row) => row && row.surface).filter((surface) => typeof surface === 'string')
    : [];
  const selectedSurfaces = rawSurfaces.map((surface) => surface === 'claude' ? 'claude-core' : surface);
  try {
    const canonicalSurfaces = REQUIRED_SURFACES.filter((surface) => selectedSurfaces.includes(surface));
    if (canonicalSurfaces.length !== selectedSurfaces.length) {
      throw new Error('consumer gate emitted an unknown configured surface');
    }
    const normalized = prepareConsumerGateEvidence(payload, canonicalSurfaces, root);
    const transportDiagnostics = consumerGateTransportDiagnostics(child, normalized.acceptance);
    const transportStatus = transportDiagnostics.length > 0 ? 'FAIL' : 'PASS';
    if (canonicalSurfaces.length === 0) {
      const configurationChecks = normalized.acceptance.requiredChecks.filter((check) => check.id === 'scope.configuration');
      if (normalized.acceptance.verdict !== 'BLOCKED' || configurationChecks.length !== 1) {
        throw new Error('consumer gate must block when no configured surface exists');
      }
      return {
        ...normalized,
        requiredSurfaces: [],
        requiredRuntimeSurfaces: [],
        surfaceResults: [],
        outcome: 'BLOCKED',
        exitCode: 1,
        transportStatus,
        diagnostics: [...diagnosticList(normalized.diagnostics), ...transportDiagnostics].slice(0, 50),
      };
    }
    const combined = combineConsumerEvidence([normalized], canonicalSurfaces);
    const surfaceResults = bindConsumerArtifacts(combined.surfaceResults, artifactManifest);
    const selectedRuntimeSurfaces = (Array.isArray(requiredRuntimeSurfaces) ? requiredRuntimeSurfaces : [])
      .filter((surface) => canonicalSurfaces.includes(surface));
    const aggregate = aggregateRequiredSurfaces({
      requiredSurfaces: canonicalSurfaces,
      requiredRuntimeSurfaces: selectedRuntimeSurfaces,
      surfaceResults,
      acceptance: combined.acceptance,
      transportStatus,
      fullRelease: true,
    });
    return {
      ...combined,
      ...aggregate,
      schemaVersion: 2,
      stage: 'CONSUMER',
      verdict: combined.acceptance.verdict,
      acceptance: combined.acceptance,
      requiredSurfaces: canonicalSurfaces,
      requiredRuntimeSurfaces: selectedRuntimeSurfaces,
      surfaceResults: aggregate.surfaceResults,
      transportStatus,
      diagnostics: [
        ...diagnosticList(combined.diagnostics),
        ...surfaceResults.flatMap((row) => [...diagnosticList(row.reasons), ...diagnosticList(row.diagnostics)]),
        ...transportDiagnostics,
      ].slice(0, 50),
      ...(artifactManifest ? { artifactManifestFingerprint: artifactManifest.manifestFingerprint } : {}),
    };
  } catch (error) {
    const reason = sanitizeDiagnostics(`configured consumer evidence failed closed: ${error.message}`);
    const canonicalSurfaces = REQUIRED_SURFACES.filter((surface) => selectedSurfaces.includes(surface));
    const rawEvidence = canonicalizeClaudeConsumerEnvelope(payload, canonicalSurfaces);
    const rawSurfaceResults = Array.isArray(rawEvidence && rawEvidence.surfaceResults)
      ? rawEvidence.surfaceResults.map((row) => row && typeof row === 'object'
        ? receipts.redact({ ...row, producer: row.producer || 'consumer-gate' })
        : row)
      : [];
    return {
      schema: 'dhpk.harness.surface-aggregate.v1',
      requiredSurfaces: canonicalSurfaces,
      requiredRuntimeSurfaces: (Array.isArray(requiredRuntimeSurfaces) ? requiredRuntimeSurfaces : [])
        .filter((surface) => canonicalSurfaces.includes(surface)),
      fullRelease: true,
      surfaceResults: rawSurfaceResults,
      outcome: 'PUBLISHED_UNHEALTHY',
      exitCode: 1,
      transportStatus: 'FAIL',
      diagnostics: [reason],
      ...(artifactManifest ? { artifactManifestFingerprint: artifactManifest.manifestFingerprint } : {}),
    };
  }
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
  'cursor-plugin': Object.freeze({ gateSurface: 'cursor-plugin', producerSurface: 'cursor-plugin', adapterId: 'cursor-plugin-package-install' }),
  'agent-plugin': Object.freeze({ gateSurface: 'agent-plugin', producerSurface: 'agent-plugin', adapterId: 'agent-plugin-package-install' }),
  'agy-plugin': Object.freeze({ gateSurface: 'agy-plugin', producerSurface: 'agy-plugin', adapterId: 'agy-plugin-package-install' }),
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
    reason_code: runtimePreflight.reasonCodeForDiagnostic(status, reason),
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

function runNativeAgyConsumerProbe(root) {
  const script = path.join(root, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
  const command = `python3 -B skills/harness-govern/scripts/multi_ai_sync.py --root . validate --targets agy --agy-runtime-probe --format json`;
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
  const runtimeCapability = Array.isArray(platform.capabilities)
    ? platform.capabilities.find((entry) => entry && entry.id === 'agy.runtime.subagent')
    : null;
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
        ...(runtimeCapability && runtimeCapability.reason_code ? { reason_code: runtimeCapability.reason_code } : {}),
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

function runAgyProjectConsumerProbe(root) {
  const receiptPath = path.join(root, '.agents', '.dhpk-installed.json');
  const script = path.join(root, 'scripts', 'release', 'consumer-platform-probe.js');
  const command = `node scripts/release/consumer-platform-probe.js --platform agy-project --package-root <project-root> --execute`;
  const base = (status, reason, commands = [command]) => {
    const row = failedProbeRow(
      'agy-plugin',
      status,
      reason,
      root,
      commands,
      'project-agent-projection',
      'agy-project-direct-file',
    );
    return {
      outcome: row.status,
      diagnostics: row.reasons,
      surfaceResults: [row],
      identity: { surface: 'agy-plugin', stage: row.stage, producer: row.producer, adapter: row.adapter },
    };
  };
  let receiptStat = null;
  try { receiptStat = fs.lstatSync(receiptPath); } catch (error) {
    if (!error || error.code !== 'ENOENT') return base('BLOCKED', `AGY project receipt could not be inspected safely: ${error.message}`);
  }
  if (!receiptStat) return base('NOT_CONFIGURED', 'AGY project artifact receipt is not configured');
  if (receiptStat.isSymbolicLink() || !receiptStat.isFile()) return base('BLOCKED', 'AGY project artifact receipt is not a regular file');
  if (!allowsRealConsumerProbe()) {
    return base('NOT_CONFIGURED', 'AGY project runtime probe is opt-in outside CI; set DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE=1 on an isolated runner');
  }
  if (!fs.existsSync(script)) return base('BLOCKED', 'AGY project consumer probe script is unavailable');
  const child = spawnSync(process.execPath, [
    script,
    '--platform', 'agy-project',
    '--package-root', root,
    '--execute',
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
    payload = {
      status: 'FAIL',
      reason: `AGY project consumer probe emitted invalid JSON (exit ${child.status === null ? 127 : child.status})`,
      diagnostics: [child.stderr || child.stdout || 'no probe output'],
    };
  }
  if (child.error && child.error.code === 'ETIMEDOUT') payload = { ...payload, status: 'BLOCKED', reason: 'AGY project consumer probe timed out' };
  const normalized = normalizedProbeRow('agy-plugin', root, payload, child.status === null ? 127 : child.status, 'agy-plugin');
  const row = {
    ...normalized,
    producer: 'project-agent-projection',
    adapter: normalized.adapter || { id: 'agy-project-direct-file', version: '1.0.0' },
  };
  return {
    outcome: row.status,
    diagnostics: [...(row.reasons || []), ...(row.diagnostics || [])].slice(0, 20),
    surfaceResults: [row],
    identity: { surface: 'agy-plugin', stage: row.stage, producer: row.producer, adapter: row.adapter },
  };
}

function runAgyConsumerProbe(root) {
  const receiptPath = path.join(root, '.agents', '.dhpk-installed.json');
  try {
    const stat = fs.lstatSync(receiptPath);
    // A project receipt is the explicit authority for the relocatable route;
    // once present, an invalid receipt must surface as a project failure and
    // must not be hidden by the native-package fallback.
    if (stat) return runAgyProjectConsumerProbe(root);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return runAgyProjectConsumerProbe(root);
  }
  return runNativeAgyConsumerProbe(root);
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
  const adapter = PROBE_ADAPTERS[surface];
  const gateAdapter = CONSUMER_GATE_ADAPTERS[surface];
  const gateScript = path.join(root, 'scripts', 'release', 'consumer-gate.js');
  const legacyProbeFallback = Boolean(adapter && !parsed.currentAcceptance && !fs.existsSync(gateScript));
  if (parsed.currentAcceptance && (!gateAdapter || !fs.existsSync(gateScript))) {
    const reason = 'current consumer acceptance requires the canonical consumer gate';
    const row = failedProbeRow(
      surface,
      'FAIL',
      reason,
      root,
      [],
      'consumer-gate',
      gateAdapter ? gateAdapter.adapterId : 'consumer-gate',
    );
    return {
      schemaVersion: 2,
      stage: 'CONSUMER',
      outcome: 'FAIL',
      transportStatus: 'FAIL',
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
  if (gateAdapter && !legacyProbeFallback) {
    const version = releaseVersion(root);
    const args = [gateScript, '--repo-root', root, '--surface', gateAdapter.gateSurface];
    if (version) args.push('--version', version);
    const child = spawnConsumerGate(root, args, { maxBuffer: 4 * 1024 * 1024 });
    let payload;
    try {
      payload = JSON.parse(child.stdout || '{}');
    } catch (_) {
      payload = { status: 'FAIL', reason: `consumer gate emitted invalid JSON (exit ${child.status === null ? 127 : child.status})` };
    }
    if (hasCurrentConsumerEnvelope(payload)) {
      try {
        const canonicalized = canonicalizeClaudeConsumerEnvelope(payload, [surface]);
        const prepared = Array.isArray(canonicalized.surfaceResults)
          ? {
            ...canonicalized,
            surfaceResults: canonicalized.surfaceResults.map((entry) => entry && typeof entry === 'object'
              ? {
                ...entry,
                producer: entry.producer || 'consumer-gate',
                adapter: entry.adapter || { id: gateAdapter.adapterId, version: '1.0.0' },
                commands: normalizeProbeCommands(entry.commands, root),
              }
              : entry),
          }
          : canonicalized;
        const normalized = normalizeCurrentConsumerEnvelope(prepared, [surface]);
        if (normalized.surfaceResults.length !== 1 || normalized.surfaceResults[0].surface !== surface) {
          throw new Error(`consumer gate must emit exactly one '${surface}' observation`);
        }
        const acceptance = normalized.acceptance;
        const expectedExitCode = currentAcceptanceExitCode(acceptance.verdict);
        const transportDiagnostics = [];
        if (child.error) {
          transportDiagnostics.push(`consumer gate process failed: ${child.error.message}`);
        } else if (child.status !== expectedExitCode) {
          transportDiagnostics.push(
            `consumer gate acceptance '${acceptance.verdict}' requires exit ${expectedExitCode}, received ${child.status === null ? 'no exit code' : child.status}`,
          );
        }
        const row = normalized.surfaceResults[0];
        const diagnostics = [
          ...diagnosticList(normalized.diagnostics),
          ...diagnosticList(row.reasons),
          ...diagnosticList(row.diagnostics),
          ...transportDiagnostics,
        ].slice(0, 50);
        const transportStatus = transportDiagnostics.length > 0 ? 'FAIL' : 'PASS';
        return {
          ...normalized,
          outcome: transportStatus === 'FAIL' && acceptance.verdict === 'PASS' ? 'FAIL' : acceptance.verdict,
          transportStatus,
          diagnostics,
          surfaceResults: [row],
          identity: {
            surface,
            stage: row.stage,
            producer: row.producer || 'consumer-gate',
            adapter: row.adapter || { id: gateAdapter.adapterId, version: '1.0.0' },
          },
        };
      } catch (error) {
        const row = failedProbeRow(
          surface,
          'FAIL',
          `consumer gate current evidence is invalid: ${error.message}`,
          root,
          payload.commands,
          'consumer-gate',
          gateAdapter.adapterId,
        );
        return {
          schemaVersion: 2,
          stage: 'CONSUMER',
          outcome: 'FAIL',
          transportStatus: 'FAIL',
          diagnostics: [...row.reasons, ...row.diagnostics],
          surfaceResults: [row],
          identity: { surface, stage: row.stage, producer: row.producer, adapter: row.adapter },
        };
      }
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
  if (adapter.platform === 'cursor') {
    args.push('--inventory', path.join(root, 'manifests', 'distribution-inventory.json'));
  }
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

function runReleaseConsumerProbe(root, parsed) {
  return runConsumerProbe(root, { ...parsed, currentAcceptance: true });
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

function runReleaseProbes(root, requiredSurfaces, requiredRuntimeSurfacesOrExecutor, probeExecutor = runConsumerProbe, options = {}) {
  const legacyExecutorCall = typeof requiredRuntimeSurfacesOrExecutor === 'function';
  const requiredRuntimeSurfaces = legacyExecutorCall ? undefined : requiredRuntimeSurfacesOrExecutor;
  if (legacyExecutorCall) probeExecutor = requiredRuntimeSurfacesOrExecutor;
  if (probeExecutor && typeof probeExecutor === 'object') {
    options = probeExecutor;
    probeExecutor = runConsumerProbe;
  }
  const preflight = options && Object.prototype.hasOwnProperty.call(options, 'preflight')
    ? options.preflight
    : null;
  const preflightIdentity = preflight && typeof preflight === 'object' && preflight.identity
    ? preflight.identity
    : null;
  const identityErrors = [];
  if (preflight !== null) {
    const checkedPreflight = runtimePreflight.aggregatePreflight({
      preflight,
      expectedIdentity: options.expectedIdentity || null,
      requiredRuntimeSurfaces,
      surfaceResults: [],
    });
    if (checkedPreflight.diagnostics.length > 0) {
      identityErrors.push(...checkedPreflight.diagnostics.map((error) => `invalid preflight: ${error}`));
    }
  }
  if (preflight && preflightIdentity && options.expectedIdentity) {
    const checked = runtimePreflight.comparePreflightIdentity(options.expectedIdentity, preflightIdentity);
    if (!checked.ok) identityErrors.push(...checked.errors.map((error) => `foreign or stale preflight: ${error}`));
  }
  let batch = null;
  let batchProcessStatus = null;
  let batchProcessError = null;
  const requestedConcurrency = options && options.probeConcurrency !== undefined
    ? Number(options.probeConcurrency)
    : 1;
  const currentAcceptanceMode = probeExecutor === runReleaseConsumerProbe;
  const supportsBoundedBatch = probeExecutor === runConsumerProbe || currentAcceptanceMode;
  if (supportsBoundedBatch && Number.isSafeInteger(requestedConcurrency) && requestedConcurrency > 1) {
    const batchScript = path.join(root, 'scripts', 'release', 'parallel-consumer-probes.js');
    const batchArgs = [
      batchScript,
      '--repo-root', root,
      '--surfaces', requiredSurfaces.join(','),
      '--concurrency', String(requestedConcurrency),
      '--timeout-ms', String(options.probeTimeoutMs || 120000),
      '--task-id', options.taskId || 'release',
      '--attempt-id', options.attemptId || 'attempt',
    ];
    if (currentAcceptanceMode) batchArgs.push('--current-acceptance');
    const child = spawnSync(process.execPath, batchArgs, {
      cwd: root,
      env: options.runtimeEnv || process.env,
      encoding: 'utf8',
      timeout: (Number(options.probeTimeoutMs) || 120000) * requiredSurfaces.length,
      maxBuffer: 8 * 1024 * 1024,
    });
    batchProcessStatus = child.status;
    batchProcessError = child.error || null;
    try { batch = JSON.parse(child.stdout || '{}'); } catch (_) { batch = null; }
    if (!batch || !Array.isArray(batch.results)) {
      const reason = child.error && child.error.code === 'ETIMEDOUT'
        ? 'bounded consumer probe coordinator timed out'
        : `bounded consumer probe coordinator emitted invalid JSON (exit ${child.status === null ? 127 : child.status})`;
      batch = {
        schema: 'dhpk.release-consumer-probe-batch.v1',
        concurrency: requestedConcurrency,
        wallTimeMs: null,
        results: requiredSurfaces.map((surface) => ({
          surface,
          namespace: null,
          execution: {
            outcome: 'BLOCKED',
            surfaceResults: [failedProbeRow(surface, 'BLOCKED', reason, root, [], 'parallel-consumer-probes', 'parallel-consumer-probes')],
          },
        })),
      };
    }
  }
  const batchBySurface = new Map((batch && Array.isArray(batch.results) ? batch.results : [])
    .filter((entry) => entry && typeof entry.surface === 'string')
    .map((entry) => [entry.surface, entry]));
  const batchIdentityErrors = [];
  if (batch && Array.isArray(batch.results)) {
    const counts = new Map();
    for (const entry of batch.results) {
      if (!entry || typeof entry.surface !== 'string') {
        batchIdentityErrors.push('bounded consumer probe coordinator emitted a worker without a surface identity');
        continue;
      }
      counts.set(entry.surface, (counts.get(entry.surface) || 0) + 1);
      if (!requiredSurfaces.includes(entry.surface)) {
        batchIdentityErrors.push(`bounded consumer probe coordinator emitted foreign worker surface '${entry.surface}'`);
      }
    }
    for (const surface of requiredSurfaces) {
      const count = counts.get(surface) || 0;
      if (count === 0) batchIdentityErrors.push(`bounded consumer probe coordinator omitted worker surface '${surface}'`);
      else if (count !== 1) batchIdentityErrors.push(`bounded consumer probe coordinator emitted worker surface '${surface}' ${count} times`);
    }
  }
  const artifactBySurface = new Map((options.artifactManifest && Array.isArray(options.artifactManifest.packages)
    ? options.artifactManifest.packages
    : []).map((entry) => [entry.surface, entry]));
  const probeRecords = [];
  const surfaceResults = requiredSurfaces.map((surface) => {
    let execution;
    let probeNamespace = null;
    let workerTransportStatus = null;
    let workerDiagnostic = null;
    if (batch) {
      const entry = batchBySurface.get(surface);
      execution = entry && entry.execution;
      probeNamespace = entry && entry.namespace;
      workerTransportStatus = entry && entry.transportStatus;
      workerDiagnostic = entry && entry.diagnostic;
      if (!execution) {
        execution = {
          outcome: 'BLOCKED',
          surfaceResults: [failedProbeRow(surface, 'BLOCKED', 'bounded consumer probe coordinator omitted a required surface', root, [], 'parallel-consumer-probes', 'parallel-consumer-probes')],
        };
      }
    } else {
      try {
        execution = probeExecutor(root, { surface });
      } catch (error) {
        execution = {
          outcome: 'FAIL',
          surfaceResults: [failedProbeRow(surface, 'FAIL', `consumer probe failed before emitting evidence: ${error.message}`, root)],
        };
      }
    }
    probeRecords.push({ surface, execution, probeNamespace, workerTransportStatus, workerDiagnostic });
    if (hasCurrentConsumerEnvelope(execution)) {
      const firstRow = Array.isArray(execution.surfaceResults) ? execution.surfaceResults[0] : null;
      const artifactBinding = artifactBySurface.get(surface);
      return {
        ...(firstRow && typeof firstRow === 'object' ? firstRow : failedProbeRow(surface, 'FAIL', 'current consumer evidence omitted its surface observation', root)),
        ...(probeNamespace ? { probeNamespace } : {}),
        ...(artifactBinding ? { artifactBinding } : {}),
      };
    }
    const normalized = normalizeReleaseProbeResult(root, surface, execution);
    const rowIdentity = normalized.preflightIdentity
      || (execution && execution.preflightIdentity)
      || (execution && execution.preflight && execution.preflight.identity);
    if (preflightIdentity && rowIdentity) {
      const checked = runtimePreflight.comparePreflightIdentity(preflightIdentity, rowIdentity);
      if (!checked.ok) identityErrors.push(...checked.errors.map((error) => `consumer row '${surface}' has foreign preflight: ${error}`));
    }
    const artifactBinding = artifactBySurface.get(surface);
    return {
      ...normalized,
      ...(probeNamespace ? { probeNamespace } : {}),
      ...(artifactBinding ? { artifactBinding } : {}),
      ...(preflightIdentity ? { preflightIdentity: rowIdentity || preflightIdentity } : {}),
    };
  });
  const currentProtocol = probeRecords.some((record) => hasCurrentConsumerEnvelope(record.execution));
  if (currentProtocol) {
    const currentEnvelopes = [];
    const currentRows = new Map();
    const transportDiagnostics = [...batchIdentityErrors];
    let transportFailed = batchIdentityErrors.length > 0;
    try {
      for (const record of probeRecords) {
        if (!hasCurrentConsumerEnvelope(record.execution)) {
          throw new Error(`worker '${record.surface}' omitted current schema-v2 consumer evidence`);
        }
        const execution = {
          ...record.execution,
          ...(record.workerTransportStatus ? { transportStatus: record.workerTransportStatus } : {}),
        };
        const normalized = normalizeCurrentConsumerEnvelope(execution, [record.surface]);
        if (normalized.surfaceResults.length !== 1 || normalized.surfaceResults[0].surface !== record.surface) {
          throw new Error(`worker '${record.surface}' must emit exactly one matching observation`);
        }
        const rowIdentity = normalized.surfaceResults[0].preflightIdentity
          || execution.preflightIdentity
          || (execution.preflight && execution.preflight.identity);
        if (preflightIdentity && rowIdentity) {
          const checked = runtimePreflight.comparePreflightIdentity(preflightIdentity, rowIdentity);
          if (!checked.ok) identityErrors.push(...checked.errors.map((error) => `consumer row '${record.surface}' has foreign preflight: ${error}`));
        }
        currentEnvelopes.push(normalized);
        currentRows.set(record.surface, {
          ...normalized.surfaceResults[0],
          ...(record.probeNamespace ? { probeNamespace: record.probeNamespace } : {}),
          ...(artifactBySurface.has(record.surface) ? { artifactBinding: artifactBySurface.get(record.surface) } : {}),
          ...(preflightIdentity ? { preflightIdentity: rowIdentity || preflightIdentity } : {}),
        });
        if (record.workerTransportStatus === 'FAIL' || execution.transportStatus === 'FAIL' || record.workerDiagnostic) {
          transportFailed = true;
          transportDiagnostics.push(...diagnosticList(record.workerDiagnostic));
          if ((record.workerTransportStatus === 'FAIL' || execution.transportStatus === 'FAIL') && !record.workerDiagnostic) {
            transportDiagnostics.push(`worker '${record.surface}' transport failed after emitting evidence`);
          }
        }
      }

      const combined = combineConsumerEvidence(currentEnvelopes, requiredSurfaces);
      if (batch) {
        const expectedStatus = combined.acceptance.verdict === 'PASS' && !transportFailed ? 0 : 1;
        if (batchProcessError) {
          transportFailed = true;
          transportDiagnostics.push(`bounded consumer probe coordinator failed: ${batchProcessError.message}`);
        } else if (batchProcessStatus !== expectedStatus) {
          transportFailed = true;
          transportDiagnostics.push(
            `bounded consumer probe coordinator acceptance '${combined.acceptance.verdict}' requires exit ${expectedStatus}, received ${batchProcessStatus === null ? 'no exit code' : batchProcessStatus}`,
          );
        }
      }
      const transportStatus = transportFailed ? 'FAIL' : 'PASS';
      const orderedRows = requiredSurfaces.map((surface) => currentRows.get(surface));
      const aggregate = aggregateRequiredSurfaces({
        requiredSurfaces,
        requiredRuntimeSurfaces: Array.isArray(requiredRuntimeSurfaces)
          ? requiredRuntimeSurfaces.filter((surface) => requiredSurfaces.includes(surface))
          : undefined,
        surfaceResults: orderedRows,
        acceptance: combined.acceptance,
        transportStatus,
        fullRelease: true,
      });
      const rowDiagnostics = orderedRows.flatMap((entry) => [
        ...diagnosticList(entry.reasons),
        ...diagnosticList(entry.diagnostics),
      ]);
      let outcome = aggregate.outcome;
      let exitCode = aggregate.exitCode;
      if (identityErrors.length > 0) {
        outcome = 'BLOCKED';
        exitCode = combined.acceptance.verdict === 'PASS' ? exitCodeForOutcome(outcome) : 1;
      } else if (preflight && preflight.status !== 'PASS' && outcome === 'COMPLETE') {
        outcome = preflight.status === 'BLOCKED' ? 'BLOCKED' : 'PUBLISHED_PENDING';
        exitCode = exitCodeForOutcome(outcome);
      }
      return {
        ...combined,
        ...aggregate,
        schemaVersion: 2,
        stage: 'CONSUMER',
        verdict: combined.acceptance.verdict,
        acceptance: combined.acceptance,
        surfaceResults: orderedRows,
        outcome,
        exitCode,
        ...(preflight ? { preflight, runnerCapabilities: preflight.runner } : {}),
        ...(batch ? {
          probeExecution: {
            mode: 'bounded-child-processes',
            concurrency: batch.concurrency,
            timeoutMs: batch.timeoutMs,
            wallTimeMs: batch.wallTimeMs,
            namespaces: orderedRows.map((entry) => entry.probeNamespace || null),
          },
        } : {}),
        ...(options.artifactManifest ? { artifactManifestFingerprint: options.artifactManifest.manifestFingerprint } : {}),
        transportStatus,
        diagnostics: [...identityErrors, ...transportDiagnostics, ...rowDiagnostics].slice(0, 50),
      };
    } catch (error) {
      const reason = `current consumer evidence failed closed: ${error.message}`;
      return {
        schema: 'dhpk.harness.surface-aggregate.v1',
        requiredSurfaces: [...requiredSurfaces],
        requiredRuntimeSurfaces: Array.isArray(requiredRuntimeSurfaces)
          ? requiredRuntimeSurfaces.filter((surface) => requiredSurfaces.includes(surface))
          : [],
        fullRelease: true,
        surfaceResults,
        outcome: 'PUBLISHED_UNHEALTHY',
        exitCode: 1,
        transportStatus: 'FAIL',
        ...(preflight ? { preflight, runnerCapabilities: preflight.runner } : {}),
        diagnostics: [...identityErrors, ...transportDiagnostics, reason].slice(0, 50),
      };
    }
  }
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
  let outcome = aggregate.outcome;
  if (identityErrors.length > 0) outcome = 'BLOCKED';
  else if (preflight && preflight.status !== 'PASS' && outcome === 'COMPLETE') {
    outcome = preflight.status === 'BLOCKED' ? 'BLOCKED' : 'PUBLISHED_PENDING';
  }
  if (batch && (batchProcessError || batchProcessStatus !== 0) && outcome === 'COMPLETE') {
    outcome = 'PUBLISHED_PENDING';
  }
  const coordinatorDiagnostics = batch && (batchProcessError || batchProcessStatus !== 0)
    ? [batchProcessError
      ? `bounded consumer probe coordinator failed: ${batchProcessError.message}`
      : `bounded consumer probe coordinator emitted valid evidence but exited ${batchProcessStatus === null ? 'without a status' : batchProcessStatus}`]
    : [];
  const allDiagnostics = [...identityErrors, ...coordinatorDiagnostics, ...diagnostics].slice(0, 50);
  return {
    ...aggregate,
    outcome,
    exitCode: exitCodeForOutcome(outcome),
    ...(preflight ? { preflight, runnerCapabilities: preflight.runner } : {}),
    ...(batch ? {
      probeExecution: {
        mode: 'bounded-child-processes',
        concurrency: batch.concurrency,
        timeoutMs: batch.timeoutMs,
        wallTimeMs: batch.wallTimeMs,
        namespaces: surfaceResults.map((entry) => entry.probeNamespace || null),
      },
    } : {}),
    ...(options.artifactManifest ? { artifactManifestFingerprint: options.artifactManifest.manifestFingerprint } : {}),
    diagnostics: allDiagnostics,
  };
}

function phaseExecution(root, parsed, inventory, binding, runtimeEnv = process.env) {
  if (parsed.phase === 'test') return runBoundedTest(root, parsed.testFile);
  if (parsed.phase === 'generate' || parsed.phase === 'validate' || parsed.phase === 'verify') return runDistribution(root, parsed, binding);
  if (parsed.phase === 'probe') return runConsumerProbe(root, parsed);
  if (parsed.phase === 'release') {
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    if (required.errors.length > 0) return { outcome: 'BLOCKED', diagnostics: required.errors.slice(0, 20) };
    let requirementsScope = null;
    try {
      requirementsScope = parsed.requirementsScope || null;
    } catch (error) {
      return { outcome: 'BLOCKED', diagnostics: [sanitizeDiagnostics(`release requirements are invalid: ${error.message}`)] };
    }
    const declaredSurfaces = requirementsScope
      ? requirementsScope.selectedSurfaces
      : (Array.isArray(parsed.surfaces) ? parsed.surfaces : null);
    let selectedSurfaces = declaredSurfaces || [];
    let selectedRuntimeSurfaces = declaredSurfaces
      ? required.requiredRuntimeSurfaces.filter((surface) => declaredSurfaces.includes(surface))
      : [];
    const createPreflight = () => runtimePreflight.preflightForCheckout({
      root,
      env: runtimeEnv,
      identity: {
        taskId: parsed.taskId,
        attemptId: parsed.attemptId,
        sourceCommit: binding.sourceCommit,
        sourceTree: binding.sourceTree,
        targetCommit: binding.targetCommit,
        targetTree: binding.targetTree,
        worktree: binding.dirty ? 'DIRTY' : 'CLEAN',
        selectedSurfaces,
        requiredRuntimeSurfaces: selectedRuntimeSurfaces,
      },
    });
    let preflight = null;
    let artifactManifest = null;
    const artifactManifestPath = runtimeEnv.DHPK_RELEASE_ARTIFACT_MANIFEST;
    if (artifactManifestPath) {
      try {
        artifactManifest = JSON.parse(fs.readFileSync(path.resolve(artifactManifestPath), 'utf8'));
      } catch (error) {
        return { outcome: 'BLOCKED', diagnostics: [`release artifact manifest is unreadable: ${error.message}`] };
      }
      const checkedManifest = releaseArtifactManifest.validateReleaseArtifactManifest(artifactManifest, {
        root,
        targetCommit: binding.targetCommit,
        targetTree: binding.targetTree,
        expectedRunId: runtimeEnv.GITHUB_RUN_ID || null,
        expectedVersion: releaseVersion(root),
      });
      if (!checkedManifest.ok) {
        return { outcome: 'BLOCKED', diagnostics: checkedManifest.errors.slice(0, 20) };
      }
      artifactManifest = checkedManifest.manifest;
    }
    let release;
    if (requirementsScope) {
      const evidence = runRequirementsConsumerGate(root, requirementsScope, selectedSurfaces, artifactManifest);
      const runtimeScope = selectedRuntimeSurfaces.length > 0 ? selectedRuntimeSurfaces : undefined;
      const aggregate = evidence.acceptance
        ? aggregateRequiredSurfaces({
          requiredSurfaces: selectedSurfaces,
          requiredRuntimeSurfaces: runtimeScope,
          surfaceResults: evidence.surfaceResults,
          acceptance: evidence.acceptance,
          transportStatus: evidence.transportStatus || 'FAIL',
          fullRelease: true,
        })
        : {
          schema: 'dhpk.harness.surface-aggregate.v1',
          requiredSurfaces: [...selectedSurfaces],
          requiredRuntimeSurfaces: runtimeScope || [],
          fullRelease: true,
          surfaceResults: evidence.surfaceResults,
          outcome: 'PUBLISHED_UNHEALTHY',
          exitCode: 1,
        };
      release = {
        ...evidence,
        ...aggregate,
        ...(evidence.schemaVersion === 2 ? { schemaVersion: 2, stage: 'CONSUMER' } : {}),
        ...(evidence.acceptance ? { verdict: evidence.acceptance.verdict, acceptance: evidence.acceptance } : {}),
        requiredSurfaces: [...selectedSurfaces],
        requiredRuntimeSurfaces: runtimeScope || [],
        surfaceResults: aggregate.surfaceResults,
      };
    } else if (Array.isArray(parsed.surfaces)) {
      release = runReleaseProbes(root, selectedSurfaces, selectedRuntimeSurfaces, runReleaseConsumerProbe, {
        artifactManifest,
        probeConcurrency: runtimeEnv.DHPK_HARNESS_RELEASE_PROBE_CONCURRENCY || 1,
        probeTimeoutMs: runtimeEnv.DHPK_HARNESS_RELEASE_PROBE_TIMEOUT_MS || 120000,
        taskId: parsed.taskId,
        attemptId: parsed.attemptId,
        runtimeEnv,
      });
    } else {
      release = runConfiguredConsumerGate(root, required.requiredRuntimeSurfaces, artifactManifest);
      selectedSurfaces = Array.isArray(release.requiredSurfaces) ? release.requiredSurfaces : [];
      selectedRuntimeSurfaces = Array.isArray(release.requiredRuntimeSurfaces)
        ? release.requiredRuntimeSurfaces
        : [];
    }
    const currentRelease = Boolean(release && (release.acceptance
      || release.schemaVersion === 2
      || release.transportStatus));
    const preflightDiagnostics = [];
    if (!currentRelease) {
      preflight = createPreflight();
      const checkedPreflight = runtimePreflight.aggregatePreflight({
        preflight,
        expectedIdentity: preflight.identity,
        requiredRuntimeSurfaces: selectedRuntimeSurfaces,
        surfaceResults: Array.isArray(release.surfaceResults) ? release.surfaceResults : [],
      });
      preflightDiagnostics.push(...checkedPreflight.diagnostics.map((error) => `invalid preflight: ${error}`));
      for (const row of Array.isArray(release.surfaceResults) ? release.surfaceResults : []) {
        const rowIdentity = row && (row.preflightIdentity || (row.preflight && row.preflight.identity));
        if (!rowIdentity) continue;
        const checked = runtimePreflight.comparePreflightIdentity(preflight.identity, rowIdentity);
        if (!checked.ok) {
          preflightDiagnostics.push(...checked.errors.map((error) => `consumer row '${row.surface}' has foreign preflight: ${error}`));
        }
      }
    }
    const blockedByPreflight = preflight
      && ['BLOCKED', 'UNAVAILABLE', 'FAIL'].includes(preflight.status);
    const outcome = preflightDiagnostics.length > 0
      ? 'BLOCKED'
      : (blockedByPreflight && release.outcome === 'COMPLETE'
        ? (preflight.status === 'BLOCKED' ? 'BLOCKED' : 'PUBLISHED_PENDING')
        : release.outcome);
    return {
      ...release,
      outcome,
      exitCode: outcome === release.outcome ? release.exitCode : exitCodeForOutcome(outcome),
      ...(preflight ? { preflight, runnerCapabilities: preflight.runner, identity: preflight.identity } : {}),
      ...(release.probeExecution ? { probeExecution: release.probeExecution } : {}),
      ...(release.artifactManifestFingerprint ? { artifactManifestFingerprint: release.artifactManifestFingerprint } : {}),
      diagnostics: [
        ...(Array.isArray(release.diagnostics) ? release.diagnostics : []),
        ...preflightDiagnostics,
        ...(preflight && Array.isArray(preflight.diagnostics) ? preflight.diagnostics : []),
      ].slice(0, 50),
    };
  }
  if (parsed.phase === 'preflight') {
    const errors = [];
    if (binding && binding.dirty) errors.push('working tree is dirty; exact release checkout cannot be proven');
    const v2 = inventoryApi.validateDistributionInventoryV2({ inventory });
    errors.push(...v2.errors);
    const required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    errors.push(...required.errors);
    const selectedSurfaces = parsed.surfaces || required.requiredSurfaces;
    if (selectedSurfaces.some((surface) => !REQUIRED_SURFACES.includes(surface))) {
      errors.push('selected preflight surfaces contain an unknown surface');
    }
    if (selectedSurfaces.length !== required.requiredSurfaces.length
      || selectedSurfaces.some((surface, index) => surface !== required.requiredSurfaces[index])) {
      errors.push('full-release preflight must use the canonical required surface list');
    }
    const identity = {
      taskId: parsed.taskId,
      attemptId: parsed.attemptId,
      sourceCommit: parsed.sourceCommit || binding.sourceCommit,
      sourceTree: parsed.sourceTree || binding.sourceTree,
      targetCommit: parsed.targetCommit || binding.targetCommit,
      targetTree: parsed.targetTree || binding.targetTree,
      worktree: binding.dirty ? 'DIRTY' : 'CLEAN',
      selectedSurfaces,
      requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
    };
    for (const field of ['sourceCommit', 'sourceTree', 'targetCommit', 'targetTree']) {
      if (identity[field] !== binding[field]) errors.push(`${field} does not match current checkout`);
    }
    const readiness = runtimePreflight.preflightForCheckout({ root, env: runtimeEnv, identity });
    const preflight = errors.length > 0
      ? runtimePreflight.createPreflightResult({
        identity,
        status: 'BLOCKED',
        runner: readiness.runner,
        surfaces: readiness.surfaces,
        diagnostics: errors,
        reasonCode: 'IDENTITY_INVALID',
      })
      : readiness;
    return {
      outcome: preflight.status,
      diagnostics: [...(preflight.diagnostics || []), ...(preflight.errors || [])].slice(0, 20),
      requiredSurfaces: required.requiredSurfaces,
      requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
      selectedSurfaces,
      preflight,
      runnerCapabilities: preflight.runner,
      identity: preflight.identity,
    };
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
  const intent = {
    phase: parsed.phase,
    surface: parsed.surface || null,
    testFile: parsed.testFile || null,
  };
  if (Array.isArray(parsed.surfaces)) intent.surfaces = [...parsed.surfaces];
  if (parsed.requirementsScope) {
    intent.requirementsDigest = parsed.requirementsScope.digest;
    intent.requirementsSurfaces = [...parsed.requirementsScope.selectedSurfaces];
  }
  return intent;
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
  if (requested.surfaces !== undefined || requested.requirementsDigest !== undefined) {
    throw blockedHandoffError('operation key replay cannot prove the original surface scope or requirements from a legacy receipt');
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
    ...(envelope.preflight ? { preflight: envelope.preflight } : {}),
    ...(envelope.runnerCapabilities ? { runnerCapabilities: envelope.runnerCapabilities } : {}),
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
    if (parsed.requirementsFile) {
      try {
        parsed.requirementsScope = consumerRequirementsScope(root, parsed.requirementsFile);
      } catch (error) {
        throw blockedHandoffError(sanitizeDiagnostics(`release requirements are invalid: ${error.message}`));
      }
    }
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
        return restoreConsumerEvidenceReplay(
          replayAttempt(parsed.phase, { ...existing, envelope: checked.envelope }, parsed),
          checked.envelope,
        );
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
    parsed.taskId = taskId;
    parsed.attemptId = attemptId;
    let execution = phaseExecutor(root, parsed, inventory, binding, env);
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
      ...(execution.preflight ? { preflight: execution.preflight } : {}),
      ...(execution.runnerCapabilities ? { runnerCapabilities: execution.runnerCapabilities } : {}),
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
      consumerEvidence: consumerEvidenceForExecution(execution) || undefined,
      identity: {
        ...receiptIdentity,
        operationIntent: operationIntent(parsed),
        preflight: execution.preflight || null,
        runnerCapabilities: execution.runnerCapabilities || null,
        ...(execution.artifactManifestFingerprint ? { artifactManifestFingerprint: execution.artifactManifestFingerprint } : {}),
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
      ...(execution.acceptance ? { schema: 'dhpk.harness.result.v2', acceptance: execution.acceptance } : {}),
      ...(execution.transportStatus ? { transportStatus: execution.transportStatus } : {}),
      ...(execution.preflight ? { preflight: execution.preflight } : {}),
      ...(execution.runnerCapabilities ? { runnerCapabilities: execution.runnerCapabilities } : {}),
      ...(execution.probeExecution ? { probeExecution: execution.probeExecution } : {}),
      ...(execution.artifactManifestFingerprint ? { artifactManifestFingerprint: execution.artifactManifestFingerprint } : {}),
    });
    receipts.appendEvent(attempt, {
      command: result.resumeCommand,
      lifecyclePhase: result.lifecyclePhase,
      outcome: result.outcome,
      diagnostics: result.diagnostics,
      artifacts: result.artifacts,
      preflight: result.preflight || null,
      byteReferences: execution.byteReferences || [],
      resumeCommand: result.resumeCommand,
    });
    if (execution && execution.acceptance) {
      const passEffective = execution.acceptance.verdict === 'PASS'
        && ['PASS', 'COMPLETE'].includes(result.outcome)
        && execution.transportStatus !== 'FAIL';
      result.exitCode = passEffective ? 0 : 1;
    } else if (execution && execution.transportStatus === 'FAIL' && execution.exitCode === 1) {
      result.exitCode = 1;
    } else {
      result.exitCode = exitCodeForOutcome(result.outcome);
    }
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
  runConsumerProbe,
};
