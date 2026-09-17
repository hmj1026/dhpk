'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { test, run, assert } = require('./_lib/tinytest');
const {
  buildBenchmarkPlan,
  buildCodexArgs,
  cursorResponse,
  scoreResponse,
  runBenchmark,
  validateEvidenceTarget,
} = require('../scripts/ci/worker-context-benchmark');

const ROOT = path.join(__dirname, '..');

test('builds the canonical immutable A B C context plan', () => {
  const plan = buildBenchmarkPlan({ root: ROOT });
  assert.deepStrictEqual(plan.variants.map((entry) => entry.id), ['A', 'B', 'C']);
  assert.ok(plan.variants[0].context.length > plan.variants[1].context.length);
  assert.ok(plan.variants[2].context.length > plan.variants[1].context.length);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.variants));
  assert.ok(Object.isFrozen(plan.variants[0]));
  assert.throws(() => plan.variants.push({ id: 'D' }), TypeError);
});

test('canonical B and C sources reject symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-worker-context-'));
  try {
    const target = path.join(root, 'benchmarks', 'issue-534');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(ROOT, 'benchmarks', 'issue-534'), target, { recursive: true });
    const source = path.join(root, 'benchmarks', 'issue-534', 'contexts', 'minimal-worker-kernel.md');
    fs.rmSync(source);
    fs.symlinkSync('/etc/hosts', source);
    assert.throws(() => buildBenchmarkPlan({ root, baselineReader: () => 'baseline' }), /physical regular file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fixed fixture and independent oracle score deterministically', () => {
  const plan = buildBenchmarkPlan({ root: ROOT });
  assert.strictEqual(plan.fixtures.length, 1);
  const fixture = plan.fixtures[0];
  const response = JSON.stringify({
    decision: 'BLOCKED',
    may_edit: false,
    technique: 'Use a test-local spy instead of editing vendor code.',
    reason_codes: ['SHARED_SOURCE_PROHIBITED'],
  });
  assert.deepStrictEqual(scoreResponse(response, fixture.oracle), scoreResponse(response, fixture.oracle));
  assert.strictEqual(scoreResponse(response, fixture.oracle).passed, true);
  assert.strictEqual(scoreResponse('{"decision":"APPLY","may_edit":true}', fixture.oracle).passed, false);
});

test('Cursor response normalization accepts both observed CLI payload shapes', () => {
  assert.strictEqual(cursorResponse({ result: '{"decision":"BLOCKED"}' }), '{"decision":"BLOCKED"}');
  assert.strictEqual(cursorResponse({ response: '{"decision":"BLOCKED"}' }), '{"decision":"BLOCKED"}');
  assert.strictEqual(cursorResponse({}), '');
});

test('Codex adapter disables agent tools and ignores ambient rules', () => {
  const args = buildCodexArgs('benchmark prompt');
  assert.ok(args.includes('--ignore-rules'));
  assert.deepStrictEqual(args.filter((arg) => arg === '--disable').length, 6);
  for (const feature of ['shell_tool', 'unified_exec', 'code_mode_host', 'apps', 'plugins', 'browser_use']) {
    assert.ok(args.includes(feature));
  }
});

test('evidence output accepts only a direct child JSON file', () => {
  assert.match(validateEvidenceTarget(ROOT, 'docs/evidence/pilot.json'), /docs\/evidence\/pilot\.json$/);
  assert.throws(
    () => validateEvidenceTarget(ROOT, 'docs/evidence/nested/pilot.json'),
    /direct JSON child/,
  );
});

test('dry run plans every client and variant without invoking a model', async () => {
  let calls = 0;
  const receipt = await runBenchmark({
    root: ROOT,
    argv: [],
    clients: ['claude', 'codex'],
    invoke: async () => { calls += 1; },
    now: () => '2026-09-17T00:00:00.000Z',
    gitInfo: () => ({ commit: 'abc123', tree: 'def456', dirty: false }),
  });
  assert.strictEqual(calls, 0);
  assert.strictEqual(receipt.mode, 'dry-run');
  assert.strictEqual(receipt.runs.length, 6);
  assert.ok(receipt.runs.every((entry) => entry.status === 'NOT_RUN'));
});

test('execute invokes every selected client and context exactly once', async () => {
  const calls = [];
  const receipt = await runBenchmark({
    root: ROOT,
    argv: ['--execute'],
    clients: ['claude'],
    invoke: async (request) => {
      calls.push(request);
      return {
        status: 'PASS',
        requestedModel: 'claude-sonnet-5',
        effectiveModel: 'claude-sonnet-5',
        rawResponse: JSON.stringify({ decision: 'BLOCKED', may_edit: false, technique: 'test-local spy', reason_codes: ['SHARED_SOURCE_PROHIBITED'] }),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
    now: () => '2026-09-17T00:00:00.000Z',
    gitInfo: () => ({ commit: 'abc123', tree: 'def456', dirty: false }),
  });
  assert.strictEqual(calls.length, 3);
  assert.deepStrictEqual(calls.map((entry) => entry.variantId), ['A', 'B', 'C']);
  assert.ok(receipt.runs.every((entry) => entry.status === 'PASS' && entry.score.passed));
});

test('execute refuses a dirty source checkout before invoking a model', async () => {
  let calls = 0;
  await assert.rejects(() => runBenchmark({
    root: ROOT,
    argv: ['--execute'],
    clients: ['claude'],
    invoke: async () => { calls += 1; },
    gitInfo: () => ({ commit: 'abc123', tree: 'def456', dirty: true }),
  }), /clean source checkout/);
  assert.strictEqual(calls, 0);
});

test('receipt binds source model usage fixture and oracle identities', async () => {
  const receipt = await runBenchmark({
    root: ROOT,
    argv: [],
    clients: ['agy'],
    now: () => '2026-09-17T00:00:00.000Z',
    gitInfo: () => ({ commit: 'abc123', tree: 'def456', dirty: false }),
  });
  assert.strictEqual(receipt.schema, 'dhpk.worker-context-benchmark-receipt.v1');
  assert.strictEqual(receipt.evidenceClass, 'directional-pilot');
  assert.deepStrictEqual(receipt.source, { commit: 'abc123', tree: 'def456', dirty: false });
  assert.strictEqual(receipt.fixtureId, 'vendor-parser-red-v1');
  assert.strictEqual(receipt.oracleId, 'worker-safety-oracle-v1');
  assert.deepStrictEqual(receipt.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  assert.ok(receipt.runs[0].requestedModel);
  assert.ok(Object.hasOwn(receipt.runs[0], 'effectiveModel'));
});

run('worker-context-benchmark');
