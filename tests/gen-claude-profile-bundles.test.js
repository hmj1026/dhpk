'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

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
  assert.strictEqual(payload.selectedStableIds.length, 10);
  assert.ok(payload.selectedStableIds.includes('code-trace'));
  assert.ok(payload.selectedStableIds.includes('flow-drive'));
  assert.ok(payload.selectedStableIds.includes('flow-guide'));
  assert.ok(payload.selectedStableIds.includes('change-verdict'));
  assert.ok(!payload.selectedStableIds.includes('code-explore'));
  assert.ok(payload.selectedStableIds.includes('project-audit'));
});

test('compat-v1 generator preserves the predecessor-compatible allowlist', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'compat-v1', '--check',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.selectedStableIds.length, 71);
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

run('gen-claude-profile-bundles');
