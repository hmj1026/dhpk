'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
} = require('../scripts/lib/distribution-compiler');
const {
  VERDICTS,
  SYMLINK_POLICIES,
  createEvidenceResult,
  createDistributionPlan,
  fingerprint,
  normalizeExternalSkillPackages,
  externalSkillPackagesFingerprint,
} = require('../scripts/lib/distribution-projection-contract');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function inventory() {
  return {
    skills: [
      { id: 'b', path: 'skills/b', surfaces: ['agent-plugin'] },
      { id: 'a', path: 'skills/a', surfaces: ['agent-plugin'] },
    ],
    modules: [],
    surface_membership: { 'agent-plugin': ['b', 'a'] },
    projection_contract: {
      schema: 'dhpk.distribution-projection-contract.v1',
      compiler: { id: 'distribution-compiler', version: '1' },
      symlink_policies: ['forbid'],
      surfaces: {
        'agent-plugin': {
          adapter: 'agent-plugin',
          owner: 'agent-plugin',
          symlink_policy: 'forbid',
          verification_stages: ['structural'],
          selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
        },
      },
    },
  };
}

test('compileDistribution produces a frozen, deterministic plan from inventory policy', () => {
  const first = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
  const second = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.strictEqual(first.value.planFingerprint, second.value.planFingerprint);
  assert.deepStrictEqual(first.value.entries.map((entry) => entry.stableId), ['a', 'b']);
  assert.ok(Object.isFrozen(first.value));
  assert.ok(Object.isFrozen(first.value.entries));
});

test('compiler resolves declared surface membership and records selected IDs', () => {
  const source = inventory();
  source.surface_membership['agent-plugin'] = ['a'];
  source.skills.push({ id: 'not-selected', path: 'skills/not-selected', surfaces: ['agent-plugin'] });
  const compiled = compileDistribution({ inventory: source, surface: 'agent-plugin' });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.entries.map((entry) => entry.stableId), ['a']);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['a']);
});

test('legacy inventory compilation keeps the requested surface filter', () => {
  const source = {
    skills: [
      { id: 'agent', path: 'skills/agent', surfaces: ['agent-plugin'] },
      { id: 'cursor', path: 'skills/cursor', surfaces: ['cursor-plugin'] },
    ],
    modules: [],
  };
  const compiled = compileDistribution({ inventory: source, surface: 'agent-plugin' });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.entries.map((entry) => entry.stableId), ['agent']);
});

test('output plans retain canonical selection identity separately from output intents', () => {
  const compiled = compileDistribution({
    surface: 'agent-plugin',
    entries: [{ id: 'manifest:plugin', source: 'generated/plugin.json', destination: 'plugin.json' }],
    selectedStableIds: ['canonical-skill'],
    selectionPolicy: { source: 'surface_membership', precedence: ['surface_membership'] },
    selectionEntries: [{ id: 'canonical-skill', source: 'skills/canonical', destination: 'skills/canonical' }],
  });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['canonical-skill']);
  assert.deepStrictEqual(compiled.value.selectionEntries.map((entry) => entry.stableId), ['canonical-skill']);
  assert.strictEqual(compiled.value.selectionPolicy.source, 'surface_membership');
  assert.deepStrictEqual(compiled.value.entries.map((entry) => entry.stableId), ['manifest:plugin']);
});

test('public compilation rejects raw entries without normalized selection identity', () => {
  const compiled = compileDistribution({
    surface: 'agent-plugin',
    entries: [{ id: 'ambient', path: 'skills/ambient' }],
  });
  assert.strictEqual(compiled.ok, false);
  assert.strictEqual(compiled.error.code, 'MISSING_NORMALIZED_SELECTION');
  const legacy = compileDistribution({
    internalCharacterization: false,
    selectionMode: 'legacy',
    surface: 'agent-plugin',
    entries: [{ id: 'ambient', path: 'skills/ambient' }],
  });
  assert.strictEqual(legacy.ok, false);
  assert.strictEqual(legacy.error.code, 'MISSING_NORMALIZED_SELECTION');
});

test('compiler fails closed when a migrated surface lacks a valid selection policy', () => {
  const source = inventory();
  delete source.projection_contract.surfaces['agent-plugin'].selection_policy;
  const missing = compileDistribution({ inventory: source, surface: 'agent-plugin' });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.error.code, 'INVALID_SELECTION_POLICY');

  source.projection_contract.surfaces['agent-plugin'].selection_policy = {
    source: 'ambient-directory',
    precedence: ['ambient-directory'],
  };
  const unknown = compileDistribution({ inventory: source, surface: 'agent-plugin' });
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.error.code, 'INVALID_SELECTION_POLICY');
});

test('compiler uses the inventory-owned AGY selection policy', () => {
  const source = inventory();
  source.skills = [
    { id: 'agy-selected', path: 'skills/agy-selected', surfaces: ['agy-plugin'] },
    { id: 'agy-unselected', path: 'skills/agy-unselected', surfaces: ['agy-plugin'] },
  ];
  source.surface_membership = { 'agy-plugin': ['agy-selected'] };
  source.projection_contract.surfaces['agy-plugin'] = {
    adapter: 'agy-plugin',
    owner: 'agy-plugin',
    symlink_policy: 'forbid',
    verification_stages: ['structural'],
    selection_policy: { source: 'surface_membership', precedence: ['surface_membership', 'entry_surfaces'] },
  };

  const compiled = compileDistribution({ inventory: source, surface: 'agy-plugin' });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['agy-selected']);
  assert.deepStrictEqual(compiled.value.entries.map((entry) => entry.stableId), ['agy-selected']);
});

test('compiler fails closed when AGY selection policy is omitted', () => {
  const source = inventory();
  source.projection_contract.surfaces['agy-plugin'] = {
    adapter: 'agy-plugin',
    owner: 'agy-plugin',
    symlink_policy: 'forbid',
    verification_stages: ['structural'],
  };
  source.surface_membership = { 'agy-plugin': ['a'] };
  const compiled = compileDistribution({ inventory: source, surface: 'agy-plugin' });
  assert.strictEqual(compiled.ok, false);
  assert.strictEqual(compiled.error.code, 'INVALID_SELECTION_POLICY');
});

test('profile compilation keeps only surface entries while retaining canonical profile identity', () => {
  const source = inventory();
  source.skills = [
    { id: 'agy-selected', path: 'skills/agy-selected', surfaces: ['agy-plugin'] },
    { id: 'other-surface', path: 'skills/other-surface', surfaces: ['agent-plugin'] },
  ];
  source.surface_membership = { 'agy-plugin': ['agy-selected'] };
  source.projection_contract.surfaces['agy-plugin'] = {
    adapter: 'agy-plugin',
    owner: 'agy-plugin',
    symlink_policy: 'forbid',
    verification_stages: ['structural'],
    selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
  };
  const compiled = compileDistribution({
    inventory: source,
    surface: 'agy-plugin',
    profileSelection: {
      profileId: 'minimal',
      selectedStableIds: ['agy-selected', 'other-surface'],
      selectionFingerprint: 'a'.repeat(64),
      compatibilityMode: 'profile',
      selectionPolicyVersion: 'fixture-v1',
    },
  });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['agy-selected', 'other-surface']);
  assert.deepStrictEqual(compiled.value.entries.map((entry) => entry.stableId), ['agy-selected']);
});

test('compiler preserves Native Codex entry allowlist over other membership maps', () => {
  const source = {
    skills: [
      { id: 'native', path: 'skills/native', surfaces: ['codex-native'] },
      { id: 'broadened', path: 'skills/broadened', surfaces: ['agent-plugin'] },
    ],
    modules: [],
    surface_membership: { 'codex-native': ['native', 'broadened'] },
    projection_contract: {
      schema: 'dhpk.distribution-projection-contract.v1',
      compiler: { id: 'distribution-compiler', version: '1' },
      symlink_policies: ['forbid'],
      surfaces: {
        'codex-native': {
          adapter: 'codex-native',
          owner: 'codex-native',
          symlink_policy: 'forbid',
          verification_stages: ['structural'],
          selection_policy: { source: 'entry_surfaces', precedence: ['entry_surfaces'] },
        },
      },
    },
  };
  const compiled = compileDistribution({ inventory: source, surface: 'codex-native' });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.entries.map((entry) => entry.stableId), ['native']);
});

test('compileDistribution rejects duplicate IDs, invalid entries, and unsupported symlink policies', () => {
  const duplicate = compileDistribution({
    internalCharacterization: true,
    surface: 'agent-plugin',
    entries: [{ id: 'same', path: 'skills/a' }, { id: 'same', path: 'skills/b' }],
  });
  assert.strictEqual(duplicate.ok, false);
  assert.strictEqual(duplicate.error.code, 'DUPLICATE_STABLE_ID');

  const invalidLink = compileDistribution({
    internalCharacterization: true,
    surface: 'agent-plugin',
    entries: [{ id: 'a', path: 'skills/a', symlinkPolicy: 'absolute' }],
  });
  assert.strictEqual(invalidLink.ok, false);
  assert.strictEqual(invalidLink.error.code, 'INVALID_SYMLINK_POLICY');
  assert.deepStrictEqual([...SYMLINK_POLICIES].sort(), ['contained-relative', 'declared-source-relative', 'forbid']);
});

test('materializeDistribution binds published outputs to the plan and aborts on adapter failure', () => {
  const compiled = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
  assert.strictEqual(compiled.ok, true);
  const writes = [];
  let aborted = false;
  const store = {
    begin: () => ({
      write: (output) => writes.push(output),
      publish: () => ({ outputs: writes.slice(), artifactFingerprint: 'artifact-1' }),
      abort: () => { aborted = true; },
    }),
  };
  const artifact = materializeDistribution(compiled.value, {
    identity: { id: 'agent-plugin', version: '1' },
    render: () => ({ outputs: [
      { stableId: 'a', destination: 'skills/a', content: 'a' },
      { stableId: 'b', destination: 'skills/b', content: 'b' },
    ] }),
  }, store);
  assert.strictEqual(artifact.ok, true, artifact.error && artifact.error.message);
  assert.strictEqual(artifact.value.planFingerprint, compiled.value.planFingerprint);
  assert.strictEqual(artifact.value.artifactFingerprint, 'artifact-1');

  const failed = materializeDistribution(compiled.value, {
    render: () => { throw new Error('render failed'); },
  }, store);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.error.code, 'MATERIALIZATION_FAILED');
  assert.strictEqual(aborted, true);
});

test('verifyDistribution returns stage-bound evidence and keeps the verdict vocabulary closed', () => {
  const compiled = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
  const artifact = { planFingerprint: compiled.value.planFingerprint, artifactFingerprint: 'artifact-1' };
  const evidence = verifyDistribution('consumer-runtime', artifact, {
    identity: { id: 'agent-plugin', version: '1' },
    verify: () => ({ verdict: 'UNAVAILABLE', observations: ['client missing'] }),
  });
  assert.strictEqual(evidence.ok, true, evidence.error && evidence.error.message);
  assert.strictEqual(evidence.value.stage, 'consumer-runtime');
  assert.strictEqual(evidence.value.verdict, 'UNAVAILABLE');
  assert.deepStrictEqual([...VERDICTS].sort(), ['BLOCKED', 'FAIL', 'NOT_CONFIGURED', 'NOT_RUN', 'PASS', 'SKIP_INCOMPATIBLE', 'UNAVAILABLE']);

  const aggregateAttempt = createEvidenceResult({ stage: 'package', verdict: 'INSTALL_PASS' });
  assert.strictEqual(aggregateAttempt.ok, false);
  assert.strictEqual(aggregateAttempt.error.code, 'INVALID_VERDICT');
});

test('materializeDistribution integrates the real store and rejects adapter output outside the plan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-projection-contract-'));
  try {
    const compiled = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
    const store = new ProjectionArtifactStore({ root });
    const result = materializeDistribution(compiled.value, {
      identity: { id: 'agent-plugin', version: '1' },
      render: () => ({ outputs: [{ stableId: 'unknown', destination: 'skills/unknown', content: 'x' }] }),
    }, store);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, 'UNPLANNED_OUTPUT');
    assert.deepStrictEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('materializeDistribution aborts when an adapter injects an unplanned staged file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-projection-injection-'));
  try {
    const compiled = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
    const store = new ProjectionArtifactStore({ root });
    const result = materializeDistribution(compiled.value, {
      identity: { id: 'agent-plugin', version: '1' },
      render: (_plan, { session }) => {
        fs.writeFileSync(path.join(session.stageRoot, 'injected.txt'), 'bypass\n');
        return {
          outputs: [
            { stableId: 'a', destination: 'skills/a', content: 'a' },
            { stableId: 'b', destination: 'skills/b', content: 'b' },
          ],
        };
      },
    }, store);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, 'UNEXPECTED_STAGED_ENTRY');
    assert.strictEqual(fs.existsSync(path.join(root, 'published')), false);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('materializeDistribution rejects incomplete plans and materializes link intents', () => {
  const compiled = compileDistribution({
    internalCharacterization: true,
    surface: 'codex-sync',
    entries: [
      { id: 'one', path: 'links/one', symlinkPolicy: 'contained-relative' },
      { id: 'two', path: 'two' },
    ],
  });
  assert.strictEqual(compiled.ok, true);
  const incomplete = materializeDistribution(compiled.value, {
    render: () => ({ outputs: [{ stableId: 'one', destination: 'links/one', content: 'not-a-link' }] }),
  }, {
    begin: () => ({
      write: () => {},
      publish: () => ({ outputs: [], links: [] }),
      abort: () => {},
    }),
  });
  assert.strictEqual(incomplete.ok, false);
  assert.strictEqual(incomplete.error.code, 'INCOMPLETE_OUTPUTS');
  assert.deepStrictEqual(incomplete.error.stableIds, ['two']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-link-intent-'));
  try {
    const linkPlan = compileDistribution({
      internalCharacterization: true,
      surface: 'codex-sync',
      entries: [{ id: 'link', path: 'links/one', symlinkPolicy: 'contained-relative' }],
    });
    const store = new ProjectionArtifactStore({ root });
    const linked = materializeDistribution(linkPlan.value, {
      identity: { id: 'codex-sync', version: '1' },
      render: () => ({ links: [{ stableId: 'link', destination: 'links/one', target: '../target' }], outputs: [] }),
    }, store);
    assert.strictEqual(linked.ok, true, linked.error && linked.error.message);
    assert.strictEqual(linked.value.links.length, 1);
    assert.strictEqual(fs.readlinkSync(path.join(root, 'published/links/one')), '../target');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compiler and verifier fail with stable boundary errors', () => {
  const noInventory = compileDistribution({ surface: 'agent-plugin' });
  assert.strictEqual(noInventory.ok, false);
  assert.strictEqual(noInventory.error.code, 'INVALID_INPUT');
  const compiled = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
  assert.strictEqual(materializeDistribution(null, {}, {}).error.code, 'INVALID_PLAN');
  assert.strictEqual(materializeDistribution(compiled.value, {}, {}).error.code, 'INVALID_ADAPTER');
  assert.strictEqual(materializeDistribution(compiled.value, { render: () => ({ outputs: [] }) }, {}).error.code, 'INVALID_STORE');
  assert.strictEqual(verifyDistribution('unknown', {}, {}).error.code, 'INVALID_STAGE');
  assert.strictEqual(verifyDistribution('package', {}, {}).error.code, 'INVALID_ARTIFACT');
  assert.strictEqual(verifyDistribution('package', { planFingerprint: 'p' }, {}).error.code, 'INVALID_ADAPTER');
  const failed = verifyDistribution('package', { planFingerprint: 'p', artifactFingerprint: 'a' }, {
    identity: { id: 'test', version: '1' },
    verify: () => { throw new Error('consumer failed'); },
  });
  assert.strictEqual(failed.ok, true);
  assert.strictEqual(failed.value.verdict, 'FAIL');
});

test('distribution plans bind a normalized external ownership fingerprint when supplied', () => {
  const ledger = [{
    id: 'gitnexus', owner: 'upstream',
    repository: 'https://github.com/abhigyanpatwari/GitNexus',
    policy: 'protect-existing', license_review: 'open',
    stable_ids: ['gitnexus-refactoring', 'gitnexus-cli'],
  }];
  const first = createDistributionPlan({
    surface: 'agent-plugin', entries: [{ id: 'a', path: 'skills/a' }],
    external_skill_packages: ledger,
  });
  const second = createDistributionPlan({
    surface: 'agent-plugin', entries: [{ id: 'a', path: 'skills/a' }],
    external_skill_packages: [{ ...ledger[0], stable_ids: [...ledger[0].stable_ids].reverse() }],
  });
  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.strictEqual(first.value.externalSkillPackagesFingerprint, externalSkillPackagesFingerprint(ledger));
  assert.strictEqual(first.value.externalSkillPackagesFingerprint, second.value.externalSkillPackagesFingerprint);
  assert.strictEqual(first.value.planFingerprint, second.value.planFingerprint);
  assert.deepStrictEqual(normalizeExternalSkillPackages(ledger), [{
    id: 'gitnexus', owner: 'upstream',
    repository: 'https://github.com/abhigyanpatwari/GitNexus',
    policy: 'protect-existing', license_review: 'open',
    stable_ids: ['gitnexus-cli', 'gitnexus-refactoring'],
  }]);
  assert.strictEqual(first.value.externalSkillPackagesFingerprint, fingerprint(normalizeExternalSkillPackages(ledger)));
});

test('legacy plans omit the optional ownership binding and retain their old fingerprint shape', () => {
  const input = { surface: 'agent-plugin', entries: [{ id: 'a', path: 'skills/a' }] };
  const first = createDistributionPlan(input);
  const second = createDistributionPlan({ ...input });
  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.strictEqual(first.value.externalSkillPackagesFingerprint, undefined);
  assert.strictEqual(second.value.externalSkillPackagesFingerprint, undefined);
  assert.strictEqual(first.value.planFingerprint, second.value.planFingerprint);
});

test('plans can derive the ownership binding from an inventory without changing legacy callers', () => {
  const result = createDistributionPlan({
    surface: 'agent-plugin', entries: [{ id: 'a', path: 'skills/a' }],
    inventory: { external_skill_packages: [{
      id: 'gitnexus', owner: 'upstream',
      repository: 'https://github.com/abhigyanpatwari/GitNexus',
      policy: 'protect-existing', license_review: 'open', stable_ids: ['gitnexus-cli'],
    }] },
  });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  assert.match(result.value.externalSkillPackagesFingerprint, /^[a-f0-9]{64}$/);
});


{
  // Moved source suite: distribution-compiler.test.js

  const {
    compileDistribution,
    materializeDistribution,
    verifyDistribution,
  } = require('../scripts/lib/distribution-compiler');

  function inventory() {
    return {
      skills: [{ id: 'compiler-skill', path: 'skills/compiler-skill', surfaces: ['agent-plugin'] }],
      modules: [],
    };
  }

  test('compiler creates a plan, materializes it, and verifies a consumer stage', () => {
    const planResult = compileDistribution({ inventory: inventory(), surface: 'agent-plugin' });
    assert.strictEqual(planResult.ok, true, planResult.error && planResult.error.message);
    assert.deepStrictEqual(planResult.value.selectedStableIds, ['compiler-skill']);
    assert.deepStrictEqual(planResult.value.entries.map((entry) => entry.stableId), ['compiler-skill']);

    const published = [];
    const expectedOutput = {
      stableId: 'compiler-skill',
      destination: 'skills/compiler-skill',
      content: 'compiler output for consumer verification',
    };
    const store = {
      begin: () => ({
        write: (output) => published.push(output),
        publish: () => ({ outputs: published.slice(), links: [], artifactFingerprint: 'artifact-compiler' }),
        abort: () => {},
      }),
    };
    const artifactResult = materializeDistribution(planResult.value, {
      identity: { id: 'agent-plugin', version: '1' },
      render: () => ({ outputs: [expectedOutput] }),
    }, store);
    assert.strictEqual(artifactResult.ok, true, artifactResult.error && artifactResult.error.message);
    assert.deepStrictEqual(published, [expectedOutput]);
    assert.deepStrictEqual(artifactResult.value.outputs, [expectedOutput]);
    assert.strictEqual(artifactResult.value.artifactFingerprint, 'artifact-compiler');
    assert.strictEqual(artifactResult.value.planFingerprint, planResult.value.planFingerprint);

    const consumer = {
      identity: { id: 'agent-plugin', version: '1' },
      verify: (stage, artifact) => {
        const output = artifact && Array.isArray(artifact.outputs)
          ? artifact.outputs.find((entry) => entry.stableId === 'compiler-skill')
          : null;
        const passed = stage === 'package'
          && artifact.planFingerprint === planResult.value.planFingerprint
          && output
          && output.destination === 'skills/compiler-skill'
          && output.content === 'compiler output for consumer verification';
        return {
          verdict: passed ? 'PASS' : 'FAIL',
          observations: [passed ? 'published compiler output verified' : 'published compiler output did not match'],
        };
      },
    };
    const evidence = verifyDistribution('package', artifactResult.value, consumer);
    assert.strictEqual(evidence.ok, true, evidence.error && evidence.error.message);
    assert.strictEqual(evidence.value.verdict, 'PASS');
    assert.strictEqual(evidence.value.stage, 'package');
    assert.strictEqual(evidence.value.planFingerprint, planResult.value.planFingerprint);
    assert.strictEqual(evidence.value.artifactFingerprint, artifactResult.value.artifactFingerprint);

    const changedOutput = {
      ...artifactResult.value,
      outputs: artifactResult.value.outputs.map((output) => ({ ...output, content: 'tampered compiler output' })),
    };
    const rejectedEvidence = verifyDistribution('package', changedOutput, consumer);
    assert.strictEqual(rejectedEvidence.ok, true, rejectedEvidence.error && rejectedEvidence.error.message);
    assert.strictEqual(rejectedEvidence.value.verdict, 'FAIL');
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
    const ownershipFingerprint = '24a0603c6b49c2acebe6352318303253790c9010f39db9b4a93d6da154013b70';
    assert.strictEqual(planResult.value.externalSkillPackagesFingerprint, ownershipFingerprint);

    const published = [];
    const expectedOutput = {
      stableId: 'compiler-skill',
      destination: 'skills/compiler-skill',
      content: 'compiler ownership fixture output',
    };
    const store = {
      begin: () => ({
        write: (output) => published.push(output),
        publish: () => ({
          outputs: published.slice(),
          links: [],
          artifactFingerprint: 'artifact-ownership',
        }),
        abort: () => {},
      }),
    };
    const artifactResult = materializeDistribution(planResult.value, {
      identity: { id: 'agent-plugin', version: '1' },
      render: () => ({ outputs: [expectedOutput] }),
    }, store);
    assert.strictEqual(artifactResult.ok, true, artifactResult.error && artifactResult.error.message);
    assert.deepStrictEqual(published, [expectedOutput]);
    assert.deepStrictEqual(artifactResult.value.outputs, [expectedOutput]);
    assert.strictEqual(artifactResult.value.planFingerprint, planResult.value.planFingerprint);
    assert.strictEqual(artifactResult.value.externalSkillPackagesFingerprint, ownershipFingerprint);

    const evidence = verifyDistribution('package', artifactResult.value, {
      identity: { id: 'agent-plugin', version: '1' },
      verify: (stage, artifact) => ({
        verdict: stage === 'package'
          && artifact.planFingerprint === planResult.value.planFingerprint
          && artifact.externalSkillPackagesFingerprint === ownershipFingerprint
          && artifact.outputs[0].content === 'compiler ownership fixture output'
          ? 'PASS'
          : 'FAIL',
        observations: ['external ownership and published output checked'],
      }),
    });
    assert.strictEqual(evidence.ok, true, evidence.error && evidence.error.message);
    assert.strictEqual(evidence.value.planFingerprint, planResult.value.planFingerprint);
    assert.strictEqual(evidence.value.externalSkillPackagesFingerprint, ownershipFingerprint);
  });
}


{
  // Moved source suite: distribution-projection-parity.test.js

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
    const expected = subject();
    const equivalent = compareDistributionProjections({ expected, actual: subject(), stage: 'structural' });
    assert.strictEqual(equivalent.ok, true);
    assert.strictEqual(equivalent.evidence.verdict, 'PASS');
    assert.deepStrictEqual(equivalent.mismatches, []);
    assert.deepStrictEqual(equivalent.diagnostics, []);

    const changedSource = subject();
    changedSource.plan = {
      ...changedSource.plan,
      entries: changedSource.plan.entries.map((entry) => ({ ...entry, sourceFingerprint: 'source-drift' })),
    };
    const drift = compareDistributionProjections({ expected, actual: changedSource, stage: 'structural' });
    assert.strictEqual(drift.ok, false);
    assert.strictEqual(drift.evidence.verdict, 'FAIL');
    assert.ok(drift.mismatches.some((mismatch) => mismatch.field === 'sourceFingerprint'));
    assert.match(drift.diagnostics.join('\n'), /sourceFingerprint|source fingerprint|source drift/i);
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
}


{
  // Moved source suite: distribution-rollback-proof.test.js

  // Rollback uses the previous checked-in inventory revision. Snapshot the
  // canonical source before either generation to protect its unchanged bytes.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { generateClaudeSkillRoots, compileClaudeProjection } = require('../scripts/lib/distribution-inventory');
  const { materializeDistribution } = require('../scripts/lib/distribution-compiler');
  const { materializeAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
  const { materializeNativePackage } = require('../scripts/lib/codex-native-package');
  const { materializeCursorPackage } = require('../scripts/lib/cursor-plugin-package');
  const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');

  const ROOT = path.join(__dirname, '..');

  const priorInventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const canonicalSourcePath = path.join(ROOT, 'skills', 'dhpk-fastapi-pro', 'SKILL.md');
  const canonicalSourceBytesBeforeGeneration = fs.readFileSync(canonicalSourcePath);
  const priorGenerated = generateClaudeSkillRoots(priorInventory);

  function snapshotTree(root, relative = '') {
    const snapshot = {};
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.posix.join(relative, entry.name);
      const absolute = path.join(root, child);
      if (entry.isDirectory()) Object.assign(snapshot, snapshotTree(root, child));
      else if (entry.isFile()) snapshot[child] = { mode: fs.statSync(absolute).mode & 0o7777, content: fs.readFileSync(absolute) };
      else snapshot[child] = { type: entry.isSymbolicLink() ? 'symlink' : 'other' };
    }
    return snapshot;
  }

  // Simulate a later change: deprecate fastapi's only skill. The v2 topology
  // registers one flat Claude root, so the root remains while the generated
  // promoted skill-id set drops the deprecated entry.
  const laterInventory = JSON.parse(JSON.stringify(priorInventory));
  const fastapiSkill = laterInventory.skills.find((s) => s.id === 'fastapi-pro');
  fastapiSkill.lifecycle = 'deprecated';
  fastapiSkill.deprecation = {
    since: '2026-07-27',
    compatibilityWindowEnds: '2026-10-27',
    migrationNote: 'Rollback-proof fixture only — not a real deprecation.',
  };
  const laterGenerated = generateClaudeSkillRoots(laterInventory);

  test('the later (deprecated) inventory revision drops the skill from promotion without removing the flat root', () => {
    assert.ok(priorGenerated.roots.includes('./skills/'));
    assert.ok(laterGenerated.roots.includes('./skills/'));
    assert.ok(priorGenerated.generatedSkillIds.includes('fastapi-pro'));
    assert.ok(!laterGenerated.generatedSkillIds.includes('fastapi-pro'));
  });

  test('rollback: regenerating from the prior revision again reproduces the original root set, without any canonical source having been touched', () => {
    assert.deepStrictEqual(fs.readFileSync(canonicalSourcePath), canonicalSourceBytesBeforeGeneration);

    const rolledBackGenerated = generateClaudeSkillRoots(priorInventory);
    assert.deepStrictEqual(fs.readFileSync(canonicalSourcePath), canonicalSourceBytesBeforeGeneration);
    assert.ok(rolledBackGenerated.generatedSkillIds.includes('fastapi-pro'));
    assert.deepStrictEqual(rolledBackGenerated, priorGenerated);
    assert.ok(rolledBackGenerated.roots.includes('./skills/'));
    assert.notDeepStrictEqual(rolledBackGenerated.generatedSkillIds, laterGenerated.generatedSkillIds);
  });

  test('failed Claude inventory reconciliation retains the previously accepted generated view', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-rollback-source-'));
    const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-rollback-output-'));
    const output = path.join(outputParent, 'claude');
    try {
      const inventory = {
        schema: 'dhpk.distribution-inventory.v1',
        skills: [{ id: 'stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['claude-core'] }],
        modules: [],
      };
      const projection = compileClaudeProjection({ inventory });
      assert.strictEqual(projection.ok, true, projection.error && projection.error.message);
      const store = new ProjectionArtifactStore({ root: outputParent, sourceRoot: root, publishRoot: output });
      const first = materializeDistribution(projection.plan, projection.adapter, store);
      assert.strictEqual(first.ok, true, first.error && first.error.message);
      const before = snapshotTree(output);

      const failingStore = {
        begin(plan) {
          const session = store.begin(plan);
          const write = session.write;
          let writes = 0;
          session.write = (entry) => {
            writes += 1;
            if (writes === 2) throw new Error('synthetic Claude inventory staging failure');
            return write(entry);
          };
          return session;
        },
      };
      const failed = materializeDistribution(projection.plan, projection.adapter, failingStore);
      assert.strictEqual(failed.ok, false);
      assert.match(failed.error.message, /synthetic Claude inventory staging failure/);
      assert.deepStrictEqual(snapshotTree(output), before);
      assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputParent, { recursive: true, force: true });
    }
  });

  test('failed Agent Plugin staging retains the previously accepted package tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-rollback-source-'));
    const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-rollback-output-'));
    const output = path.join(outputParent, 'agent');
    try {
      const skillRoot = path.join(root, 'skills', 'dhpk-stable');
      fs.mkdirSync(skillRoot, { recursive: true });
      fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: dhpk-stable\ndescription: Stable\n---\n\nStable body.\n');
      const inventory = {
        skills: [{ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
      };
      materializeAgentPluginPackage({ inventory, root, outDir: output, sourceCommit: 'fixture-source' });
      const beforeManifest = fs.readFileSync(path.join(output, 'plugin.json'));
      const beforeSkill = fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md'));
      const beforeTree = snapshotTree(output);

      const realStore = new ProjectionArtifactStore({
        root: outputParent,
        sourceRoot: root,
        publishRoot: output,
      });
      const failingStore = {
        begin(plan) {
          const session = realStore.begin(plan);
          const write = session.write;
          let writes = 0;
          session.write = (entry) => {
            writes += 1;
            if (writes === 2) throw new Error('synthetic Agent Plugin staging failure');
            return write(entry);
          };
          return session;
        },
      };
      assert.throws(
        () => materializeAgentPluginPackage({ inventory, root, outDir: output, artifactStore: failingStore }),
        /synthetic Agent Plugin staging failure/,
      );
      assert.deepStrictEqual(fs.readFileSync(path.join(output, 'plugin.json')), beforeManifest);
      assert.deepStrictEqual(fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md')), beforeSkill);
      assert.deepStrictEqual(snapshotTree(output), beforeTree);
      assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputParent, { recursive: true, force: true });
    }
  });

  test('failed Codex native staging retains the previously accepted package tree and diagnostic cause', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-rollback-source-'));
    const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-rollback-output-'));
    const output = path.join(outputParent, 'dhpk');
    try {
      const skillRoot = path.join(root, 'skills', 'dhpk-stable');
      fs.mkdirSync(path.join(skillRoot, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: dhpk-stable\n---\n\nStable body.\n');
      const script = path.join(skillRoot, 'bin', 'run.sh');
      fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.chmodSync(script, 0o755);
      const inventory = {
        skills: [{ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['codex-native'] }],
      };
      materializeNativePackage({ inventory, root, outDir: output, name: 'dhpk', version: '1.0.0', sourceCommit: '1'.repeat(40) });
      const beforeManifest = fs.readFileSync(path.join(output, '.codex-plugin', 'plugin.json'));
      const beforeSkill = fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md'));
      const beforeTree = snapshotTree(output);
      const beforeMode = fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777;

      const realStore = new ProjectionArtifactStore({ root: outputParent, sourceRoot: root, publishRoot: output });
      const failingStore = {
        begin(plan) {
          const session = realStore.begin(plan);
          const write = session.write;
          let writes = 0;
          session.write = (entry) => {
            writes += 1;
            if (writes === 2) {
              const error = new Error('synthetic Codex native staging failure');
              error.projectionCode = 'CODEX_NATIVE_STAGE_FAILED';
              throw error;
            }
            return write(entry);
          };
          return session;
        },
      };
      assert.throws(
        () => materializeNativePackage({ inventory, root, outDir: output, artifactStore: failingStore }),
        /synthetic Codex native staging failure/,
      );
      assert.deepStrictEqual(fs.readFileSync(path.join(output, '.codex-plugin', 'plugin.json')), beforeManifest);
      assert.deepStrictEqual(fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md')), beforeSkill);
      assert.deepStrictEqual(snapshotTree(output), beforeTree);
      assert.strictEqual(fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777, beforeMode);
      assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputParent, { recursive: true, force: true });
    }
  });

  test('failed Cursor staging retains the previously accepted package tree and executable modes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-rollback-source-'));
    const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-rollback-output-'));
    const output = path.join(outputParent, 'dhpk-cursor');
    try {
      const skillRoot = path.join(root, 'skills', 'dhpk-stable');
      fs.mkdirSync(path.join(skillRoot, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: dhpk-stable\ndescription: Stable\n---\n\nStable body.\n');
      const script = path.join(skillRoot, 'bin', 'run.sh');
      fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.chmodSync(script, 0o755);
      const inventory = {
        skills: [{ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['cursor-plugin'] }],
      };
      materializeCursorPackage({ inventory, root, outDir: output, sourceCommit: '1'.repeat(40) });
      const beforeTree = snapshotTree(output);
      const beforeMode = fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777;

      const realStore = new ProjectionArtifactStore({ root: outputParent, sourceRoot: root, publishRoot: output });
      const failingStore = {
        begin(plan) {
          const session = realStore.begin(plan);
          const write = session.write;
          let writes = 0;
          session.write = (entry) => {
            writes += 1;
            if (writes === 2) throw new Error('synthetic Cursor staging failure');
            return write(entry);
          };
          return session;
        },
      };
      assert.throws(
        () => materializeCursorPackage({ inventory, root, outDir: output, artifactStore: failingStore }),
        /synthetic Cursor staging failure/,
      );
      assert.deepStrictEqual(snapshotTree(output), beforeTree);
      assert.strictEqual(fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777, beforeMode);
      assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputParent, { recursive: true, force: true });
    }
  });
}


{
  // Moved source suite: distribution-selection-plan-binding.test.js

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { compileAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
  const { compileCursorPackage } = require('../scripts/lib/cursor-plugin-package');
  const { compileNativePackage } = require('../scripts/lib/codex-native-package');
  const { compileMarketplacePublicationView } = require('../scripts/lib/marketplace-selection');

  const ROOT = path.join(__dirname, '..');
  const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const SELECTION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'marketplace-selection.json'), 'utf8'));

  function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  function expectedMarketplacePublication(surface) {
    const publication = compileMarketplacePublicationView({ inventory: INVENTORY, selection: SELECTION, hostSurface: surface });
    assert.deepStrictEqual(publication.errors, [], `${surface} publication must compile`);
    return {
      publicEntryIds: publication.publicEntries.map((entry) => entry.id).sort(),
      hostOnlyIds: publication.hostOnly.map((entry) => entry.id).sort(),
    };
  }

  test('default marketplace adapters retain canonical publication identity and bind output plans', () => {
    const surfaces = [
      ['agent-plugin', 'agent-plugin', (outDir) => compileAgentPluginPackage({ inventory: INVENTORY, root: ROOT, outDir })],
      ['cursor-plugin', 'cursor-plugin', (outDir) => compileCursorPackage({ inventory: INVENTORY, root: ROOT, outDir })],
      ['codex-native', 'codex-native', (outDir) => compileNativePackage({ inventory: INVENTORY, root: ROOT, outDir })],
    ];
    for (const [surface, hostSurface, compile] of surfaces) {
      const outDir = tempDir(`dhpk-selection-plan-${surface}-`);
      try {
        const projection = compile(outDir);
        const expectedPublication = expectedMarketplacePublication(hostSurface);
        const actualPublication = projection.provenance.marketplacePublication;
        assert.ok(actualPublication, `${surface} must record its canonical marketplace publication`);
        assert.deepStrictEqual(
          actualPublication.publicEntryIds,
          expectedPublication.publicEntryIds,
          `${surface} common public entries drifted from the canonical selection`,
        );
        assert.deepStrictEqual(
          actualPublication.hostOnlyIds,
          expectedPublication.hostOnlyIds,
          `${surface} Host-only entries drifted from the canonical selection`,
        );
        const expectedLocalIds = surface === 'cursor-plugin'
          ? expectedPublication.hostOnlyIds
          : [...expectedPublication.publicEntryIds, ...expectedPublication.hostOnlyIds].sort();
        assert.deepStrictEqual(projection.provenance.selectedSkillIds, expectedLocalIds, `${surface} local selected IDs drifted`);
        if (surface === 'cursor-plugin') {
          assert.deepStrictEqual(projection.provenance.sharedSkillIds, expectedPublication.publicEntryIds,
            'Cursor common entries must remain bound to the shared Agent package');
        }
        assert.deepStrictEqual(
          projection.plan.selectedStableIds,
          projection.plan.entries.map((entry) => entry.stableId),
          `${surface} output plan IDs must bind every emitted file`,
        );
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }
  });
}


{
  // Moved source suite: projection-usage-binding.test.js

  const {
    compileDistribution,
    materializeDistribution,
  } = require('../scripts/lib/distribution-compiler');
  const {
    compareDistributionProjections,
  } = require('../scripts/lib/distribution-projection-parity');
  const {
    normalizeSkillUsage,
    usageFingerprint,
  } = require('../scripts/lib/skill-usage');

  function usage(summary = 'Trace the selected task with bounded evidence') {
    return {
      display_name: 'Fixture Skill',
      summary,
      syntax: '$fixture-skill <task>',
      input_kind: 'free-text',
      inputs: [{ id: 'task', syntax: '<task>', value_kind: 'string', required: true, summary: 'Task to trace' }],
      invocation_class: 'implicit-eligible',
      effect_authority: 'read-only',
      actions: [{
        id: 'trace',
        summary: 'Trace the selected task',
        syntax: '$fixture-skill <task>',
        input_kind: 'free-text',
        effect_authority: 'read-only',
      }],
      options: [],
      examples: [{
        prompt: '$fixture-skill OrderService',
        summary: 'Trace a fixture symbol',
      }],
    };
  }

  function inventory(summary) {
    const skill = {
      id: 'fixture',
      name: 'fixture-skill',
      path: 'skills/fixture-skill',
      surfaces: ['codex-native', 'agent-plugin'],
      invocation_class: 'implicit-eligible',
      lifecycle: 'promoted',
      owner: 'dhpk',
      source_fingerprint: 'source-fixture',
      usage: usage(summary),
    };
    return {
      skills: [skill],
      modules: [],
      surface_membership: { 'codex-native': ['fixture'], 'agent-plugin': ['fixture'] },
      projection_contract: {
        schema: 'dhpk.distribution-projection-contract.v1',
        compiler: { id: 'distribution-compiler', version: '1' },
        symlink_policies: ['forbid'],
        surfaces: {
          'codex-native': {
            adapter: 'codex-native',
            owner: 'codex-native',
            symlink_policy: 'forbid',
            verification_stages: ['structural'],
            selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
          },
          'agent-plugin': {
            adapter: 'agent-plugin',
            owner: 'agent-plugin',
            symlink_policy: 'forbid',
            verification_stages: ['structural'],
            selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
          },
        },
      },
      external_skill_packages: [],
    };
  }

  function outputPlan(summary) {
    const sourceSkill = {
      id: 'fixture',
      name: 'fixture-skill',
      invocation_class: 'implicit-eligible',
      lifecycle: 'promoted',
      owner: 'dhpk',
      path: 'skills/fixture-skill',
    };
    const normalized = normalizeSkillUsage({ skill: sourceSkill, usage: usage(summary) });
    return compileDistribution({
      surface: 'agent-plugin',
      inventory: inventory(summary),
      entries: [{
        id: 'skill:fixture:SKILL.md',
        skillId: 'fixture',
        publicName: 'fixture-skill',
        source: 'skills/fixture-skill/SKILL.md',
        destination: 'skills/fixture-skill/SKILL.md',
        owner: 'plugins/dhpk-agent',
        transform: { id: 'fixture', version: '1' },
        content: 'fixture',
        expectedFingerprint: 'fixture-output',
        usage: normalized,
        usageFingerprint: usageFingerprint({ skill: sourceSkill, usage: usage(summary) }),
        provenance: {
          inventoryRevision: 'revision-fixture',
          canonicalSource: 'skills/fixture-skill',
          sourceFingerprint: 'source-fixture',
          owner: 'dhpk',
          transform: { id: 'fixture', version: '1' },
          lifecycle: 'promoted',
          publicName: 'fixture-skill',
          invocationClass: 'implicit-eligible',
        },
      }],
      selectionEntries: [{
        id: 'fixture',
        name: 'fixture-skill',
        skillId: 'fixture',
        source: 'skills/fixture-skill',
        destination: 'skills/fixture-skill',
        usage: normalized,
        usageFingerprint: usageFingerprint({ skill: sourceSkill, usage: usage(summary) }),
      }],
      selectedStableIds: ['fixture'],
      selectionPolicy: { source: 'surface_membership', precedence: ['surface_membership'] },
      inventoryFingerprint: 'inventory-fixture',
      inventoryRevision: 'revision-fixture',
      externalSkillPackagesFingerprint: 'external-fixture',
    });
  }

  test('distribution plans carry normalized usage and usage fingerprint for emitted skills', () => {
    const result = compileDistribution({ inventory: inventory() , surface: 'codex-native' });
    assert.strictEqual(result.ok, true, result.error && result.error.message);
    const entry = result.value.entries[0];
    const expectedUsageFingerprint = '83811e67d594acdc3553a03c29018ea56ae45f932245cdee6f1b0257db22eb74';
    const expectedInventoryRevision = 'sha256:67d1c3842ee1070c2bd59bb1b7c6e8ee00fb1bb5026b63e59d11f961f8d489ab';
    assert.strictEqual(entry.usage.schema, undefined);
    assert.strictEqual(entry.usage.display_name, 'Fixture Skill');
    assert.strictEqual(entry.usage.summary, 'Trace the selected task with bounded evidence');
    assert.strictEqual(entry.usageFingerprint, expectedUsageFingerprint);
    assert.strictEqual(entry.usage.invocation_class, 'implicit-eligible');
    assert.strictEqual(entry.usageSchema, 'dhpk.skill-usage.v1');
    assert.strictEqual(result.value.usageSchema, 'dhpk.skill-usage.v1');
    assert.strictEqual(result.value.usageFingerprints.fixture, expectedUsageFingerprint);
    assert.strictEqual(result.value.inventoryRevision, expectedInventoryRevision);
    assert.strictEqual(entry.provenance.inventoryRevision, expectedInventoryRevision);
  });

  test('usage mutation changes the compiler selection and plan identities', () => {
    const first = compileDistribution({ inventory: inventory(), surface: 'codex-native' });
    const second = compileDistribution({ inventory: inventory('Trace the changed task with bounded evidence'), surface: 'codex-native' });
    assert.strictEqual(first.ok, true, first.error && first.error.message);
    assert.strictEqual(second.ok, true, second.error && second.error.message);
    assert.notStrictEqual(first.value.entries[0].usageFingerprint, second.value.entries[0].usageFingerprint);
    assert.notStrictEqual(first.value.planFingerprint, second.value.planFingerprint);
    assert.notStrictEqual(first.value.selectionFingerprint, second.value.selectionFingerprint);
  });

  test('materialization rejects adapter usage metadata that differs from the accepted plan', () => {
    const compiled = outputPlan();
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    const artifact = materializeDistribution(compiled.value, {
      identity: { id: 'fixture', version: '1' },
      render: () => ({
        outputs: [{
          stableId: 'skill:fixture:SKILL.md',
          destination: 'skills/fixture-skill/SKILL.md',
          content: 'fixture',
          usage: { ...compiled.value.entries[0].usage, summary: 'Trace a different task with bounded evidence' },
          usageFingerprint: 'b'.repeat(64),
          provenance: compiled.value.entries[0].provenance,
        }],
      }),
    }, {
      begin: () => ({
        write: () => {},
        stage: () => ({ outputs: [], links: [], artifactFingerprint: 'artifact-fixture' }),
        abort: () => {},
      }),
    });
    assert.strictEqual(artifact.ok, false);
    assert.match(artifact.error.message, /metadata/i);
  });

  test('projection parity reports usage independently from provenance', () => {
    const compiled = outputPlan();
    assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
    const plan = compiled.value;
    const artifact = {
      planFingerprint: plan.planFingerprint,
      artifactFingerprint: 'artifact-fixture',
      outputs: plan.entries.map((entry) => ({
        stableId: entry.stableId,
        destination: entry.destination,
        usage: entry.usage,
        usageFingerprint: entry.usageFingerprint,
        provenance: entry.provenance,
        expectedFingerprint: entry.expectedFingerprint,
      })),
    };
    const actual = {
      surface: 'agent-plugin',
      plan: {
        ...plan,
        entries: plan.entries.map((entry) => ({ ...entry, usageFingerprint: 'c'.repeat(64) })),
        selectionEntries: plan.selectionEntries.map((entry) => ({ ...entry, usageFingerprint: 'c'.repeat(64) })),
      },
      artifact,
    };
    const result = compareDistributionProjections({
      expected: { surface: 'agent-plugin', plan, artifact },
      actual,
      stage: 'structural',
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.mismatches.some((mismatch) => mismatch.field === 'usageFingerprint'));
    assert.ok(!result.mismatches.some((mismatch) => mismatch.type === 'provenance' || mismatch.field === 'provenance'));
    assert.ok(!result.diagnostics.some((diagnostic) => /provenance/i.test(diagnostic)));
  });
}

run('distribution-projection-contract');
