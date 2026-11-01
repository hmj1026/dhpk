'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { GENERATORS, runFixpoint } = require('../scripts/ci/gen-fixpoint');

const N = GENERATORS.length;

// Snapshot sequence: each runFixpoint pass takes a before and an after snapshot.
function seqSnapshot(states) {
  let i = 0;
  return () => new Map(states[Math.min(i++, states.length - 1)]);
}

function harness(extra = {}) {
  const calls = [];
  const lines = [];
  return {
    calls,
    lines,
    opts: {
      runner: (name) => { calls.push(name); return { status: (extra.fail && extra.fail[name]) || 0 }; },
      log: (l) => lines.push(l),
      ...extra.opts,
    },
  };
}

test('runs generators in dependency order, digests before catalogs before companion', () => {
  const h = harness();
  runFixpoint({ ...h.opts, snapshot: seqSnapshot([[['a', '1']]]) });
  assert.deepStrictEqual(h.calls, GENERATORS.map((g) => g.name));
  const idx = (n) => h.calls.indexOf(n);
  assert.ok(idx('gen-distribution-inventory') < idx('gen-skill-usage'));
  assert.ok(idx('gen-skill-usage') < idx('gen-claude-marketplace-package'));
  assert.ok(GENERATORS[0].args.includes('--refresh-supporting-digests'));
  assert.ok(!GENERATORS.some((g) => g.args.includes('--write') && /distribution-inventory/.test(g.args[0])));
});

test('converges after one pass when nothing changes', () => {
  const h = harness();
  const r = runFixpoint({ ...h.opts, snapshot: seqSnapshot([[]]) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.passes, 1);
  assert.ok(h.lines.includes('converged after 1 pass(es)'));
  assert.ok(h.lines.some((l) => l.includes('docs/platform-installation.md')));
});

test('converges after 3 passes when the first two change files', () => {
  const h = harness();
  const s0 = [];
  const s1 = [['x', '1']];
  const s2 = [['x', '2']];
  // pass1 before s0 after s1; pass2 before s1 after s2; pass3 before s2 after s2
  const r = runFixpoint({ ...h.opts, snapshot: seqSnapshot([s0, s1, s1, s2, s2, s2]) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.passes, 3);
  assert.strictEqual(h.calls.length, 3 * N);
  assert.ok(h.lines.includes('converged after 3 pass(es)'));
});

test('fails listing still-changing paths when it never converges', () => {
  const h = harness();
  let n = 0;
  const snapshot = () => new Map([['b.json', String(n++)], ['a.json', String(n)]]);
  const r = runFixpoint({ ...h.opts, snapshot, maxPasses: 5 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.passes, 5);
  assert.deepStrictEqual(r.changed, ['a.json', 'b.json']);
  assert.strictEqual(h.calls.length, 5 * N);
  assert.ok(h.lines.includes('  a.json') && h.lines.includes('  b.json'));
});

test('stops at the first failing generator with its name and exit code', () => {
  const h = harness({ fail: { 'gen-skill-usage': 7 } });
  const r = runFixpoint({ ...h.opts, snapshot: seqSnapshot([[]]) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.failed, 'gen-skill-usage');
  assert.strictEqual(r.exitCode, 7);
  assert.strictEqual(h.calls[h.calls.length - 1], 'gen-skill-usage');
  assert.ok(h.calls.length < N);
});

test('dry-run prints the plan and runs nothing', () => {
  const h = harness();
  const r = runFixpoint({ ...h.opts, dryRun: true, snapshot: () => { throw new Error('no snapshot'); } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(h.calls.length, 0);
  assert.ok(GENERATORS.every((g) => h.lines.some((l) => l.includes(g.name))));
});

run('gen-fixpoint');
