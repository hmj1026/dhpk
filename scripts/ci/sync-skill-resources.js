#!/usr/bin/env node
'use strict';

// Authoring-only shared-resource synchronizer. Consumers receive the physical
// Skill copies; they never invoke this command.

const path = require('node:path');
const {
  checkSkillResources,
  writeSkillResources,
} = require('../lib/skill-resource-sync');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function usage() {
  return 'usage: sync-skill-resources.js (--check|--write) [--root <repository>]';
}

function parseArgs(argv) {
  let mode = null;
  let root = DEFAULT_ROOT;
  let rootProvided = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check' || argument === '--write') {
      if (mode !== null) throw new Error('exactly one of --check or --write is required');
      mode = argument.slice(2);
    } else if (argument === '--root') {
      if (rootProvided || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        throw new Error('--root requires exactly one repository path');
      }
      const value = argv[++index];
      if (value.length === 0) throw new Error('--root requires exactly one repository path');
      root = path.resolve(value);
      rootProvided = true;
    } else {
      throw new Error(`unknown argument '${argument}'`);
    }
  }
  if (mode === null) throw new Error('exactly one of --check or --write is required');
  return { mode, root };
}

function report(result, mode) {
  const prefix = result.ok ? 'PASS' : 'FAIL';
  const action = mode === 'check' ? 'check' : 'write';
  console.log(`${prefix} [skill-resource-sync:${action}]`);
  for (const error of result.errors || []) console.error(`ERROR [skill-resource-sync]: ${error}`);
  for (const change of result.changes || []) {
    const detail = typeof change === 'string' ? change : JSON.stringify(change);
    console.error(`${result.ok ? 'CHANGE' : 'DRIFT'} [skill-resource-sync]: ${detail}`);
  }
  return result.ok ? 0 : 1;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`usage error: ${error.message}`);
    console.error(usage());
    return 2;
  }
  try {
    const result = args.mode === 'check'
      ? checkSkillResources({ root: args.root })
      : writeSkillResources({ root: args.root });
    return report(result, args.mode);
  } catch (error) {
    console.error(`FAIL [skill-resource-sync]: ${error.message}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
