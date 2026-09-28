'use strict';

// Structural regression guard for the repository-owned JSON CLI termination
// policy. The defect is invisible on the CI Runtime Baseline because newer
// Node runtimes drain stdout before exit, so this test deliberately checks the
// source contract rather than attempting a behavioural pipe-size reproduction.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { JSON_CLI_ENTRYPOINTS, main } = require('../scripts/ci/validate-json-cli-termination');

const ROOT = path.join(__dirname, '..');

function fixture(mutator = (_relativePath, source) => source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-json-cli-termination-'));
  for (const { path: relativePath } of JSON_CLI_ENTRYPOINTS) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    fs.writeFileSync(target, mutator(relativePath, source));
  }
  return root;
}

test('the real repository satisfies the JSON CLI termination policy', () => {
  const result = main(ROOT);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

test('a JSON CLI that calls process.exit fails closed with pipe-drain guidance', () => {
  const root = fixture((relativePath, source) => (
    relativePath === 'scripts/dhpk-harness.js' ? `${source}\nprocess.exit(0);\n` : source
  ));
  try {
    const result = main(root);
    assert.ok(result.errors.some((error) => (
      /JSON-emitting CLI.*process\.exit|process\.exit.*piped JSON|pipe.*drain/i.test(error)
    )), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing registered JSON CLI entrypoint fails closed with its identity', () => {
  const root = fixture();
  const entry = JSON_CLI_ENTRYPOINTS[0];
  try {
    fs.rmSync(path.join(root, entry.path));
    const result = main(root);
    assert.ok(result.errors.some((error) => (
      error.includes(`${entry.name} JSON-emitting CLI entry point is missing`)
    )), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('validate-json-cli-termination');
