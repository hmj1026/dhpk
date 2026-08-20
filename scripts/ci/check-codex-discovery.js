#!/usr/bin/env node
'use strict';

// Read-only diagnostic adapter for the Codex discovery registry. Filesystem
// enumeration stays in the release consumer-gate module; this command only
// selects roots, invokes discovery, and serializes the registry report.

const fs = require('node:fs');
const path = require('node:path');
const { discoverCodexSurfaces } = require('../release/consumer-gate');
const { inspectCodexDiscovery } = require('../lib/codex-discovery-registry');

function usage() {
  return 'usage: check-codex-discovery.js [--repo-root <path>] [--project-root <path>] [--native-root <path>] [--version X.Y.Z]';
}

function parseArgs(argv) {
  const args = { repoRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--project-root') args.projectRoot = argv[++index];
    else if (arg === '--native-root') args.nativeRoot = argv[++index];
    else if (arg === '--version') args.version = argv[++index];
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`unknown argument '${arg}'`);
  }
  args.repoRoot = path.resolve(args.repoRoot || process.cwd());
  args.projectRoot = path.resolve(args.projectRoot || args.repoRoot);
  args.nativeRoot = path.resolve(args.nativeRoot || path.join(args.repoRoot, 'plugins', 'dhpk'));
  return args;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function inferVersion(args) {
  if (args.version) return args.version;
  const native = readJson(path.join(args.nativeRoot, '.codex-plugin', 'plugin.json'));
  if (native && typeof native.version === 'string') return native.version;
  const root = readJson(path.join(args.repoRoot, '.claude-plugin', 'plugin.json'));
  return root && typeof root.version === 'string' ? root.version : undefined;
}

function compactReceipt(manifest) {
  if (!manifest) return null;
  return {
    schema_version: manifest.schema_version,
    plugin_version: manifest.plugin_version,
    source_fingerprint: manifest.source_fingerprint,
    mode: manifest.mode,
    reconciliation: manifest.reconciliation
      ? { ...manifest.reconciliation, evidence: undefined }
      : null,
  };
}

function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const version = inferVersion(args);
  const surfaces = discoverCodexSurfaces({
    root: args.repoRoot,
    project: args.projectRoot,
    nativeRoot: args.nativeRoot,
    version,
  });
  const report = inspectCodexDiscovery({
    project: surfaces.project,
    native: surfaces.native.map((entry) => ({ ...entry, experimental: true })),
    precedence: ['project-local'],
    receipt: compactReceipt(surfaces.manifest),
  });
  const output = {
    verdict: report.verdict,
    ok: report.ok,
    effective: report.effective,
    duplicates: report.duplicates,
    conflicts: report.conflicts,
    providers: report.providers,
    receipt: report.receipt,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  process.stdout.write(serialized, () => {});
  return report.ok ? 0 : 1;
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

module.exports = { compactReceipt, inferVersion, parseArgs, run };
