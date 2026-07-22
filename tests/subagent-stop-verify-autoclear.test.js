'use strict';

// Regression: subagent-stop-verify.sh Case B auto-clears a reviewer's own
// sentinel when that reviewer stops successfully AND a FRESH matching review
// artifact exists (A5 / reviewer-liveness-gate). This is the SANCTIONED
// clearance path — reviewer agent definitions no longer instruct a self-run
// closing clear-sentinel.sh (the auto-mode permission classifier blocks a
// reviewer clearing its own sentinel as "Logging/Audit Tampering"). The clear
// is GATED on artifact existence + freshness ONLY (never on verdict
// parseability — a legitimate fresh review whose verdict can't be parsed still
// clears, so the orchestrator never loops forever on a present-but-unparseable
// doc). When a fresh artifact with a parseable verdict exists the clear is
// SILENT. When the reviewer stops exit 0 but produced NO fresh review doc (none,
// or only a stale prior-cycle doc), the sentinel is LEFT ARMED so the gate stays
// unmet and the orchestrator re-dispatches — logged as a failure. Case A (a
// FAILED reviewer) also leaves the sentinel armed so the chain re-fires.

const fs = require('node:fs');
const path = require('node:path');
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
  const file = path.join(dir, `${agent}-${nameStamp}-120000.md`);
  fs.writeFileSync(file, body);
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

test('A5: fresh artifact with an UNPARSEABLE verdict still clears (no re-dispatch loop)', () => {
  // The clear gate keys on existence + freshness, NOT verdict-parseability. A
  // legitimate fresh review whose frontmatter has no parseable `verdict:` field
  // must still clear the sentinel — otherwise the orchestrator loops forever.
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
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'a fresh artifact (even with an unparseable verdict) must clear the sentinel');
    assert.ok(!res.stdout.includes('NO REVIEW DOC'),
      `a present fresh artifact must not trigger the no-review-doc warning:\n${res.stdout}`);
    assert.ok(failureLogContents(repo).includes('verdict unparseable'),
      `unparseable-but-present clear should be noted:\n${failureLogContents(repo)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
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

test('review artifact BLOCK/FAIL verdict writes unresolved-verdict sidecar line', () => {
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

run('subagent-stop-verify-autoclear');
