'use strict';

// Coverage for stop-advisory-dispatch.sh (graduation-scan advisory) (Stop hook, advisory, opt-in knowledge
// graduation scan):
//   - Disabled by default → no-op, no state files written.
//   - Enabled (DHPK_GRADUATION_SCAN=1) + CLAUDE_HOOK_TEST_MODE=1 isolation:
//     a transcript citing an existing memory entry increments its count in
//     memory-usage-counts.json and updates the AUTO-GENERATED region of
//     graduation-candidates.md.
//   - A citation of a memory entry with NO backing file is ignored (not
//     counted) — memory_entry_exists() gate.
//   - An entry whose accrued count/confidence exceed the former (removed)
//     auto-draft thresholds never causes anything to be written under
//     openspec/changes/ — the hook only maintains counts.json + the
//     candidates report, it never drafts OpsX changes.
//
// CLAUDE_HOOK_TEST_MODE redirects all state into CLAUDE_HOOK_TEST_OUTDIR, so
// this suite never touches the real project's state files.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'stop-advisory-dispatch.sh';

function mkDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeTranscript(text) {
  const dir = mkDir('dhpk-gs-tx-');
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n');
  return { dir, file };
}

function runHook({ transcriptPath, memoryDir, testOut, enabled, repo }) {
  const envOverrides = {};
  if (testOut) {
    envOverrides.CLAUDE_HOOK_TEST_MODE = '1';
    envOverrides.CLAUDE_HOOK_TEST_OUTDIR = testOut;
  }
  if (memoryDir) envOverrides.CLAUDE_HOOK_MEMORY_DIR = memoryDir;
  const deleteEnv = ['CLAUDE_PLUGIN_OPTION_GRADUATION_SCAN_ENABLED'];
  if (enabled) envOverrides.DHPK_GRADUATION_SCAN = '1';
  else deleteEnv.push('DHPK_GRADUATION_SCAN');
  return runHookRaw(HOOK, {
    payload: { transcript_path: transcriptPath },
    cwd: repo,
    projectDir: repo,
    env: envOverrides,
    deleteEnv,
  });
}

test('disabled by default → no-op, no test-out state written', () => {
  const repo = mkDir('dhpk-gs-repo-');
  const tx = writeTranscript('see memory/some_entry.md for details');
  const testOut = mkDir('dhpk-gs-out-');
  try {
    const res = runHook({ transcriptPath: tx.file, testOut, enabled: false, repo });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!fs.existsSync(path.join(testOut, 'memory-usage-counts.json')),
      'expected no state file written when disabled');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
    fs.rmSync(testOut, { recursive: true, force: true });
  }
});

test('enabled + citation of an EXISTING memory entry increments its count', () => {
  const repo = mkDir('dhpk-gs-repo-');
  const memoryDir = mkDir('dhpk-gs-mem-');
  fs.writeFileSync(path.join(memoryDir, 'graduation_test_entry.md'), '# graduation test entry\n');
  const tx = writeTranscript('reference memory/graduation_test_entry.md was useful here');
  const testOut = mkDir('dhpk-gs-out-');
  try {
    const res = runHook({ transcriptPath: tx.file, memoryDir, testOut, enabled: true, repo });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const countsFile = path.join(testOut, 'memory-usage-counts.json');
    assert.ok(fs.existsSync(countsFile), 'expected memory-usage-counts.json written');
    const state = JSON.parse(fs.readFileSync(countsFile, 'utf8'));
    assert.ok(state.entries.graduation_test_entry, 'expected entry recorded in state');
    assert.strictEqual(state.entries.graduation_test_entry.count, 1, 'expected count=1 on first citation');
    const report = fs.readFileSync(path.join(testOut, 'graduation-candidates.md'), 'utf8');
    const generated = report.match(/<!-- AUTO-GENERATED:START -->([\s\S]*?)<!-- AUTO-GENERATED:END -->/);
    assert.ok(generated, 'candidate report must contain its generated region');
    assert.match(generated[1], /No candidates yet/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
    fs.rmSync(testOut, { recursive: true, force: true });
  }
});

test('citation of a memory entry with NO backing file is not counted', () => {
  const repo = mkDir('dhpk-gs-repo-');
  const memoryDir = mkDir('dhpk-gs-mem-'); // empty — no entry files
  const tx = writeTranscript('see memory/nonexistent_entry.md for details');
  const testOut = mkDir('dhpk-gs-out-');
  try {
    const res = runHook({ transcriptPath: tx.file, memoryDir, testOut, enabled: true, repo });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const countsFile = path.join(testOut, 'memory-usage-counts.json');
    if (fs.existsSync(countsFile)) {
      const state = JSON.parse(fs.readFileSync(countsFile, 'utf8'));
      assert.ok(!state.entries.nonexistent_entry, 'expected orphan citation NOT recorded');
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
    fs.rmSync(testOut, { recursive: true, force: true });
  }
});

test('high count/confidence entry never drafts under openspec/changes/', () => {
  const repo = mkDir('dhpk-gs-repo-');
  const memoryDir = mkDir('dhpk-gs-mem-');
  const opsxChanges = path.join(repo, 'openspec', 'changes');
  fs.mkdirSync(opsxChanges, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'high_signal_entry.md'), '# high signal entry\n');
  const testOut = mkDir('dhpk-gs-out-');

  // Pre-seed counts.json with an entry that would have crossed the former
  // auto-draft thresholds (confidence >= 0.7, count >= 3, time-span gate
  // satisfied: >=24h span, >=3 distinct seen_dates).
  const seeded = {
    schema_version: 2,
    updated_at: '',
    entries: {
      high_signal_entry: {
        count: 5,
        first_seen: '2026-07-01T00:00:00+00:00',
        last_seen: '2026-07-10T00:00:00+00:00',
        confidence: 0.9,
        decay_warning: false,
        seen_dates: ['2026-07-01', '2026-07-05', '2026-07-10'],
      },
    },
  };
  fs.writeFileSync(path.join(testOut, 'memory-usage-counts.json'), JSON.stringify(seeded));

  const tx = writeTranscript('reference memory/high_signal_entry.md was useful here');
  try {
    const res = runHook({ transcriptPath: tx.file, memoryDir, testOut, enabled: true, repo });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const state = JSON.parse(fs.readFileSync(path.join(testOut, 'memory-usage-counts.json'), 'utf8'));
    assert.strictEqual(state.entries.high_signal_entry.count, 6, 'citation must increment the seeded count exactly once');
    const report = fs.readFileSync(path.join(testOut, 'graduation-candidates.md'), 'utf8');
    const generated = report.match(/<!-- AUTO-GENERATED:START -->([\s\S]*?)<!-- AUTO-GENERATED:END -->/);
    assert.ok(generated, 'candidate report must contain its generated region');
    assert.match(generated[1], /\|\s*high_signal_entry\s*\|\s*6\s*\|/);
    assert.match(generated[1], /\|\s*high_signal_entry\s*\|\s*6\s*\|[^|]*\|[^|]*\|\s*1\.00\s*\|\s*rule\s*\|/);
    const entries = fs.readdirSync(opsxChanges);
    assert.strictEqual(entries.length, 0, `expected no drafted changes, found: ${entries.join(', ')}`);
    assert.ok(!entries.some((e) => e.startsWith('graduate-')), 'expected no graduate-* dir');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    fs.rmSync(tx.dir, { recursive: true, force: true });
    fs.rmSync(testOut, { recursive: true, force: true });
  }
});


// Begin merged tests from tests/stop-advisory-dispatch-completion-evidence.test.js.
{
// Regression: stop-advisory-dispatch.sh (completion-evidence advisory) must count UNTRACKED new files when
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
const { mkRepo, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'stop-advisory-dispatch.sh';

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
}
// End merged tests from tests/stop-advisory-dispatch-completion-evidence.test.js.


// Begin merged tests from tests/stop-advisory-dispatch-modules.test.js.
{
// Coverage for stop-advisory-dispatch.sh (module-dispatch advisory) (Stop dispatcher for module-contributed Stop
// hooks + consolidated module-findings surfacing).
//   - No active modules, no findings file → silent exit 0.
//   - A pre-populated .module-findings file (as post-edit-dispatch.sh would
//     leave behind) is surfaced once via a systemMessage, then cleared.
//   - minimal profile suppresses the surfaced message but still clears the
//     findings file.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'stop-advisory-dispatch.sh');

function mkRepo() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sd-')));
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function findingsPath(repo) {
  return path.join(sessDir(repo), '.module-findings');
}

function runHook(repo, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, ...extraEnv };
  delete env.DHPK_ACTIVE_MODULES;
  delete env.CLAUDE_PLUGIN_OPTION_MODULES;
  return spawnSync('bash', ['-c', 'printf %s "{}" | bash "$1"', '_', HOOK], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('no modules, no findings file → silent exit 0', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.strictEqual(res.stdout.trim(), '', `expected no stdout, got: ${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-populated findings file is surfaced via systemMessage, then cleared', () => {
  const repo = mkRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    fs.writeFileSync(findingsPath(repo), 'eslint: 2 problems in foo.js\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const event = JSON.parse(res.stdout.trim());
    assert.deepStrictEqual(Object.keys(event), ['systemMessage']);
    assert.match(event.systemMessage, /^\[module-checks\] findings from this turn:\n/);
    assert.ok(event.systemMessage.includes('eslint: 2 problems in foo.js'),
      `expected findings content in systemMessage, got: ${event.systemMessage}`);
    assert.ok(!fs.existsSync(findingsPath(repo)), 'expected findings file cleared after surfacing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('minimal profile suppresses the surfaced message but still clears the findings file', () => {
  const repo = mkRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    fs.writeFileSync(findingsPath(repo), 'some finding\n');
    const res = runHook(repo, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stdout.includes('systemMessage'), `expected no message in minimal profile, got: ${res.stdout}`);
    assert.ok(!fs.existsSync(findingsPath(repo)), 'expected findings file cleared even under minimal profile');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
}
// End merged tests from tests/stop-advisory-dispatch-modules.test.js.


// Begin merged tests from tests/stop-dispatch-audit.test.js.
{
// stop-dispatch-audit.sh — the post-hoc fast-worker dispatch-mandate audit sourced
// by stop-advisory-dispatch.sh (Advisory 3). Covers issue #80: when orchestration_dispatch is on and a
// session edited >=3 distinct source files inline (the pre-edit batch gate having
// been overridden), Stop surfaces the violation instead of leaving it for a later
// manual audit.

const fs = require('node:fs');
const path = require('node:path');
const { mkRepo, rmRepo, runHook, sessionsDir } = require('./_lib/hookharness');

const HOOK = 'stop-advisory-dispatch.sh';
const SIG = 'should have been ONE fast-worker batch'; // stable substring of the advisory

function writeCounter(repo, sessionId, files) {
  const sess = sessionsDir(repo);
  fs.mkdirSync(sess, { recursive: true });
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  fs.writeFileSync(path.join(sess, `.edit-batch-${safe}.files`), files.map((f) => `${f}\n`).join(''));
}

function runStop(repo, sessionId, dispatch) {
  return runHook(HOOK, {
    projectDir: repo,
    payload: { session_id: sessionId },
    env: { DHPK_ORCHESTRATION_DISPATCH: dispatch },
  });
}

test('orchestration_dispatch=on with >=3 inline files surfaces the dispatch-mandate advisory', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-on', ['src/A.php', 'src/B.php', 'src/C.php']);
    const res = runStop(repo, 'audit-on', 'on');
    assert.strictEqual(res.status, 0, `stop-dispatch must never block Stop; stderr:\n${res.stderr}`);
    assert.ok(res.stdout.includes(SIG) && res.stdout.includes('#80'),
      `expected the dispatch-audit advisory, got stdout:\n${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('orchestration_dispatch=off stays silent even with many inline files', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-off', ['src/A.php', 'src/B.php', 'src/C.php', 'src/D.php']);
    const res = runStop(repo, 'audit-off', 'off');
    assert.ok(!res.stdout.includes(SIG), `advisory must not fire when dispatch mode is off:\n${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('fewer than 3 distinct inline files stays silent even under orchestration_dispatch=on', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-two', ['src/A.php', 'src/B.php', 'src/A.php', 'src/B.php']);
    const res = runStop(repo, 'audit-two', 'on');
    assert.strictEqual(res.status, 0, `Stop must remain non-blocking; stderr:\n${res.stderr}`);
    assert.ok(!res.stdout.includes(SIG), `advisory must not fire below the 3-file threshold:\n${res.stdout}`);
  } finally {
    rmRepo(repo);
  }
});

test('the advisory fires at most once per session even across multiple Stop turns', () => {
  const repo = mkRepo();
  try {
    writeCounter(repo, 'audit-once', ['src/A.php', 'src/B.php', 'src/C.php']);
    const first = runStop(repo, 'audit-once', 'on');
    assert.ok(first.stdout.includes(SIG), `first Stop should fire the advisory:\n${first.stdout}`);
    const second = runStop(repo, 'audit-once', 'on');
    assert.ok(!second.stdout.includes(SIG),
      `a later Stop turn in the same session must NOT re-emit the advisory:\n${second.stdout}`);
  } finally {
    rmRepo(repo);
  }
});
}
// End merged tests from tests/stop-dispatch-audit.test.js.

run('stop-advisory-dispatch-graduation');
