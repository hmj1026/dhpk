#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// These are the repository-owned public JSON CLI entrypoints. Internal release
// reporters are separate contracts; keeping this registry explicit prevents a
// diagnostic-only tool from silently becoming part of the consumer CLI gate.
const JSON_CLI_ENTRYPOINTS = Object.freeze([
  Object.freeze({ name: 'dhpk-install', path: 'scripts/dhpk-install.js' }),
  Object.freeze({ name: 'dhpk-harness', path: 'scripts/dhpk-harness.js' }),
  Object.freeze({ name: 'skill-lint', path: 'skills/skill-scope/scripts/skill-lint.js' }),
  Object.freeze({ name: 'source-gate', path: 'scripts/release/source-gate.js' }),
]);

const PROCESS_EXIT = /\bprocess\.exit\s*\(/g;

function addError(errors, relativePath, line, message) {
  errors.push(`${relativePath}:${line}: ${message}`);
}

function validateEntryPoint(root, entry, errors) {
  const file = path.join(root, entry.path);
  if (!fs.existsSync(file)) {
    addError(
      errors,
      entry.path,
      1,
      `${entry.name} JSON-emitting CLI entry point is missing; the pipe-drain protection cannot be verified`,
    );
    return;
  }

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    addError(
      errors,
      entry.path,
      1,
      `${entry.name} JSON-emitting CLI entry point could not be read: ${error.message}`,
    );
    return;
  }

  content.split(/\r?\n/).forEach((line, index) => {
    if (!PROCESS_EXIT.test(line)) return;
    PROCESS_EXIT.lastIndex = 0;
    addError(
      errors,
      entry.path,
      index + 1,
      `${entry.name} JSON-emitting CLI must set process.exitCode so piped JSON can drain; process.exit() can truncate the document`,
    );
  });
}

function main(root = ROOT) {
  const errors = [];
  for (const entry of JSON_CLI_ENTRYPOINTS) validateEntryPoint(root, entry, errors);
  return {
    errors,
    warnings: [],
    files: JSON_CLI_ENTRYPOINTS.map((entry) => entry.path),
  };
}

if (require.main === module) {
  const result = main();
  for (const error of result.errors) console.error(`json-cli-termination: ${error}`);
  if (result.errors.length > 0) process.exitCode = 1;
  else console.log(`json-cli-termination: checked ${result.files.length} JSON CLI entrypoint(s)`);
}

module.exports = { JSON_CLI_ENTRYPOINTS, main };
