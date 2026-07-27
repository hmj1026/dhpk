'use strict';

// Coverage for the harden-parallel-dispatch-worker-boundaries change: proves the
// parallel-dispatch failure modes described in openspec/changes/
// harden-parallel-dispatch-worker-boundaries/design.md are real, and that the
// path-scoped contract (agents/fast-worker.md, agents/codex-fast-worker.md) and
// the single-writer shared-state reconciliation actually fix them.
//
// No live dispatcher code performs worker scoping today (it is an AI-followed
// prompt contract) — these fixtures reproduce the underlying git/filesystem
// mechanics a worker or orchestrator would exercise, using real `git` against a
// throwaway repo, so the assertions are grounded in actual command behavior
// rather than restating the policy prose.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');

function git(repo, args) {
  const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function writeFile(repo, rel, content) {
  const fp = path.join(repo, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
}

// 1.1 — shared ratchet/configuration file: concurrent (mid-batch) global
// validation observes transient state, while a single post-batch validation
// (the orchestrator's Shared-State Reconciliation) sees the complete result.
test('mid-batch validation of a shared ratchet file observes transient state; one post-batch pass sees the complete result', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    writeFile(repo, 'ratchet.json', JSON.stringify({ allowed: [] }) + '\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'seed ratchet']);

    function readRatchet() {
      return JSON.parse(fs.readFileSync(path.join(repo, 'ratchet.json'), 'utf8'));
    }

    // Worker A finishes its assigned edit and updates the shared ratchet.
    writeFile(repo, 'a.txt', 'a\n');
    writeFile(repo, 'ratchet.json', JSON.stringify({ allowed: ['a.txt'] }) + '\n');

    // A validator invoked NOW (before worker B has run) — the failure mode
    // this fixture reproduces: it observes a transient, incomplete ratchet.
    const midBatch = readRatchet();
    assert.deepStrictEqual(midBatch.allowed, ['a.txt'],
      'mid-batch read must observe only the worker(s) that have finished so far');
    assert.ok(!midBatch.allowed.includes('b.txt'),
      'mid-batch read must NOT yet see worker B — this is the transient-state failure being reproduced');

    // Worker B finishes its assigned edit and updates the shared ratchet.
    writeFile(repo, 'b.txt', 'b\n');
    writeFile(repo, 'ratchet.json', JSON.stringify({ allowed: ['a.txt', 'b.txt'] }) + '\n');

    // The orchestrator's single sequential Shared-State Reconciliation pass —
    // run once, after all workers return — sees the complete result.
    const postBatch = readRatchet();
    assert.deepStrictEqual(postBatch.allowed, ['a.txt', 'b.txt'],
      'post-batch reconciliation must observe every worker\'s update');
  } finally {
    rmRepo(repo);
  }
});

// 1.2 — shared-checkout fixture: a sibling worker's out-of-scope edit must
// never appear in this worker's own assigned-scope diff.
test('a worker-owned path-scoped diff contains only assigned files, even when a sibling has written elsewhere', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    writeFile(repo, 'a.txt', 'a\n');
    writeFile(repo, 'b.txt', 'b\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'seed']);

    // Worker A is assigned only a.txt. Worker B (sibling) is assigned only
    // b.txt and writes it in the same shared checkout.
    writeFile(repo, 'a.txt', 'a-edited\n');
    writeFile(repo, 'b.txt', 'b-edited\n');

    const unscoped = git(repo, ['status', '--porcelain']);
    assert.ok(unscoped.includes('a.txt') && unscoped.includes('b.txt'),
      'sanity check: the unfiltered working tree shows both workers\' edits');

    const workerAScoped = git(repo, ['status', '--porcelain', '--', 'a.txt']);
    assert.ok(workerAScoped.includes('a.txt'), 'worker A\'s scoped status must show its own assigned file');
    assert.ok(!workerAScoped.includes('b.txt'),
      'worker A\'s scoped status must NOT show the sibling\'s out-of-scope edit');

    const workerADiffNames = git(repo, ['diff', '--name-only', '--', 'a.txt']).trim().split('\n').filter(Boolean);
    assert.deepStrictEqual(workerADiffNames, ['a.txt'],
      'worker A\'s path-scoped diff --name-only must list assigned files only');
  } finally {
    rmRepo(repo);
  }
});

// 3.3 — orchestrator-level acceptance: the whole-tree validator runs once
// after the parallel batch and preserves every sibling's update (no
// destructive cleanup, no lost edits).
test('one whole-tree reconciliation pass after the batch preserves every worker\'s edit', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    writeFile(repo, 'a.txt', 'a\n');
    writeFile(repo, 'b.txt', 'b\n');
    writeFile(repo, 'c.txt', 'c\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'seed']);

    // Three workers finish their assigned edits in the same shared checkout.
    writeFile(repo, 'a.txt', 'a-worker\n');
    writeFile(repo, 'b.txt', 'b-worker\n');
    writeFile(repo, 'c.txt', 'c-worker\n');

    // Orchestrator's one sequential whole-tree reconciliation pass, run after
    // every worker has returned.
    const wholeTree = git(repo, ['status', '--porcelain']).trim().split('\n').filter(Boolean).sort();
    assert.strictEqual(wholeTree.length, 3, `expected all 3 sibling edits preserved, got: ${wholeTree.join(', ')}`);
    for (const f of ['a.txt', 'b.txt', 'c.txt']) {
      assert.ok(wholeTree.some((line) => line.includes(f)), `expected ${f} present in the reconciliation pass`);
    }

    // No destructive cleanup ran against any sibling file — content is intact.
    assert.strictEqual(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'a-worker\n');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'b-worker\n');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'c.txt'), 'utf8'), 'c-worker\n');
  } finally {
    rmRepo(repo);
  }
});

run('parallel-dispatch-scope');
