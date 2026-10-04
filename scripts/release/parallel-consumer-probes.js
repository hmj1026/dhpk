#!/usr/bin/env node
'use strict';

// Runs one surface-scoped harness probe per child process. The child boundary
// is intentional: the existing probe implementations use synchronous client
// calls, while this coordinator provides bounded parallelism without turning
// the public harness facade into an async API.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { mapWithConcurrency, normalizeConcurrency } = require('../lib/release-probe-batch');
const { REQUIRED_SURFACES } = require('../lib/harness-surfaces');

const MAX_PROBE_TIMEOUT_MS = 5 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;

function parseArgs(argv) {
  const args = { concurrency: 1, timeoutMs: 120000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--worker') args.worker = true;
    else if (arg === '--current-acceptance') args.currentAcceptance = true;
    else if (arg === '--repo-root') args.root = argv[++i];
    else if (arg === '--surface') args.surface = argv[++i];
    else if (arg === '--surfaces') args.surfaces = argv[++i];
    else if (arg === '--concurrency') args.concurrency = argv[++i];
    else if (arg === '--timeout-ms') args.timeoutMs = argv[++i];
    else if (arg === '--task-id') args.taskId = argv[++i];
    else if (arg === '--attempt-id') args.attemptId = argv[++i];
    else if (arg === '--namespace') args.namespace = argv[++i];
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (!args.root || !path.isAbsolute(args.root)) throw new Error('an absolute --repo-root is required');
  if (args.worker && !REQUIRED_SURFACES.includes(args.surface)) throw new Error('worker surface is not canonical');
  if (!args.worker && (!args.surfaces || args.surfaces.split(',').length === 0)) throw new Error('a --surfaces list is required');
  args.concurrency = normalizeConcurrency(args.concurrency, { fallback: 1, maximum: REQUIRED_SURFACES.length });
  if (!args.worker) {
    const surfaces = args.surfaces.split(',').map((surface) => surface.trim());
    if (surfaces.length === 0 || surfaces.some((surface) => !REQUIRED_SURFACES.includes(surface))) {
      throw new Error('batch surface list must contain only canonical surfaces');
    }
    if (new Set(surfaces).size !== surfaces.length) throw new Error('batch surface list must contain unique canonical surfaces');
  }
  const timeout = Number(args.timeoutMs);
  if (!Number.isSafeInteger(timeout) || timeout < 1000) throw new Error('probe timeout must be at least 1000 ms');
  args.timeoutMs = Math.min(timeout, MAX_PROBE_TIMEOUT_MS);
  return args;
}

function safePart(value, fallback) {
  const candidate = String(value || fallback);
  return SAFE_ID.test(candidate) ? candidate : fallback;
}

function namespaceFor(args, surface, index) {
  return [
    'dhpk-release-probe',
    safePart(args.taskId, 'release'),
    safePart(args.attemptId, 'attempt'),
    safePart(surface, 'surface'),
    String(index),
  ].join('-');
}

function emit(value, status = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = status;
}

function acceptanceFailure(execution) {
  if (!execution || !Object.prototype.hasOwnProperty.call(execution, 'acceptance')) return null;
  const acceptance = execution.acceptance;
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)
    || !['PASS', 'FAIL', 'BLOCKED'].includes(acceptance.verdict)
    || !Array.isArray(acceptance.requiredChecks) || acceptance.requiredChecks.length === 0
    || !Array.isArray(acceptance.excludedChecks)) {
    return 'worker emitted an invalid current acceptance envelope';
  }
  if (execution.outcome !== acceptance.verdict) {
    return `worker JSON outcome '${execution.outcome}' disagrees with acceptance '${acceptance.verdict}'`;
  }
  return null;
}

function expectedExitCode(execution) {
  if (!execution || !execution.acceptance) return null;
  return execution.acceptance.verdict === 'PASS' ? 0 : 1;
}

function workerMain(args) {
  const harness = require('../lib/harness');
  try {
    const execution = harness.runConsumerProbe(args.root, {
      surface: args.surface,
      ...(args.currentAcceptance ? { currentAcceptance: true } : {}),
    });
    const failure = args.currentAcceptance
      && (!execution || !Object.prototype.hasOwnProperty.call(execution, 'acceptance'))
      ? 'current probe worker omitted current acceptance evidence'
      : acceptanceFailure(execution);
    const status = failure ? 1 : expectedExitCode(execution);
    emit({ surface: args.surface, namespace: args.namespace, execution }, status === null ? 0 : status);
  } catch (error) {
    emit({
      surface: args.surface,
      namespace: args.namespace,
      execution: {
        outcome: 'FAIL',
        surfaceResults: [{
          surface: args.surface,
          status: 'FAIL',
          stage: 'CONSUMER',
          producer: 'parallel-consumer-probes',
          adapter: { id: 'parallel-consumer-probes', version: '1.0.0' },
          commands: [],
          environment: { network: 'disabled' },
          artifacts: [],
          diagnostics: [],
          reasons: [`probe worker failed: ${error.message}`],
          checkedClaims: ['consumer-route'],
        }],
      },
    }, 1);
  }
}

function spawnWorker(args, surface, index, privateRoot) {
  const namespace = namespaceFor(args, surface, index);
  const receiptRoot = path.join(privateRoot, namespace, 'receipts');
  const privateHome = path.join(privateRoot, namespace, 'home');
  fs.mkdirSync(receiptRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(privateHome, { recursive: true, mode: 0o700 });
  const hostHome = process.env.HOME || os.homedir();
  const hostCodexHome = process.env.CODEX_HOME || path.join(hostHome, '.codex');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      __filename,
      '--worker',
      '--repo-root', args.root,
      '--surface', surface,
      '--namespace', namespace,
      ...(args.currentAcceptance ? ['--current-acceptance'] : []),
    ], {
      cwd: args.root,
      env: {
        ...process.env,
        DHPK_HARNESS_PROBE_NAMESPACE: namespace,
        DHPK_HARNESS_RECEIPT_ROOT: receiptRoot,
        DHPK_HARNESS_PROBE_TASK_ID: args.taskId || 'release',
        DHPK_HARNESS_PROBE_ATTEMPT_ID: args.attemptId || 'attempt',
        DHPK_CONSUMER_PROBE_HOST_CODEX_HOME: hostCodexHome,
        DHPK_CURSOR_HOST_HOME: process.env.DHPK_CURSOR_HOST_HOME || hostHome,
        DHPK_AGY_HOST_HOME: process.env.DHPK_AGY_HOST_HOME || hostHome,
        HOME: privateHome,
        USERPROFILE: privateHome,
        XDG_CONFIG_HOME: path.join(privateHome, 'config'),
        XDG_DATA_HOME: path.join(privateHome, 'data'),
        XDG_CACHE_HOME: path.join(privateHome, 'cache'),
        CODEX_HOME: path.join(privateHome, 'codex'),
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const terminate = () => {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { /* process group already exited */ }
        setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { /* process group already exited */ }
        }, 250);
      } else {
        child.kill('SIGTERM');
      }
    };
    const timer = setTimeout(() => {
      terminate();
      finish({
        surface,
        namespace,
        execution: {
          outcome: 'BLOCKED',
          surfaceResults: [{
            surface,
            status: 'BLOCKED',
            stage: 'CONSUMER',
            producer: 'parallel-consumer-probes',
            adapter: { id: 'parallel-consumer-probes', version: '1.0.0' },
            commands: [],
            environment: { network: 'disabled' },
            artifacts: [],
            diagnostics: [],
            reasons: [`consumer probe timed out after ${args.timeoutMs} ms`],
            checkedClaims: ['consumer-route'],
          }],
        },
        diagnostic: `consumer probe timed out after ${args.timeoutMs} ms`,
        transportStatus: 'FAIL',
      });
    }, args.timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({
        surface,
        namespace,
        execution: { outcome: 'FAIL', surfaceResults: [] },
        diagnostic: error.message,
        transportStatus: 'FAIL',
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      try {
        const result = JSON.parse(stdout);
        let diagnostic = null;
        const failure = acceptanceFailure(result && result.execution);
        const expected = expectedExitCode(result && result.execution);
        if (!result || typeof result !== 'object' || Array.isArray(result)
          || !result.execution || typeof result.execution !== 'object' || Array.isArray(result.execution)) {
          diagnostic = 'probe worker JSON omitted a valid execution result';
        } else if (result.surface !== surface || result.namespace !== namespace) {
          diagnostic = `probe worker identity disagrees with requested surface '${surface}' or namespace`;
        } else if (failure) {
          diagnostic = failure;
        } else if (expected !== null && code !== expected) {
          diagnostic = `worker JSON acceptance '${result.execution.acceptance.verdict}' requires exit ${expected}, received ${code === null ? 'no exit code' : code}`;
        } else if (code !== 0 && expected === null) {
          diagnostic = stderr.slice(-1000) || `probe worker exited ${code} without current acceptance evidence`;
        }
        finish({
          ...result,
          surface,
          namespace,
          diagnostic,
          ...(diagnostic ? { transportStatus: 'FAIL' } : {}),
        });
      } catch (_) {
        finish({
          surface,
          namespace,
          execution: { outcome: code === null ? 'BLOCKED' : 'FAIL', surfaceResults: [] },
          diagnostic: stderr.slice(-1000) || 'probe worker emitted invalid JSON',
          transportStatus: 'FAIL',
        });
      }
    });
  });
}

async function batchMain(args) {
  const surfaces = args.surfaces.split(',').map((surface) => surface.trim());
  const unique = new Set(surfaces);
  if (surfaces.length !== unique.size || surfaces.some((surface) => !REQUIRED_SURFACES.includes(surface))) {
    throw new Error('batch surface list must contain unique canonical surfaces');
  }
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-probe-batch-'));
  const started = Date.now();
  try {
    const results = await mapWithConcurrency(
      surfaces,
      args.concurrency,
      (surface, index) => spawnWorker(args, surface, index, privateRoot),
    );
    const failedCurrentAcceptance = results.some((result) => {
      const acceptance = result && result.execution && result.execution.acceptance;
      return result && result.transportStatus === 'FAIL'
        || acceptance && acceptance.verdict !== 'PASS';
    });
    emit({
      schema: 'dhpk.release-consumer-probe-batch.v1',
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      wallTimeMs: Date.now() - started,
      surfaces,
      results,
    }, failedCurrentAcceptance ? 1 : 0);
  } finally {
    fs.rmSync(privateRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.worker) workerMain(args);
    else batchMain(args).catch((error) => emit({ schema: 'dhpk.release-consumer-probe-batch.v1', error: error.message }, 1));
  } catch (error) {
    emit({ error: error.message }, 64);
  }
}

module.exports = { parseArgs, namespaceFor, batchMain };
