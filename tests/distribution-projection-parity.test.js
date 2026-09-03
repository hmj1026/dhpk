'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { compareDistributionProjections } = require('../scripts/lib/distribution-projection-parity');

function subject(ownershipFingerprint = undefined) {
  const plan = {
    schema: 'dhpk.distribution-projection-contract.v1',
    surface: 'claude-profile',
    profile: { id: 'minimal' },
    planFingerprint: 'plan-parity-fixture',
    selectedStableIds: ['fixture'],
    entries: [{
      stableId: 'fixture',
      source: 'skills/fixture/SKILL.md',
      destination: 'skills/fixture/SKILL.md',
      sourceFingerprint: 'source-fixture',
      owner: 'fixture',
      transform: { id: 'identity', version: '1' },
      expectedFingerprint: 'output-fixture',
    }],
  };
  if (ownershipFingerprint !== undefined) plan.externalSkillPackagesFingerprint = ownershipFingerprint;
  const artifact = {
    planFingerprint: plan.planFingerprint,
    artifactFingerprint: 'artifact-parity-fixture',
    outputs: [{ stableId: 'fixture', destination: 'skills/fixture/SKILL.md', expectedFingerprint: 'output-fixture' }],
  };
  if (ownershipFingerprint !== undefined) artifact.externalSkillPackagesFingerprint = ownershipFingerprint;
  return { surface: plan.surface, profile: { id: 'minimal' }, plan, artifact };
}

test('projection parity emits canonical structural evidence for equivalent declared inputs', () => {
  const result = compareDistributionProjections({ expected: subject(), actual: subject(), stage: 'structural' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.evidence.verdict, 'PASS');
  assert.strictEqual(result.evidence.stage, 'structural');
  assert.ok(result.checkedFields.includes('sourceFingerprint'));
});

test('projection parity rejects an output fingerprint drift without reading budget state', () => {
  const actual = subject();
  actual.artifact = { ...actual.artifact, outputs: [{ ...actual.artifact.outputs[0], expectedFingerprint: 'drifted' }] };
  const result = compareDistributionProjections({ expected: subject(), actual, stage: 'structural' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.evidence.verdict, 'FAIL');
  assert.match(result.diagnostics.join('\n'), /fingerprint|stale/i);
});

test('projection parity rejects duplicate stable IDs and unsupported runtime stages', () => {
  const duplicate = subject();
  duplicate.artifact = {
    ...duplicate.artifact,
    outputs: [...duplicate.artifact.outputs, { ...duplicate.artifact.outputs[0] }],
  };
  const duplicateResult = compareDistributionProjections({ expected: subject(), actual: duplicate, stage: 'structural' });
  assert.strictEqual(duplicateResult.ok, false);
  assert.ok(duplicateResult.mismatches.some((mismatch) => mismatch.type === 'duplicate'));

  const runtimeResult = compareDistributionProjections({ expected: subject(), actual: subject(), stage: 'consumer-runtime' });
  assert.strictEqual(runtimeResult.ok, false);
  assert.strictEqual(runtimeResult.evidence.verdict, 'NOT_CONFIGURED');
  assert.match(runtimeResult.diagnostics.join('\n'), /structural-only|not configured/i);
});

test('projection parity binds outer surface and profile labels to their compiler plan', () => {
  const surfaceDrift = subject();
  surfaceDrift.plan = { ...surfaceDrift.plan, surface: 'codex-native' };
  const surfaceResult = compareDistributionProjections({ expected: subject(), actual: surfaceDrift, stage: 'structural' });
  assert.strictEqual(surfaceResult.ok, false);
  assert.match(surfaceResult.diagnostics.join('\n'), /surface identity|surface drift/i);

  const profileDrift = subject();
  profileDrift.plan = { ...profileDrift.plan, profile: { id: 'other' } };
  const profileResult = compareDistributionProjections({ expected: subject(), actual: profileDrift, stage: 'structural' });
  assert.strictEqual(profileResult.ok, false);
  assert.match(profileResult.diagnostics.join('\n'), /profile identity/i);
});

test('projection parity rejects external ownership ledger drift and records provenance', () => {
  const expected = subject('ownership-a');
  const actual = subject('ownership-b');
  const result = compareDistributionProjections({ expected, actual, stage: 'structural' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.mismatches.some((mismatch) => mismatch.field === 'externalSkillPackagesFingerprint'));
  assert.match(result.diagnostics.join('\n'), /external ownership|externalSkillPackagesFingerprint|ownership/i);
  assert.strictEqual(result.externalSkillPackagesFingerprint, 'ownership-a');
  assert.strictEqual(result.evidence.externalSkillPackagesFingerprint, 'ownership-a');
  assert.strictEqual(result.receipt.externalSkillPackagesFingerprint, 'ownership-a');
});

test('projection parity rejects a stale ownership fingerprint between a plan and its artifact', () => {
  const expected = subject('ownership-current');
  expected.artifact = { ...expected.artifact, externalSkillPackagesFingerprint: 'ownership-stale' };
  const actual = subject('ownership-current');
  const result = compareDistributionProjections({ expected, actual, stage: 'structural' });
  assert.strictEqual(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /ownership|fingerprint|stale/i);
});

run('distribution-projection-parity');
