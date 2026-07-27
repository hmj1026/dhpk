'use strict';

// Task 2.4: a manual .claude-plugin/plugin.json skills[] registration that
// bypasses the distribution inventory must fail `gen-claude-manifest.js --check`.
// Runs against a faithful temp copy so the real repo files are never mutated.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-gen-claude-manifest-'));
  for (const rel of ['scripts', 'manifests', '.claude-plugin']) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

function runCheck(repo) {
  const res = spawnSync('node', [path.join(repo, 'scripts', 'ci', 'gen-claude-manifest.js'), '--check'], { encoding: 'utf8' });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

const repo = makeTempRepo();
process.on('exit', () => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best effort */ } });

test('faithful temp copy passes --check as-is', () => {
  const { status, out } = runCheck(repo);
  assert.strictEqual(status, 0, `baseline temp copy should pass --check, got:\n${out}`);
});

test('an extra manually-added root not backed by the inventory fails --check', () => {
  const pluginPath = path.join(repo, '.claude-plugin', 'plugin.json');
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  plugin.skills.push('./modules/totally-manual-addition/skills/');
  fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));

  const { status, out } = runCheck(repo);
  assert.notStrictEqual(status, 0, 'an inventory-unbacked root should fail --check');
  assert.match(out, /totally-manual-addition/);
});

test('a manually-removed root that the inventory still expects fails --check', () => {
  const pluginPath = path.join(repo, '.claude-plugin', 'plugin.json');
  const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
  plugin.skills = plugin.skills.filter((s) => s !== './skills/');
  fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2));

  const { status, out } = runCheck(repo);
  assert.notStrictEqual(status, 0, 'dropping an inventory-expected root should fail --check');
  assert.match(out, /\.\/skills\//);
});

run('gen-claude-manifest');
