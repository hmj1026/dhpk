'use strict';

// Regression: stop-completion-evidence.sh must count UNTRACKED new files when
// deciding whether a completion claim has test evidence. Before the fix it read
// only `git diff --name-only HEAD` (tracked/staged), so a brand-new untracked
// test file (the TDD add-a-spec case) was invisible and the hook falsely warned
// "N code file(s) changed with no test changes".
//
// Also covers the companion classifier fix: a `.spec.` SUFFIX (foo.spec.js) is
// now recognized as a test, not just a `spec/` directory.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'stop-completion-evidence.sh';

function mkTempRepo() {
  const dir = mkRepo({ prefix: 'dhpk-ce-', gitConfig: true });
  // Initial commit so HEAD exists (git diff --name-only HEAD needs it).
  writeFile(dir, 'README.md', '# fixture\n');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function writeFile(repo, rel, contents) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

// Commit a file so a later modification is a TRACKED change vs HEAD.
function commitFile(repo, rel, contents) {
  writeFile(repo, rel, contents);
  spawnSync('git', ['add', '--', rel], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', `add ${rel}`], { cwd: repo });
}

// A transcript file (outside the repo, so it never pollutes git status) whose
// last assistant message carries a completion claim.
function writeTranscript() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ce-tx-')));
  const file = path.join(dir, 'transcript.jsonl');
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Implementation done. All good.' }] },
  });
  fs.writeFileSync(file, line + '\n');
  return { dir, file };
}

function runHook(repo, transcriptPath) {
  return runHookRaw(HOOK, {
    cwd: repo,
    payload: { transcript_path: transcriptPath },
    env: { DHPK_COMPLETION_EVIDENCE: '1' }, // opt-in
    projectDir: repo, // pin ROOT to the temp repo
    deleteEnv: ['DHPK_ACTIVE_MODULES'],
  });
}

function warned(res) {
  return res.stdout.includes('COMPLETION CLAIM');
}

test('untracked new test file counts as evidence — no false warning (primary regression)', () => {
  const repo = mkTempRepo();
  const tx = writeTranscript();
  try {
    commitFile(repo, 'src/Foo.php', '<?php class Foo {}\n');
    writeFile(repo, 'src/Foo.php', '<?php class Foo { public $x; }\n'); // tracked code change
    writeFile(repo, 'tests/FooTest.php', '<?php class FooTest {}\n'); // UNTRACKED new test
    const res = runHook(repo, tx.file);
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!warned(res),
      `expected no warning (untracked test is evidence), got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
  }
});

test('untracked .spec.js suffix counts as evidence — no false warning', () => {
  const repo = mkTempRepo();
  const tx = writeTranscript();
  try {
    commitFile(repo, 'src/Foo.php', '<?php class Foo {}\n');
    writeFile(repo, 'src/Foo.php', '<?php class Foo { public $x; }\n'); // tracked code change
    writeFile(repo, 'foo.spec.js', "test('x', () => {});\n"); // UNTRACKED .spec. suffix
    const res = runHook(repo, tx.file);
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!warned(res),
      `expected no warning (.spec.js is a test), got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
  }
});

test('untracked code with NO test still warns (fold-in does not suppress real warnings)', () => {
  const repo = mkTempRepo();
  const tx = writeTranscript();
  try {
    writeFile(repo, 'src/Bar.php', '<?php class Bar {}\n'); // UNTRACKED code, no test
    const res = runHook(repo, tx.file);
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(warned(res),
      `expected a warning (untracked code, no test), got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
  }
});

test('doc-only untracked change → clean exit, no warning', () => {
  const repo = mkTempRepo();
  const tx = writeTranscript();
  try {
    writeFile(repo, 'notes.md', 'just notes\n'); // UNTRACKED doc only
    const res = runHook(repo, tx.file);
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!warned(res),
      `expected no warning for doc-only change, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
  }
});

run('stop-completion-evidence-untracked');
