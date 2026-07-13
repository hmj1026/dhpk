'use strict';

// Coverage for stop-graduation-scan.sh (Stop hook, advisory, opt-in knowledge
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
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'stop-graduation-scan.sh');

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
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: repo };
  if (enabled) env.DHPK_GRADUATION_SCAN = '1';
  else delete env.DHPK_GRADUATION_SCAN;
  delete env.CLAUDE_PLUGIN_OPTION_GRADUATION_SCAN_ENABLED;
  if (testOut) {
    env.CLAUDE_HOOK_TEST_MODE = '1';
    env.CLAUDE_HOOK_TEST_OUTDIR = testOut;
  }
  if (memoryDir) env.CLAUDE_HOOK_MEMORY_DIR = memoryDir;
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = JSON.stringify({ transcript_path: transcriptPath });
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 10000,
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

run('stop-graduation-scan');
