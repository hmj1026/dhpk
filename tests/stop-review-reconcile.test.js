'use strict';

// stop-review-reconcile.sh — the Stop-time reviewer reconciliation sweep sourced
// and invoked by stop-review-reminder.sh. Covers issues #76/#77: a background
// reviewer whose SubagentStop never fired leaves its sentinel armed and its
// active-liveness marker lingering; the sweep clears the sentinel (when a fresh
// review doc proves the reviewer finished) and expires the stale active marker,
// so the reminder neither re-reminds a satisfied gate nor reports a phantom
// IN-FLIGHT dispatch.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook, sessionsDir } = require('./_lib/hookharness');

const HOOK = 'stop-review-reminder.sh';

function setMtime(file, epochSeconds) {
  fs.utimesSync(file, epochSeconds, epochSeconds);
}

// Arm a sentinel + active marker, then (optionally) drop a review doc that
// postdates the sentinel. Returns the key paths.
function scaffold(repo, {
  withFreshDoc,
  verdict = 'PASS',
  malformed = false,
  sessionId = 'reconcile-session',
  artifactSessionId = sessionId,
  artifactDispatchId = `attempt-${sessionId}`,
  omitProvenance = false,
}) {
  const sess = sessionsDir(repo);
  const reviews = path.join(repo, '.claude', 'artifacts', 'reviews');
  fs.mkdirSync(sess, { recursive: true });
  fs.mkdirSync(reviews, { recursive: true });

  const sentinel = path.join(sess, '.pending-review');
  const active = path.join(sess, '.active-review');
  fs.writeFileSync(sentinel, '2026-07-23 10:00:00 src/Foo.php\n');
  fs.writeFileSync(active, '2026-07-23 10:00:00 arm-on-dispatch:code-reviewer [arm-on-dispatch]\n');
  fs.writeFileSync(
    path.join(sess, '.review-dispatch-attempts'),
    `.pending-review\t1000000\t${sessionId}\t1\t${artifactDispatchId}\tcode-reviewer\n`,
  );
  // Pin the sentinel to an older mtime so freshness is deterministic.
  setMtime(sentinel, 1_000_000);
  setMtime(active, 1_000_000);

  let doc = null;
  if (withFreshDoc) {
    doc = path.join(reviews, 'code-reviewer-20260723-100005-foo.md');
    const provenance = omitProvenance
      ? []
      : [
        `session_id: ${artifactSessionId}`,
        'dispatch_attempt: 1',
        `dispatch_id: ${artifactDispatchId}`,
      ];
    const frontmatter = malformed
      ? [
        '---',
        'agent: code-reviewer',
        'generated_at: 2026-07-23T10:00:05+08:00',
        'commit: test-sha',
        'scope: [test/fixture]',
        'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
        ...provenance,
        '---',
      ].join('\n')
      : [
        '---',
        'agent: code-reviewer',
        'generated_at: 2026-07-23T10:00:05+08:00',
        'commit: test-sha',
        'scope: [test/fixture]',
        `task_id: review:.pending-review:${sessionId}`,
        'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
        ...provenance,
        `verdict: ${verdict}`,
        '---',
      ].join('\n');
    fs.writeFileSync(doc, `${frontmatter}\nlooks good\n`);
    setMtime(doc, 2_000_000); // postdates the sentinel
  }
  return { sentinel, active, doc };
}

test('a fresh review doc with no SubagentStop is reconciled: sentinel cleared, active marker expired', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, { withFreshDoc: true, sessionId: 'reconcile-fresh' });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-fresh', stop_hook_active: false },
    });
    assert.strictEqual(res.status, 0, `reminder should not block stop after reconcile; stderr:\n${res.stderr}`);
    assert.ok(/\[stop-reconcile\] auto-cleared \.pending-review/.test(res.stderr),
      `expected a reconcile log line, got:\n${res.stderr}`);
    assert.ok(!fs.existsSync(sentinel), 'sentinel should be cleared once a fresh review doc exists');
    assert.ok(!fs.existsSync(active), 'stale active marker should be expired');
  } finally {
    rmRepo(repo);
  }
});

test('an armed sentinel with NO fresh review doc is left fully armed (no premature clear)', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, { withFreshDoc: false, sessionId: 'reconcile-nodoc' });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-nodoc', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `no reconcile should occur without a fresh doc:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'sentinel must stay armed when no review doc exists');
    assert.ok(fs.existsSync(active), 'active marker must stay when the reviewer has not demonstrably finished');
    // And the reminder still fires for the genuinely-pending gate.
    assert.strictEqual(res.status, 2, 'reminder should block stop for a genuinely pending sentinel');
  } finally {
    rmRepo(repo);
  }
});

test('a stale review doc that predates the sentinel does NOT clear it', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel } = scaffold(repo, { withFreshDoc: false, sessionId: 'reconcile-stale' });
    // A prior-cycle review doc whose mtime PREDATES the sentinel must not count.
    const stale = path.join(repo, '.claude', 'artifacts', 'reviews', 'code-reviewer-20260101-000000-old.md');
    fs.writeFileSync(stale, '---\nverdict: PASS\n---\nold\n');
    setMtime(stale, 500_000); // older than the sentinel's 1_000_000
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-stale', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `a stale doc must not trigger reconcile:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'sentinel must stay armed against a stale prior-cycle review doc');
  } finally {
    rmRepo(repo);
  }
});

test('a fresh review doc with NO active marker (foreign session) does NOT clear the sentinel', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, { withFreshDoc: true, sessionId: 'reconcile-foreign' });
    // Simulate the concurrent-session case: this session never dispatched the
    // reviewer, so no active-liveness marker exists — but a foreign session's
    // fresh, non-session-scoped doc-reviewer artifact is present in the shared
    // reviews dir. The sweep must NOT clear a gate this session didn't satisfy.
    fs.rmSync(active);
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-foreign', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr),
      `must not reconcile a slot with no active marker (foreign artifact):\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'sentinel must stay armed when this session never dispatched the reviewer');
  } finally {
    rmRepo(repo);
  }
});

test('a fresh malformed review doc does NOT clear the sentinel', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, {
      withFreshDoc: true,
      malformed: true,
      sessionId: 'reconcile-malformed',
    });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-malformed', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `malformed evidence must not reconcile:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'malformed evidence must leave the sentinel armed');
    assert.ok(fs.existsSync(active), 'malformed evidence must leave the active marker armed');
  } finally {
    rmRepo(repo);
  }
});

test('a fresh WARNING review verdict does NOT clear the sentinel', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, {
      withFreshDoc: true,
      verdict: 'WARNING',
      sessionId: 'reconcile-warning',
    });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-warning', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `WARNING evidence must not reconcile:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'WARNING evidence must leave the sentinel armed');
    assert.ok(fs.existsSync(active), 'WARNING evidence must leave the active marker armed');
  } finally {
    rmRepo(repo);
  }
});

test('a fresh BLOCK review verdict does NOT clear the sentinel', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, {
      withFreshDoc: true,
      verdict: 'BLOCK',
      sessionId: 'reconcile-block',
    });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-block', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `BLOCK evidence must not reconcile:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'BLOCK evidence must leave the sentinel armed');
    assert.ok(fs.existsSync(active), 'BLOCK evidence must leave the active marker armed');
  } finally {
    rmRepo(repo);
  }
});

test('a fresh valid artifact from another session does NOT clear an active sentinel', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, {
      withFreshDoc: true,
      sessionId: 'reconcile-owned',
      artifactSessionId: 'foreign-session',
      artifactDispatchId: 'foreign-attempt',
    });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-owned', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `foreign provenance must not reconcile:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'foreign provenance must leave the sentinel armed');
    assert.ok(fs.existsSync(active), 'foreign provenance must leave the active marker armed');
  } finally {
    rmRepo(repo);
  }
});

test('a fresh valid artifact without dispatch provenance does NOT clear an active sentinel', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    const { sentinel, active } = scaffold(repo, {
      withFreshDoc: true,
      sessionId: 'reconcile-missing-provenance',
      omitProvenance: true,
    });
    const res = runHook(HOOK, {
      projectDir: repo,
      payload: { session_id: 'reconcile-missing-provenance', stop_hook_active: false },
    });
    assert.ok(!/\[stop-reconcile\]/.test(res.stderr), `missing provenance must not reconcile:\n${res.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'missing provenance must leave the sentinel armed');
    assert.ok(fs.existsSync(active), 'missing provenance must leave the active marker armed');
  } finally {
    rmRepo(repo);
  }
});

run('stop-review-reconcile');
