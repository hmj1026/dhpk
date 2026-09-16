#!/usr/bin/env node
'use strict';

// Opt-in, machine-local model discovery.  This command is deliberately kept
// outside dispatch: model lists and client versions are observations, not
// catalog claims, and are never consulted on the dispatch hot path.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA = 'dhpk.model.discovery-observation.v1';
const DEFAULT_OUTPUT = path.join('.dhpk', 'model-observations.json');
const COMMANDS = Object.freeze({
  claude: Object.freeze({ executable: 'claude', listArgs: ['--help'], versionArgs: ['--version'] }),
  codex: Object.freeze({ executable: 'codex', listArgs: ['--help'], versionArgs: ['--version'] }),
  cursor: Object.freeze({ executable: 'cursor-agent', listArgs: ['models'], versionArgs: ['--version'] }),
  agy: Object.freeze({ executable: 'agy', listArgs: ['models'], versionArgs: ['--version'] }),
});

function parseModelIds(output) {
  const ids = [];
  const seen = new Set();
  for (const line of String(output || '').split(/\r?\n/u)) {
    const match = line.trim().match(/^([a-z0-9][a-z0-9._-]*)\s*(?:-|\t|$)/i);
    if (!match || /^(?:available|tip|usage|options?)$/i.test(match[1])) continue;
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function statusForObservation({ executableFound, exitCode, stderr = '' } = {}) {
  if (!executableFound) return 'UNAVAILABLE';
  if (exitCode === 0) return 'AVAILABLE';
  return /auth|login|permission|unauthori[sz]ed|forbidden|account/i.test(stderr) ? 'BLOCKED' : 'UNAVAILABLE';
}

function discoverModels({ agent, executable, listArgs, versionArgs, runner = spawnSync, now = new Date() } = {}) {
  if (typeof agent !== 'string' || agent.trim() === '') throw new TypeError('agent is required');
  if (typeof executable !== 'string' || executable.trim() === '') throw new TypeError('executable is required');
  const list = runner(executable, listArgs || [], { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const version = runner(executable, versionArgs || ['--version'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
  const executableFound = list.error ? list.error.code !== 'ENOENT' : true;
  const exitCode = typeof list.status === 'number' ? list.status : list.error ? 127 : 1;
  const stderr = String(list.stderr || list.error && list.error.message || '').trim();
  const output = String(list.stdout || '');
  return {
    schema: SCHEMA,
    agent,
    executable,
    source: `${executable} ${[...(listArgs || [])].join(' ')}`.trim(),
    client_version: String(version.stdout || version.stderr || '').trim().split(/\r?\n/u)[0] || null,
    observed_at: now.toISOString(),
    status: statusForObservation({ executableFound, exitCode, stderr }),
    model_ids: exitCode === 0 ? parseModelIds(output) : [],
    evidence: stderr || (exitCode === 0 ? 'model list command completed' : `exit ${exitCode}`),
  };
}

function loadObservation(file, { fsApi = fs } = {}) {
  try {
    const value = JSON.parse(fsApi.readFileSync(file, 'utf8'));
    if (!value || value.schema !== SCHEMA || !Array.isArray(value.observations)) return { status: 'NOT_RUN', observations: [] };
    return value;
  } catch (_) {
    return { schema: SCHEMA, status: 'NOT_RUN', observations: [] };
  }
}

function parseArgs(argv) {
  const args = { output: path.resolve(process.cwd(), DEFAULT_OUTPUT), agents: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--agent') args.agents.push(argv[++index]);
    else if (arg === '--output') args.output = path.resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (args.agents.length === 0) args.agents = Object.keys(COMMANDS);
  args.agents.forEach((agent) => { if (!COMMANDS[agent]) throw new Error(`unsupported agent '${agent}'`); });
  return args;
}

function run(argv, { runner = spawnSync, now = new Date() } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write('usage: discover-models.js [--agent claude|codex|cursor|agy]... [--output path]\n');
    return 0;
  }
  const observations = args.agents.map((agent) => discoverModels({ agent, ...COMMANDS[agent], runner, now }));
  const document = { schema: SCHEMA, status: observations.length ? 'OBSERVED' : 'NOT_RUN', observations };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({ COMMANDS, SCHEMA, discoverModels, loadObservation, parseArgs, parseModelIds, run, statusForObservation });
