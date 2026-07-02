'use strict';

// Codex plugin manifests declare the assets Codex CLI's plugin marketplace
// loads at install time. Every declared path must exist on disk and stay in
// version-lockstep with the Claude plugin manifest, or the published Codex
// plugin is broken (see openai/codex#26037 for why a thin marketplace-target
// wrapper is required alongside the canonical root manifest).

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const resolve = (base, p) => path.join(base, p.replace(/^\.\//, ''));

const claudePlugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
const wrapperDir = path.join(ROOT, 'plugins', 'dhpk');
const wrapperManifest = JSON.parse(fs.readFileSync(path.join(wrapperDir, '.codex-plugin', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8'));

test('root .codex-plugin/plugin.json has a semver version', () => {
  assert.match(rootManifest.version, /^\d+\.\d+\.\d+/, `version='${rootManifest.version}'`);
});

test('root .codex-plugin/plugin.json version matches .claude-plugin/plugin.json', () => {
  assert.strictEqual(rootManifest.version, claudePlugin.version);
});

test('root .codex-plugin/plugin.json skills is a string, not an array', () => {
  assert.strictEqual(typeof rootManifest.skills, 'string', `skills=${JSON.stringify(rootManifest.skills)}`);
});

test('root .codex-plugin/plugin.json skills path resolves to an existing directory', () => {
  const dir = resolve(ROOT, rootManifest.skills);
  assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `missing skills dir: ${dir}`);
});

test('thin wrapper plugin.json name/version match the root manifest', () => {
  assert.strictEqual(wrapperManifest.name, rootManifest.name);
  assert.strictEqual(wrapperManifest.version, rootManifest.version);
});

test('thin wrapper skills path resolves to the same directory as the root manifest', () => {
  const wrapperSkillsDir = resolve(wrapperDir, wrapperManifest.skills);
  const rootSkillsDir = resolve(ROOT, rootManifest.skills);
  assert.strictEqual(fs.realpathSync(wrapperSkillsDir), fs.realpathSync(rootSkillsDir));
});

test('thin wrapper does not vendor a duplicate skills/ directory', () => {
  assert.ok(!fs.existsSync(path.join(wrapperDir, 'skills')), 'plugins/dhpk/skills/ should not exist (single-sourced from codex/skills/)');
});

test('marketplace.json plugin version matches the root manifest', () => {
  const entry = marketplace.plugins && marketplace.plugins[0];
  assert.ok(entry, 'marketplace.json has no plugins[0]');
  assert.strictEqual(entry.version, rootManifest.version);
});

test('marketplace.json source.path resolves to a concrete plugin subdirectory, never the repo root', () => {
  const entry = marketplace.plugins[0];
  const sourcePath = fs.realpathSync(resolve(ROOT, entry.source.path));
  assert.notStrictEqual(sourcePath, fs.realpathSync(ROOT), 'source.path must not resolve to the marketplace/repo root (openai/codex#26037)');
  assert.ok(
    fs.existsSync(path.join(sourcePath, '.codex-plugin', 'plugin.json')),
    `${sourcePath} must contain a .codex-plugin/plugin.json`
  );
});

run('codex-plugin-manifest');
