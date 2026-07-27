'use strict';

// resumed-review-reconcile — the SendMessage-resumed reviewer sentinel-
// clearance fallback (fix-resumed-review-sentinel-clearance / issue #92).
//
// A reviewer resumed through SendMessage may already have had its active
// marker removed by the ORIGINAL dispatch's SubagentStop, so the existing
// stop-review-reconcile.sh sweep (issue #76/#77, gated on an active marker)
// never reaches it. record-resumed-obligation.sh / reconcile-resumed-review.sh
// add an explicit, session-scoped obligation ledger and an artifact-backed
// fallback: a resumed response is never trusted on its own — only a FRESH
// canonical review artifact (newer than both the sentinel and the recorded
// pre-resume baseline) proves the resumed reviewer actually finished.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT, hookPath, mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const RECORD = hookPath('record-resumed-obligation.sh');
const RECONCILE = hookPath('reconcile-resumed-review.sh');
const REMINDER = 'stop-review-reminder.sh';

function setMtime(file, epochSeconds) {
  fs.utimesSync(file, epochSeconds, epochSeconds);
}

// runScript(scriptPath, args, opts) — spawn one of the new CLI scripts
// directly (they take positional args, not a JSON stdin payload).
function runScript(scriptPath, args, { cwd, sessionId, pluginRoot = ROOT } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PROJECT_DIR = cwd;
  if (pluginRoot === null) delete env.CLAUDE_PLUGIN_ROOT;
  else env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync('bash', [scriptPath, ...args], { cwd, env, encoding: 'utf8', timeout: 10000 });
}

function readObligations(repo) {
  const file = path.join(sessionsDir(repo), '.resumed-review-obligations');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Arm a sentinel with one pending file and drop an initial (pre-resume)
// review artifact so record-resumed-obligation.sh captures a real baseline.
function scaffold(repo, { withInitialArtifact = true } = {}) {
  const sess = sessionsDir(repo);
  const reviews = path.join(repo, '.claude', 'artifacts', 'reviews');
  fs.mkdirSync(sess, { recursive: true });
  fs.mkdirSync(reviews, { recursive: true });

  const sentinel = path.join(sess, '.pending-review');
  fs.writeFileSync(sentinel, '2026-07-27 09:00:00 src/Foo.php\n');
  setMtime(sentinel, 1_000_000);

  let initialDoc = null;
  if (withInitialArtifact) {
    initialDoc = path.join(reviews, 'code-reviewer-20260727-085000-foo.md');
    fs.writeFileSync(initialDoc, '---\nverdict: WARNING\n---\nfirst pass\n');
    setMtime(initialDoc, 900_000); // predates the sentinel
  }
  return { sess, reviews, sentinel, initialDoc };
}

function writeArtifact(reviews, name, body, mtime) {
  const p = path.join(reviews, name);
  fs.writeFileSync(p, body);
  setMtime(p, mtime);
  return p;
}

// --- 1.1: fresh artifact after the recorded baseline reconciles a resumed APPROVE ---

test('1.1: resumed APPROVE with a fresh post-baseline artifact clears the sentinel without SubagentStop', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { reviews, sentinel } = scaffold(repo);
    const rec = runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(rec.status, 0, `record should succeed:\n${rec.stderr}`);
    assert.ok(/baseline=code-reviewer-20260727-085000-foo\.md/.test(rec.stdout), rec.stdout);

    const obligations = readObligations(repo);
    assert.strictEqual(obligations.length, 1, 'exactly one obligation recorded');
    assert.strictEqual(obligations[0].state, 'pending');
    assert.strictEqual(obligations[0].attempt, 1);

    // The resumed reviewer writes a NEW canonical artifact after the baseline.
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: APPROVE\n---\nlooks good\n', 2_000_000);

    const rec2 = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(rec2.status, 0, `reconcile should succeed:\n${rec2.stderr}`);
    assert.ok(!fs.existsSync(sentinel), 'sentinel cleared without any SubagentStop event');
    assert.strictEqual(readObligations(repo).length, 0, 'obligation consumed on reconcile');
  } finally {
    rmRepo(repo);
  }
});

// --- 1.2: intermediate response (no fresh artifact yet) does not clear anything ---

test('1.2: an intermediate resumed response (no new artifact yet) leaves sentinel and obligation armed', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(readObligations(repo).length, 1);

    // No new artifact has been written — this models an intermediate SendMessage
    // reply (progress update, clarifying question) rather than a final verdict.
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(res.status, 0, 'reconcile must not report success on an intermediate response');
    assert.ok(fs.existsSync(sentinel), 'sentinel stays armed');
    const obligations = readObligations(repo);
    assert.strictEqual(obligations.length, 1, 'obligation is not consumed');
    assert.strictEqual(obligations[0].state, 'pending');
  } finally {
    rmRepo(repo);
  }
});

// --- 1.3: missing / stale / malformed artifacts never satisfy the contract on their own ---

test('1.3a: missing artifact leaves the sentinel armed', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel } = scaffold(repo, { withInitialArtifact: false });
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(res.status, 0);
    assert.ok(fs.existsSync(sentinel), 'no artifact at all must never clear the sentinel');
  } finally {
    rmRepo(repo);
  }
});

test('1.3b: a stale artifact (predates the sentinel) does not satisfy the fallback', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { reviews, sentinel } = scaffold(repo, { withInitialArtifact: false });
    writeArtifact(reviews, 'code-reviewer-20260101-000000-old.md', '---\nverdict: APPROVE\n---\nold\n', 500_000);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(res.status, 0);
    assert.ok(fs.existsSync(sentinel), 'a stale prior-cycle artifact must not clear the sentinel');
  } finally {
    rmRepo(repo);
  }
});

test('1.3c: a fresh artifact identical to the recorded baseline (no new review ran) does not satisfy the fallback', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { reviews, sentinel } = scaffold(repo, { withInitialArtifact: false });
    // Baseline artifact happens to postdate the sentinel already (edge case) —
    // recording captures it as the baseline; no NEW artifact is ever written.
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: APPROVE\n---\nunchanged\n', 2_000_000);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(res.status, 0, 'the baseline artifact itself must never satisfy its own obligation');
    assert.ok(fs.existsSync(sentinel));
  } finally {
    rmRepo(repo);
  }
});

test('1.3d: a fresh artifact with a malformed (unparseable) verdict still reconciles the lifecycle but stays unresolved', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sess, reviews, sentinel } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    // No parseable `verdict:` field.
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nnotes: no verdict field here\n---\nbody\n', 2_000_000);
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(res.status, 0, `existence+freshness gates the lifecycle clear, not parseability:\n${res.stderr}`);
    assert.ok(!fs.existsSync(sentinel), 'lifecycle clears despite the malformed verdict');
    const uv = path.join(sess, '.unresolved-verdict');
    assert.ok(fs.existsSync(uv), 'a malformed verdict must remain visible in .unresolved-verdict, not silently approved');
    assert.ok(/verdict=UNKNOWN/.test(fs.readFileSync(uv, 'utf8')));
  } finally {
    rmRepo(repo);
  }
});

// --- 1.4: resumed BLOCK/FAIL and severity findings stay unresolved despite lifecycle clearance ---

test('1.4a: resumed BLOCK verdict clears the sentinel but .unresolved-verdict is NOT cleared', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sess, reviews, sentinel } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: BLOCK\ncritical: 1\n---\nfindings\n', 2_000_000);
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(res.status, 0, `sentinel lifecycle clear:\n${res.stderr}`);
    assert.ok(!fs.existsSync(sentinel), 'sentinel clearance is a lifecycle transition, not approval');
    const uv = fs.readFileSync(path.join(sess, '.unresolved-verdict'), 'utf8');
    assert.ok(/verdict=BLOCK critical=1/.test(uv), `BLOCK must stay recorded as unresolved:\n${uv}`);
  } finally {
    rmRepo(repo);
  }
});

test('1.4b: resumed medium-severity finding with PASS verdict still records unresolved-verdict', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sess, reviews } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: PASS\nmedium: 2\n---\nfindings\n', 2_000_000);
    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(res.status, 0);
    const uv = fs.readFileSync(path.join(sess, '.unresolved-verdict'), 'utf8');
    assert.ok(/verdict=PASS critical=0 high=0 medium=2/.test(uv), uv);
  } finally {
    rmRepo(repo);
  }
});

// --- 1.5: concurrent-session, foreign-provenance, repeated-reconcile, native/fallback idempotence ---

test('1.5a: a foreign session cannot clear a sentinel it never recorded an obligation for', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { reviews, sentinel } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: APPROVE\n---\nok\n', 2_000_000);

    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-B' });
    assert.notStrictEqual(res.status, 0, 'session B has no obligation on this slot — must not clear session A\'s sentinel');
    assert.ok(fs.existsSync(sentinel), 'sentinel remains armed for the owning session');

    const obligations = readObligations(repo);
    assert.strictEqual(obligations.length, 1, 'session A\'s obligation is untouched');
    assert.strictEqual(obligations[0].session_id, 'session-A');
  } finally {
    rmRepo(repo);
  }
});

test('1.5b: an obligation on one slot does not satisfy reconcile for a different slot', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const sess = sessionsDir(repo);
    const reviews = path.join(repo, '.claude', 'artifacts', 'reviews');
    fs.mkdirSync(sess, { recursive: true });
    fs.mkdirSync(reviews, { recursive: true });
    const dbSentinel = path.join(sess, '.pending-db-review');
    fs.writeFileSync(dbSentinel, '2026-07-27 09:00:00 src/Repo.php\n');
    setMtime(dbSentinel, 1_000_000);

    // Obligation recorded for code-reviewer's slot only.
    const codeSentinel = path.join(sess, '.pending-review');
    fs.writeFileSync(codeSentinel, '2026-07-27 09:00:00 src/Foo.php\n');
    setMtime(codeSentinel, 1_000_000);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });

    writeArtifact(reviews, 'database-reviewer-20260727-093000-foo.md', '---\nverdict: PASS\n---\nok\n', 2_000_000);
    const res = runScript(RECONCILE, ['.pending-db-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(res.status, 0, 'no obligation was recorded for .pending-db-review');
    assert.ok(fs.existsSync(dbSentinel), 'foreign-slot artifact must not clear an unrelated sentinel');
  } finally {
    rmRepo(repo);
  }
});

test('1.5c: repeated reconcile after a successful clear is idempotent (consumes without error)', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { reviews, sentinel } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: APPROVE\n---\nok\n', 2_000_000);

    const first = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(first.status, 0);
    assert.ok(!fs.existsSync(sentinel));

    // A repeated call (e.g. the Stop sweep firing after an explicit reconcile
    // already ran) must not error just because the obligation is already gone.
    const second = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(second.status, 0, 'no matching obligation remains — reported as left-armed/no-op, not a false clear');
  } finally {
    rmRepo(repo);
  }
});

test('1.5d: native auto-clear racing ahead of the fallback is consumed without error (idempotent)', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel } = scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(readObligations(repo).length, 1);

    // Simulate subagent-stop-verify.sh's native auto-clear having already fired.
    fs.rmSync(sentinel);

    const res = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(res.status, 0, `already-clear sentinel must be a harmless consume, not an error:\n${res.stderr}`);
    assert.strictEqual(readObligations(repo).length, 0, 'the now-orphaned obligation is consumed');
  } finally {
    rmRepo(repo);
  }
});

test('1.5e: the Stop-time sweep reconciles a resumed obligation whose active marker is already gone', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { reviews, sentinel } = scaffold(repo);
    // No active marker exists — models the original dispatch's SubagentStop
    // having already removed it before the SendMessage resume.
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    writeArtifact(reviews, 'code-reviewer-20260727-093000-foo.md', '---\nverdict: APPROVE\n---\nok\n', 2_000_000);

    const res = runHook(REMINDER, {
      projectDir: repo,
      payload: { session_id: 'session-A', stop_hook_active: false },
      env: { CLAUDE_CODE_SESSION_ID: 'session-A' },
    });
    assert.ok(/\[stop-resumed-reconcile\] \.pending-review reconciled/.test(res.stderr), `expected a resumed-reconcile log line, got:\n${res.stderr}`);
    assert.ok(!fs.existsSync(sentinel), 'the Stop sweep clears a resumed obligation with no active marker');
    assert.strictEqual(readObligations(repo).length, 0);
  } finally {
    rmRepo(repo);
  }
});

test('1.5f: the reminder reports RESUMED (not a duplicate-dispatch PENDING) while an obligation is outstanding', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    scaffold(repo);
    runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    // No fresh artifact yet — the sweep cannot reconcile, so the reminder fires.
    const res = runHook(REMINDER, {
      projectDir: repo,
      payload: { session_id: 'session-A', stop_hook_active: false },
      env: { CLAUDE_CODE_SESSION_ID: 'session-A' },
    });
    assert.strictEqual(res.status, 2, 'gate stays unmet — Stop is still blocked');
    assert.ok(/\[WARN\] RESUMED: code-reviewer/.test(res.stderr), `expected a RESUMED report, got:\n${res.stderr}`);
    assert.ok(!/Recommended: dispatch ONE 'code-reviewer'/.test(res.stderr), 'must not recommend a duplicate dispatch while resumed obligation is outstanding');
  } finally {
    rmRepo(repo);
  }
});

test('unknown sentinel name is rejected with exit 2 (fail-loud, matches clear-sentinel.sh)', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    fs.mkdirSync(sessionsDir(repo), { recursive: true });
    const res = runScript(RECORD, ['.pending-bogus'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(res.status, 2);
    assert.ok(/unknown sentinel name/.test(res.stderr));
  } finally {
    rmRepo(repo);
  }
});

test('recording without a session identity fails loud instead of silently omitting ownership', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    scaffold(repo);
    const res = runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: null });
    assert.strictEqual(res.status, 2);
    assert.ok(/no session identity available/.test(res.stderr));
  } finally {
    rmRepo(repo);
  }
});

run('resumed-review-reconcile');
