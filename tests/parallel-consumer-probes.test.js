'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { parseArgs, namespaceFor } = require('../scripts/release/parallel-consumer-probes');

test('parallel consumer coordinator requires canonical surfaces and bounds concurrency', () => {
  const args = parseArgs([
    '--repo-root', '/tmp/dhpk',
    '--surfaces', 'claude-core,codex-sync',
    '--concurrency', '99',
    '--timeout-ms', '1000',
    '--task-id', 'release-test',
    '--attempt-id', 'attempt-test',
  ]);
  assert.strictEqual(args.concurrency, 7);
  assert.strictEqual(args.timeoutMs, 1000);
  assert.match(namespaceFor(args, 'claude-core', 0), /^dhpk-release-probe-release-test-attempt-test-claude-core-0$/);
  assert.throws(() => parseArgs(['--repo-root', '/tmp/dhpk', '--surfaces', 'unknown']), /canonical/);
});

run('parallel-consumer-probes');
