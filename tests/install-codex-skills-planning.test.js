'use strict';

// Behavioral coverage for install-codex-skills.sh (install-codex-skills-planning).
// Every installer invocation remains a real child process so exit status,
// stdout JSON, process-group cleanup, and cwd restoration stay under test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');

const {
  ROOT,
  HOOK,
  INSTALLER_CHILD_TIMEOUT_MS,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  descriptorPseudoPathBlocker,
  materializationFailureShim,
  parentReplacementGate,
  waitForFile,
  rewriteAgentAsHistoricalManagedSymlink,
  materializeFixtureSkill,
  collisionFixture,
  transactionMetadataSnapshot,
  provenanceDriftPlanFixture
} = fixtures;

test('--plan --json reports collision evidence without mutating projection or receipt', () => {
  const fixture = collisionFixture();
  try {
    const beforeReceipt = fs.readFileSync(fixture.receiptPath, 'utf8');
    const beforeTarget = completeTreeFingerprint(fixture.target);
    const planned = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    const collision = report.collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    assert.ok(collision, planned.stdout);
    assert.strictEqual(collision.ownership, 'unowned-collision');
    assert.match(collision.source_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(collision.destination_fingerprint, /^[a-f0-9]{64}$/);
    assert.strictEqual(report.receipt_state, 'partial');
    assert.strictEqual(report.reconciliation_state, 'partial');
    assert.strictEqual(
      collision.action,
      `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`,
    );
    assert.match(report.next_action, /--adopt/);
    assert.match(report.next_action, /source-fingerprint/);
    assert.strictEqual(fs.readFileSync(fixture.receiptPath, 'utf8'), beforeReceipt);
    assert.strictEqual(completeTreeFingerprint(fixture.target), beforeTarget);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--update without --adopt exits non-zero and preserves the unowned collision', () => {
  const fixture = collisionFixture();
  try {
    const beforeTarget = completeTreeFingerprint(fixture.target);
    const beforeReceipt = fs.readFileSync(fixture.receiptPath, 'utf8');
    const updated = runInstaller(fixture.scratch, ['--copy', '--update', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /collision preserved|unowned-collision|requires_adoption/i);
    assert.strictEqual(completeTreeFingerprint(fixture.target), beforeTarget);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(['partial', JSON.parse(beforeReceipt).state].includes(receipt.state));
    assert.notStrictEqual(receipt.state, 'current');
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--plan --json reports a current projection without mutation', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const before = fs.readFileSync(receiptPath, 'utf8');
    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.strictEqual(report.state, 'current');
    assert.deepStrictEqual(report.collisions, []);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

for (const drift of ['version', 'fingerprint', 'both']) {
  test(`metadata-only ${drift} provenance drift is stale, actionable, and read-only`, () => {
    const fixture = provenanceDriftPlanFixture(drift);
    try {
      assert.notStrictEqual(fixture.planned.status, 0,
        `provenance drift must not pass preflight: ${fixture.planned.stdout}\n${fixture.planned.stderr}`);
      const report = JSON.parse(fixture.planned.stdout);
      assert.strictEqual(report.state, 'stale');
      assert.strictEqual(report.receipt_state, 'current',
        'historical receipt state remains evidence but must not mask provenance drift');
      assert.deepStrictEqual(report.collisions, []);
      assert.deepStrictEqual(report.missing, []);
      assert.deepStrictEqual(report.updates, []);
      assert.deepStrictEqual(report.retired, []);
      assert.strictEqual(report.plugin_version, fixture.currentProvenance.pluginVersion);
      assert.strictEqual(report.source_fingerprint, fixture.currentProvenance.sourceFingerprint);
      assert.strictEqual(report.receipt_plugin_version, fixture.recordedProvenance.pluginVersion);
      assert.strictEqual(
        report.receipt_source_fingerprint,
        fixture.recordedProvenance.sourceFingerprint,
      );
      assert.ok(Array.isArray(report.reasons), JSON.stringify(report));
      if (drift === 'version' || drift === 'both') {
        assert.match(report.reasons.join('\n'), /receipt plugin version differs from source/);
      }
      if (drift === 'fingerprint' || drift === 'both') {
        assert.match(report.reasons.join('\n'), /receipt source fingerprint differs from the current Codex source/);
      }
      assert.match(report.next_action, /--migrate --update/);
      assert.strictEqual(fs.readFileSync(fixture.receiptPath, 'utf8'), fixture.before.receipt);
      assert.strictEqual(completeTreeFingerprint(fixture.codexRoot), fixture.before.projection);
      assert.deepStrictEqual(
        transactionMetadataSnapshot(fixture.codexRoot),
        fixture.before.transactionMetadata,
      );
    } finally {
      fs.rmSync(fixture.scratch, { recursive: true, force: true });
    }
  });
}
test('Cursor stale source diagnostics use the active surface label', () => {
  const scratch = projectRoot();
  const cursorEnv = {
    DHPK_HARNESS_KIND: 'cursor',
    DHPK_SRC_REL: 'cursor',
    DHPK_DEST_REL: '.cursor',
    DHPK_SOURCE_KINDS: 'skills,agents,rules,commands',
  };
  try {
    const installed = runInstaller(scratch, ['--copy', '--force'], ROOT, cursorEnv);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const receiptPath = path.join(scratch, '.cursor', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.source_fingerprint = '0'.repeat(64);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const planned = runInstaller(scratch, [
      '--update', '--plan', '--json', '--force',
    ], ROOT, cursorEnv);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.match(report.reasons.join('\n'), /receipt source fingerprint differs from the current Cursor source/);
    assert.doesNotMatch(report.reasons.join('\n'), /current Codex source/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

for (const nonFiniteLiteral of ['NaN', '1e10000']) {
  test(`non-finite receipt provenance ${nonFiniteLiteral} stays fail-closed with strict JSON plan output`, () => {
    const scratch = projectRoot();
    try {
      const first = runInstaller(scratch, ['--force']);
      assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
      const codexRoot = path.join(scratch, '.codex');
      const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
      const validReceipt = fs.readFileSync(receiptPath, 'utf8');
      const receiptBefore = validReceipt.replace(
        /"plugin_version": "[^"]+"/,
        `"plugin_version": ${nonFiniteLiteral}`,
      );
      assert.notStrictEqual(receiptBefore, validReceipt, 'fixture must replace plugin_version');
      fs.writeFileSync(receiptPath, receiptBefore);
      const projectionBefore = completeTreeFingerprint(codexRoot);
      const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force']);
      assert.notStrictEqual(planned.status, 0, planned.stdout);
      const report = JSON.parse(planned.stdout);
      assert.match(report.reasons.join('\n'), /invalid JSON/);
      assert.strictEqual(report.receipt_plugin_version, null);
      assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
      assert.strictEqual(completeTreeFingerprint(codexRoot), projectionBefore);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}

for (const drift of ['version', 'fingerprint', 'both']) {
  test(`explicit migration/update repairs ${drift} provenance drift`, () => {
    const fixture = provenanceDriftPlanFixture(drift);
    try {
      assert.notStrictEqual(fixture.planned.status, 0, fixture.planned.stdout);
      const beforeReceipt = JSON.parse(fixture.before.receipt);
      const beforeEntry = beforeReceipt.managed_entries.skills['tdd-workflow'];
      const updated = runInstaller(fixture.scratch, ['--migrate', '--update', '--force']);
      assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
      const repaired = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
      const repairedEntry = repaired.managed_entries.skills['tdd-workflow'];
      assert.strictEqual(repaired.plugin_version, fixture.currentProvenance.pluginVersion);
      assert.strictEqual(repaired.source_fingerprint, fixture.currentProvenance.sourceFingerprint);
      assert.strictEqual(repaired.mode, beforeReceipt.mode);
      assert.strictEqual(repairedEntry.mode, beforeEntry.mode);
      assert.strictEqual(repairedEntry.ownership_marker, beforeEntry.ownership_marker);

      const planned = runInstaller(fixture.scratch, [
        '--update', '--plan', '--json', '--force',
      ]);
      assert.strictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
      const report = JSON.parse(planned.stdout);
      assert.strictEqual(report.state, 'current');
      assert.deepStrictEqual(report.reasons, []);
      assert.deepStrictEqual(report.collisions, []);
      assert.deepStrictEqual(report.missing, []);
      assert.deepStrictEqual(report.updates, []);
      assert.deepStrictEqual(report.retired, []);
    } finally {
      fs.rmSync(fixture.scratch, { recursive: true, force: true });
    }
  });
}
test('--plan blocks on an interrupted transaction without recovering or mutating state', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const codexRoot = path.join(scratch, '.codex');
    const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
    const target = path.join(codexRoot, 'skills', 'tdd-workflow');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const targetBefore = completeTreeFingerprint(target);
    const receipt = JSON.parse(receiptBefore);
    const run = '20990101T000000Z-999999999';
    const journalPath = path.join(codexRoot, `.dhpk-transaction-${run}.json`);
    const journal = {
      run,
      pid: 2147483647,
      relative: `.dhpk-transaction-${run}.json`,
      phase: 'active',
      started: true,
      plugin_version: receipt.plugin_version,
      source_fingerprint: receipt.source_fingerprint,
      receipt_snapshot_present: true,
      receipt_snapshot: receipt,
      prunes: [],
      mutations: [],
      adoptions: [],
    };
    const journalBefore = `${JSON.stringify(journal, null, 2)}\n`;
    fs.writeFileSync(journalPath, journalBefore);

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.strictEqual(report.state, 'blocked');
    assert.match(report.blocking_recovery.join('\n'), /interrupted transaction|recovery/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
    assert.strictEqual(completeTreeFingerprint(target), targetBefore);
    assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), journalBefore);

    const recovered = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    const recoveredJournal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    assert.strictEqual(recoveredJournal.phase, 'rolled_back');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--plan blocks on malformed terminal transaction metadata without mutation', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const codexRoot = path.join(scratch, '.codex');
    const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
    const target = path.join(codexRoot, 'skills', 'tdd-workflow');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const targetBefore = completeTreeFingerprint(target);
    const run = '20990101T000001Z-999999998';
    const journalPath = path.join(codexRoot, `.dhpk-transaction-${run}.json`);
    const journalBefore = `${JSON.stringify({
      run: 'different-run',
      relative: `.dhpk-transaction-${run}.json`,
      phase: 'committed',
    }, null, 2)}\n`;
    fs.writeFileSync(journalPath, journalBefore);

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.strictEqual(report.state, 'blocked');
    assert.match(report.blocking_recovery.join('\n'), /malformed|self-bound|metadata/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
    assert.strictEqual(completeTreeFingerprint(target), targetBefore);
    assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), journalBefore);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('explicit adoption backs up and receipt-owns only the selected collision', () => {
  const fixture = collisionFixture();
  try {
    const sibling = 'tdd-workflow';
    const siblingTarget = path.join(fixture.scratch, '.codex', 'skills', sibling);
    const siblingBefore = completeTreeFingerprint(siblingTarget);
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[fixture.collision]);
    assert.ok(!fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
    assert.ok(receipt.reconciliation.adopted >= 1, JSON.stringify(receipt.reconciliation));
    assert.ok(receipt.reconciliation.evidence.paths.adopted.includes(`skills/${fixture.collision}`));
    assert.strictEqual(completeTreeFingerprint(siblingTarget), siblingBefore,
      'path-scoped adoption must not rewrite an unrelated managed sibling');
    const backup = receipt.reconciliation.evidence.backups.find((item) => item.original === `skills/${fixture.collision}`);
    assert.ok(backup, JSON.stringify(receipt.reconciliation.evidence.backups));
    assert.strictEqual(backup.reason, 'explicit-adoption');
    assert.ok(fs.existsSync(path.join(fixture.scratch, backup.path)), `backup path missing: ${backup.path}`);
    assert.strictEqual(fs.readFileSync(path.join(fixture.scratch, backup.path, 'user-owned.txt'), 'utf8'), 'keep me\n');
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption journal recovers a crash after quarantine before retrying the selected collision', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const crashed = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin, { DHPK_TEST_ABORT_ADOPTION_PHASE: 'quarantine' });
    assert.strictEqual(crashed.status, 73, `${crashed.stdout}\n${crashed.stderr}`);
    assert.ok(!fs.existsSync(fixture.target), 'crash point should leave the target quarantined for recovery');
    const retried = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[fixture.collision], 'retry should publish ownership after recovery');
    assert.ok(!fs.existsSync(path.join(fixture.target, 'user-owned.txt')), 'recovered adoption should replace the selected collision');
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption journal rolls back a crash after publication when the receipt still proves the old projection', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const crashed = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin, { DHPK_TEST_ABORT_ADOPTION_PHASE: 'published' });
    assert.strictEqual(crashed.status, 73, `${crashed.stdout}\n${crashed.stderr}`);
    const retried = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[fixture.collision]);
    assert.strictEqual(receipt.transaction_final, true);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption recovery rolls forward a durable partial receipt after a receipt-persisted crash', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const crashed = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin, { DHPK_TEST_ABORT_ADOPTION_PHASE: 'receipt_persisted' });
    assert.strictEqual(crashed.status, 73, `${crashed.stdout}\n${crashed.stderr}`);
    const partial = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.strictEqual(partial.transaction_final, false);
    assert.ok(partial.managed_entries.skills[fixture.collision]);
    const recovered = runInstaller(fixture.scratch, [
      '--copy', '--update', '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.strictEqual(receipt.transaction_final, true, 'recovery must finalize the proven partial receipt');
    assert.ok(receipt.managed_entries.skills[fixture.collision]);
    assert.ok(!fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption is path-scoped when multiple collisions are reported', () => {
  const fixture = collisionFixture();
  const second = 'dhpk-legacy-characterization-tests';
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[second], `expected fixture receipt entry for ${second}`);
    delete receipt.managed_entries.skills[second];
    fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const secondTarget = path.join(fixture.scratch, '.codex', 'skills', second);
    fs.writeFileSync(path.join(secondTarget, 'second-user-owned.txt'), 'keep second\n');

    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const report = JSON.parse(plan.stdout);
    const firstCollision = report.collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const secondCollision = report.collisions.find((entry) => entry.path === `skills/${second}`);
    assert.ok(firstCollision && secondCollision, plan.stdout);
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${firstCollision.destination_fingerprint}@${firstCollision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const after = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(after.managed_entries.skills[fixture.collision]);
    assert.ok(!after.managed_entries.skills[second]);
    assert.ok(fs.existsSync(path.join(secondTarget, 'second-user-owned.txt')));
    assert.strictEqual(after.reconciliation.state, 'partial');
    assert.ok(after.reconciliation.evidence.paths.collisions.includes(`skills/${second}`));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('explicit adoption defers a stale-owned sibling instead of updating it', () => {
  const fixture = collisionFixture();
  const sibling = 'tdd-workflow';
  try {
    materializeFixtureSkill(fixture.fakePlugin, sibling);
    const siblingSource = path.join(fixture.fakePlugin, 'codex', 'skills', sibling, 'SKILL.md');
    const siblingTarget = path.join(fixture.scratch, '.codex', 'skills', sibling);
    const siblingBefore = completeTreeFingerprint(siblingTarget);
    const receiptBefore = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    const siblingReceiptBefore = receiptBefore.managed_entries.skills[sibling];
    fs.appendFileSync(siblingSource, '\nstale sibling source\n');

    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const report = JSON.parse(plan.stdout);
    const collision = report.collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    assert.ok(collision, plan.stdout);
    assert.ok(report.updates.some((entry) => entry.path === `skills/${sibling}`), plan.stdout);

    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const after = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.strictEqual(completeTreeFingerprint(siblingTarget), siblingBefore,
      'stale managed sibling must remain unchanged during path-scoped adoption');
    assert.deepStrictEqual(after.managed_entries.skills[sibling], siblingReceiptBefore,
      'stale managed sibling receipt entry must remain unchanged');
    assert.strictEqual(after.reconciliation.state, 'partial');
    assert.ok(after.reconciliation.evidence.paths.deferred.includes(`skills/${sibling}`));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('explicit adoption rejects a mode mismatch instead of rewriting the projection', () => {
  const fixture = collisionFixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    receipt.mode = 'symlink';
    fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const rejected = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(rejected.status, 2, `${rejected.stdout}\n${rejected.stderr}`);
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /mode mismatch|omit --copy/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption aborts when the planned collision changes before mutation', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    fs.writeFileSync(path.join(fixture.target, 'changed-after-plan.txt'), 'changed\n');
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.match(`${adopted.stdout}\n${adopted.stderr}`, /changed|fresh plan|preflight/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'changed-after-plan.txt')));
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(!receipt.managed_entries.skills[fixture.collision]);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption aborts when the planned source changes before mutation', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    fs.appendFileSync(path.join(fixture.fakePlugin, 'codex', 'skills', fixture.collision, 'SKILL.md'), '\nsource changed after plan\n');
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.match(`${adopted.stdout}\n${adopted.stderr}`, /changed|fresh plan|preflight/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--plan and --adopt cannot be combined, and adoption requires --update', () => {
  const fixture = collisionFixture();
  try {
    const token = `skills/${fixture.collision}@${'0'.repeat(64)}@${'0'.repeat(64)}`;
    const planned = runInstaller(fixture.scratch, ['--plan', '--json', `--adopt=${token}`, '--force'], fixture.fakePlugin);
    assert.strictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    assert.match(`${planned.stdout}\n${planned.stderr}`, /cannot be combined|--plan.*--adopt/i);
    const withoutUpdate = runInstaller(fixture.scratch, ['--adopt', token, '--force'], fixture.fakePlugin);
    assert.strictEqual(withoutUpdate.status, 2, `${withoutUpdate.stdout}\n${withoutUpdate.stderr}`);
    assert.match(`${withoutUpdate.stdout}\n${withoutUpdate.stderr}`, /requires --update/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption rejects a symlinked backup root without writing outside .codex', () => {
  const fixture = collisionFixture();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-backup-external-')));
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const backupRoot = path.join(fixture.scratch, '.codex', '.dhpk-backups');
    fs.symlinkSync(external, backupRoot, 'dir');
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.match(`${adopted.stdout}\n${adopted.stderr}`, /escapes|containment|backup|symlink/i);
    assert.deepStrictEqual(fs.readdirSync(external), []);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('planning rejects a symlinked destination ancestor even when it points inside the project', () => {
  const fixture = collisionFixture();
  const alias = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-skills-alias-')));
  try {
    const originalSkills = path.join(fixture.scratch, '.codex', 'skills');
    const externalSkills = path.join(alias, 'skills');
    fs.renameSync(originalSkills, externalSkills);
    fs.symlinkSync(externalSkills, originalSkills, 'dir');
    const planned = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    assert.match(`${planned.stdout}\n${planned.stderr}`, /symlinked parent|symlink|unsafe/i);
    assert.ok(fs.existsSync(path.join(externalSkills, fixture.collision, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
    fs.rmSync(alias, { recursive: true, force: true });
  }
});

test('adoption rejects traversal paths before writing outside the Codex root', () => {
  const fixture = collisionFixture();
  const outside = path.join(fixture.scratch, 'outside-adoption.txt');
  try {
    const rejected = runInstaller(fixture.scratch, [
      '--copy', '--update', '--adopt=../outside-adoption.txt@0000000000000000000000000000000000000000000000000000000000000000', '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(rejected.status, 0, `${rejected.stdout}\n${rejected.stderr}`);
    assert.ok(!fs.existsSync(outside));
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

run('install-codex-skills-planning');
