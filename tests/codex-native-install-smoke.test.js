'use strict';

// Task 3.3: clean temporary marketplace install/cache smoke test. Materializes
// the real promoted-only physical package (task 3.2), stages it as a local Codex
// marketplace inside a fully sandboxed CODEX_HOME (never touches the real user
// ~/.codex), installs it via the actual `codex` CLI, then DELETES the staged
// source tree entirely and verifies every expected promoted skill name is still
// discoverable as a REAL file (not a symlink) from the installed cache alone —
// this is the exact acceptance criterion from GitHub issue #88: "A clean
// temporary Codex plugin install loads all declared skills without symlink
// targets." Skips (does not fail) when the `codex` CLI is unavailable, since CI
// environments may not have it installed — this is a live-CLI integration test,
// not a fallback substitute for it.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeNativePackage } = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');

function codexAvailable() {
  const res = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  return res.status === 0;
}

function findSymlinks(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) found.push(fp);
    else if (entry.isDirectory()) found.push(...findSymlinks(fp));
  }
  return found;
}

if (!codexAvailable()) {
  console.log('SKIP - codex CLI not found on PATH; codex-native-install-smoke requires a live codex binary');
  console.log('codex-native-install-smoke: 0/0 passed (skipped)');
  process.exit(0);
}

const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-smoke-stage-'));
const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-smoke-home-'));
const marketName = 'dhpk-smoke-market';
const pluginName = 'dhpk-smoke';

process.on('exit', () => {
  for (const d of [stageRoot, codexHome]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function codex(args) {
  return spawnSync('codex', args, { encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome } });
}

// Stage a local marketplace: .agents/plugins/marketplace.json pointing at a
// concrete plugin subdirectory (codex refuses a marketplace root of "./" —
// see plugins/dhpk/README.md and openai/codex#26037), matching the real
// repo's own marketplace-target-wrapper convention.
const pluginDir = path.join(stageRoot, 'plugins', pluginName);
const materialized = materializeNativePackage({ inventory, root: ROOT, outDir: pluginDir, name: pluginName, version: '0.0.1-smoke' });

fs.mkdirSync(path.join(stageRoot, '.agents', 'plugins'), { recursive: true });
fs.writeFileSync(
  path.join(stageRoot, '.agents', 'plugins', 'marketplace.json'),
  JSON.stringify({
    name: marketName,
    plugins: [{ name: pluginName, source: { source: 'local', path: `./plugins/${pluginName}` } }],
  }, null, 2)
);

const addMarket = codex(['plugin', 'marketplace', 'add', stageRoot]);
test('codex plugin marketplace add succeeds against the staged package', () => {
  assert.strictEqual(addMarket.status, 0, addMarket.stdout + addMarket.stderr);
});

const addPlugin = codex(['plugin', 'add', `${pluginName}@${marketName}`]);
test('codex plugin add installs the staged package', () => {
  assert.strictEqual(addPlugin.status, 0, addPlugin.stdout + addPlugin.stderr);
});

const installedRootMatch = /Installed plugin root: (.+)/.exec(addPlugin.stdout || '');
const installedRoot = installedRootMatch ? installedRootMatch[1].trim() : null;

test('the CLI reports an installed cache root distinct from the staged source, inside the sandboxed CODEX_HOME', () => {
  assert.ok(installedRoot, `could not parse installed plugin root from:\n${addPlugin.stdout}`);
  assert.notStrictEqual(installedRoot, pluginDir);
  // Defense-in-depth: if `codex` ever silently ignored CODEX_HOME and fell
  // back to the real ~/.codex, this would still report SOME installed root —
  // assert it is actually inside our sandbox, not just "not the deleted stage
  // dir", so a broken sandbox fails loudly here instead of quietly installing
  // into the user's real Codex state.
  assert.ok(
    path.resolve(installedRoot).startsWith(`${path.resolve(codexHome)}${path.sep}`),
    `installed root '${installedRoot}' is not inside the sandboxed CODEX_HOME '${codexHome}'`
  );
});

// Withhold the source checkout entirely — the crux of issue #88.
fs.rmSync(stageRoot, { recursive: true, force: true });

test('every expected promoted skill materialized as a real (non-symlink) file in the installed cache after the source checkout is deleted', () => {
  const installedSkillsDir = path.join(installedRoot, 'skills');
  assert.ok(fs.existsSync(installedSkillsDir), `installed skills/ directory missing at ${installedSkillsDir}`);

  const installedNames = fs.readdirSync(installedSkillsDir).sort();
  assert.deepStrictEqual(installedNames, materialized.skillIds, 'installed skill directory names must exactly match the promoted set');

  assert.deepStrictEqual(findSymlinks(installedRoot), [], 'installed cache must contain zero symlinks');

  for (const id of materialized.skillIds) {
    const skillMd = path.join(installedSkillsDir, id, 'SKILL.md');
    assert.ok(fs.existsSync(skillMd) && fs.statSync(skillMd).size > 0, `${id}/SKILL.md missing or empty in installed cache`);
  }
});

run('codex-native-install-smoke');
