'use strict';

// Consolidated coverage for the four git-flow-release-governance requirements
// (openspec/changes/harden-dhpk-release-contracts/specs/git-flow-release-governance/spec.md).
// Each property is implemented at a specific layer; this file asserts all
// four together for traceability rather than re-testing each in isolation
// (see the referenced test files for the detailed unit coverage).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const releaseYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const releaseRunner = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-release-creator', 'scripts', 'release-runner.sh'), 'utf8');
const prepareRelease = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'prepare-release.js'), 'utf8');
const publishGate = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'publish-gate.js'), 'utf8');

test('release-branch origin: prepare-release.js refuses off develop (see prepare-release-cli.test.js for the behavioral test)', () => {
  assert.match(prepareRelease, /REQUIRED_BRANCH = 'develop'/);
});

test('authorized main commit: release.yml verifies the tag commit is an ancestor of origin/main', () => {
  assert.ok(releaseYml.includes('git merge-base --is-ancestor'), 'missing tag-to-main ancestry check');
  assert.ok(releaseYml.indexOf('git merge-base --is-ancestor') < releaseYml.indexOf('gh release create'));
});

test('vX.Y.Z tag parity: release.yml rejects any tag not matching vX.Y.Z before doing anything else', () => {
  assert.match(releaseYml, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  const tagCheckIdx = releaseYml.indexOf('tag must match vX.Y.Z');
  const noteIdx = releaseYml.indexOf('Extract release notes');
  assert.ok(tagCheckIdx !== -1 && tagCheckIdx < noteIdx, 'tag format must be verified before notes extraction');
});

test('prohibited automatic actions: release-runner.sh prepare never tags, publish-gate.js never merges or tags', () => {
  const res = spawnSync('bash', ['-c', String.raw`sed -n '/^    prepare)/,/^        ;;/p'`], { input: releaseRunner, encoding: 'utf8' });
  const prepareBlock = res.stdout;
  assert.ok(!prepareBlock.includes('git tag'), 'prepare phase must never create a tag');
  assert.ok(!prepareBlock.includes('merge'), 'prepare phase must never merge a PR');
  assert.ok(!publishGate.includes('git tag'), 'publish-gate must never create a tag itself');
  assert.ok(!publishGate.includes('gh pr merge'), 'publish-gate must never merge a PR itself');
});

run('git-flow-governance');
