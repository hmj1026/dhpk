'use strict';

// Coverage for the root package.json command entrypoint: every script target
// exists, the version stays in lockstep with the Claude plugin manifest, and
// the package cannot be published by accident.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SCRIPT_TARGET_RE = /(?:^|\s)(?:node|bash)\s+((?:scripts|tests)\/[^\s;&|]+)/g;

function scriptTargets(command) {
  return [...command.matchAll(SCRIPT_TARGET_RE)].map((match) => match[1]);
}

test('testPackageJson_isPrivate_preventsAccidentalPublish', () => {
  assert.strictEqual(pkg.private, true);
});

test('testPackageJson_version_matchesClaudePluginManifest', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(pkg.version, plugin.version);
});

test('testPackageJson_bin_exposesInstallerWrappers', () => {
  assert.strictEqual(pkg.bin.dhpk, 'bin/dhpk');
  assert.strictEqual(pkg.bin['dhpk-install'], 'bin/dhpk-install');
  for (const target of Object.values(pkg.bin)) {
    assert.ok(fs.existsSync(path.join(ROOT, target)), `${target} does not exist`);
    assert.ok(pkg.files.some((entry) => target.startsWith(entry)), `${target} is not in files`);
  }
});

test('testPackageJson_scripts_avoidNpmLifecycleNames', () => {
  for (const name of ['install', 'preinstall', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack']) {
    assert.strictEqual(pkg.scripts[name], undefined, `${name} would run automatically for package installers`);
  }
});

test('testPackageJson_requiredScripts_cover setup, test, validate, and generate', () => {
  for (const name of ['setup', 'setup:dry-run', 'setup:status', 'dhpk-install', 'test', 'test:hooks', 'validate', 'check:generated', 'catalog:check', 'ci', 'gen:all']) {
    assert.ok(typeof pkg.scripts[name] === 'string', `missing script ${name}`);
  }
});

test('testPackageJson_scriptTargets_allExistOnDisk', () => {
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const target of scriptTargets(command)) {
      assert.ok(fs.existsSync(path.join(ROOT, target)), `${name}: ${target} does not exist`);
    }
  }
});

test('testPackageJson_dependencies_remainZero', () => {
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(pkg.devDependencies, undefined);
});

run('package-json-scripts');
