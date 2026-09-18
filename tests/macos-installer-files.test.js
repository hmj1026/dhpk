'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { MACOS_INSTALLER_FILES } = require('./_lib/macos-installer-files');

const ROOT = path.join(__dirname, '..');

test('Darwin installer subset lists existing files and private-tmp env for audit and consumer-gate', () => {
  const files = MACOS_INSTALLER_FILES.map((entry) => entry.file);
  assert.deepStrictEqual(files, [
    'tests/install-codex-skills.test.js',
    'tests/install-codex-skills-reconciliation.test.js',
    'tests/install-codex-skills-planning.test.js',
    'tests/install-codex-skills-uninstall.test.js',
    'tests/install-cursor-harness.test.js',
    'tests/cli-dispatch-launcher.test.js',
    'tests/install.test.js',
    'tests/session-usage-audit.test.js',
    'tests/consumer-gate-cli.test.js',
    'tests/multi-ai-sync-agy-platform.test.js',
    'tests/run-bounded-node-test.test.js',
  ]);
  for (const entry of MACOS_INSTALLER_FILES) {
    assert.ok(fs.existsSync(path.join(ROOT, entry.file)), entry.file);
  }
  const tmpdirFiles = MACOS_INSTALLER_FILES
    .filter((entry) => entry.env && entry.env.TMPDIR === '/private/tmp')
    .map((entry) => entry.file);
  assert.deepStrictEqual(tmpdirFiles, [
    'tests/session-usage-audit.test.js',
    'tests/consumer-gate-cli.test.js',
  ]);
});

test('macos-installer job runs the shared installer subset list', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = workflow.split(/\n  macos-installer:\n/)[1];
  assert.ok(job, 'ci.yml must define macos-installer');
  const untilLint = job.split(/\n  lint:\n/)[0];
  assert.match(untilLint, /run: node tests\/_lib\/macos-installer-files\.js/);
  assert.doesNotMatch(untilLint, /run: node tests\/install-codex-skills\.test\.js/);
});

run('macos-installer-files');
