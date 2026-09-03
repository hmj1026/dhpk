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
    surface: 'agent-plugin',
    entries: [{ id: 'same', path: 'skills/a' }, { id: 'same', path: 'skills/b' }],
  });
  assert.strictEqual(duplicate.ok, false);
  assert.strictEqual(duplicate.error.code, 'DUPLICATE_STABLE_ID');

  const invalidLink = compileDistribution({
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

run('distribution-projection-contract');
