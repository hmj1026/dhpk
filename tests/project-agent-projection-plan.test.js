'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  compileDistribution,
  compileProjectAgentProjection,
  validateProjectAgentProjection,
} = require('../scripts/lib/distribution-compiler');
const { preserveProjectionContract } = require('../scripts/lib/distribution-inventory');
const { fingerprint } = require('../scripts/lib/distribution-projection-contract');
const { resolveInventoryRevision } = require('../scripts/lib/skill-usage');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'project-agent-projection-plan.json');

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compile(inventory = fixture(), options = {}) {
  return compileProjectAgentProjection({
    inventory,
    profileId: 'portable-core',
    requestedHosts: ['agy', 'cursor', 'codex', 'claude'],
    ...options,
  });
}

test('checked-in portable-core plan is explicit, deterministic, and does not write files', () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const first = compile(source);
  const second = compile(clone(source));

  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.deepStrictEqual(first.value.selectedStableIds, ['portable-b']);
  assert.deepStrictEqual(first.value.emittedStableIds, ['portable-b', 'runtime-support']);
  assert.deepStrictEqual(first.value.dependencyClosure.stableIds, ['portable-b', 'runtime-support']);
  assert.deepStrictEqual(first.value.dependencyClosure.supportingAssetIds, ['portable-manifest']);
  assert.deepStrictEqual(first.value.writes, []);
  assert.strictEqual(first.value.planFingerprint, second.value.planFingerprint);
  assert.strictEqual(JSON.stringify(source), before);
  assert.ok(Object.isFrozen(first.value));
  assert.ok(Object.isFrozen(first.value.dependencyClosure));
  assert.ok(Object.isFrozen(first.value.hostBindings));
});

test('portable-core is not inferred from minimal or the Agent Plugin membership', () => {
  const source = fixture();
  source.profile_policy.profiles.minimal.selection = 'portable-b';
  source.surface_membership['agy-plugin'] = ['portable-a'];
  const compiled = compile(source);

  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['portable-b']);
  assert.deepStrictEqual(compiled.value.skipped.map((entry) => entry.stableId), [
    'codex-only',
    'portable-a',
    'portable-incompatible',
  ]);
  assert.ok(compiled.value.incompatible.some((entry) => entry.stableId === 'portable-b'));
  assert.strictEqual(compiled.value.emittedStableIds.includes('portable-b'), false);
});

test('host evidence filters emissions while preserving selected profile identity', () => {
  const source = fixture();
  source.project_agent_projection.hosts.cursor.surface = 'cursor-sync';
  const compiled = compile(source);

  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['portable-b']);
  assert.deepStrictEqual(compiled.value.emittedStableIds, []);
  const decision = compiled.value.capabilityDecisions.find((entry) => entry.stableId === 'portable-b');
  assert.strictEqual(decision.outcome, 'SKIP_INCOMPATIBLE');
  assert.match(decision.reason, /cursor/);
  assert.ok(compiled.value.incompatible.some((entry) => entry.reasonCode === 'HOST_EVIDENCE_MISSING'));
});

test('runtime support remains selected in dependency closure rather than becoming incompatible', () => {
  const compiled = compile();
  const decision = compiled.value.capabilityDecisions.find((entry) => entry.stableId === 'runtime-support');
  assert.strictEqual(decision.role, 'runtime-support');
  assert.strictEqual(decision.outcome, 'EMIT');
  assert.strictEqual(compiled.value.incompatible.some((entry) => entry.stableId === 'runtime-support'), false);
});

test('declared selectedStableIds emit even when Host surface evidence would skip them', () => {
  const source = fixture();
  source.project_agent_projection.hosts.cursor.surface = 'cursor-sync';
  const compiled = compile(source, {
    requestedHosts: ['cursor'],
    selectedStableIds: ['portable-b'],
    declaredSelection: true,
  });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, ['portable-b']);
  assert.ok(compiled.value.emittedStableIds.includes('portable-b'), JSON.stringify(compiled.value.emittedStableIds));
  assert.deepStrictEqual(compiled.value.hostBindings.cursor.selectedStableIds, ['portable-b']);
});

test('missing profiles and unknown hosts fail closed without substitution', () => {
  const missing = fixture();
  delete missing.project_agent_projection.profiles['portable-core'];
  const missingResult = compile(missing);
  assert.strictEqual(missingResult.ok, false);
  assert.strictEqual(missingResult.error.code, 'INVALID_PROJECT_PROJECTION');

  const unknownHost = compile(fixture(), { requestedHosts: ['claude', 'unknown'] });
  assert.strictEqual(unknownHost.ok, false);
  assert.strictEqual(unknownHost.error.code, 'INVALID_PROJECT_HOST');

  const implicit = compile(fixture(), { profileId: 'minimal' });
  assert.strictEqual(implicit.ok, false);
  assert.strictEqual(implicit.error.code, 'INVALID_PROJECT_PROFILE');
});

test('dependency cycles and missing dependencies fail closed', () => {
  const cycle = fixture();
  cycle.project_agent_projection.dependencies['runtime-support'] = {stable_ids: ['portable-b']};
  const cycleResult = compile(cycle);
  assert.strictEqual(cycleResult.ok, false);
  assert.strictEqual(cycleResult.error.code, 'PROJECT_DEPENDENCY_CYCLE');

  const missing = fixture();
  missing.project_agent_projection.dependencies['portable-b'].stable_ids = ['missing-dependency'];
  const missingResult = compile(missing);
  assert.strictEqual(missingResult.ok, false);
  assert.strictEqual(missingResult.error.code, 'PROJECT_DEPENDENCY_MISSING');
});

test('fingerprints are stable under ordering and change when profile, evidence, or owner changes', () => {
  const base = compile();
  const reordered = compile(fixture(), {requestedHosts: ['claude', 'codex', 'cursor', 'agy']});
  assert.strictEqual(base.value.planFingerprint, reordered.value.planFingerprint);

  const profileChanged = fixture();
  profileChanged.project_agent_projection.profiles['portable-core'].stable_ids = ['portable-a'];
  const profileResult = compile(profileChanged);
  assert.notStrictEqual(profileResult.value.profileFingerprint, base.value.profileFingerprint);
  assert.notStrictEqual(profileResult.value.selectionFingerprint, base.value.selectionFingerprint);

  const evidenceChanged = fixture();
  evidenceChanged.project_agent_projection.hosts.cursor.transform.id = 'cursor-project-skill-v2';
  const evidenceResult = compile(evidenceChanged);
  assert.notStrictEqual(evidenceResult.value.capabilityEvidenceFingerprint, base.value.capabilityEvidenceFingerprint);

  const ownerChanged = fixture();
  ownerChanged.project_agent_projection.owner = 'another-owner';
  const ownerResult = compile(ownerChanged);
  assert.notStrictEqual(ownerResult.value.planFingerprint, base.value.planFingerprint);
});

test('project plan keeps existing Codex selection separate from its explicit profile', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const compiled = compileDistribution({inventory, surface: 'codex-sync'});
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(compiled.value.selectedStableIds, inventory.skills.filter((entry) => entry.surfaces.includes('codex-sync')).map((entry) => entry.id).sort());
  const plan = compileProjectAgentProjection({inventory, profileId: 'portable-core'});
  assert.strictEqual(plan.ok, true, plan.error && plan.error.message);
  assert.ok(!plan.value.selectedStableIds.some((id) => id.startsWith('gitnexus-')));
  assert.ok(plan.value.selectedStableIds.includes('flow-guide'));
  assert.notDeepStrictEqual(plan.value.selectedStableIds, compiled.value.selectedStableIds);
});

test('project policy has its own full fingerprint without invalidating legacy revisions', () => {
  const source = fixture();
  const legacy = clone(source);
  delete legacy.project_agent_projection;
  const compiled = compile(source);

  assert.strictEqual(resolveInventoryRevision(source), resolveInventoryRevision(legacy));
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.strictEqual(compiled.value.inventoryFingerprint, fingerprint(source));
});

test('inventory project projection validator reports malformed ownership and transforms', () => {
  const source = fixture();
  source.project_agent_projection.owner = '';
  source.project_agent_projection.hosts.claude.transform = {id: 'bad'};
  const result = validateProjectAgentProjection(source);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /owner/.test(error)));
  assert.ok(result.errors.some((error) => /transform.version/.test(error)));
});

test('project Host validation fixes the AGY direct-file and directory shape contract', () => {
  const source = fixture();
  source.project_agent_projection.hosts.agy.shape = 'project-skill-directory';
  const result = validateProjectAgentProjection(source);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /hosts\.agy\.shape/.test(error)));

  const directory = fixture();
  directory.project_agent_projection.hosts.cursor.shape = 'directory';
  const directoryResult = validateProjectAgentProjection(directory);
  assert.strictEqual(directoryResult.ok, false);
  assert.ok(directoryResult.errors.some((error) => /hosts\.cursor\.shape/.test(error)));
});

test('project projection rejects root and dot-segment ownership paths', () => {
  const root = fixture();
  root.project_agent_projection.managed_root = '.';
  root.project_agent_projection.receipt = './.dhpk-installed.json';
  const rootResult = validateProjectAgentProjection(root);
  assert.strictEqual(rootResult.ok, false);
  assert.ok(rootResult.errors.some((error) => /managed_root/.test(error)));
  assert.ok(rootResult.errors.some((error) => /receipt/.test(error)));

  const dotSegment = fixture();
  dotSegment.project_agent_projection.managed_root = './.agents/skills';
  const dotResult = validateProjectAgentProjection(dotSegment);
  assert.strictEqual(dotResult.ok, false);
  assert.ok(dotResult.errors.some((error) => /managed_root/.test(error)));

  for (const value of ['C:project', 'unsafe\0path']) {
    const unsafe = fixture();
    unsafe.project_agent_projection.managed_root = value;
    const unsafeResult = validateProjectAgentProjection(unsafe);
    assert.strictEqual(unsafeResult.ok, false, `${JSON.stringify(value)} must fail closed`);
    assert.ok(unsafeResult.errors.some((error) => /managed_root/.test(error)));
  }
});

test('project projection rejects traversal in referenced supporting asset paths', () => {
  for (const [field, value] of [['source', '../secret'], ['destination', '../../out']]) {
    const source = fixture();
    source.supporting_assets[0][field] = value;
    const result = compile(source);
    assert.strictEqual(result.ok, false, `${field} traversal should fail closed`);
    assert.strictEqual(result.error.code, 'INVALID_PROJECT_SUPPORTING_ASSET');
    assert.ok(result.error.details.supportingAssetIds.includes('portable-manifest'));
  }
});

test('inventory regeneration preserves the project projection contract', () => {
  const source = fixture();
  const generated = { schema: 'dhpk.distribution-inventory.v2', skills: [], modules: [] };
  const preserved = preserveProjectionContract(generated, source);
  assert.deepStrictEqual(preserved.project_agent_projection, source.project_agent_projection);
  assert.strictEqual(generated.project_agent_projection, undefined);
});

{
  // F25 source block: project-agent-projection-baseline.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const {
    SCHEMA,
    buildBaseline,
    classifyCapability,
  } = require('../scripts/ci/project-agent-projection-baseline');

  const ROOT = path.join(__dirname, '..');
  const INVENTORY = require('../manifests/distribution-inventory.json');
  const FIXTURE = require('./fixtures/project-agent-projection-baseline.json');

  function fixtureInventory() {
    return {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [
        {
          id: 'portable',
          name: 'dhpk-portable',
          path: 'skills/dhpk-portable',
          lifecycle: 'promoted',
          surfaces: ['claude-core', 'codex-sync', 'cursor-sync', 'agent-plugin', 'agy-plugin'],
        },
        {
          id: 'codex-only',
          name: 'dhpk-codex-only',
          path: 'skills/dhpk-codex-only',
          lifecycle: 'promoted',
          surfaces: ['codex-native'],
        },
        {
          id: 'runtime-only',
          name: 'dhpk-runtime-only',
          path: 'skills/dhpk-runtime-only',
          lifecycle: 'promoted',
          invokable: false,
          surfaces: ['agent-plugin', 'cursor-plugin', 'agy-plugin'],
        },
      ],
      project_agent_projection: {
        schema: 'dhpk.project-agent-projection.v1',
        profiles: {
          'portable-core': {
            stable_ids: ['portable'],
            hosts: ['claude', 'codex', 'cursor', 'agy'],
          },
        },
      },
      platform_matrix: {
        required_surfaces: ['claude-core', 'codex-sync', 'cursor-sync', 'agy-plugin'],
        entries: [],
      },
    };
  }

  test('baseline is deterministic and records the current Agent Plugin set as evidence only', () => {
    const first = buildBaseline({ root: ROOT, inventory: INVENTORY });
    const second = buildBaseline({ root: ROOT, inventory: INVENTORY });

    assert.strictEqual(first.schema, SCHEMA);
    assert.strictEqual(first.schema, FIXTURE.schema);
    assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
    assert.strictEqual(first.selection.currentAgentPlugin.surface, FIXTURE.currentSelection.surface);
    const retainedBaselineIds = FIXTURE.currentSelection.selectedStableIds.filter((id) => !id.startsWith('gitnexus-') && !['harness-govern', 'harness-audit', 'skill-scope', 'session-usage-audit', 'project-setup', 'prompt-optimize', 'opsx-apply-goal'].includes(id));
    assert.deepStrictEqual(first.selection.currentAgentPlugin.selectedStableIds, retainedBaselineIds);
    assert.strictEqual(first.selection.currentAgentPlugin.evidenceOnly, FIXTURE.currentSelection.evidenceOnly);
    assert.strictEqual(first.selection.currentAgentPlugin.portableCoreExpansion, FIXTURE.currentSelection.portableCoreExpansion);
    assert.strictEqual(first.selection.currentAgentPlugin.contract, FIXTURE.currentSelection.contract);
    const codex = first.hosts.find((host) => host.host === 'Codex');
    assert.strictEqual(codex.selection.count, codex.selection.selectedStableIds.length);
    assert.deepStrictEqual(codex.selection.selectedStableIds, FIXTURE.compatibilityMatrix.currentCodexSyncSubset.selectedStableIds.filter((id) => !['harness-govern', 'harness-audit', 'skill-scope'].includes(id)));
    assert.strictEqual(first.selection.portableCore.declared, true);
    assert.strictEqual(first.selection.portableCore.profileId, FIXTURE.portableCore.profileId);
    assert.deepStrictEqual(first.selection.portableCore.selectedStableIds, retainedBaselineIds);
    assert.strictEqual(first.selection.portableCore.evidenceOnly, true);
    assert.match(first.selection.portableCore.reason, /explicit|evidence/i);
  });

  test('baseline distinguishes portable-core from minimal and reports Host-specific/incompatible entries', () => {
    const fixture = fixtureInventory();
    const baseline = buildBaseline({ root: ROOT, inventory: fixture });
    assert.strictEqual(baseline.selection.portableCore.declared, true);
    assert.deepStrictEqual(baseline.selection.portableCore.selectedStableIds, ['portable']);
    assert.strictEqual(baseline.selection.portableCore.profileId, FIXTURE.portableCore.profileId);
    assert.notStrictEqual(baseline.selection.portableCore.profileId, FIXTURE.portableCore.distinctFrom);

    const portable = baseline.capabilityMatrix.entries.find((entry) => entry.stableId === 'portable');
    const hostSpecific = baseline.capabilityMatrix.entries.find((entry) => entry.stableId === 'codex-only');
    const incompatible = baseline.capabilityMatrix.entries.find((entry) => entry.stableId === 'runtime-only');
    assert.ok(portable.classifications.includes('portable-core'));
    assert.ok(hostSpecific.classifications.includes('HOST_SPECIFIC'));
    assert.ok(incompatible.classifications.includes('SKIP_INCOMPATIBLE'));
    assert.strictEqual(classifyCapability(fixture.skills[2], { portableCoreIds: ['portable'] }).status, 'SKIP_INCOMPATIBLE');
    assert.deepStrictEqual(baseline.capabilityMatrix.hosts, FIXTURE.compatibilityMatrix.hosts);
    assert.ok(FIXTURE.compatibilityMatrix.classifications.every((classification) => (
      baseline.capabilityMatrix.entries.some((entry) => entry.classifications.includes(classification))
    )));
  });

  test('baseline characterizes four Hosts without promoting static evidence to runtime support', () => {
    const baseline = buildBaseline({
      root: ROOT,
      inventory: fixtureInventory(),
      runtimeRows: [
        {
          host: 'Codex',
          surface: 'codex',
          status: 'NOT_CONFIGURED',
          evidence: 'NOT_CONFIGURED',
          diagnostics: ['failed at file://' + ROOT + '/private/config ghp_123456789012345678901234'],
        },
        { host: 'Cursor', surface: 'cursor', status: 'UNAVAILABLE', evidence: 'UNAVAILABLE' },
        { host: 'AGY', surface: 'agy', status: 'NOT_RUN', evidence: 'NOT_RUN' },
        { host: 'Claude', surface: 'claude', status: 'BLOCKED', evidence: 'BLOCKED' },
      ],
    });
    assert.deepStrictEqual(baseline.hosts.map((provider) => provider.host), FIXTURE.hosts.map((provider) => provider.host));
    for (const provider of baseline.hosts) {
      const expected = FIXTURE.hosts.find((candidate) => candidate.host === provider.host);
      assert.strictEqual(provider.shape.portable.kind, expected.portableKind);
      assert.strictEqual(provider.shape.native.kind, expected.nativeKind);
      assert.ok(provider.shape && provider.shape.portable);
      assert.ok(provider.output && Object.prototype.hasOwnProperty.call(provider.output, 'path'));
      assert.ok(provider.output && Object.prototype.hasOwnProperty.call(provider.output, 'fingerprint'));
      assert.ok(provider.receipt && Object.prototype.hasOwnProperty.call(provider.receipt, 'path'));
      assert.ok(Array.isArray(provider.diagnostics));
      assert.ok(provider.exit && Object.prototype.hasOwnProperty.call(provider.exit, 'code'));
      assert.notStrictEqual(provider.runtime.status, 'PASS');
    }
    assert.strictEqual(baseline.hosts.find((provider) => provider.host === 'AGY').shape.portable.kind, 'direct-file');
    const codex = baseline.hosts.find((provider) => provider.host === 'Codex');
    assert.doesNotMatch(JSON.stringify(codex), /ghp_123456789012345678901234|\/private\/config|\/Users\//i);
  });

  test('baseline is read-only and excludes private environment data', () => {
    const baseline = buildBaseline({ root: ROOT, inventory: INVENTORY });
    const serialized = JSON.stringify(baseline);
    assert.doesNotMatch(serialized, /GH_TOKEN|GITHUB_TOKEN|AWS_SECRET|Authorization/i);
    assert.doesNotMatch(serialized, new RegExp(String(process.env.HOME || '/Users/').replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')));

    // Other suites create short-lived entries under ROOT in parallel CI workers;
    // verify read-only behavior against an isolated root instead of that shared directory.
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-projection-baseline-'));
    try {
      const snapshot = fs.readdirSync(tempRoot);
      buildBaseline({ root: tempRoot, inventory: fixtureInventory() });
      assert.deepStrictEqual(fs.readdirSync(tempRoot), snapshot);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

run('project-agent-projection-plan');
