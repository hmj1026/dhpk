#!/usr/bin/env node
'use strict';

// Read-only diagnostic adapter for the Codex discovery registry. Filesystem
// enumeration stays in the release consumer-gate module; this command only
// selects roots, invokes discovery, and serializes the registry report.

const fs = require('node:fs');
const path = require('node:path');
const { discoverCodexSurfaces } = require('../release/consumer-gate');
const { inspectCodexActivation } = require('../lib/codex-discovery-registry');
const {
  CODEX_NATIVE_PLUGIN_ID,
  probeCodexNativeActivation,
  normalizeActivationOverride,
} = require('../lib/codex-native-activation');

function usage() {
  return 'usage: check-codex-discovery.js [--repo-root <path>] [--project-root <path>] [--native-root <path>] [--version X.Y.Z] [--native-activation auto|enabled|inactive]';
}

function parseArgs(argv) {
  const args = { repoRoot: process.cwd(), nativeActivation: 'auto' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--project-root') args.projectRoot = argv[++index];
    else if (arg === '--native-root') args.nativeRoot = argv[++index];
    else if (arg === '--version') args.version = argv[++index];
    else if (arg === '--native-activation') args.nativeActivation = normalizeActivationOverride(argv[++index]);
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
  // --native-root supplies package/artifact evidence only. Whether a native
  // provider found there is a live runtime duplicate depends on whether the
  // dhpk Codex plugin is actually enabled, not on the artifact's mere
  // presence on disk (issue #437).
  const activation = args.nativeActivation === 'auto'
    ? probeCodexNativeActivation()
    : {
      status: args.nativeActivation === 'enabled' ? 'ENABLED' : 'INACTIVE',
      pluginId: CODEX_NATIVE_PLUGIN_ID,
      source: 'override',
    };
  const nativeActive = activation.status === 'ENABLED';
  const report = inspectCodexActivation({
    project: surfaces.project,
    native: surfaces.native.map((entry) => ({ ...entry, experimental: true, active: nativeActive })),
    precedence: ['project-local'],
    receipt: compactReceipt(surfaces.manifest),
    nonInvokableSkillNames: surfaces.nonInvokableSkillNames,
  });
  let verdict = report.verdict;
  let reasonCode = report.reasonCode;
  if (
    report.ok
    && !report.reasonCode
    && activation.status === 'UNAVAILABLE'
    && report.inactiveDuplicateInvokableNames.length > 0
  ) {
    verdict = 'WARN';
    reasonCode = 'CODEX_ACTIVATION_UNKNOWN';
  }
  const nextAction = report.invalidProviders.length > 0
    ? 'Use --update only for receipt-owned entries; unowned entries require manual inspect, repair, or removal.'
    : report.duplicateInvokableNames.length > 0
      ? 'Native Codex plugin dhpk@dhpk is enabled; run `codex plugin remove dhpk@dhpk` and start a new Codex session, or use a disposable isolated CODEX_HOME for the native experiment.'
      : reasonCode === 'CODEX_ACTIVATION_UNKNOWN'
        ? 'Codex activation state is unknown; confirm with `codex plugin list --json` that dhpk@dhpk is not enabled before relying on this PASS.'
        : null;
  const output = {
    verdict,
    ok: report.ok,
    reasonCode,
    duplicateInvokableNames: report.duplicateInvokableNames,
    inactiveDuplicateInvokableNames: report.inactiveDuplicateInvokableNames,
    integrityVerdict: report.integrityVerdict,
    effective: report.effective,
    duplicates: report.duplicates,
    conflicts: report.conflicts,
    invalidProviders: report.invalidProviders,
    providers: report.providers,
    receipt: report.receipt,
    activation,
    nextAction,
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
