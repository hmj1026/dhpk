#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const runtime = require('./lib/review-gate-runtime');

const MAX_STDIN_BYTES = runtime.MAX_STDIN_BYTES;

class CliError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReviewGateRuntimeCliError';
    this.code = code;
  }
}

const parseArgs = (argv) => {
  const args = {
    repoRoot: process.cwd(),
    workId: null,
    waveId: null,
    artifact: null,
    companion: null,
    lifecycleEvents: null,
    readinessEvents: null,
    acceptedOutcomeCost: null,
    sentinelOutcome: null,
  };
  let command = null;
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const fields = new Map([
      ['--repo-root', 'repoRoot'],
      ['--work-id', 'workId'],
      ['--wave-id', 'waveId'],
      ['--artifact', 'artifact'],
      ['--companion', 'companion'],
      ['--lifecycle-events', 'lifecycleEvents'],
      ['--readiness-events', 'readinessEvents'],
      ['--accepted-outcome-cost', 'acceptedOutcomeCost'],
      ['--sentinel-outcome', 'sentinelOutcome'],
    ]);
    if (fields.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new CliError('INVALID_ARGUMENTS');
      const field = fields.get(arg);
      if (seen.has(field)) throw new CliError('INVALID_ARGUMENTS');
      seen.add(field);
      args[field] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new CliError('INVALID_ARGUMENTS');
    if (command !== null) throw new CliError('INVALID_ARGUMENTS');
    command = arg;
  }
  if (!command || !['init', 'prepare', 'observe', 'status'].includes(command)) {
    throw new CliError(command ? 'UNSUPPORTED_COMMAND' : 'INVALID_ARGUMENTS');
  }
  const observationFields = [
    'artifact',
    'companion',
    'lifecycleEvents',
    'readinessEvents',
    'acceptedOutcomeCost',
    'sentinelOutcome',
  ];
  if (command === 'status') {
    if (!args.workId || observationFields.some((field) => args[field] !== null)) {
      throw new CliError('INVALID_ARGUMENTS');
    }
  } else if (command === 'observe') {
    if (!args.workId || !args.waveId
      || observationFields.some((field) => ['acceptedOutcomeCost'].includes(field)
        ? false : !args[field])) {
      throw new CliError('INVALID_ARGUMENTS');
    }
  } else if (args.workId || args.waveId || observationFields.some((field) => args[field] !== null)) {
    throw new CliError('INVALID_ARGUMENTS');
  }
  return { ...args, command };
};

const execute = (args, input) => {
  if (args.command === 'init') return runtime.init({ repoRoot: args.repoRoot });
  if (args.command === 'prepare') return runtime.prepare({ repoRoot: args.repoRoot, input });
  if (args.command === 'observe') {
    return runtime.observe({
      repoRoot: args.repoRoot,
      workId: args.workId,
      waveId: args.waveId,
      artifact: args.artifact,
      companion: args.companion,
      lifecycleEvents: args.lifecycleEvents,
      readinessEvents: args.readinessEvents,
      acceptedOutcomeCost: args.acceptedOutcomeCost,
      sentinelOutcome: args.sentinelOutcome,
    });
  }
  return runtime.status({ repoRoot: args.repoRoot, workId: args.workId, waveId: args.waveId });
};

const readBoundedStdin = (maxBytes = MAX_STDIN_BYTES) => {
  let content = Buffer.alloc(0);
  const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1));
  while (content.length <= maxBytes) {
    let count;
    try {
      count = fs.readSync(0, chunk, 0, chunk.length, null);
    } catch (_) {
      throw new CliError('BOUNDED_INPUT');
    }
    if (count === 0) break;
    content = Buffer.concat([content, chunk.subarray(0, count)]);
    if (content.length > maxBytes) throw new CliError('BOUNDED_INPUT');
  }
  return content;
};

const main = (argv = process.argv.slice(2), io = {}) => {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let command = 'unknown';
  let repoRoot = process.cwd();
  try {
    const args = parseArgs(argv);
    command = args.command;
    repoRoot = args.repoRoot;
    const input = args.command === 'prepare'
      ? io.input === undefined ? readBoundedStdin() : io.input
      : undefined;
    stdout.write(`${JSON.stringify(execute(args, input))}\n`);
    return 0;
  } catch (error) {
    runtime.writeDiagnostic({ repoRoot, command, code: error && error.code ? error.code : 'RUNTIME_ERROR' });
    stderr.write('review-gate-runtime: ERROR\n');
    return 1;
  }
};

if (require.main === module) process.exitCode = main();

module.exports = {
  KEY_RELATIVE_PATH: runtime.KEY_RELATIVE_PATH,
  SCHEMA: runtime.SCHEMA,
  createIntegrityKey: runtime.createIntegrityKey,
  execute,
  main,
  MAX_STDIN_BYTES,
  observe: runtime.observe,
  parseArgs,
};
