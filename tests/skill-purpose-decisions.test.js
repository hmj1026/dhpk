'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  CONTRACT_VERSION,
  DISPOSITIONS,
  effectiveDecision,
  validateSkillPurposeDecisions,
} = require('../scripts/lib/skill-purpose-decisions');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'skill-purpose-decisions.json'), 'utf8'));

const CURRENT_WAVE_IDS = Object.freeze([
  'laravel-5.4-notes', 'laravel-6-notes', 'laravel-7-notes', 'laravel-8-notes',
  'laravel-9-notes', 'laravel-10-notes', 'laravel-11-notes', 'laravel-mix-notes',
  'phpunit-9-modern', 'phpunit-10-notes', 'phpunit-11-notes', 'claude-health',
  'harness-budget', 'harness-fill', 'harness-revise', 'multi-ai-sync',
  'agy-commit', 'feasibility-study', 'tech-spec', 'create-request', 'op-session',
]);

function createMarketplaceReview() {
  const decisionsById = new Map(LEDGER.decisions.map((row) => [row.id, row]));
  const externalIds = new Set((INVENTORY.external_skill_packages || []).flatMap((item) => item.stable_ids || []));
  return {
    version: 'dhpk.marketplace-review.v1',
    rows: INVENTORY.skills.map((skill) => ({
      id: skill.id,
      kind: 'entry',
      owner_id: skill.id,
      task_selector: skill.id,
      version_condition: 'all-supported',
      resources: [`${skill.path}/SKILL.md`],
      test_evidence: { source: 'tests/skill-purpose-decisions.test.js', status: 'PASS' },
      authority: decisionsById.get(skill.id).authority,
      license: {
        status: externalIds.has(skill.id) ? 'approved' : 'first-party',
        evidence: 'docs/contracts/marketplace-licensing.md',
      },
    })),
  };
}

test('complete marketplace review preserves the legacy effective and retirement results', () => {
  const legacy = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  const ledger = { ...LEDGER, marketplace_review: createMarketplaceReview() };
  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger, root: ROOT });

  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(ledger.marketplace_review.rows.length, 84);
  assert.deepStrictEqual(Object.keys(result).sort(), Object.keys(legacy).sort());
  assert.strictEqual(JSON.stringify({ effective: result.effective, retirements: result.retirements }),
    JSON.stringify({ effective: legacy.effective, retirements: legacy.retirements }));
});

test('marketplace review rejects a missing active stable ID', () => {
  const review = createMarketplaceReview();
  review.rows = review.rows.filter((row) => row.id !== 'fastapi-pro');
  const result = validateSkillPurposeDecisions({
    inventory: INVENTORY,
    ledger: { ...LEDGER, marketplace_review: review },
    root: ROOT,
  });

  assert.ok(result.errors.some((error) => /marketplace_review.*fastapi-pro.*missing|missing.*fastapi-pro/i.test(error)),
    `expected a missing review diagnostic for fastapi-pro, got:\n${result.errors.join('\n')}`);
});

function validateMarketplaceReview(review, inventory = INVENTORY, root = ROOT) {
  return validateSkillPurposeDecisions({ inventory, ledger: { ...LEDGER, marketplace_review: review }, root });
}

function assertReviewDiagnostic(change, pattern) {
  const review = createMarketplaceReview();
  change(review, review.rows.find((row) => row.id === 'fastapi-pro'));
  const result = validateMarketplaceReview(review);
  assert.strictEqual(result.ok, false, 'invalid review must fail closed');
  assert.ok(result.errors.some((error) => pattern.test(error)), result.errors.join('\n'));
}

test('marketplace review supports all five kinds without changing publication or legacy results', () => {
  const review = createMarketplaceReview();
  for (const [id, kind] of [['fastapi-pro', 'reference'], ['flow-drive', 'branch'],
    ['cli-transport', 'internal'], ['gitnexus-cli', 'retired']]) {
    const row = review.rows.find((item) => item.id === id);
    Object.assign(row, { kind, owner_id: 'flow-guide',
      behavior_successor: { source: 'docs/adr/0024-current-plugin-distribution-and-unique-discovery.md', status: 'PASS' } });
    if (kind === 'retired') { row.resources = []; row.license.status = 'excluded'; }
  }
  review.rows.find((row) => row.id === 'fastapi-pro').license.status = 'unresolved';
  const originalInventory = JSON.stringify(INVENTORY);
  const originalLedger = JSON.stringify(LEDGER);
  const result = validateMarketplaceReview(review);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  const legacy = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  assert.deepStrictEqual(result, legacy);
  assert.strictEqual(JSON.stringify(INVENTORY), originalInventory);
  assert.strictEqual(JSON.stringify(LEDGER), originalLedger);
});

test('marketplace review rejects malformed activation and unsupported versions', () => {
  for (const review of [null, [], 'review']) {
    const result = validateMarketplaceReview(review);
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /marketplace_review.*object/);
  }
  assertReviewDiagnostic((review) => { delete review.version; }, /marketplace_review.*version/);
  assertReviewDiagnostic((review) => { review.version = 'dhpk.marketplace-review.v3'; }, /marketplace_review.*version/);
  assertReviewDiagnostic((review) => { review.rows = {}; }, /marketplace_review.*rows.*array/);
});

test('marketplace review rejects duplicate unknown retired and malformed identities', () => {
  assertReviewDiagnostic((review) => { review.rows.push(review.rows[0]); }, /duplicate.*fastapi-pro/);
  for (const id of ['unregistered', 'laravel-5.4-notes', '']) {
    assertReviewDiagnostic((review, row) => { row.id = id; }, /marketplace_review.*(active|id|retired)/);
  }
  assertReviewDiagnostic((review) => { review.rows[0] = null; }, /marketplace_review.*row.*object/);
});

test('marketplace review rejects invalid kinds and missing task or version selectors', () => {
  assertReviewDiagnostic((review, row) => { row.kind = 'standalone'; }, /fastapi-pro.*kind/);
  for (const field of ['task_selector', 'version_condition']) {
    assertReviewDiagnostic((review, row) => { row[field] = ' '; }, new RegExp(`fastapi-pro.*${field}`));
  }
});

test('marketplace review requires self-owned entries and direct entry owners for other kinds', () => {
  assertReviewDiagnostic((review, row) => { row.owner_id = 'unknown'; }, /fastapi-pro.*owner_id/);
  assertReviewDiagnostic((review, row) => { row.owner_id = 'flow-guide'; }, /fastapi-pro.*owner_id/);
  assertReviewDiagnostic((review, row) => {
    row.kind = 'reference'; row.owner_id = 'flow-drive';
    row.behavior_successor = { source: 'docs/adr/0024-current-plugin-distribution-and-unique-discovery.md', status: 'PASS' };
    const owner = review.rows.find((item) => item.id === 'flow-drive');
    owner.kind = 'branch'; owner.owner_id = 'fastapi-pro'; owner.behavior_successor = row.behavior_successor;
  }, /fastapi-pro.*owner_id.*entry/);
});

test('marketplace review requires owned contained existing resource files', () => {
  for (const resource of ['../outside.md', '/tmp/outside.md', 'skills/dhpk-fastapi-pro/../flow-drive/SKILL.md',
    'skills/dhpk-fastapi-pro/not-present.md', 'README.md', 'skills/flow-drive/SKILL.md', 'skills/dhpk-fastapi-pro']) {
    assertReviewDiagnostic((review, row) => { row.resources = [resource]; }, /fastapi-pro.*resources/);
  }
  assertReviewDiagnostic((review, row) => { row.resources.push(row.resources[0]); }, /fastapi-pro.*resources.*duplicate/);
  assertReviewDiagnostic((review, row) => { row.resources = null; }, /fastapi-pro.*resources.*array/);
  for (const kind of ['reference', 'branch', 'internal']) {
    assertReviewDiagnostic((review, row) => {
      row.kind = kind; row.owner_id = 'flow-guide'; row.resources = [];
      row.behavior_successor = { source: 'docs/adr/0024-current-plugin-distribution-and-unique-discovery.md', status: 'PASS' };
    }, /fastapi-pro.*resources.*non-empty/);
  }
});

test('marketplace review accepts resources from its owner and existing inventory declarations', () => {
  const review = createMarketplaceReview();
  const row = review.rows.find((item) => item.id === 'fastapi-pro');
  Object.assign(row, { kind: 'reference', owner_id: 'flow-guide',
    resources: ['skills/flow-guide/SKILL.md', 'skills/laravel/references/6.md',
      'rules/execution-policy.md', 'codex/config.toml.example'],
    behavior_successor: { source: 'docs/adr/0024-current-plugin-distribution-and-unique-discovery.md', status: 'PASS' } });
  assert.deepStrictEqual(validateMarketplaceReview(review).errors, []);
});

test('marketplace review requires PASS successor and test evidence without granting authority', () => {
  for (const kind of ['reference', 'branch', 'internal', 'retired']) {
    assertReviewDiagnostic((review, row) => { row.kind = kind; row.owner_id = 'flow-guide'; }, /fastapi-pro.*behavior_successor/);
  }
  for (const field of ['behavior_successor', 'test_evidence']) {
    for (const evidence of [null, { source: '../outside.md', status: 'PASS' },
      { source: 'docs/missing-evidence.md', status: 'PASS' },
      { source: 'tests/skill-purpose-decisions.test.js', status: 'NOT_RUN' }]) {
      assertReviewDiagnostic((review, row) => { row[field] = evidence; }, new RegExp(`fastapi-pro.*${field}`));
    }
  }
  assertReviewDiagnostic((review, row) => {
    row.test_evidence.source = 'docs/contracts/marketplace-licensing.md';
  }, /fastapi-pro.*test_evidence.*tests/);
  assertReviewDiagnostic((review, row) => { row.authority = 'external-write'; }, /fastapi-pro.*authority/);
});

test('marketplace review records license blockers and protects external ownership', () => {
  for (const status of ['unresolved', 'excluded', 'unknown']) {
    assertReviewDiagnostic((review, row) => { row.license.status = status; }, /fastapi-pro.*license/);
  }
  for (const evidence of ['', '../outside.md', 'docs/missing-license.md']) {
    assertReviewDiagnostic((review, row) => { row.license.evidence = evidence; }, /fastapi-pro.*license/);
  }
  assertReviewDiagnostic((review) => {
    review.rows.find((row) => row.id === 'gitnexus-cli').license.status = 'first-party';
  }, /gitnexus-cli.*license.*external/);
});

test('marketplace review uses closed schemas separate from inventory publication facts', () => {
  assertReviewDiagnostic((review) => { review.selection = []; }, /marketplace_review.*selection.*not allowed/);
  for (const field of ['path', 'publicName', 'surfaces', 'successor']) {
    assertReviewDiagnostic((review, row) => { row[field] = 'invented'; }, new RegExp(`fastapi-pro.*${field}.*not allowed`));
  }
  for (const field of ['behavior_successor', 'test_evidence', 'license']) {
    assertReviewDiagnostic((review, row) => {
      row.behavior_successor = { source: 'docs/adr/0024-current-plugin-distribution-and-unique-discovery.md', status: 'PASS' };
      row[field].unexpected = true;
    }, new RegExp(`fastapi-pro.*${field}.*unexpected.*not allowed`));
  }
});

test('marketplace review rejects symlink escapes in resources and evidence at the public seam', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-marketplace-review-'));
  const root = path.join(tmp, 'repo');
  try {
    const files = new Set([LEDGER.baseline.path, 'tests/skill-purpose-decisions.test.js',
      'docs/contracts/marketplace-licensing.md',
      ...INVENTORY.skills.map((skill) => `${skill.path}/SKILL.md`),
      ...[...LEDGER.decisions, ...LEDGER.retirements].flatMap((row) => row.callers),
      ...(LEDGER.additions || []).map((row) => row.source)]);
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
    }
    assert.deepStrictEqual(validateMarketplaceReview(createMarketplaceReview(), INVENTORY, root).errors, []);
    const outside = path.join(tmp, 'outside.md');
    fs.writeFileSync(outside, 'outside evidence');
    for (const [field, file] of [['resources', 'skills/dhpk-fastapi-pro/escape.md'],
      ['test_evidence', 'tests/escape.test.js'], ['license', 'docs/escape.md']]) {
      fs.symlinkSync(outside, path.join(root, file));
      const review = createMarketplaceReview();
      const row = review.rows.find((item) => item.id === 'fastapi-pro');
      if (field === 'resources') row.resources = [file];
      else if (field === 'license') row.license.evidence = file;
      else row.test_evidence.source = file;
      const result = validateMarketplaceReview(review, INVENTORY, root);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.errors.length, 1, result.errors.join('\n'));
      assert.match(result.errors[0], new RegExp(`fastapi-pro.*${field}.*contained`));
    }
    for (const [field, file, target] of [
      ['resources', 'skills/dhpk-fastapi-pro/other-owner.md', 'skills/flow-drive/SKILL.md'],
      ['test_evidence', 'tests/non-test.js', 'docs/contracts/marketplace-licensing.md'],
    ]) {
      fs.symlinkSync(path.join(root, target), path.join(root, file));
      const review = createMarketplaceReview();
      const row = review.rows.find((item) => item.id === 'fastapi-pro');
      if (field === 'resources') row.resources = [file];
      else row.test_evidence.source = file;
      const result = validateMarketplaceReview(review, INVENTORY, root);
      assert.strictEqual(result.ok, false, `${field} cannot disguise an unowned physical file`);
      assert.strictEqual(result.errors.length, 1, result.errors.join('\n'));
      assert.match(result.errors[0], new RegExp(`fastapi-pro.*${field}.*(owned|tests)`));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('purpose ledger covers the current baseline and resolves every decision contract', () => {
  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.effective.length, INVENTORY.skills.length);
  assert.ok(result.effective.every((decision) => DISPOSITIONS.includes(decision.disposition)));
  assert.ok(result.effective.every((decision) => decision.task.source === 'skill.frontmatter.description'));
  assert.ok(result.effective.every((decision) => decision.authority));
  assert.ok(result.effective.every((decision) => typeof decision.independentUse === 'boolean'));
  assert.ok(result.effective.every((decision) => decision.successor));
  assert.ok(result.effective.every((decision) => decision.compatibility.includes('stable-id-preserved')));
});

test('purpose decisions preserve family, internal, and external ownership boundaries', () => {
  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  const byId = new Map(result.effective.map((decision) => [decision.id, decision]));
  assert.strictEqual(byId.get('laravel').disposition, 'retain-family');
  assert.strictEqual(byId.get('laravel').family, 'laravel');
  assert.strictEqual(byId.get('phpunit').family, 'phpunit');
  assert.strictEqual(byId.get('cli-transport').disposition, 'retain-internal');
  assert.strictEqual(byId.get('cli-transport').independentUse, false);
  assert.strictEqual(byId.get('gitnexus-cli').disposition, 'retain-external');
  assert.strictEqual(byId.get('gitnexus-cli').owner, 'gitnexus');
});

test('purpose validator rejects missing rows, identity drift, and unowned internal decisions', () => {
  const missing = { ...LEDGER, decisions: LEDGER.decisions.slice(1) };
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: missing, root: ROOT }).errors.some((error) => /missing decision.*fastapi-pro/i.test(error)));

  const drift = JSON.parse(JSON.stringify(LEDGER));
  drift.decisions[0] = { ...drift.decisions[0], publicName: 'wrong-public-name' };
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: drift, root: ROOT }).errors.some((error) => /publicName.*fastapi-pro|fastapi-pro.*publicName/i.test(error)));

  const unowned = JSON.parse(JSON.stringify(LEDGER));
  const row = unowned.decisions.find((decision) => decision.id === 'cli-transport');
  row.disposition = 'retain-standalone';
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: unowned, root: ROOT }).errors.some((error) => /cli-transport.*internal|internal.*cli-transport/i.test(error)));

  const wrongOwner = JSON.parse(JSON.stringify(LEDGER));
  const external = wrongOwner.decisions.find((decision) => decision.id === 'gitnexus-cli');
  external.owner = 'dhpk';
  assert.ok(validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: wrongOwner, root: ROOT }).errors.some((error) => /gitnexus-cli.*owner|owner.*gitnexus-cli/i.test(error)));
});

test('effective decisions expose the versioned contract for a single row', () => {
  const row = LEDGER.decisions.find((decision) => decision.id === 'laravel');
  const decision = effectiveDecision({ inventory: INVENTORY, ledger: LEDGER, row, root: ROOT });
  assert.strictEqual(LEDGER.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(decision.id, 'laravel');
  assert.strictEqual(decision.publicName, 'laravel');
  assert.strictEqual(decision.path, 'skills/laravel');
  assert.strictEqual(decision.successor.kind, 'family');
  assert.strictEqual(decision.successor.id, 'laravel');
});

// RED contract for issue #534 P2.  The purpose ledger explains active
// decisions, while inventory remains the only source for identity and
// publication/migration facts.  The current retirement wave is deliberately
// a separate decision collection so a missing row cannot hide in the active
// 65-row baseline.
test('v2 purpose ledger covers active rows and the exact separate retirement wave', () => {
  assert.strictEqual(LEDGER.schema, 'dhpk.skill-purpose-decisions.v2');
  assert.ok(Array.isArray(LEDGER.decisions));
  assert.strictEqual(LEDGER.decisions.length, 84);
  assert.ok(LEDGER.decisions.every((row) => row.outcome === 'retain'));
  assert.ok(LEDGER.decisions.every((row) => typeof row.content_value === 'string' && row.content_value.trim() !== ''));
  assert.ok(LEDGER.decisions.every((row) => typeof row.authority === 'string' && row.authority.trim() !== ''));
  assert.ok(LEDGER.decisions.every((row) => row.duplicate_content
    && typeof row.duplicate_content.fact === 'string'
    && typeof row.duplicate_content.comparison === 'string'
    && row.duplicate_content.evidence
    && row.duplicate_content.evidence.status === 'PASS'));
  assert.ok(LEDGER.decisions.every((row) => Array.isArray(row.callers) && row.callers.length > 0));
  assert.ok(LEDGER.decisions.every((row) => row.evidence && typeof row.evidence === 'object'));

  assert.ok(Array.isArray(LEDGER.retirements));
  assert.deepStrictEqual(LEDGER.retirements.map((row) => row.id).sort(), [...CURRENT_WAVE_IDS].sort());
  const outcomeCounts = LEDGER.retirements.reduce((counts, row) => {
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
    return counts;
  }, {});
  assert.deepStrictEqual(outcomeCounts, { internalize: 11, merge: 7, retire: 2, remove: 1 });
  assert.ok(LEDGER.retirements.every((row) => typeof row.authority === 'string' && row.authority.length > 0));
  assert.ok(LEDGER.retirements.every((row) => row.duplicate_content
    && typeof row.duplicate_content.fact === 'string'
    && typeof row.duplicate_content.comparison === 'string'
    && row.duplicate_content.evidence
    && row.duplicate_content.evidence.status === 'PASS'));
  for (const row of [...LEDGER.decisions, ...LEDGER.retirements]) {
    for (const duplicated of ['name', 'path', 'publicName', 'canonicalPath', 'surfaces', 'successor', 'migration', 'rollback']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(row, duplicated), false,
        `${row.id} must derive ${duplicated} from distribution inventory`);
    }
  }

  const result = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.effective.length, INVENTORY.skills.length);
  assert.strictEqual(result.retirements.length, CURRENT_WAVE_IDS.length);
});

test('v2 purpose validation rejects missing outcome rows and duplicated inventory identity', () => {
  const missing = JSON.parse(JSON.stringify(LEDGER));
  missing.retirements = (Array.isArray(missing.retirements) ? missing.retirements : CURRENT_WAVE_IDS.map((id) => ({ id }))).slice(1);
  const missingResult = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: missing, root: ROOT });
  assert.ok(missingResult.errors.some((error) => /missing.*retire.*laravel-5\.4-notes|laravel-5\.4-notes.*missing/i.test(error)),
    `expected missing retirement diagnostic, got:\n${missingResult.errors.join('\n')}`);

  const duplicated = JSON.parse(JSON.stringify(LEDGER));
  duplicated.decisions[0].path = INVENTORY.skills[0].path;
  const duplicateResult = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: duplicated, root: ROOT });
  assert.ok(duplicateResult.errors.some((error) => /identity|path|distribution inventory/i.test(error)),
    `expected inventory-derived identity diagnostic, got:\n${duplicateResult.errors.join('\n')}`);
});

function registerAdditionTests() {
  const inventory = INVENTORY;
  const ledger = LEDGER;
  const ids = ['create-pr', 'git-worktree', 'merge-prep', 'pr-summary', 'proposal-analyze',
    'project-brief', 'doc-refactor', 'update-docs', 'update-codemaps', 'precommit',
    'dep-audit', 'repo-verify', 'code-simplify', 'harness-audit', 'review-pending',
    'spec-mine', 'harness-setup', 'opsx-apply-resume', 'ui-ux-verify'];
  const additions = ids.map((id) => ({ id, source: 'docs/adr/0022-portable-command-skills-and-public-names.md' }));
  function validateRows(rows) {
    return validateSkillPurposeDecisions({ root: ROOT, inventory, ledger: { ...ledger, additions: rows } });
  }

  function assertOnlyDiagnostic(rows, pattern, label) {
    const errors = validateRows(rows).errors;
    assert.strictEqual(errors.length, 1, `${label}: ${JSON.stringify(errors)}`);
    assert.match(errors[0], pattern, label);
  }

  test('post-baseline skills require explicit additions without rewriting historical evidence', () => {
    assert.deepStrictEqual(validateRows(additions).errors, []);
    assertOnlyDiagnostic(
      additions.slice(1),
      /active skill 'create-pr' requires an addition decision beyond the issue #467 baseline/,
      'a missing addition must identify the skill and baseline rule',
    );
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, ledger.baseline.path), 'utf8'));
    assert.strictEqual(baseline.static.skills.length, 65);
    assert.ok(!baseline.static.skills.some((skill) => skill.id === 'precommit'));
  });

  test('addition provenance rejects duplicates, old or unknown IDs, and missing or unsafe evidence', () => {
    assertOnlyDiagnostic(
      [...additions, additions[0]],
      /duplicates addition 'create-pr'/,
      'a duplicate addition must name its identity error',
    );
    assertOnlyDiagnostic(
      [...additions, { id: 'tdd', source: additions[0].source }],
      /cannot redeclare baseline skill 'tdd'/,
      'a baseline skill cannot be re-added',
    );
    assertOnlyDiagnostic(
      [...additions, { id: 'unregistered', source: additions[0].source }],
      /does not resolve to active skill 'unregistered'/,
      'an unknown ID must be distinguished from a baseline ID',
    );
    assertOnlyDiagnostic(
      [{ ...additions[0], source: '../outside.md' }, ...additions.slice(1)],
      /contains an unsafe caller path '\.\.\/outside\.md'/,
      'parent traversal must be rejected',
    );
    assertOnlyDiagnostic(
      [{ ...additions[0], source: '/tmp/outside.md' }, ...additions.slice(1)],
      /contains an unsafe caller path '\/tmp\/outside\.md'/,
      'absolute paths must be rejected',
    );
    assertOnlyDiagnostic(
      [{ ...additions[0], source: 'docs/not-present-addition.md' }, ...additions.slice(1)],
      /caller does not exist: docs\/not-present-addition\.md/,
      'missing provenance documents must be rejected',
    );
  });
}

function registerValidatorCliTests() {
  const CLI = path.join(ROOT, 'scripts', 'ci', 'validate-skill-purpose-decisions.js');
  function runCli(root) {
    const res = spawnSync('node', [path.join(root, 'scripts', 'ci', 'validate-skill-purpose-decisions.js')], {
      encoding: 'utf8',
    });
    return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
  }

  test('real CI validator CLI exits 0 and reports PASS for the checked-in ledger', () => {
    const { status, out } = runCli(ROOT);
    assert.strictEqual(status, 0, out);
    assert.match(out, /PASS \[skill-purpose-decisions\]:/);
  });

  test('malformed isolated ledger fails through the real CLI with an actionable ledger error', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-purpose-decisions-'));
    try {
      const files = [
        'scripts/ci/validate-skill-purpose-decisions.js',
        'scripts/ci/_lib/report.js',
        'scripts/ci/_lib/frontmatter.js',
        'scripts/lib/skill-purpose-decisions.js',
        'scripts/lib/marketplace-review-paths.js',
        'scripts/lib/marketplace-review-v2.js',
        'manifests/distribution-inventory.json',
      ];
      for (const rel of files) {
        const destination = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), destination);
      }

      const ledgerPath = path.join(tmp, 'manifests', 'skill-purpose-decisions.json');
      fs.writeFileSync(ledgerPath, '{ "schema": ');

      const { status, out } = runCli(tmp);
      assert.strictEqual(status, 1, out);
      assert.match(out, /ERROR \[skill-purpose-decisions\]: manifests\/skill-purpose-decisions\.json cannot be read:/);
      assert.match(out, /JSON|Unexpected end|end of JSON/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

registerAdditionTests();
registerValidatorCliTests();

run('skill-purpose-decisions');
