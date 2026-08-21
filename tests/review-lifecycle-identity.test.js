'use strict';

// RED coverage for deepen-review-lifecycle-identity.  The identity contract
// is intentionally exercised at the existing shell boundaries: the first
// migration wave must add one source-only module without changing the public
// hook APIs or the artifact format.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ROOT,
  hookPath,
  mkRepo,
  rmRepo,
  sessionsDir,
} = require('./_lib/hookharness');

const IDENTITY_LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'review-lifecycle-identity.sh');
const LIFECYCLE_LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'review-lifecycle.sh');
const RESUMED_LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'resumed-review-obligation.sh');
const RECORD = hookPath('record-resumed-obligation.sh');
const RECONCILE = hookPath('reconcile-resumed-review.sh');

function source(repo, script, files = [LIFECYCLE_LIB]) {
  const sources = files.map((file) => `. ${JSON.stringify(file)}`).join('\n');
  return spawnSync('bash', ['-c', [
    'set -e',
    sources,
    script,
  ].join('\n')], {
    cwd: repo,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: repo,
      DHPK_SIDECAR_RESUMED_OBLIGATIONS: '.resumed-review-obligations',
    },
    encoding: 'utf8',
  });
}

function runScript(scriptPath, args, { cwd, sessionId } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync('bash', [scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function readObligations(repo) {
  const file = path.join(sessionsDir(repo), '.resumed-review-obligations');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('one source-only identity module owns the canonical field contract and is consumed by lifecycle paths', () => {
  assert.ok(fs.existsSync(IDENTITY_LIB), 'review-lifecycle-identity.sh must be added as a source-only module');
  const identity = fs.readFileSync(IDENTITY_LIB, 'utf8');
  for (const field of [
    'task_id',
    'attempt_id',
    'scope_id',
    'diff_id',
    'session_id',
    'dispatch_attempt',
    'dispatch_id',
    'producer',
    'wave',
    'adapter',
    'stage',
    'plan_fingerprint',
    'artifact_fingerprint',
  ]) {
    assert.match(identity, new RegExp(`\\b${field}\\b`), `canonical identity is missing ${field}`);
  }
  assert.match(fs.readFileSync(LIFECYCLE_LIB, 'utf8'), /review-lifecycle-identity\.sh/,
    'normal lifecycle must source the canonical identity module');
  assert.match(fs.readFileSync(RESUMED_LIB, 'utf8'), /review-lifecycle-identity\.sh/,
    'resumed lifecycle must source the canonical identity module');
  assert.strictEqual((fs.readFileSync(LIFECYCLE_LIB, 'utf8').match(/aliases\s*=/g) || []).length, 0,
    'normal lifecycle must not retain a duplicate alias map');
  assert.strictEqual((fs.readFileSync(RESUMED_LIB, 'utf8').match(/aliases\s*=/g) || []).length, 0,
    'resumed lifecycle must not retain a duplicate alias map');
});

test('lifecycle artifact matching accepts equivalent frontmatter aliases through one canonical parser', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-alias-' });
  try {
    const artifact = path.join(repo, 'review.md');
    fs.writeFileSync(artifact, [
      '---',
      'agent: code-reviewer',
      'scope: scope-a',
      'diff_id: diff-a',
      'wave_id: wave-a',
      'adapter_id: adapter-a',
      'verification_stage: structural',
      'plan_id: plan-a',
      'artifact_sha256: artifact-a',
      'attempt_id: task-a:attempt:1',
      'verdict: PASS',
      '---',
    ].join('\n'));
    const result = source(repo, [
      `dhpk_lifecycle_artifact_matches ${JSON.stringify(artifact)} scope-a diff-a producer-a wave-a scope-a adapter-a structural plan-a artifact-a task-a:attempt:1`,
    ].join('\n'));
    assert.strictEqual(result.status, 0,
      `equivalent scope/wave/adapter/stage/fingerprint aliases must match:\n${result.stderr}`);
  } finally {
    rmRepo(repo);
  }
});

test('resumed reconciliation rejects a fresh artifact from a foreign session identity', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-session-', gitConfig: true });
  try {
    const sess = sessionsDir(repo);
    const reviews = path.join(repo, '.claude', 'artifacts', 'reviews');
    fs.mkdirSync(sess, { recursive: true });
    fs.mkdirSync(reviews, { recursive: true });
    const sentinel = path.join(sess, '.pending-review');
    fs.writeFileSync(sentinel, '2026-08-21 09:00 src/Foo.js\n');
    fs.utimesSync(sentinel, 1_000_000, 1_000_000);
    const baseline = path.join(reviews, 'code-reviewer-20260821-085000-baseline.md');
    fs.writeFileSync(baseline, '---\nverdict: WARNING\n---\nold\n');
    fs.utimesSync(baseline, 900_000, 900_000);

    const recorded = runScript(RECORD, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.strictEqual(recorded.status, 0, `record should succeed:\n${recorded.stderr}`);
    const obligation = readObligations(repo)[0];
    assert.ok(obligation.task_id && obligation.attempt_id && obligation.scope,
      'the resumed obligation must expose canonical identity before reconciliation');

    const fresh = path.join(reviews, 'code-reviewer-20260821-093000-foreign-session.md');
    fs.writeFileSync(fresh, [
      '---',
      `task_id: ${obligation.task_id}`,
      `attempt_id: ${obligation.attempt_id}`,
      `scope_id: ${obligation.scope}`,
      'session_id: foreign-session',
      'producer: code-reviewer',
      `wave: ${obligation.wave}`,
      `adapter: ${obligation.adapter}`,
      `stage: ${obligation.stage}`,
      'verdict: APPROVE',
      '---',
      'foreign evidence',
    ].join('\n'));
    fs.utimesSync(fresh, 2_000_000, 2_000_000);

    const reconciled = runScript(RECONCILE, ['.pending-review'], { cwd: repo, sessionId: 'session-A' });
    assert.notStrictEqual(reconciled.status, 0,
      `foreign session identity must fail closed:\n${reconciled.stderr}`);
    assert.ok(fs.existsSync(sentinel), 'foreign evidence must leave the resumed sentinel armed');
    assert.strictEqual(readObligations(repo).length, 1, 'foreign evidence must leave the obligation pending');
  } finally {
    rmRepo(repo);
  }
});

test('identity module remains a pure record/parser boundary and cannot enforce lifecycle completion', () => {
  assert.ok(fs.existsSync(IDENTITY_LIB), 'identity module must exist before checking its boundary');
  const identity = fs.readFileSync(IDENTITY_LIB, 'utf8');
  for (const forbidden of [
    'clear-sentinel',
    'dhpk_resumed_obligation_consume',
    'dhpk_lifecycle_emit',
    'rm -f',
  ]) {
    assert.ok(!identity.includes(forbidden), `identity module must not perform enforcement: ${forbidden}`);
  }
});

test('identity records round-trip in fixed order and classify strong versus context bindings', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-roundtrip-' });
  try {
    const result = source(repo, [
      'record="$(dhpk_identity_build task-A task-A:attempt:2 scope-A diff-A session-A 2 dispatch-A producer-A wave-A adapter-A structural plan-A artifact-A)"',
      '[ "${record%%$' + "'\\t'" + '*}" = "task_id=task-A" ]',
      'printf "%s\\n" "$record" | dhpk_identity_serialize',
      'dhpk_identity_field_class task_id',
      'dhpk_identity_field_class plan_fingerprint',
    ].join('\n'), [IDENTITY_LIB]);
    assert.strictEqual(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.match(lines[0], /^task_id=task-A\tattempt_id=task-A:attempt:2/);
    assert.strictEqual(lines[1], 'strong');
    assert.strictEqual(lines[2], 'context');
  } finally {
    rmRepo(repo);
  }
});

test('strong task/session bindings fail closed while descriptive scope metadata stays separate', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-strong-' });
  try {
    const artifact = path.join(repo, 'strong.md');
    fs.writeFileSync(artifact, [
      '---',
      'scope: [src/Foo.js]',
      'scope_id: scope-a',
      'diff_id: diff-a',
      'task_id: task-foreign',
      'attempt_id: task-foreign:attempt:1',
      'session_id: session-foreign',
      'dispatch_attempt: 1',
      'dispatch_id: dispatch-foreign',
      '---',
    ].join('\n'));
    const result = source(repo, [
      `dhpk_identity_artifact_matches ${JSON.stringify(artifact)} scope-a diff-a '' '' '' '' '' '' '' task-current:attempt:1 session-current 1 dispatch-current task-current`,
    ].join('\n'), [IDENTITY_LIB]);
    assert.notStrictEqual(result.status, 0, 'foreign task/session must fail closed');
  } finally {
    rmRepo(repo);
  }
});

test('scope/diff-only legacy artifacts remain compatible, while partial new identity fails closed', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-legacy-' });
  try {
    const legacy = path.join(repo, 'legacy.md');
    fs.writeFileSync(legacy, '---\nscope_id: scope-a\ndiff_id: diff-a\n---\n');
    let result = source(repo, [
      `dhpk_identity_artifact_matches ${JSON.stringify(legacy)} scope-a diff-a '' '' '' '' '' '' '' attempt-current session-current 1 dispatch-current task-current`,
    ].join('\n'), [IDENTITY_LIB]);
    assert.strictEqual(result.status, 0, result.stderr);
    const partial = path.join(repo, 'partial.md');
    fs.writeFileSync(partial, '---\nscope_id: scope-a\ndiff_id: diff-a\ntask_id: task-current\n---\n');
    result = source(repo, [
      `dhpk_identity_artifact_matches ${JSON.stringify(partial)} scope-a diff-a '' '' '' '' '' '' '' attempt-current session-current 1 dispatch-current task-current`,
    ].join('\n'), [IDENTITY_LIB]);
    assert.notStrictEqual(result.status, 0, 'partial new identity must fail closed');
  } finally {
    rmRepo(repo);
  }
});

test('resumed identity rejects a foreign diff even when task/session/dispatch match', () => {
  const repo = mkRepo({ prefix: 'dhpk-lifecycle-identity-diff-' });
  try {
    const artifact = path.join(repo, 'foreign-diff.md');
    fs.writeFileSync(artifact, [
      '---',
      'task_id: task-current',
      'attempt_id: task-current:attempt:1',
      'scope_id: scope-a',
      'diff_id: diff-foreign',
      'session_id: session-current',
      'dispatch_attempt: 1',
      'dispatch_id: dispatch-current',
      '---',
    ].join('\n'));
    const record = JSON.stringify({
      task_id: 'task-current', attempt_id: 'task-current:attempt:1', scope: 'scope-a',
      diff_id: 'diff-current', session_id: 'session-current', dispatch_attempt: 1,
      dispatch_id: 'dispatch-current',
    });
    const result = source(repo, [`dhpk_identity_artifact_matches_record ${JSON.stringify(record)} ${JSON.stringify(artifact)}`].join('\n'), [IDENTITY_LIB]);
    assert.notStrictEqual(result.status, 0, 'foreign diff must fail closed');
  } finally {
    rmRepo(repo);
  }
});

run('review-lifecycle-identity');
