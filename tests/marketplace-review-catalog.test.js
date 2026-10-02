'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateSkillPurposeDecisions } = require('../scripts/lib/skill-purpose-decisions');
const { marketplaceReviewBlockers } = require('../scripts/lib/marketplace-review-v2');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/skill-purpose-decisions.json'), 'utf8'));
const REVIEW_SPEC = fs.readFileSync(path.join(ROOT, 'docs/contracts/marketplace-catalog.md'), 'utf8');
const EXPECTED_PASS_SOURCES = Object.freeze({
  'js-static-check-strategy': 'tests/write-handoff.test.js',
  'agy-fast-worker': 'tests/cli-dispatch-launcher.test.js',
  'change-verdict': 'tests/skill-audit-family-isolation.test.js',
  'feature-verify': 'tests/api-exec.test.js',
  'opsx-post-obs': 'tests/post-obs.test.js',
  'repo-intake': 'tests/run-skill.test.js',
  'session-usage-audit': 'tests/session-audit-integrity-fixtures.test.js',
  'harness-govern': 'tests/multi-ai-sync-skill-contract.test.js',
  'harness-audit': 'tests/harness-audit.test.js',
  'dep-audit': 'tests/dep-audit.test.js',
});

function acceptedClassifications() {
  return new Map(REVIEW_SPEC.split(/\r?\n/)
    .filter((line) => /^\| `[^`]+` \|/.test(line))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      const [id, authority, kind, owner, selection, surfaces, license, evidence] = cells;
      return [id.replace(/^`|`$/g, ''), {
        authority,
        kind,
        owner: owner.replace(/^`|`$/g, ''),
        selection: selection.replace(/^`|`$/g, '').replace(/^—（.*$/, 'withdrawn'),
        surfaces: surfaces.split(',').map((surface) => surface.trim()),
        license,
        evidence,
      }];
    }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowOf(ledger, id) {
  return ledger.marketplace_review.rows.find((row) => row.id === id);
}

function reviewOrAssert() {
  const review = LEDGER.marketplace_review;
  assert.ok(review, 'skill-purpose ledger must include the accepted marketplace_review catalog');
  return review;
}

function validate(ledger) {
  return validateSkillPurposeDecisions({ inventory: INVENTORY, ledger, root: ROOT });
}

function evidenceStatus(classification) {
  return classification.evidence.startsWith('行為（已抽查）') ? 'PASS' : 'GAP';
}

function hostSurfaces(classification, host) {
  const prefix = { claude: 'claude-', codex: 'codex-', cursor: 'cursor-' }[host];
  return classification.surfaces.filter((surface) => surface.startsWith(prefix)).sort();
}

test('canonical marketplace review matches the accepted catalog and evidence ledger', () => {
  const accepted = acceptedClassifications();
  const review = reviewOrAssert();
  assert.strictEqual(review.version, 'dhpk.marketplace-review.v2');
  assert.strictEqual(accepted.size, 84);
  assert.strictEqual(review.rows.length, 84);

  const validation = validateSkillPurposeDecisions({ inventory: INVENTORY, ledger: LEDGER, root: ROOT });
  assert.deepStrictEqual(validation.errors, [], validation.errors.join('\n'));

  const actual = new Map(review.rows.map((row) => [row.id, row]));
  assert.deepStrictEqual([...actual.keys()].sort(), [...accepted.keys()].sort());

  const counts = new Map();
  const statusCounts = { PASS: 0, GAP: 0 };
  for (const [id, classification] of accepted) {
    const row = actual.get(id);
    const category = `${classification.kind}:${classification.selection}`;
    counts.set(category, (counts.get(category) || 0) + 1);
    assert.strictEqual(row.kind, classification.kind, `${id} kind`);
    assert.strictEqual(row.authority, classification.authority, `${id} authority`);
    assert.strictEqual(row.license.status, classification.license.startsWith('excluded') ? 'excluded' : 'first-party',
      `${id} license status`);

    if (classification.kind === 'withdrawn') {
      assert.strictEqual(row.selection, undefined, `${id} withdrawn selection`);
      assert.strictEqual(row.test_evidence, undefined, `${id} withdrawn test evidence`);
      assert.strictEqual(row.owner_id, classification.owner === '—' ? undefined : classification.owner, `${id} successor owner`);
      continue;
    }

    assert.strictEqual(row.selection, classification.selection, `${id} selection`);
    if (classification.kind === 'internal') {
      // Accepted A2 reasoner exception: transport internals serve both Codex and Agy entry owners.
      assert.deepStrictEqual(row.owner_id, ['codex-bridge', 'agy-fast-worker'], `${id} internal owners`);
      assert.strictEqual(classification.owner, 'codex-bridge', `${id} primary owner in accepted table`);
      assert.strictEqual(row.host_selection, undefined, `${id} internal surface review is deferred`);
    } else {
      assert.strictEqual(row.owner_id, classification.owner, `${id} owner`);
    }

    const expectedStatus = evidenceStatus(classification);
    assert.strictEqual(row.test_evidence.status, expectedStatus, `${id} test evidence`);
    statusCounts[expectedStatus] += 1;
    if (expectedStatus === 'GAP') {
      assert.ok(row.test_evidence.reason.trim(), `${id} GAP reason`);
    } else {
      assert.strictEqual(row.test_evidence.source, EXPECTED_PASS_SOURCES[id], `${id} PASS test evidence path`);
    }

    const inventorySkill = INVENTORY.skills.find((skill) => skill.id === id);
    assert.ok(inventorySkill, `${id} exists in inventory`);
    assert.deepStrictEqual([...inventorySkill.surfaces].sort(), [...classification.surfaces].sort(), `${id} accepted surfaces`);
    const resourcePath = (resource) => (typeof resource === 'string' ? resource : resource.path);
    assert.ok(row.resources.filter((resource) => typeof resource === 'string')
      .includes(`${inventorySkill.path}/SKILL.md`), `${id} requires its own SKILL.md`);
    const family = INVENTORY.skill_routing_families.find((item) => item.id === id);
    if (family) {
      const resources = row.resources.map(resourcePath);
      for (const selectorPath of Object.values(family.selectors)) {
        assert.ok(resources.includes(selectorPath), `${id} includes family selector ${selectorPath}`);
      }
    }
    if (classification.kind === 'entry' && classification.selection === 'host-only') {
      const expectedHosts = ['claude', 'codex', 'cursor'].filter((host) => hostSurfaces(classification, host).length > 0);
      const groups = row.host_selection;
      assert.strictEqual(groups.length, expectedHosts.length, `${id} host selection groups`);
      for (const host of expectedHosts) {
        const group = groups.find((item) => item.selection_id === `dhpk.host-only.${host}.${id}`);
        assert.ok(group, `${id} has a separate ${host} selection identity`);
        assert.deepStrictEqual([...group.surfaces].sort(), hostSurfaces(classification, host), `${id} ${host} surfaces`);
        assert.strictEqual(group.purpose_evidence.status, 'PASS', `${id} ${host} purpose evidence`);
        assert.strictEqual(group.execution_evidence.status, 'GAP', `${id} ${host} execution evidence`);
        assert.ok(group.execution_evidence.reason.trim(), `${id} ${host} execution GAP reason`);
      }
      if (expectedHosts.includes('codex')) {
        const codexGroup = groups.find((item) => item.selection_id === `dhpk.host-only.codex.${id}`);
        assert.deepStrictEqual([...codexGroup.surfaces].sort(), ['codex-native', 'codex-sync'], `${id} Codex surfaces share one selection`);
      }
    } else {
      assert.strictEqual(row.host_selection, undefined, `${id} cannot declare Host-only selection`);
    }
  }

  assert.deepStrictEqual(Object.fromEntries(counts), {
    'reference:common': 25,
    'branch:common': 22,
    'entry:common': 15,
    'entry:host-only': 14,
    'internal:host-only': 2,
    'withdrawn:withdrawn': 6,
  });
  assert.deepStrictEqual(statusCounts, { PASS: 10, GAP: 68 });
  assert.deepStrictEqual(Object.keys(EXPECTED_PASS_SOURCES).sort(), [...accepted]
    .filter(([, classification]) => evidenceStatus(classification) === 'PASS')
    .map(([id]) => id).sort());

  const blockers = marketplaceReviewBlockers({ ledger: LEDGER });
  const expectedBlockers = [];
  let hostExecutionGapCount = 0;
  for (const [id, classification] of accepted) {
    const row = actual.get(id);
    if (classification.kind !== 'withdrawn' && evidenceStatus(classification) === 'GAP') {
      expectedBlockers.push(`${id}:test_evidence`);
    }
    for (const [index, group] of (row.host_selection || []).entries()) {
      expectedBlockers.push(`${id}:host_selection[${index}].execution_evidence`);
      hostExecutionGapCount += 1;
    }
  }
  assert.strictEqual(blockers.length, 68 + hostExecutionGapCount);
  assert.deepStrictEqual(blockers.map(({ id, field }) => `${id}:${field}`).sort(), expectedBlockers.sort());
  assert.ok(blockers.every((blocker) => blocker.reason.trim()), 'every canonical evidence blocker has a reason');
});

test('canonical marketplace review preserves legacy effective and retirement results', () => {
  reviewOrAssert();
  const canonical = validate(LEDGER);
  const legacyLedger = clone(LEDGER);
  delete legacyLedger.marketplace_review;
  const legacy = validate(legacyLedger);
  assert.deepStrictEqual(canonical.errors, [], canonical.errors.join('\n'));
  assert.deepStrictEqual(legacy.errors, [], legacy.errors.join('\n'));
  assert.deepStrictEqual({ effective: canonical.effective, retirements: canonical.retirements },
    { effective: legacy.effective, retirements: legacy.retirements });
});

test('canonical marketplace review rejects duplicate and missing IDs', () => {
  reviewOrAssert();
  const duplicate = clone(LEDGER);
  duplicate.marketplace_review.rows.push(clone(rowOf(duplicate, 'fastapi-pro')));
  const duplicateResult = validate(duplicate);
  assert.strictEqual(duplicateResult.ok, false);
  assert.ok(duplicateResult.errors.some((error) => /duplicate review.*fastapi-pro/.test(error)), duplicateResult.errors.join('\n'));

  const missing = clone(LEDGER);
  missing.marketplace_review.rows = missing.marketplace_review.rows.filter((row) => row.id !== 'fastapi-pro');
  const missingResult = validate(missing);
  assert.strictEqual(missingResult.ok, false);
  assert.ok(missingResult.errors.some((error) => /missing review.*fastapi-pro/.test(error)), missingResult.errors.join('\n'));
});

test('canonical marketplace review rejects authority escalation', () => {
  reviewOrAssert();
  const escalated = clone(LEDGER);
  rowOf(escalated, 'polyfill-version-matrix-audit').authority = 'workspace-write';
  escalated.decisions.find((row) => row.id === 'polyfill-version-matrix-audit').authority = 'workspace-write';
  const authorityResult = validate(escalated);
  assert.ok(authorityResult.errors.some((error) => /polyfill-version-matrix-audit.*authority.*exceeds owner 'change-verdict'/.test(error)),
    authorityResult.errors.join('\n'));
});

test('canonical marketplace review rejects a foreign resource', () => {
  reviewOrAssert();
  const foreignResource = clone(LEDGER);
  rowOf(foreignResource, 'fastapi-pro').resources[0] = 'skills/flow-guide/SKILL.md';
  const resourceResult = validate(foreignResource);
  assert.ok(resourceResult.errors.some((error) => /fastapi-pro.*resources.*not owned or declared/.test(error)),
    resourceResult.errors.join('\n'));
});

test('canonical marketplace review rejects Host surface omissions', () => {
  reviewOrAssert();
  const hostOmission = clone(LEDGER);
  const codexGroup = rowOf(hostOmission, 'opsx-load-context').host_selection
    .find((group) => group.selection_id === 'dhpk.host-only.codex.opsx-load-context');
  codexGroup.surfaces = codexGroup.surfaces.filter((surface) => surface !== 'codex-native');
  const hostResult = validate(hostOmission);
  assert.ok(hostResult.errors.some((error) => /opsx-load-context.*codex-native/.test(error)), hostResult.errors.join('\n'));
});

test('canonical marketplace review resources resolve to tracked source files', () => {
  const { execFileSync } = require('node:child_process');
  const trackedPaths = new Set(execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
  }).toString('utf8').split('\0').filter(Boolean));
  const missingPaths = reviewOrAssert().rows.flatMap((row) => (row.resources || [])
    .map((resource) => (typeof resource === 'string' ? resource : resource.path))
    .filter((resourcePath) => !trackedPaths.has(resourcePath))
    .map((resourcePath) => `${row.id}: ${resourcePath}`));

  assert.deepStrictEqual(missingPaths, [], `untracked marketplace review resources:\n${missingPaths.join('\n')}`);
});

run('marketplace-review-catalog');
