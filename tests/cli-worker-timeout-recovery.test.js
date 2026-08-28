'use strict';

// Coverage for the harden-cli-worker-mid-batch-timeout change (deterministic,
// content-level contract checks — the actual ledger derivation, retry
// dispatch, and marker write are LLM-agent behavior, not scriptable logic, so
// these tests prove the *documented contract* is present, consistent, and
// does not collide with existing sentinel/cleanup mechanics, mirroring the
// style of tests/parallel-dispatch-contract.test.js and
// tests/reviewer-contract.test.js):
// - 3.1 wrapper signal classification (cross-referenced; see run-codex.test.js
//   / run-agy.test.js for the executable wrapper-behavior proof), first-timeout
//   recovery, confirmed-file exclusion, sibling-edit non-interference, blocked
//   scope expansion, same-backend retry
// - 3.2 second-timeout PARTIAL/BLOCKED, report completeness, marker durability
//   / non-`.pending-*` naming, explicit reconciliation requirement, no cleanup
//   authority
// - 3.3 six-file split recommendation, documented override, no worker
//   self-expansion of scope

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

const DISPATCH_DOC = fs.readFileSync(
  path.join(ROOT, 'skills', 'dhpk-execution-policy', 'references', 'implementation-dispatch.md'),
  'utf8',
);
const CODEX_WORKER = fs.readFileSync(path.join(ROOT, 'agents', 'codex-fast-worker.md'), 'utf8');
const AGY_WORKER = fs.readFileSync(path.join(ROOT, 'agents', 'agy-fast-worker.md'), 'utf8');
const CODEX_DEEP_REASONER = fs.readFileSync(path.join(ROOT, 'agents', 'codex-deep-reasoner.md'), 'utf8');
const CODEX_BRIDGE_AGENT = fs.readFileSync(path.join(ROOT, 'agents', 'codex-bridge.md'), 'utf8');
const CODEX_BRIDGE_SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'SKILL.md'), 'utf8');
const EXECUTION_POLICY = fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8');
const MODEL_ECONOMICS = fs.readFileSync(path.join(ROOT, 'rules', 'model-economics.md'), 'utf8');
const MODEL_CONFIG_SPEC = fs.readFileSync(path.join(ROOT, 'openspec', 'specs', 'orchestration-model-config', 'spec.md'), 'utf8');
const REAP_SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'reap-stale-sentinels.sh'), 'utf8');
const PAYLOAD_LIB = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', '_lib', 'payload.sh'), 'utf8');

// 3.1 — both CLI worker contracts define the same timeout-recovery state
// machine: exactly one same-backend retry scoped to remaining ∪ unconfirmed,
// no self-edit, no backend fallback on timeout.
test('both worker contracts define first-timeout scoped same-backend retry with no self-edit / no fallback', () => {
  for (const [name, doc] of [['codex-fast-worker.md', CODEX_WORKER], ['agy-fast-worker.md', AGY_WORKER]]) {
    assert.ok(/## Mid-batch timeout recovery \(multi-file dispatch only\)/.test(doc),
      `${name} must define the Mid-batch timeout recovery section`);
    assert.ok(/exactly one same-backend, same-model/.test(doc),
      `${name} must bound recovery to exactly one same-backend retry`);
    assert.ok(doc.includes('remaining ∪ unconfirmed'),
      `${name} must scope the retry to remaining ∪ unconfirmed, never repeating confirmed files`);
    assert.ok(/[Nn]ever self-edit the unresolved files/.test(doc),
      `${name} must forbid self-editing unresolved files during recovery`);
    assert.ok(/never fall back to another backend because of a timeout/.test(doc),
      `${name} must forbid backend fallback triggered by a timeout`);
  }
});

// 3.1 — an immutable runner receipt is the only timeout evidence; ordinary
// failures and a bare exit code are never classified speculatively.
test('timeout recovery is gated on contained runner evidence, never a bare exit code', () => {
  for (const [name, doc] of [['codex-fast-worker.md', CODEX_WORKER], ['agy-fast-worker.md', AGY_WORKER]]) {
    assert.ok(doc.includes('dhpk.cli.receipt.v1') && doc.includes('terminal `TIMEOUT`'),
      `${name} must require a terminal runner receipt as timeout evidence`);
    assert.ok(doc.includes('uncontained receipt is `BLOCKED`') || doc.includes('receipt evidence as `BLOCKED`'),
      `${name} must fail closed when receipt evidence is unavailable`);
  }
});

test('all Codex callers use a contained receipt, not the retired timeout envelope', () => {
  assert.ok(DISPATCH_DOC.includes('dhpk.cli.receipt.v1'), 'dispatch policy must name the terminal receipt');
  assert.ok(!DISPATCH_DOC.includes('dhpk.codex.timeout.v1'), 'dispatch policy must not require the retired timeout envelope');
  for (const [name, doc] of [
    ['codex-fast-worker.md', CODEX_WORKER],
    ['codex-deep-reasoner.md', CODEX_DEEP_REASONER],
    ['codex-bridge.md', CODEX_BRIDGE_AGENT],
    ['codex-bridge/SKILL.md', CODEX_BRIDGE_SKILL],
  ]) {
    assert.ok(doc.includes('dhpk.cli.receipt.v1'), `${name} must name the contained receipt`);
    assert.ok(!doc.includes('dhpk.codex.timeout.v1'), `${name} must not require the retired timeout envelope`);
    assert.ok(/independent(?:ly)?[^\n]{0,100}(?:diff|verification)|path-scoped diff/i.test(doc),
      `${name} must require independent diff evidence`);
    assert.ok(/not[\s\S]{0,120}(?:DONE|success)|never[\s\S]{0,120}(?:DONE|success)/i.test(doc),
      `${name} must not treat a salvaged report as success`);
  }
});

test('single-file Codex callers surface TIMEOUT_SALVAGED or BLOCKED without retry or fallback', () => {
  for (const [name, doc] of [
    ['codex-deep-reasoner.md', CODEX_DEEP_REASONER],
    ['codex-bridge.md', CODEX_BRIDGE_AGENT],
    ['codex-bridge/SKILL.md', CODEX_BRIDGE_SKILL],
  ]) {
    assert.ok(doc.includes('TIMEOUT_SALVAGED'), `${name} must expose TIMEOUT_SALVAGED classification`);
    assert.ok(doc.includes('BLOCKED'), `${name} must expose BLOCKED classification`);
    assert.ok(/no automatic retry|does not retry|no retry/i.test(doc), `${name} must retain no automatic retry`);
    assert.ok(/no backend fallback|never fall back|without backend fallback/i.test(doc), `${name} must retain no backend fallback`);
    assert.ok(/reconcil/i.test(doc), `${name} must require reconciliation after salvage`);
  }
});

test('the Codex bridge documents receipt containment, redaction, and no envelope fabrication', () => {
  for (const phrase of ['dhpk.cli.receipt.v1', 'terminal `TIMEOUT`', 'Missing, invalid, or uncontained', 'redacted report']) {
    assert.ok(CODEX_BRIDGE_SKILL.includes(phrase), `codex-bridge skill must document ${phrase}`);
  }
  assert.ok(!CODEX_BRIDGE_SKILL.includes('dhpk.codex.timeout.v1'), 'bridge must not advertise the retired envelope');
  assert.ok(/do not fabricate a timeout envelope/i.test(CODEX_BRIDGE_SKILL), 'bridge must forbid envelope fabrication');
});

test('published timeout configuration describes only the attested portable runner, never a shell backstop', () => {
  for (const [name, document] of [
    ['execution-policy.md', EXECUTION_POLICY],
    ['model-economics.md', MODEL_ECONOMICS],
    ['orchestration-model-config spec', MODEL_CONFIG_SPEC],
  ]) {
    assert.ok(!/wrapper[ -]backstop/i.test(document), `${name} must not advertise a shell wrapper backstop`);
    assert.ok(/portable runner|transport runner|runner deadline/i.test(document), `${name} must name the portable runner deadline`);
  }
});

// 3.1 — blocked scope expansion: the pre-existing parallel-dispatch scope
// boundary is unaffected by the new recovery contract — a worker still cannot
// expand its own scope, in recovery or otherwise.
test('scope-expansion is still BLOCKED, not silently granted by timeout recovery', () => {
  assert.ok(/A worker that needs another file returns `RESULT: BLOCKED` and names the required scope expansion\./.test(DISPATCH_DOC),
    'the pre-existing scope-expansion BLOCKED contract must remain intact alongside the new timeout-recovery section');
  assert.ok(/the worker itself never expands or splits its own assigned scope/.test(DISPATCH_DOC),
    'the six-file guideline must reaffirm the worker cannot expand its own scope');
});

// 3.1 — sibling out-of-scope edits remain observations only, unaffected by the
// new recovery contract (regression check: the new section must not grant an
// implicit cleanup or ownership path over sibling files).
test('sibling out-of-scope edits remain non-cleanup observations under the new contract', () => {
  assert.ok(/must not modify, revert, reset, clean, or force-delete them/.test(DISPATCH_DOC),
    'sibling out-of-scope edits must stay prohibited from any cleanup action');
  for (const doc of [CODEX_WORKER, AGY_WORKER]) {
    assert.ok(!/git checkout|git restore|git reset|git clean/.test(
      doc.slice(doc.indexOf('## Mid-batch timeout recovery'), doc.indexOf('## Verify and report')),
    ), 'the new timeout-recovery section must not introduce any destructive cleanup command');
  }
});

// 3.2 — second timeout is terminal: PARTIAL (any confirmed) vs BLOCKED (none
// confirmed), both timeout observations, all three ledger sets, next action.
test('second verified timeout is terminal with PARTIAL/BLOCKED split on confirmed-file evidence', () => {
  for (const [name, doc] of [['codex-fast-worker.md', CODEX_WORKER], ['agy-fast-worker.md', AGY_WORKER]]) {
    assert.ok(/Second verified timeout.*stop/.test(doc),
      `${name} must make a second verified timeout terminal`);
    assert.ok(/RESULT: PARTIAL.*any assigned file is confirmed/.test(doc),
      `${name} must define PARTIAL as at-least-one-confirmed`);
    assert.ok(/RESULT: BLOCKED.*when none is/.test(doc),
      `${name} must define BLOCKED as none-confirmed`);
    assert.ok(/naming both timeout observations, all three ledger sets, and the next action/.test(doc),
      `${name} must require both timeout observations, all three ledger sets, and next action in the terminal report`);
  }
});

// 3.2 — marker durability: the marker's naming convention can never be matched
// by the `.pending-*` sentinel sweep (proven against the sweep's actual glob,
// not just asserted in prose) and is documented as never auto-cleared.
test('the PARTIAL marker filename can never be matched by the .pending-* sentinel sweep', () => {
  const markerNameSample = '.partial-cli-batch-codex-sess123-dispatch1.json';
  assert.ok(!markerNameSample.startsWith('.pending-'),
    'marker filename must not start with .pending- (the sentinel-lifecycle prefix)');

  // The sweep's unknown-stray pass is the only mechanism that could otherwise
  // discover and clear an unrecognized file in the sessions dir — confirm its
  // glob is exactly `.pending-*`, so a `.partial-cli-batch-*` marker is
  // invisible to it by construction, not by convention alone.
  assert.ok(REAP_SCRIPT.includes("-name '.pending-*'"),
    'reap-stale-sentinels.sh unknown-stray sweep must glob only .pending-*, proving a .partial-cli-batch-* marker is never swept');

  // The known SENTINEL_NAMES registry (whitelist consumed by clear-sentinel.sh
  // and the reap loop) must not itself contain any partial-cli-batch entry —
  // confirms the marker was never folded into the reviewer-sentinel SSOT.
  assert.ok(!/partial-cli-batch/.test(PAYLOAD_LIB),
    'SENTINEL_NAMES (payload.sh) must not include a partial-cli-batch entry — the marker stays outside the .pending-* reviewer-sentinel lifecycle');
});

test('the marker path, required fields, and reconciliation/no-auto-clear rule are documented', () => {
  assert.ok(DISPATCH_DOC.includes(
    '.claude/artifacts/sessions/.partial-cli-batch-<backend>-<session-id>-<dispatch-id>.json',
  ), 'the exact control-plane marker path must be documented verbatim');
  for (const field of ['backend', 'session/dispatch identity', 'assigned', 'confirmed', 'remaining', 'unconfirmed', 'next action']) {
    assert.ok(DISPATCH_DOC.includes(field), `marker required-field list must name '${field}'`);
  }
  assert.ok(/never auto-cleared by the worker or by a reviewer sweep/.test(DISPATCH_DOC),
    'marker must be documented as never auto-cleared (no cleanup authority)');
  assert.ok(/until a human or the orchestrator explicitly reconciles it/.test(DISPATCH_DOC),
    'marker must require explicit human/orchestrator reconciliation');
  assert.ok(/not itself a reviewer sentinel and does not gate on reviewer approval/.test(DISPATCH_DOC),
    'marker must be explicitly distinguished from the reviewer-sentinel gate');
});

// 3.3 — six-file starting guideline with a documented override, and no
// self-expansion of scope even for an intentionally larger batch.
test('the six-file starting guideline requires a recorded override, never self-expansion', () => {
  assert.ok(/more than six assigned product files/.test(DISPATCH_DOC),
    'must name the six-file starting guideline threshold');
  assert.ok(/six is an unmeasured starting point, not a wrapper or CLI setting/.test(DISPATCH_DOC),
    'must document six as a tunable guideline, not a hard-coded protocol limit');
  assert.ok(/override reason recorded in the dispatch record and the worker's report/.test(DISPATCH_DOC),
    'an intentionally larger batch must require a recorded override reason');
  assert.ok(/the worker itself never expands or splits its own assigned scope/.test(DISPATCH_DOC),
    'the worker must never expand or split its own assigned scope, even under the override');
});

run('cli-worker-timeout-recovery');
