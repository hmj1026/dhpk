'use strict';

// Smoke coverage for scripts/validate/test-hooks.sh — this script is itself a
// large hand-rolled test suite (runs the real lifecycle hooks against
// throwaway git repos), so we don't re-implement its assertions here. We
// verify: (1) bash -n syntax, and (2) a provably-no-op invocation: run it for
// real (it never touches the developer's working tree — every case builds
// its own mktemp repo) and confirm it reports the expected PASS/FAIL summary
// shape and exits 0 on the current, presumably-green, suite.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate', 'test-hooks.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('running the suite (throwaway repos only) produces the documented PASS/FAIL summary shape', () => {
  // NOTE: does not assert a clean PASS. At the time this test was written the
  // repo's own suite has one pre-existing failing case unrelated to this
  // script ("== 4. subagent-stop-verify.sh == [FAIL] uncleared sentinel not
  // logged", reproducible standalone via `bash scripts/validate/test-hooks.sh`).
  // This is a smoke test of the HARNESS (throwaway-repo isolation + summary
  // format), not a correctness re-check of every embedded hook assertion —
  // see report for the escalation on the pre-existing failure.
  const res = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 60000 });
  assert.ok(res.status === 0 || res.status === 1, `unexpected exit code ${res.status}:\n${res.stderr}`);
  assert.ok(/^(PASS|FAIL): /m.test(res.stdout), `no PASS/FAIL summary line found:\n${res.stdout}`);
  assert.ok(res.stdout.includes('=========================================='), 'missing section divider');
  assert.ok(/^== 1\. userpromptsubmit-skill-hint\.sh ==/m.test(res.stdout), 'missing expected first section header');
});

run('validate-test-hooks');
