'use strict';

// plugin.json declares the assets Claude Code loads at install time. Every
// declared path must exist on disk, or the published plugin is broken.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const resolve = (p) => path.join(ROOT, p.replace(/^\.\//, ''));

test('plugin.json has a semver version', () => {
  assert.match(plugin.version, /^\d+\.\d+\.\d+/, `version='${plugin.version}'`);
});

test('every agents[] path exists as a file', () => {
  for (const a of plugin.agents || []) {
    assert.ok(fs.existsSync(resolve(a)), `missing agent file: ${a}`);
  }
});

test('every skills[] path exists as a directory', () => {
  for (const s of plugin.skills || []) {
    assert.ok(fs.existsSync(resolve(s)), `missing skills dir: ${s}`);
  }
});

test('every commands[] path exists', () => {
  for (const c of plugin.commands || []) {
    assert.ok(fs.existsSync(resolve(c)), `missing commands path: ${c}`);
  }
});

run('plugin-manifest');
