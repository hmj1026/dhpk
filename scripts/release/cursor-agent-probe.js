#!/usr/bin/env node
'use strict';

// Bounded, launch-scoped Cursor CLI probe. This wrapper is the documented
// operator route; it never installs or edits a Cursor package.

const path = require('node:path');
const { runCursorConsumerProbe } = require('../lib/cursor-plugin-package');

const DEFAULT_PROMPT = 'List the dhpk skills, commands, agents, and rules you discover. Do not edit files.';

function usage() {
  return 'usage: cursor-agent-probe.js --agent-package <dir> --cursor-package <dir> [--timeout-ms <n>] [--max-output-bytes <n>] [--prompt <text>]';
}

function parseArgs(argv) {
  const result = { prompt: DEFAULT_PROMPT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error(`missing value for ${arg}`);
      index += 1;
      return argv[index];
    };
    if (arg === '--agent-package') result.agentPackage = next();
    else if (arg === '--cursor-package') result.cursorPackage = next();
    else if (arg === '--timeout-ms') result.timeoutMs = next();
    else if (arg === '--max-output-bytes') result.maxOutputBytes = next();
    else if (arg === '--prompt') result.prompt = next();
    else if (arg === '--help') { console.log(usage()); process.exit(0); }
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (!result.agentPackage || !result.cursorPackage) throw new Error(usage());
  return result;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`cursor-agent-probe: ${error.message}`);
    process.exit(2);
  }
  const agentPackage = path.resolve(args.agentPackage);
  const cursorPackage = path.resolve(args.cursorPackage);
  let result;
  try {
    result = runCursorConsumerProbe({
      packageRoot: agentPackage,
      timeoutMs: args.timeoutMs === undefined ? undefined : Number(args.timeoutMs),
      maxOutputBytes: args.maxOutputBytes === undefined ? undefined : Number(args.maxOutputBytes),
      requireOutput: true,
      requireJson: true,
      requireDiscovery: true,
      args: [
        '--plugin-dir', agentPackage,
        '--plugin-dir', cursorPackage,
        '--mode', 'ask',
        '-p', args.prompt,
        '--output-format', 'json',
      ],
    });
  } catch (error) {
    result = {
      status: 'BLOCKED',
      reason: error.message,
      packageRoot: agentPackage,
      timed_out: false,
    };
  }
  console.log(JSON.stringify({
    ...result,
    surface: 'cursor-cli',
    action: 'launch-scoped-probe',
    agent_package: agentPackage,
    cursor_package: cursorPackage,
  }, null, 2));
  if (['FAIL', 'BLOCKED'].includes(result.status)) process.exit(1);
}

main();
