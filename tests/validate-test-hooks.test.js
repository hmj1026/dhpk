'use strict';

// Smoke coverage for scripts/validate/test-hooks.sh — this script is itself a
// large hand-rolled test suite (runs the real lifecycle hooks against
// throwaway git repos), so we don't re-implement its assertions here. We
// verify: (1) bash -n syntax, and (2) a provably-no-op invocation: run it for
// real (it never touches the developer's working tree — every case builds
// its own mktemp repo) and confirm it reports the expected PASS/FAIL summary
// shape and exits 0 on the current, presumably-green, suite.

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate', 'test-hooks.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('JSON output probes never write transient files into the plugin root', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, />\s*"\$PLUGIN_ROOT\/_jo\d+\.txt"/);
});

test('running the suite (throwaway repos only) exits successfully with a valid PASS summary', () => {
  const res = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0, `suite exited ${res.status}:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /^PASS: 全部通過（[1-9]\d* 個檢查）$/m, `no valid PASS summary found:\n${res.stdout}`);
  assert.ok(res.stdout.includes('=========================================='), 'missing section divider');
  assert.ok(/^== 1\. userpromptsubmit-skill-hint\.sh ==/m.test(res.stdout), 'missing expected first section header');
});

run('validate-test-hooks');
