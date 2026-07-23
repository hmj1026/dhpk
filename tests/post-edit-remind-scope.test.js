'use strict';

// D4.1 regression: post-edit-remind.sh must not arm a sentinel for an absolute
// file path that lies OUTSIDE the git ROOT it derives via `git rev-parse
// --show-toplevel`. Before the fix, `${FILE_PATH#$ROOT/}` was a silent no-op
// for out-of-project paths, so an extension match (e.g. a stray *.php scratch
// file under /private/tmp) could still arm .pending-review.
//
// Also covers D4.3: an in-project edit under a fake openspec/changes/<slug>/
// tree writes a provenance sidecar line tagging that slug.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'post-edit-remind.sh';

function mkTempRepo() {
  // realpath (inside mkRepo): on macOS os.tmpdir() lives under a /var symlink
  // to /private/var. The harness deletes CLAUDE_PROJECT_DIR by default, so the
  // hook's dhpk_root() falls back to `git rev-parse --show-toplevel`, which
  // resolves symlinks — an unresolved path here would make FILE_PATH (built
  // from the unresolved dir) mismatch ROOT and spuriously hit the "outside
  // ROOT" branch.
  return mkRepo({ prefix: 'dhpk-scope-', gitConfig: true });
}

function runHook(cwd, payload) {
  return runHookRaw(HOOK, { cwd, payload, deleteEnv: ['DHPK_ACTIVE_MODULES'] });
}

function pendingReviewPath(repoDir) {
  return path.join(repoDir, '.claude', 'artifacts', 'sessions', '.pending-review');
}

function pendingDocReviewPath(repoDir) {
  return path.join(repoDir, '.claude', 'artifacts', 'sessions', '.pending-doc-review');
}

function writeFile(repoDir, rel, contents) {
  const abs = path.join(repoDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

function gitCommitAll(repoDir, msg) {
  spawnSync('git', ['add', '-A'], { cwd: repoDir });
  spawnSync('git', ['commit', '-q', '-m', msg], { cwd: repoDir });
}

test('out-of-project absolute path does NOT arm a sentinel', () => {
  const repo = mkTempRepo();
  try {
    const res = runHook(repo, { tool_input: { file_path: '/private/tmp/dhpk-scope-out.php' } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(pendingReviewPath(repo)),
      '.pending-review was created for an out-of-project path (D4.1 regression)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('in-project path DOES arm .pending-review (positive control)', () => {
  const repo = mkTempRepo();
  try {
    const filePath = path.join(repo, 'src', 'Foo.php');
    const res = runHook(repo, { tool_input: { file_path: filePath } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(pendingReviewPath(repo)),
      '.pending-review was NOT created for an in-project .php path');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('in-project path under openspec/changes/<slug>/ writes provenance sidecar', () => {
  const repo = mkTempRepo();
  try {
    const filePath = path.join(repo, 'openspec', 'changes', 'fake-change-slug', 'src', 'Bar.php');
    const res = runHook(repo, { tool_input: { file_path: filePath } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    const provFile = path.join(repo, '.claude', 'artifacts', 'sessions', '.sentinel-provenance');
    assert.ok(fs.existsSync(provFile), '.sentinel-provenance was not written');
    const contents = fs.readFileSync(provFile, 'utf8');
    assert.ok(contents.includes('fake-change-slug'),
      `provenance sidecar missing expected slug; contents:\n${contents}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// Fix 2 (harvest-advice-20260708): the doc-review sentinel must not re-arm on
// an unattended goal session's own bookkeeping — orchestration state dotfiles
// under openspec/ and checkbox-only tasks.md flips.

test('orchestration dotfile under openspec/ does NOT arm .pending-doc-review', () => {
  const repo = mkTempRepo();
  try {
    const filePath = writeFile(repo, 'openspec/changes/fake-slug/.resume-note.md', '# resume\nstate\n');
    const res = runHook(repo, { tool_input: { file_path: filePath } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was armed for an openspec/ orchestration dotfile (.resume-note.md)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('openspec spec/proposal .md DOES arm .pending-doc-review (positive control)', () => {
  const repo = mkTempRepo();
  try {
    const filePath = writeFile(repo, 'openspec/changes/fake-slug/proposal.md', '# Proposal\n\nprose\n');
    const res = runHook(repo, { tool_input: { file_path: filePath } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was NOT armed for a real openspec proposal.md');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkbox-only tasks.md flip does NOT arm .pending-doc-review', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n');
    gitCommitAll(repo, 'seed tasks');
    // Flip one checkbox in the working tree (the orchestrator's own bookkeeping).
    writeFile(repo, rel, '# Tasks\n\n- [x] 1.1 First\n- [ ] 1.2 Second\n');
    const res = runHook(repo, { tool_input: { file_path: path.join(repo, rel) } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was armed for a checkbox-only tasks.md flip');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('multiple simultaneous checkbox flips in one diff do NOT arm .pending-doc-review', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n- [ ] 1.3 Third\n');
    gitCommitAll(repo, 'seed tasks');
    // Flip several checkboxes at once (locks in the multiset comparison).
    writeFile(repo, rel, '# Tasks\n\n- [x] 1.1 First\n- [x] 1.2 Second\n- [ ] 1.3 Third\n');
    const res = runHook(repo, { tool_input: { file_path: path.join(repo, rel) } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was armed for a multi-flip checkbox-only tasks.md edit');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('prose change to tasks.md STILL arms .pending-doc-review (checkbox-only control)', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n');
    gitCommitAll(repo, 'seed tasks');
    // A non-checkbox content change (new task line) must keep the doc gate.
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 A newly added task\n');
    const res = runHook(repo, { tool_input: { file_path: path.join(repo, rel) } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was NOT armed for a non-checkbox tasks.md content change');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// D5 (harvest-advice-20260711): per-edit payload (Edit tool old_string/new_string)
// is the PRIMARY checkbox-flip classification path; cumulative git diff HEAD is
// only the fallback for payloads without that pair (Write, MultiEdit, heredoc).

test('D5: checkbox flip via Edit payload does NOT arm doc-review, even with an earlier uncommitted prose delta', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n[blocked: waiting on human]\n');
    gitCommitAll(repo, 'seed tasks');
    // Simulate an earlier, still-uncommitted prose delta already on disk (e.g. a
    // [blocked: ...] annotation from a prior edit) alongside the flip we're about
    // to apply via the Edit tool payload.
    writeFile(repo, rel, '# Tasks\n\n- [x] 1.1 First\n- [ ] 1.2 Second\n[blocked: still waiting]\n');
    const res = runHook(repo, {
      tool_input: {
        file_path: path.join(repo, rel),
        old_string: '- [ ] 1.1 First',
        new_string: '- [x] 1.1 First',
      },
    });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was armed for a checkbox flip classified via per-edit payload, despite an unrelated uncommitted prose delta elsewhere in the file');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('D5: a single mixed Edit (flip + prose in one old/new pair) STILL arms doc-review', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First task\n');
    gitCommitAll(repo, 'seed tasks');
    writeFile(repo, rel, '# Tasks\n\n- [x] 1.1 First task, reworded\n');
    const res = runHook(repo, {
      tool_input: {
        file_path: path.join(repo, rel),
        old_string: '- [ ] 1.1 First task',
        new_string: '- [x] 1.1 First task, reworded',
      },
    });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was NOT armed for a mixed edit (checkbox flip + prose change in one old/new pair)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('D5: Write-path payload (no old/new strings) falls back to cumulative-diff classification', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n');
    gitCommitAll(repo, 'seed tasks');
    // A Write-tool-style payload: only file_path, no old_string/new_string.
    writeFile(repo, rel, '# Tasks\n\n- [x] 1.1 First\n- [ ] 1.2 Second\n');
    const res = runHook(repo, { tool_input: { file_path: path.join(repo, rel) } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(pendingDocReviewPath(repo)),
      '.pending-doc-review was armed for a Write-path checkbox-only flip (fallback cumulative-diff behavior regressed)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('fix round: per-edit checkbox-flip path suppresses arming but does NOT erase a pre-existing doc-review sentinel line', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'openspec/changes/fake-slug/tasks.md';
    writeFile(repo, rel, '# Tasks\n\n- [ ] 1.1 First\n- [ ] 1.2 Second\n');
    gitCommitAll(repo, 'seed tasks');
    // Simulate review debt already armed by an earlier, unreviewed prose edit
    // to this same file.
    const docSentinel = pendingDocReviewPath(repo);
    fs.mkdirSync(path.dirname(docSentinel), { recursive: true });
    const seededLine = `2020-01-01 00:00:00 ${rel}`;
    fs.writeFileSync(docSentinel, seededLine + '\n');
    // Now apply a pure checkbox flip via an Edit-tool payload (per-edit path).
    writeFile(repo, rel, '# Tasks\n\n- [x] 1.1 First\n- [ ] 1.2 Second\n');
    const res = runHook(repo, {
      tool_input: {
        file_path: path.join(repo, rel),
        old_string: '- [ ] 1.1 First',
        new_string: '- [x] 1.1 First',
      },
    });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(docSentinel),
      '.pending-doc-review sentinel file was deleted — pre-existing review debt from an earlier prose edit was erased by a later checkbox-only flip');
    const lines = fs.readFileSync(docSentinel, 'utf8').split('\n').filter(Boolean);
    const matching = lines.filter((l) => l.endsWith(rel));
    assert.strictEqual(matching.length, 1,
      `expected exactly one sentinel line for ${rel} (no duplicate, no removal), got ${matching.length}: ${JSON.stringify(lines)}`);
    assert.strictEqual(lines[0], seededLine,
      'pre-existing sentinel line was mutated by the per-edit checkbox-flip suppression path');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// Issue #79: a slot triage-dropped repeatedly in one session is a recurring
// false-positive (a mis-scoped trigger) — the 2nd drop must surface a NOTE
// instead of silently re-dropping, so the operator files a bug rather than
// triage-dropping the same slot 4× as in session 82bfa020.
test('a slot triage-dropped 2x in one session emits a recurring-false-positive NOTE', () => {
  const repo = mkTempRepo();
  try {
    const rel = 'src/AuthHelper.php';
    const filePath = path.join(repo, rel);
    writeFile(repo, rel, '<?php\nclass AuthHelper {\n  public function x() { return 1; }\n}\n');
    gitCommitAll(repo, 'seed AuthHelper');

    // Edit 1: comment-only → drops the security slot (count 1, no NOTE yet).
    writeFile(repo, rel, '<?php\nclass AuthHelper {\n  // note one\n  public function x() { return 1; }\n}\n');
    let res = runHook(repo, { tool_input: { file_path: filePath } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(/triage-drop sec/.test(res.stdout), `expected a sec triage-drop, got:\n${res.stdout}`);
    assert.ok(!/triage-dropped 2x/.test(res.stdout), `NOTE fired on the first drop:\n${res.stdout}`);

    // Edit 2: still comment-only → drops sec again (count 2 → recurring NOTE).
    writeFile(repo, rel, '<?php\nclass AuthHelper {\n  // note one\n  // note two\n  public function x() { return 1; }\n}\n');
    res = runHook(repo, { tool_input: { file_path: filePath } });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(/'sec' triage-dropped 2x this session/.test(res.stdout),
      `expected the recurring-false-positive NOTE, got:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('post-edit-remind-scope');
