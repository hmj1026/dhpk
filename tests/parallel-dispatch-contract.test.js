'use strict';

// Coverage for the harden-parallel-dispatch-worker-boundaries change:
// - 1.3 workers/wrappers carry no destructive out-of-scope cleanup authority
// - 1.4 the dispatch table distinguishes judgment-dense (>=3 files) work from
//   purely mechanical CLI work, small inline work, and open-ended reasoning
// - 3.2 scripts/ci/validate-skills.js has no scoped mode and never writes the
//   shared skill-size-allowlist.json itself, so a worker must report rather
//   than self-edit the ratchet — proven from the actual script source
// - 4.2 reviewer sentinel derivation for an assigned edited-file list matches
//   normal (non-parallel) hook-driven sentinel arming, unaffected by a
//   sibling's own armed sentinel in the same shared checkout

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const ROOT = path.join(__dirname, '..');
const FORBIDDEN_CLEANUP = ['git checkout', 'git restore', 'git reset', 'git clean'];

// 1.3 — worker/wrapper contract carries no destructive cleanup authority.
test('fast-worker and codex-fast-worker prompts explicitly forbid out-of-scope cleanup commands', () => {
  for (const file of ['fast-worker.md', 'codex-fast-worker.md']) {
    const prompt = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
    for (const cmd of FORBIDDEN_CLEANUP) {
      assert.ok(prompt.includes(cmd), `${file} must name '${cmd}' as prohibited against out-of-scope paths`);
    }
    assert.ok(/forceful deletion|force-delet/i.test(prompt), `${file} must prohibit forceful deletion of out-of-scope paths`);
  }
});

test('the shared codex wrapper script contains no forbidden cleanup invocation against sibling files', () => {
  const wrapper = fs.readFileSync(
    path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'scripts', 'run-codex.sh'),
    'utf8'
  );
  for (const cmd of FORBIDDEN_CLEANUP) {
    assert.ok(!wrapper.includes(cmd), `run-codex.sh must never itself invoke '${cmd}'`);
  }
  // The wrapper legitimately `rm -rf`s its OWN private mktemp scratch dir on
  // exit (standard temp-file hygiene) — that is not sibling-file cleanup
  // authority. Assert every `rm -rf` occurrence targets only that private var,
  // never the workdir or an assigned/sibling path.
  const rmMatches = wrapper.match(/rm\s+-rf\s+\S+/g) || [];
  assert.ok(rmMatches.length > 0, 'sanity check: run-codex.sh is expected to clean its own temp dir');
  for (const m of rmMatches) {
    assert.ok(/WORK_TMP/.test(m), `run-codex.sh 'rm -rf' must target only its own scratch dir, found: ${m}`);
  }
});

// 1.4 — routing fixtures distinguishing judgment-dense (>=3 files) work from
// mechanical CLI work, small inline work, and open-ended reasoning work.
test('the dispatch table names four distinguishable implement-phase routing tiers', () => {
  const dispatchDoc = fs.readFileSync(
    path.join(ROOT, 'skills', 'dhpk-execution-policy', 'references', 'implementation-dispatch.md'),
    'utf8'
  );
  const policyDoc = fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8');

  // Purely mechanical, spec-exact CLI work.
  assert.ok(/Mechanical with a clear spec/i.test(policyDoc), 'policy must name the purely mechanical tier');
  // Judgment-dense but standardizable, >=3 files, in-process fast-worker default.
  assert.ok(/Judgment-dense but standardizable work touching more than two files/i.test(policyDoc),
    'policy must name the judgment-dense (>2 files) tier as distinct from purely mechanical work');
  assert.ok(/Judgment-Dense Standardizable Batch/.test(dispatchDoc) || /Judgment-Dense Standardizable Batch/.test(policyDoc),
    'the Judgment-Dense Standardizable Batch term must be defined');
  assert.ok(/at least three files/i.test(policyDoc) || /three or more files/i.test(policyDoc),
    'the judgment-dense tier must state its >=3-file bound');
  // Small inline work.
  assert.ok(/Small diff \(roughly ≤2 files/i.test(policyDoc), 'policy must name the small/inline tier');
  // Open-ended reasoning work.
  assert.ok(/Reasoning-heavy \(unknown root cause/i.test(policyDoc), 'policy must name the reasoning-heavy tier');

  // The four tiers must resolve to distinct dispatch targets, not the same route.
  const mechanicalRow = policyDoc.match(/Mechanical with a clear spec[^\n|]*\|\s*`([^`]+)`/);
  const judgmentRow = policyDoc.match(/Judgment-dense but standardizable[^\n|]*\|\s*([^\n|]+)/);
  const smallRow = policyDoc.match(/Small diff \(roughly ≤2 files[^\n|]*\|\s*([^\n|]+)/);
  const reasoningRow = policyDoc.match(/Reasoning-heavy \(unknown root cause[^\n|]*\|\s*`([^`]+)`/);
  assert.ok(mechanicalRow && judgmentRow && smallRow && reasoningRow, 'all four routing rows must be present in the dispatch table');
  assert.ok(!judgmentRow[1].includes('deep-reasoner'), 'judgment-dense work must not route to deep-reasoner');
  assert.ok(!smallRow[1].includes('fast-worker'), 'small inline work must not route to a fast-worker dispatch');
  assert.ok(!reasoningRow[1].includes('fast-worker'), 'reasoning-heavy work must not route to a fast-worker dispatch');
  assert.notStrictEqual(mechanicalRow[1].trim(), reasoningRow[1].trim(), 'mechanical and reasoning-heavy tiers must be distinguishable');
  assert.notStrictEqual(judgmentRow[1].trim(), reasoningRow[1].trim(), 'judgment-dense and reasoning-heavy tiers must be distinguishable');
  assert.notStrictEqual(smallRow[1].trim(), mechanicalRow[1].trim(), 'small-inline and mechanical tiers must be distinguishable');
});

// 3.2 — scripts/ci/validate-skills.js has no scoped mode and never writes the
// shared skill-size-allowlist.json; a worker whose assigned file newly
// exceeds budget must report rather than self-edit the ratchet.
//
// Heuristic proxy, not a structural guarantee: this checks today's concrete
// implementation (no process.argv parsing, no env-var file-filter, always
// scans the whole skills/ tree). If a scoped mode were later added through a
// different mechanism, this test would need updating alongside it — it is
// not a runtime enforcement of the "no scoped mode" contract, only a
// regression check against the current source.
test('validate-skills.js has no path-scoped/subset mode (whole-tree only, so a worker cannot safely self-invoke it)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ci', 'validate-skills.js'), 'utf8');
  assert.ok(!/process\.argv/.test(src),
    'validate-skills.js must not read process.argv for a file-subset flag — confirms no scoped/report-only equivalent exists today');
  assert.ok(!/process\.env\.\w*(FILE|SCOPE|SUBSET|ASSIGNED)/i.test(src),
    'validate-skills.js must not read an env var to scope to a file subset either — confirms no alternate scoped/report-only equivalent exists today');
  assert.ok(src.includes("path.join(ROOT, 'skills')"),
    'validate-skills.js must scan the whole skills/ tree, not an assigned subset');
});

test('validate-skills.js never writes the shared skill-size-allowlist.json (read-only ratchet consumer)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ci', 'validate-skills.js'), 'utf8');
  assert.ok(!/writeFileSync/.test(src),
    'validate-skills.js must never write skill-size-allowlist.json itself — the allowlist has exactly one writer: a human/orchestrator edit, never the validator or a worker');
});

test('the shared-state contract requires reporting a missing scoped validator rather than inventing a global mutation', () => {
  const dispatchDoc = fs.readFileSync(
    path.join(ROOT, 'skills', 'dhpk-execution-policy', 'references', 'implementation-dispatch.md'),
    'utf8'
  );
  assert.ok(/dispatcher-provided scoped or no-write equivalent/i.test(dispatchDoc),
    'must require a dispatcher-provided scoped/no-write equivalent before a worker touches shared ratchet state');
  assert.ok(/must not invoke a global read-modify-write path/i.test(dispatchDoc),
    'must forbid a worker from inventing a global mutation path when no scoped equivalent exists');
});

// 4.2 — reviewer sentinel derivation for an assigned edited-file list matches
// normal hook-driven sentinel arming, and a sibling's own sentinel neither
// suppresses nor is conflated with it.
test('sentinel derivation for one worker\'s assigned files is unaffected by a sibling\'s own armed sentinel', () => {
  const repo = mkRepo({ prefix: 'dhpk-pdc-' });
  try {
    // Worker A is assigned Foo.php only.
    const phpFile = path.join(repo, 'Foo.php');
    fs.writeFileSync(phpFile, '<?php class Foo {}\n');
    const resA = runHook('post-edit-dispatch.sh', {
      payload: { tool_input: { file_path: phpFile } },
      cwd: repo,
      projectDir: repo,
      deleteEnv: ['DHPK_ACTIVE_MODULES'],
    });
    assert.strictEqual(resA.status, 0, `expected exit 0 for worker A: ${resA.stderr}`);

    // Sibling worker B is assigned README.md, in the same shared checkout.
    const mdFile = path.join(repo, 'README.md');
    fs.writeFileSync(mdFile, '# hi\n');
    const resB = runHook('post-edit-dispatch.sh', {
      payload: { tool_input: { file_path: mdFile } },
      cwd: repo,
      projectDir: repo,
      deleteEnv: ['DHPK_ACTIVE_MODULES'],
    });
    assert.strictEqual(resB.status, 0, `expected exit 0 for worker B: ${resB.stderr}`);

    const dir = sessionsDir(repo);
    const entries = fs.readdirSync(dir).filter((e) => e.startsWith('.pending-'));

    // Both the code-reviewer sentinel (worker A's assigned scope) and the
    // doc-reviewer sentinel (worker B's assigned scope) are present — the
    // normal post-implementation reviewer gates still ran for each worker's
    // own assigned-file type, and neither worker's derivation was suppressed
    // or contaminated by the other's sibling edit.
    assert.ok(entries.includes('.pending-review'),
      'worker A\'s assigned-file (.php) sentinel must be armed, derived from its own assigned edit');
    assert.ok(entries.includes('.pending-doc-review'),
      'worker B\'s assigned-file (.md) sentinel must be armed, derived from its own assigned edit');
  } finally {
    rmRepo(repo);
  }
});

run('parallel-dispatch-contract');
