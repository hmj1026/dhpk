'use strict';

// Coverage for post-edit-dispatch.sh (PostToolUse Edit|Write|MultiEdit
// dispatcher): runs only the core post-edit-remind.sh synchronously. Module
// activation may influence sentinel routing, but default lifecycle wiring must
// not launch advisory per-file module work in the edit pipeline.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo: mkRepoRaw, sessionsDir: sessDir, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'post-edit-dispatch.sh';

test('default post-edit dispatcher contains no advisory module hook fan-out', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'hooks', HOOK), 'utf8');
  assert.ok(!source.includes('hooks/"post-edit-*.sh'),
    'default PostToolUse must not execute advisory module post-edit hooks');
});

function mkRepo() {
  return mkRepoRaw({ prefix: 'dhpk-ped-' });
}

function runHook(repo, filePath, extraEnv = {}) {
  return runHookRaw(HOOK, {
    payload: { tool_input: { file_path: filePath } },
    cwd: repo,
    projectDir: repo,
    deleteEnv: ['DHPK_ACTIVE_MODULES'],
    env: extraEnv,
  });
}

test('editing a .php file synchronously arms the code-reviewer sentinel', () => {
  const repo = mkRepo();
  try {
    const phpFile = path.join(repo, 'Foo.php');
    fs.writeFileSync(phpFile, '<?php class Foo {}\n');
    const res = runHook(repo, phpFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(fs.existsSync(path.join(sessDir(repo), '.pending-review')),
      'expected .pending-review sentinel to be armed synchronously');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('editing a .md file arms the doc-reviewer sentinel, not the code sentinel', () => {
  const repo = mkRepo();
  try {
    const mdFile = path.join(repo, 'README.md');
    fs.writeFileSync(mdFile, '# hi\n');
    const res = runHook(repo, mdFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(fs.existsSync(path.join(sessDir(repo), '.pending-doc-review')),
      'expected .pending-doc-review sentinel to be armed');
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')),
      'expected .pending-review (code) sentinel NOT armed for a doc-only edit');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('no active modules → dispatcher exits with the core hook exit code (0)', () => {
  const repo = mkRepo();
  try {
    const phpFile = path.join(repo, 'Bar.php');
    fs.writeFileSync(phpFile, '<?php class Bar {}\n');
    const res = runHook(repo, phpFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('self-edit under .claude/artifacts/ does not arm any sentinel', () => {
  const repo = mkRepo();
  try {
    const artifactFile = path.join(repo, '.claude', 'artifacts', 'reviews', 'report.md');
    fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
    fs.writeFileSync(artifactFile, '# report\n');
    const res = runHook(repo, artifactFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const dir = sessDir(repo);
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.strictEqual(entries.filter((e) => e.startsWith('.pending-')).length, 0,
      `expected no pending sentinel from a self-edit, got: ${entries}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('post-edit-dispatch');
