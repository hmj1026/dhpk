'use strict';

// One bounded subprocess runner for external Host CLI probes (codex, claude,
// cursor-agent, agy). Every caller gets the exact inner exit status, the
// timeout state, elapsed time, and bounded output tails, so a probe failure or
// timeout is never reported as a silent success.

const { spawnSync } = require('node:child_process');
const { terminateProcessGroup } = require('./bounded-child-process');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_TAIL_BYTES = 4096;
// timeout(1) and run-portable-bounded-command.js exit 124 when their own
// deadline expires; an inner 124 is a timeout, not an ordinary failure.
const TIMEOUT_EXIT_CODE = 124;

function toBuffer(value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function tailText(value, maxBytes) {
  const bytes = toBuffer(value);
  if (bytes.length <= maxBytes) return bytes.toString('utf8');
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString('utf8');
}

function outputValue(value, encoding) {
  if (encoding === 'buffer') return toBuffer(value);
  return toBuffer(value).toString('utf8');
}

function runHostCliProbe(command, args = [], {
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBuffer = DEFAULT_MAX_BUFFER_BYTES,
  tailBytes = DEFAULT_TAIL_BYTES,
  encoding = 'utf8',
  reapGroup = 'on-failure',
  spawn = spawnSync,
  terminate = terminateProcessGroup,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive integer (received ${timeoutMs})`);
  }
  const detached = process.platform !== 'win32';
  const startedAt = process.hrtime.bigint();
  let raw;
  try {
    raw = spawn(command, args, {
      ...(cwd !== undefined ? { cwd } : {}),
      env,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer,
      killSignal: 'SIGKILL',
      detached,
    });
  } catch (error) {
    raw = { status: null, signal: null, error };
  }
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  raw = raw && typeof raw === 'object' ? raw : {};

  const error = raw.error || null;
  const exitCode = Number.isInteger(raw.status) ? raw.status : null;
  const timedOut = Boolean(error && error.code === 'ETIMEDOUT') || exitCode === TIMEOUT_EXIT_CODE;
  const outputLimited = Boolean(error && error.code === 'ENOBUFS');
  const pid = Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null;

  // spawnSync's timeout and maxBuffer kill only the direct child; descendants
  // keep running in its process group until the group itself is killed.
  let reapFailed = false;
  const failed = Boolean(error) || exitCode !== 0;
  if (detached && pid && (reapGroup === 'always' || failed)) {
    try {
      terminate(pid, 'SIGKILL');
    } catch (reapError) {
      if (!reapError || reapError.code !== 'ESRCH') reapFailed = true;
    }
  }

  return {
    command,
    exitCode,
    signal: raw.signal || null,
    timedOut,
    outputLimited,
    durationMs,
    stdout: outputValue(raw.stdout, encoding),
    stderr: outputValue(raw.stderr, encoding),
    stdoutTail: tailText(raw.stdout, tailBytes),
    stderrTail: tailText(raw.stderr, tailBytes),
    error,
    reapFailed,
    pid,
  };
}

function refusedHostCliProbe(error, exitCode = 125) {
  return {
    command: null,
    exitCode,
    signal: null,
    timedOut: false,
    outputLimited: false,
    durationMs: 0,
    stdout: '',
    stderr: '',
    stdoutTail: '',
    stderrTail: '',
    error,
    reapFailed: false,
    pid: null,
  };
}

function hostCliProbeEvidence(result, redact = (text) => text) {
  const tail = (text) => (text ? redact(text) : '');
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutTail: tail(result.stdoutTail),
    stderrTail: tail(result.stderrTail),
  };
}

module.exports = {
  DEFAULT_TAIL_BYTES,
  TIMEOUT_EXIT_CODE,
  hostCliProbeEvidence,
  refusedHostCliProbe,
  runHostCliProbe,
};
