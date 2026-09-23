'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { compileClaudeCapabilityBundle } = require('../scripts/lib/claude-capability-bundle');

const ROOT = path.join(__dirname, '..');

test('profile bundle generator checks a declared finite alias', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'minimal', '--check',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"profile"/);
  assert.match(result.stdout, /"planFingerprint"/);
});

test('minimal generator reports the curated default selection', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'minimal', '--check',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.deepStrictEqual(payload.selectedStableIds, [
    'change-verdict',
    'code-trace',
    'flow-drive',
    'flow-guide',
  ]);
});

test('compat-v1 generator preserves the predecessor-compatible allowlist', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'compat-v1', '--check',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.selectedStableIds.length, 81);
  assert.ok(!payload.selectedStableIds.includes('opsx-post-obs'));
  assert.strictEqual(payload.compatibilityMode, 'compat-v1');
});

test('minimal generator materializes only curated skills and command roots', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-profile-generator-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'),
      '--profile', 'minimal', '--out', outputRoot,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const packageRoot = path.join(outputRoot, 'package');
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'plugin.json'), 'utf8'));
    assert.deepStrictEqual(manifest.skills, ['./skills/']);
    assert.deepStrictEqual(manifest.commands, ['./commands/']);
    const commands = fs.readdirSync(path.join(packageRoot, 'commands')).sort();
    assert.deepStrictEqual(commands, ['smart-commit.md', 'verify.md']);
    assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'flow-guide', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'flow-drive', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'change-verdict', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(packageRoot, 'skills', 'code-trace', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(packageRoot, 'skills', 'dhpk-codebase-exploration', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(packageRoot, 'commands', 'codex-review.md')));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('minimal profile keeps command owners in support closure without publishing them publicly', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/install-profiles.json'), 'utf8'));
  const moduleCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/module-catalog.json'), 'utf8'));
  const result = compileClaudeCapabilityBundle({
    root: ROOT,
    inventory,
    profiles,
    moduleCatalog,
    profileId: 'minimal',
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.deepStrictEqual(result.value.selection.selectedStableIds, [
    'change-verdict',
    'code-trace',
    'flow-drive',
    'flow-guide',
  ]);
  assert.ok(result.value.selection.supportClosure.skillStableIds.includes('git-smart-commit'));
  assert.ok(result.value.selection.supportClosure.skillStableIds.includes('repo-verify'));
});

run('gen-claude-profile-bundles');
