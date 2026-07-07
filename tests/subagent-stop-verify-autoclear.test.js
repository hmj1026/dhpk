'use strict';

// Regression: subagent-stop-verify.sh Case B must AUTO-CLEAR a reviewer's own
// sentinel when that reviewer subagent stops successfully with the sentinel
// still armed. Reviewers spawned via the Agent/Task tool do not reliably run
// their own closing clear-sentinel.sh, leaving a stale sentinel that falsely
// blocks the opsx-apply-goal end-gate. Case B was warn-only; it now clears
// (scoped strictly to the reviewer's own slot) then warns. Case A (a FAILED
// reviewer) must still leave the sentinel armed so the chain re-fires.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'subagent-stop-verify.sh');

function mkTempRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sv-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}
function armSentinel(repo, name) {
  const d = sessDir(repo);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), '2026-07-06 12:00 src/Foo.php\n');
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
function writeReviewArtifact(repo, agent, body) {
  const dir = path.join(repo, '.claude', 'artifacts', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${agent}-20260707-120000.md`);
  fs.writeFileSync(file, body);
  const stamp = new Date('2026-07-07T12:00:00Z');
  fs.utimesSync(file, stamp, stamp);
  return file;
}

function runHook(repo, payload, { pluginRoot = ROOT, cwd = repo } = {}) {
  const env = { ...process.env };
  delete env.DHPK_ACTIVE_MODULES;
  delete env.CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS; // force default slot mapping
  env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE = 'standard'; // ensure advisory messages emit
  env.CLAUDE_PROJECT_DIR = repo; // pin the hook's ROOT to this temp repo
  if (pluginRoot === null) delete env.CLAUDE_PLUGIN_ROOT;
  else env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = JSON.stringify(payload);
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd, // clear-sentinel.sh derives ITS root from cwd's git-toplevel
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('reviewer stop with armed sentinel → auto-cleared via clear-sentinel.sh (primary path)', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was NOT auto-cleared on the reviewer\'s behalf');
    assert.ok(res.stdout.includes('AUTO-CLEARED'),
      `expected AUTO-CLEARED systemMessage, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rm -f fallback when CLAUDE_PLUGIN_ROOT unset → still cleared', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-frontend-review');
    const res = runHook(repo, { subagent_type: 'frontend-reviewer', exit_status: 0 }, { pluginRoot: null });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-frontend-review'),
      'sentinel was NOT cleared via the rm -f fallback');
    assert.ok(res.stdout.includes('AUTO-CLEARED'),
      `expected AUTO-CLEARED systemMessage, got stdout:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('scoping: frontend-reviewer stop clears ONLY its slot, not code-reviewer\'s', () => {
  const repo = mkTempRepo();
  try {
    armSentinel(repo, '.pending-review');
    armSentinel(repo, '.pending-frontend-review');
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
    const res = runHook(repoA, { subagent_type: 'frontend-reviewer', exit_status: 0 }, { cwd: repoB });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repoA, '.pending-frontend-review'),
      'sentinel under CLAUDE_PROJECT_DIR was NOT removed when clear-sentinel.sh resolved a different root');
    assert.ok(res.stdout.includes('AUTO-CLEARED'),
      `expected AUTO-CLEARED, got stdout:\n${res.stdout}`);
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
    const res = runHook(repo, { agent_type: 'dhpk:code-reviewer' });
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!sentinelExists(repo, '.pending-review'),
      'sentinel was NOT auto-cleared for the real prefixed agent_type schema');
    assert.deepStrictEqual(activeMarkerLines(repo, '.active-review'), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('subagent-stop-verify-autoclear');
