'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const primitives = require('../scripts/lib/receipt-primitives');
const harness = require('../scripts/lib/harness-receipt');

test('canonical JSON and SHA-256 preserve the established byte contract', () => {
  const canonical = primitives.canonicalJson({ b: 2, a: 1 });
  assert.strictEqual(canonical, '{"a":1,"b":2}');
  assert.strictEqual(
    primitives.sha256(canonical),
    '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777'
  );
  assert.notStrictEqual(primitives.sha256(Buffer.from([0x80])), primitives.sha256(Buffer.from([0x81])));
});

test('identity comparison remains case-normalized only for digest fields', () => {
  const expected = { sourceCommit: 'A'.repeat(40), sessionId: 'Session-A' };
  assert.strictEqual(primitives.compareIdentity(expected, {
    sourceCommit: 'a'.repeat(40),
    sessionId: 'Session-A',
  }).ok, true);
  assert.strictEqual(primitives.compareIdentity(expected, {
    sourceCommit: 'a'.repeat(40),
    sessionId: 'session-a',
  }).ok, false);
});

test('redaction removes credential values before persistence', () => {
  const marker = 'RECEIPT_PRIMITIVE_SECRET_12345678901234567890';
  const value = primitives.redact({
    token: marker,
    privateKey: marker,
    setCookie: marker,
    neutral: `-----BEGIN PRIVATE KEY-----\n${marker}`,
    note: `Authorization: Bearer ${marker}`,
  });
  assert.doesNotMatch(JSON.stringify(value), new RegExp(marker));
  assert.match(JSON.stringify(value), /redacted/i);
});

test('evidence redaction preserves only numeric canonical model-token metrics', () => {
  const value = primitives.redactEvidence({
    acceptedOutcomeCost: {
      schema: 'dhpk.accepted-outcome-cost.v1',
      metrics: { modelTokens: 1200 },
    },
    metrics: { modelTokens: 2400, unavailableModelTokens: null },
    modelTokens: 'secret-token-value',
    apiToken: 'secret-api-token',
  });
  assert.strictEqual(value.acceptedOutcomeCost.metrics.modelTokens, 1200);
  assert.strictEqual(value.metrics.modelTokens, '<redacted>');
  assert.strictEqual(value.metrics.unavailableModelTokens, '<redacted>');
  assert.strictEqual(value.modelTokens, '<redacted>');
  assert.strictEqual(value.apiToken, '<redacted>');
});

test('evidence redaction is descriptor-safe and bounded without losing private-material protection', () => {
  const marker = 'RECEIPT_REDACTION_SECRET_1234567890';
  let invoked = false;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: () => {
      invoked = true;
      return marker;
    },
  });
  const symbolValue = { visible: marker };
  symbolValue[Symbol('secret')] = marker;
  const sparse = [];
  sparse.length = 1;
  const oversized = Array.from({ length: 201 }, () => 'entry');
  const deep = {};
  let cursor = deep;
  for (let index = 0; index < 14; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  const value = primitives.redactEvidence({
    accessor,
    symbolValue,
    sparse,
    oversized,
    deep,
    privateKey: `-----BEGIN PRIVATE KEY-----\n${marker}`,
    acceptedOutcomeCost: {
      schema: 'dhpk.accepted-outcome-cost.v1',
      metrics: { modelTokens: 1200 },
    },
  });
  assert.strictEqual(invoked, false);
  assert.strictEqual(value.accessor.value, '<redacted>');
  assert.strictEqual(value.symbolValue, '<redacted>');
  assert.strictEqual(value.sparse, '<redacted>');
  assert.strictEqual(value.oversized, '<redacted>');
  let truncated = value.deep;
  for (let index = 0; index < 12; index += 1) truncated = truncated.next;
  assert.strictEqual(truncated, '<truncated>');
  assert.strictEqual(value.privateKey, '<redacted>');
  assert.strictEqual(value.acceptedOutcomeCost.metrics.modelTokens, 1200);
  assert.doesNotMatch(JSON.stringify(value), new RegExp(marker));
});

test('evidence redaction bounds huge sparse arrays before allocation or getter access', () => {
  const sparse = [];
  let getterInvoked = false;
  Object.defineProperty(sparse, '0', {
    configurable: true,
    enumerable: true,
    get() {
      getterInvoked = true;
      return 'must-not-be-read';
    },
  });
  sparse.length = 100_000_000;
  const originalFrom = Array.from;
  let attemptedLength = null;
  Array.from = function guardedFrom(arrayLike, ...args) {
    attemptedLength = arrayLike && arrayLike.length;
    if (attemptedLength > 200) throw new Error('unbounded array materialization');
    return Reflect.apply(originalFrom, this, [arrayLike, ...args]);
  };
  try {
    assert.strictEqual(primitives.redactEvidence(sparse), '<redacted>');
  } finally {
    Array.from = originalFrom;
  }
  assert.strictEqual(attemptedLength, null);
  assert.strictEqual(getterInvoked, false);
});

test('immutable writes never replace an existing claim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-receipt-primitives-'));
  const file = path.join(root, 'claims', 'claim.json');
  try {
    primitives.writeImmutable(file, 'first\n');
    assert.throws(() => primitives.writeImmutable(file, 'second\n'), /refusing to overwrite/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'first\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sequenced JSON replay owns ordering, digest, and predecessor verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-receipt-replay-'));
  const issues = [];
  const writeRecord = (sequence, previousChain, payload) => {
    const digest = primitives.sha256(primitives.canonicalJson(payload));
    const chain = primitives.sha256(`${previousChain}${digest}`);
    fs.writeFileSync(path.join(root, `${String(sequence).padStart(4, '0')}.json`), JSON.stringify({
      sequence,
      previousChain,
      payload,
      digest,
      chain,
    }));
    return chain;
  };
  try {
    const firstChain = writeRecord(1, '', { status: 'PLANNED' });
    const finalChain = writeRecord(2, firstChain, { status: 'COMPLETE' });
    const replayed = primitives.replayJsonSequence({
      directory: root,
      includeName: (name) => /^\d{4}\.json$/.test(name),
      expectedName: (sequence) => `${String(sequence).padStart(4, '0')}.json`,
      initialChain: '',
      validateRecord: (record, context) => {
        if (record.sequence !== context.sequence) context.report({ type: 'SEQUENCE' });
      },
      payloadForDigest: (record) => record.payload,
      digestForPayload: (payload) => primitives.sha256(primitives.canonicalJson(payload)),
      storedDigest: (record) => record.digest,
      previousChain: (record) => record.previousChain,
      chainFor: (previous, digest) => primitives.sha256(`${previous}${digest}`),
      storedChain: (record) => record.chain,
      onIssue: (issue) => issues.push(issue),
    });
    assert.deepStrictEqual(issues, []);
    assert.strictEqual(replayed.recordCount, 2);
    assert.strictEqual(replayed.chainDigest, finalChain);

    const secondPath = path.join(root, '0002.json');
    const second = JSON.parse(fs.readFileSync(secondPath, 'utf8'));
    second.previousChain = 'tampered';
    fs.writeFileSync(secondPath, JSON.stringify(second));
    primitives.replayJsonSequence({
      directory: root,
      expectedName: (sequence) => `${String(sequence).padStart(4, '0')}.json`,
      initialChain: '',
      payloadForDigest: (record) => record.payload,
      digestForPayload: (payload) => primitives.sha256(primitives.canonicalJson(payload)),
      storedDigest: (record) => record.digest,
      previousChain: (record) => record.previousChain,
      chainFor: (previous, digest) => primitives.sha256(`${previous}${digest}`),
      storedChain: (record) => record.chain,
      onIssue: (issue) => issues.push(issue),
    });
    assert.ok(issues.some((issue) => issue.type === 'PREVIOUS_CHAIN'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('process locks reclaim only dead owners and require ownership to release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-receipt-lease-'));
  const file = path.join(root, 'lease.json');
  const options = {
    file,
    pid: 101,
    isProcessAlive: () => true,
    conflictError: () => new Error('active lease'),
    unavailableError: () => new Error('lease unavailable'),
    ownershipError: () => new Error('foreign lease'),
  };
  try {
    assert.strictEqual(primitives.acquireProcessLock(options), true);
    assert.throws(() => primitives.acquireProcessLock({ ...options, pid: 202 }), /active lease/);
    assert.throws(() => primitives.releaseProcessLock({ ...options, pid: 202 }), /foreign lease/);
    assert.strictEqual(fs.existsSync(file), true);
    assert.strictEqual(primitives.releaseProcessLock(options), true);
    primitives.writeImmutable(file, '303\n');
    assert.strictEqual(primitives.acquireProcessLock({
      ...options,
      pid: 202,
      isProcessAlive: (owner) => owner !== 303,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lease journals preserve claims and releases without deleting successor ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-receipt-lease-journal-'));
  const directory = path.join(root, 'journal');
  const options = {
    directory,
    create: (generation) => ({ generation, token: `token-${generation}`, expired: false }),
    encode: (lease) => `${primitives.canonicalJson(lease)}\n`,
    decode: (bytes) => JSON.parse(bytes),
    generationFor: (lease) => lease.generation,
    tokenFor: (lease) => lease.token,
    isStale: (lease) => lease.expired === true,
    matches: (expected, actual) => expected.token === actual.token,
    conflictError: () => new Error('active journal lease'),
    ownershipError: () => new Error('foreign journal lease'),
  };
  try {
    const first = primitives.acquireLeaseJournal(options);
    assert.strictEqual(first.generation, 1);
    assert.throws(() => primitives.acquireLeaseJournal(options), /active journal lease/);
    assert.strictEqual(primitives.releaseLeaseJournal({ ...options, expected: first }), true);
    const claimPath = path.join(directory, 'claims', '000000000001.json');
    assert.strictEqual(fs.existsSync(claimPath), true);
    const firstBytes = fs.readFileSync(claimPath, 'utf8');
    const second = primitives.acquireLeaseJournal(options);
    assert.strictEqual(second.generation, 2);
    assert.throws(
      () => primitives.releaseLeaseJournal({ ...options, expected: first }),
      /foreign journal lease/
    );
    assert.throws(
      () => primitives.assertLeaseJournalOwnership({ ...options, expected: first }),
      /foreign journal lease/
    );
    assert.strictEqual(primitives.assertLeaseJournalOwnership({ ...options, expected: second }), true);
    assert.strictEqual(fs.readFileSync(claimPath, 'utf8'), firstBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('harness receipt remains a compatibility facade for extracted primitives', () => {
  for (const name of [
    'sha256', 'canonicalJson', 'redact', 'compareIdentity', 'validateIdentity',
    'fingerprintForBytes', 'fingerprintDirectory', 'revalidateBytes',
    'replayJsonSequence', 'acquireProcessLock', 'releaseProcessLock',
    'resolveGitTree', 'resolveGitCommit', 'resolveGitBinding', 'resolveGitWorktree',
    'validateGitBinding', 'validateRollbackOwnership', 'assertRollbackOwnership',
  ]) {
    assert.strictEqual(harness[name], primitives[name], `${name} compatibility export drifted`);
  }
});

run('receipt-primitives');
