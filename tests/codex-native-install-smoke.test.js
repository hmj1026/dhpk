'use strict';

// Task 4.1/4.2: clean temporary marketplace install/cache smoke test for the
// EXACT TRACKED codex-native publication artifact at plugins/dhpk/ — copies
// that real tracked tree (not a freshly materialized candidate) into a local
// Codex marketplace inside a fully sandboxed CODEX_HOME (never touches the
// real user ~/.codex), installs it via the actual `codex` CLI, then DELETES
// the staged source tree entirely and verifies every expected codex-native
// skill name is still discoverable as a REAL file (not a symlink) from the
// installed cache alone — this is the exact acceptance criterion from GitHub
// issue #88: "A clean temporary Codex plugin install loads all declared
// skills without symlink targets," now proven against the artifact a
// consumer actually installs, not a staged candidate generated separately
// from it (spec.md: "Consumer proof validates the exact publication
// artifact"). Skips (does not fail) when the `codex` CLI is unavailable,
// since CI environments may not have it installed — this is a live-CLI
// integration test, not a fallback substitute for it.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

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

const trackedPluginDir = path.join(ROOT, 'plugins', 'dhpk');
const trackedManifest = JSON.parse(fs.readFileSync(path.join(trackedPluginDir, '.codex-plugin', 'plugin.json'), 'utf8'));
const trackedProvenance = JSON.parse(fs.readFileSync(path.join(trackedPluginDir, 'provenance.json'), 'utf8'));
const expectedSkillNames = [...trackedProvenance.selectedSkillNames].sort();

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-smoke-stage-'));
const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-smoke-home-'));
const marketName = 'dhpk-smoke-market';
const pluginName = trackedManifest.name;

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
// repo's own marketplace-target-wrapper convention. Copies the EXACT tracked
// artifact rather than materializing a fresh candidate — a candidate
// generated separately from the publication artifact does not satisfy the
// consumer-proof requirement (spec.md).
const pluginDir = path.join(stageRoot, 'plugins', pluginName);
fs.mkdirSync(path.dirname(pluginDir), { recursive: true });
fs.cpSync(trackedPluginDir, pluginDir, { recursive: true });

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
// Machine-parseable evidence line for callers (e.g. consumer-gate.js) that
// capture this test's stdout to record the exact cache path in release
// evidence (task 3.3) without depending on the CLI's human-readable phrasing.
if (installedRoot) console.log(`CODEX_NATIVE_INSTALLED_ROOT=${installedRoot}`);

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

test('every expected codex-native skill materialized as a real (non-symlink) file in the installed cache after the source checkout is deleted', () => {
  const installedSkillsDir = path.join(installedRoot, 'skills');
  assert.ok(fs.existsSync(installedSkillsDir), `installed skills/ directory missing at ${installedSkillsDir}`);

  const installedNames = fs.readdirSync(installedSkillsDir).sort();
  assert.deepStrictEqual(installedNames, expectedSkillNames, 'installed skill directory names must exactly match the tracked codex-native public-name set');

  assert.deepStrictEqual(findSymlinks(installedRoot), [], 'installed cache must contain zero symlinks');

  for (const name of expectedSkillNames) {
    const skillMd = path.join(installedSkillsDir, name, 'SKILL.md');
    assert.ok(fs.existsSync(skillMd) && fs.statSync(skillMd).size > 0, `${name}/SKILL.md missing or empty in installed cache`);
  }
});

run('codex-native-install-smoke');
