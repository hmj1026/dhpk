#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildReleaseArtifactManifest,
  validateReleaseArtifactManifest,
} = require('../lib/release-artifact-manifest');

function parseArgs(argv) {
  const args = { root: path.resolve(__dirname, '..', '..') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg === '--output') args.output = path.resolve(argv[++i]);
    else if (arg === '--manifest') args.manifest = path.resolve(argv[++i]);
    else if (arg === '--run-id') args.runId = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--expected-run-id') args.expectedRunId = argv[++i];
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (args.manifest && args.output) throw new Error('--manifest and --output are mutually exclusive');
  if (!args.manifest && !args.output) throw new Error('one of --output or --manifest is required');
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.manifest) {
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const checked = validateReleaseArtifactManifest(manifest, {
      root: args.root,
      expectedRunId: args.expectedRunId || null,
      expectedVersion: args.version || null,
    });
    process.stdout.write(`${JSON.stringify(checked, null, 2)}\n`);
    return checked.ok ? 0 : 1;
  }
  const manifest = buildReleaseArtifactManifest({ root: args.root, runId: args.runId || null, version: args.version || null });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, manifestFingerprint: manifest.manifestFingerprint, output: '<manifest>' }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`release-artifact-manifest: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, main };
