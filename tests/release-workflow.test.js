'use strict';

// Regression guards for the Release workflow's immutable-tag contract:
//   - an existing GitHub Release is preserved on rerun instead of being edited;
//   - empty CHANGELOG notes fail before publication;
//   - notes are streamed via stdin so shell syntax in prose stays inert.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

test('release step preserves an existing release instead of editing it', () => {
  const viewIdx = raw.indexOf('gh release view');
  const createIdx = raw.indexOf('gh release create');
  assert.ok(viewIdx !== -1, 'missing "gh release view" existence check');
  assert.ok(createIdx !== -1, 'missing "gh release create"');
  assert.ok(viewIdx < createIdx, '"gh release view" must be checked before "gh release create"');
  assert.ok(!raw.includes('gh release edit'), 'immutable release reruns must not edit existing notes');
});

test('release notes are streamed via stdin, not interpolated inline', () => {
  assert.ok(raw.includes('--notes-file -'), 'missing "--notes-file -" (stdin) usage');
  assert.ok(
    !/--notes\s+"\$\{?NOTES/.test(raw),
    'notes must not be passed inline via --notes "$NOTES" (backticks/$(...) would be shell-expanded)'
  );
});

test('release workflow delegates note extraction to the unit-tested extract-notes.sh (see tests/extract-release-notes.test.js for empty/malformed-section coverage)', () => {
  assert.ok(raw.includes('scripts/release/extract-notes.sh'), 'missing extract-notes.sh invocation');
});

test('release workflow verifies the tag commit is contained in main', () => {
  assert.ok(raw.includes('git merge-base --is-ancestor'), 'missing tag-to-main provenance check');
});

test('release workflow verifies manifest/changelog parity for the tag version before creating a release', () => {
  const parityIdx = raw.indexOf('verify-release-parity.js');
  const createIdx = raw.indexOf('gh release create');
  assert.ok(parityIdx !== -1, 'missing scripts/ci/verify-release-parity.js invocation');
  assert.ok(parityIdx < createIdx, 'parity must be verified before creating the GitHub release');
});

test('a post-publish consumer-verify job runs consumer-gate.js and reports via the job summary, never editing the release', () => {
  assert.ok(raw.includes('consumer-verify:'), 'missing consumer-verify job');
  assert.ok(raw.includes('consumer-gate.js'), 'consumer-verify must run scripts/release/consumer-gate.js');
  assert.ok(raw.includes('GITHUB_STEP_SUMMARY'), 'consumer-verify must report via the job summary');
  assert.ok(!raw.includes('gh release edit'), 'consumer-verify must never edit the immutable release');
});

test('back-merge fails loudly on conflict and never resets or force-pushes', () => {
  const syncIdx = raw.indexOf('sync-develop:');
  assert.ok(syncIdx !== -1, 'missing sync-develop job');
  const syncBlock = raw.slice(syncIdx);
  assert.ok(syncBlock.includes('git merge --no-ff'), 'back-merge must use --no-ff (no fast-forward silently skipping a merge commit)');
  assert.ok(!syncBlock.includes('|| true') && !/git merge[^\n]*\|\|/.test(syncBlock), 'a merge conflict must fail the job, not be swallowed');
  assert.ok(!syncBlock.includes('reset --hard'), 'back-merge must never reset');
  assert.ok(!syncBlock.includes('push --force') && !syncBlock.includes('push -f'), 'back-merge must never force-push');
});

test('RELEASE.md documents the manual back-merge recovery procedure (recovery branch, resolve, test, PR to develop)', () => {
  const releaseMd = fs.readFileSync(path.join(ROOT, 'RELEASE.md'), 'utf8');
  assert.match(releaseMd, /recovery branch/i);
  assert.match(releaseMd, /merge `?main`? into/i);
  assert.match(releaseMd, /PR .* to `?develop`?|pull request .* to `?develop`?/i);
});

test('consumer-verify never deletes, moves, or force-updates the tag or release on a CONSUMER failure', () => {
  const verifyIdx = raw.indexOf('consumer-verify:');
  const nextJobIdx = raw.indexOf('sync-develop:');
  const consumerBlock = raw.slice(verifyIdx, nextJobIdx);
  assert.ok(!consumerBlock.includes('tag -d'), 'must never delete a local tag');
  assert.ok(!consumerBlock.includes('push --delete'), 'must never delete the remote tag');
  assert.ok(!consumerBlock.includes('gh release delete'), 'must never delete the GitHub release');
  assert.ok(!consumerBlock.includes('gh release edit'), 'must never edit the immutable release');
});

test('RELEASE.md documents that a CONSUMER verification failure keeps the tag immutable and recovery is a new patch/hotfix release', () => {
  const releaseMd = fs.readFileSync(path.join(ROOT, 'RELEASE.md'), 'utf8');
  assert.match(releaseMd, /consumer verification fail|consumer.*fail/i);
  assert.match(releaseMd, /patch|hotfix/i);
  assert.match(releaseMd, /immutable/i);
});

test('consumer-verify installs the real claude CLI so the supported Claude check runs for real, not perpetually UNAVAILABLE', () => {
  const verifyIdx = raw.indexOf('consumer-verify:');
  const nextJobIdx = raw.indexOf('sync-develop:');
  const consumerBlock = raw.slice(verifyIdx, nextJobIdx);
  const installIdx = consumerBlock.indexOf('@anthropic-ai/claude-code');
  const gateInvocationIdx = consumerBlock.indexOf('node scripts/release/consumer-gate.js');
  assert.ok(installIdx !== -1, 'missing claude CLI install step');
  assert.ok(gateInvocationIdx !== -1, 'missing consumer-gate.js invocation');
  assert.ok(installIdx < gateInvocationIdx, 'claude CLI must be installed before consumer-gate.js runs');
});

run('release-workflow');
