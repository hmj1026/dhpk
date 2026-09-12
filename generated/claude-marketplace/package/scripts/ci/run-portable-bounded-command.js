#!/usr/bin/env node
'use strict';

// Portable bounded-command adapter for developer machines that do not expose
// the Linux systemd cgroup contract. It provides a Node heap cap and kills the
// complete detached process group on wall-time expiry. It intentionally does
// not claim aggregate descendant memory containment; CI remains responsible
// for the stronger systemd adapter.

const { spawn } = require('node:child_process');

const TIMEOUT_EXIT_CODE = 124;
const KILL_AFTER_MS = 5000;

function parseDuration(raw) {
  const match = /^([1-9][0-9]*)(s|m|h|d)?$/.exec(raw || '');
  if (!match || match[1].length > 6) return null;
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] || 's'];
  const seconds = Number(match[1]) * multiplier;
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 604800 ? seconds : null;
}

function parseHeapMb(raw) {
  if (!/^[1-9][0-9]*$/.test(raw || '')) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 128 && value <= 16384 ? value : null;
}

function parseArgs(argv) {
  let timeout;
  let heapMb;
  let separator = -1;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--') {
      separator = index;
      break;
    }
    if (argv[index] === '--timeout') timeout = argv[++index];
    else if (argv[index] === '--node-heap-mb') heapMb = argv[++index];
    else return null;
  }
  if (separator < 0 || separator === argv.length - 1) return null;
  const timeoutSeconds = parseDuration(timeout);
  const nodeHeapMb = parseHeapMb(heapMb);
  if (!timeoutSeconds || !nodeHeapMb) return null;
  return {
    timeoutMs: timeoutSeconds * 1000,
    nodeHeapMb,
    command: argv[separator + 1],
    args: argv.slice(separator + 2),
  };
}

function childEnvironment(nodeHeapMb) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('DHPK_BOUNDED_')) delete env[name];
  }
  const existingNodeOptions = (env.NODE_OPTIONS || '')
    .replace(/(^|\s)--max-old-space-size=\S+/g, ' ')
    .trim();
  env.NODE_OPTIONS = [`--max-old-space-size=${nodeHeapMb}`, existingNodeOptions]
    .filter(Boolean)
    .join(' ');
  return env;
}

function signalProcessGroup(child, signal) {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function main(argv) {
  const options = parseArgs(argv);
  if (!options) {
    console.error('Usage: run-portable-bounded-command.js --timeout <duration> --node-heap-mb <MB> -- <command> [args...]');
    return 2;
  }

  let child;
  try {
    child = spawn(options.command, options.args, {
      detached: process.platform !== 'win32',
      env: childEnvironment(options.nodeHeapMb),
      stdio: 'inherit',
    });
  } catch (error) {
    console.error(`[run-portable-bounded-command] ERROR: ${error.message}`);
    return 127;
  }

  let finished = false;
  let timedOut = false;
  let timeoutTimer;
  let killTimer;
  const finish = (exitCode) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
    process.exitCode = exitCode;
  };

  timeoutTimer = setTimeout(() => {
    timedOut = true;
    console.error(`[run-portable-bounded-command] ERROR: command timed out after ${options.timeoutMs / 1000}s`);
    signalProcessGroup(child, 'SIGTERM');
    killTimer = setTimeout(() => {
      signalProcessGroup(child, 'SIGKILL');
      finish(TIMEOUT_EXIT_CODE);
    }, KILL_AFTER_MS);
  }, options.timeoutMs);

  child.once('error', (error) => {
    if (!timedOut) console.error(`[run-portable-bounded-command] ERROR: ${error.message}`);
    finish(timedOut ? TIMEOUT_EXIT_CODE : 127);
  });
  child.once('close', (code, signal) => {
    if (timedOut) return;
    if (typeof code === 'number') {
      finish(code);
      return;
    }
    finish(128 + (signal ? (signal === 'SIGTERM' ? 15 : signal === 'SIGKILL' ? 9 : 1) : 1));
  });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      if (finished) return;
      signalProcessGroup(child, signal);
      finish(signal === 'SIGTERM' ? 143 : 130);
    });
  }
  return undefined;
}

const exitCode = main(process.argv.slice(2));
if (typeof exitCode === 'number') process.exitCode = exitCode;
