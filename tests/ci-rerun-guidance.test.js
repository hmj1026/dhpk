'use strict';

// #1286: CI evidence is bound to one run attempt (the plan artifact and shard
// timing names carry github.run_attempt, and verify-test-shards rejects a
// mismatched attempt). "Re-run failed jobs" therefore cannot reuse attempt 1's
// plan. Every plan download must turn that into an explicit instruction to
// re-run all jobs instead of an opaque download-artifact failure.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const WORKFLOW = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

function stepBlocks(text) {
  return text.split(/\n(?=      - )/);
}

test('every CI plan download is followed by a re-run-all-jobs instruction', () => {
  const blocks = stepBlocks(WORKFLOW);
  const downloads = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => /name: Download complete CI plan\n/.test(block));
  assert.ok(downloads.length >= 3, `expected the plan download in every consuming job, found ${downloads.length}`);
  for (const { block, index } of downloads) {
    assert.match(block, /\n        id: ci-plan\n/, 'the download needs an id the guidance step can test');
    assert.match(block, /\n        continue-on-error: true\n/, 'the download must not end the job before the guidance step');
    const guidance = blocks[index + 1] || '';
    assert.match(guidance, /name: Require the CI plan from this run attempt/);
    assert.match(guidance, /if: steps\.ci-plan\.outcome == 'failure'/);
    assert.match(guidance, /gh run rerun \$\{RUN_ID\}/, 'the error must name the full re-run command');
    assert.match(guidance, /exit 1/, 'a missing plan must still fail the job');
  }
});

run('ci-rerun-guidance');
