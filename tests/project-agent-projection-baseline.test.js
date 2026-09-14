'use strict';

// Issue #498 characterization contract.  These tests describe the evidence
// boundary only; they must not cause an installer or projection writer to run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
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
  assert.strictEqual(first.selection.currentAgentPlugin.selectedStableIds.length, FIXTURE.currentSelection.expectedCount);
  assert.deepStrictEqual(first.selection.currentAgentPlugin.selectedStableIds, FIXTURE.currentSelection.selectedStableIds);
  assert.strictEqual(first.selection.currentAgentPlugin.evidenceOnly, FIXTURE.currentSelection.evidenceOnly);
  assert.strictEqual(first.selection.currentAgentPlugin.portableCoreExpansion, FIXTURE.currentSelection.portableCoreExpansion);
  assert.strictEqual(first.selection.currentAgentPlugin.contract, FIXTURE.currentSelection.contract);
  const codex = first.hosts.find((host) => host.host === 'Codex');
  assert.strictEqual(codex.selection.count, FIXTURE.compatibilityMatrix.currentCodexSyncSubset.expectedCount);
  assert.deepStrictEqual(codex.selection.selectedStableIds, FIXTURE.compatibilityMatrix.currentCodexSyncSubset.selectedStableIds);
  assert.strictEqual(first.selection.portableCore.declared, true);
  assert.strictEqual(first.selection.portableCore.profileId, FIXTURE.portableCore.profileId);
  assert.deepStrictEqual(first.selection.portableCore.selectedStableIds, FIXTURE.currentSelection.selectedStableIds);
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
        diagnostics: [`failed at file://${ROOT}/private/config ghp_123456789012345678901234`],
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
  const before = fs.readdirSync(ROOT).sort();
  const baseline = buildBaseline({ root: ROOT, inventory: INVENTORY });
  const after = fs.readdirSync(ROOT).sort();
  assert.deepStrictEqual(after, before);
  const serialized = JSON.stringify(baseline);
  assert.doesNotMatch(serialized, /GH_TOKEN|GITHUB_TOKEN|AWS_SECRET|Authorization/i);
  assert.doesNotMatch(serialized, new RegExp(`${String(process.env.HOME || '/Users/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-projection-baseline-'));
  try {
    const snapshot = fs.readdirSync(tempRoot);
    buildBaseline({ root: tempRoot, inventory: fixtureInventory() });
    assert.deepStrictEqual(fs.readdirSync(tempRoot), snapshot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

run('project-agent-projection-baseline');
