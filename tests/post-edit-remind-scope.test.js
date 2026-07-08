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
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'post-edit-remind.sh');

function mkTempRepo() {
  // realpath: on macOS os.tmpdir() lives under a /var symlink to /private/var;
  // `git rev-parse --show-toplevel` (used by the hook to derive ROOT) resolves
  // symlinks, so an unresolved path here would make FILE_PATH (built from the
  // unresolved dir) mismatch ROOT and spuriously hit the "outside ROOT" branch.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-scope-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function runHook(cwd, payload) {
  const env = { ...process.env };
  delete env.DHPK_ACTIVE_MODULES;
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = JSON.stringify(payload);
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
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

run('post-edit-remind-scope');
