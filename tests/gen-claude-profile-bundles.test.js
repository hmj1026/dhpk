'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { compileClaudeCapabilityBundle } = require('../scripts/lib/claude-capability-bundle');

const ROOT = path.join(__dirname, '..');

test('profile bundle generator previews a declared finite alias plan', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'minimal', '--plan',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"profile"/);
  assert.match(result.stdout, /"planFingerprint"/);
});

test('minimal generator reports the curated default selection', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'minimal', '--plan',
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
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'compat-v1', '--plan',
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

const GENERATOR = path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js');

function runGenerator(args) {
  return spawnSync(process.execPath, [GENERATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function withCommittedMinimalCopy(mutate) {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-profile-check-'));
  try {
    fs.cpSync(path.join(ROOT, 'generated/claude-profiles/minimal'), outputRoot, { recursive: true });
    mutate(path.join(outputRoot, 'package'));
    return runGenerator(['--profile', 'minimal', '--check', '--out', outputRoot]);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

test('--check passes when the committed minimal profile matches its sources', () => {
  const result = runGenerator(['--profile', 'minimal', '--check']);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS \[gen-claude-profile-bundles\]/);
});

test('--check fails and names a stale skill copy', () => {
  const result = withCommittedMinimalCopy((packageRoot) => {
    fs.appendFileSync(path.join(packageRoot, 'skills/flow-guide/SKILL.md'), '\nstale\n');
  });
  assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /out of date/);
  assert.match(result.stderr, /changed: skills\/flow-guide\/SKILL\.md/);
});

test('--check fails on extra and missing files', () => {
  const result = withCommittedMinimalCopy((packageRoot) => {
    fs.writeFileSync(path.join(packageRoot, 'skills/extra.md'), 'extra\n');
    fs.rmSync(path.join(packageRoot, 'commands/verify.md'));
  });
  assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /extra: skills\/extra\.md/);
  assert.match(result.stderr, /missing: commands\/verify\.md/);
});

test('--check fails when the baseline package is absent', () => {
  const outputRoot = path.join(os.tmpdir(), `dhpk-claude-profile-absent-${process.pid}`);
  const result = runGenerator(['--profile', 'minimal', '--check', '--out', outputRoot]);
  assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /baseline package is missing/);
  assert.ok(!fs.existsSync(outputRoot));
});

test('--plan and --check are mutually exclusive', () => {
  const result = runGenerator(['--profile', 'minimal', '--plan', '--check']);
  assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /mutually exclusive/);
});

run('gen-claude-profile-bundles');
