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

function jobBlock(workflow, id) {
  const start = workflow.indexOf('\n  ' + id + ':\n');
  assert.ok(start !== -1, 'ci.yml must define the ' + id + ' job');
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('CI invokes the harness facade and keeps compatibility adapters', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /bin\/dhpk harness/);
  assert.match(workflow, /bin\/dhpk distribution/);
});

test('CI separates preflight from a four-shard suite and keeps the aggregate required check', () => {
  const workflow = read('.github/workflows/ci.yml');
  const preflight = jobBlock(workflow, 'preflight');
  const tests = jobBlock(workflow, 'tests');
  const validate = jobBlock(workflow, 'validate');

  assert.match(preflight, /timeout-minutes:\s*10/);
  assert.doesNotMatch(preflight, /run-all\.js|run-bounded-node-test\.sh/);
  assert.match(tests, /timeout-minutes:\s*10/);
  assert.match(tests, /fail-fast:\s*false/);
  assert.match(tests, /shard:\s*\[\s*0,\s*1,\s*2,\s*3\s*\]/);
  assert.match(tests, /DHPK_TEST_JOBS:\s*['"]?4/);
  assert.match(tests, /DHPK_TEST_SOURCE_COMMIT:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(tests, /DHPK_TEST_HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  assert.match(tests, /DHPK_TEST_TIMING_FILE:\s*\$\{\{\s*runner\.temp\s*\}\}\/dhpk-test-timing\.json/);
  assert.match(tests, /run-bounded-node-test\.sh\s+node\s+tests\/run-all\.js\s+--shard-index\s+\$\{\{\s*matrix\.shard\s*\}\}\s+--shard-count\s+4/);

  assert.match(validate, /name: Validate harness assets/);
  assert.match(validate, /needs:\s*\[\s*preflight,\s*tests\s*\]/);
  assert.match(validate, /if:\s*always\(\)/);
  assert.match(validate, /needs\.preflight\.result/);
  assert.match(validate, /needs\.tests\.result/);
  assert.match(validate, /actions\/setup-node@[0-9a-f]{40}\s+#\s*v7\.0\.0/);
  assert.match(validate, /node-version:\s*['"]?24/);
  assert.match(validate, /node scripts\/ci\/verify-test-shards\.js[\s\S]*--count 4[\s\S]*--run-id[\s\S]*--run-attempt[\s\S]*--checkout-sha[\s\S]*--head-sha[\s\S]*--summary/);
  for (const shard of [0, 1, 2, 3]) {
    assert.match(validate, new RegExp('dhpk-test-timing-\\$\\{\\{\\s*github\\.run_id\\s*\\}\\}-\\$\\{\\{\\s*github\\.run_attempt\\s*\\}\\}-shard-' + shard));
    assert.match(
      validate,
      new RegExp('path:\\s*\\$\\{\\{\\s*runner\\.temp\\s*\\}\\}\\/dhpk-test-shards\\/dhpk-test-timing-\\$\\{\\{\\s*github\\.run_id\\s*\\}\\}-\\$\\{\\{\\s*github\\.run_attempt\\s*\\}\\}-shard-' + shard),
    );
  }
  assert.match(workflow, /CHANGELOG_ARGS=\(\)/);
  assert.match(workflow, /--diff-base\s+"origin\/\$BASE_REF"\s+--base-ref\s+"\$BASE_REF"/);
  assert.strictEqual(
    (workflow.match(/scripts\/ci\/validate-changelog-fragments\.js/g) || []).length,
    1,
    'PR coverage must be folded into the single changelog validator invocation'
  );
});

test('CI forwards bot authorship to the changelog coverage gate', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /PR_AUTHOR_TYPE:\s*\$\{\{\s*github\.event\.pull_request\.user\.type\s*\}\}/);
  assert.match(workflow, /if \[ "\$PR_AUTHOR_TYPE" = "Bot" \]; then[\s\S]*?CHANGELOG_ARGS\+=\(--bot-authored\)/);
});

test('release invokes the harness facade for the full consumer surface plan', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /bin\/dhpk harness release/);
  assert.match(workflow, /surfaceResults/);
});

run('harness-workflow-config');
