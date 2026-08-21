'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const probe = require('../scripts/release/claude-profile-probe');

test('Claude profile probe keeps the closed status vocabulary and bounded tree API', () => {
  assert.ok(probe.STATUSES.includes('NOT_CONFIGURED'));
  assert.strictEqual(typeof probe.digestTree, 'function');
  assert.strictEqual(typeof probe.digestArtifact, 'function');
  const result = probe.runClaudeProfileProbe({ profileId: '../unsafe', packageRoot: '/nonexistent' });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.doesNotMatch(JSON.stringify(result), /nonexistent/);
});

run('claude-profile-probe');
