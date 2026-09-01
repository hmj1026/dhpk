#!/usr/bin/env node
'use strict';

// Controlled local runner for Issue #237's consumer-runtime proof.  The
// runner is intentionally a thin orchestration boundary: preflight owns
// capability/session readiness, the public harness owns consumer probes and
// append-only receipts, and this command only decides whether that evidence
// satisfies the exact-head release contract.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const inventoryApi = require('../lib/distribution-inventory');
const preflightApi = require('../lib/consumer-runtime-preflight');
const receipts = require('../lib/harness-receipt');

const RUNNER_SCHEMA = 'dhpk.issue-237.runtime-proof.v1';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECEIPT_FILE = 'runtime-proof.json';
const CURSOR_SYNC_STATUSES = new Set(['PASS', 'NOT_RUN']);
const SESSION_ROOT_PREFIX = 'dhpk-runtime-proof-home-';

function parseArgs(argv = []) {
  if (!Array.isArray(argv)) throw new Error('usage: arguments must be an array');
  const parsed = { root: process.cwd(), json: false };
  const valueOptions = new Map([
    ['--root', 'root'],
    ['--receipt-root', 'receiptRoot'],
    ['--task-id', 'taskId'],
    ['--attempt-id', 'attemptId'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (valueOptions.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`option value is required for '${arg}'`);
      parsed[valueOptions.get(arg)] = value;
    } else {
      throw new Error(`unknown argument '${String(arg).slice(0, 120)}'`);
    }
  }
  if (parsed.help) return parsed;
  if (!parsed.taskId || !SAFE_ID.test(parsed.taskId)) throw new Error('--task-id is required and must be a safe identifier');
  if (!parsed.attemptId || !SAFE_ID.test(parsed.attemptId)) throw new Error('--attempt-id is required and must be a safe identifier');
  return parsed;
}

function usage() {
  return 'usage: issue-237-runtime-proof.js --root <clean-checkout> --receipt-root <dir> --task-id <id> --attempt-id <id> [--json]';
}

function exitCodeForOutcome(outcome) {
  if (outcome === 'COMPLETE' || outcome === 'PASS') return 0;
  if (outcome === 'FAIL' || outcome === 'PUBLISHED_UNHEALTHY') return 1;
  if (outcome === 'USAGE') return 64;
  if (outcome === 'INTERNAL_ERROR') return 70;
  return 2;
}

function isWithin(parent, candidate) {
  const base = path.resolve(parent);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function resolveReceiptRoot(root, requested) {
  const receiptRoot = path.resolve(requested || path.join(root, '.dhpk', 'artifacts', 'receipts'));
  const allowed = [
    path.resolve(os.tmpdir()),
    path.resolve(path.join(root, '.dhpk', 'artifacts', 'receipts')),
  ];
  if (!allowed.some((candidate) => isWithin(candidate, receiptRoot))) {
    throw new Error('receipt root must be under the system temporary directory or .dhpk/artifacts/receipts');
  }
  return receiptRoot;
}

function writeImmutableJson(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    // Hard-link creation is an atomic exclusive claim on POSIX filesystems;
    // unlike existsSync()+renameSync(), it cannot replace a prior proof.
    fs.linkSync(temporary, file);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(`runtime proof receipt: refusing to overwrite '${path.basename(file)}'`);
    }
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* already cleaned */ }
  }
  const directoryFd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  return file;
}

function redacted(value) {
  return receipts.redact(value);
}

function boundedDiagnostics(values) {
  const list = Array.isArray(values) ? values : [values];
  return list
    .filter((value) => value !== undefined && value !== null)
    .slice(0, 50)
    .map((value) => preflightApi.boundedDiagnostic(value))
    .filter(Boolean);
}

function exactList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

function identityFor(binding, worktree, required, taskId, attemptId) {
  return {
    taskId,
    attemptId,
    sourceCommit: binding.sourceCommit,
    sourceTree: binding.sourceTree,
    targetCommit: binding.sourceCommit,
    targetTree: binding.sourceTree,
    worktree,
    selectedSurfaces: required.requiredSurfaces,
    requiredRuntimeSurfaces: required.requiredRuntimeSurfaces,
  };
}

function createDisposableRuntimeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), SESSION_ROOT_PREFIX));
  // Cursor and AGY adapters each clone their own allowlisted session files
  // into a per-probe HOME. Keeping this outer HOME empty prevents a second
  // secret-bearing copy that no adapter would consume.
  return { home };
}

function sanitizeSurfaceResults(results) {
  if (!Array.isArray(results)) return [];
  return results.slice(0, 20).map((entry) => redacted(entry));
}

function runnerReceiptPath(receiptRoot, taskId, attemptId) {
  return path.join(receiptRoot, taskId, attemptId, RECEIPT_FILE);
}

function summarizeHarness(harness, receiptRoot) {
  if (!harness || typeof harness !== 'object' || Array.isArray(harness)) return null;
  const summary = {};
  for (const field of ['schema', 'phase', 'lifecyclePhase', 'outcome', 'status', 'exitCode', 'sourceCommit', 'sourceTree', 'targetCommit', 'targetTree', 'worktree']) {
    if (harness[field] !== undefined && harness[field] !== null) summary[field] = harness[field];
  }
  if (typeof harness.receiptReference === 'string') {
    const reference = path.resolve(harness.receiptReference);
    summary.receiptReference = isWithin(receiptRoot, reference)
      ? path.relative(receiptRoot, reference).split(path.sep).join('/')
      : '<receipt>';
  }
  return redacted(summary);
}

function makeResult({
  identity,
  required,
  outcome,
  diagnostics = [],
  preflight = null,
  surfaceResults = [],
  harness = null,
  receiptRoot = null,
  runnerReceiptReference = null,
} = {}) {
  const payload = {
    schema: RUNNER_SCHEMA,
    phase: 'runtime-proof',
    outcome,
    status: outcome,
    exitCode: exitCodeForOutcome(outcome),
    runtimePromoted: outcome === 'COMPLETE',
    identity: identity || null,
    requiredSurfaces: required && required.requiredSurfaces ? required.requiredSurfaces : [],
    requiredRuntimeSurfaces: required && required.requiredRuntimeSurfaces ? required.requiredRuntimeSurfaces : [],
    surfaceResults: sanitizeSurfaceResults(surfaceResults),
    diagnostics: boundedDiagnostics(diagnostics),
    ...(preflight ? { preflight: redacted(preflight) } : {}),
    ...(harness ? { harness: summarizeHarness(harness, receiptRoot) } : {}),
    ...(runnerReceiptReference ? { runnerReceiptReference } : {}),
  };
  return payload;
}

function persistRunnerReceipt(receiptRoot, payload) {
  const file = runnerReceiptPath(receiptRoot, payload.identity.taskId, payload.identity.attemptId);
  const receipt = redacted({
    ...payload,
    receiptReference: `${payload.identity.taskId}/${payload.identity.attemptId}/${RECEIPT_FILE}`,
    recordedAt: new Date().toISOString(),
  });
  writeImmutableJson(file, receipt);
  return `${payload.identity.taskId}/${payload.identity.attemptId}/${RECEIPT_FILE}`;
}

function validateReleaseEvidence({ root, binding, required, expectedPreflight, payload } = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['harness release emitted no JSON result'];
  }
  if (payload.phase !== 'release') errors.push('harness result phase is not release');
  if (payload.outcome !== 'COMPLETE') errors.push(`harness release outcome is '${String(payload.outcome || '<missing>')}', not COMPLETE`);
  if (!exactList(payload.requiredSurfaces, required.requiredSurfaces)) errors.push('harness required surface list is not canonical');
  if (!exactList(payload.requiredRuntimeSurfaces, required.requiredRuntimeSurfaces)) errors.push('harness required runtime surface list is not canonical');
  if (!Array.isArray(payload.surfaceResults)) errors.push('harness surface results are missing');
  const results = Array.isArray(payload.surfaceResults) ? payload.surfaceResults : [];
  const seen = new Set();
  for (const row of results) {
    if (!row || typeof row.surface !== 'string') {
      errors.push('harness surface result identity is invalid');
      continue;
    }
    if (seen.has(row.surface)) errors.push(`harness emitted duplicate surface '${row.surface}'`);
    seen.add(row.surface);
  }
  for (const surface of required.requiredSurfaces) {
    if (!seen.has(surface)) errors.push(`harness omitted required surface '${surface}'`);
  }
  const bySurface = new Map(results.filter((row) => row && typeof row.surface === 'string').map((row) => [row.surface, row]));
  for (const surface of required.requiredRuntimeSurfaces) {
    if (!bySurface.has(surface) || bySurface.get(surface).status !== 'PASS') {
      errors.push(`required runtime surface '${surface}' is not PASS`);
    }
  }
  const cursorSync = bySurface.get('cursor-sync');
  if (cursorSync && !CURSOR_SYNC_STATUSES.has(cursorSync.status)) {
    errors.push(`cursor-sync status '${String(cursorSync.status)}' is neither PASS nor NOT_RUN`);
  }
  if (!payload.preflight || payload.preflight.status !== 'PASS') errors.push('harness release preflight is not PASS');
  if (payload.preflight && expectedPreflight) {
    const compared = preflightApi.comparePreflightIdentity(expectedPreflight.identity, payload.preflight.identity);
    if (!compared.ok) errors.push(...compared.errors.map((error) => `harness preflight identity: ${error}`));
  }
  const expected = {
    sourceCommit: binding.sourceCommit,
    sourceTree: binding.sourceTree,
    targetCommit: binding.targetCommit || binding.sourceCommit,
    targetTree: binding.targetTree || binding.sourceTree,
    worktree: 'CLEAN',
  };
  for (const field of Object.keys(expected)) {
    if (!payload[field] || String(payload[field]).toLowerCase() !== String(expected[field]).toLowerCase()) {
      errors.push(`harness ${field} does not match exact checkout`);
    }
  }
  try {
    const after = receipts.resolveGitBinding(root);
    const afterWorktree = receipts.resolveGitWorktree(root);
    if (after.sourceCommit !== binding.sourceCommit || after.sourceTree !== binding.sourceTree) errors.push('target checkout changed during runtime proof');
    if (afterWorktree !== 'CLEAN') errors.push('target checkout became DIRTY during runtime proof');
  } catch (error) {
    errors.push(`target checkout cannot be revalidated: ${error.message}`);
  }
  return errors;
}

function parseHarnessOutput(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error(`harness release must emit one JSON line; received ${lines.length}`);
  return JSON.parse(lines[0]);
}

function invokeHarness(root, receiptRoot, identity, env, runner = spawnSync) {
  const command = path.join(root, 'bin', 'dhpk');
  if (!fs.existsSync(command)) throw new Error('public bin/dhpk entrypoint is unavailable in the exact checkout');
  const args = [
    command,
    'harness',
    'release',
    '--json',
    '--task-id', identity.taskId,
    '--attempt-id', identity.attemptId,
    '--receipt-root', receiptRoot,
  ];
  const child = runner('bash', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...env,
      DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE: '1',
      DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
    },
  });
  if (child.error) throw child.error;
  return {
    status: child.status === null || child.status === undefined ? 70 : child.status,
    stdout: String(child.stdout || ''),
    stderr: preflightApi.boundedDiagnostic(child.stderr || ''),
  };
}

function validateHarnessReceipt(root, receiptRoot, payload, binding) {
  if (typeof payload.receiptReference !== 'string' || !payload.receiptReference) return ['harness receipt reference is missing'];
  const reference = path.resolve(payload.receiptReference);
  if (!isWithin(receiptRoot, reference)) return ['harness receipt reference escapes the requested receipt root'];
  const checked = receipts.validateReceipt(reference, {
    root,
    expectedSourceCommit: binding.sourceCommit,
    expectedSourceTree: binding.sourceTree,
  });
  if (!checked.ok) return checked.errors.slice(0, 20).map((error) => `harness receipt: ${error}`);
  if (payload.outcome === 'COMPLETE' && (!checked.lastEvent || checked.lastEvent.outcome !== 'COMPLETE')) {
    return ['harness receipt has no terminal COMPLETE event'];
  }
  return [];
}

function execute(argv = process.argv.slice(2), {
  env = process.env,
  runner = spawnSync,
} = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    if (parsed.help) return { status: 0, payload: { schema: RUNNER_SCHEMA, usage: usage() } };
  } catch (error) {
    return {
      status: 64,
      payload: { schema: RUNNER_SCHEMA, phase: 'runtime-proof', outcome: 'USAGE', status: 'USAGE', exitCode: 64, runtimePromoted: false, diagnostics: [preflightApi.boundedDiagnostic(error.message)] },
    };
  }

  let root;
  let receiptRoot;
  let identity;
  let required;
  let preflight;
  let disposableHome = null;
  try {
    root = fs.realpathSync(path.resolve(parsed.root));
    receiptRoot = resolveReceiptRoot(root, parsed.receiptRoot);
    const binding = receipts.resolveGitBinding(root);
    const worktree = receipts.resolveGitWorktree(root);
    const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
    required = inventoryApi.validateRequiredSurfacePlan({ inventory, fullRelease: true });
    if (!required.ok || !required.requiredSurfaces || !required.requiredRuntimeSurfaces) {
      throw new Error(`canonical release surface plan is invalid${required.errors.length ? `: ${required.errors.slice(0, 5).join('; ')}` : ''}`);
    }
    identity = identityFor({ ...binding, targetCommit: binding.sourceCommit, targetTree: binding.sourceTree }, worktree, required, parsed.taskId, parsed.attemptId);
    disposableHome = createDisposableRuntimeHome();
    const runnerEnv = {
      ...env,
      // Consumer probes must use a disposable HOME.  Host session paths remain
      // explicit inputs for allowlisted copying and are never serialized.
      HOME: disposableHome.home,
      USERPROFILE: disposableHome.home,
      XDG_CONFIG_HOME: path.join(disposableHome.home, 'config'),
      XDG_DATA_HOME: path.join(disposableHome.home, 'data'),
      XDG_CACHE_HOME: path.join(disposableHome.home, 'cache'),
      CODEX_HOME: path.join(disposableHome.home, 'codex'),
    };
    preflight = preflightApi.preflightForCheckout({ root, env: runnerEnv, identity });
    if (worktree !== 'CLEAN') {
      preflight.status = 'BLOCKED';
      preflight.outcome = 'BLOCKED';
      preflight.reasonCode = 'WORKTREE_DIRTY';
      preflight.diagnostics = [...(preflight.diagnostics || []), 'exact-head runtime proof requires a CLEAN worktree'].slice(0, 20);
    }
    if (preflight.status !== 'PASS') {
      const payload = makeResult({
        identity,
        required,
        outcome: preflight.status,
        diagnostics: preflight.diagnostics,
        preflight,
      });
      const runnerReceiptReference = persistRunnerReceipt(receiptRoot, payload);
      payload.runnerReceiptReference = runnerReceiptReference;
      return { status: exitCodeForOutcome(payload.outcome), payload };
    }

    const child = invokeHarness(root, receiptRoot, identity, runnerEnv, runner);
    let harnessPayload;
    try {
      harnessPayload = parseHarnessOutput(child.stdout);
    } catch (error) {
      const payload = makeResult({
        identity,
        required,
        outcome: 'FAIL',
        diagnostics: [error.message, child.stderr],
        preflight,
        harness: { exitCode: child.status },
        receiptRoot,
      });
      const runnerReceiptReference = persistRunnerReceipt(receiptRoot, payload);
      payload.runnerReceiptReference = runnerReceiptReference;
      return { status: 1, payload };
    }
    const evidenceErrors = validateReleaseEvidence({
      root,
      binding: { ...binding, targetCommit: binding.sourceCommit, targetTree: binding.sourceTree },
      required,
      expectedPreflight: preflight,
      payload: harnessPayload,
    });
    if (child.status !== 0) evidenceErrors.push(`harness release exited with status ${child.status}`);
    evidenceErrors.push(...validateHarnessReceipt(root, receiptRoot, harnessPayload, binding));
    const outcome = evidenceErrors.length > 0 ? 'NO_SHIP' : 'COMPLETE';
    const payload = makeResult({
      identity,
      required,
      outcome,
      diagnostics: [...(harnessPayload.diagnostics || []), ...evidenceErrors],
      preflight,
      surfaceResults: harnessPayload.surfaceResults,
      harness: harnessPayload,
      receiptRoot,
    });
    const runnerReceiptReference = persistRunnerReceipt(receiptRoot, payload);
    payload.runnerReceiptReference = runnerReceiptReference;
    return { status: exitCodeForOutcome(payload.outcome), payload };
  } catch (error) {
    const fallbackIdentity = identity || {
      taskId: parsed.taskId,
      attemptId: parsed.attemptId,
      sourceCommit: null,
      sourceTree: null,
      targetCommit: null,
      targetTree: null,
      worktree: 'DIRTY',
      selectedSurfaces: [],
      requiredRuntimeSurfaces: [],
    };
    const payload = makeResult({
      identity: fallbackIdentity,
      required,
      outcome: 'BLOCKED',
      diagnostics: [error.message],
      preflight,
    });
    try {
      if (receiptRoot) {
        const runnerReceiptReference = persistRunnerReceipt(receiptRoot, payload);
        payload.runnerReceiptReference = runnerReceiptReference;
      }
    } catch (receiptError) {
      payload.diagnostics = boundedDiagnostics([...payload.diagnostics, `runner receipt could not be persisted: ${receiptError.message}`]);
    }
    return { status: 2, payload };
  } finally {
    if (disposableHome && disposableHome.home) {
      try { fs.rmSync(disposableHome.home, { recursive: true, force: true }); } catch (_) { /* preserve primary result */ }
    }
  }
}

if (require.main === module) {
  const invocation = execute();
  if (invocation.payload && invocation.payload.usage) process.stdout.write(`${invocation.payload.usage}\n`);
  else process.stdout.write(`${JSON.stringify(invocation.payload)}\n`);
  process.exit(invocation.status);
}

module.exports = {
  RUNNER_SCHEMA,
  parseArgs,
  usage,
  exitCodeForOutcome,
  resolveReceiptRoot,
  createDisposableRuntimeHome,
  validateReleaseEvidence,
  invokeHarness,
  validateHarnessReceipt,
  persistRunnerReceipt,
  execute,
};
