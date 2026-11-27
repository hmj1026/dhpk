#!/usr/bin/env node
'use strict';

// Cross-version release rehearsal CLI (#1587). Resolves v(N-1) from git
// history and verifies v(N-1) -> HEAD upgrade, rerun, rollback, path
// migration, Cursor local links, AGY Package Receipt, and Duplicate Discovery.

const fs = require('node:fs');
const path = require('node:path');
const { rehearseReleaseUpgrade } = require('../lib/release-rehearsal');

const USAGE = 'usage: release-rehearsal.js [--repo-root <path>] [--version <X.Y.Z>] [--prior-tag <vX.Y.Z>] [--out-file <path>] [--offline] [--execute-live] [--json] [--help]';

function parseArgs(argv) {
  const options = {
    repoRoot: path.resolve(__dirname, '..', '..'),
    version: null,
    priorTag: null,
    outFile: null,
    offline: false,
    executeLive: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--offline') options.offline = true;
    else if (arg === '--execute-live') options.executeLive = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--repo-root' || arg === '--version' || arg === '--prior-tag' || arg === '--out-file') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--repo-root') options.repoRoot = path.resolve(value);
      else if (arg === '--version') options.version = value;
      else if (arg === '--prior-tag') options.priorTag = value;
      else options.outFile = path.resolve(value);
    } else {
      throw new Error(`unknown argument '${arg}'`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`release-rehearsal: ${error.message}\n${USAGE}\n`);
    return 64;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const report = rehearseReleaseUpgrade({
    repoRoot: options.repoRoot,
    version: options.version,
    priorTag: options.priorTag,
    offline: options.offline,
    executeLive: options.executeLive,
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outFile) {
    fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
    fs.writeFileSync(options.outFile, payload, { mode: 0o600 });
  }
  if (options.json) {
    process.stdout.write(payload);
  } else {
    process.stdout.write(
      `release-rehearsal: ${report.verdict} (${report.priorTag || 'none'} -> ${report.targetVersion})\n`,
    );
    for (const diagnostic of report.diagnostics) {
      process.stderr.write(`release-rehearsal: ${diagnostic}\n`);
    }
  }
  return report.exitCode;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`release-rehearsal: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, main };
