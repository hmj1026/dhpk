'use strict';

// Coverage for scripts/version-diff.sh — read-only, advisory-only helper that
// diffs the running plugin version against .claude/dhpk-versions.json,
// surfacing config schema drift and CHANGELOG excerpts. Always exits 0.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'version-diff.sh');

function mkFixture() {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'version-diff-plugin-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'version-diff-project-'));
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  return { pluginRoot, projectRoot };
}

function writePluginJson(pluginRoot, version, userConfig) {
  fs.writeFileSync(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ version, userConfig: userConfig || {} }, null, 2)
  );
}

function writePins(projectRoot, pins) {
  fs.writeFileSync(path.join(projectRoot, '.claude', 'dhpk-versions.json'), JSON.stringify(pins, null, 2));
}

function runScript(pluginRoot, projectRoot, args) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: projectRoot };
  return spawnSync('bash', [SCRIPT, ...(args || [])], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('no python3 required flow: missing plugin.json exits 0 with a clear message', () => {
  const { pluginRoot, projectRoot } = mkFixture();
  try {
    writePins(projectRoot, { verified: [] });
    const res = runScript(pluginRoot, projectRoot);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stderr.includes('plugin.json not found') || res.stderr.includes('not found'), res.stderr);
  } finally {
    cleanup(pluginRoot, projectRoot);
  }
});

test('no pin file: exits 0 with "nothing to diff against"', () => {
  const { pluginRoot, projectRoot } = mkFixture();
  try {
    writePluginJson(pluginRoot, '0.30.0');
    const res = runScript(pluginRoot, projectRoot);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stderr.includes('nothing to diff against'), res.stderr);
  } finally {
    cleanup(pluginRoot, projectRoot);
  }
});

test('running version already verified: prints OK and stops', () => {
  const { pluginRoot, projectRoot } = mkFixture();
  try {
    writePluginJson(pluginRoot, '0.30.5');
    writePins(projectRoot, { verified: [{ range: '0.30.x', note: 'checked' }] });
    const res = runScript(pluginRoot, projectRoot);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('OK'), res.stdout);
    assert.ok(res.stdout.includes('already covered'), res.stdout);
  } finally {
    cleanup(pluginRoot, projectRoot);
  }
});

test('running version marked incompatible: prints warning and stops', () => {
  const { pluginRoot, projectRoot } = mkFixture();
  try {
    writePluginJson(pluginRoot, '0.29.1');
    writePins(projectRoot, { verified: [], incompatible: [{ range: '0.29.x', note: 'broken hook' }] });
    const res = runScript(pluginRoot, projectRoot);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('INCOMPATIBLE'), res.stdout);
  } finally {
    cleanup(pluginRoot, projectRoot);
  }
});

test('unverified version: reports config schema diff, changelog excerpt, and draft snippet', () => {
  const { pluginRoot, projectRoot } = mkFixture();
  try {
    writePluginJson(pluginRoot, '0.31.0', {
      known_key: { description: 'still valid' },
      brand_new_key: { description: 'added in 0.31' },
    });
    fs.writeFileSync(
      path.join(pluginRoot, 'CHANGELOG.md'),
      '# Changelog\n\n## 0.31.0\n- new feature\n\n## 0.30.0\n- old stuff\n'
    );
    fs.writeFileSync(
      path.join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ pluginConfigs: { 'dhpk@dhpk': { options: { known_key: true, renamed_key: true } } } })
    );
    writePins(projectRoot, { verified: [{ range: '0.30.x', note: 'checked' }] });
    const res = runScript(pluginRoot, projectRoot);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('NOT covered by any verified range'), res.stdout);
    assert.ok(res.stdout.includes('renamed_key'), res.stdout);
    assert.ok(res.stdout.includes('brand_new_key'), res.stdout);
    assert.ok(res.stdout.includes('## 0.31.0'), res.stdout);
    assert.ok(!res.stdout.includes('## 0.30.0'), res.stdout);
    assert.ok(res.stdout.includes('Draft verified-entry'), res.stdout);
    assert.ok(res.stdout.includes('"range": "0.31.x"'), res.stdout);
  } finally {
    cleanup(pluginRoot, projectRoot);
  }
});

test('unknown flag prints usage to stderr and exits 0 (advisory-only design)', () => {
  const { pluginRoot, projectRoot } = mkFixture();
  try {
    writePluginJson(pluginRoot, '0.30.0');
    const res = runScript(pluginRoot, projectRoot, ['--bogus']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stderr.includes('usage:'), res.stderr);
  } finally {
    cleanup(pluginRoot, projectRoot);
  }
});

run('version-diff');
