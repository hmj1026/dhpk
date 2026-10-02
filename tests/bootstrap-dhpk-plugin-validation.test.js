'use strict';

// The plugin-development guide keeps the canonical Claude root validator
// distinct from the Codex-native artifact validators.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GUIDANCE = 'docs/agent-guidance/plugin-development.md';
const CLAUDE_ROOT_COMMAND = 'claude plugin validate ~/projects/dhpk --strict';
const NATIVE_CHECKS = [
  'node scripts/ci/verify-codex-native-package.js',
  'node tests/codex-native-package-validate.test.js',
  'node tests/codex-native-install-smoke.test.js',
];

function readGuidance() {
  return fs.readFileSync(path.join(ROOT, GUIDANCE), 'utf8');
}

function claudeValidationCommands(text) {
  return [...text.matchAll(/claude\s+plugin\s+validate[^\n`]*/g)].map((match) => match[0]);
}

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notStrictEqual(start, -1, `missing guidance section: ${heading}`);
  const content = text.slice(start + heading.length);
  const nextHeading = content.search(/\n#{1,3} /);
  return nextHeading === -1 ? content : content.slice(0, nextHeading);
}

test('Claude strict validation targets the canonical root, never the Codex package', () => {
  const text = readGuidance();
  const commands = claudeValidationCommands(text);
  assert.ok(commands.length > 0, 'expected at least one Claude strict-validation command');
  for (const command of commands) {
    assert.doesNotMatch(command, /plugins\/dhpk(?:\/|\s|$)/,
      `Claude validator must not target the Codex-native package: ${command}`);
  }
  assert.ok(text.includes(CLAUDE_ROOT_COMMAND),
    'plugin guide must retain the canonical checkout-root command');
});

test('Codex-native validation names all three checks for plugins/dhpk', () => {
  const nativeSection = section(readGuidance(), '### Codex-native package validation');
  assert.match(nativeSection, /plugins\/dhpk\//,
    'native checks must identify the plugins/dhpk artifact');
  for (const command of NATIVE_CHECKS) {
    assert.ok(nativeSection.includes(command), `plugin guide missing native check: ${command}`);
  }
});

test('the guide assigns Claude and Codex validators to separate publication roots', () => {
  const text = readGuidance();
  const claudeSection = section(text, '### Claude validation (canonical root)');
  const nativeSection = section(text, '### Codex-native package validation');
  assert.match(claudeSection, /claude plugin validate ~\/projects\/dhpk --strict/);
  assert.ok(NATIVE_CHECKS.every((command) => !claudeSection.includes(command)));
  assert.match(nativeSection, /Codex-native.*plugins\/dhpk|plugins\/dhpk.*Codex-native/i);
  assert.doesNotMatch(nativeSection, /claude plugin validate/);
});

run('bootstrap-dhpk-plugin-validation');
