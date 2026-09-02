#!/usr/bin/env node
'use strict';

const { resolveVersion } = require('./version-resolver');

function parseArguments(argv) {
  const options = {};
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--version' && argv[index + 1] !== undefined) {
      options.version = argv[++index];
    } else if (argument.startsWith('--version=')) {
      options.version = argument.slice('--version='.length);
    } else if (argument === '--cwd' && argv[index + 1] !== undefined) {
      options.cwd = argv[++index];
    } else if (argument.startsWith('--cwd=')) {
      options.cwd = argument.slice('--cwd='.length);
    } else if (argument === '--help' || argument === '-h') {
      return { help: true, json, options };
    } else {
      return { error: 'Unknown argument: ' + argument, json, options };
    }
  }
  return { json, options };
}

function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write('Usage: resolve-version.js [--json] [--version 9|10|11] [--cwd project]\n');
    return;
  }
  if (parsed.error) {
    if (parsed.json) process.stdout.write(JSON.stringify({ status: 'ask', family: 'phpunit', question: parsed.error }) + '\n');
    else process.stderr.write(parsed.error + '\n');
    process.exitCode = 2;
    return;
  }

  const result = resolveVersion(parsed.options);
  if (parsed.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (result.status === 'resolved') {
    process.stdout.write(result.guidance.endsWith('\n') ? result.guidance : result.guidance + '\n');
  } else {
    process.stderr.write(result.question + '\n');
  }
  process.exitCode = result.status === 'resolved' ? 0 : 2;
}

main();
