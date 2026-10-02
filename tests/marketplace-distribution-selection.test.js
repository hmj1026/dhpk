'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  compileMarketplaceSelectionCandidate,
  marketplaceReviewBlockers,
  validateSkillPurposeDecisions,
} = require('../scripts/lib/skill-purpose-decisions');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/skill-purpose-decisions.json'), 'utf8'));

const COMMON_ENTRIES = [
  'change-verdict', 'code-trace', 'create-pr', 'dep-audit', 'flow-drive', 'flow-guide',
  'git-smart-commit', 'git-worktree', 'precommit', 'proposal-analyze', 'release-creator',
  'repo-verify', 'tdd', 'ui-ux-verify', 'update-docs',
];
const COMMON_RESOURCES = [
  'agent-architecture-audit', 'code-simplify', 'composer-package-hygiene', 'deploy-list', 'doc-refactor',
  'fastapi-pro', 'feature-verify', 'ios-icon-gen', 'ios-platform', 'issue-analyze', 'js-lint-config',
  'js-static-check-strategy', 'laravel', 'laravel-package-author', 'laravel-testbench-matrix',
  'legacy-code-characterization', 'library-dual-testsuite-map', 'matrix-cell-onboard', 'merge-prep',
  'nextjs-15-5-notes', 'nextjs-16-notes', 'openspec-artifact-guard', 'php-8x-features', 'php-modern-pro',
  'php-pro', 'php56-yii-dev', 'phpunit', 'polyfill-version-matrix-audit', 'pr-summary', 'project-audit',
  'project-brief', 'pytest-async', 'python-pro', 'python-static-checks', 'react-18-notes', 'react-19-notes',
  'repo-intake', 'review-pending', 'software-architecture', 'spec-mine', 'swift-language',
  'swift-test-strategy', 'swiftui-architecture', 'update-codemaps', 'vue-2-notes', 'xcode-build-tooling',
  'yii1-security-audit',
];
const HOST_ENTRIES = [
  'dhpk.host-only.claude.agy-fast-worker|agy-fast-worker|claude-core',
  'dhpk.host-only.claude.codex-bridge|codex-bridge|claude-core',
  'dhpk.host-only.claude.harness-audit|harness-audit|claude-core',
  'dhpk.host-only.claude.harness-govern|harness-govern|claude-core',
  'dhpk.host-only.claude.harness-setup|harness-setup|claude-core',
  'dhpk.host-only.claude.opsx-apply-goal|opsx-apply-goal|claude-core',
  'dhpk.host-only.claude.opsx-apply-resume|opsx-apply-resume|claude-core',
  'dhpk.host-only.claude.opsx-load-context|opsx-load-context|claude-core',
  'dhpk.host-only.claude.opsx-post-obs|opsx-post-obs|claude-core',
  'dhpk.host-only.claude.project-setup|project-setup|claude-core',
  'dhpk.host-only.claude.prompt-optimize|prompt-optimize|claude-core',
  'dhpk.host-only.claude.session-usage-audit|session-usage-audit|claude-core',
  'dhpk.host-only.claude.skill-forge|skill-forge|claude-core',
  'dhpk.host-only.claude.skill-scope|skill-scope|claude-core',
  'dhpk.host-only.codex.harness-audit|harness-audit|codex-native,codex-sync',
  'dhpk.host-only.codex.harness-govern|harness-govern|codex-native,codex-sync',
  'dhpk.host-only.codex.opsx-load-context|opsx-load-context|codex-native,codex-sync',
  'dhpk.host-only.codex.opsx-post-obs|opsx-post-obs|codex-native,codex-sync',
  'dhpk.host-only.codex.skill-scope|skill-scope|codex-native,codex-sync',
  'dhpk.host-only.cursor.agy-fast-worker|agy-fast-worker|cursor-sync',
  'dhpk.host-only.cursor.codex-bridge|codex-bridge|cursor-sync',
  'dhpk.host-only.cursor.harness-audit|harness-audit|cursor-sync',
  'dhpk.host-only.cursor.harness-govern|harness-govern|cursor-sync',
  'dhpk.host-only.cursor.harness-setup|harness-setup|cursor-sync',
  'dhpk.host-only.cursor.opsx-apply-goal|opsx-apply-goal|cursor-sync',
  'dhpk.host-only.cursor.opsx-apply-resume|opsx-apply-resume|cursor-sync',
  'dhpk.host-only.cursor.opsx-load-context|opsx-load-context|cursor-sync',
  'dhpk.host-only.cursor.opsx-post-obs|opsx-post-obs|cursor-sync',
  'dhpk.host-only.cursor.project-setup|project-setup|cursor-sync',
  'dhpk.host-only.cursor.prompt-optimize|prompt-optimize|cursor-sync',
  'dhpk.host-only.cursor.session-usage-audit|session-usage-audit|cursor-sync',
  'dhpk.host-only.cursor.skill-forge|skill-forge|cursor-sync',
  'dhpk.host-only.cursor.skill-scope|skill-scope|cursor-sync',
].map((line) => {
  const [selectionId, id, surfaces] = line.split('|');
  return { id, selectionId, surfaces: surfaces.split(',') };
});
const WITHDRAWN = [
  'gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring', 'gitnexus-guide',
  'gitnexus-impact-analysis', 'gitnexus-refactoring',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function input() {
  return { inventory: clone(INVENTORY), ledger: clone(LEDGER), root: ROOT };
}

function sortedBlockers(blockers) {
  return blockers.map(({ id, field, reason }) => ({ id, field, reason }))
    .sort((left, right) => left.id.localeCompare(right.id)
      || left.field.localeCompare(right.field)
      || left.reason.localeCompare(right.reason));
}

function assertRejected(options, label) {
  let result;
  assert.doesNotThrow(() => { result = compileMarketplaceSelectionCandidate(options); }, label);
  assert.strictEqual(result.ok, false, label);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, label);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'value'), false, label);
}

function assertDeepFrozen(value, visited = new Set()) {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, visited);
}

test('canonical review compiles to the explicit marketplace selection candidate', () => {
  const options = input();
  const result = compileMarketplaceSelectionCandidate(options);
  assert.strictEqual(result.ok, true, result.errors && result.errors.join('\n'));
  const blockers = sortedBlockers(marketplaceReviewBlockers({ ledger: options.ledger }));
  assert.strictEqual(blockers.length, 101);
  assert.deepStrictEqual(result.value, {
    schema: 'dhpk.marketplace-selection-candidate.v1',
    reviewVersion: 'dhpk.marketplace-review.v2',
    common: { entryStableIds: COMMON_ENTRIES, resourceStableIds: COMMON_RESOURCES },
    hostOnly: {
      entries: HOST_ENTRIES,
      resourceStableIds: ['cli-dispatch-context', 'cli-transport'],
    },
    retiredStableIds: INVENTORY.retired_skills.map(({ id }) => id).sort(),
    withdrawnStableIds: WITHDRAWN,
    blockers,
    stages: { catalogApproval: 'NOT_RUN', packageGeneration: 'NOT_RUN', consumerRuntime: 'NOT_RUN' },
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.value, 'fingerprint'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.value, 'releaseReady'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.value, 'intent'), false);
  const selectedIds = [
    ...result.value.common.entryStableIds,
    ...result.value.common.resourceStableIds,
    ...result.value.hostOnly.entries.map(({ id }) => id),
    ...result.value.hostOnly.resourceStableIds,
  ];
  assert.deepStrictEqual(result.value.retiredStableIds.filter((id) => selectedIds.includes(id)), []);
});

test('fixture evidence clears blockers without changing NOT_RUN stage states', () => {
  const options = input();
  const pass = { status: 'PASS', source: 'tests/marketplace-review-v2.test.js' };
  for (const row of options.ledger.marketplace_review.rows) {
    if (row.test_evidence?.status === 'GAP') row.test_evidence = clone(pass);
    for (const selection of row.host_selection || []) {
      if (selection.execution_evidence?.status === 'GAP') selection.execution_evidence = clone(pass);
    }
  }
  const result = compileMarketplaceSelectionCandidate(options);
  assert.strictEqual(result.ok, true, result.errors && result.errors.join('\n'));
  assert.deepStrictEqual(result.value.blockers, []);
  assert.deepStrictEqual(result.value.stages, {
    catalogApproval: 'NOT_RUN', packageGeneration: 'NOT_RUN', consumerRuntime: 'NOT_RUN',
  });
});

test('selection output is deterministic when inventory and review row order changes', () => {
  const original = compileMarketplaceSelectionCandidate(input());
  const reordered = input();
  reordered.inventory.skills.reverse();
  reordered.ledger.marketplace_review.rows.reverse();
  const next = compileMarketplaceSelectionCandidate(reordered);
  assert.strictEqual(original.ok, true, original.errors && original.errors.join('\n'));
  assert.deepStrictEqual(next, original);
});

test('invalid or non-v2 review catalogs fail closed without a candidate', () => {
  const cases = [
    ['missing review', (options) => { delete options.ledger.marketplace_review; }],
    ['v1 review', (options) => { options.ledger.marketplace_review.version = 'dhpk.marketplace-review.v1'; }],
    ['missing review ID', (options) => { options.ledger.marketplace_review.rows.pop(); }],
    ['duplicate review ID', (options) => {
      options.ledger.marketplace_review.rows[1].id = options.ledger.marketplace_review.rows[0].id;
    }],
    ['unknown review ID', (options) => { options.ledger.marketplace_review.rows[0].id = 'not-in-inventory'; }],
    ['invalid owner', (options) => {
      options.ledger.marketplace_review.rows.find((row) => row.id === 'fastapi-pro').owner_id = 'missing-owner';
    }],
    ['invalid authority', (options) => {
      options.ledger.marketplace_review.rows.find((row) => row.id === 'flow-drive').authority = 'unknown-authority';
    }],
  ];
  for (const [label, change] of cases) {
    const options = input();
    change(options);
    assertRejected(options, label);
  }
});

test('duplicate inventory stable IDs or public names fail closed', () => {
  for (const field of ['id', 'name']) {
    const options = input();
    options.inventory.skills[1][field] = options.inventory.skills[0][field];
    assertRejected(options, `duplicate inventory ${field}`);
  }
});

test('malformed option containers and profile, overlay, selection, or typo keys fail closed', () => {
  for (const value of [undefined, null, []]) assertRejected(value, 'malformed options');
  assertRejected({ ledger: clone(LEDGER), root: ROOT }, 'missing inventory');
  assertRejected({ inventory: clone(INVENTORY), root: ROOT }, 'missing ledger');
  for (const key of ['profiles', 'overlays', 'selectedIds', 'invetory']) {
    const options = input();
    options[key] = [];
    assertRejected(options, `unsupported option ${key}`);
  }
});

test('candidate output is detached, deeply frozen, and does not freeze or mutate inputs', () => {
  const options = input();
  const before = JSON.stringify(options);
  const result = compileMarketplaceSelectionCandidate(options);
  assert.strictEqual(result.ok, true, result.errors && result.errors.join('\n'));
  assert.strictEqual(JSON.stringify(options), before);
  assert.strictEqual(Object.isFrozen(options.inventory), false);
  assert.strictEqual(Object.isFrozen(options.ledger.marketplace_review.rows[0]), false);
  assertDeepFrozen(result);
  const candidateBlockers = JSON.stringify(result.value.blockers);
  options.ledger.marketplace_review.rows.length = 0;
  assert.strictEqual(JSON.stringify(result.value.blockers), candidateBlockers);
});

test('legacy purpose validation still resolves a pre-review ledger', () => {
  const legacyLedger = clone(LEDGER);
  delete legacyLedger.marketplace_review;
  const legacy = validateSkillPurposeDecisions({ inventory: clone(INVENTORY), ledger: legacyLedger, root: ROOT });
  assert.strictEqual(legacy.ok, true, legacy.errors.join('\n'));
  assert.deepStrictEqual(legacy.errors, []);
  const flowDrive = legacy.effective.find((decision) => decision.id === 'flow-drive');
  assert.deepStrictEqual(
    [flowDrive.stableId, flowDrive.publicName, flowDrive.outcome, flowDrive.authority],
    ['flow-drive', 'flow-drive', 'retain', 'workspace-write'],
  );
  assert.strictEqual(legacy.retirements.length, 21);
});

run('marketplace-distribution-selection');
