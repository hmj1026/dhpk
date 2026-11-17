'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const policy = require('../scripts/lib/project-agent-host-binding-policy');

const V3 = 'dhpk.project-agent-projection-receipt.v3';
const DIGEST = 'a'.repeat(64);

function selected(...pairs) {
  return pairs.map(([stableId, name]) => ({ stableId, name }));
}

function enabledProvision(identities, overrides = {}) {
  return {
    schema: 'dhpk.claude-plugin-provision.v1',
    status: 'ENABLED',
    source: 'claude-plugin-list',
    pluginId: 'dhpk@dhpk',
    pluginVersion: '1.0.0',
    catalogDigest: DIGEST,
    providedIdentities: identities,
    ...overrides,
  };
}

function descriptor(ids) {
  return {
    schema: 'dhpk.claude-plugin-provision.v1',
    status: 'ENABLED',
    pluginId: 'dhpk@dhpk',
    pluginVersion: '1.0.0',
    catalogDigest: DIGEST,
    pluginProvidedStableIds: ids,
  };
}

function previousReceiptWith(ids, extra = {}) {
  return {
    schema: V3,
    entries: [
      { stableId: 'tdd', name: 'tdd-workflow', ...(ids.includes('tdd') ? { claudePluginProvided: true } : {}) },
      { stableId: 'local-only', name: 'local-only', ...(ids.includes('local-only') ? { claudePluginProvided: true } : {}) },
    ],
    hostBindings: {
      claude: {
        emittedStableIds: ['local-only', 'tdd'],
        selectedStableIds: ['local-only', 'tdd'],
        ...(ids.length > 0 ? { pluginProvision: descriptor(ids) } : {}),
      },
    },
    ...extra,
  };
}

const SELECTION = selected(['tdd', 'tdd-workflow'], ['local-only', 'local-only']);

test('testPlan_enabledProvidedId_withdrawn', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: enabledProvision([{ stableId: 'tdd', name: 'tdd-workflow' }]),
    previousReceipt: null,
    claudeSelectedEntries: SELECTION,
  });
  assert.strictEqual(plan.mode, 'observed');
  assert.deepStrictEqual(plan.withdrawnStableIds, ['tdd']);
  assert.strictEqual(plan.guardNewActivation, false);
  assert.deepStrictEqual(plan.descriptor, descriptor(['tdd']));
});

test('testPlan_enabledNotProvided_published', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: enabledProvision([{ stableId: 'something-else', name: 'something-else' }]),
    previousReceipt: null,
    claudeSelectedEntries: SELECTION,
  });
  assert.deepStrictEqual(plan.withdrawnStableIds, []);
  assert.strictEqual(plan.descriptor, null);
});

test('testPlan_moduleEntityNeverWithdrawn', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: enabledProvision([{ stableId: 'tdd', name: 'tdd-workflow' }]),
    previousReceipt: null,
    claudeSelectedEntries: [{ entityKind: 'module', stableId: 'tdd', name: 'tdd-workflow' }],
  });
  assert.deepStrictEqual(plan.withdrawnStableIds, []);
});

test('testPlan_sameNameDifferentIdentity_publishedAndReported', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: enabledProvision([{ stableId: 'other-id', name: 'tdd-workflow' }]),
    previousReceipt: null,
    claudeSelectedEntries: SELECTION,
  });
  assert.deepStrictEqual(plan.withdrawnStableIds, []);
  assert.strictEqual(plan.conflicts.length, 1);
  assert.strictEqual(plan.conflicts[0].reason, 'SAME_NAME_DIFFERENT_IDENTITY');
  assert.strictEqual(plan.conflicts[0].name, 'tdd-workflow');
});

test('testPlan_pluginNameDiffers_withdrawnAndReportedAsInformational', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: enabledProvision([{ stableId: 'tdd', name: 'tdd-renamed' }]),
    previousReceipt: null,
    claudeSelectedEntries: SELECTION,
  });
  assert.deepStrictEqual(plan.withdrawnStableIds, ['tdd']);
  assert.deepStrictEqual(plan.conflicts.map((conflict) => conflict.reason), ['PLUGIN_NAME_DIFFERS']);
});

test('testPlan_disabledAfterWithdraw_restores', () => {
  for (const status of ['DISABLED', 'NOT_APPLICABLE', 'ABSENT', 'INACTIVE']) {
    const plan = policy.planClaudePluginWithdrawals({
      provision: { status },
      previousReceipt: previousReceiptWith(['tdd']),
      claudeSelectedEntries: SELECTION,
    });
    assert.strictEqual(plan.mode, 'observed', status);
    assert.deepStrictEqual(plan.withdrawnStableIds, [], status);
    assert.strictEqual(plan.descriptor, null, status);
    assert.strictEqual(plan.guardNewActivation, false, status);
  }
});

test('testPlan_omittedProvision_carriesPreviousFlags', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: undefined,
    previousReceipt: previousReceiptWith(['tdd']),
    claudeSelectedEntries: SELECTION,
  });
  assert.strictEqual(plan.mode, 'carry-forward');
  assert.deepStrictEqual(plan.withdrawnStableIds, ['tdd']);
  assert.strictEqual(plan.guardNewActivation, false);
  assert.deepStrictEqual(plan.descriptor, descriptor(['tdd']));
});

test('testPlan_omittedProvision_dropsFlagsForDeselectedIds', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: undefined,
    previousReceipt: previousReceiptWith(['tdd']),
    claudeSelectedEntries: selected(['local-only', 'local-only']),
  });
  assert.deepStrictEqual(plan.withdrawnStableIds, []);
  assert.strictEqual(plan.descriptor, null);
});

test('testPlan_unknown_carriesForwardWithGuard', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: { status: 'UNKNOWN', reason: 'CLAUDE_CLI_FAILED' },
    previousReceipt: previousReceiptWith(['tdd']),
    claudeSelectedEntries: SELECTION,
  });
  assert.strictEqual(plan.mode, 'carry-forward');
  assert.deepStrictEqual(plan.withdrawnStableIds, ['tdd']);
  assert.strictEqual(plan.guardNewActivation, true);
  assert.strictEqual(plan.reason, 'CLAUDE_CLI_FAILED');
});

test('testPlan_cliNotInstalledWithoutPriorWithdrawals_behavesLikeAbsent', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: { status: 'CLI_NOT_INSTALLED' },
    previousReceipt: previousReceiptWith([]),
    claudeSelectedEntries: SELECTION,
  });
  assert.strictEqual(plan.mode, 'observed');
  assert.strictEqual(plan.guardNewActivation, false);
  assert.deepStrictEqual(plan.withdrawnStableIds, []);
});

test('testPlan_cliNotInstalledWithPriorWithdrawals_guards', () => {
  const plan = policy.planClaudePluginWithdrawals({
    provision: { status: 'CLI_NOT_INSTALLED' },
    previousReceipt: previousReceiptWith(['tdd']),
    claudeSelectedEntries: SELECTION,
  });
  assert.strictEqual(plan.mode, 'carry-forward');
  assert.strictEqual(plan.guardNewActivation, true);
  assert.deepStrictEqual(plan.withdrawnStableIds, ['tdd']);
});

test('testClaudeBindingEntries_filtersFlaggedEntries', () => {
  const entries = [
    { stableId: 'a', name: 'a', claudePluginProvided: true },
    { stableId: 'b', name: 'b' },
  ];
  assert.deepStrictEqual(policy.claudeProjectBindingEntries(entries).map((entry) => entry.stableId), ['b']);
  // The flag lives on the source entries; the candidate list may be a derived copy.
  assert.deepStrictEqual(
    policy.claudeProjectBindingEntries([{ stableId: 'a', name: 'a' }, { stableId: 'b', name: 'b' }], entries)
      .map((entry) => entry.stableId),
    ['b'],
  );
});

function validReceipt(ids = ['tdd']) {
  return previousReceiptWith(ids);
}

test('testValidateProvision_validFlagsAndDescriptor_accepted', () => {
  assert.doesNotThrow(() => policy.validateClaudePluginProvision(validReceipt(['tdd'])));
  assert.doesNotThrow(() => policy.validateClaudePluginProvision(validReceipt([])));
});

test('testValidateProvision_flagWithoutDescriptor_rejected', () => {
  const receipt = validReceipt(['tdd']);
  delete receipt.hostBindings.claude.pluginProvision;
  assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
});

test('testValidateProvision_descriptorWithoutFlags_rejected', () => {
  const receipt = validReceipt([]);
  receipt.hostBindings.claude.pluginProvision = descriptor(['tdd']);
  assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
});

test('testValidateProvision_descriptorIdsDisagreeWithFlags_rejected', () => {
  const receipt = validReceipt(['tdd']);
  receipt.hostBindings.claude.pluginProvision = descriptor(['local-only']);
  assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
});

test('testValidateProvision_flagNotTrue_rejected', () => {
  const receipt = validReceipt(['tdd']);
  receipt.entries[0].claudePluginProvided = 'yes';
  assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
});

test('testValidateProvision_flagOutsideClaudeBinding_rejected', () => {
  const receipt = validReceipt(['tdd']);
  receipt.hostBindings.claude.emittedStableIds = ['local-only'];
  receipt.hostBindings.claude.selectedStableIds = ['local-only'];
  assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
});

test('testValidateProvision_malformedDescriptor_rejected', () => {
  for (const mutate of [
    (value) => { value.status = 'DISABLED'; },
    (value) => { value.catalogDigest = 'nope'; },
    (value) => { value.pluginId = 'other@x'; },
    (value) => { value.pluginVersion = ''; },
  ]) {
    const receipt = validReceipt(['tdd']);
    mutate(receipt.hostBindings.claude.pluginProvision);
    assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
  }
});

test('testValidateProvision_legacyReceiptFlags_rejected', () => {
  const receipt = validReceipt(['tdd']);
  receipt.schema = 'dhpk.project-agent-projection-receipt.v2';
  assert.throws(() => policy.validateClaudePluginProvision(receipt), /Claude plugin provision/);
  const unflagged = validReceipt([]);
  unflagged.schema = 'dhpk.project-agent-projection-receipt.v2';
  assert.doesNotThrow(() => policy.validateClaudePluginProvision(unflagged));
});

run('project-agent-host-binding-policy');
