'use strict';

// Coverage for scripts/release/sync-develop.sh — post-release develop
// reconciliation. Idle trees (identical to main, including after a squash)
// must force-with-lease develop onto main. Any movement or tree difference
// fails closed without rewriting refs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release', 'sync-develop.sh');

function git(cwd, args) {
  return execFileSync('git', [
    '-c', 'user.name=sync-develop-test',
    '-c', 'user.email=sync-develop@example.invalid',
    '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8' });
}

function setupPair() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sync-develop-'));
  const remote = path.join(tmp, 'remote.git');
  const repo = path.join(tmp, 'repo');
  execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
  fs.mkdirSync(repo);
  git(repo, ['init', '-b', 'develop']);
  git(repo, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(repo, 'README'), 'seed\n');
  git(repo, ['add', 'README']);
  git(repo, ['commit', '-m', 'seed']);
  git(repo, ['push', '-u', 'origin', 'develop']);
  git(repo, ['checkout', '-b', 'main']);
  git(repo, ['push', '-u', 'origin', 'main']);
  git(repo, ['checkout', 'develop']);
  return { tmp, remote, repo };
}

function remoteSha(remote, branch) {
  return execFileSync('git', ['-C', remote, 'rev-parse', branch], { encoding: 'utf8' }).trim();
}

function runSync(repo, extraEnv = {}) {
  return spawnSync('bash', [SCRIPT], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'sync-develop-test',
      GIT_AUTHOR_EMAIL: 'sync-develop@example.invalid',
      GIT_COMMITTER_NAME: 'sync-develop-test',
      GIT_COMMITTER_EMAIL: 'sync-develop@example.invalid',
      GITHUB_REF_NAME: 'v1.2.3',
      ...extraEnv,
    },
  });
}

function squashDevelopOntoMain(repo) {
  git(repo, ['checkout', 'develop']);
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'released\n');
  git(repo, ['add', 'feature.txt']);
  git(repo, ['commit', '-m', 'feature on develop']);
  git(repo, ['push', 'origin', 'develop']);
  git(repo, ['checkout', 'main']);
  git(repo, ['merge', '--squash', 'develop']);
  git(repo, ['commit', '-m', 'Release v1.2.3']);
  git(repo, ['push', 'origin', 'main']);
  git(repo, ['checkout', 'develop']);
}

test('sync-develop.sh exists as the CI-owned writer', () => {
  assert.ok(fs.existsSync(SCRIPT), 'missing scripts/release/sync-develop.sh');
});

test('sync-develop requires a valid release PR head SHA before fetching or rewriting', () => {
  const { tmp, remote, repo } = setupPair();
  try {
    const developBefore = remoteSha(remote, 'develop');
    const res = runSync(repo, { DHPK_RELEASE_EXPECTED_DEVELOP_SHA: 'not-a-sha' });
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /expected release PR head SHA is invalid/i);
    assert.strictEqual(remoteSha(remote, 'develop'), developBefore);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('identical trees after squash align develop onto main with force-with-lease', () => {
  const { tmp, remote, repo } = setupPair();
  try {
    squashDevelopOntoMain(repo);
    const mainBefore = remoteSha(remote, 'main');
    const developBefore = remoteSha(remote, 'develop');
    assert.notStrictEqual(developBefore, mainBefore, 'fixture must diverge in history');
    const treeDiff = spawnSync('git', ['-C', repo, 'diff', '--quiet', 'origin/main', 'origin/develop']);
    assert.strictEqual(treeDiff.status, 0, 'fixture trees must match');

    const res = runSync(repo, { DHPK_RELEASE_EXPECTED_DEVELOP_SHA: developBefore });
    assert.strictEqual(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /idle-align PASS/);
    assert.strictEqual(remoteSha(remote, 'develop'), mainBefore);
    assert.notStrictEqual(remoteSha(remote, 'develop'), developBefore);
    assert.ok(!res.stdout.includes('git merge --no-ff') && !/back-merge PASS/.test(res.stdout));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('idle alignment refuses when develop advances beyond the release PR head', () => {
  const { tmp, remote, repo } = setupPair();
  try {
    squashDevelopOntoMain(repo);
    const releasePrHead = remoteSha(remote, 'develop');
    fs.writeFileSync(path.join(repo, 'unique.txt'), 'post-release work\n');
    git(repo, ['add', 'unique.txt']);
    git(repo, ['commit', '-m', 'post-release develop work']);
    git(repo, ['push', 'origin', 'develop']);
    const developBefore = remoteSha(remote, 'develop');
    const mainBefore = remoteSha(remote, 'main');

    const res = runSync(repo, { DHPK_RELEASE_EXPECTED_DEVELOP_SHA: releasePrHead });
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /advanced|moved|expected.*develop/i);
    assert.strictEqual(remoteSha(remote, 'develop'), developBefore);
    assert.strictEqual(remoteSha(remote, 'main'), mainBefore);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('develop tree differences fail closed without force-with-lease', () => {
  const { tmp, remote, repo } = setupPair();
  try {
    squashDevelopOntoMain(repo);
    fs.writeFileSync(path.join(repo, 'unique.txt'), 'only on develop\n');
    git(repo, ['add', 'unique.txt']);
    git(repo, ['commit', '-m', 'unique develop work']);
    git(repo, ['push', 'origin', 'develop']);
    const developBefore = remoteSha(remote, 'develop');
    const mainBefore = remoteSha(remote, 'main');

    const res = runSync(repo, { DHPK_RELEASE_EXPECTED_DEVELOP_SHA: developBefore });
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /preserving|tree differs/i);
    assert.strictEqual(remoteSha(remote, 'develop'), developBefore);
    assert.strictEqual(remoteSha(remote, 'main'), mainBefore);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('force-with-lease rejection fails closed with refs and recovery guidance', () => {
  const { tmp, remote, repo } = setupPair();
  try {
    squashDevelopOntoMain(repo);
    const developBefore = remoteSha(remote, 'develop');
    const mainBefore = remoteSha(remote, 'main');
    const hook = path.join(remote, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    const res = runSync(repo, { DHPK_RELEASE_EXPECTED_DEVELOP_SHA: developBefore });
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /force-with-lease|recovery/i);
    assert.match(`${res.stdout}\n${res.stderr}`, new RegExp(`main=${mainBefore}`));
    assert.match(`${res.stdout}\n${res.stderr}`, new RegExp(`develop=${developBefore}`));
    assert.strictEqual(remoteSha(remote, 'develop'), developBefore);
    assert.strictEqual(remoteSha(remote, 'main'), mainBefore);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('divergent trees fail closed and leave both remote branches unchanged', () => {
  const { tmp, remote, repo } = setupPair();
  try {
    fs.writeFileSync(path.join(repo, 'conflict.txt'), 'develop side\n');
    git(repo, ['add', 'conflict.txt']);
    git(repo, ['commit', '-m', 'develop conflict']);
    git(repo, ['push', 'origin', 'develop']);
    git(repo, ['checkout', 'main']);
    fs.writeFileSync(path.join(repo, 'conflict.txt'), 'main side\n');
    git(repo, ['add', 'conflict.txt']);
    git(repo, ['commit', '-m', 'main conflict']);
    git(repo, ['push', 'origin', 'main']);
    git(repo, ['checkout', 'develop']);
    const developBefore = remoteSha(remote, 'develop');
    const mainBefore = remoteSha(remote, 'main');

    const res = runSync(repo, { DHPK_RELEASE_EXPECTED_DEVELOP_SHA: developBefore });
    assert.notStrictEqual(res.status, 0);
    assert.match(`${res.stdout}\n${res.stderr}`, /recovery/i);
    assert.strictEqual(remoteSha(remote, 'develop'), developBefore);
    assert.strictEqual(remoteSha(remote, 'main'), mainBefore);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('sync-develop');
