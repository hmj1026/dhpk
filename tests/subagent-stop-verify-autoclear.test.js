'use strict';

// Regression: subagent-stop-verify.sh Case B auto-clears a reviewer's own
// sentinel when that reviewer stops successfully AND a FRESH matching review
// artifact exists (A5 / reviewer-liveness-gate). This is the SANCTIONED
// clearance path — reviewer agent definitions no longer instruct a self-run
// closing clear-sentinel.sh (the auto-mode permission classifier blocks a
// reviewer clearing its own sentinel as "Logging/Audit Tampering"). The clear
// is GATED on artifact existence + freshness ONLY (never on verdict
// parseability — a legitimate fresh review whose verdict can't be parsed still
// stays armed, so the orchestrator re-dispatches instead of accepting an
// unparseable review). Only a fresh artifact with a parseable passing verdict
// clears the sentinel.
// SILENT. When the reviewer stops exit 0 but produced NO fresh review doc (none,
// or only a stale prior-cycle doc), the sentinel is LEFT ARMED so the gate stays
// unmet and the orchestrator re-dispatches — logged as a failure. Case A (a
// FAILED reviewer) also leaves the sentinel armed so the chain re-fires.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ROOT,
  mkRepo,
  sessionsDir: sessDir,
  runHook: runHookRaw,
} = require('./_lib/hookharness');

const HOOK = 'subagent-stop-verify.sh';
const ARM_HOOK = 'pre-agent-liveness-mark.sh';

function mkTempRepo() {
  return mkRepo({ prefix: 'dhpk-sv-', gitConfig: true });
}
function armSentinel(repo, name) {
  const d = sessDir(repo);
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, name);
  fs.writeFileSync(file, '2026-07-06 12:00 src/Foo.php\n');
  // Anchor the sentinel's mtime to a fixed instant so the Case B freshness gate
  // (review doc must postdate the sentinel) is deterministic: the default
  // review-artifact stamp (2026-07-07) is one day newer than this.
  const stamp = new Date('2026-07-06T12:00:00Z');
  fs.utimesSync(file, stamp, stamp);
}
function sentinelExists(repo, name) {
  return fs.existsSync(path.join(sessDir(repo), name));
}
function writeActiveMarker(repo, name, lines) {
  const d = sessDir(repo);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), `${lines.join('\n')}\n`);
}
function activeMarkerLines(repo, name) {
  const file = path.join(sessDir(repo), name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}
function unresolvedVerdict(repo) {
  const file = path.join(sessDir(repo), '.unresolved-verdict');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
function failureLogContents(repo) {
  const file = path.join(repo, '.claude', 'artifacts', 'agent-failures.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
// Default mtime 2026-07-07 is newer than a sentinel armed at 2026-07-06, so the
// doc reads as "fresh" for the Case B gate. Pass `isoStamp` to force an older
// (stale, prior-cycle) doc when exercising the freshness bound.
function writeReviewArtifact(repo, agent, body, isoStamp = '2026-07-07T12:00:00Z') {
  const dir = path.join(repo, '.claude', 'artifacts', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const nameStamp = isoStamp.slice(0, 10).replace(/-/g, '');
  const file = path.join(dir, `${agent}-${nameStamp}-120000-review.md`);
  const defaults = [
    [/^agent:/m, `agent: ${agent}`],
    [/^generated_at:/m, `generated_at: ${isoStamp}`],
    [/^commit:/m, 'commit: test-sha'],
    [/^scope:/m, 'scope: [test/fixture]'],
    [/^severity_summary:/m, 'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }'],
  ];
  const required = body.startsWith('---\n')
    ? body.replace('---\n', ['---', ...defaults.filter(([pattern]) => !pattern.test(body)).map(([, field]) => field)].join('\n') + '\n')
    : body;
  fs.writeFileSync(file, required);
  const stamp = new Date(isoStamp);
  fs.utimesSync(file, stamp, stamp);
  return file;
}

function runHook(repo, payload, { pluginRoot = ROOT, cwd = repo } = {}) {
  return runHookRaw(HOOK, {
    payload,
    cwd, // both sides now resolve ROOT env-first (session-env.sh); cwd is the git fallback
    pluginRoot,
    projectDir: repo, // pin the hook's ROOT to this temp repo
    deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'], // force default slot mapping
  });
}

test('dispatch arm-on-dispatch then fresh reviewer artifact round-trips to auto-clear', () => {
  const repo = mkTempRepo();
  try {
    const dispatched = runHookRaw(ARM_HOOK, {
      payload: { tool_input: { subagent_type: 'doc-reviewer' } },
      cwd: repo,
      projectDir: repo,
      deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    const sentinel = path.join(sessDir(repo), '.pending-doc-review');
    assert.ok(fs.existsSync(sentinel), 'dispatch must arm the reviewer sentinel');
    assert.ok(fs.readFileSync(sentinel, 'utf8').includes('[arm-on-dispatch]'));
    const fresh = new Date(Date.now() + 2000).toISOString();
    writeReviewArtifact(repo, 'doc-reviewer', '---\nverdict: APPROVE\n---\nclean', fresh);
    const stopped = runHook(repo, { subagent_type: 'doc-reviewer', exit_status: 0 });
    assert.strictEqual(stopped.status, 0, stopped.stderr);
    assert.ok(!fs.existsSync(sentinel), 'fresh reviewer result must auto-clear dispatch-armed sentinel');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('fast-worker SubagentStop removes exactly one matching shared liveness entry', () => {
  const repo = mkTempRepo();
  try {
    const now = Math.floor(Date.now() / 1000);
    writeActiveMarker(repo, '.active-fast-worker', [
      `${now} fast-worker pid=1`,
      `${now} dhpk:codex-fast-worker pid=2`,
      `${now} fast-worker pid=3`,
    ]);
    const stopped = runHook(repo, { subagent_type: 'dhpk:codex-fast-worker', exit_status: 1 });
    assert.strictEqual(stopped.status, 0, stopped.stderr);
    assert.deepStrictEqual(activeMarkerLines(repo, '.active-fast-worker'), [
      `${now} fast-worker pid=1`,
      `${now} fast-worker pid=3`,
    ]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('last fast-worker stop deletes the empty shared liveness marker', () => {
  const repo = mkTempRepo();
  try {
    writeActiveMarker(repo, '.active-fast-worker', [`${Math.floor(Date.now() / 1000)} agy-fast-worker pid=1`]);
    const stopped = runHook(repo, { agent_type: 'agy-fast-worker', exit_status: 0 });
    assert.strictEqual(stopped.status, 0, stopped.stderr);
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.active-fast-worker')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('reviewer stop with armed sentinel + fresh parseable artifact → silent auto-clear (sanctioned path)', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    writeReviewArtifact(repo, 'frontend-reviewer', [
      '---',
      'verdict: APPROVE',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      '---',
      'clean',
    ].join('\n'));
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was NOT auto-cleared on the reviewer\'s behalf');
    assert.ok(!res.stdout.includes('AUTO-CLEARED'),
      `sanctioned-path clear must be silent, got stdout:\n${res.stdout}`);
    assert.ok(!failureLogContents(repo).includes('no review doc'),
      'sanctioned-path clear must not be logged as a broken-contract failure');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rm -f fallback when CLAUDE_PLUGIN_ROOT unset → still cleared silently with a fresh artifact', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    writeReviewArtifact(repo, 'frontend-reviewer', [
      '---',
      'verdict: APPROVE',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      '---',
      'clean',
    ].join('\n'));
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 }, { pluginRoot: null });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was NOT cleared via the rm -f fallback');
    assert.ok(!res.stdout.includes('AUTO-CLEARED'),
      `sanctioned-path clear must be silent, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('A5: reviewer stop with armed sentinel but NO review artifact → LEFT ARMED, logged as failure', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'A5: a reviewer that produced no fresh review doc must LEAVE the sentinel armed (gate stays unmet)');
    assert.ok(res.stdout.includes('NO REVIEW DOC'),
      `expected the left-armed no-review-doc warning, got stdout:\n${res.stdout}`);
    assert.ok(failureLogContents(repo).includes('left armed, no review doc'),
      `no-review-doc stop must be logged as a failure:\n${failureLogContents(repo)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('A5: reviewer stop with armed sentinel + only a STALE prior-cycle doc → LEFT ARMED, logged as failure', () => {
  // Freshness bound: a review doc from an earlier cycle (mtime BEFORE the
  // sentinel that armed THIS review) must not mask a reviewer that produced
  // nothing this cycle. Reviewers run repeatedly per session, so this is the
  // steady-state broken-contract case, not a rare race.
  const repo = mkTempRepo();
  try {
    // Stale doc dated 2026-07-05 — older than the sentinel armed at 2026-07-06.
    writeReviewArtifact(repo, 'frontend-reviewer', [
      '---',
      'verdict: APPROVE',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      '---',
      'stale prior-cycle review',
    ].join('\n'), '2026-07-05T12:00:00Z');
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'A5: a stale prior-cycle doc is not fresh — the sentinel must be LEFT ARMED');
    assert.ok(res.stdout.includes('NO REVIEW DOC'),
      `a stale prior-cycle doc must not count as fresh — expected the left-armed warning, got stdout:\n${res.stdout}`);
    assert.ok(failureLogContents(repo).includes('left armed, no review doc'),
      `stale-doc-only stop must be logged as a failure:\n${failureLogContents(repo)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('A5: fresh artifact with an UNPARSEABLE verdict stays armed for re-dispatch', () => {
  // A review artifact is only evidence when its verdict is machine-parseable.
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    writeReviewArtifact(repo, 'frontend-reviewer', [
      '---',
      'summary: reviewed, all good',
      '---',
      'no machine-parseable verdict field here',
    ].join('\n'));
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'an unparseable review artifact must leave the sentinel armed');
    assert.ok(res.stdout.includes('NO REVIEW DOC'),
      `an unparseable artifact must report unmet review debt:\n${res.stdout}`);
    assert.ok(failureLogContents(repo).includes('left armed, no review doc'),
      `unparseable review should be reported as unmet review debt:\n${failureLogContents(repo)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a canonical filename with body-only verdict text stays armed', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    const dir = path.join(repo, '.claude', 'artifacts', 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'code-reviewer-20260707-120000-review.md');
    fs.writeFileSync(file, 'agent: code-reviewer\nverdict: APPROVE\n');
    const stamp = new Date('2026-07-07T12:00:00Z');
    fs.utimesSync(file, stamp, stamp);
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'),
      'body text must not satisfy the delimited frontmatter requirement');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('a noncanonical reviewer artifact filename stays armed despite a passing frontmatter verdict', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    const canonical = writeReviewArtifact(repo, 'code-reviewer', '---\nverdict: APPROVE\n---\nclean');
    const noncanonical = canonical.replace(/-20260707-120000-review\.md$/, '-latest.md');
    fs.renameSync(canonical, noncanonical);
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'),
      'only canonical timestamp/slug reviewer artifacts may clear a sentinel');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('scoping: frontend-reviewer stop clears ONLY its slot, not code-reviewer\'s', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    armSentinel(repo, '.pending-frontend-review');
    writeReviewArtifact(repo, 'frontend-reviewer', '---\nverdict: APPROVE\n---\nclean');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'frontend-reviewer\'s own sentinel was not cleared');
    assert.ok(sentinelExists(repo, '.pending-review'),
      'code-reviewer\'s .pending-review was wrongly cleared by a frontend-reviewer stop');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('default reviewers auto-clear only their own sentinels', () => {
  const cases = [
    ['code-reviewer', '.pending-review', ['.pending-db-review', '.pending-doc-review']],
    ['database-reviewer', '.pending-db-review', ['.pending-review', '.pending-doc-review']],
    ['doc-reviewer', '.pending-doc-review', ['.pending-review', '.pending-db-review']],
  ];
  for (const [agent, ownSentinel, otherSentinels] of cases) {
    const repo = mkTempRepo();
    try {
      armSentinel(repo, ownSentinel);
      for (const other of otherSentinels) armSentinel(repo, other);
      writeReviewArtifact(repo, agent, '---\nverdict: APPROVE\n---\nclean');
      const res = runHook(repo, { subagent_type: agent, exit_status: 0 });
      assert.strictEqual(res.status, 0, `hook exited non-zero for ${agent}: ${res.stderr}`);
      assert.ok(!sentinelExists(repo, ownSentinel), `${agent} did not clear ${ownSentinel}`);
      for (const other of otherSentinels) {
        assert.ok(sentinelExists(repo, other), `${agent} wrongly cleared ${other}`);
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('SubagentStop identity payload variants map to the correct reviewer slot', () => {
  const cases = [
    { subagent: 'database-reviewer', exit_status: 0 },
    { tool_input: { subagent_type: 'database-reviewer' }, exit_status: 0 },
  ];
  for (const payload of cases) {
    const repo = mkTempRepo();
    try {
      armSentinel(repo, '.pending-db-review');
      armSentinel(repo, '.pending-review');
      writeReviewArtifact(repo, 'database-reviewer', '---\nverdict: PASS\n---\nclean');
      const res = runHook(repo, payload);
      assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
      assert.ok(!sentinelExists(repo, '.pending-db-review'),
        `database-reviewer sentinel remained for payload ${JSON.stringify(payload)}`);
      assert.ok(sentinelExists(repo, '.pending-review'),
        `payload ${JSON.stringify(payload)} wrongly cleared code-reviewer sentinel`);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('database-reviewer failure keeps sentinel armed', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-db-review');
    const res = runHook(repo, { subagent_type: 'database-reviewer', exit_status: 1 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-db-review'),
      'database-reviewer failure must keep .pending-db-review armed');
    assert.ok(!res.stdout.includes('AUTO-CLEARED'), 'failure path must not report AUTO-CLEARED');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Case A unchanged: a FAILED reviewer (exit!=0) keeps its sentinel armed', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 1 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was wrongly cleared for a FAILED reviewer (Case A must keep it armed)');
    assert.ok(res.stdout.includes('SUBAGENT FAILURE'),
      `expected SUBAGENT FAILURE systemMessage, got stdout:\n${res.stdout}`);
    assert.ok(!res.stdout.includes('AUTO-CLEARED'), 'must not report AUTO-CLEARED on failure');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('unrecognized / absent subagent name → sentinel untouched (schema-drift safety)', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    // Non-reviewer name (not in SENTINEL_AGENTS) → SLOT=-1 → exits before Case B.
    const res1 = runHook(repo, { subagent_type: 'general-purpose', exit_status: 0 });
    assert.strictEqual(res1.status, 0, `hook exited non-zero: ${res1.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'sentinel wrongly cleared for a non-reviewer subagent');
    assert.ok(!res1.stdout.includes('AUTO-CLEARED'));
    // Absent subagent name (payload schema drift) → same silent exit.
    const res2 = runHook(repo, { exit_status: 0 });
    assert.strictEqual(res2.status, 0, `hook exited non-zero: ${res2.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-frontend-review'),
      'sentinel wrongly cleared when subagent name absent');
    assert.ok(!res2.stdout.includes('AUTO-CLEARED'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('known reviewer stop removes exactly one matching liveness entry on success', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    writeActiveMarker(repo, '.active-review', ['100 code-reviewer first', '101 code-reviewer second']);
    writeActiveMarker(repo, '.active-db-review', ['102 database-reviewer']);
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.deepStrictEqual(activeMarkerLines(repo, '.active-review'), ['101 code-reviewer second']);
    assert.deepStrictEqual(activeMarkerLines(repo, '.active-db-review'), ['102 database-reviewer']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('known reviewer stop removes one liveness entry on failure while sentinel remains armed', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-db-review');
    writeActiveMarker(repo, '.active-db-review', ['100 database-reviewer']);
    const res = runHook(repo, { subagent_type: 'database-reviewer', exit_status: 1 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-db-review'), 'failure must keep review sentinel armed');
    assert.deepStrictEqual(activeMarkerLines(repo, '.active-db-review'), []);
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.active-db-review')),
      'last liveness entry removal should remove the marker file');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('review artifact BLOCK/FAIL verdict stays armed and writes unresolved-verdict sidecar line', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-db-review');
    writeReviewArtifact(repo, 'database-reviewer', [
      '---',
      'verdict: FAIL',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      '---',
      'finding',
    ].join('\n'));
    const res = runHook(repo, { subagent_type: 'database-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(sentinelExists(repo, '.pending-db-review'),
      'a fresh failing verdict must not satisfy the reviewer sentinel');
    const sidecar = unresolvedVerdict(repo);
    assert.ok(sidecar.includes('.pending-db-review'), `missing db slot line:\n${sidecar}`);
    assert.ok(sidecar.includes('database-reviewer'), `missing reviewer name:\n${sidecar}`);
    assert.ok(sidecar.includes('verdict=FAIL'), `missing FAIL verdict marker:\n${sidecar}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('real-schema prefixed agent_type resolves the review doc for the verdict gate (regression)', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-db-review');
    // Reviewers name their review doc with the BARE label; the real SubagentStop
    // payload identifies them via a prefixed top-level agent_type. The gate must
    // strip the namespace so the glob still resolves — else a BLOCK/FAIL verdict
    // silently vanishes for the exact real-production payload shape.
    writeReviewArtifact(repo, 'database-reviewer', [
      '---',
      'verdict: FAIL',
      'severity_summary: { critical: 0, high: 1, medium: 0, low: 0 }',
      '---',
      'finding',
    ].join('\n'));
    const res = runHook(repo, { agent_type: 'dhpk:database-reviewer' });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    const sidecar = unresolvedVerdict(repo);
    assert.ok(sidecar.includes('.pending-db-review'), `verdict gate skipped for prefixed agent_type (regression):\n${sidecar}`);
    assert.ok(sidecar.includes('database-reviewer'), `missing bare reviewer name in sidecar:\n${sidecar}`);
    assert.ok(sidecar.includes('verdict=FAIL'), `missing FAIL verdict marker:\n${sidecar}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('review artifact medium severity writes unresolved-verdict even with PASS verdict', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-db-review');
    writeReviewArtifact(repo, 'database-reviewer', [
      '---',
      'verdict: PASS',
      'severity_summary: { critical: 0, high: 0, medium: 1, low: 0 }',
      '---',
      'medium finding',
    ].join('\n'));
    const res = runHook(repo, { subagent_type: 'database-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    const sidecar = unresolvedVerdict(repo);
    assert.ok(sidecar.includes('.pending-db-review'), `missing db slot line:\n${sidecar}`);
    assert.ok(sidecar.includes('medium=1'), `missing medium count marker:\n${sidecar}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('clean review artifact clears the matching unresolved-verdict sidecar line', () => {
  const repo = mkTempRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    fs.writeFileSync(path.join(sessDir(repo), '.unresolved-verdict'),
      '.pending-db-review\tdatabase-reviewer\tverdict=FAIL\n.pending-review\tcode-reviewer\tverdict=FAIL\n');
    armSentinel(repo, '.pending-db-review');
    writeReviewArtifact(repo, 'database-reviewer', [
      '---',
      'verdict: PASS',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 1 }',
      '---',
      'clean',
    ].join('\n'));
    const res = runHook(repo, { subagent_type: 'database-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    const sidecar = unresolvedVerdict(repo);
    assert.ok(!sidecar.includes('.pending-db-review'), `db slot line not cleared:\n${sidecar}`);
    assert.ok(sidecar.includes('.pending-review'), `other slot line was wrongly removed:\n${sidecar}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('missing review artifact does not create unresolved-verdict sidecar', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-db-review');
    const res = runHook(repo, { subagent_type: 'database-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.strictEqual(unresolvedVerdict(repo), '', 'missing artifact must degrade silently without sidecar write');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('guaranteed removal when CLAUDE_PROJECT_DIR diverges from cwd git-toplevel', () => {
  // The hook detects the sentinel under CLAUDE_PROJECT_DIR (repoA), but
  // clear-sentinel.sh resolves ITS root from the cwd's git-toplevel (repoB).
  // clear-sentinel.sh no-ops ("already clean") on repoB and exits 0, so the
  // hook must still guarantee removal of the exact file it flagged in repoA —
  // otherwise AUTO-CLEARED would be a false report.
  const repoA = mkTempRepo();
  const repoB = mkTempRepo();
  try {
    armSentinel(repoA, '.pending-frontend-review');
    writeReviewArtifact(repoA, 'frontend-reviewer', '---\nverdict: APPROVE\n---\nclean');
    const res = runHook(repoA, { subagent_type: 'frontend-reviewer', exit_status: 0 }, { cwd: repoB });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repoA, '.pending-frontend-review'),
      'sentinel under CLAUDE_PROJECT_DIR was NOT removed when clear-sentinel.sh resolved a different root');
    // A fresh parseable artifact clears silently (no stdout warning); the
    // guaranteed rm is still logged in repoA's agent-failures.log.
    assert.ok(failureLogContents(repoA).includes('auto-cleared'),
      `expected an auto-cleared log line in repoA, got:\n${failureLogContents(repoA)}`);
  } finally {
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('real SubagentStop schema (top-level prefixed agent_type, no subagent_type/exit_status) auto-clears', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    writeActiveMarker(repo, '.active-review', ['100 code-reviewer']);
    writeReviewArtifact(repo, 'code-reviewer', '---\nverdict: APPROVE\n---\nclean');
    const res = runHook(repo, { agent_type: 'dhpk:code-reviewer' });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-review'),
      'sentinel was NOT auto-cleared for the real prefixed agent_type schema');
    assert.deepStrictEqual(activeMarkerLines(repo, '.active-review'), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// -1 / 0 / 1 over dotted numeric versions. Only used to assert a recording is
// not newer than the running plugin.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

test('recorded lin_blog 0.28.14 fixture auto-clears only the frontend sentinel', () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'tests', 'fixtures', 'subagent-stop', 'lin-blog-2026-07-17.json'),
    'utf8'
  ));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

  // This fixture is a RECORDING of a real lin_blog session on 2026-07-17 — it
  // carries that session's id, hook hash, and timestamps. It is not a
  // description of the current release.
  //
  // This assertion used to be `strictEqual(manifest.version, fixture.installedPluginVersion)`,
  // which made every release bump fail CI and be "fixed" by rewriting the
  // recording. The recorded version drifted 0.28.14 -> .15 -> .16 -> .17 -> .18
  // while the session it documents never changed, and `conclusion` was left
  // behind at 0.28.16 — so the file ended up claiming a 2026-07-17 session ran
  // on a version released 2026-07-22, and contradicting itself. The same test
  // pins `installedHookSha1` precisely BECAUSE the recording must be preserved,
  // so the old assertion contradicted its own neighbour.
  //
  // The invariant that actually holds: a recording cannot come from the future.
  assert.ok(
    compareVersions(fixture.installedPluginVersion, manifest.version) <= 0,
    `recorded fixture version ${fixture.installedPluginVersion} is newer than the plugin's own `
      + `${manifest.version} — a recording cannot come from a future release`
  );
  // Internal consistency: the conclusion narrates the same version it records.
  // This is what silently rotted when only one of the two fields was bumped.
  assert.ok(
    fixture.conclusion.startsWith(`${fixture.installedPluginVersion} `),
    `fixture conclusion must reference the version it records (${fixture.installedPluginVersion}), got: ${fixture.conclusion}`
  );
  assert.strictEqual(fixture.installedHookSha1, '6d408d1e4d049900381e95e92920e1be1c7f75ed',
    'recorded fixture must retain the installed-session hook hash; current hook behavior is exercised below');
  assert.deepStrictEqual(fixture.subagentStopIdentity, {
    field: 'agent_type',
    value: 'dhpk:frontend-reviewer',
  });
  assert.match(fixture.artifact.filename, /^frontend-reviewer-/);
  assert.ok(Date.parse(fixture.artifact.mtime) > Date.parse(fixture.artifact.generatedAt));
  assert.match(fixture.autoClearLog.line, /frontend-reviewer.*\.pending-frontend-review \(auto-cleared\)/);
  assert.match(fixture.conclusion, /no frontend hook map change is warranted/);

  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    armSentinel(repo, '.pending-review');
    writeReviewArtifact(repo, 'frontend-reviewer', [
      '---',
      'agent: frontend-reviewer',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 1 }',
      'verdict: APPROVE',
      '---',
      'clean',
    ].join('\n'), fixture.artifact.mtime);
    const payload = { [fixture.subagentStopIdentity.field]: fixture.subagentStopIdentity.value };
    const res = runHook(repo, payload);
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'frontend sentinel was NOT auto-cleared for the real prefixed agent_type schema');
    assert.ok(sentinelExists(repo, '.pending-review'),
      'code-reviewer sentinel must stay armed — frontend clear must be scoped');
    assert.ok(failureLogContents(repo).includes('auto-cleared'),
      `expected an auto-cleared log line, got:\n${failureLogContents(repo)}`);
    assert.ok(!failureLogContents(repo).includes('left armed'),
      `frontend stop must not be logged as left armed:\n${failureLogContents(repo)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---- Misplaced review artifact (issue #71) ----
//
// A reviewer that writes its artifact outside the canonical
// `.claude/artifacts/reviews/` produces a SILENT failure: the sentinel stays
// armed with the message "wrote no fresh review doc", which is false — it wrote
// one, in the wrong place. The operator reads "not reviewed", reaches for
// clear-sentinel.sh, and the gate erodes into a formality.
//
// The fix diagnoses; it deliberately does NOT clear. Clearing from a
// non-canonical path would bypass the freshness boundary (artifact mtime must
// postdate the sentinel) — and a misfiled artifact typically lacks the
// timestamped filename the contract requires, so freshness cannot even be
// evaluated for it.

// Write a review artifact to a NON-canonical location under .claude/artifacts/.
function writeMisplacedReviewArtifact(repo, subdir, filename, isoStamp = '2026-07-07T12:00:00Z') {
  const dir = path.join(repo, '.claude', 'artifacts', ...subdir.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, '---\nverdict: APPROVE\n---\nclean');
  const stamp = new Date(isoStamp);
  fs.utimesSync(file, stamp, stamp);
  return file;
}

function writeMisplacedReviewWithFrontmatter(repo, subdir, filename, isoStamp, frontmatter = {}) {
  const dir = path.join(repo, '.claude', 'artifacts', ...subdir.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  const fields = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  fs.writeFileSync(file, `---\n${fields.join('\n')}\nverdict: APPROVE\n---\nclean`);
  const stamp = new Date(isoStamp);
  fs.utimesSync(file, stamp, stamp);
  return file;
}

function dispatchReviewer(repo, agent = 'code-reviewer', sessionId = 'session-current', dispatchId = 'attempt-1') {
  return runHookRaw(ARM_HOOK, {
    payload: {
      session_id: sessionId,
      tool_use_id: dispatchId,
      tool_input: { subagent_type: agent },
    },
    cwd: repo,
    projectDir: repo,
    deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
  });
}

function makeNoPythonPath() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-no-python-bin-'));
  const commands = ['bash', 'jq', 'awk', 'stat', 'find', 'date', 'git', 'mkdir', 'mktemp', 'rm', 'cat', 'sed', 'head', 'ls', 'dirname', 'pwd', 'grep', 'sort', 'cut', 'tr', 'wc'];
  for (const command of commands) {
    const found = spawnSync('bash', ['-c', `command -v ${command}`], { encoding: 'utf8' });
    const target = found.status === 0 ? found.stdout.trim() : '';
    if (target) fs.symlinkSync(target, path.join(bin, command));
  }
  return bin;
}

test('a review artifact misfiled under sessions/reviews leaves the sentinel armed and is diagnosed', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    // The exact shape observed in the wild: wrong dir AND no timestamp.
    writeMisplacedReviewArtifact(
      repo,
      'sessions/reviews',
      'code-reviewer-add-session-install-health-gate-confirm.md'
    );
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);

    // The freshness boundary is not bypassed: the sentinel must NOT clear.
    assert.ok(
      sentinelExists(repo, '.pending-review'),
      'a misfiled artifact must not clear the sentinel — that would bypass the freshness gate'
    );

    // ...but the failure must stop being silent. Both paths must be named.
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(
      /misplaced|misfiled|wrong location/i.test(surfaced),
      `expected a misplaced-artifact diagnostic, got:\n${surfaced}`
    );
    assert.ok(
      surfaced.includes('sessions/reviews'),
      `diagnostic must name where the artifact was FOUND:\n${surfaced}`
    );
    assert.ok(
      /artifacts\/reviews/.test(surfaced),
      `diagnostic must name where it was EXPECTED:\n${surfaced}`
    );
    // The old, now-false "wrote no review doc" wording must not be what surfaces.
    assert.ok(
      !/no review doc/i.test(surfaced),
      `must not claim no review doc was written when one exists elsewhere:\n${surfaced}`
    );
    assert.ok(/current-unknown-session/.test(surfaced), `unknown-session reason missing:\n${surfaced}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('stale misplaced artifacts are ignored and logged as no-fresh, not attributed to this stop', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    writeMisplacedReviewArtifact(repo, 'sessions/reviews', 'code-reviewer-stale.md', '2026-07-05T12:00:00Z');
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'));
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(/no fresh review doc|stale misplaced/i.test(surfaced), surfaced);
    assert.ok(!surfaced.includes('code-reviewer-stale.md'), 'stale path must not be attributed to this stop');
    assert.ok(!surfaced.includes(repo), 'diagnostics must not expose an absolute host path');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('fresh current-session misplaced artifacts are diagnosed without clearing', () => {
  const repo = mkTempRepo();
  try {
    const dispatched = dispatchReviewer(repo, 'code-reviewer', 'session-current', 'attempt-current');
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    writeMisplacedReviewWithFrontmatter(
      repo,
      'sessions/reviews',
      'code-reviewer-current.md',
      new Date(Date.now() + 2000).toISOString(),
      { session_id: 'session-current', dispatch_id: 'attempt-current', attempt: 1 },
    );
    const res = runHook(repo, { subagent_type: 'code-reviewer', session_id: 'session-current', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'));
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(surfaced.includes('code-reviewer-current.md'), surfaced);
    assert.ok(/current-session/.test(surfaced), surfaced);
    assert.ok(surfaced.includes('attempt=1') && surfaced.includes('dispatch=attempt-current'), surfaced);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('body text that resembles provenance is ignored without frontmatter delimiters', () => {
  const repo = mkTempRepo();
  try {
    const dispatched = dispatchReviewer(repo, 'code-reviewer', 'session-current', 'attempt-current');
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    const dir = path.join(repo, '.claude', 'artifacts', 'sessions', 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'code-reviewer-body-text.md');
    fs.writeFileSync(file, 'Session: findings\nverdict: APPROVE\n');
    const stamp = new Date(Date.now() + 2000);
    fs.utimesSync(file, stamp, stamp);
    const res = runHook(repo, { subagent_type: 'code-reviewer', session_id: 'session-current', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'));
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(surfaced.includes('code-reviewer-body-text.md'), surfaced);
    assert.ok(/current-unknown-session/.test(surfaced), surfaced);
    assert.ok(!/foreign/.test(surfaced), surfaced);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('no-python fallback accepts quoted current-session provenance', () => {
  const repo = mkTempRepo();
  const noPythonPath = makeNoPythonPath();
  try {
    const dispatched = dispatchReviewer(repo, 'code-reviewer', 'session-current', 'attempt-current');
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    writeMisplacedReviewWithFrontmatter(
      repo,
      'sessions/reviews',
      'code-reviewer-quoted-current.md',
      new Date(Date.now() + 2000).toISOString(),
      { session_id: "'session-current'", dispatch_id: "'attempt-current'", attempt: "'1'" },
    );
    const res = runHookRaw(HOOK, {
      payload: { subagent_type: 'code-reviewer', session_id: 'session-current', exit_status: 0 },
      cwd: repo,
      projectDir: repo,
      env: { PATH: noPythonPath },
      deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'));
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(surfaced.includes('code-reviewer-quoted-current.md'), surfaced);
    assert.ok(/current-session/.test(surfaced), surfaced);
    assert.ok(!/foreign/.test(surfaced), surfaced);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(noPythonPath, { recursive: true, force: true });
  }
});

test('learning-db and failure logs identify current versus stale misplaced outcomes without host paths', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    writeMisplacedReviewArtifact(repo, 'sessions/reviews', 'code-reviewer-old.md', '2026-07-05T12:00:00Z');
    const stale = runHookRaw(HOOK, {
      payload: { subagent_type: 'code-reviewer', session_id: 'session-stale', exit_status: 0 },
      cwd: repo,
      projectDir: repo,
      env: { DHPK_LEARNING_DB: '1' },
      deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(stale.status, 0, stale.stderr);
    const staleLog = failureLogContents(repo);
    const learning = path.join(repo, '.claude', 'artifacts', 'learning.jsonl');
    const learningText = fs.existsSync(learning) ? fs.readFileSync(learning, 'utf8') : '';
    assert.ok(staleLog.includes('no fresh review doc') && staleLog.includes('stale'), staleLog);
    assert.ok(learningText.includes('review-doc-no-fresh:.pending-review') && learningText.includes('reason=stale'), learningText);
    assert.ok(!staleLog.includes(repo) && !learningText.includes(repo), 'learning/log output must redact host paths');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('foreign-session misplaced artifacts are ignored while the current gate stays armed', () => {
  const repo = mkTempRepo();
  try {
    const dispatched = dispatchReviewer(repo, 'code-reviewer', 'session-current', 'attempt-current');
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    writeMisplacedReviewWithFrontmatter(
      repo,
      'sessions/reviews',
      'code-reviewer-foreign.md',
      new Date(Date.now() + 2000).toISOString(),
      { session_id: 'session-foreign', dispatch_id: 'attempt-foreign', attempt: 1 },
    );
    const res = runHook(repo, { subagent_type: 'code-reviewer', session_id: 'session-current', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'));
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(/no fresh review doc|foreign/i.test(surfaced), surfaced);
    assert.ok(!surfaced.includes('code-reviewer-foreign.md'), 'foreign path must not be attributed to current stop');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a stop from a foreign session cannot claim an unproven fresh misplaced file', () => {
  const repo = mkTempRepo();
  try {
    const dispatched = dispatchReviewer(repo, 'code-reviewer', 'session-current', 'attempt-current');
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    writeMisplacedReviewWithFrontmatter(
      repo,
      'sessions/reviews',
      'code-reviewer-unknown-foreign-stop.md',
      new Date(Date.now() + 2000).toISOString(),
    );
    const res = runHook(repo, { subagent_type: 'code-reviewer', session_id: 'session-foreign', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'));
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(/no fresh review doc|foreign/i.test(surfaced), surfaced);
    assert.ok(!surfaced.includes('code-reviewer-unknown-foreign-stop.md'), 'foreign stop must not claim an unknown-session path');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('multiple qualifying misplaced artifacts select newest, then stable relative path on ties', () => {
  const repo = mkTempRepo();
  try {
    const dispatched = dispatchReviewer(repo, 'code-reviewer', 'session-current', 'attempt-current');
    assert.strictEqual(dispatched.status, 0, dispatched.stderr);
    const current = Date.now() + 2000;
    writeMisplacedReviewWithFrontmatter(repo, 'sessions/reviews', 'code-reviewer-old.md', new Date(current).toISOString(), { session_id: 'session-current' });
    writeMisplacedReviewWithFrontmatter(repo, 'sessions/reviews', 'code-reviewer-new.md', new Date(current + 2000).toISOString(), { session_id: 'session-current' });
    writeMisplacedReviewWithFrontmatter(repo, 'sessions/reviews', 'code-reviewer-aaa.md', new Date(current + 3000).toISOString(), { session_id: 'session-current' });
    writeMisplacedReviewWithFrontmatter(repo, 'sessions/reviews', 'code-reviewer-zzz.md', new Date(current + 3000).toISOString(), { session_id: 'session-current' });
    const res = runHook(repo, { subagent_type: 'code-reviewer', session_id: 'session-current', exit_status: 0 });
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(surfaced.includes('code-reviewer-aaa.md'), surfaced);
    assert.ok(!surfaced.includes('code-reviewer-new.md'), 'older qualifying candidate must not win');
    assert.ok(!surfaced.includes('code-reviewer-zzz.md'), 'stable tie-breaker must select one candidate');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a genuinely absent artifact keeps the existing no-review-doc behaviour', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'), 'no artifact anywhere must still leave the sentinel armed');
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(/no review doc/i.test(surfaced), `expected the unchanged no-review-doc message:\n${surfaced}`);
    assert.ok(
      !/misplaced|misfiled/i.test(surfaced),
      `must not claim misplacement when nothing was written:\n${surfaced}`
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a canonical fresh artifact still auto-clears and raises no misplacement diagnostic', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    // A decoy in the wrong place must not confuse the canonical path.
    writeMisplacedReviewArtifact(repo, 'sessions/reviews', 'code-reviewer-decoy.md');
    writeReviewArtifact(repo, 'code-reviewer', '---\nverdict: APPROVE\n---\nclean');
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(!sentinelExists(repo, '.pending-review'), 'canonical fresh artifact must still auto-clear');
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(
      !/misplaced|misfiled/i.test(surfaced),
      `no misplacement diagnostic when the canonical artifact exists:\n${surfaced}`
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a stale canonical artifact plus a misplaced one still reports misplacement, not a clear', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    // Prior-cycle doc: older than the sentinel, so it fails the freshness gate.
    writeReviewArtifact(repo, 'code-reviewer', '---\nverdict: APPROVE\n---\nold', '2026-07-05T12:00:00Z');
    writeMisplacedReviewArtifact(repo, 'sessions/reviews', 'code-reviewer-confirm.md');
    const res = runHook(repo, { subagent_type: 'code-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(sentinelExists(repo, '.pending-review'), 'a stale canonical doc must not clear the sentinel');
    const surfaced = failureLogContents(repo) + res.stdout + res.stderr;
    assert.ok(
      /misplaced|misfiled|wrong location/i.test(surfaced),
      `the misplaced artifact should still be surfaced:\n${surfaced}`
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('subagent-stop-verify-autoclear');
