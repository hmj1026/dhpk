'use strict';

// First vertical slice for the public Review Gate runtime CLI.  The init
// command is the explicit setup boundary: it creates the local integrity key
// that later prepare/observe/status invocations are allowed to consume.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  getOrCreateHostKey,
  hostInitArgs,
} = require('./_lib/review-gate-host-attestation-fixture');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'review-gate-runtime.js');
const WORK_REQUEST_PATH = path.join(ROOT, 'tests', 'fixtures', 'review-gate', 'runtime-work-request-v1.json');
const RUNTIME_SCHEMA = 'dhpk.review-gate.runtime.v1';
const REVIEWER_CONTRACT_VERSION = 'dhpk.reviewer-contract.v2';

function runCli(repoRoot, args = [], input = undefined) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
  });
}

function initArgs(repoRoot) {
  return hostInitArgs(getOrCreateHostKey(repoRoot, 'runtime-cli'));
}

function escapedRegExp(value) {
  return new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function makeSymlinkCheckout(prefix, relativeLink) {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-repo-`)));
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-outside-`)));
  const linkPath = path.join(repoRoot, relativeLink);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true, mode: 0o700 });
  fs.symlinkSync(outsideRoot, linkPath, 'dir');
  return { repoRoot, outsideRoot };
}

function cleanupCheckout({ repoRoot, outsideRoot }) {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
}

test('init creates a private review-gate integrity key in the repository store', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-')));
  try {
    const result = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.command, 'init');
    assert.strictEqual(output.schema, 'dhpk.review-gate.runtime.v1');
    assert.strictEqual(output.initialized, true);

    const keyPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'integrity.key');
    const stat = fs.statSync(keyPath);
    assert.ok(stat.isFile(), 'init must create a regular key file');
    assert.strictEqual(stat.mode & 0o777, 0o600, 'integrity key must not be group/world readable');
    assert.strictEqual(fs.readFileSync(keyPath).length, 32, 'integrity key must contain exactly 32 bytes');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('init rejects a .dhpk symlink without creating an integrity key outside the checkout', () => {
  const fixture = makeSymlinkCheckout('dhpk-review-gate-runtime-dhpk-link', '.dhpk');
  try {
    const result = runCli(fixture.repoRoot, initArgs(fixture.repoRoot));
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(fs.readdirSync(fixture.outsideRoot), []);
    assert.doesNotMatch(result.stderr, escapedRegExp(fixture.repoRoot));
  } finally {
    cleanupCheckout(fixture);
  }
});

test('init rejects a review-gate symlink without creating an integrity key outside the checkout', () => {
  const fixture = makeSymlinkCheckout('dhpk-review-gate-runtime-review-link', path.join('.dhpk', 'review-gate'));
  try {
    const result = runCli(fixture.repoRoot, initArgs(fixture.repoRoot));
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(fs.readdirSync(fixture.outsideRoot), []);
    assert.doesNotMatch(result.stderr, escapedRegExp(fixture.repoRoot));
  } finally {
    cleanupCheckout(fixture);
  }
});

test('init preserves an existing regular integrity key instead of overwriting it', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-existing-')));
  const keyPath = path.join(repoRoot, '.dhpk', 'review-gate', 'v1', 'integrity.key');
  const existingKey = Buffer.alloc(32, 0x65);
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyPath, existingKey, { mode: 0o600 });

    const result = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.initialized, false);
    assert.deepStrictEqual(fs.readFileSync(keyPath), existingKey);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('prepare reads a bounded Work Request from stdin and status returns its bounded projection', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-prepare-')));
  try {
    const initialized = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);

    const prepare = runCli(repoRoot, ['prepare'], fs.readFileSync(WORK_REQUEST_PATH, 'utf8'));
    assert.strictEqual(prepare.status, 0, `${prepare.stdout}\n${prepare.stderr}`);

    const prepared = JSON.parse(prepare.stdout);
    assert.strictEqual(prepared.schema, RUNTIME_SCHEMA);
    assert.strictEqual(prepared.command, 'prepare');
    assert.strictEqual(prepared.status, 'PREPARED');
    assert.match(prepared.workId, /^work-[a-f0-9]{64}$/);
    assert.match(prepared.planId, /^review-plan-[a-f0-9]{64}$/);
    assert.strictEqual(prepared.reviewRequests.length, 1);
    assert.strictEqual(prepared.reviewRequests[0].lane, 'code-reviewer');
    assert.match(prepared.reviewRequests[0].obligationId, /^obligation-[a-f0-9]{64}$/);
    assert.strictEqual(prepared.reviewRequests[0].contractVersion, REVIEWER_CONTRACT_VERSION);
    assert.deepStrictEqual(prepared.reviewRequests[0].scope.paths, ['scripts/review-gate-runtime.js']);

    const status = runCli(repoRoot, ['status', '--work-id', prepared.workId]);
    assert.strictEqual(status.status, 0, `${status.stdout}\n${status.stderr}`);
    const persisted = JSON.parse(status.stdout);
    assert.strictEqual(persisted.schema, RUNTIME_SCHEMA);
    assert.strictEqual(persisted.command, 'status');
    assert.strictEqual(persisted.status, 'PENDING');
    assert.strictEqual(persisted.workId, prepared.workId);
    assert.strictEqual(persisted.planId, prepared.planId);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(persisted, 'receipts'), false);
    assert.deepStrictEqual(persisted.receiptSummary, { total: 0, byKind: {} });
    assert.deepStrictEqual(persisted.reviewRequests, prepared.reviewRequests);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(persisted, 'migrationObservation'), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('init reports distinct first and repeat setup statuses', () => {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-runtime-init-status-')));
  try {
    const first = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.strictEqual(JSON.parse(first.stdout).status, 'INITIALIZED');

    const repeat = runCli(repoRoot, initArgs(repoRoot));
    assert.strictEqual(repeat.status, 0, `${repeat.stdout}\n${repeat.stderr}`);
    assert.strictEqual(JSON.parse(repeat.stdout).status, 'ALREADY_INITIALIZED');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

run('review-gate-runtime-cli');
