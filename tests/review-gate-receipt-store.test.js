'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ReceiptStore,
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
} = require('../scripts/lib/review-gate-receipt-store');
const { canonicalJson, sha256 } = require('../scripts/lib/receipt-primitives');

const NOW = '2026-09-06T00:00:00.000Z';
const SOURCE_COMMIT = 'a'.repeat(40);
const SOURCE_TREE = '2'.repeat(40);
const INTEGRITY_KEY = 'review-gate-test-integrity-key-365';
const TRUST_POLICY = Object.freeze({
  producers: Object.freeze([Object.freeze({
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    eventTypes: Object.freeze(['REVIEW_RECORDED', 'EVIDENCE_INVALIDATED']),
    receiptKinds: Object.freeze(['review', 'verification']),
  })]),
});

const makeRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-gate-store-'));

const makeEvent = (overrides = {}) => ({
  schema: STORE_EVENT_SCHEMA,
  eventId: 'event-1',
  eventType: 'REVIEW_RECORDED',
  workId: 'work-365',
  waveId: 'wave-1',
  producer: 'fixture-reviewer',
  adapter: 'fixture-adapter',
  sessionId: 'session-1',
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  policyVersion: '2026-09-06',
  contractVersion: 'dhpk.reviewer-contract.v2',
  recordedAt: NOW,
  payload: { status: 'COMPLETE' },
  ...overrides,
});

const makeReceipt = (overrides = {}) => ({
  schema: EVIDENCE_RECEIPT_SCHEMA,
  receiptId: 'receipt-1',
  kind: 'review',
  workId: 'work-365',
  waveId: 'wave-1',
  producer: 'fixture-reviewer',
  adapter: 'fixture-adapter',
  sessionId: 'session-1',
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  policyVersion: '2026-09-06',
  contractVersion: 'dhpk.reviewer-contract.v2',
  recordedAt: NOW,
  payload: { verdict: 'PASS' },
  ...overrides,
});

const makeStore = (root, options = {}) => new ReceiptStore({
  root,
  trustPolicy: TRUST_POLICY,
  integrityKey: INTEGRITY_KEY,
  now: options.now || (() => Date.parse(NOW)),
  leaseMs: options.leaseMs || 30000,
  isLeaseOwnerAlive: options.isLeaseOwnerAlive,
});

const assertDeepFrozen = (value) => {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
};

const trustedHead = (appendResult) => ({
  expectedRevision: appendResult.revision,
  expectedChainDigest: appendResult.chainDigest,
});

test('appends, inspects, and deterministically replays immutable typed evidence', () => {
  const root = makeRoot();
  const event = makeEvent();
  const receipt = makeReceipt();
  try {
    const appended = makeStore(root).append({ expectedRevision: 0, event, receipts: [receipt] });
    assert.strictEqual(appended.status, 'APPENDED');
    assert.strictEqual(appended.revision, 1);
    assert.match(appended.eventDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(appended.chainDigest, /^sha256:[a-f0-9]{64}$/);

    event.payload.status = 'CALLER_MUTATION';
    receipt.payload.verdict = 'CHANGES_REQUIRED';
    const inspected = makeStore(root).inspect({ workId: 'work-365', ...trustedHead(appended) });
    const replayed = makeStore(root).replay({ workId: 'work-365', ...trustedHead(appended) });
    assert.strictEqual(inspected.revision, 1);
    assert.strictEqual(inspected.events[0].payload.status, 'COMPLETE');
    assert.strictEqual(inspected.receipts[0].payload.verdict, 'PASS');
    assert.deepStrictEqual(replayed, inspected);
    assertDeepFrozen(inspected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canonical content addressing ignores key order and preserves compatible v1 fields', () => {
  const root = makeRoot();
  try {
    const event = makeEvent({ extension: { beta: 2, alpha: 1 } });
    const first = makeStore(root).append({ expectedRevision: 0, event, receipts: [makeReceipt()] });
    const reordered = {
      extension: { alpha: 1, beta: 2 },
      payload: { status: 'COMPLETE' },
      recordedAt: NOW,
      contractVersion: 'dhpk.reviewer-contract.v2',
      policyVersion: '2026-09-06',
      sourceTree: SOURCE_TREE,
      sourceCommit: SOURCE_COMMIT,
      sessionId: 'session-1',
      adapter: 'fixture-adapter',
      producer: 'fixture-reviewer',
      waveId: 'wave-1',
      workId: 'work-365',
      eventType: 'REVIEW_RECORDED',
      eventId: 'event-1',
      schema: STORE_EVENT_SCHEMA,
    };
    const duplicate = makeStore(root).append({ expectedRevision: 0, event: reordered, receipts: [makeReceipt()] });
    assert.strictEqual(duplicate.status, 'DUPLICATE');
    assert.strictEqual(duplicate.revision, 1);
    assert.strictEqual(duplicate.eventDigest, first.eventDigest);
    assert.deepStrictEqual(makeStore(root).inspect({ workId: 'work-365', ...trustedHead(first) }).events[0].extension, { alpha: 1, beta: 2 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalidation appends history and never rewrites the invalidated object', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    const first = store.append({ expectedRevision: 0, event: makeEvent(), receipts: [makeReceipt()] });
    const digest = first.receiptDigests[0].replace(/^sha256:/, '');
    const objectPath = path.join(root, 'objects', 'sha256', digest.slice(0, 2), `${digest}.json`);
    const before = fs.readFileSync(objectPath, 'utf8');
    const invalidated = store.append({
      expectedRevision: 1,
      event: makeEvent({
        eventId: 'event-2',
        eventType: 'EVIDENCE_INVALIDATED',
        payload: { invalidatedDigest: first.receiptDigests[0], reasonCode: 'PATCH_CHANGED' },
      }),
      receipts: [],
    });
    const replayed = store.replay({ workId: 'work-365', ...trustedHead(invalidated) });
    assert.strictEqual(replayed.revision, 2);
    assert.strictEqual(replayed.events[1].payload.invalidatedDigest, first.receiptDigests[0]);
    assert.strictEqual(fs.readFileSync(objectPath, 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('idempotency conflicts and stale revisions fail without changing history', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    const first = store.append({ expectedRevision: 0, event: makeEvent(), receipts: [makeReceipt()] });
    assert.throws(
      () => store.append({ expectedRevision: 1, event: makeEvent({ payload: { status: 'DIFFERENT' } }), receipts: [makeReceipt()] }),
      (error) => error.code === 'IDEMPOTENCY_CONFLICT'
    );
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent({ eventId: 'event-2' }), receipts: [] }),
      (error) => error.code === 'REVISION_CONFLICT'
    );
    assert.strictEqual(store.inspect({ workId: 'work-365', ...trustedHead(first) }).revision, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('per-work leases reject foreign owners, recover after expiry, and isolate work IDs', () => {
  const root = makeRoot();
  let now = Date.parse(NOW);
  let ownerAlive = true;
  try {
    const store = makeStore(root, {
      now: () => now,
      leaseMs: 1000,
      isLeaseOwnerAlive: () => ownerAlive,
    });
    const lease = store.acquireLease('work-365', { ownerId: 'owner-1' });
    assertDeepFrozen(lease);
    assert.throws(() => store.acquireLease('work-365', { ownerId: 'owner-2' }), (error) => error.code === 'LEASE_CONFLICT');
    const unrelated = store.acquireLease('work-366', { ownerId: 'owner-2' });
    assert.strictEqual(unrelated.workId, 'work-366');
    store.releaseLease(unrelated);
    now += 1001;
    assert.throws(() => store.acquireLease('work-365', { ownerId: 'owner-2' }), (error) => error.code === 'LEASE_CONFLICT');
    ownerAlive = false;
    const recovered = store.acquireLease('work-365', { ownerId: 'owner-2' });
    assert.notStrictEqual(recovered.token, lease.token);
    assert.throws(() => store.releaseLease(lease), (error) => error.code === 'LEASE_OWNERSHIP');
    store.releaseLease(recovered);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('append revalidates its lease fence before claiming a sequence revision', () => {
  const root = makeRoot();
  let now = Date.parse(NOW);
  let ownerAlive = true;
  let successor = null;
  try {
    const store = makeStore(root, {
      now: () => now,
      leaseMs: 1000,
      isLeaseOwnerAlive: () => ownerAlive,
    });
    const writeObject = store._writeObject.bind(store);
    let raced = false;
    store._writeObject = (value, digest) => {
      writeObject(value, digest);
      if (!raced) {
        raced = true;
        now += 1001;
        ownerAlive = false;
        successor = store.acquireLease('work-365', { ownerId: 'successor' });
      }
    };
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent(), receipts: [] }),
      (error) => error.code === 'LEASE_OWNERSHIP'
    );
    const eventsPath = path.join(root, 'works', 'work-365', 'events');
    assert.strictEqual(fs.existsSync(eventsPath), false);
  } finally {
    if (successor) {
      try { makeStore(root).releaseLease(successor); } catch (_) { /* best-effort test cleanup */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed active leases fail closed without deleting their bytes', () => {
  const root = makeRoot();
  const leasePath = path.join(root, 'works', 'work-365', '.leases', 'claims', '000000000001.json');
  const malformed = '{"schema":"unknown"}\n';
  try {
    fs.mkdirSync(path.dirname(leasePath), { recursive: true });
    fs.writeFileSync(leasePath, malformed);
    assert.throws(
      () => makeStore(root).acquireLease('work-365', { ownerId: 'owner-1' }),
      (error) => error.code === 'LEASE_CONFLICT'
    );
    assert.strictEqual(fs.readFileSync(leasePath, 'utf8'), malformed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('foreign expired lease identities fail closed without stale takeover', () => {
  const root = makeRoot();
  const leasePath = path.join(root, 'works', 'work-365', '.leases', 'claims', '000000000001.json');
  const foreign = `${JSON.stringify({
    schema: 'dhpk.review-gate.store-lease.v1',
    generation: 1,
    processId: process.pid,
    workId: 'work-foreign',
    ownerId: 'owner-foreign',
    token: 'a'.repeat(32),
    acquiredAt: '2026-09-05T00:00:00.000Z',
    expiresAt: '2026-09-05T00:00:01.000Z',
  })}\n`;
  try {
    fs.mkdirSync(path.dirname(leasePath), { recursive: true });
    fs.writeFileSync(leasePath, foreign);
    assert.throws(
      () => makeStore(root).acquireLease('work-365', { ownerId: 'owner-1' }),
      (error) => error.code === 'LEASE_CONFLICT'
    );
    assert.strictEqual(fs.readFileSync(leasePath, 'utf8'), foreign);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lease release appends ownership history and cannot delete a successor claim', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    const first = store.acquireLease('work-365', { ownerId: 'owner-1' });
    store.releaseLease(first);
    const claimPath = path.join(root, 'works', 'work-365', '.leases', 'claims', '000000000001.json');
    const before = fs.readFileSync(claimPath, 'utf8');
    const second = store.acquireLease('work-365', { ownerId: 'owner-2' });
    assert.strictEqual(second.generation, 2);
    assert.throws(() => store.releaseLease(first), (error) => error.code === 'LEASE_OWNERSHIP');
    assert.strictEqual(fs.readFileSync(claimPath, 'utf8'), before);
    store.releaseLease(second);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replay rejects missing, malformed, and out-of-order sequence records', () => {
  for (const corruption of ['missing', 'malformed', 'out-of-order']) {
    const root = makeRoot();
    try {
      const store = makeStore(root);
      store.append({ expectedRevision: 0, event: makeEvent(), receipts: [] });
      const second = store.append({ expectedRevision: 1, event: makeEvent({ eventId: 'event-2' }), receipts: [] });
      const eventsPath = path.join(root, 'works', 'work-365', 'events');
      const firstPath = path.join(eventsPath, '000000000001.json');
      const secondPath = path.join(eventsPath, '000000000002.json');
      if (corruption === 'missing') fs.unlinkSync(firstPath);
      if (corruption === 'malformed') fs.writeFileSync(firstPath, '{broken');
      if (corruption === 'out-of-order') {
        const record = JSON.parse(fs.readFileSync(secondPath, 'utf8'));
        record.revision = 3;
        fs.writeFileSync(secondPath, JSON.stringify(record));
      }
      assert.throws(() => store.replay({ workId: 'work-365', ...trustedHead(second) }), (error) => (
        ['MISSING_SEQUENCE', 'MALFORMED_EVIDENCE', 'OUT_OF_ORDER', 'TAMPERED_EVIDENCE'].includes(error.code)
      ));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('replay rejects object and chain tampering', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    const appended = store.append({ expectedRevision: 0, event: makeEvent(), receipts: [makeReceipt()] });
    const digest = appended.eventDigest.replace(/^sha256:/, '');
    const objectPath = path.join(root, 'objects', 'sha256', digest.slice(0, 2), `${digest}.json`);
    const object = JSON.parse(fs.readFileSync(objectPath, 'utf8'));
    object.payload.status = 'TAMPERED';
    fs.writeFileSync(objectPath, JSON.stringify(object));
    assert.throws(() => store.replay({ workId: 'work-365', ...trustedHead(appended) }), (error) => error.code === 'TAMPERED_EVIDENCE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replay rejects a self-consistent full-history rewrite without the integrity key', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    const appended = store.append({ expectedRevision: 0, event: makeEvent(), receipts: [] });
    const oldBody = appended.eventDigest.replace(/^sha256:/, '');
    const oldPath = path.join(root, 'objects', 'sha256', oldBody.slice(0, 2), `${oldBody}.json`);
    const replacement = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    replacement.payload.status = 'REPLACED_HISTORY';
    const newBody = sha256(canonicalJson(replacement));
    const newPath = path.join(root, 'objects', 'sha256', newBody.slice(0, 2), `${newBody}.json`);
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.writeFileSync(newPath, `${canonicalJson(replacement)}\n`);

    const sequencePath = path.join(root, 'works', 'work-365', 'events', '000000000001.json');
    const sequence = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
    const { chainDigest: _oldChain, integrityMac, ...chainInput } = sequence;
    chainInput.eventDigest = `sha256:${newBody}`;
    const chainDigest = `sha256:${sha256(canonicalJson(chainInput))}`;
    const rewritten = {
      ...chainInput,
      chainDigest,
      ...(integrityMac ? { integrityMac } : {}),
    };
    fs.writeFileSync(sequencePath, `${canonicalJson(rewritten)}\n`);
    assert.throws(() => store.replay({ workId: 'work-365', ...trustedHead(appended) }), (error) => error.code === 'TAMPERED_EVIDENCE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('trusted expected revision rejects tail and complete history truncation', () => {
  for (const truncation of ['tail', 'all']) {
    const root = makeRoot();
    try {
      const store = makeStore(root);
      store.append({ expectedRevision: 0, event: makeEvent(), receipts: [] });
      const second = store.append({ expectedRevision: 1, event: makeEvent({ eventId: 'event-2' }), receipts: [] });
      const eventsPath = path.join(root, 'works', 'work-365', 'events');
      fs.unlinkSync(path.join(eventsPath, '000000000002.json'));
      if (truncation === 'all') fs.unlinkSync(path.join(eventsPath, '000000000001.json'));
      assert.throws(
        () => store.replay({ workId: 'work-365', ...trustedHead(second) }),
        (error) => error.code === 'TAMPERED_EVIDENCE'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('expected identity rejects stale and foreign evidence during replay', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    const appended = store.append({ expectedRevision: 0, event: makeEvent(), receipts: [makeReceipt()] });
    assert.strictEqual(
      store.replay({ workId: 'work-365', ...trustedHead(appended), expectedIdentity: { sourceCommit: SOURCE_COMMIT.toUpperCase() } }).revision,
      1
    );
    assert.throws(
      () => store.replay({ workId: 'work-365', ...trustedHead(appended), expectedIdentity: { sourceCommit: 'f'.repeat(40) } }),
      (error) => error.code === 'STALE_EVIDENCE'
    );
    assert.throws(
      () => store.replay({ workId: 'work-365', ...trustedHead(appended), expectedIdentity: { waveId: 'foreign-wave' } }),
      (error) => error.code === 'FOREIGN_EVIDENCE'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipts from a foreign session cannot bind to an event', () => {
  const root = makeRoot();
  try {
    assert.throws(
      () => makeStore(root).append({
        expectedRevision: 0,
        event: makeEvent(),
        receipts: [makeReceipt({ sessionId: 'session-foreign' })],
      }),
      (error) => error.code === 'FOREIGN_EVIDENCE'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unknown producers and adapters fail closed by receipt kind and event type', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent({ producer: 'unknown' }), receipts: [] }),
      (error) => error.code === 'UNTRUSTED_PRODUCER'
    );
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent({ eventType: 'UNAUTHORIZED_EVENT' }), receipts: [] }),
      (error) => error.code === 'UNTRUSTED_PRODUCER'
    );
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent(), receipts: [makeReceipt({ kind: 'authority' })] }),
      (error) => error.code === 'UNTRUSTED_PRODUCER'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unknown major schemas fail closed while v1 extensions survive replay', () => {
  const root = makeRoot();
  try {
    const store = makeStore(root);
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent({ schema: 'dhpk.review-gate.store-event.v2' }), receipts: [] }),
      (error) => error.code === 'UNSUPPORTED_SCHEMA'
    );
    const appended = store.append({
      expectedRevision: 0,
      event: makeEvent({ extension: { future: true } }),
      receipts: [makeReceipt({ extension: { future: true } })],
    });
    const replayed = store.replay({ workId: 'work-365', ...trustedHead(appended) });
    assert.deepStrictEqual(replayed.events[0].extension, { future: true });
    assert.deepStrictEqual(replayed.receipts[0].extension, { future: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded deeply nested v1 extensions survive replay without truncation', () => {
  const root = makeRoot();
  const extension = { one: { two: { three: { four: { five: { six: 'preserved' } } } } } };
  try {
    const store = makeStore(root);
    const appended = store.append({ expectedRevision: 0, event: makeEvent({ extension }), receipts: [] });
    assert.deepStrictEqual(store.replay({ workId: 'work-365', ...trustedHead(appended) }).events[0].extension, extension);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('secret fields are redacted before persistence', () => {
  const root = makeRoot();
  const marker = 'REVIEW_GATE_SECRET_12345678901234567890';
  try {
    const store = makeStore(root);
    const appended = store.append({
      expectedRevision: 0,
      event: makeEvent({ payload: {
        status: 'COMPLETE',
        token: marker,
        privateKey: marker,
        sessionCookie: marker,
        neutralPem: `-----BEGIN PRIVATE KEY-----\n${marker}`,
        note: `Authorization: Bearer ${marker}`,
      } }),
      receipts: [],
    });
    const persisted = JSON.stringify(store.inspect({ workId: 'work-365', ...trustedHead(appended) }));
    assert.doesNotMatch(persisted, new RegExp(marker));
    assert.match(persisted, /redacted/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replay verifies persisted raw bytes before applying redaction', () => {
  const root = makeRoot();
  const marker = 'INJECTED_SECRET_AFTER_PERSISTENCE_365';
  try {
    const store = makeStore(root);
    const appended = store.append({
      expectedRevision: 0,
      event: makeEvent({ payload: { status: 'COMPLETE', token: 'original-secret' } }),
      receipts: [],
    });
    const body = appended.eventDigest.replace(/^sha256:/, '');
    const objectPath = path.join(root, 'objects', 'sha256', body.slice(0, 2), `${body}.json`);
    const object = JSON.parse(fs.readFileSync(objectPath, 'utf8'));
    object.payload.token = marker;
    fs.writeFileSync(objectPath, JSON.stringify(object));
    assert.throws(() => store.replay({ workId: 'work-365', ...trustedHead(appended) }), (error) => error.code === 'TAMPERED_EVIDENCE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prompts, reasoning, full source, and complete logs are rejected', () => {
  for (const field of ['prompt', 'promptText', 'prompt_text', 'messageText', 'chainOfThought', 'thoughtTrace', 'reasoning', 'reasoningTrace', 'fullSource', 'fullSourcePath', 'sourceCode', 'fullLog', 'fullLogs', 'rawLog', 'rawLogs', 'stdout', 'stderr', 'transcript']) {
    const root = makeRoot();
    try {
      assert.throws(
        () => makeStore(root).append({
          expectedRevision: 0,
          event: makeEvent({ payload: { status: 'COMPLETE', [field]: 'forbidden bytes' } }),
          receipts: [],
        }),
        (error) => error.code === 'SENSITIVE_EVIDENCE'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('store paths reject symlinked ancestors before writing outside the configured root', () => {
  const root = makeRoot();
  const outside = makeRoot();
  const redirectedRoot = path.join(root, 'redirect', 'store');
  try {
    fs.symlinkSync(outside, path.join(root, 'redirect'), 'dir');
    assert.throws(
      () => makeStore(redirectedRoot).append({ expectedRevision: 0, event: makeEvent(), receipts: [] }),
      /symlink|physical|contain/i
    );
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('store paths reject a root replaced by a symlink after construction', () => {
  const parent = makeRoot();
  const outside = makeRoot();
  const storeRoot = path.join(parent, 'store');
  const backupRoot = path.join(parent, 'store-backup');
  try {
    const store = makeStore(storeRoot);
    fs.renameSync(storeRoot, backupRoot);
    fs.symlinkSync(outside, storeRoot, 'dir');
    assert.throws(
      () => store.append({ expectedRevision: 0, event: makeEvent(), receipts: [] }),
      /symlink|physical|contain/i
    );
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  } finally {
    try { fs.unlinkSync(storeRoot); } catch (_) { /* already absent */ }
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

run('review-gate-receipt-store');
