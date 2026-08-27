'use strict';

// RED-first guard for the migration boundary: CI/release invoke the public
// facade while retaining the legacy distribution compatibility checks.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('CI invokes the harness facade and keeps compatibility adapters', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /bin\/dhpk harness/);
  assert.match(workflow, /bin\/dhpk distribution/);
});

test('CI runs the aggregate suite with a bounded worker pool and one changelog gate', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /DHPK_TEST_JOBS:\s*['"]?[2-8]/);
  assert.match(workflow, /run-bounded-node-test\.sh\s+node\s+tests\/run-all\.js/);
  assert.match(workflow, /CHANGELOG_ARGS=\(\)/);
  assert.match(workflow, /--diff-base\s+"origin\/\$BASE_REF"\s+--base-ref\s+"\$BASE_REF"/);
  assert.strictEqual(
    (workflow.match(/scripts\/ci\/validate-changelog-fragments\.js/g) || []).length,
    1,
    'PR coverage must be folded into the single changelog validator invocation'
  );
});

test('release invokes the harness facade for the full consumer surface plan', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /bin\/dhpk harness release/);
  assert.match(workflow, /surfaceResults/);
});

run('harness-workflow-config');
