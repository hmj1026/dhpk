'use strict';

// A3 (plugin-source-review-coverage): when the working repo IS a plugin source
// (a repo-root .claude-plugin/plugin.json marker), post-edit-remind.sh must arm
// .pending-doc-review for edits to the plugin's OWN repo-root harness dirs
// (agents/ rules/ skills/ agent-traps/ commands/ *.md) — which in consumer mode
// live under .claude/{…}/ and would otherwise arm nothing. Consumer mode
// (no marker) is unchanged; .claude/artifacts/** stays exempt.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'post-edit-remind.sh');

function mkTempRepo({ pluginSource } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-plugsrc-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  if (pluginSource) {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"name":"testplugin"}\n');
  }
  return dir;
}

function runHook(cwd, filePath) {
  const env = { ...process.env };
  delete env.DHPK_ACTIVE_MODULES;
  return spawnSync('bash', [HOOK], {
    cwd,
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env,
    encoding: 'utf8',
  });
}

function docReviewPath(repoDir) {
  return path.join(repoDir, '.claude', 'artifacts', 'sessions', '.pending-doc-review');
}

test('plugin-source mode: repo-root agents/*.md arms .pending-doc-review', () => {
  const repo = mkTempRepo({ pluginSource: true });
  try {
    const res = runHook(repo, path.join(repo, 'agents', 'deep-reasoner.md'));
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(docReviewPath(repo)),
      '.pending-doc-review was NOT armed for a plugin-source repo-root agents/*.md edit');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('plugin-source mode: repo-root rules/*.md arms .pending-doc-review', () => {
  const repo = mkTempRepo({ pluginSource: true });
  try {
    const res = runHook(repo, path.join(repo, 'rules', 'execution-policy.md'));
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(docReviewPath(repo)),
      '.pending-doc-review was NOT armed for a plugin-source repo-root rules/*.md edit');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('consumer mode (no marker): repo-root agents/*.md arms nothing', () => {
  const repo = mkTempRepo({ pluginSource: false });
  try {
    const res = runHook(repo, path.join(repo, 'agents', 'deep-reasoner.md'));
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(docReviewPath(repo)),
      '.pending-doc-review armed for a consumer-mode repo-root agents/*.md edit (should not)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('consumer mode: .claude/agents/*.md still arms .pending-doc-review (unchanged)', () => {
  const repo = mkTempRepo({ pluginSource: false });
  try {
    const res = runHook(repo, path.join(repo, '.claude', 'agents', 'foo.md'));
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(docReviewPath(repo)),
      '.pending-doc-review was NOT armed for a consumer-mode .claude/agents/*.md edit (regression)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('plugin-source mode: .claude/artifacts/** stays exempt', () => {
  const repo = mkTempRepo({ pluginSource: true });
  try {
    const res = runHook(repo, path.join(repo, '.claude', 'artifacts', 'sessions', 'note.md'));
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(docReviewPath(repo)),
      '.pending-doc-review armed for a .claude/artifacts/** write (should be exempt)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('post-edit-remind-plugin-source');
