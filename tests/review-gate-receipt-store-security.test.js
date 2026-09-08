'use strict';

// RED security contracts for the public ReceiptStore replay boundary.  Every
// fixture lives in an isolated temporary directory; replay of a FIFO is
// performed in a bounded child so a vulnerable blocking read cannot hang the
// test process.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ReceiptStore,
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
} = require('../scripts/lib/review-gate-receipt-store');
const { canonicalJson, sha256 } = require('../scripts/lib/receipt-primitives');

const ROOT = path.join(__dirname, '..');
const WORK_ID = 'work-390-security';
const WAVE_ID = 'wave-1';
const NOW = '2026-09-06T00:00:00.000Z';
const SOURCE_COMMIT = 'a'.repeat(40);
const SOURCE_TREE = '2'.repeat(40);
const TRUST_POLICY = Object.freeze({
  producers: Object.freeze([Object.freeze({
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    eventTypes: Object.freeze(['REVIEW_RECORDED', 'EVIDENCE_INVALIDATED']),
    receiptKinds: Object.freeze(['review', 'verification']),
  })]),
});

const makeRoot = (prefix = 'dhpk-review-gate-receipt-security-') => (
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
);

const makeEvent = (overrides = {}) => ({
  schema: STORE_EVENT_SCHEMA,
  eventId: 'event-1',
  eventType: 'REVIEW_RECORDED',
  workId: WORK_ID,
  waveId: WAVE_ID,
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
  workId: WORK_ID,
  waveId: WAVE_ID,
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

const makeStore = (root, integrityKey) => new ReceiptStore({
  root,
  trustPolicy: TRUST_POLICY,
  integrityKey,
  now: () => Date.parse(NOW),
  leaseMs: 30000,
});

const trustedHead = (appendResult) => ({
  expectedRevision: appendResult.revision,
  expectedChainDigest: appendResult.chainDigest,
});

const sequencePath = (root, revision) => path.join(
  root,
  'works',
  WORK_ID,
  'events',
  `${String(revision).padStart(12, '0')}.json`,
);

const objectPath = (root, digest) => {
  const body = String(digest).replace(/^sha256:/, '');
  return path.join(root, 'objects', 'sha256', body.slice(0, 2), `${body}.json`);
};

const createHistory = () => {
  const root = makeRoot();
  const integrityKey = crypto.randomBytes(32);
  const store = makeStore(root, integrityKey);
  const first = store.append({
    expectedRevision: 0,
    event: makeEvent({ eventId: 'event-1' }),
    receipts: [makeReceipt({ receiptId: 'receipt-1' })],
  });
  const second = store.append({
    expectedRevision: 1,
    event: makeEvent({ eventId: 'event-2', payload: { status: 'COMPLETE', revision: 2 } }),
    receipts: [makeReceipt({ receiptId: 'receipt-2' })],
  });
  return { root, integrityKey, first, second };
};

const cleanup = (...targets) => {
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
};

const replaceWithCopiedSymlink = (target, outsideRoot) => {
  const outside = path.join(outsideRoot, path.basename(target));
  fs.copyFileSync(target, outside);
  const bytes = fs.readFileSync(outside);
  fs.unlinkSync(target);
  fs.symlinkSync(outside, target);
  return { outside, bytes };
};

const replaceWithFifo = (target) => {
  fs.unlinkSync(target);
  const result = spawnSync('mkfifo', [target], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 2000,
    killSignal: 'SIGKILL',
  });
  assert.strictEqual(
    result.error,
    undefined,
    `mkfifo did not terminate: ${result.error && result.error.code}`,
  );
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
};

const authenticatedSequence = (sequence, integrityKey) => {
  const { chainDigest: _chainDigest, integrityMac: _integrityMac, ...unsigned } = sequence;
  const chainDigest = `sha256:${sha256(canonicalJson(unsigned))}`;
  const authenticated = { ...unsigned, chainDigest };
  const integrityMac = `hmac-sha256:${crypto
    .createHmac('sha256', integrityKey)
    .update(canonicalJson(authenticated))
    .digest('hex')}`;
  return { ...authenticated, integrityMac };
};

const replaceWithOversizedSequence = (target, integrityKey) => {
  const sequence = JSON.parse(fs.readFileSync(target, 'utf8'));
  const oversized = {
    ...sequence,
    padding: 'x'.repeat(2 * 1024 * 1024),
  };
  const rewritten = authenticatedSequence(oversized, integrityKey);
  fs.writeFileSync(target, `${canonicalJson(rewritten)}\n`, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return rewritten.chainDigest;
};

const replaceWithOversizedObject = (history) => {
  const originalPath = objectPath(history.root, history.second.eventDigest);
  const original = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
  const chunk = 'x'.repeat(4096);
  const oversized = Object.fromEntries(Array.from({ length: 200 }, (_, index) => (
    [`key-${index}`, [chunk, chunk]]
  )));
  const event = {
    ...original,
    payload: {
      ...original.payload,
      oversized,
    },
  };
  const digest = `sha256:${sha256(canonicalJson(event))}`;
  const replacementPath = objectPath(history.root, digest);
  fs.mkdirSync(path.dirname(replacementPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(replacementPath, `${canonicalJson(event)}\n`, { mode: 0o600 });
  fs.chmodSync(replacementPath, 0o600);

  const latestSequencePath = sequencePath(history.root, history.second.revision);
  const sequence = JSON.parse(fs.readFileSync(latestSequencePath, 'utf8'));
  const rewritten = authenticatedSequence({ ...sequence, eventDigest: digest }, history.integrityKey);
  fs.writeFileSync(latestSequencePath, `${canonicalJson(rewritten)}\n`, { mode: 0o600 });
  fs.chmodSync(latestSequencePath, 0o600);
  return rewritten.chainDigest;
};

const assertReplayRejected = (history, head, label) => {
  const result = spawnSync(process.execPath, [
    __filename,
    '--replay-child',
    history.root,
    WORK_ID,
    String(head.expectedRevision),
    head.expectedChainDigest,
    history.integrityKey.toString('hex'),
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 3000,
    killSignal: 'SIGKILL',
  });
  const childErrorCode = result.error && result.error.code;
  assert.strictEqual(
    childErrorCode,
    undefined,
    `${label}: bounded replay child failed or timed out (${childErrorCode || 'unknown'})`,
  );
  assert.strictEqual(result.signal, null, `${label}: replay child timed out`);
  assert.strictEqual(result.status, 1, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.strictEqual(result.stdout, 'REPLAY_REJECTED\n', `${label}: replay was accepted`);
  assert.strictEqual(result.stderr, '', `${label}: diagnostic was not redacted`);
  assert.strictEqual(result.stdout.includes(history.root), false);
};

const assertAncestorSwapRejected = (history, head, target, outsideDirectory, label) => {
  const originalReadFileSync = fs.readFileSync;
  const originalOpenSync = fs.openSync;
  const targetPath = path.resolve(target);
  const ancestor = path.dirname(targetPath);
  const backup = `${ancestor}.security-test-backup`;
  let swapped = false;
  let thrown = null;
  const swapBeforeOpen = (file) => {
    if (!swapped && typeof file === 'string' && path.resolve(file) === targetPath) {
      fs.renameSync(ancestor, backup);
      fs.symlinkSync(outsideDirectory, ancestor, 'dir');
      swapped = true;
    }
  };
  fs.readFileSync = (file, ...args) => {
    swapBeforeOpen(file);
    return originalReadFileSync(file, ...args);
  };
  fs.openSync = (file, ...args) => {
    swapBeforeOpen(file);
    return originalOpenSync(file, ...args);
  };
  try {
    makeStore(history.root, history.integrityKey).replay({ workId: WORK_ID, ...head });
  } catch (error) {
    thrown = error;
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.openSync = originalOpenSync;
    if (swapped) {
      fs.unlinkSync(ancestor);
      fs.renameSync(backup, ancestor);
    }
  }
  assert.ok(swapped, `${label}: replay did not exercise the injected open/read seam`);
  assert.ok(thrown, `${label}: ancestor swap was accepted`);
};

const assertLeaseRejected = (root, integrityKey, label) => {
  const result = spawnSync(process.execPath, [
    __filename,
    '--lease-child',
    root,
    WORK_ID,
    integrityKey.toString('hex'),
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 2000,
    killSignal: 'SIGKILL',
  });
  const childErrorCode = result.error && result.error.code;
  assert.strictEqual(
    childErrorCode,
    undefined,
    `${label}: bounded lease child failed or timed out (${childErrorCode || 'unknown'})`,
  );
  assert.strictEqual(result.signal, null, `${label}: lease child timed out`);
  assert.strictEqual(result.status, 1, `${label}: lease journal entry was accepted`);
  assert.strictEqual(result.stdout, 'LEASE_REJECTED\n', `${label}: lease entry was accepted`);
  assert.strictEqual(result.stderr, '', `${label}: diagnostic was not redacted`);
};

if (process.argv[2] === '--replay-child') {
  const root = process.argv[3];
  const workId = process.argv[4];
  const expectedRevision = Number(process.argv[5]);
  const expectedChainDigest = process.argv[6];
  const integrityKey = Buffer.from(process.argv[7] || '', 'hex');
  try {
    makeStore(root, integrityKey).replay({ workId, expectedRevision, expectedChainDigest });
    process.stdout.write('REPLAY_ACCEPTED\n');
    process.exitCode = 0;
  } catch (_) {
    process.stdout.write('REPLAY_REJECTED\n');
    process.exitCode = 1;
  }
}

if (process.argv[2] === '--lease-child') {
  const root = process.argv[3];
  const integrityKey = Buffer.from(process.argv[5] || '', 'hex');
  try {
    makeStore(root, integrityKey).acquireLease(process.argv[4], { ownerId: 'lease-child-next' });
    process.stdout.write('LEASE_ACQUIRED\n');
    process.exitCode = 0;
  } catch (_) {
    process.stdout.write('LEASE_REJECTED\n');
    process.exitCode = 1;
  }
}

if (process.argv[2] !== '--replay-child' && process.argv[2] !== '--lease-child') {
  test('replay rejects a symlinked latest sequence without reading outside the store root', () => {
    const history = createHistory();
    const outsideRoot = makeRoot('dhpk-review-gate-receipt-sequence-latest-outside-');
    try {
      const copied = replaceWithCopiedSymlink(
        sequencePath(history.root, history.second.revision),
        outsideRoot,
      );
      assertReplayRejected(history, trustedHead(history.second), 'latest sequence symlink');
      assert.deepStrictEqual(fs.readFileSync(copied.outside), copied.bytes);
    } finally {
      cleanup(history.root, outsideRoot);
    }
  });

  test('replay rejects a symlinked earlier sequence without reading outside the store root', () => {
    const history = createHistory();
    const outsideRoot = makeRoot('dhpk-review-gate-receipt-sequence-earlier-outside-');
    try {
      const copied = replaceWithCopiedSymlink(sequencePath(history.root, history.first.revision), outsideRoot);
      assertReplayRejected(history, trustedHead(history.second), 'earlier sequence symlink');
      assert.deepStrictEqual(fs.readFileSync(copied.outside), copied.bytes);
    } finally {
      cleanup(history.root, outsideRoot);
    }
  });

  test('replay rejects a FIFO sequence within the bounded child deadline', () => {
    const history = createHistory();
    try {
      replaceWithFifo(sequencePath(history.root, history.second.revision));
      assertReplayRejected(history, trustedHead(history.second), 'sequence FIFO');
    } finally {
      cleanup(history.root);
    }
  });

  test('replay rejects an authenticated sequence above the bounded byte budget', () => {
    const history = createHistory();
    try {
      const chainDigest = replaceWithOversizedSequence(
        sequencePath(history.root, history.second.revision),
        history.integrityKey,
      );
      assertReplayRejected(
        history,
        { expectedRevision: history.second.revision, expectedChainDigest: chainDigest },
        'oversized sequence',
      );
    } finally {
      cleanup(history.root);
    }
  });

  test('replay rejects an ancestor swap while opening the latest sequence', () => {
    const history = createHistory();
    const outsideRoot = makeRoot('dhpk-review-gate-receipt-sequence-ancestor-outside-');
    try {
      const target = sequencePath(history.root, history.second.revision);
      const outside = path.join(outsideRoot, path.basename(target));
      fs.copyFileSync(target, outside);
      const outsideBytes = fs.readFileSync(outside);
      assertAncestorSwapRejected(history, trustedHead(history.second), target, outsideRoot, 'sequence ancestor swap');
      assert.deepStrictEqual(fs.readFileSync(outside), outsideBytes);
    } finally {
      cleanup(history.root, outsideRoot);
    }
  });

  test('replay rejects a symlinked content-addressed object', () => {
    const history = createHistory();
    const outsideRoot = makeRoot('dhpk-review-gate-receipt-object-symlink-outside-');
    try {
      const target = objectPath(history.root, history.second.eventDigest);
      const copied = replaceWithCopiedSymlink(target, outsideRoot);
      assertReplayRejected(history, trustedHead(history.second), 'content-addressed object symlink');
      assert.deepStrictEqual(fs.readFileSync(copied.outside), copied.bytes);
    } finally {
      cleanup(history.root, outsideRoot);
    }
  });

  test('replay rejects a FIFO content-addressed object within the bounded child deadline', () => {
    const history = createHistory();
    try {
      replaceWithFifo(objectPath(history.root, history.second.eventDigest));
      assertReplayRejected(history, trustedHead(history.second), 'content-addressed object FIFO');
    } finally {
      cleanup(history.root);
    }
  });

  test('replay rejects an oversized content-addressed object before accepting its digest', () => {
    const history = createHistory();
    try {
      const chainDigest = replaceWithOversizedObject(history);
      assertReplayRejected(
        history,
        { expectedRevision: history.second.revision, expectedChainDigest: chainDigest },
        'oversized content-addressed object',
      );
    } finally {
      cleanup(history.root);
    }
  });

  test('replay rejects an ancestor swap while opening a content-addressed object', () => {
    const history = createHistory();
    const outsideRoot = makeRoot('dhpk-review-gate-receipt-object-ancestor-outside-');
    try {
      const target = objectPath(history.root, history.second.eventDigest);
      const outside = path.join(outsideRoot, path.basename(target));
      fs.copyFileSync(target, outside);
      const outsideBytes = fs.readFileSync(outside);
      assertAncestorSwapRejected(history, trustedHead(history.second), target, outsideRoot, 'object ancestor swap');
      assert.deepStrictEqual(fs.readFileSync(outside), outsideBytes);
    } finally {
      cleanup(history.root, outsideRoot);
    }
  });

  test('acquireLease rejects a FIFO claim without blocking the bounded child', () => {
    const root = makeRoot('dhpk-review-gate-receipt-lease-claim-fifo-');
    const integrityKey = crypto.randomBytes(32);
    try {
      const store = makeStore(root, integrityKey);
      const lease = store.acquireLease(WORK_ID, { ownerId: 'lease-owner' });
      store.releaseLease(lease);
      const claimPath = path.join(
        root,
        'works',
        WORK_ID,
        '.leases',
        'claims',
        '000000000001.json',
      );
      replaceWithFifo(claimPath);
      assertLeaseRejected(root, integrityKey, 'lease claim FIFO');
    } finally {
      cleanup(root);
    }
  });

  test('acquireLease rejects a FIFO release without blocking the bounded child', () => {
    const root = makeRoot('dhpk-review-gate-receipt-lease-release-fifo-');
    const integrityKey = crypto.randomBytes(32);
    try {
      const store = makeStore(root, integrityKey);
      const lease = store.acquireLease(WORK_ID, { ownerId: 'lease-owner' });
      store.releaseLease(lease);
      const releasePath = path.join(
        root,
        'works',
        WORK_ID,
        '.leases',
        'releases',
        `${sha256(lease.token)}.json`,
      );
      replaceWithFifo(releasePath);
      assertLeaseRejected(root, integrityKey, 'lease release FIFO');
    } finally {
      cleanup(root);
    }
  });

  test('append rejects a valid payload above the 1 MiB persisted JSON budget before creating store files', () => {
    const root = makeRoot('dhpk-review-gate-receipt-admission-bytes-');
    const integrityKey = crypto.randomBytes(32);
    const store = makeStore(root, integrityKey);
    const chunk = 'x'.repeat(4096);
    const event = makeEvent({
      payload: {
        status: 'COMPLETE',
        first: Array.from({ length: 200 }, () => chunk),
        second: Array.from({ length: 200 }, () => chunk),
      },
    });
    try {
      assert.ok(Buffer.byteLength(canonicalJson(event), 'utf8') > 1024 * 1024);
      assert.throws(
        () => store.append({ expectedRevision: 0, event, receipts: [] }),
        (error) => error && error.code === 'MALFORMED_EVIDENCE',
      );
      assert.deepStrictEqual(fs.readdirSync(root), []);
      const replayed = makeStore(root, integrityKey).replay({
        workId: WORK_ID,
        expectedRevision: 0,
        expectedChainDigest: null,
      });
      assert.strictEqual(replayed.revision, 0);
      assert.deepStrictEqual(replayed.events, []);
      assert.deepStrictEqual(replayed.receipts, []);
    } finally {
      cleanup(root);
    }
  });

  test('append rejects a valid receipt above the 1 MiB persisted JSON budget before creating store files', () => {
    const root = makeRoot('dhpk-review-gate-receipt-admission-receipt-bytes-');
    const integrityKey = crypto.randomBytes(32);
    const chunk = 'x'.repeat(4096);
    const receipt = makeReceipt({
      payload: {
        status: 'PASS',
        first: Array.from({ length: 200 }, () => chunk),
        second: Array.from({ length: 200 }, () => chunk),
      },
    });
    try {
      const store = makeStore(root, integrityKey);
      assert.ok(Buffer.byteLength(canonicalJson(receipt), 'utf8') > 1024 * 1024);
      assert.throws(
        () => store.append({ expectedRevision: 0, event: makeEvent(), receipts: [receipt] }),
        (error) => error && error.code === 'MALFORMED_EVIDENCE',
      );
      assert.deepStrictEqual(fs.readdirSync(root), []);
      const replayed = makeStore(root, integrityKey).replay({
        workId: WORK_ID,
        expectedRevision: 0,
        expectedChainDigest: null,
      });
      assert.strictEqual(replayed.revision, 0);
      assert.deepStrictEqual(replayed.events, []);
      assert.deepStrictEqual(replayed.receipts, []);
    } finally {
      cleanup(root);
    }
  });

  test('append rejects more than 200 receipts before acquiring a lease or writing objects', () => {
    const root = makeRoot('dhpk-review-gate-receipt-admission-receipt-count-');
    const integrityKey = crypto.randomBytes(32);
    const store = makeStore(root, integrityKey);
    const receipts = Array.from({ length: 201 }, (_, index) => (
      makeReceipt({ receiptId: `receipt-capacity-${index}` })
    ));
    let leaseAttempts = 0;
    let objectWrites = 0;
    const acquireLease = store.acquireLease;
    store.acquireLease = (...args) => {
      leaseAttempts += 1;
      return acquireLease.apply(store, args);
    };
    store._writeObject = () => {
      objectWrites += 1;
    };
    try {
      assert.throws(
        () => store.append({ expectedRevision: 0, event: makeEvent(), receipts }),
        (error) => error && error.code === 'MALFORMED_EVIDENCE',
      );
      assert.strictEqual(leaseAttempts, 0);
      assert.strictEqual(objectWrites, 0);
      assert.deepStrictEqual(fs.readdirSync(root), []);
    } finally {
      cleanup(root);
    }
  });

  test('append rejects revision 10001 before writing a content-addressed object', () => {
    const root = makeRoot('dhpk-review-gate-receipt-admission-revision-');
    const integrityKey = crypto.randomBytes(32);
    const store = makeStore(root, integrityKey);
    const chainDigest = `sha256:${'c'.repeat(64)}`;
    let objectWrites = 0;
    store._replay = () => ({
      revision: 10000,
      chainDigest,
      events: [],
      receipts: [],
      sequences: [],
    });
    store._writeObject = () => {
      objectWrites += 1;
    };
    try {
      assert.throws(
        () => store.append({
          expectedRevision: 10000,
          event: makeEvent({ eventId: 'event-capacity' }),
          receipts: [],
        }),
        (error) => error && error.code === 'MALFORMED_EVIDENCE',
      );
      assert.strictEqual(objectWrites, 0);
    } finally {
      cleanup(root);
    }
  });

  test('append preserves duplicate idempotency at the 10000 revision boundary', () => {
    const root = makeRoot('dhpk-review-gate-receipt-admission-duplicate-boundary-');
    const integrityKey = crypto.randomBytes(32);
    const event = makeEvent({ eventId: 'event-capacity-duplicate' });
    const receipt = makeReceipt({ receiptId: 'receipt-capacity-duplicate' });
    const eventDigest = `sha256:${sha256(canonicalJson(event))}`;
    const receiptDigest = `sha256:${sha256(canonicalJson(receipt))}`;
    const chainDigest = `sha256:${'c'.repeat(64)}`;
    let objectWrites = 0;
    try {
      const store = makeStore(root, integrityKey);
      store._replay = () => ({
        revision: 10000,
        chainDigest,
        events: [event],
        receipts: [receipt],
        sequences: [{
          revision: 10000,
          eventDigest,
          receiptDigests: [receiptDigest],
          chainDigest,
        }],
      });
      store._writeObject = () => {
        objectWrites += 1;
      };
      const duplicate = store.append({
        expectedRevision: 10000,
        event,
        receipts: [receipt],
      });
      assert.strictEqual(duplicate.status, 'DUPLICATE');
      assert.strictEqual(duplicate.revision, 10000);
      assert.strictEqual(duplicate.eventDigest, eventDigest);
      assert.deepStrictEqual(duplicate.receiptDigests, [receiptDigest]);
      assert.strictEqual(duplicate.chainDigest, chainDigest);
      assert.strictEqual(objectWrites, 0);
    } finally {
      cleanup(root);
    }
  });

  run('review-gate-receipt-store-security');
}
