'use strict';

// Behavioral guard for scripts/ci/validate-plugin.js: every path declared in
// .claude-plugin/plugin.json (agents/skills/commands) must resolve on disk,
// and every on-disk agent file must be registered (reverse check).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-plugin-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writePluginJson(tmp, plugin) {
  const dir = path.join(tmp, '.claude-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin, null, 2));
}

function runValidator(tmp) {
  const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-plugin.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo plugin.json passes validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-plugin.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('missing plugin.json fails', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /plugin\.json not found/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('invalid JSON fails', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '{ not valid json');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /invalid JSON/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing agents[] file fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', agents: ['agents/ghost.md'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /agents\[\] — missing file: agents\/ghost\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing skills[] directory fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', skills: ['skills/ghost'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /skills\[\] — missing directory: skills\/ghost/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing commands[] path fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', commands: ['commands/ghost.md'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /commands\[\] — missing path: commands\/ghost\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-semver version warns but does not fail (non-strict)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: 'not-a-version' });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /is not semver/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unregistered on-disk agent file fails (reverse check)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', agents: [] });
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'stray.md'), '# stray agent\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unregistered agent file on disk: agents\/stray\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a fully self-consistent minimal plugin passes', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'a.md'), '# a\n');
    fs.mkdirSync(path.join(tmp, 'skills', 's'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 's', 'SKILL.md'), '# s\n');
    fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'commands', 'c.md'), '# c\n');
    writePluginJson(tmp, {
      version: '1.0.0',
      agents: ['agents/a.md'],
      skills: ['skills/s'],
      commands: ['commands/c.md'],
    });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-plugin');
