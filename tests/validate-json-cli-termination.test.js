'use strict';

// Structural regression guard for the repository-owned JSON CLI termination
// policy. The defect is invisible on the CI Runtime Baseline because newer
// Node runtimes drain stdout before exit, so this test deliberately checks the
// source contract rather than attempting a behavioural pipe-size reproduction.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { main } = require('../scripts/ci/validate-json-cli-termination');

const ROOT = path.join(__dirname, '..');
const ENTRYPOINTS = [
  'scripts/dhpk-install.js',
  'scripts/dhpk-harness.js',
  'skills/skill-scope/scripts/skill-lint.js',
  'scripts/release/source-gate.js',
];

function fixture(mutator = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-json-cli-termination-'));
  for (const relativePath of ENTRYPOINTS) {
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

run('validate-json-cli-termination');
