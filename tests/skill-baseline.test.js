'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SCHEMA,
  buildBaseline,
} = require('../scripts/ci/skill-baseline');

const ROOT = path.join(__dirname, '..');
const SOURCE_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

test('baseline records exactly one static entry per inventory skill and module', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  const baseline = buildBaseline({ root: ROOT });
  assert.strictEqual(baseline.schema, SCHEMA);
  assert.strictEqual(baseline.sourceCommit, SOURCE_COMMIT);
  assert.strictEqual(baseline.static.skills.length, inventory.skills.length);
  assert.strictEqual(baseline.static.modules.length, inventory.modules.length);
  assert.strictEqual(new Set(baseline.static.skills.map((entry) => entry.id)).size, inventory.skills.length);
  assert.strictEqual(new Set(baseline.static.modules.map((entry) => entry.id)).size, inventory.modules.length);
  assert.strictEqual(baseline.static.counts.skills, inventory.skills.length);
  assert.ok(baseline.static.skills.every((entry) => Array.isArray(entry.source.packageAssets)));
  assert.deepStrictEqual(baseline.static.sourceReconciliation.unlistedSourcePaths, []);
  assert.deepStrictEqual(baseline.static.sourceReconciliation.missingSourcePaths, []);
  assert.deepStrictEqual(baseline.static.sourceReconciliation.duplicateInventoryPaths, []);
});

test('baseline separates static ownership/disposition from non-PASS runtime evidence', () => {
  const baseline = buildBaseline({ root: ROOT });
  assert.ok(baseline.static.skills.every((entry) => entry.owner && entry.disposition));
  assert.ok(baseline.static.skills.every((entry) => entry.contract && entry.dispositionRecord));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.independentTask.status));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.inputs.status));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.outputs.status));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.permissions.status));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.completion.status));
  assert.ok(baseline.static.skills.every((entry) => Array.isArray(entry.contract.missing)));
  assert.ok(baseline.static.skills.every((entry) => entry.dispositionRecord.rationale));
  assert.ok(baseline.static.skills.every((entry) => entry.dependencies));
  for (const entry of baseline.static.skills) {
    for (const dependencyClass of ['localLinks', 'packageAssets', 'optionalToolsProviders', 'hiddenRepoRoot', 'environment', 'siblingSkills']) {
      assert.ok(entry.dependencies[dependencyClass].status, `${entry.id} ${dependencyClass}`);
      assert.ok(entry.dependencies[dependencyClass].reason || Array.isArray(entry.dependencies[dependencyClass].values), `${entry.id} ${dependencyClass}`);
    }
  }
  assert.ok(baseline.static.skills.every((entry) => entry.contract.independentTask.value));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.inputs.value));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.outputs.value));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.permissions.value));
  assert.ok(baseline.static.skills.every((entry) => entry.contract.completion.value));
  assert.strictEqual(baseline.static.metadataEstimates.length, baseline.static.skills.length);
  assert.ok(baseline.initialContext.catalog.fingerprint);
  assert.strictEqual(baseline.initialContext.installed.status, 'NOT_RUN');
  assert.strictEqual(baseline.initialContext.discoverable.status, 'NOT_RUN');
  assert.strictEqual(baseline.initialContext.loaded.status, 'NOT_RUN');
  assert.strictEqual(baseline.initialContext.sessionStart.status, 'NOT_RUN');
  assert.ok(baseline.initialContext.toolMetadata.entries.length > 0);
  assert.ok(baseline.static.skills.every((entry) => entry.source && typeof entry.source.entrypoint === 'boolean'));
  assert.strictEqual(baseline.runtimeObserved.status, 'NOT_RUN');
  assert.ok(baseline.runtimeObserved.rows.every((row) => row.host && Object.prototype.hasOwnProperty.call(row, 'clientVersion')));
  const requiredSurfaces = require('../manifests/distribution-inventory.json').platform_matrix.required_surfaces;
  assert.deepStrictEqual(
    [...new Set(baseline.runtimeObserved.rows.map((row) => row.surface))].sort(),
    [...requiredSurfaces].sort(),
  );
  assert.ok(baseline.runtimeObserved.rows.every((row) => row.status !== 'PASS' || row.evidence === 'PASS'));
  assert.ok(baseline.limitations.some((entry) => /login|HOME|client/i.test(entry)));
});

test('baseline no longer reports the retired fast-worker forwarding wrapper', () => {
  const baseline = buildBaseline({ root: ROOT });
  assert.ok(baseline.analysis && Array.isArray(baseline.analysis.testReuseCandidates));
  assert.ok(!baseline.analysis.testReuseCandidates.some((candidate) => (
    candidate.entrypoint === 'tests/fast-worker-selector.test.js'
    || candidate.implementation === 'tests/fast-worker-selection.test.js'
  )));
});

test('baseline does not include environment secrets or private HOME paths', () => {
  const baseline = buildBaseline({ root: ROOT });
  const serialized = JSON.stringify(baseline);
  assert.doesNotMatch(serialized, /GH_TOKEN|GITHUB_TOKEN|AWS_SECRET|Authorization/i);
  assert.doesNotMatch(serialized, new RegExp(`${process.env.HOME || '/Users/'}`));
});

test('checked-in baseline source commit remains pinned and valid', () => {
  const baselinePath = path.join(ROOT, 'docs', 'baselines', 'issue-467-develop-bba2873.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert.strictEqual(baseline.schema, SCHEMA);
  assert.match(baseline.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(baseline.sourceTree, /^[0-9a-f]{40}$/);
  assert.strictEqual(baseline.static.skills.length, require('../manifests/distribution-inventory.json').skills.length);
});

test('baseline rejects a source tree that is not bound to the source commit', () => {
  assert.throws(
    () => buildBaseline({ root: ROOT, sourceCommit: 'HEAD', sourceTree: '0'.repeat(40) }),
    /does not match source commit/i,
  );
  assert.throws(
    () => buildBaseline({ root: ROOT, sourceCommit: 'not-a-real-commit', sourceTree: '0'.repeat(40), provenanceRoot: ROOT }),
    /cannot be resolved in provenance root/i,
  );
  assert.throws(
    () => buildBaseline({ root: ROOT, sourceCommit: 'not-a-real-commit', provenanceRoot: ROOT }),
    /cannot be resolved in provenance root/i,
  );
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-baseline-root-'));
  try {
    assert.throws(
      () => buildBaseline({ root: scratchRoot, sourceCommit: SOURCE_COMMIT, provenanceRoot: ROOT }),
      /collection root does not match source commit|collection root file .* does not match source commit/i,
    );
    assert.throws(
      () => buildBaseline({ root: scratchRoot, sourceCommit: SOURCE_COMMIT, provenanceRoot: ROOT }),
      /collection root does not match source commit|collection root file .* does not match source commit/i,
    );
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

run('skill-baseline');
