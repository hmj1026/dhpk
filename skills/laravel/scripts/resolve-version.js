#!/usr/bin/env node
'use strict';

const { resolveVersion } = require('./version-resolver');

function parseArgs(argv) {
  let json = false;
  let version;
  let hasVersion = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--version') {
      if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
        version = argv[index + 1];
        hasVersion = true;
        index += 1;
      }
    } else if (argument.startsWith('--version=')) {
      version = argument.slice('--version='.length);
      hasVersion = true;
    }
  }

  return { json, version, hasVersion };
}

const parsed = parseArgs(process.argv.slice(2));
const result = resolveVersion({
  ...(parsed.hasVersion ? { version: parsed.version } : {}),
  cwd: process.cwd(),
});

if (parsed.json) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (result.status === 'resolved') {
  process.stdout.write(result.guidance);
} else {
  process.stdout.write(`${result.question}\n`);
}

if (result.status !== 'resolved') process.exitCode = 2;
