'use strict';

// js-projection-journal stage 4: the Cursor `--plan --json` post-processor.
// The Python shell entry added `cursor_marketplace_hash_cache_drift`
// warnings by scanning ~/.cursor/plugins/cache; the JS adapter does the same
// through addCursorCacheDriftWarnings(). Expectations are written out
// literally from that Python program's behavior.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { addCursorCacheDriftWarnings } = require('../scripts/lib/install-adapters/cursor-plan');
const { installerEnv, runCaptured } = require('../scripts/lib/install-adapters/codex-cli');
const { projectRoot } = require('./_lib/install-codex-skills-fixtures');

const DRIFT_MESSAGE = 'Cursor marketplace hash cache is not SSOT; local packages and the project-local receipt are. Disable/remove the marketplace dhpk plugin in Cursor UI. Do not hand-delete the hash cache unless Cursor has already uninstalled that marketplace plugin.';

function home() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-plan-home-')));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function cacheManifest(dir, hash, content) {
  const file = path.join(dir, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', hash, '.claude-plugin', 'plugin.json');
  write(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

function withHome(body) {
  const dir = home();
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('testCursorPlan_noCacheDirectory_stillWritesAnEmptyWarningsArray', () => withHome((dir) => {
  const report = addCursorCacheDriftWarnings({ plugin_version: '1.0.0', state: 'clean' }, { HOME: dir });
  assert.deepStrictEqual(report, { plugin_version: '1.0.0', state: 'clean', warnings: [] });
}));

test('testCursorPlan_driftedCache_addsOneWarningWithTheExactShape', () => withHome((dir) => {
  const manifest = cacheManifest(dir, 'abc123', { version: '0.1.0' });
  const report = addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: dir });
  assert.deepStrictEqual(report.warnings, [{
    code: 'cursor_marketplace_hash_cache_drift',
    path: manifest,
    cache_version: '0.1.0',
    ssot_versions: ['1.0.0'],
    message: DRIFT_MESSAGE,
  }]);
}));

test('testCursorPlan_cacheMatchingThePluginVersion_addsNothing', () => withHome((dir) => {
  cacheManifest(dir, 'abc123', { version: '1.0.0' });
  assert.deepStrictEqual(addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: dir }).warnings, []);
}));

test('testCursorPlan_localManifestVersions_joinTheSsotAndAreSortedInTheWarning', () => withHome((dir) => {
  write(path.join(dir, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'), JSON.stringify({ version: '2.0.0' }));
  write(path.join(dir, '.cursor', 'plugins', 'local', 'dhpk-cursor', '.cursor-plugin', 'plugin.json'), JSON.stringify({ version: '1.5.0' }));
  cacheManifest(dir, 'matches-local', { version: '2.0.0' });
  const stale = cacheManifest(dir, 'stale', { version: '0.9.0' });
  const report = addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: dir });
  assert.deepStrictEqual(report.warnings.map((item) => [item.path, item.cache_version, item.ssot_versions]), [[stale, '0.9.0', ['1.0.0', '1.5.0', '2.0.0']]]);
}));

test('testCursorPlan_withoutAnySsotVersion_neverWarns', () => withHome((dir) => {
  cacheManifest(dir, 'abc123', { version: '0.1.0' });
  assert.deepStrictEqual(addCursorCacheDriftWarnings({}, { HOME: dir }).warnings, []);
  assert.deepStrictEqual(addCursorCacheDriftWarnings({ plugin_version: '' }, { HOME: dir }).warnings, []);
  assert.deepStrictEqual(addCursorCacheDriftWarnings({ plugin_version: 7 }, { HOME: dir }).warnings, []);
}));

test('testCursorPlan_localManifestAlone_isEnoughToDefineTheSsot', () => withHome((dir) => {
  write(path.join(dir, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'), JSON.stringify({ version: '2.0.0' }));
  cacheManifest(dir, 'stale', { version: '0.9.0' });
  const report = addCursorCacheDriftWarnings({}, { HOME: dir });
  assert.deepStrictEqual(report.warnings.map((item) => item.ssot_versions), [['2.0.0']]);
}));

test('testCursorPlan_severalCaches_areListedInPathOrder', () => withHome((dir) => {
  const second = cacheManifest(dir, 'a', { version: '0.2.0' });
  const first = cacheManifest(dir, 'M', { version: '0.1.0' });
  const third = cacheManifest(dir, 'z', { version: '0.3.0' });
  const report = addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: dir });
  // Code-point order: 'M' sorts before 'a' (a case-insensitive order would not).
  assert.deepStrictEqual(report.warnings.map((item) => item.path), [first, second, third]);
}));

test('testCursorPlan_hiddenCacheDirectories_areSkippedLikeAGlobStar', () => withHome((dir) => {
  cacheManifest(dir, '.hidden', { version: '0.1.0' });
  assert.deepStrictEqual(addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: dir }).warnings, []);
}));

test('testCursorPlan_unusableCacheManifests_areIgnored', () => withHome((dir) => {
  cacheManifest(dir, 'broken', '{not json');
  cacheManifest(dir, 'list', '[1, 2]');
  cacheManifest(dir, 'missing-version', { name: 'dhpk' });
  cacheManifest(dir, 'empty-version', { version: '' });
  cacheManifest(dir, 'numeric-version', { version: 3 });
  fs.mkdirSync(path.join(dir, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', 'no-manifest'), { recursive: true });
  assert.deepStrictEqual(addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: dir }).warnings, []);
}));

test('testCursorPlan_existingWarnings_keepOnlyTheObjects', () => withHome((dir) => {
  const report = addCursorCacheDriftWarnings({ warnings: ['text', 3, null, { code: 'kept' }, ['list']] }, { HOME: dir });
  assert.deepStrictEqual(report.warnings, [{ code: 'kept' }]);
}));

test('testCursorPlan_existingWarningsComeBeforeTheDriftWarnings', () => withHome((dir) => {
  cacheManifest(dir, 'stale', { version: '0.1.0' });
  const report = addCursorCacheDriftWarnings({ plugin_version: '1.0.0', warnings: [{ code: 'kept' }] }, { HOME: dir });
  assert.deepStrictEqual(report.warnings.map((item) => item.code), ['kept', 'cursor_marketplace_hash_cache_drift']);
}));

test('testCursorPlan_homeIsUsedVerbatimInReportedPaths', () => withHome((dir) => {
  cacheManifest(dir, 'stale', { version: '0.1.0' });
  const report = addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, { HOME: `${dir}/` });
  assert.strictEqual(report.warnings[0].path, `${dir}/.cursor/plugins/cache/dhpk/dhpk/stale/.claude-plugin/plugin.json`);
}));

test('testCursorPlan_unsetHome_findsNoCache', () => {
  assert.deepStrictEqual(addCursorCacheDriftWarnings({ plugin_version: '1.0.0' }, {}).warnings, []);
});

test('testCursorPlan_doesNotMutateTheReportItReceives', () => withHome((dir) => {
  cacheManifest(dir, 'stale', { version: '0.1.0' });
  const input = { plugin_version: '1.0.0', warnings: [{ code: 'kept' }] };
  addCursorCacheDriftWarnings(input, { HOME: dir });
  assert.deepStrictEqual(input, { plugin_version: '1.0.0', warnings: [{ code: 'kept' }] });
}));

// The adapter prints the post-processed report: Cursor plans only.
function planOutput(host, dir, project) {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-plan-plugin-')));
  try {
    write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
    write(path.join(plugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({ skills: [], supporting_assets: [] }));
    fs.mkdirSync(path.join(plugin, host), { recursive: true });
    const env = installerEnv({ host, pluginRoot: plugin, installerRoot: path.resolve(__dirname, '..'), projectRoot: project, plan: true, json: true, baseEnv: { ...process.env, HOME: dir } });
    return runCaptured(env);
  } finally {
    fs.rmSync(plugin, { recursive: true, force: true });
  }
}

test('testCursorPlan_adapterPlanJson_carriesTheDriftWarningForCursorOnly', () => withHome((dir) => {
  cacheManifest(dir, 'stale', { version: '0.1.0' });
  const project = projectRoot();
  try {
    const cursor = planOutput('cursor', dir, project);
    assert.strictEqual(cursor.code, 0, cursor.stderr);
    const cursorReport = JSON.parse(cursor.stdout);
    assert.deepStrictEqual(cursorReport.warnings.map((item) => item.code), ['cursor_marketplace_hash_cache_drift']);
    assert.match(cursor.stdout, /^\{\n  "collisions": \[\],\n/, 'indent 2, sorted keys');
    const codex = planOutput('codex', dir, project);
    assert.strictEqual(codex.code, 0, codex.stderr);
    assert.strictEqual((JSON.parse(codex.stdout).warnings || []).some((item) => item.code === 'cursor_marketplace_hash_cache_drift'), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}));

run('install-cursor-plan');
