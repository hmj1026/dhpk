'use strict';

// Exercise git's path-scoped status/diff behavior in a throwaway repository.
// The repository has no executable worker dispatcher or shared-state
// reconciler; the related prompt and policy contracts are covered by
// parallel-dispatch-contract.test.js and opsx-orchestration-decision-policy.test.js.

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

// This repo has no executable worker/orchestrator implementation to drive.
// Preserve the concrete git pathspec contract and avoid asserting hand-written
// state as evidence of orchestration behavior.
test('a path-scoped git diff excludes sibling edits and leaves sibling content intact', () => {
  const repo = mkRepo({ gitConfig: true });
  try {
    writeFile(repo, 'a.txt', 'a\n');
    writeFile(repo, 'b.txt', 'b\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'seed']);

    // The assigned worker changes a.txt while a sibling changes b.txt in the
    // same checkout; the actual git pathspec is the observable contract.
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
    assert.strictEqual(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'b-edited\n',
      'reading the assigned diff must leave the sibling edit intact');
  } finally {
    rmRepo(repo);
  }
});

run('parallel-dispatch-scope');
