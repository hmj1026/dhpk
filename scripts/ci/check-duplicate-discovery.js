#!/usr/bin/env node
'use strict';

// Read-only Duplicate Discovery diagnostic. The baseline scan never calls a
// Host. The live layer calls the shared probe runner and keeps that verdict
// in its own field.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveOwningPackageRoot } = require('../lib/package-root');
const { redactSensitiveText } = require('../lib/redaction');
const { hostCliProbeEvidence, runHostCliProbe } = require('../lib/host-cli-probe');
const { createDuplicateDiscoveryReport, reportExitCode } = require('../lib/duplicate-discovery');

const PROBES = Object.freeze({
  codex: Object.freeze({ command: 'codex', args: Object.freeze(['debug', 'prompt-input']) }),
  claude: Object.freeze({ command: 'claude', args: Object.freeze(['plugin', 'list', '--json']) }),
});

function usage() {
  return 'usage: check-duplicate-discovery.js [--project-root <path>] [--home <path>] [--codex-home <path>] [--host codex|claude|all] [--offline]';
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    home: process.env.HOME || os.homedir(),
    codexHome: process.env.CODEX_HOME || '',
    host: 'all',
    offline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--offline') args.offline = true;
    else if (arg === '--project-root') args.projectRoot = requiredValue(argv, index += 1, arg);
    else if (arg === '--home') args.home = requiredValue(argv, index += 1, arg);
    else if (arg === '--codex-home') args.codexHome = requiredValue(argv, index += 1, arg);
    else if (arg === '--host') args.host = requiredValue(argv, index += 1, arg);
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (!['codex', 'claude', 'all'].includes(args.host)) throw new Error(`unknown host '${args.host}'`);
  args.projectRoot = path.resolve(args.projectRoot);
  args.home = path.resolve(args.home);
  args.codexHome = path.resolve(args.codexHome || path.join(args.home, '.codex'));
  args.hosts = args.host === 'all' ? ['codex', 'claude'] : [args.host];
  return args;
}

function inventoryNames() {
  const root = resolveOwningPackageRoot({
    fromDir: __dirname,
    levelsUp: 2,
    requiredAsset: 'manifests/distribution-inventory.json',
  });
  const document = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const names = new Set();
  for (const skill of Array.isArray(document.skills) ? document.skills : []) {
    if (!skill || typeof skill !== 'object') continue;
    if (typeof skill.name === 'string') names.add(skill.name);
    if (typeof skill.id === 'string') names.add(skill.id);
  }
  return names;
}

function capturedProbe(host, args, env) {
  const spec = PROBES[host];
  const result = runHostCliProbe(spec.command, spec.args, {
    cwd: args.projectRoot,
    env: { ...env, HOME: args.home, CODEX_HOME: args.codexHome },
  });
  const evidence = hostCliProbeEvidence(result, redactSensitiveText);
  return {
    command: result.command,
    exitCode: evidence.exitCode,
    signal: evidence.signal,
    timedOut: evidence.timedOut,
    durationMs: evidence.durationMs,
    stdoutTail: evidence.stdoutTail,
    stderrTail: evidence.stderrTail,
    stdout: result.stdout,
    errorCode: result.error && result.error.code ? result.error.code : null,
    outputLimited: Boolean(result.outputLimited),
  };
}

function run(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const probes = {};
  if (!args.offline) {
    for (const host of args.hosts) probes[host] = capturedProbe(host, args, env);
  }
  const report = createDuplicateDiscoveryReport({
    projectRoot: args.projectRoot,
    home: args.home,
    codexHome: args.codexHome,
    hosts: args.hosts,
    offline: args.offline,
    inventoryNames: inventoryNames(),
    probes,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return reportExitCode(report);
}

if (require.main === module) {
  try {
    const exitCode = run(process.argv.slice(2));
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${usage()}\n${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, run, usage };
