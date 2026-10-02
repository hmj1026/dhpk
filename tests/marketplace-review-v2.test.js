'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  marketplaceReviewBlockers,
  validateSkillPurposeDecisions,
} = require('../scripts/lib/skill-purpose-decisions');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'skill-purpose-decisions.json'), 'utf8'));
const SKILLS = new Map(INVENTORY.skills.map((skill) => [skill.id, skill]));
const PASS_TEST = Object.freeze({ source: 'tests/skill-purpose-decisions.test.js', status: 'PASS' });
const PASS_DOC = Object.freeze({ source: 'docs/adr/0024-current-plugin-distribution-and-unique-discovery.md', status: 'PASS' });
const LICENSE_DOC = 'docs/contracts/marketplace-licensing.md';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutMarketplaceReview(ledger) {
  const legacyLedger = clone(ledger);
  delete legacyLedger.marketplace_review;
  return legacyLedger;
}

// Every active ID as a common entry with PASS evidence; individual tests then
// reshape the rows they exercise.
function createReviewV2() {
  const decisionsById = new Map(LEDGER.decisions.map((row) => [row.id, row]));
  const externalIds = new Set((INVENTORY.external_skill_packages || []).flatMap((item) => item.stable_ids || []));
  return {
    version: 'dhpk.marketplace-review.v2',
    rows: INVENTORY.skills.map((skill) => ({
      id: skill.id,
      kind: 'entry',
      owner_id: skill.id,
      selection: 'common',
      task_selector: skill.id,
      version_condition: 'all-supported',
      resources: [`${skill.path}/SKILL.md`],
      test_evidence: { ...PASS_TEST },
      authority: decisionsById.get(skill.id).authority,
      license: { status: externalIds.has(skill.id) ? 'approved' : 'first-party', evidence: LICENSE_DOC },
    })),
  };
}

function rowOf(review, id) {
  return review.rows.find((row) => row.id === id);
}

function validate(review, { ledger = LEDGER, root = ROOT } = {}) {
  return validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: { ...ledger, marketplace_review: review }, root });
}

function hostOnly(row, groups) {
  row.selection = 'host-only';
  row.host_selection = groups.map(([surfaces, selectionId]) => ({
    surfaces,
    selection_id: selectionId,
    purpose_evidence: { ...PASS_DOC },
    execution_evidence: { ...PASS_TEST },
  }));
}

function makeChild(review, id, kind, owner) {
  const row = rowOf(review, id);
  Object.assign(row, { kind, owner_id: owner, behavior_successor: { ...PASS_DOC } });
  return row;
}

function withdraw(review, id, owner) {
  const row = rowOf(review, id);
  for (const key of Object.keys(row)) {
    if (!['id', 'authority', 'license'].includes(key)) delete row[key];
  }
  Object.assign(row, { kind: 'withdrawn', upstream_owner: 'gitnexus' });
  row.license.status = 'excluded';
  if (owner) Object.assign(row, { owner_id: owner, behavior_successor: { ...PASS_DOC } });
  return row;
}

function expectError(change, pattern, options) {
  const review = createReviewV2();
  change(review);
  const result = validate(review, options);
  assert.strictEqual(result.ok, false, `expected failure for ${pattern}`);
  assert.ok(result.errors.some((error) => pattern.test(error)), result.errors.join('\n'));
}

function expectPass(change, options) {
  const review = createReviewV2();
  change(review);
  const result = validate(review, options);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  return result;
}

test('v2 baseline passes and preserves legacy effective and retirement results', () => {
  const legacy = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: withoutMarketplaceReview(LEDGER), root: ROOT });
  const result = expectPass(() => {});
  assert.deepStrictEqual(Object.keys(result).sort(), Object.keys(legacy).sort());
  assert.strictEqual(JSON.stringify({ effective: result.effective, retirements: result.retirements }),
    JSON.stringify({ effective: legacy.effective, retirements: legacy.retirements }));
  expectError((review) => { review.rows.pop(); }, /marketplace_review.*84/);
  expectError((review) => { review.version = 'dhpk.marketplace-review.v3'; }, /marketplace_review.*version/);
});

test('v1 review still rejects v2-only content', () => {
  const v1 = (change) => expectError((review) => { review.version = 'dhpk.marketplace-review.v1'; change(review); }, /fastapi-pro/);
  v1(() => {});
  v1((review) => { rowOf(review, 'fastapi-pro').upstream_owner = 'gitnexus'; delete rowOf(review, 'fastapi-pro').selection; });
});

test('v2 selection is required, closed, and forbidden on withdrawn rows', () => {
  expectError((review) => { delete rowOf(review, 'fastapi-pro').selection; }, /fastapi-pro.*selection/);
  expectError((review) => { rowOf(review, 'fastapi-pro').selection = 'excluded'; }, /fastapi-pro.*selection/);
  expectError((review) => { withdraw(review, 'gitnexus-cli').selection = 'common'; }, /gitnexus-cli.*selection/);
});

test('v2 owners must match selection and common rows cannot use host-only owners', () => {
  expectError((review) => {
    hostOnly(rowOf(review, 'harness-govern'), [[SKILLS.get('harness-govern').surfaces, 'host:harness-govern']]);
    makeChild(review, 'fastapi-pro', 'reference', 'harness-govern');
  }, /fastapi-pro.*owner.*selection/);
  expectError((review) => {
    makeChild(review, 'fastapi-pro', 'reference', 'flow-drive').selection = 'host-only';
  }, /fastapi-pro.*owner.*selection/);
  expectError((review) => {
    hostOnly(rowOf(review, 'codex-bridge'), [[SKILLS.get('codex-bridge').surfaces, 'host:codex-bridge']]);
    const row = makeChild(review, 'cli-transport', 'internal', ['codex-bridge', 'flow-guide']);
    row.selection = 'host-only';
  }, /cli-transport.*owner.*selection/);
});

test('v2 host-only entries declare complete disjoint per-surface selections', () => {
  const surfaces = SKILLS.get('harness-govern').surfaces;
  const split = [[['claude-core', 'cursor-sync'], 'host:harness-govern:claude'],
    [['codex-sync', 'codex-native'], 'host:harness-govern:codex']];
  assert.deepStrictEqual([...surfaces].sort(), split.flatMap(([items]) => items).sort());
  expectPass((review) => { hostOnly(rowOf(review, 'harness-govern'), split); });

  const host = (change, pattern) => expectError((review) => {
    const row = rowOf(review, 'harness-govern');
    hostOnly(row, split);
    change(row, review);
  }, pattern);
  host((row) => { delete row.host_selection; }, /harness-govern.*host_selection/);
  host((row) => { row.host_selection = []; }, /harness-govern.*host_selection/);
  host((row) => { row.host_selection[0].selection_id = ' '; }, /harness-govern.*selection_id/);
  host((row) => { row.host_selection[1].selection_id = row.host_selection[0].selection_id; }, /harness-govern.*selection_id.*duplicate/);
  host((row) => { row.host_selection[0].surfaces.push('agy-plugin'); }, /harness-govern.*surface.*agy-plugin/);
  host((row) => { row.host_selection[1].surfaces.push('claude-core'); }, /harness-govern.*surface.*claude-core/);
  host((row) => { row.host_selection[1].surfaces = ['codex-sync']; }, /harness-govern.*codex-native/);
  host((row) => { row.host_selection[0].surfaces = []; }, /harness-govern.*surfaces/);
  host((row) => { row.host_selection[0].purpose_evidence.status = 'NOT_RUN'; }, /harness-govern.*purpose_evidence/);
  host((row) => { row.host_selection[0].execution_evidence.source = LICENSE_DOC; }, /harness-govern.*execution_evidence.*tests/);
  host((row) => { row.host_selection[0].execution_evidence = { status: 'GAP' }; }, /harness-govern.*execution_evidence.*reason/);
  host((row) => { row.host_selection[0].extra = true; }, /harness-govern.*extra.*not allowed/);
  expectError((review) => {
    rowOf(review, 'flow-drive').host_selection = [{ surfaces: ['claude-core'], selection_id: 'x',
      purpose_evidence: { ...PASS_DOC }, execution_evidence: { ...PASS_TEST } }];
  }, /flow-drive.*host_selection/);
  expectError((review) => {
    hostOnly(rowOf(review, 'harness-govern'), split);
    const row = makeChild(review, 'skill-forge', 'reference', 'harness-govern');
    hostOnly(row, [[SKILLS.get('skill-forge').surfaces, 'host:skill-forge']]);
  }, /skill-forge.*host_selection/);
});

test('v2 internal rows may name several entry owners and others may not', () => {
  const internal = (review) => {
    for (const id of ['codex-bridge', 'agy-fast-worker']) {
      hostOnly(rowOf(review, id), [[SKILLS.get(id).surfaces, `host:${id}`]]);
    }
    const row = makeChild(review, 'cli-transport', 'internal', ['codex-bridge', 'agy-fast-worker']);
    row.selection = 'host-only';
    return row;
  };
  expectPass((review) => {
    const row = internal(review);
    row.resources = ['skills/dhpk-agy-fast-worker/SKILL.md'];
  });
  expectError((review) => { internal(review).owner_id = []; }, /cli-transport.*owner_id/);
  expectError((review) => { internal(review).owner_id = ['codex-bridge', 'codex-bridge']; }, /cli-transport.*owner_id.*duplicate/);
  expectError((review) => { internal(review).owner_id = ['codex-bridge', 'fastapi-pro']; makeChild(review, 'fastapi-pro', 'reference', 'flow-drive'); },
    /cli-transport.*owner_id.*entry/);
  expectError((review) => { makeChild(review, 'fastapi-pro', 'reference', ['flow-drive']); }, /fastapi-pro.*owner_id/);
  expectError((review) => { rowOf(review, 'flow-drive').owner_id = ['flow-drive']; }, /flow-drive.*owner_id/);
});

test('v2 owner authority must dominate child authority and fails closed on unknown values', () => {
  expectPass((review) => { makeChild(review, 'fastapi-pro', 'reference', 'flow-drive'); });
  expectError((review) => { makeChild(review, 'precommit', 'branch', 'repo-verify'); }, /precommit.*authority.*repo-verify/);
  const raised = clone(LEDGER);
  raised.decisions.find((item) => item.id === 'cli-transport').authority = 'workspace-write';
  expectError((review) => {
    for (const id of ['codex-bridge', 'precommit']) {
      hostOnly(rowOf(review, id), [[SKILLS.get(id).surfaces, `host:${id}`]]);
    }
    const row = makeChild(review, 'cli-transport', 'internal', ['codex-bridge', 'precommit']);
    row.selection = 'host-only';
    row.authority = 'workspace-write';
  }, /cli-transport.*authority.*codex-bridge/, { ledger: raised });
  const ledger = clone(LEDGER);
  for (const row of ledger.decisions.filter((item) => ['fastapi-pro', 'flow-drive'].includes(item.id))) {
    row.authority = 'root-write';
  }
  const review = createReviewV2();
  makeChild(review, 'fastapi-pro', 'reference', 'flow-drive');
  rowOf(review, 'fastapi-pro').authority = 'root-write';
  rowOf(review, 'flow-drive').authority = 'root-write';
  const result = validate(review, { ledger });
  assert.ok(result.errors.some((error) => /fastapi-pro.*authority.*root-write.*(unknown|rank)/.test(error)), result.errors.join('\n'));
});

test('v2 resources accept optional entries but keep containment ownership and non-empty rules', () => {
  expectPass((review) => {
    rowOf(review, 'fastapi-pro').resources.push({ path: 'skills/dhpk-fastapi-pro/agents/openai.yaml', optional: true });
  });
  const res = (resources, pattern) => expectError((review) => { rowOf(review, 'fastapi-pro').resources = resources; }, pattern);
  res(['skills/dhpk-fastapi-pro/SKILL.md', { path: 'skills/dhpk-fastapi-pro/SKILL.md', optional: true }], /fastapi-pro.*resources.*duplicate/);
  res([{ path: 'skills/dhpk-fastapi-pro/SKILL.md', optional: false }], /fastapi-pro.*resources.*optional/);
  res([{ path: 'skills/dhpk-fastapi-pro/SKILL.md', optional: true, note: 'x' }], /fastapi-pro.*resources.*note.*not allowed/);
  res([{ optional: true }], /fastapi-pro.*resources/);
  res([{ path: '../outside.md', optional: true }], /fastapi-pro.*resources.*unsafe/);
  res([{ path: 'skills/flow-drive/SKILL.md', optional: true }], /fastapi-pro.*resources.*owned/);
  expectError((review) => {
    makeChild(review, 'fastapi-pro', 'reference', 'flow-drive').resources = [
      { path: 'skills/dhpk-fastapi-pro/SKILL.md', optional: true }];
  }, /fastapi-pro.*resources.*non-empty|fastapi-pro.*resources.*required/);
});

test('v2 withdrawn rows record upstream ownership and optional partial successors', () => {
  expectPass((review) => {
    withdraw(review, 'gitnexus-cli');
    withdraw(review, 'gitnexus-debugging', 'code-trace');
  });
  expectError((review) => { withdraw(review, 'fastapi-pro'); }, /fastapi-pro.*withdrawn.*external/);
  for (const value of [undefined, ' ', 'dhpk']) {
    expectError((review) => {
      const row = withdraw(review, 'gitnexus-cli');
      if (value === undefined) delete row.upstream_owner; else row.upstream_owner = value;
    }, /gitnexus-cli.*upstream_owner/);
  }
  expectError((review) => { withdraw(review, 'gitnexus-cli').license.status = 'approved'; }, /gitnexus-cli.*license.*excluded/);
  expectError((review) => { withdraw(review, 'gitnexus-cli').resources = ['skills/dhpk-gitnexus-cli/SKILL.md']; },
    /gitnexus-cli.*resources.*not allowed/);
  expectError((review) => { withdraw(review, 'gitnexus-cli').test_evidence = { ...PASS_TEST }; }, /gitnexus-cli.*test_evidence.*not allowed/);
  expectError((review) => { delete withdraw(review, 'gitnexus-cli', 'code-trace').behavior_successor; },
    /gitnexus-cli.*behavior_successor/);
  expectError((review) => { withdraw(review, 'gitnexus-cli').behavior_successor = { ...PASS_DOC }; }, /gitnexus-cli.*behavior_successor/);
  expectError((review) => {
    makeChild(review, 'fastapi-pro', 'reference', 'flow-drive');
    withdraw(review, 'gitnexus-cli', 'fastapi-pro');
  }, /gitnexus-cli.*owner_id.*entry/);
  expectError((review) => { rowOf(review, 'fastapi-pro').upstream_owner = 'gitnexus'; }, /fastapi-pro.*upstream_owner.*not allowed/);
});

test('v2 test evidence GAP is valid but reported as a release blocker', () => {
  const review = createReviewV2();
  rowOf(review, 'fastapi-pro').test_evidence = { status: 'GAP', reason: 'no behavioral test yet' };
  hostOnly(rowOf(review, 'harness-govern'), [[SKILLS.get('harness-govern').surfaces, 'host:harness-govern']]);
  rowOf(review, 'harness-govern').host_selection[0].execution_evidence = { status: 'GAP', reason: 'no host probe yet' };
  makeChild(review, 'php-pro', 'branch', 'flow-drive').license.status = 'unresolved';
  assert.deepStrictEqual(validate(review).errors, []);
  const blockers = marketplaceReviewBlockers({ ledger: { ...LEDGER, marketplace_review: review } });
  assert.ok(Object.isFrozen(blockers));
  assert.deepStrictEqual(blockers.map(({ id, field }) => `${id}:${field}`).sort(), [
    'fastapi-pro:test_evidence', 'harness-govern:host_selection[0].execution_evidence', 'php-pro:license',
  ]);
  assert.ok(blockers.every((item) => typeof item.reason === 'string' && item.reason.length > 0));
  assert.deepStrictEqual(marketplaceReviewBlockers({ ledger: withoutMarketplaceReview(LEDGER) }), []);

  expectError((r) => { rowOf(r, 'fastapi-pro').test_evidence = { status: 'GAP' }; }, /fastapi-pro.*test_evidence.*reason/);
  expectError((r) => { rowOf(r, 'fastapi-pro').test_evidence = { status: 'GAP', reason: 'x', source: 'tests/a.test.js' }; },
    /fastapi-pro.*test_evidence.*source.*not allowed/);
  expectError((r) => { rowOf(r, 'fastapi-pro').test_evidence = { ...PASS_TEST, status: 'NOT_RUN' }; }, /fastapi-pro.*test_evidence/);
  expectError((r) => { rowOf(r, 'fastapi-pro').test_evidence.source = LICENSE_DOC; }, /fastapi-pro.*test_evidence.*tests/);
});

test('v2 rejects symlink escapes for optional resources', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-marketplace-review-v2-'));
  const root = path.join(tmp, 'repo');
  try {
    const files = new Set([LEDGER.baseline.path, PASS_TEST.source, PASS_DOC.source, LICENSE_DOC,
      ...INVENTORY.skills.map((skill) => `${skill.path}/SKILL.md`),
      ...[...LEDGER.decisions, ...LEDGER.retirements].flatMap((row) => row.callers),
      ...(LEDGER.additions || []).map((row) => row.source)]);
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
    }
    assert.deepStrictEqual(validate(createReviewV2(), { root }).errors, []);
    const outside = path.join(tmp, 'outside.md');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(root, 'skills/dhpk-fastapi-pro/escape.md'));
    const review = createReviewV2();
    rowOf(review, 'fastapi-pro').resources.push({ path: 'skills/dhpk-fastapi-pro/escape.md', optional: true });
    const result = validate(review, { root });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /fastapi-pro.*resources.*contained/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('marketplace-review-v2');
