'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
} = require('../scripts/lib/distribution-compiler');
const { externalSkillPackagesFingerprint } = require('../scripts/lib/distribution-projection-contract');

function inventory() {
  return {
    skills: [{ id: 'compiler-skill', path: 'skills/compiler-skill', surfaces: ['agent-plugin'] }],
    modules: [],
  };
}

test('compiler creates a plan, materializes it, and verifies a consumer stage', () => {
  const planResult = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
  assert.strictEqual(planResult.ok, true, planResult.error && planResult.error.message);

  const published = [];
  const store = {
    begin: () => ({
      write: (output) => published.push(output),
      publish: () => ({ outputs: published.slice(), links: [], artifactFingerprint: 'artifact-1' }),
      abort: () => {},
    }),
  };
  const artifactResult = materializeDistribution(planResult.value, {
    identity: { id: 'agent-plugin', version: '1' },
    render: () => ({
      outputs: [{ stableId: 'compiler-skill', destination: 'skills/compiler-skill', content: 'ok' }],
    }),
  }, store);
  assert.strictEqual(artifactResult.ok, true, artifactResult.error && artifactResult.error.message);
  assert.strictEqual(artifactResult.value.artifactFingerprint, 'artifact-1');

  const evidence = verifyDistribution('package', artifactResult.value, {
    identity: { id: 'agent-plugin', version: '1' },
    verify: () => ({ verdict: 'PASS', observations: ['package verified'] }),
  });
  assert.strictEqual(evidence.ok, true, evidence.error && evidence.error.message);
  assert.strictEqual(evidence.value.verdict, 'PASS');
});

test('compiler carries external ownership provenance through artifact and evidence', () => {
  const ledger = [{
    id: 'gitnexus',
    owner: 'upstream',
    repository: 'https://github.com/abhijeetmaharana/gitnexus',
    policy: 'protect-existing',
    license_review: 'open',
    stable_ids: ['gitnexus-context'],
  }];
  const planResult = compileDistribution({
    inventory: { ...inventory(), external_skill_packages: ledger },
    surface: 'agent-plugin',
  });
  assert.strictEqual(planResult.ok, true, planResult.error && planResult.error.message);
  const ownershipFingerprint = externalSkillPackagesFingerprint(ledger);
  assert.strictEqual(planResult.value.externalSkillPackagesFingerprint, ownershipFingerprint);

  const store = {
    begin: () => ({
      write: () => {},
      publish: () => ({
        outputs: [{ stableId: 'compiler-skill', destination: 'skills/compiler-skill', content: 'ok' }],
        links: [],
        artifactFingerprint: 'artifact-ownership',
      }),
      abort: () => {},
    }),
  };
  const artifactResult = materializeDistribution(planResult.value, {
    identity: { id: 'agent-plugin', version: '1' },
    render: () => ({
      outputs: [{ stableId: 'compiler-skill', destination: 'skills/compiler-skill', content: 'ok' }],
    }),
  }, store);
  assert.strictEqual(artifactResult.ok, true, artifactResult.error && artifactResult.error.message);
  assert.strictEqual(artifactResult.value.externalSkillPackagesFingerprint, ownershipFingerprint);

  const evidence = verifyDistribution('package', artifactResult.value, {
    identity: { id: 'agent-plugin', version: '1' },
    verify: () => ({ verdict: 'PASS', observations: ['package verified'] }),
  });
  assert.strictEqual(evidence.ok, true, evidence.error && evidence.error.message);
  assert.strictEqual(evidence.value.externalSkillPackagesFingerprint, ownershipFingerprint);
});

run('distribution-compiler');
