'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SCHEMA,
  buildBaseline,
} = require('../scripts/ci/skill-baseline');

const ROOT = path.join(__dirname, '..');
const SOURCE_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const PRIVATE_CANARIES = [
  { label: 'GH_TOKEN', variable: 'GH_TOKEN', value: 'synthetic-gh-token-pr929-canary' },
  { label: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN', value: 'synthetic-github-token-pr929-canary' },
  { label: 'AWS_SECRET', variable: 'AWS_SECRET', value: 'synthetic-aws-secret-pr929-canary' },
  { label: 'AWS_SECRET_ACCESS_KEY', variable: 'AWS_SECRET_ACCESS_KEY', value: 'synthetic-aws-secret-access-key-pr929-canary' },
  { label: 'Authorization header', variable: 'Authorization', value: 'Bearer synthetic-authorization-pr929-canary' },
];

function assertBaselineOmitsPrivateValues(baseline, privateValues) {
  const serialized = JSON.stringify(baseline);
  for (const { label, value } of privateValues) {
    if (typeof value !== 'string' || value.length === 0) continue;
    const literal = JSON.stringify(value).slice(1, -1);
    assert.ok(!serialized.includes(literal), `Baseline omits ${label}`);
  }
}

function assertPrivateValueRejected(baseline, value) {
  let error = null;
  try {
    assertBaselineOmitsPrivateValues(baseline, [{ label: 'synthetic private value', value }]);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error && error.message === 'Baseline omits synthetic private value', 'privacy assertion rejects the injected value with a label-only message');
  assert.ok(error && !error.message.includes(value), 'privacy assertion error omits the injected value');
}

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

test('privacy assertion allows benign authorization and credential-variable terminology', () => {
  assertBaselineOmitsPrivateValues({
    nested: {
      authorization: 'Documented interface authorization contract.',
      environment: ['GH_TOKEN', 'GITHUB_TOKEN', 'AWS_SECRET', 'AWS_SECRET_ACCESS_KEY'],
    },
  }, PRIVATE_CANARIES);
});

for (const { label, variable, value } of PRIVATE_CANARIES) {
  test(`privacy assertion rejects nested ${label} canary`, () => {
    assertPrivateValueRejected({ nested: { credentials: { [variable]: value } } }, value);
  });
}

test('privacy assertion matches regex-metacharacter paths literally', () => {
  const value = '/tmp/dhpk.privacy[regex](canary)+secret';
  assertPrivateValueRejected({ nested: { path: value } }, value);
});

test('privacy assertion matches Windows paths with backslashes literally', () => {
  const value = 'C:\\Users\\synthetic\\AppData\\Local\\Temp\\private[regex]+canary';
  assertPrivateValueRejected({ nested: { path: value } }, value);
});

test('collector output excludes environment canaries and private HOME paths', () => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-baseline-private-home-'));
  const originalParentHome = process.env.HOME || os.homedir();
  try {
    const childEnvironment = {
      ...process.env,
      ...Object.fromEntries(PRIVATE_CANARIES.map(({ variable, value }) => [variable, value])),
      HOME: temporaryHome,
      USERPROFILE: temporaryHome,
    };
    const child = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'skill-baseline.js'),
      '--root', ROOT,
      '--json',
    ], {
      cwd: ROOT,
      env: childEnvironment,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.strictEqual(child.status, 0, 'collector process succeeds');
    let baseline;
    try {
      baseline = JSON.parse(child.stdout);
    } catch (_error) {
      assert.fail('collector output is valid JSON');
    }
    assertBaselineOmitsPrivateValues(baseline, [
      ...PRIVATE_CANARIES,
      { label: 'temporary HOME path', value: temporaryHome },
      { label: 'parent HOME path', value: originalParentHome },
    ]);
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test('checked-in baseline source commit remains pinned and valid', () => {
  const baselinePath = path.join(ROOT, 'manifests', 'baselines', 'issue-467-develop-bba2873.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert.strictEqual(baseline.schema, SCHEMA);
  assert.strictEqual(baseline.sourceCommit, 'bba2873facb429057d319ce74514077447ae0eb1');
  assert.strictEqual(baseline.sourceTree, '169fcc5be42c401b245da734c9bd90548aa6696f');
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
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

run('skill-baseline');
