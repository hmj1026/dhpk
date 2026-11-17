'use strict';

// Coverage for check-plugin-version.sh (SessionStart advisory):
//   - no pin file → silent no-op
//   - running version matches "verified" range → silent
//   - running version matches "incompatible" range → advisory printed
//   - running version matches neither → "(unverified)" advisory

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'check-plugin-version.sh');

function mkScratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk cpv ')));
}

// Package fixture: a copy of the hook and the _lib files it sources next to its own plugin.json,
// so the hook resolves its owning package (ADR 0038), not CLAUDE_PLUGIN_ROOT.
function mkPluginRoot(version) {
  const dir = mkScratch();
  const hooks = path.join(dir, 'scripts', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.copyFileSync(HOOK, path.join(hooks, 'check-plugin-version.sh'));
  fs.mkdirSync(path.join(hooks, '_lib'));
  for (const lib of ['session-env.sh', 'plugin-root.sh']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', 'hooks', '_lib', lib), path.join(hooks, '_lib', lib));
  }
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ version })
  );
  return dir;
}

function writePinFile(projectDir, pins) {
  fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'dhpk-versions.json'),
    JSON.stringify(pins)
  );
}

function runHook(projectDir, pluginRoot, envRoot) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  if (envRoot !== undefined) env.CLAUDE_PLUGIN_ROOT = envRoot;
  else delete env.CLAUDE_PLUGIN_ROOT;
  const script = path.join(pluginRoot, 'scripts', 'hooks', 'check-plugin-version.sh');
  return spawnSync('bash', [script], { cwd: projectDir, env, encoding: 'utf8', timeout: 10000 });
}

test('no pin file present → silent no-op, exit 0', () => {
  const project = mkScratch();
  const plugin = mkPluginRoot('0.10.5');
  try {
    const res = runHook(project, plugin);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.strictEqual(res.stdout.trim(), '', `expected silent stdout, got: ${res.stdout}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('running version matches verified range → silent, no advisory', () => {
  const project = mkScratch();
  const plugin = mkPluginRoot('0.10.5');
  writePinFile(project, { verified: [{ range: '0.10.x', note: 'ok' }], incompatible: [] });
  try {
    const res = runHook(project, plugin);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stdout.includes('advisory'), `expected no advisory, got: ${res.stdout}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('running version matches incompatible range → advisory printed', () => {
  const project = mkScratch();
  const plugin = mkPluginRoot('0.3.0');
  writePinFile(project, { verified: [{ range: '0.10.x' }], incompatible: [{ range: '0.3', note: 'broken' }] });
  try {
    const res = runHook(project, plugin);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('0.3.0(incompatible)'),
      `expected incompatible advisory, got: ${res.stdout}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('running version matches neither list → "(unverified)" advisory', () => {
  const project = mkScratch();
  const plugin = mkPluginRoot('0.99.0');
  writePinFile(project, { verified: [{ range: '0.10.x' }], incompatible: [{ range: '0.3' }] });
  try {
    const res = runHook(project, plugin);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('0.99.0(unverified)'),
      `expected unverified advisory, got: ${res.stdout}`);
    assert.ok(res.stdout.includes('realpath .claude/dhpk-versions.json'),
      `expected symlink-safe write guidance, got: ${res.stdout}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('foreign CLAUDE_PLUGIN_ROOT does not supply the running version', () => {
  const project = mkScratch();
  const plugin = mkPluginRoot('0.99.0');
  const foreign = mkScratch();
  fs.mkdirSync(path.join(foreign, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(foreign, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'foreign-fixture', version: '999.0.0' })
  );
  writePinFile(project, { verified: [{ range: '0.10.x' }], incompatible: [] });
  try {
    const res = runHook(project, plugin, foreign);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stdout.includes('999.0.0'), `foreign version leaked: ${res.stdout}`);
    assert.ok(res.stdout.includes('0.99.0(unverified)'), `expected own version, got: ${res.stdout}`);
  } finally {
    for (const d of [project, plugin, foreign]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('hook run through a symlink reads its physical package version', () => {
  const project = mkScratch();
  const plugin = mkPluginRoot('0.99.0');
  const linkDir = mkScratch();
  writePinFile(project, { verified: [{ range: '0.10.x' }], incompatible: [] });
  try {
    const link = path.join(linkDir, 'cpv-link.sh');
    fs.symlinkSync(path.join(plugin, 'scripts', 'hooks', 'check-plugin-version.sh'), link);
    const env = { ...process.env, CLAUDE_PROJECT_DIR: project };
    delete env.CLAUDE_PLUGIN_ROOT;
    const res = spawnSync('bash', [link], { cwd: project, env, encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('0.99.0(unverified)'), `got: ${res.stdout}`);
  } finally {
    for (const d of [project, plugin, linkDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

run('check-plugin-version');
