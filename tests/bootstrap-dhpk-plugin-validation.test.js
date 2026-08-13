'use strict';

// Regression coverage for issue #164. The bootstrap docs describe two
// publication surfaces; this test keeps their validator commands from being
// accidentally interchangeable. It is intentionally static and offline.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const TASKS = 'docs/design/bootstrap-dhpk-plugin/tasks.md';
const SPECS = [
  'docs/design/bootstrap-dhpk-plugin/specs/plugin-manifest/spec.md',
  'docs/design/bootstrap-dhpk-plugin/specs/modules-architecture/spec.md',
  'docs/design/bootstrap-dhpk-plugin/specs/core-harness/spec.md',
];
const NATIVE_CHECKS = [
  'node scripts/ci/verify-codex-native-package.js',
  'node tests/codex-plugin-manifest.test.js',
  'node tests/codex-native-install-smoke.test.js',
];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function claudeValidationCommands(text) {
  return [...text.matchAll(/claude\s+plugin\s+validate[^\n`]*/g)].map((match) => match[0]);
}

test('bootstrap Claude validation targets the canonical root, never the Codex package', () => {
  const documents = [TASKS, ...SPECS];
  const commands = documents.flatMap((relative) => claudeValidationCommands(read(relative)));
  assert.ok(commands.length > 0, 'expected at least one Claude strict-validation command');
  for (const command of commands) {
    assert.doesNotMatch(command, /plugins\/dhpk(?:\/|\s|$)/,
      `Claude validator must not target the Codex-native package: ${command}`);
  }
  assert.match(read(TASKS), /claude plugin validate ~\/projects\/dhpk --strict/,
    'bootstrap checklist must retain the canonical checkout-root command');
});

test('bootstrap checklist names native validators for plugins/dhpk', () => {
  const tasks = read(TASKS);
  for (const command of NATIVE_CHECKS) {
    assert.ok(tasks.includes(command), `bootstrap checklist missing native check: ${command}`);
  }
  assert.match(tasks, /plugins\/dhpk\/[^\n]*(?:Codex|native)/i,
    'native checks must be tied to the plugins/dhpk artifact');
});

test('affected bootstrap specs preserve the Claude/Codex surface boundary', () => {
  for (const relative of SPECS) {
    const text = read(relative);
    assert.ok(text.includes('plugins/dhpk/'), `${relative} must identify the native package`);
    assert.match(text, /canonical (?:repository )?(?:checkout )?root|Codex-native/i,
      `${relative} must name the owning validation surface`);
    for (const command of NATIVE_CHECKS) {
      assert.ok(text.includes(command), `${relative} must name native check: ${command}`);
    }
  }
});

run('bootstrap-dhpk-plugin-validation');
