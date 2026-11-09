'use strict';

// Resolves the interpreters a gate step would run from the step environment's
// PATH, so release evidence records which python3/node/bash actually ran.
// Two shells can run the same gate with different interpreters (agy vs Claude
// Code in v0.70.8, #1278); without this record their verdicts are not comparable.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APPLE_PYTHON = '/usr/bin/python3';
const VERSION_TIMEOUT_MS = 5000;

function resolveOnPath(command, envPath, cwd) {
  for (const dir of String(envPath || '').split(path.delimiter)) {
    if (!dir) continue;
    // Relative entries resolve against the directory the steps run in.
    const candidate = path.join(path.resolve(cwd, dir), command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_error) {
      // Not present or not executable in this PATH entry; keep searching.
    }
  }
  return null;
}

// Without Command Line Tools, invoking Apple's python3 stub opens an install
// dialog instead of printing a version, so it is only probed when CLT exists.
function hasCommandLineTools() {
  const probe = spawnSync('xcode-select', ['-p'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS });
  return probe.status === 0;
}

function appleStubWithoutTools(resolved, probeTools) {
  if (resolved !== APPLE_PYTHON || process.platform !== 'darwin') return false;
  return !probeTools();
}

function readVersion(resolved, env) {
  const res = spawnSync(resolved, ['--version'], {
    encoding: 'utf8',
    env,
    timeout: VERSION_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error || res.status !== 0) return null;
  const line = `${res.stdout || ''}\n${res.stderr || ''}`.split('\n').map((entry) => entry.trim()).find(Boolean);
  return line || null;
}

function describeCommand(command, env, { cwd, probeTools }) {
  const resolved = resolveOnPath(command, env.PATH, cwd);
  if (!resolved) return { command, path: null, realPath: null, version: null };
  let realPath = resolved;
  try {
    realPath = fs.realpathSync(resolved);
  } catch (_error) {
    // A dangling link still records the resolved path.
  }
  const version = appleStubWithoutTools(resolved, probeTools) ? null : readVersion(resolved, env);
  return { command, path: resolved, realPath, version };
}

function toolchainNotes(commands) {
  const notes = [];
  if (commands.some((entry) => entry.command === 'python3' && entry.path === APPLE_PYTHON)) {
    notes.push(`python3 resolves to Apple's Xcode stub (${APPLE_PYTHON}); it writes its bytecode cache under $HOME/Library/Caches/com.apple.python`);
  }
  return notes;
}

// `options.cwd` anchors relative PATH entries; `options.probeTools` replaces
// the Command Line Tools probe (tests only).
function describeToolchain(env, commands = ['python3', 'node', 'bash'], options = {}) {
  const context = { cwd: options.cwd || process.cwd(), probeTools: options.probeTools || hasCommandLineTools };
  const described = commands.map((command) => describeCommand(command, env || {}, context));
  return { commands: described, notes: toolchainNotes(described) };
}

module.exports = { describeToolchain, toolchainNotes, APPLE_PYTHON };
