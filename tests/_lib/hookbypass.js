'use strict';

// hookbypass - shared scaffolding for tests/hook-bypass.test.js and
// tests/hook-bypass-git-gate.test.js (the suite was split in #1468 so each file
// fits the CI job budget). Behaviour is unchanged from the helpers the single
// file carried before the split.

const { spawnSync } = require('node:child_process');
const { assert } = require('./tinytest');
const { mkRepo, rmRepo, runHook } = require('./hookharness');
const { currentPhase, unguarded } = require('./hookreplay');

const BLOCK = 2;
const ALLOW = 0;

const BLOCK_MODE = { DHPK_BRANCH_SAFETY: 'block' };
const ALL_BASH_HOOKS = ['pre-bash-guard.sh', 'pretool-git-gate.sh', 'pre-bash-dispatch.sh'];
const GUARD_AND_DISPATCH = ['pre-bash-guard.sh', 'pre-bash-dispatch.sh'];

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

// A repo with one commit on the given branch (initial branch forced via -M).
function mkBranchRepo(branch, { prefix = 'dhpk-bypass-' } = {}) {
  const dir = mkRepo({ prefix, gitConfig: true });
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  git(dir, ['branch', '-M', branch]);
  return dir;
}

// While a suite records or replays its hook calls (tests/_lib/hookreplay.js),
// one pair of repos serves every test: a recordable body never mutates them
// (a mutation disqualifies the test from batching), so sharing is safe and the
// per-test repo setup disappears (#1506).
let sharedRepos = null;
function getSharedRepos() {
  if (sharedRepos) return sharedRepos;
  sharedRepos = unguarded(() => ({ protectedRepo: mkBranchRepo('main'), featureRepo: mkBranchRepo('feature/x') }));
  process.on('exit', () => {
    rmRepo(sharedRepos.protectedRepo);
    rmRepo(sharedRepos.featureRepo);
  });
  return sharedRepos;
}

function withRepos(fn) {
  if (currentPhase() !== 'direct') return fn(getSharedRepos());
  const protectedRepo = mkBranchRepo('main');
  const featureRepo = mkBranchRepo('feature/x');
  try {
    return fn({ protectedRepo, featureRepo });
  } finally {
    rmRepo(protectedRepo);
    rmRepo(featureRepo);
  }
}

function bashHook(hook, command, { cwd, env = {} } = {}) {
  return runHook(hook, {
    cwd,
    payload: { tool_input: { command } },
    env,
    deleteEnv: ['DHPK_ALLOW_NO_VERIFY', 'DHPK_BRANCH_SAFETY'],
  });
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected exit ${status}, got ${res.status}; stderr=${res.stderr}`);
}

module.exports = {
  BLOCK,
  ALLOW,
  BLOCK_MODE,
  ALL_BASH_HOOKS,
  GUARD_AND_DISPATCH,
  git,
  mkBranchRepo,
  withRepos,
  getSharedRepos,
  bashHook,
  expectStatus,
};
