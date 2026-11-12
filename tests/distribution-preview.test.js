'use strict';

// Coverage for scripts/lib/distribution-preview.js (issue #1338):
//   - the temporary snapshot commit must not spawn git auto-maintenance, whose
//     detached child writes into .git/objects while cleanup() removes the
//     snapshot parent and leaves a dhpk-preview- directory behind

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTempDir, removeTempDir } = require('./_lib/temp-dir');
const { test, run, assert } = require('./_lib/tinytest');
const { createPreviewSourceSnapshot } = require('../scripts/lib/distribution-preview');

function git(cwd, args) {
  const result = spawnSync('git', [
    '-c', 'maintenance.auto=false',
    '-c', 'gc.auto=0',
    '-c', 'user.name=dhpk test',
    '-c', 'user.email=dhpk-test@invalid',
    '-c', 'commit.gpgSign=false',
    '-c', 'core.hooksPath=/dev/null',
    ...args,
  ], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

test('preview snapshot does not spawn git auto-maintenance and cleanup removes its parent', () => {
  const base = makeTempDir('dhpk-preview-test-');
  const repo = path.join(base, 'repo');
  const traceLog = path.join(base, 'git-trace.log');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'base']);
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u\n');

  const previousTrace = process.env.GIT_TRACE;
  let snapshotParent;
  try {
    process.env.GIT_TRACE = traceLog;
    const snapshot = createPreviewSourceSnapshot(repo);
    snapshotParent = path.dirname(snapshot.root);
    snapshot.cleanup();
  } finally {
    if (previousTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = previousTrace;
  }

  try {
    const trace = fs.readFileSync(traceLog, 'utf8');
    assert.ok(trace.includes('commit'), 'trace should record the snapshot commit');
    assert.ok(!/maintenance run/.test(trace), 'snapshot git calls must not run git maintenance');
    assert.ok(!/gc --auto/.test(trace), 'snapshot git calls must not run git gc --auto');
    assert.ok(!fs.existsSync(snapshotParent), `cleanup must remove ${snapshotParent}`);
  } finally {
    if (snapshotParent) fs.rmSync(snapshotParent, { recursive: true, force: true });
    removeTempDir(base);
  }
});

run('distribution-preview');
