'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const HOOK = 'post-edit-remind.sh';
const ADVISORY = '[post-edit] advisory: run the pending reviewer BEFORE attempting commit/push.';

function invoke(repo, relativePath, env = {}) {
  return runHook(HOOK, {
    cwd: repo,
    payload: { tool_input: { file_path: path.join(repo, relativePath) } },
    env,
    deleteEnv: ['DHPK_ACTIVE_MODULES', 'DHPK_DEBUG'],
  });
}

function advisoryCount(output) {
  return output.split(ADVISORY).length - 1;
}

test('consecutive triggering edits emit the advisory once for an unchanged sentinel set', () => {
  withRepo((repo) => {
    const first = invoke(repo, 'src/First.js');
    const second = invoke(repo, 'src/Second.js');

    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(advisoryCount(first.stdout), 1, first.stdout);
    assert.strictEqual(advisoryCount(second.stdout), 0, second.stdout);
  });
});

test('clearing and re-arming a sentinel re-emits the advisory', () => {
  withRepo((repo) => {
    const first = invoke(repo, 'src/First.js');
    fs.rmSync(path.join(sessionsDir(repo), '.pending-review'));
    const rearmed = invoke(repo, 'src/Rearmed.js');

    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(rearmed.status, 0, rearmed.stderr);
    assert.strictEqual(advisoryCount(rearmed.stdout), 1, rearmed.stdout);
  });
});

test('non-trigger edits suppress the skip echo by default', () => {
  withRepo((repo) => {
    const result = invoke(repo, 'notes.txt');

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes('[post-edit] skipped (no trigger matched)'), result.stdout);
  });
});

test('DHPK_DEBUG=1 enables the non-trigger skip echo', () => {
  withRepo((repo) => {
    const result = invoke(repo, 'notes.txt', { DHPK_DEBUG: '1' });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('[post-edit] skipped (no trigger matched): notes.txt'), result.stdout);
  });
});

run('post-edit-remind-advisory-dedupe');
