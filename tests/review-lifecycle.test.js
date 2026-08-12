'use strict';

// Task 4 lifecycle RED coverage.  These tests describe the durable contract
// before the hook/library implementation is wired into the existing review
// sentinels.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT, mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'review-lifecycle.sh');

function source(repo, script, env = {}) {
  return spawnSync('bash', ['-c', [
    `set -e; . ${JSON.stringify(LIB)}`,
    script,
  ].join('\n')], {
    cwd: repo,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
    encoding: 'utf8',
  });
}

function readJsonl(repo, name) {
  const file = path.join(sessionsDir(repo), name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('lifecycle events use a durable versioned schema and legal transitions', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-schema-' });
  try {
    const res = source(repo, [
      'dhpk_lifecycle_emit planned task-1 code-reviewer session-1 1 scope-a diff-a "" ""',
      'dhpk_lifecycle_emit dispatched task-1 code-reviewer session-1 1 scope-a diff-a "" ""',
      'dhpk_lifecycle_emit started task-1 code-reviewer session-1 1 scope-a diff-a "" ""',
    ].join('\n'));
    assert.strictEqual(res.status, 0, res.stderr);
    const events = readJsonl(repo, '.lifecycle-events.jsonl');
    assert.deepStrictEqual(events.map((event) => event.state), ['planned', 'dispatched', 'started']);
    for (const event of events) {
      assert.strictEqual(event.schema_version, 1);
      assert.ok(event.event_id);
      assert.ok(event.occurred_at);
      assert.strictEqual(event.task_id, 'task-1');
      assert.strictEqual(event.scope_id, 'scope-a');
      assert.strictEqual(event.diff_id, 'diff-a');
    }
  } finally {
    rmRepo(repo);
  }
});

test('artifact-ready is a producer marker and consumers fail closed without it', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-ready-' });
  try {
    const artifact = path.join(repo, '.claude', 'artifacts', 'reviews', 'code-reviewer-20260812-120000-test.md');
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, '---\nagent: code-reviewer\nverdict: PASS\n---\n');
    let res = source(repo, `dhpk_lifecycle_require_ready task-1`);
    assert.notStrictEqual(res.status, 0, 'consumer must not race an unmarked artifact');
    res = source(repo, `dhpk_lifecycle_mark_artifact_ready task-1 code-reviewer session-1 1 scope-a diff-a ${JSON.stringify(artifact)}`);
    assert.strictEqual(res.status, 0, res.stderr);
    res = source(repo, `dhpk_lifecycle_require_ready task-1`);
    assert.strictEqual(res.status, 0, res.stderr);
    const markers = readJsonl(repo, '.artifact-ready.jsonl');
    assert.strictEqual(markers.length, 1);
    assert.strictEqual(markers[0].state, 'artifact-ready');
    assert.strictEqual(markers[0].artifact, artifact);
  } finally {
    rmRepo(repo);
  }
});

test('audit reports expose the same marker/dependency boundary', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-audit-ready-' });
  try {
    const report = path.join(repo, 'report.json');
    fs.writeFileSync(report, '{"schema":"audit"}\n');
    let res = source(repo, 'dhpk_lifecycle_require_report_ready audit-1');
    assert.notStrictEqual(res.status, 0);
    res = source(repo, `dhpk_lifecycle_mark_report_ready audit-1 ${JSON.stringify(report)}`);
    assert.strictEqual(res.status, 0, res.stderr);
    res = source(repo, 'dhpk_lifecycle_require_report_ready audit-1');
    assert.strictEqual(res.status, 0, res.stderr);
  } finally {
    rmRepo(repo);
  }
});

test('review artifacts are bound to the dispatch scope and diff identity', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-' });
  try {
    const artifact = path.join(repo, '.claude', 'artifacts', 'reviews', 'code-reviewer-20260812-120000-test.md');
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, [
      '---',
      'agent: code-reviewer',
      'generated_at: 2026-08-12T12:00:00+08:00',
      'commit: test',
      'scope_id: scope-a',
      'diff_id: diff-b',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      'verdict: PASS',
      '---',
    ].join('\n'));
    const res = source(repo, `dhpk_lifecycle_artifact_matches ${JSON.stringify(artifact)} scope-a diff-a`);
    assert.notStrictEqual(res.status, 0, 'a stale/different diff must not satisfy the review obligation');
    const matching = source(repo, `dhpk_lifecycle_artifact_matches ${JSON.stringify(artifact)} scope-a diff-b`);
    assert.strictEqual(matching.status, 0, matching.stderr);
  } finally {
    rmRepo(repo);
  }
});

test('SubagentStop keeps the sentinel armed for a fresh artifact from another wave', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-wave-' });
  try {
    const dispatched = runHook('pre-agent-liveness-mark.sh', {
      cwd: repo,
      projectDir: repo,
      payload: { session_id: 'wave-session', tool_use_id: 'wave-1', tool_input: { subagent_type: 'code-reviewer' } },
      deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    const sentinel = path.join(sessionsDir(repo), '.pending-review');
    const artifactDir = path.join(repo, '.claude', 'artifacts', 'reviews');
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifact = path.join(artifactDir, 'code-reviewer-20260812-120000-foreign-wave.md');
    fs.writeFileSync(artifact, [
      '---',
      'agent: code-reviewer',
      'generated_at: 2026-08-12T12:00:00+08:00',
      'commit: test',
      'scope_id: sha256:foreign-scope',
      'diff_id: sha256:foreign-diff',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      'verdict: PASS',
      '---',
    ].join('\n'));
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(artifact, future, future);
    const stopped = runHook('subagent-stop-verify.sh', {
      cwd: repo,
      projectDir: repo,
      payload: { session_id: 'wave-session', subagent_type: 'code-reviewer', exit_status: 0 },
      deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(stopped.status, 0, stopped.stderr);
    assert.ok(fs.existsSync(sentinel), 'foreign scope/diff artifact must not clear the pending review');
  } finally {
    rmRepo(repo);
  }
});

test('telemetry separates attempts, starts, verdicts, fresh artifacts, retries, and obligations', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-telemetry-' });
  try {
    const report = path.join(repo, 'report.md');
    fs.writeFileSync(report, 'ready\n');
    const res = source(repo, [
      'dhpk_lifecycle_emit dispatched task-1 code-reviewer session-1 1 scope-a diff-a "" ""',
      'dhpk_lifecycle_emit started task-1 code-reviewer session-1 1 scope-a diff-a "" ""',
      `dhpk_lifecycle_mark_artifact_ready task-1 code-reviewer session-1 1 scope-a diff-a ${JSON.stringify(report)}`,
      `dhpk_lifecycle_emit verdicted task-1 code-reviewer session-1 1 scope-a diff-a PASS ${JSON.stringify(report)}`,
      'dhpk_lifecycle_emit dispatched task-2 code-reviewer session-1 1 scope-a diff-a "" ""',
      'dhpk_lifecycle_emit incomplete task-2 code-reviewer session-1 1 scope-a diff-a "" ""',
    ].join('\n'));
    assert.strictEqual(res.status, 0, res.stderr);
    const telemetry = readJsonl(repo, '.review-telemetry.jsonl');
    const latest = telemetry.at(-1);
    assert.strictEqual(latest.attempts, 2);
    assert.strictEqual(latest.started, 1);
    assert.strictEqual(latest.completed_verdicts, 1);
    assert.strictEqual(latest.fresh_artifacts, 1);
    assert.strictEqual(latest.unresolved_obligations, 1);
    assert.ok(Object.prototype.hasOwnProperty.call(latest, 'retries'));
  } finally {
    rmRepo(repo);
  }
});

test('retry is corrected once and quota-blocked task identity is resumable', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-retry-' });
  try {
    let res = source(repo, 'dhpk_lifecycle_retry_once task-1 session-1 scope-a diff-a missing-artifact');
    assert.strictEqual(res.status, 0, res.stderr);
    res = source(repo, 'dhpk_lifecycle_retry_once task-1 session-1 scope-a diff-a missing-artifact');
    assert.notStrictEqual(res.status, 0, 'the same obligation cannot retry without bound');
    res = source(repo, 'dhpk_lifecycle_quota_block task-q session-q scope-q diff-q');
    assert.strictEqual(res.status, 0, res.stderr);
    res = source(repo, 'dhpk_lifecycle_quota_resume task-q session-q');
    assert.strictEqual(res.status, 0, res.stderr);
    const events = readJsonl(repo, '.lifecycle-events.jsonl');
    assert.ok(events.some((event) => event.state === 'quota-blocked'));
    assert.ok(events.some((event) => event.state === 'started' && event.task_id === 'task-q' && event.resumed === true));
  } finally {
    rmRepo(repo);
  }
});

test('liveness cleanup leaves an armed review obligation without fresh evidence', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-liveness-' });
  try {
    const sess = sessionsDir(repo);
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, '.pending-review'), '2026-08-12 12:00 src/Foo.js\n');
    fs.writeFileSync(path.join(sess, '.active-review'), '1770000000 code-reviewer\n');
    const res = runHook('subagent-stop-verify.sh', {
      cwd: repo,
      projectDir: repo,
      payload: { subagent_type: 'code-reviewer', exit_status: 0 },
      deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(sess, '.pending-review')),
      'liveness cleanup must never itself clear pending review debt');
  } finally {
    rmRepo(repo);
  }
});

run('review-lifecycle');
