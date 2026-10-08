'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { runRelocatedFlowDrive } = require('./_lib/flow-drive-relocation-fixtures');
const fixture = require('./fixtures/flow-drive/dev-qa-sanitized/input.json');
const expected = require('./fixtures/flow-drive/dev-qa-sanitized/expected.json');

function qa(variant) {
  const result = runRelocatedFlowDrive('dev-qa', { fixtureData: fixture, variant });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(Object.values(result.value.guard).every(Boolean));
  assert.ok(result.value.loaded_modules.every((file) => file.startsWith(`${result.skillDir}${path.sep}`)));
  assert.strictEqual(result.value.provider_runtime, 'NOT_RUN');
  assert.deepStrictEqual(result.value.calls, expected.forbidden_calls);
  for (const file of expected.unchanged_files) assert.strictEqual(result.value.files[file], fixture.initial_files[file]);
  return result.value;
}

function perItem(value) {
  const results = JSON.parse(value.report.execution.evidence);
  for (const id of expected.required_successes) assert.strictEqual(results.find((item) => item.id === id)?.status, 'SUCCEEDED', `${id}: ${JSON.stringify(value.report.blockers)}`);
  assert.strictEqual(value.executions.filter((item) => item.id === 'A-write').length, expected.A_writer_launches);
  assert.strictEqual(value.total, expected.B_total);
  assert.strictEqual(value.report.acceptance.status, expected.parent_acceptance);
  assert.strictEqual(value.peakWriters, expected.peak_writers);
  assert.strictEqual(value.activeWriters, 0);
  assert.strictEqual(value.files['scratch/manual-proposal.md'], expected.manual_proposal);
  assert.strictEqual(value.verifications.find((item) => item.id === 'B-red').actual_total, 800);
  for (const id of ['B-repair', 'B-tests', 'B-review']) assert.strictEqual(value.verifications.find((item) => item.id === id)?.status, 'PASSED');
  const repair = value.executions.find((item) => item.id === 'B-repair');
  const review = value.executions.find((item) => item.id === 'B-review');
  assert.notStrictEqual(repair.executor_identity.agent_id, review.executor_identity.agent_id);
  for (const [prior, next] of expected.dependencies) {
    if (next === 'A-write') continue;
    assert.ok(value.events.indexOf(`execute:${prior}`) < value.events.indexOf(`execute:${next}`), `${prior} before ${next}`);
  }
  assert.ok(value.executions.every((item) => item.request.scope.workdir && item.request.scope.prompt_evidence.sha256));
}

test('T7 QA native copied runner gates unknown A, repairs B and retains independent acceptance evidence', () => perItem(qa('native')));

test('T7 QA answered extra Vendor probes only selected targets after consent', () => {
  const value = qa('cross-provider'); perItem(value);
  assert.ok(value.events.indexOf('answer') < value.events.indexOf('refresh'));
  assert.deepStrictEqual(value.capabilityRequests[0].authorized_targets, []);
  assert.ok(value.capabilityRequests.slice(1).every((request) => request.authorized_targets.length > 0
    && request.authorized_targets.every((target) => target.provider === 'openai' && target.target_agent === 'codex-cli')));
  assert.strictEqual(value.executions.some((item) => item.target.provider === 'google'), false);
});

test('T7 QA literal 900 oracle rejects a bad repair even though A already blocks the parent', () => {
  const value = qa('bad-repair');
  assert.strictEqual(value.total, 1000);
  assert.strictEqual(value.verifications.find((item) => item.id === 'B-repair')?.status, 'FAILED');
  assert.strictEqual(value.executions.some((item) => ['B-tests', 'B-review'].includes(item.id)), false);
});

test('T7 QA stale executor evidence and strict unavailable target never launch blocked work', () => {
  const stale = qa('stale-capability'); assert.strictEqual(stale.executions.length, 0);
  const strict = qa('strict-unavailable'); assert.strictEqual(strict.executions.some((item) => item.request.authority === 'workspace-write'), false);
  assert.strictEqual(stale.report.acceptance.status, 'BLOCKED'); assert.strictEqual(strict.report.acceptance.status, 'BLOCKED');
});

test('T7 QA matching writer and reviewer identity blocks review acceptance', () => {
  const value = qa('missing-review');
  assert.strictEqual(value.total, expected.B_total);
  const results = JSON.parse(value.report.execution.evidence);
  assert.strictEqual(results.find((item) => item.id === 'B-review')?.status, 'BLOCKED');
  assert.ok(value.report.blockers.some((item) => item.includes('reviewer independence')));
});

test('T7 QA interrupted writer requires stopped reconciliation and blocks dependent acceptance', () => {
  const value = qa('timeout-writer');
  assert.strictEqual(value.executions.some((item) => ['B-tests', 'B-review'].includes(item.id)), false);
  const results = JSON.parse(value.report.execution.evidence);
  assert.strictEqual(results.find((item) => item.id === 'B-repair')?.attempts[0].receipt.verification, 'RECONCILIATION_REQUIRED');
  assert.strictEqual(value.report.acceptance.status, 'BLOCKED');
});

test('T7 REQ-01 through REQ-16 map to existing executable test source IDs without loading suites', () => {
  const map = require('./fixtures/flow-drive/requirements.json');
  assert.deepStrictEqual(map.requirements.map((item) => item.id), Array.from({ length: 16 }, (_, index) => `REQ-${String(index + 1).padStart(2, '0')}`));
  for (const item of map.requirements) {
    assert.ok(item.tests.length > 0);
    for (const entry of item.tests) {
      assert.ok(/^tests\/[a-z0-9-]+\.test\.js$/.test(entry.suite));
      const source = fs.readFileSync(path.join(__dirname, '..', entry.suite), 'utf8');
      assert.ok(source.includes(`test('${entry.test}'`), `${item.id}: missing executable source ID ${entry.test}`);
    }
  }
  assert.strictEqual(JSON.stringify(map).includes('"status": "PASS"'), false);
});

run('flow-drive-dev-qa');
